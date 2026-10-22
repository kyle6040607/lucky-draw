/* 第 2 階段：CSV／Excel 匯入匯出、備份 */
(function () {
  'use strict';
  const { Store, Employees, Prizes, Draw, IO, Backup } = LT;
  const { test, section, assert, eq, throwsCode, rejectsCode, setup } = T;

  section('第 2 階段：匯入匯出與備份');

  /* ---------- CSV ---------- */

  test('CSV：引號、引號內逗號與換行、"" 跳脫、CRLF', () => {
    const text = '工號,姓名,備註\r\nA1,"王, 小明","他說""好"""\r\nA2,陳美玲,"第一行\n第二行"\r\n';
    eq(IO.parseCsv(text), [
      ['工號', '姓名', '備註'],
      ['A1', '王, 小明', '他說"好"'],
      ['A2', '陳美玲', '第一行\n第二行']
    ]);
  });

  test('CSV：最後一列沒有換行、空欄位都能正確解析', () => {
    eq(IO.parseCsv('a,,c\nd,e,'), [['a', '', 'c'], ['d', 'e', '']]);
  });

  test('編碼：UTF-8（含 BOM）自動去除 BOM', () => {
    const bytes = new TextEncoder().encode('﻿工號,姓名');
    eq(IO.decodeText(bytes.buffer), '工號,姓名');
  });

  test('編碼：Big5（Excel 另存 CSV 預設）自動辨識', () => {
    // 「工號,姓名\r\nA1,王小明」的 Big5 位元組
    const bytes = new Uint8Array([
      0xA4, 0x75, 0xB8, 0xB9, 0x2C, 0xA9, 0x6D, 0xA6, 0x57, 0x0D, 0x0A,
      0x41, 0x31, 0x2C, 0xA4, 0xFD, 0xA4, 0x70, 0xA9, 0xFA
    ]);
    eq(IO.parseCsv(IO.decodeText(bytes.buffer)), [['工號', '姓名'], ['A1', '王小明']]);
  });

  test('CSV 匯出：含 BOM、需要時加引號、可被解析回原內容', () => {
    const header = ['工號', '姓名', '備註'];
    const rows = [['001', '王, 小明', '他說"好"'], ['002', '陳美玲', '第一行\n第二行']];
    const csv = IO.toCsv(header, rows);
    assert(csv.startsWith('﻿'), '缺少 BOM，Excel 開啟會亂碼');
    eq(IO.parseCsv(csv.slice(1)), [header, ...rows]);
  });

  test('CSV 匯出：= + @ 開頭的文字加上 \' 防止被當成公式，負數不受影響', () => {
    const csv = IO.toCsv(['a'], [['=1+1'], ['@SUM(A1)'], ['-5'], ['-abc']]);
    eq(IO.parseCsv(csv.slice(1)).slice(1), [["'=1+1"], ["'@SUM(A1)"], ['-5'], ["'-abc"]]);
  });

  /* ---------- 名單解析 ---------- */

  test('名單解析：可辨識不同欄位名稱，欄位順序不拘', () => {
    const rows = IO.tableToEmployees([
      ['部門', '名字', '員工編號'],
      ['業務部', '王小明', 'A1']
    ]);
    eq(rows, [{ line: 2, empNo: 'A1', name: '王小明', department: '業務部', active: undefined }]);
  });

  test('名單解析：上方有標題列時仍能找到表頭，列號對應檔案實際列號', () => {
    const rows = IO.tableToEmployees([
      ['2026 尾牙名單'],
      [],
      ['工號', '姓名', '參加'],
      ['A1', '甲', ''],
      ['A2', '乙', '否'],
      ['A3', '丙', 'N']
    ]);
    eq(rows.map(r => [r.line, r.active]), [[4, true], [5, false], [6, false]]);
  });

  test('名單解析：找不到工號／姓名欄位時說明檔案第一列內容', () => {
    const e = throwsCode(() => IO.tableToEmployees([['編號A', '名稱'], ['1', '甲']]), 'IO_NO_HEADER');
    assert(e.message.includes('編號A、名稱'), e.message);
  });

  /* ---------- 匯入預覽與套用 ---------- */

  test('匯入預覽：區分新增、更新、相同與錯誤列', () => {
    const s = setup(2); // E001 員工1 業務部、E002 員工2 研發部
    const plan = IO.planImport(s, IO.tableToEmployees([
      ['工號', '姓名', '部門'],
      ['e001', '員工1', '業務部'],   // 相同（工號不分大小寫）
      ['E002', '員工2', '管理部'],   // 部門變更
      ['E003', '新人', '研發部'],     // 新增
      ['', '沒工號', ''],             // 錯誤
      ['E004', '', ''],               // 錯誤
      ['', '', '']                    // 空白列略過
    ]));
    eq([plan.same.length, plan.update.length, plan.add.length], [1, 1, 1]);
    eq(plan.update[0].before.department, '研發部');
    eq(plan.errors.map(x => [x.line, x.reason]), [[5, '缺少工號'], [6, '缺少姓名']]);
  });

  test('匯入預覽：檔案內工號重複的列全部列為錯誤，不擅自合併', () => {
    const s = Store.emptyState();
    const plan = IO.planImport(s, IO.tableToEmployees([
      ['工號', '姓名'],
      ['A1', '王小明'],
      ['A2', '陳美玲'],
      ['a1', '王大明']
    ]));
    eq(plan.add.map(r => r.empNo), ['A2']);
    eq(plan.errors.map(x => [x.line, x.reason]), [
      [2, '工號「A1」與第 4 列重複'],
      [4, '工號「a1」與第 2 列重複']
    ]);
  });

  test('匯入套用：新增與更新寫入名單；沒有「參加」欄時不改動原本的停用設定', () => {
    const store = Store.createStore(Store.memoryAdapter());
    store.mutate(s => Employees.add(s, { empNo: 'A1', name: '甲', active: false }));
    const plan = IO.planImport(store.state, IO.tableToEmployees([
      ['工號', '姓名'], ['A1', '甲改名'], ['A2', '乙']
    ]));
    const result = store.mutate(s => IO.applyImport(s, plan));
    eq(result, { added: 1, updated: 1 });
    const a1 = Employees.findByEmpNo(store.state, 'A1');
    eq([a1.name, a1.active], ['甲改名', false]);
    eq(Employees.activeCount(store.state), 1);
  });

  test('匯入套用：「參加」欄為否時會停用已存在的員工', () => {
    const s = setup(1);
    const plan = IO.planImport(s, IO.tableToEmployees([['工號', '姓名', '部門', '參加'], ['E001', '員工1', '業務部', '否']]));
    eq(plan.update.length, 1);
    IO.applyImport(s, plan);
    eq(Employees.find(s, 1).active, false);
  });

  /* ---------- Excel ---------- */

  test('Excel：匯出再讀回內容一致，工號 001 保留前置零', () => {
    const table = IO.templateTable();
    table.rows.push(['001', '林小華', '', '是']);
    const back = IO.tableFromWorkbook(IO.tableToXlsx(table, '名單'));
    eq(back, [table.header, ...table.rows]);
  });

  test('Excel：範本可以直接匯入（含同名不同工號、不參加）', () => {
    const buf = IO.tableToXlsx(IO.templateTable());
    const plan = IO.planImport(Store.emptyState(), IO.tableToEmployees(IO.tableFromWorkbook(buf)));
    eq(plan.add.map(r => [r.empNo, r.name, r.active]), [
      ['A001', '王小明', true], ['A002', '王小明', true], ['A003', '陳美玲', false]
    ]);
  });

  test('讀檔：依副檔名處理 CSV 與 Excel，其他格式拒絕', async () => {
    const csv = new File([IO.toCsv(['工號', '姓名'], [['A1', '甲']])], '名單.csv');
    eq(await IO.readTable(csv), [['工號', '姓名'], ['A1', '甲']]);
    const xlsx = new File([IO.tableToXlsx({ header: ['工號', '姓名'], rows: [['A1', '甲']] })], '名單.XLSX');
    eq(await IO.readTable(xlsx), [['工號', '姓名'], ['A1', '甲']]);
    await rejectsCode(() => IO.readTable(new File(['x'], '名單.pdf')), 'IO_BAD_TYPE');
  });

  /* ---------- 匯出內容 ---------- */

  test('紀錄匯出：包含狀態文字，可選擇只匯出有效紀錄', () => {
    const s = setup(3);
    const p = Prizes.add(s, { title: '頭獎', item: '電視', quantity: 2 });
    const first = Draw.draw(s, p.id).records[0];
    Draw.forfeit(s, first.id);
    const second = Draw.draw(s, p.id).records[0];
    const all = IO.recordTable(s);
    eq(all.rows.length, 2);
    eq(all.rows.map(r => r[7]), ['已放棄', '有效']);
    const valid = IO.recordTable(s, { includeInvalid: false });
    eq(valid.rows.map(r => [r[0], r[3], r[9]]), [[1, second.empNo, 2]]);
  });

  test('名單匯出：格式與匯入相同，可再匯入', () => {
    const s = setup(3);
    Employees.update(s, 2, { active: false });
    const table = IO.employeeTable(s);
    eq(table.rows[1], ['E002', '員工2', '研發部', '否']);
    const plan = IO.planImport(s, IO.tableToEmployees([table.header, ...table.rows]));
    eq(plan.same.length, 3);
  });

  /* ---------- 備份 ---------- */

  test('備份：匯出後匯入內容完全一致', () => {
    const s = setup(3);
    const p = Prizes.add(s, { title: '頭獎', item: '電視', quantity: 1 });
    Draw.draw(s, p.id);
    const restored = Backup.parseBackupText(Backup.toBackupText(s));
    eq(restored, s);
    const store = Store.createStore(Store.memoryAdapter());
    store.replace(restored);
    eq(store.state.draws.length, 1);
  });

  test('備份：非 JSON、非本系統、版本不符都拒絕載入', () => {
    throwsCode(() => Backup.parseBackupText('not json'), 'BACKUP_BAD_JSON');
    throwsCode(() => Backup.parseBackupText('{"a":1}'), 'BACKUP_BAD_DATA');
    const old = { ...Store.emptyState(), version: 999 };
    throwsCode(() => Backup.parseBackupText(JSON.stringify(old)), 'BAD_VERSION');
  });

  test('備份：檔名含活動名稱並移除 Windows 不允許的字元', () => {
    const s = Store.emptyState();
    s.settings.eventName = '2026/春酒:總公司';
    assert(/^抽獎備份_2026_春酒_總公司_\d{8}-\d{6}\.json$/.test(Backup.backupFilename(s)), Backup.backupFilename(s));
  });

  test('自動存檔：連續變動依序寫入，最後寫入的是最新狀態', async () => {
    const store = Store.createStore(Store.memoryAdapter());
    const written = [];
    const fakeHandle = {
      name: 'fake.json',
      async createWritable() {
        let buf = '';
        return {
          async write(t) { buf += t; await new Promise(r => setTimeout(r, 5)); },
          async close() { written.push(JSON.parse(buf).data); }
        };
      }
    };
    const original = window.showSaveFilePicker;
    window.showSaveFilePicker = async () => fakeHandle;
    try {
      const sync = Backup.createFileSync(store);
      eq(await sync.choose(), 'fake.json');
      store.mutate(s => Employees.add(s, { empNo: 'A1', name: '甲' }));
      store.mutate(s => Employees.add(s, { empNo: 'A2', name: '乙' }));
      store.mutate(s => Employees.add(s, { empNo: 'A3', name: '丙' }));
      await sync.whenIdle();
      eq(written[written.length - 1].employees.length, 3);
      assert(written.length <= 4, `寫入次數過多：${written.length}`);
    } finally {
      window.showSaveFilePicker = original;
    }
  });
})();
