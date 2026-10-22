/* 主程式：載入資料、上方列、分頁切換、自動存檔狀態、多視窗同步 */
(function (global) {
  'use strict';
  const LT = global.LT, UI = LT.UI;
  const esc = UI.esc;
  const STORAGE_KEY = 'lottery-data-v1';
  const TAB_KEY = 'lottery-ui-tab';

  const TABS = [
    { id: 'draw', title: '抽獎', module: () => LT.DrawTab },
    { id: 'employees', title: '名單', module: () => LT.EmployeeTab },
    { id: 'prizes', title: '獎項', module: () => LT.PrizeTab },
    { id: 'records', title: '紀錄', module: () => LT.RecordsTab },
    { id: 'settings', title: '設定', module: () => LT.SettingsTab }
  ];

  const memory = {
    get(key) { try { return localStorage.getItem(key); } catch (e) { return null; } },
    set(key, v) { try { localStorage.setItem(key, v); } catch (e) { /* 忽略 */ } }
  };

  let ctx, current;

  function boot() {
    let store;
    try {
      store = LT.Store.createStore(LT.Store.localStorageAdapter(STORAGE_KEY));
    } catch (e) {
      showLoadError(e);
      return;
    }
    const sync = LT.Backup.createFileSync(store, {
      onChange: renderSync,
      onError: e => UI.toast(`自動存檔失敗：${e.message}。資料仍保存在瀏覽器中，請到右上角重新設定。`, 'error')
    });
    ctx = { store, sync, switchTab, refresh };

    document.getElementById('tabs').innerHTML = TABS.map(t =>
      `<button data-tab="${t.id}">${t.title}</button>`).join('');
    document.getElementById('panels').innerHTML = TABS.map(t =>
      `<section class="panel" id="tab-${t.id}" hidden></section>`).join('');
    TABS.forEach(t => t.module().mount(document.getElementById('tab-' + t.id), ctx));

    document.getElementById('tabs').addEventListener('click', e => {
      const b = e.target.closest('[data-tab]');
      if (b) switchTab(b.dataset.tab);
    });
    document.getElementById('syncChip').addEventListener('click', onSyncChip);

    store.subscribe(refresh);
    // 同一台電腦開了兩個視窗時，另一邊的修改會即時同步過來
    global.addEventListener('storage', e => {
      if (e.key !== STORAGE_KEY || !e.newValue) return;
      store.reload();
      UI.toast('資料已在另一個視窗變更，已同步更新。建議只開一個視窗操作。', 'warn');
    });

    const saved = memory.get(TAB_KEY);
    const first = TABS.some(t => t.id === saved) ? saved : (store.state.employees.length ? 'draw' : 'employees');
    switchTab(first);
    renderSync();
    sync.init().then(() => {
      if (sync.status === 'paused') UI.toast(`請點右上角「恢復自動存檔」繼續存到 ${sync.fileName}`, 'warn');
    });
  }

  function switchTab(id) {
    current = TABS.find(t => t.id === id) || TABS[0];
    memory.set(TAB_KEY, current.id);
    document.querySelectorAll('#tabs [data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === current.id));
    TABS.forEach(t => { document.getElementById('tab-' + t.id).hidden = t !== current; });
    refresh();
  }

  function refresh() {
    const s = ctx.store.state;
    document.getElementById('eventName').textContent = s.settings.eventName;
    document.title = `${s.settings.eventName}｜抽獎系統`;
    document.getElementById('poolChip').textContent = `參加 ${LT.Employees.activeCount(s)} 人`;
    if (current) current.module().update(s);
  }

  function renderSync() {
    const chip = document.getElementById('syncChip');
    const sync = ctx.sync;
    if (!sync.supported) {
      chip.className = 'chip';
      chip.textContent = '資料存在瀏覽器';
      chip.title = '此瀏覽器不支援自動存檔到檔案，請定期到「設定」下載備份';
    } else if (sync.status === 'on') {
      chip.className = 'chip ok';
      chip.textContent = `✔ 自動存檔：${sync.fileName}`;
      chip.title = sync.lastSaved ? `最後寫入 ${sync.lastSaved}` : '';
    } else if (sync.status === 'paused') {
      chip.className = 'chip warn';
      chip.textContent = `⚠ 恢復自動存檔：${sync.fileName}`;
      chip.title = '瀏覽器需要您點一下才能繼續寫入這個檔案';
    } else {
      chip.className = 'chip warn';
      chip.textContent = '⚠ 尚未設定自動存檔';
      chip.title = '建議選一個檔案（例如隨身碟），每次變動都會自動寫入';
    }
    if (current && current.id === 'settings') current.module().update(ctx.store.state);
  }

  function onSyncChip() {
    const sync = ctx.sync;
    if (!sync.supported || sync.status === 'on') return switchTab('settings');
    UI.runAsync(async () => {
      if (sync.status === 'paused') {
        await sync.resume();
      } else {
        await sync.choose();
      }
      UI.toast(`已開始自動存檔到 ${sync.fileName}`);
    });
  }

  /** 存檔損毀或版本不符：提供還原、下載原始資料、清空重來 */
  function showLoadError(err) {
    const raw = memory.get(STORAGE_KEY);
    document.getElementById('panels').innerHTML = `
      <div class="card fatal">
        <h2>無法載入抽獎資料</h2>
        <p>${esc(err.message)}</p>
        <p>您可以從備份檔還原；或先下載目前的原始資料保存，再清空重來。</p>
        <div class="toolbar">
          <button class="btn primary" id="fatalRestore">從備份還原</button>
          <button class="btn" id="fatalDownload">下載原始資料</button>
          <button class="btn danger" id="fatalReset">清空重來</button>
        </div>
      </div>`;
    document.getElementById('fatalRestore').onclick = () => UI.runAsync(async () => {
      const file = await UI.pickFile('.json');
      if (!file) return;
      const data = LT.Backup.parseBackupText(await file.text());
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      location.reload();
    });
    document.getElementById('fatalDownload').onclick = () =>
      LT.IO.download(new Blob([raw || ''], { type: 'application/json' }), `抽獎原始資料_${LT.IO.fileStamp()}.json`);
    document.getElementById('fatalReset').onclick = async () => {
      if (!await UI.confirm('確定清空全部資料重新開始？建議先按「下載原始資料」保存。', { danger: true, okText: '清空' })) return;
      localStorage.removeItem(STORAGE_KEY);
      location.reload();
    };
  }

  LT.DrawTab = UI.placeholder('抽獎畫面將在第 4 階段製作。');
  LT.RecordsTab = UI.placeholder('抽獎紀錄頁將在第 5 階段製作。');
  LT.App = { boot };
})(window);
