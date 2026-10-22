/* 匯入匯出：CSV／Excel 讀取、員工名單匯入（先預覽再套用）、名單與抽獎紀錄匯出。
 * Excel 讀寫使用 lib/xlsx.full.min.js（SheetJS），CSV 由本檔自行處理。 */
(function (global) {
  'use strict';
  const LT = global.LT;
  const E = LT.LotteryError;
  const clean = LT.clean;

  /* ---------- 文字編碼與 CSV ---------- */

  /** 位元組轉文字：先試 UTF-8（自動去除 BOM），失敗則視為 Big5（台灣 Excel 另存 CSV 的預設） */
  function decodeText(buffer) {
    const bytes = new Uint8Array(buffer);
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (e) {
      return new TextDecoder('big5').decode(bytes);
    }
  }

  /** RFC 4180 CSV 解析：支援引號、引號內逗號與換行、"" 跳脫、CRLF／LF */
  function parseCsv(text) {
    const rows = [];
    let row = [], field = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch !== '"') field += ch;
        else if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else if (ch === '"' && field === '') {
        quoted = true;
      } else if (ch === ',') {
        row.push(field);
        field = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else {
        field += ch;
      }
    }
    if (field !== '' || row.length) {
      row.push(field);
      rows.push(row);
    }
    return rows;
  }

  /** 產生 Excel 可直接開啟的 CSV（UTF-8 BOM、CRLF）。
   *  以 = + - @ 開頭的非數字內容前加 '，避免被 Excel 當成公式執行。 */
  function toCsv(header, rows) {
    const cell = v => {
      let s = String(v ?? '');
      if (/^[=+\-@\t\r]/.test(s) && !/^[-+]?\d+(\.\d+)?$/.test(s)) s = "'" + s;
      return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return '﻿' + [header, ...rows].map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
  }

  /* ---------- 讀取檔案 ---------- */

  function requireXlsx() {
    if (!global.XLSX) throw new E('IO_NO_XLSX', '找不到 Excel 函式庫（lib/xlsx.full.min.js）');
    return global.XLSX;
  }

  /** Excel 第一個工作表轉成二維陣列；raw:false 取顯示文字，保留 001 這類前置零 */
  function tableFromWorkbook(buffer) {
    const X = requireXlsx();
    const wb = X.read(buffer, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return X.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
  }

  /** 讀取使用者選擇的檔案，回傳二維陣列 */
  async function readTable(file) {
    const name = file.name.toLowerCase();
    const buffer = await file.arrayBuffer();
    if (/\.(csv|txt)$/.test(name)) return parseCsv(decodeText(buffer));
    if (/\.(xlsx|xlsm|xls)$/.test(name)) return tableFromWorkbook(buffer);
    throw new E('IO_BAD_TYPE', '只支援 .xlsx、.xls、.csv 檔案');
  }

  /* ---------- 員工名單匯入 ---------- */

  // 可辨識的欄位名稱（不分大小寫）
  const COLUMNS = {
    empNo: ['工號', '員工編號', '員工代號', '編號', 'id', 'empno', 'employee id'],
    name: ['姓名', '名字', '員工姓名', 'name'],
    department: ['部門', '單位', '部門名稱', 'department', 'dept'],
    active: ['參加', '是否參加', '參加抽獎', 'active']
  };
  const normHeader = h => clean(h).toLowerCase().replace(/\s+/g, ' ');

  function columnIndex(headerRow) {
    const cells = headerRow.map(normHeader);
    const idx = {};
    Object.entries(COLUMNS).forEach(([key, names]) => {
      const i = cells.findIndex(c => names.includes(c));
      if (i >= 0) idx[key] = i;
    });
    return idx;
  }

  /** 空白視為參加；否／N／0／不參加 等視為不參加 */
  function parseActive(v) {
    return !/^(否|不參加|n|no|0|false|x)$/i.test(clean(v));
  }

  /** 二維陣列 → 員工資料列。表頭可在前 10 列內（允許上方有標題列）。
   *  line 為檔案中的實際列號，方便使用者回頭修改。
   *  檔案沒有「參加」欄時 active 為 undefined，更新時不改動原設定。 */
  function tableToEmployees(table) {
    const headerAt = table.slice(0, 10).findIndex(r => {
      const idx = columnIndex(r);
      return idx.empNo !== undefined && idx.name !== undefined;
    });
    if (headerAt < 0) {
      const first = (table[0] || []).map(clean).filter(Boolean).join('、') || '（空白）';
      throw new E('IO_NO_HEADER', `找不到「工號」與「姓名」欄位。檔案第一列為：${first}`);
    }
    const idx = columnIndex(table[headerAt]);
    const get = (r, key) => (idx[key] === undefined ? '' : clean(r[idx[key]]));
    return table.slice(headerAt + 1).map((r, i) => ({
      line: headerAt + i + 2,
      empNo: get(r, 'empNo'),
      name: get(r, 'name'),
      department: get(r, 'department'),
      active: idx.active === undefined ? undefined : parseActive(r[idx.active])
    }));
  }

  /** 匯入預覽（不修改 state）：
   *  add 新增、update 資料有變、same 完全相同、errors 有問題的列（不會匯入）。
   *  檔案內工號重複的列全部列為錯誤，由使用者決定保留哪一筆。 */
  function planImport(state, rows) {
    const plan = { add: [], update: [], same: [], errors: [] };
    const lines = new Map();
    rows.forEach(r => {
      if (!r.empNo) return;
      const key = r.empNo.toUpperCase();
      lines.set(key, [...(lines.get(key) || []), r.line]);
    });
    rows.forEach(r => {
      if (!r.empNo && !r.name) return; // 空白列略過
      if (!r.empNo) return plan.errors.push({ line: r.line, row: r, reason: '缺少工號' });
      if (!r.name) return plan.errors.push({ line: r.line, row: r, reason: '缺少姓名' });
      const dup = lines.get(r.empNo.toUpperCase());
      if (dup.length > 1) {
        const others = dup.filter(l => l !== r.line).join('、');
        return plan.errors.push({ line: r.line, row: r, reason: `工號「${r.empNo}」與第 ${others} 列重複` });
      }
      const emp = LT.Employees.findByEmpNo(state, r.empNo);
      if (!emp) return plan.add.push(r);
      const active = r.active === undefined ? emp.active : r.active;
      if (emp.name !== r.name || emp.department !== r.department || emp.active !== active) {
        plan.update.push({ ...r, id: emp.id, before: { name: emp.name, department: emp.department, active: emp.active } });
      } else {
        plan.same.push(r);
      }
    });
    return plan;
  }

  /** 套用預覽結果（請在 store.mutate 內呼叫，任何一筆失敗即全部不套用） */
  function applyImport(state, plan) {
    plan.add.forEach(r => LT.Employees.add(state, r));
    plan.update.forEach(r => {
      const patch = { empNo: r.empNo, name: r.name, department: r.department };
      if (r.active !== undefined) patch.active = r.active;
      LT.Employees.update(state, r.id, patch);
    });
    return { added: plan.add.length, updated: plan.update.length };
  }

  /* ---------- 匯出 ---------- */

  const STATUS_TEXT = { valid: '有效', revoked: '已撤銷', forfeited: '已放棄' };
  const EMPLOYEE_HEADER = ['工號', '姓名', '部門', '參加'];

  function recordTable(state, { includeInvalid = true } = {}) {
    const list = LT.Draw.records(state).filter(d => includeInvalid || d.status === LT.Draw.VALID);
    return {
      header: ['序號', '獎項', '獎品', '工號', '姓名', '部門', '抽獎時間', '狀態', '狀態變更時間', '當時符合資格人數'],
      rows: list.map((d, i) => [
        i + 1, d.prizeTitle, d.prizeItem, d.empNo, d.empName, d.department,
        d.drawnAt, STATUS_TEXT[d.status], d.statusChangedAt || '', d.poolSize
      ])
    };
  }

  function employeeTable(state) {
    return {
      header: EMPLOYEE_HEADER,
      rows: state.employees.map(e => [e.empNo, e.name, e.department, e.active ? '是' : '否'])
    };
  }

  /** 匯入範本：示範同名不同工號、不參加的寫法 */
  function templateTable() {
    return {
      header: EMPLOYEE_HEADER,
      rows: [
        ['A001', '王小明', '業務部', '是'],
        ['A002', '王小明', '研發部', '是'],
        ['A003', '陳美玲', '管理部', '否']
      ]
    };
  }

  function tableToXlsx(table, sheetName = '工作表1') {
    const X = requireXlsx();
    const aoa = [table.header, ...table.rows];
    const ws = X.utils.aoa_to_sheet(aoa);
    ws['!cols'] = table.header.map((h, c) => ({
      wch: Math.min(40, Math.max(...aoa.map(r => String(r[c] ?? '').length)) * 2 + 2)
    }));
    const wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, ws, sheetName);
    return X.write(wb, { type: 'array', bookType: 'xlsx' });
  }

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /** format: 'xlsx' | 'csv'；filename 不含副檔名 */
  function exportTable(table, { format, filename, sheetName }) {
    if (format === 'csv') {
      download(new Blob([toCsv(table.header, table.rows)], { type: 'text/csv;charset=utf-8' }), filename + '.csv');
    } else {
      const type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      download(new Blob([tableToXlsx(table, sheetName)], { type }), filename + '.xlsx');
    }
  }

  /** 檔名用：移除 Windows 不允許的字元 */
  const safeName = s => clean(s).replace(/[\\/:*?"<>|]/g, '_') || '抽獎';
  /** 檔名用時間戳記 YYYYMMDD-HHmmss */
  const fileStamp = () => LT.now().replace(/-/g, '').replace(' ', '-').replace(/:/g, '');

  LT.IO = {
    decodeText, parseCsv, toCsv, tableFromWorkbook, readTable,
    tableToEmployees, planImport, applyImport,
    recordTable, employeeTable, templateTable, tableToXlsx, exportTable, download,
    safeName, fileStamp, STATUS_TEXT
  };
})(window);
