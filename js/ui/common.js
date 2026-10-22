/* 介面共用工具：跳脫、提示訊息、對話框、確認框、選檔、錯誤處理 */
(function (global) {
  'use strict';
  const LT = global.LT;
  const UI = LT.UI = {};

  UI.esc = s => String(s ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  /** 右下角提示；type: ok | warn | error */
  UI.toast = function (message, type = 'ok') {
    let box = document.getElementById('toasts');
    if (!box) {
      box = document.createElement('div');
      box.id = 'toasts';
      document.body.appendChild(box);
    }
    const t = document.createElement('div');
    t.className = 'toast toast-' + type;
    t.textContent = message;
    box.appendChild(t);
    const ms = type === 'ok' ? 3000 : 6000;
    setTimeout(() => t.classList.add('hide'), ms);
    setTimeout(() => t.remove(), ms + 400);
  };

  UI.showError = function (e) {
    if (e && e.name === 'AbortError') return; // 使用者取消選檔
    let msg;
    if (e instanceof LT.LotteryError) msg = e.message;
    else if (e && e.name === 'QuotaExceededError') msg = '瀏覽器儲存空間不足，資料未儲存。請先到「設定」下載備份。';
    else msg = `發生錯誤：${e && e.message}`;
    UI.toast(msg, 'error');
    if (!(e instanceof LT.LotteryError)) console.error(e);
  };

  /** 執行操作，錯誤轉成提示訊息；回傳是否成功 */
  UI.run = function (fn, okMessage) {
    try {
      fn();
      if (okMessage) UI.toast(okMessage);
      return true;
    } catch (e) {
      UI.showError(e);
      return false;
    }
  };

  UI.runAsync = async function (fn) {
    try {
      await fn();
      return true;
    } catch (e) {
      UI.showError(e);
      return false;
    }
  };

  /** 對話框。buttons: [{ text, kind, disabled, onClick(body) }]，onClick 回傳 false 則不關閉。
   *  在輸入框按 Enter 等於按下第一個 primary 按鈕；Esc 關閉。 */
  UI.modal = function ({ title, body, buttons = [{ text: '關閉' }], wide = false, onClose }) {
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<div class="modal${wide ? ' wide' : ''}" role="dialog" aria-modal="true">
      <h2>${UI.esc(title)}</h2><div class="modal-body"></div><div class="modal-actions"></div></div>`;
    const bodyEl = back.querySelector('.modal-body');
    if (typeof body === 'string') bodyEl.innerHTML = body;
    else if (body) bodyEl.appendChild(body);

    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      back.remove();
      document.removeEventListener('keydown', onKey, true);
      if (onClose) onClose();
    };
    const onKey = e => {
      const open = document.querySelectorAll('.modal-back');
      if (e.key === 'Escape' && back === open[open.length - 1]) {
        e.stopPropagation();
        close();
      }
    };

    const actions = back.querySelector('.modal-actions');
    let primary = null;
    buttons.forEach(b => {
      const btn = document.createElement('button');
      btn.className = 'btn ' + (b.kind || '');
      btn.textContent = b.text;
      btn.disabled = !!b.disabled;
      btn.onclick = async () => {
        const keep = b.onClick ? await b.onClick(bodyEl) : undefined;
        if (keep !== false) close();
      };
      if (b.kind === 'primary' && !primary) primary = btn;
      actions.appendChild(btn);
    });
    bodyEl.addEventListener('keydown', e => {
      const t = e.target;
      if (e.key === 'Enter' && t.tagName === 'INPUT' && !['checkbox', 'search'].includes(t.type) && primary && !primary.disabled) {
        e.preventDefault();
        primary.click();
      }
    });

    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(back);
    const first = bodyEl.querySelector('input:not([type=checkbox]):not([type=search]),select,textarea');
    if (first) first.focus();
    return { body: bodyEl, close };
  };

  /** 確認框，回傳 Promise<boolean> */
  UI.confirm = function (message, { title = '請確認', okText = '確定', danger = false } = {}) {
    return new Promise(resolve => {
      UI.modal({
        title,
        body: `<p class="confirm-text">${UI.esc(message).replace(/\n/g, '<br>')}</p>`,
        buttons: [
          { text: '取消', onClick: () => resolve(false) },
          { text: okText, kind: danger ? 'danger' : 'primary', onClick: () => resolve(true) }
        ],
        onClose: () => resolve(false)
      });
    });
  };

  /** 開啟選檔視窗，回傳 File；取消回傳 null */
  UI.pickFile = function (accept) {
    return new Promise(resolve => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.addEventListener('change', () => resolve(input.files[0] || null));
      input.addEventListener('cancel', () => resolve(null));
      input.click();
    });
  };

  /** 讀取容器內所有具 name 的欄位；checkbox 取 checked */
  UI.formData = function (root) {
    const data = {};
    root.querySelectorAll('[name]').forEach(el => {
      data[el.name] = el.type === 'checkbox' ? el.checked : el.value;
    });
    return data;
  };

  UI.table = function (header, rows) {
    return `<table class="grid"><thead><tr>${header.map(h => `<th>${UI.esc(h)}</th>`).join('')}</tr></thead>` +
      `<tbody>${rows.map(r => `<tr>${r.map(c => `<td>${UI.esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  };

  /** 尚未製作的分頁 */
  UI.placeholder = function (text) {
    return {
      mount(el) { el.innerHTML = `<div class="card empty">${UI.esc(text)}</div>`; },
      update() {}
    };
  };
})(window);
