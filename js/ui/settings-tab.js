/* 「設定」分頁：活動名稱、抽獎規則、音效、備份與自動存檔、清除資料 */
(function (global) {
  'use strict';
  const LT = global.LT, UI = LT.UI;
  const { Backup, Draw, Store } = LT;
  const esc = UI.esc;

  let ctx, root;

  function mount(el, context) {
    ctx = context;
    root = el;
    el.innerHTML = `
      <section class="card">
        <h2>活動</h2>
        <label class="field"><span>活動名稱</span><input id="setEventName" maxlength="40"></label>
        <p class="hint">顯示在畫面上方與抽獎畫面，也會用在備份檔名。</p>
      </section>

      <section class="card">
        <h2>抽獎規則</h2>
        <label class="check"><input type="checkbox" id="setRepeat"> 全場允許重複中獎</label>
        <p class="hint">預設關閉：每人整場只能中獎一次。若只想讓特定獎項（例如加碼獎）開放給已中獎者，
          請到「獎項」個別勾選，不需要開啟這個選項。</p>
        <label class="check"><input type="checkbox" id="setSound"> 播放音效</label>
      </section>

      <section class="card">
        <h2>資料備份</h2>
        <p class="hint">資料會自動保存在這台電腦的瀏覽器中。建議另外設定「自動存檔」到桌面或隨身碟的檔案，
          萬一瀏覽器資料被清除，或要換到活動現場的電腦，都可以用這個檔案還原。</p>
        <div id="syncBox"></div>
        <div class="toolbar">
          <button class="btn" data-act="backup">下載備份</button>
          <button class="btn" data-act="restore">從備份還原</button>
        </div>
      </section>

      <section class="card danger-zone">
        <h2>清除資料</h2>
        <div class="toolbar">
          <button class="btn danger" data-act="clear-draws">清除抽獎紀錄</button>
          <span class="hint">彩排結束後使用：刪除所有抽獎紀錄，名單與獎項保留。</span>
        </div>
        <div class="toolbar">
          <button class="btn danger" data-act="clear-all">全部清空</button>
          <span class="hint">開新活動時使用：刪除名單、獎項與紀錄。</span>
        </div>
        <p class="hint">執行前都會先自動下載一份備份。</p>
      </section>`;

    el.querySelector('#setEventName').addEventListener('change', e => {
      const name = LT.clean(e.target.value) || '年度尾牙';
      UI.run(() => ctx.store.mutate(s => { s.settings.eventName = name; }), '已更新活動名稱');
    });
    el.querySelector('#setRepeat').addEventListener('change', e => setRepeat(e.target));
    el.querySelector('#setSound').addEventListener('change', e => {
      const on = e.target.checked;
      UI.run(() => ctx.store.mutate(s => { s.settings.soundOn = on; }), on ? '已開啟音效' : '已關閉音效');
    });
    el.addEventListener('click', onClick);
  }

  function update() {
    const s = ctx.store.state;
    const name = root.querySelector('#setEventName');
    if (document.activeElement !== name) name.value = s.settings.eventName;
    root.querySelector('#setRepeat').checked = !!s.settings.allowRepeatGlobal;
    root.querySelector('#setSound').checked = !!s.settings.soundOn;

    const sync = ctx.sync;
    let html;
    if (!sync.supported) {
      html = '<p class="warn-text">此瀏覽器不支援自動存檔到檔案，請改用 Chrome 或 Edge，或定期按「下載備份」。</p>';
    } else if (sync.status === 'on') {
      html = `<p class="ok-text">✔ 自動存檔中：<b>${esc(sync.fileName)}</b>${sync.lastSaved ? `（最後寫入 ${esc(sync.lastSaved)}）` : ''}</p>
        <div class="toolbar"><button class="btn" data-act="sync-choose">改存到其他檔案</button>
        <button class="btn" data-act="sync-stop">停止自動存檔</button></div>`;
    } else if (sync.status === 'paused') {
      html = `<p class="warn-text">⚠ 自動存檔暫停：<b>${esc(sync.fileName)}</b>（瀏覽器需要您點一下才能繼續寫入）</p>
        <div class="toolbar"><button class="btn primary" data-act="sync-resume">恢復自動存檔</button>
        <button class="btn" data-act="sync-choose">改存到其他檔案</button>
        <button class="btn" data-act="sync-stop">停止自動存檔</button></div>`;
    } else {
      html = `<p class="warn-text">⚠ 尚未設定自動存檔</p>
        <div class="toolbar"><button class="btn primary" data-act="sync-choose">選擇自動存檔檔案</button></div>`;
    }
    root.querySelector('#syncBox').innerHTML = html;
  }

  async function setRepeat(cb) {
    const on = cb.checked;
    const s = ctx.store.state;
    if (s.draws.some(d => d.status === Draw.VALID)) {
      const ok = await UI.confirm(on
        ? '已經有人中獎。開啟後，已中獎的人在之後的獎項也可能再被抽中，確定開啟？'
        : '已經有人中獎。關閉後，已中獎的人在之後的獎項不會再被抽中（已抽出的結果不變），確定關閉？');
      if (!ok) {
        cb.checked = !on;
        return;
      }
    }
    UI.run(() => ctx.store.mutate(st => { st.settings.allowRepeatGlobal = on; }),
      on ? '已開啟：全場允許重複中獎' : '已關閉：每人整場只能中獎一次');
  }

  function onClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const sync = ctx.sync;
    const actions = {
      backup: () => Backup.downloadBackup(ctx.store.state),
      restore,
      'clear-draws': clearDraws,
      'clear-all': clearAll,
      'sync-choose': async () => { await sync.choose(); UI.toast(`已開始自動存檔到 ${sync.fileName}`); },
      'sync-resume': async () => { await sync.resume(); UI.toast(`已恢復自動存檔到 ${sync.fileName}`); },
      'sync-stop': async () => {
        if (!await UI.confirm('停止自動存檔？資料仍會保存在瀏覽器中，已寫入的檔案不會被刪除。')) return;
        await sync.disconnect();
        UI.toast('已停止自動存檔', 'warn');
      }
    };
    if (actions[btn.dataset.act]) UI.runAsync(actions[btn.dataset.act]);
  }

  async function restore() {
    const file = await UI.pickFile('.json');
    if (!file) return;
    const data = Backup.parseBackupText(await file.text());
    const ok = await UI.confirm(
      `從「${file.name}」還原？\n` +
      `備份內容：${data.employees.length} 位員工、${data.prizes.length} 個獎項、${data.draws.length} 筆抽獎紀錄。\n\n` +
      '目前的資料會被取代（還原前會先自動下載一份目前資料的備份）。',
      { okText: '還原', danger: true });
    if (!ok) return;
    Backup.downloadBackup(ctx.store.state);
    ctx.store.replace(data);
    UI.toast('還原完成');
  }

  async function clearDraws() {
    const n = ctx.store.state.draws.length;
    if (!n) return UI.toast('目前沒有抽獎紀錄', 'warn');
    const ok = await UI.confirm(
      `將刪除全部 ${n} 筆抽獎紀錄（含已撤銷、已放棄），名單與獎項保留。\n執行前會先自動下載備份。`,
      { title: '清除抽獎紀錄', okText: '清除紀錄', danger: true });
    if (!ok) return;
    Backup.downloadBackup(ctx.store.state);
    ctx.store.mutate(s => Draw.clearRecords(s));
    UI.toast(`已清除 ${n} 筆抽獎紀錄`);
  }

  async function clearAll() {
    const s = ctx.store.state;
    const ok = await UI.confirm(
      `將刪除 ${s.employees.length} 位員工、${s.prizes.length} 個獎項、${s.draws.length} 筆抽獎紀錄，所有設定恢復預設。\n` +
      '執行前會先自動下載備份。',
      { title: '全部清空', okText: '全部清空', danger: true });
    if (!ok) return;
    Backup.downloadBackup(s);
    ctx.store.replace(Store.emptyState());
    UI.toast('已全部清空');
  }

  LT.SettingsTab = { mount, update };
})(window);
