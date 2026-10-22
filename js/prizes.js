/* 獎項管理：新增、修改、刪除、排序、資格排除名單。
 * 所有函式直接修改傳入的 state，請透過 store.mutate 呼叫。 */
(function (global) {
  'use strict';
  const LT = global.LT;
  const E = LT.LotteryError;
  const clean = LT.clean;

  function find(state, id) {
    const prize = state.prizes.find(x => x.id === id);
    if (!prize) throw new E('PRIZE_NOT_FOUND', '找不到此獎項');
    return prize;
  }

  function sorted(state) {
    return state.prizes.slice().sort((a, b) => a.order - b.order);
  }

  /** 本獎項目前有效（未撤銷、未放棄）的中獎數 */
  function validCount(state, prizeId) {
    return state.draws.filter(d => d.prizeId === prizeId && d.status === 'valid').length;
  }

  function validate(data) {
    const title = clean(data.title);
    const item = clean(data.item);
    const quantity = Number(data.quantity);
    const batchSize = Number(data.batchSize ?? 1);
    if (!title) throw new E('PRIZE_TITLE_REQUIRED', '獎項名稱不可空白');
    if (!item) throw new E('PRIZE_ITEM_REQUIRED', '獎品名稱不可空白');
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new E('PRIZE_BAD_QUANTITY', '獎品數量必須是 1 以上的整數');
    }
    if (!Number.isInteger(batchSize) || batchSize < 1) {
      throw new E('PRIZE_BAD_BATCH', '每次抽出人數必須是 1 以上的整數');
    }
    return { title, item, quantity, batchSize, allowWinners: !!data.allowWinners };
  }

  function add(state, data) {
    const fields = validate(data);
    const prize = {
      id: LT.Store.nextId(state, 'prize'),
      order: state.prizes.reduce((m, p) => Math.max(m, p.order), 0) + 1,
      ...fields,
      excluded: [],
      createdAt: LT.now()
    };
    state.prizes.push(prize);
    return prize;
  }

  function update(state, id, patch) {
    const prize = find(state, id);
    const fields = validate({ ...prize, ...patch });
    const drawn = validCount(state, id);
    if (fields.quantity < drawn) {
      throw new E('PRIZE_QTY_BELOW_DRAWN', `此獎項已抽出 ${drawn} 名，數量不可少於 ${drawn}`);
    }
    Object.assign(prize, fields);
    return prize;
  }

  function remove(state, id) {
    find(state, id);
    if (state.draws.some(d => d.prizeId === id)) {
      throw new E('PRIZE_HAS_DRAWS', '此獎項已有抽獎紀錄，無法刪除');
    }
    state.prizes = state.prizes.filter(x => x.id !== id);
    sorted(state).forEach((p, i) => { p.order = i + 1; });
  }

  /** 與前一個（delta=-1）或後一個（delta=1）獎項交換順序 */
  function move(state, id, delta) {
    const list = sorted(state);
    const i = list.findIndex(p => p.id === id);
    if (i < 0) throw new E('PRIZE_NOT_FOUND', '找不到此獎項');
    const j = i + delta;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    list.forEach((p, k) => { p.order = k + 1; });
  }

  function isExcluded(prize, employeeId) {
    return prize.excluded.includes(employeeId);
  }

  function setExcluded(state, prizeId, employeeId, excluded) {
    const prize = find(state, prizeId);
    LT.Employees.find(state, employeeId);
    const has = isExcluded(prize, employeeId);
    if (excluded && !has) prize.excluded.push(employeeId);
    if (!excluded && has) prize.excluded = prize.excluded.filter(x => x !== employeeId);
  }

  /** 整個部門一次設定排除／取消排除，回傳受影響人數 */
  function setDepartmentExcluded(state, prizeId, department, excluded) {
    const targets = state.employees.filter(e => e.department === department);
    targets.forEach(e => setExcluded(state, prizeId, e.id, excluded));
    return targets.length;
  }

  function clearExcluded(state, prizeId) {
    find(state, prizeId).excluded = [];
  }

  LT.Prizes = {
    find, sorted, validCount, add, update, remove, move,
    isExcluded, setExcluded, setDepartmentExcluded, clearExcluded
  };
})(window);
