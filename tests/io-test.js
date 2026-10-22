/* io-test.html 的操作邏輯：用獨立的 localStorage 鍵，不影響正式資料 */
(function () {
  'use strict';
  const { Store, Employees, Prizes, Draw, IO, Backup } = LT;
  const store = Store.createStore(Store.localStorageAdapter('lottery-io-test'));
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  let plan = null;

  function say(text, ok = true) {
    $('msg').className = ok ? 'ok' : 'err';
    $('msg').textContent = text;
  }

  function table(header, rows) {
    return `<table><tr>${header.map(h => `<th>${esc(h)}</th>`).join('')}</tr>` +
      rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('') + '</table>';
  }

  function render() {
    const s = store.state;
    $('count').textContent = Employees.activeCount(s);
    $('total').textContent = s.employees.length;
    $('drawCount').textContent = s.draws.length;
    const t = IO.employeeTable(s);
    $('employees').innerHTML = s.employees.length ? table(t.header, t.rows.slice(0, 50)) +
      (s.employees.length > 50 ? `<p class="note">（只顯示前 50 人）</p>` : '') : '';
  }
  store.subscribe(render);
  render();

  function showPreview() {
    if (!plan) { $('preview').innerHTML = ''; return; }
    const errors = plan.errors.length
      ? `<h3 class="err">有問題的列（不會匯入，請修改檔案後重新選擇）</h3>` +
        table(['列號', '工號', '姓名', '原因'], plan.errors.map(e => [e.line, e.row.empNo, e.row.name, e.reason]))
      : '';
    const updates = plan.update.length
      ? `<h3>將更新</h3>` + table(['工號', '原本', '更新為'], plan.update.map(u => [
        u.empNo,
        `${u.before.name}／${u.before.department || '—'}／${u.before.active ? '參加' : '不參加'}`,
        `${u.name}／${u.department || '—'}${u.active === undefined ? '' : (u.active ? '／參加' : '／不參加')}`
      ]))
      : '';
    $('preview').innerHTML =
      `<p>新增 <b>${plan.add.length}</b> 人、更新 <b>${plan.update.length}</b> 人、` +
      `相同 ${plan.same.length} 人、<span class="${plan.errors.length ? 'err' : ''}">錯誤 ${plan.errors.length} 列</span></p>` +
      errors + updates +
      `<button class="primary" data-act="apply" ${plan.add.length + plan.update.length ? '' : 'disabled'}>確認匯入</button>` +
      `<button data-act="cancel">取消</button>`;
  }

  async function onImportFile(file) {
    try {
      plan = IO.planImport(store.state, IO.tableToEmployees(await IO.readTable(file)));
      say(`已讀取「${file.name}」，請確認預覽內容`);
    } catch (e) {
      plan = null;
      say(e.message, false);
    }
    showPreview();
  }

  /** 建立三個獎項並抽完，再把第一筆設為放棄、撤銷最後一批 */
  function demoDraw(s) {
    if (s.employees.length < 3) throw new LT.LotteryError('DEMO_FEW', '請先匯入至少 3 位員工');
    const n = Math.min(3, Math.floor(s.employees.length / 3));
    ['普獎', '二獎', '頭獎'].forEach((title, i) => {
      const p = Prizes.add(s, { title: `${title}（示範）`, item: ['禮券', '氣炸鍋', '電視'][i], quantity: n, batchSize: n });
      Draw.draw(s, p.id);
    });
    Draw.forfeit(s, s.draws[0].id);
    Draw.undoLast(s);
  }

  const actions = {
    'template-xlsx': () => IO.exportTable(IO.templateTable(), { format: 'xlsx', filename: '員工名單範本', sheetName: '名單' }),
    'template-csv': () => IO.exportTable(IO.templateTable(), { format: 'csv', filename: '員工名單範本' }),
    'emp-xlsx': () => IO.exportTable(IO.employeeTable(store.state), { format: 'xlsx', filename: '員工名單_' + IO.fileStamp(), sheetName: '名單' }),
    'emp-csv': () => IO.exportTable(IO.employeeTable(store.state), { format: 'csv', filename: '員工名單_' + IO.fileStamp() }),
    'rec-xlsx': () => IO.exportTable(IO.recordTable(store.state), { format: 'xlsx', filename: '抽獎紀錄_' + IO.fileStamp(), sheetName: '抽獎紀錄' }),
    'rec-csv': () => IO.exportTable(IO.recordTable(store.state), { format: 'csv', filename: '抽獎紀錄_' + IO.fileStamp() }),
    apply: () => {
      const r = store.mutate(s => IO.applyImport(s, plan));
      plan = null;
      showPreview();
      say(`匯入完成：新增 ${r.added} 人、更新 ${r.updated} 人`);
    },
    cancel: () => { plan = null; showPreview(); say(''); },
    clear: () => {
      if (!confirm('確定清空測試資料？')) return;
      store.replace(Store.emptyState());
      say('已清空測試資料');
    },
    'demo-draw': () => {
      store.mutate(demoDraw);
      say('已產生示範抽獎紀錄，可以匯出查看');
    },
    backup: () => Backup.downloadBackup(store.state),
    sync: async () => {
      if (!sync.supported) return say('此瀏覽器不支援自動存檔，請使用 Chrome 或 Edge', false);
      try {
        const name = await sync.choose();
        $('syncStatus').textContent = `自動存檔到：${name}`;
      } catch (e) {
        if (e.name !== 'AbortError') say(e.message, false);
      }
    },
    touch: () => {
      store.mutate(s => { s.settings.eventName = '測試活動 ' + LT.now(); });
      say('已變動資料：' + store.state.settings.eventName);
    }
  };

  const sync = Backup.createFileSync(store, {
    onChange: s => {
      if (s.status === 'on') $('syncStatus').textContent = `自動存檔到：${s.fileName}（最後寫入 ${s.lastSaved || '—'}）`;
    },
    onError: e => say('自動存檔失敗：' + e.message, false)
  });

  document.addEventListener('click', async e => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    try {
      await actions[btn.dataset.act]();
    } catch (err) {
      say(err.message, false);
    }
  });

  $('importFile').addEventListener('change', e => {
    if (e.target.files[0]) onImportFile(e.target.files[0]);
    e.target.value = '';
  });

  $('restoreFile').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = Backup.parseBackupText(await file.text());
      if (!confirm(`還原「${file.name}」？目前的測試資料會被取代。\n（${data.employees.length} 位員工、${data.prizes.length} 個獎項、${data.draws.length} 筆紀錄）`)) return;
      store.replace(data);
      say('還原完成');
    } catch (err) {
      say(err.message, false);
    }
  });
})();
