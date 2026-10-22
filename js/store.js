/* 資料存放：狀態結構、原子性寫入、持久化轉接器
 *
 * 狀態結構（對應原規劃的資料表）：
 * {
 *   version, settings: { eventName, allowRepeatGlobal, soundOn },
 *   employees: [{ id, empNo, name, department, active, createdAt, updatedAt }],
 *   prizes:    [{ id, order, title, item, quantity, batchSize, allowWinners, excluded:[員工id], createdAt }],
 *   draws:     [{ id, batchId, prizeId, employeeId, prizeTitle, prizeItem, empNo, empName, department,
 *                 poolSize, drawnAt, status:'valid'|'revoked'|'forfeited', statusChangedAt }],
 *   seq: { employee, prize, draw, batch }   // 流水號，刪除後不重用
 * }
 */
(function (global) {
  'use strict';
  const LT = global.LT;
  const SCHEMA_VERSION = 1;

  function emptyState() {
    return {
      version: SCHEMA_VERSION,
      settings: { eventName: '年度尾牙', allowRepeatGlobal: false, soundOn: true },
      employees: [],
      prizes: [],
      draws: [],
      seq: { employee: 0, prize: 0, draw: 0, batch: 0 }
    };
  }

  function nextId(state, kind) {
    state.seq[kind] += 1;
    return state.seq[kind];
  }

  /** 補齊舊資料缺少的欄位；版本不符則拒絕載入 */
  function normalize(raw) {
    if (!raw || typeof raw !== 'object') return emptyState();
    if (raw.version !== SCHEMA_VERSION) {
      throw new LT.LotteryError('BAD_VERSION', `資料版本不符（${raw.version}），無法載入`);
    }
    const base = emptyState();
    return {
      ...base,
      ...raw,
      settings: { ...base.settings, ...raw.settings },
      seq: { ...base.seq, ...raw.seq }
    };
  }

  function memoryAdapter(initial) {
    let saved = initial ? JSON.stringify(initial) : null;
    return {
      load: () => (saved ? JSON.parse(saved) : null),
      save: s => { saved = JSON.stringify(s); },
      get raw() { return saved; }
    };
  }

  function localStorageAdapter(key = 'lottery-data-v1') {
    return {
      load() {
        const text = global.localStorage.getItem(key);
        return text ? JSON.parse(text) : null;
      },
      save(s) { global.localStorage.setItem(key, JSON.stringify(s)); }
    };
  }

  /** 所有修改都經過 mutate：在副本上執行，存檔成功後才換成新狀態。
   *  中途出錯（驗證失敗、存檔失敗）時狀態與存檔都維持原樣。
   *  store.state 請視為唯讀。 */
  function createStore(adapter) {
    let state = normalize(adapter.load());
    const listeners = new Set();
    const commit = next => {
      adapter.save(next);
      state = next;
      listeners.forEach(fn => fn(state));
    };
    return {
      get state() { return state; },
      mutate(fn) {
        const draft = structuredClone(state);
        const result = fn(draft);
        commit(draft);
        return result;
      },
      replace(raw) { commit(normalize(raw)); },
      /** 重新讀取存檔（另一個視窗修改了資料時使用），不會寫入 */
      reload() {
        state = normalize(adapter.load());
        listeners.forEach(fn => fn(state));
      },
      subscribe(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      }
    };
  }

  LT.Store = {
    SCHEMA_VERSION, emptyState, nextId, normalize, createStore, memoryAdapter, localStorageAdapter
  };
})(window);
