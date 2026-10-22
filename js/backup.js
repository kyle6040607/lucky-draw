/* 備份：JSON 備份檔匯出／匯入，以及「自動存檔到指定檔案」。
 * 瀏覽器內的 localStorage 是主要存檔；這裡提供第二份保險與換電腦搬移用。 */
(function (global) {
  'use strict';
  const LT = global.LT;
  const E = LT.LotteryError;
  const KIND = 'lottery-backup';

  function toBackupText(state) {
    return JSON.stringify({ kind: KIND, exportedAt: LT.now(), data: state }, null, 2);
  }

  /** 解析備份檔，回傳可直接交給 store.replace 的狀態 */
  function parseBackupText(text) {
    let obj;
    try {
      obj = JSON.parse(text);
    } catch (e) {
      throw new E('BACKUP_BAD_JSON', '備份檔格式錯誤，無法讀取');
    }
    const data = obj && obj.kind === KIND ? obj.data : obj;
    if (!data || !Array.isArray(data.employees) || !Array.isArray(data.prizes) || !Array.isArray(data.draws)) {
      throw new E('BACKUP_BAD_DATA', '這不是抽獎系統的備份檔');
    }
    return LT.Store.normalize(data);
  }

  function backupFilename(state) {
    return `抽獎備份_${LT.IO.safeName(state.settings.eventName)}_${LT.IO.fileStamp()}.json`;
  }

  function downloadBackup(state) {
    LT.IO.download(new Blob([toBackupText(state)], { type: 'application/json' }), backupFilename(state));
  }

  /* 記住自動存檔的檔案（存在 IndexedDB），重新開啟頁面時不必再選一次 */
  const IDB_NAME = 'lottery-filesync', IDB_STORE = 'handles', HANDLE_KEY = 'main';
  function idb(mode, fn) {
    return new Promise((resolve, reject) => {
      const open = global.indexedDB.open(IDB_NAME, 1);
      open.onupgradeneeded = () => open.result.createObjectStore(IDB_STORE);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        try {
          const tx = db.transaction(IDB_STORE, mode);
          const req = fn(tx.objectStore(IDB_STORE));
          tx.oncomplete = () => { db.close(); resolve(req && req.result); };
          tx.onerror = () => { db.close(); reject(tx.error); };
        } catch (e) {
          db.close();
          reject(e);
        }
      };
    });
  }

  /** 每次資料變動後自動寫入使用者選定的 .json 檔（Chrome／Edge 的 File System Access API）。
   *  寫入依序進行；連續變動只寫最新狀態。
   *  status：'off' 未設定、'on' 自動存檔中、'paused' 記得檔案但需使用者點一下恢復權限
   *  （瀏覽器規定重新開啟頁面後要再授權一次；寫入失敗也會變成 paused）。 */
  function createFileSync(store, { onChange, onError } = {}) {
    let handle = null;     // 已取得權限、正在寫入的檔案
    let remembered = null; // 記住的檔案
    let pending = null;
    let running = null;    // 寫入中的 Promise，同一時間只有一個
    let lastSaved = null;
    const notify = () => { if (onChange) onChange(api); };

    function flush() {
      if (!running) {
        running = (async () => {
          try {
            while (handle && pending) {
              const state = pending;
              pending = null;
              const w = await handle.createWritable();
              await w.write(toBackupText(state));
              await w.close();
              lastSaved = LT.now();
              notify();
            }
          } catch (e) {
            handle = null;
            notify();
            if (onError) onError(e);
          } finally {
            running = null;
          }
        })();
      }
      return running;
    }

    store.subscribe(state => {
      if (!handle) return;
      pending = state;
      flush();
    });

    const api = {
      supported: typeof global.showSaveFilePicker === 'function',
      get status() { return handle ? 'on' : remembered ? 'paused' : 'off'; },
      get fileName() { return remembered ? remembered.name : null; },
      get lastSaved() { return lastSaved; },
      /** 頁面開啟時呼叫：找回上次的檔案，若仍有權限就直接恢復 */
      async init() {
        if (!api.supported) return;
        try {
          const h = await idb('readonly', s => s.get(HANDLE_KEY));
          if (h) {
            remembered = h;
            if ((await h.queryPermission({ mode: 'readwrite' })) === 'granted') {
              handle = h;
              pending = store.state;
              flush();
            }
          }
        } catch (e) {
          // 讀不到記住的檔案時視為未設定
        }
        notify();
      },
      async choose() {
        const h = await global.showSaveFilePicker({
          suggestedName: backupFilename(store.state),
          types: [{ description: '抽獎資料', accept: { 'application/json': ['.json'] } }]
        });
        handle = remembered = h;
        try { await idb('readwrite', s => s.put(h, HANDLE_KEY)); } catch (e) { /* 記不住只是下次要重選 */ }
        pending = store.state;
        await flush();
        notify();
        return h.name;
      },
      /** 恢復記住的檔案（需由使用者點擊觸發） */
      async resume() {
        if (!remembered) throw new E('SYNC_NONE', '尚未設定自動存檔檔案');
        if ((await remembered.requestPermission({ mode: 'readwrite' })) !== 'granted') {
          throw new E('SYNC_DENIED', '未取得檔案寫入權限，自動存檔未啟用');
        }
        handle = remembered;
        pending = store.state;
        await flush();
        notify();
      },
      /** 等待目前所有寫入完成 */
      async whenIdle() {
        while (running) await running;
      },
      async disconnect() {
        handle = remembered = null;
        pending = null;
        try { await idb('readwrite', s => s.delete(HANDLE_KEY)); } catch (e) { /* 忽略 */ }
        notify();
      }
    };
    return api;
  }

  LT.Backup = { toBackupText, parseBackupText, backupFilename, downloadBackup, createFileSync };
})(window);
