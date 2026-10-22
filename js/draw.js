/* 抽獎邏輯：資格池計算、隨機抽選、撤銷、放棄。
 *
 * 規則：
 * - 資格池 = 啟用中的員工
 *          − 本獎項排除名單
 *          − 本獎項已中獎或已放棄的人（同一獎項不會中兩次）
 *          −（本獎項不開放已中獎者時）任何獎項有「有效」中獎紀錄的人
 * - 「放棄」只讓出本獎項的名額，該員工仍可參加其他獎項。
 * - 「撤銷」用於操作失誤：名額與資格都恢復，紀錄保留為 revoked。
 * - 中獎者在呼叫 draw 的當下才決定（UI 應在按下「停止」時呼叫），
 *   輪播畫面停在哪個名字不影響結果。 */
(function (global) {
  'use strict';
  const LT = global.LT;
  const E = LT.LotteryError;
  const VALID = 'valid', REVOKED = 'revoked', FORFEITED = 'forfeited';

  function allowsWinners(state, prize) {
    return !!state.settings.allowRepeatGlobal || prize.allowWinners;
  }

  function eligiblePool(state, prizeId) {
    const prize = LT.Prizes.find(state, prizeId);
    const excluded = new Set(prize.excluded);
    const samePrize = new Set(state.draws
      .filter(d => d.prizeId === prizeId && d.status !== REVOKED)
      .map(d => d.employeeId));
    const winners = allowsWinners(state, prize)
      ? new Set()
      : new Set(state.draws.filter(d => d.status === VALID).map(d => d.employeeId));
    return state.employees.filter(e =>
      e.active && !excluded.has(e.id) && !samePrize.has(e.id) && !winners.has(e.id));
  }

  function remaining(state, prizeId) {
    return LT.Prizes.find(state, prizeId).quantity - LT.Prizes.validCount(state, prizeId);
  }

  /** 抽獎前檢查，供畫面顯示提示。
   *  回傳 { ok, code, message, remaining, poolSize, count, shortfall } */
  function check(state, prizeId) {
    const prize = LT.Prizes.find(state, prizeId);
    const left = remaining(state, prizeId);
    const poolSize = eligiblePool(state, prizeId).length;
    const want = Math.min(prize.batchSize, left);
    const count = Math.min(want, poolSize);
    const base = { remaining: left, poolSize, count, shortfall: false };
    if (left <= 0) {
      return { ...base, ok: false, code: 'PRIZE_DONE',
        message: `「${prize.title}」已全部抽出（共 ${prize.quantity} 名）` };
    }
    if (poolSize === 0) {
      return { ...base, ok: false, code: 'NO_ELIGIBLE',
        message: `「${prize.title}」目前沒有符合資格的人員（可能都已中獎或被排除）` };
    }
    if (count < want) {
      return { ...base, ok: true, code: 'SHORTFALL', shortfall: true,
        message: `符合資格的人只剩 ${poolSize} 位，本次只能抽出 ${count} 名` };
    }
    return { ...base, ok: true, code: 'OK', message: '' };
  }

  /** 執行一次抽獎（一次抽出 batchSize 名，不足時以實際可抽數為準） */
  function draw(state, prizeId, rng = LT.Random) {
    const prize = LT.Prizes.find(state, prizeId);
    const status = check(state, prizeId);
    if (!status.ok) throw new E(status.code, status.message);
    const pool = eligiblePool(state, prizeId);
    const picked = rng.sample(pool, status.count);
    const batchId = LT.Store.nextId(state, 'batch');
    const drawnAt = LT.now();
    const records = picked.map(emp => {
      const rec = {
        id: LT.Store.nextId(state, 'draw'),
        batchId,
        prizeId,
        employeeId: emp.id,
        prizeTitle: prize.title,
        prizeItem: prize.item,
        empNo: emp.empNo,
        empName: emp.name,
        department: emp.department,
        poolSize: pool.length,
        drawnAt,
        status: VALID,
        statusChangedAt: null
      };
      state.draws.push(rec);
      return rec;
    });
    return { records, check: status };
  }

  /** 最近一批仍有效的中獎紀錄（撤銷前先給使用者確認） */
  function lastBatch(state) {
    const valid = state.draws.filter(d => d.status === VALID);
    if (!valid.length) return [];
    const batchId = Math.max(...valid.map(d => d.batchId));
    return valid.filter(d => d.batchId === batchId);
  }

  function undoLast(state) {
    const batch = lastBatch(state);
    if (!batch.length) throw new E('NOTHING_TO_UNDO', '目前沒有可撤銷的抽獎結果');
    const ids = new Set(batch.map(d => d.id));
    const t = LT.now();
    state.draws.forEach(d => {
      if (ids.has(d.id)) { d.status = REVOKED; d.statusChangedAt = t; }
    });
    return batch.map(d => state.draws.find(x => x.id === d.id));
  }

  /** 中獎人不在現場：放棄名額，可再為本獎項重抽 */
  function forfeit(state, drawId) {
    const rec = state.draws.find(d => d.id === drawId);
    if (!rec) throw new E('DRAW_NOT_FOUND', '找不到此筆抽獎紀錄');
    if (rec.status !== VALID) throw new E('DRAW_NOT_VALID', '只有有效的中獎紀錄可以設為放棄');
    rec.status = FORFEITED;
    rec.statusChangedAt = LT.now();
    return rec;
  }

  /** 依順序第一個還有名額的獎項；全部抽完回傳 null */
  function nextPrize(state) {
    return LT.Prizes.sorted(state).find(p => remaining(state, p.id) > 0) || null;
  }

  function records(state) {
    return state.draws.slice().sort((a, b) => a.id - b.id);
  }

  /** 清除全部抽獎紀錄（彩排結束後使用），名單與獎項保留；回傳清除筆數 */
  function clearRecords(state) {
    const n = state.draws.length;
    state.draws = [];
    return n;
  }

  LT.Draw = {
    VALID, REVOKED, FORFEITED,
    eligiblePool, remaining, check, draw, lastBatch, undoLast, forfeit, nextPrize, records, clearRecords
  };
})(window);
