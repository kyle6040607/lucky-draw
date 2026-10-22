/* 「名單」分頁：搜尋篩選、新增／編輯／刪除、參加開關、批次設定、匯入（預覽）與匯出 */
(function (global) {
  'use strict';
  const LT = global.LT, UI = LT.UI;
  const { Employees, IO } = LT;
  const esc = UI.esc;
  const MAX_ROWS = 500;

  let ctx, root;
  const filters = { q: '', dept: '', status: '' };

  /** 員工 id → 有效中獎的獎項名稱 */
  function winsByEmployee(state) {
    const map = new Map();
    state.draws.filter(d => d.status === LT.Draw.VALID).forEach(d => {
      map.set(d.employeeId, [...(map.get(d.employeeId) || []), d.prizeTitle]);
    });
    return map;
  }

  function filtered(state, wins) {
    const q = filters.q.toLowerCase();
    return state.employees.filter(e => {
      if (q && !e.empNo.toLowerCase().includes(q) && !e.name.toLowerCase().includes(q)) return false;
      if (filters.dept === '__none' ? e.department : (filters.dept && e.department !== filters.dept)) return false;
      switch (filters.status) {
        case 'active': return e.active;
        case 'inactive': return !e.active;
        case 'won': return wins.has(e.id);
        case 'notwon': return !wins.has(e.id);
        default: return true;
      }
    });
  }

  function mount(el, context) {
    ctx = context;
    root = el;
    el.innerHTML = `
      <div class="toolbar">
        <button class="btn primary" data-act="add">＋ 新增員工</button>
        <button class="btn" data-act="import">匯入名單</button>
        <button class="btn" data-act="template">下載匯入範本</button>
        <span class="spacer"></span>
        <button class="btn" data-act="export-xlsx">匯出 Excel</button>
        <button class="btn" data-act="export-csv">匯出 CSV</button>
      </div>
      <div class="toolbar filters">
        <input type="search" id="empSearch" placeholder="搜尋工號或姓名">
        <select id="empDept"></select>
        <select id="empStatus">
          <option value="">全部狀態</option>
          <option value="active">參加</option>
          <option value="inactive">不參加</option>
          <option value="won">已中獎</option>
          <option value="notwon">未中獎</option>
        </select>
        <span class="spacer"></span>
        <button class="btn small" data-act="bulk-on">篩選結果設為參加</button>
        <button class="btn small" data-act="bulk-off">篩選結果設為不參加</button>
      </div>
      <p class="summary" id="empSummary"></p>
      <div class="table-wrap" id="empTable"></div>`;
    el.querySelector('#empSearch').addEventListener('input', e => { filters.q = e.target.value.trim(); update(); });
    el.querySelector('#empDept').addEventListener('change', e => { filters.dept = e.target.value; update(); });
    el.querySelector('#empStatus').addEventListener('change', e => { filters.status = e.target.value; update(); });
    el.addEventListener('click', onClick);
    el.addEventListener('change', e => {
      const id = Number(e.target.dataset.toggle);
      if (id) UI.run(() => ctx.store.mutate(s => Employees.update(s, id, { active: e.target.checked })));
    });
  }

  function update() {
    const state = ctx.store.state;
    const wins = winsByEmployee(state);

    const depts = Employees.departments(state);
    if (filters.dept && filters.dept !== '__none' && !depts.includes(filters.dept)) filters.dept = '';
    const deptSel = root.querySelector('#empDept');
    deptSel.innerHTML = '<option value="">全部部門</option>' +
      depts.map(d => `<option value="${esc(d)}">${esc(d)}</option>`).join('') +
      '<option value="__none">（未填部門）</option>';
    deptSel.value = filters.dept;

    const list = filtered(state, wins);
    root.querySelector('#empSummary').innerHTML =
      `參加抽獎 <b>${Employees.activeCount(state)}</b> 人／名單共 ${state.employees.length} 人` +
      (list.length !== state.employees.length ? `（篩選後 ${list.length} 人）` : '');

    const box = root.querySelector('#empTable');
    if (!state.employees.length) {
      box.innerHTML = '<div class="card empty">名單是空的。請按「匯入名單」選擇 Excel／CSV 檔，或按「新增員工」手動輸入。</div>';
      return;
    }
    if (!list.length) {
      box.innerHTML = '<div class="card empty">沒有符合篩選條件的員工。</div>';
      return;
    }
    const nameCount = new Map();
    state.employees.forEach(e => nameCount.set(e.name, (nameCount.get(e.name) || 0) + 1));
    const rows = list.slice(0, MAX_ROWS).map(e => {
      const w = wins.get(e.id);
      return `<tr class="${e.active ? '' : 'inactive'}">
        <td class="mono">${esc(e.empNo)}</td>
        <td>${esc(e.name)}${nameCount.get(e.name) > 1 ? ' <span class="tag" title="名單中有同名的人，請以工號區分">同名</span>' : ''}</td>
        <td>${esc(e.department)}</td>
        <td class="center"><input type="checkbox" data-toggle="${e.id}" ${e.active ? 'checked' : ''} aria-label="參加抽獎"></td>
        <td>${w ? w.map(t => `<span class="tag gold">${esc(t)}</span>`).join(' ') : ''}</td>
        <td class="actions">
          <button class="btn small" data-act="edit" data-id="${e.id}">編輯</button>
          <button class="btn small danger-outline" data-act="del" data-id="${e.id}">刪除</button>
        </td></tr>`;
    }).join('');
    box.innerHTML = `<table class="grid">
      <thead><tr><th>工號</th><th>姓名</th><th>部門</th><th class="center">參加</th><th>中獎</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table>` +
      (list.length > MAX_ROWS ? `<p class="hint">只顯示前 ${MAX_ROWS} 人，請用搜尋或篩選縮小範圍。</p>` : '');
  }

  function onClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id = Number(btn.dataset.id);
    const s = () => ctx.store.state;
    const stamp = () => '員工名單_' + IO.fileStamp();
    const actions = {
      add: () => editDialog(null),
      edit: () => editDialog(id),
      del: () => removeEmployee(id),
      import: () => UI.runAsync(importFlow),
      template: () => IO.exportTable(IO.templateTable(), { format: 'xlsx', filename: '員工名單範本', sheetName: '名單' }),
      'export-xlsx': () => IO.exportTable(IO.employeeTable(s()), { format: 'xlsx', filename: stamp(), sheetName: '名單' }),
      'export-csv': () => IO.exportTable(IO.employeeTable(s()), { format: 'csv', filename: stamp() }),
      'bulk-on': () => bulk(true),
      'bulk-off': () => bulk(false)
    };
    UI.run(actions[btn.dataset.act]);
  }

  function editDialog(id) {
    const state = ctx.store.state;
    const emp = id ? Employees.find(state, id) : { empNo: '', name: '', department: '', active: true };
    const body = `
      <label class="field"><span>工號 *</span><input name="empNo" value="${esc(emp.empNo)}" maxlength="30" autocomplete="off"></label>
      <label class="field"><span>姓名 *</span><input name="name" value="${esc(emp.name)}" maxlength="30" autocomplete="off"></label>
      <label class="field"><span>部門</span><input name="department" value="${esc(emp.department)}" list="deptOptions" maxlength="30" autocomplete="off"></label>
      <datalist id="deptOptions">${Employees.departments(state).map(d => `<option value="${esc(d)}">`).join('')}</datalist>
      <label class="check"><input type="checkbox" name="active" ${emp.active ? 'checked' : ''}> 參加抽獎</label>
      ${id && Employees.hasDraws(state, id) ? '<p class="hint">此員工已有抽獎紀錄；修改資料不會改變已抽出的紀錄。</p>' : ''}`;

    const save = (bodyEl, keepOpen) => {
      const data = UI.formData(bodyEl);
      const ok = UI.run(() => ctx.store.mutate(s => (id ? Employees.update(s, id, data) : Employees.add(s, data))));
      if (!ok) return false;
      UI.toast(id ? `已儲存 ${data.name.trim()}` : `已新增 ${data.name.trim()}`);
      if (keepOpen) {
        bodyEl.querySelector('[name=empNo]').value = '';
        bodyEl.querySelector('[name=name]').value = '';
        bodyEl.querySelector('[name=empNo]').focus();
        return false;
      }
      return true;
    };
    const buttons = [{ text: '取消' }];
    if (!id) buttons.push({ text: '新增並繼續', onClick: b => save(b, true) });
    buttons.push({ text: id ? '儲存' : '新增', kind: 'primary', onClick: b => save(b, false) });
    UI.modal({ title: id ? '編輯員工' : '新增員工', body, buttons });
  }

  async function removeEmployee(id) {
    const emp = Employees.find(ctx.store.state, id);
    if (!await UI.confirm(`確定刪除「${emp.name}」（工號 ${emp.empNo}）？`, { danger: true, okText: '刪除' })) return;
    UI.run(() => ctx.store.mutate(s => Employees.remove(s, id)), `已刪除 ${emp.name}`);
  }

  async function bulk(active) {
    const state = ctx.store.state;
    const targets = filtered(state, winsByEmployee(state)).filter(e => e.active !== active);
    const word = active ? '參加' : '不參加';
    if (!targets.length) return UI.toast(`篩選結果中沒有需要改為「${word}」的人`, 'warn');
    if (!await UI.confirm(`將 ${targets.length} 人設為「${word}」？`)) return;
    UI.run(() => ctx.store.mutate(s => targets.forEach(e => Employees.update(s, e.id, { active }))),
      `已將 ${targets.length} 人設為「${word}」`);
  }

  async function importFlow() {
    const file = await UI.pickFile('.xlsx,.xls,.xlsm,.csv');
    if (!file) return;
    const plan = IO.planImport(ctx.store.state, IO.tableToEmployees(await IO.readTable(file)));
    const changes = plan.add.length + plan.update.length;
    const show = 200;
    const errors = plan.errors.length
      ? '<h3 class="err">有問題的列（不會匯入，請修改檔案後重新匯入）</h3>' +
        UI.table(['列號', '工號', '姓名', '原因'], plan.errors.slice(0, show).map(x => [x.line, x.row.empNo, x.row.name, x.reason]))
      : '';
    const active = v => (v ? '參加' : '不參加');
    const updates = plan.update.length
      ? '<h3>將更新的資料</h3>' + UI.table(['工號', '原本', '更新為'], plan.update.slice(0, show).map(u => [
        u.empNo,
        `${u.before.name}／${u.before.department || '—'}／${active(u.before.active)}`,
        `${u.name}／${u.department || '—'}／${active(u.active === undefined ? u.before.active : u.active)}`
      ]))
      : '';
    UI.modal({
      title: `匯入預覽：${file.name}`,
      wide: true,
      body: `<p class="summary">新增 <b>${plan.add.length}</b> 人、更新 <b>${plan.update.length}</b> 人、` +
        `資料相同 ${plan.same.length} 人、<span class="${plan.errors.length ? 'err' : ''}">有問題 ${plan.errors.length} 列</span></p>` +
        (changes ? '' : '<p class="hint">沒有需要新增或更新的資料。</p>') +
        '<p class="hint">已在名單中的人以工號比對；檔案中沒有的人不會被刪除。</p>' +
        errors + updates,
      buttons: [
        { text: '取消' },
        {
          text: changes ? `確認匯入（新增 ${plan.add.length}、更新 ${plan.update.length}）` : '確認匯入',
          kind: 'primary',
          disabled: !changes,
          onClick: () => {
            let r;
            if (!UI.run(() => { r = ctx.store.mutate(s => IO.applyImport(s, plan)); })) return false;
            UI.toast(`匯入完成：新增 ${r.added} 人、更新 ${r.updated} 人`);
          }
        }
      ]
    });
  }

  LT.EmployeeTab = { mount, update };
})(window);
