/* 名單管理：新增、修改、刪除、停用。工號為唯一識別（不分大小寫）。
 * 所有函式直接修改傳入的 state，請透過 store.mutate 呼叫。 */
(function (global) {
  'use strict';
  const LT = global.LT;
  const E = LT.LotteryError;
  const clean = LT.clean;

  function find(state, id) {
    const emp = state.employees.find(x => x.id === id);
    if (!emp) throw new E('EMP_NOT_FOUND', '找不到此員工');
    return emp;
  }

  function findByEmpNo(state, empNo) {
    const key = clean(empNo).toUpperCase();
    return state.employees.find(x => x.empNo.toUpperCase() === key);
  }

  function validate(state, data, selfId) {
    const empNo = clean(data.empNo);
    const name = clean(data.name);
    if (!empNo) throw new E('EMP_NO_REQUIRED', '工號不可空白');
    if (!name) throw new E('EMP_NAME_REQUIRED', '姓名不可空白');
    const dup = findByEmpNo(state, empNo);
    if (dup && dup.id !== selfId) {
      throw new E('EMP_NO_DUPLICATE', `工號「${empNo}」已被「${dup.name}」使用`);
    }
    return { empNo, name, department: clean(data.department) };
  }

  function add(state, data) {
    const fields = validate(state, data, null);
    const t = LT.now();
    const emp = {
      id: LT.Store.nextId(state, 'employee'),
      ...fields,
      active: data.active !== false,
      createdAt: t,
      updatedAt: t
    };
    state.employees.push(emp);
    return emp;
  }

  function update(state, id, patch) {
    const emp = find(state, id);
    const fields = validate(state, { ...emp, ...patch }, id);
    Object.assign(emp, fields, { updatedAt: LT.now() });
    if ('active' in patch) emp.active = !!patch.active;
    return emp;
  }

  function hasDraws(state, id) {
    return state.draws.some(d => d.employeeId === id);
  }

  /** 有任何抽獎紀錄（含已撤銷）的員工不可刪除，以保留稽核軌跡 */
  function remove(state, id) {
    find(state, id);
    if (hasDraws(state, id)) {
      throw new E('EMP_HAS_DRAWS', '此員工已有抽獎紀錄，無法刪除；如不參加請改為「停用」');
    }
    state.employees = state.employees.filter(x => x.id !== id);
    state.prizes.forEach(p => { p.excluded = p.excluded.filter(x => x !== id); });
  }

  function activeCount(state) {
    return state.employees.filter(e => e.active).length;
  }

  function departments(state) {
    return [...new Set(state.employees.map(e => e.department).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'zh-Hant'));
  }

  LT.Employees = { find, findByEmpNo, add, update, remove, hasDraws, activeCount, departments };
})(window);
