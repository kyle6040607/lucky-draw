/* 「獎項」分頁：新增／編輯／刪除、調整順序、資格設定（部門與個人） */
(function (global) {
  'use strict';
  const LT = global.LT, UI = LT.UI;
  const { Prizes, Draw, Employees } = LT;
  const esc = UI.esc;
  const TITLE_SUGGESTIONS = ['普獎', '參獎', '貳獎', '頭獎', '特獎', '加碼獎', '董事長獎'];
  const MAX_LIST = 300;

  let ctx, root;

  function mount(el, context) {
    ctx = context;
    root = el;
    el.innerHTML = `
      <div class="toolbar">
        <button class="btn primary" data-act="add">＋ 新增獎項</button>
        <span class="hint">抽獎時依下表順序由上而下進行，可用 ↑ ↓ 調整。</span>
      </div>
      <p class="summary" id="prizeSummary"></p>
      <div class="table-wrap" id="prizeTable"></div>`;
    el.addEventListener('click', onClick);
  }

  function update() {
    const s = ctx.store.state;
    const prizes = Prizes.sorted(s);
    const totalQty = prizes.reduce((n, p) => n + p.quantity, 0);
    const drawnQty = prizes.reduce((n, p) => n + Prizes.validCount(s, p.id), 0);
    root.querySelector('#prizeSummary').innerHTML = prizes.length
      ? `共 <b>${prizes.length}</b> 個獎項、獎品 <b>${totalQty}</b> 份，已抽出 ${drawnQty} 份` +
        (s.settings.allowRepeatGlobal ? '　<span class="tag warn">全場允許重複中獎</span>' : '')
      : '';
    const box = root.querySelector('#prizeTable');
    if (!prizes.length) {
      box.innerHTML = '<div class="card empty">還沒有獎項。請按「新增獎項」，建議依抽獎順序新增（例如先普獎、最後頭獎）。</div>';
      return;
    }
    const rows = prizes.map((p, i) => {
      const drawn = Prizes.validCount(s, p.id);
      const left = p.quantity - drawn;
      const pool = Draw.eligiblePool(s, p.id).length;
      const tags = [];
      if (left <= 0) tags.push('<span class="tag ok">已抽完</span>');
      else if (pool === 0) tags.push('<span class="tag warn">無人可抽</span>');
      if (p.allowWinners || s.settings.allowRepeatGlobal) tags.push('<span class="tag gold">開放已中獎者</span>');
      if (p.excluded.length) tags.push(`<span class="tag">排除 ${p.excluded.length} 人</span>`);
      return `<tr>
        <td class="center">${i + 1}</td>
        <td><b>${esc(p.title)}</b></td>
        <td>${esc(p.item)}</td>
        <td class="num">${p.quantity}</td>
        <td class="num">${p.batchSize}</td>
        <td class="num">${drawn}／${Math.max(left, 0)}</td>
        <td class="num">${pool}</td>
        <td>${tags.join(' ')}</td>
        <td class="actions">
          <button class="btn small icon" data-act="up" data-id="${p.id}" title="往前" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button class="btn small icon" data-act="down" data-id="${p.id}" title="往後" ${i === prizes.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="btn small" data-act="edit" data-id="${p.id}">編輯</button>
          <button class="btn small" data-act="elig" data-id="${p.id}">資格</button>
          <button class="btn small danger-outline" data-act="del" data-id="${p.id}">刪除</button>
        </td></tr>`;
    }).join('');
    box.innerHTML = `<table class="grid">
      <thead><tr><th class="center">順序</th><th>獎項</th><th>獎品</th><th class="num">數量</th><th class="num">每次抽</th>
      <th class="num">已抽／剩餘</th><th class="num">目前可抽人數</th><th>狀態</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table>`;
  }

  function onClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id = Number(btn.dataset.id);
    const actions = {
      add: () => editDialog(null),
      edit: () => editDialog(id),
      del: () => removePrize(id),
      up: () => ctx.store.mutate(s => Prizes.move(s, id, -1)),
      down: () => ctx.store.mutate(s => Prizes.move(s, id, 1)),
      elig: () => eligibilityDialog(id)
    };
    if (actions[btn.dataset.act]) UI.run(actions[btn.dataset.act]);
  }

  function editDialog(id) {
    const s = ctx.store.state;
    const p = id ? Prizes.find(s, id) : { title: '', item: '', quantity: 1, batchSize: 1, allowWinners: false };
    const drawn = id ? Prizes.validCount(s, id) : 0;
    const body = `
      <label class="field"><span>獎項名稱 *</span><input name="title" value="${esc(p.title)}" list="titleOptions" maxlength="30" placeholder="例如：頭獎"></label>
      <datalist id="titleOptions">${TITLE_SUGGESTIONS.map(t => `<option value="${t}">`).join('')}</datalist>
      <label class="field"><span>獎品名稱 *</span><input name="item" value="${esc(p.item)}" maxlength="50" placeholder="例如：65 吋電視"></label>
      <div class="field-row">
        <label class="field"><span>獎品數量 *</span><input name="quantity" type="number" min="${Math.max(1, drawn)}" step="1" value="${p.quantity}"></label>
        <label class="field"><span>每次抽出人數</span><input name="batchSize" type="number" min="1" step="1" value="${p.batchSize}"></label>
      </div>
      ${drawn ? `<p class="hint">此獎項已抽出 ${drawn} 份，數量不可少於 ${drawn}。</p>` : ''}
      <p class="hint">份數多的獎項（例如普獎 30 份）可設定每次抽出 5～10 人，加快現場進度。</p>
      <label class="check"><input type="checkbox" name="allowWinners" ${p.allowWinners ? 'checked' : ''}> 開放已中獎者參加（例如老闆加碼獎）</label>
      <p class="hint">${s.settings.allowRepeatGlobal
        ? '目前「設定」中已開啟全場允許重複中獎，此選項不影響結果。'
        : '不勾選時，已在其他獎項中獎的人不會被抽到。同一獎項內同一人不會中兩次。'}</p>`;
    UI.modal({
      title: id ? '編輯獎項' : '新增獎項',
      body,
      buttons: [
        { text: '取消' },
        {
          text: id ? '儲存' : '新增',
          kind: 'primary',
          onClick: b => {
            const data = UI.formData(b);
            if (!UI.run(() => ctx.store.mutate(st => (id ? Prizes.update(st, id, data) : Prizes.add(st, data))))) return false;
            UI.toast(id ? `已儲存「${data.title.trim()}」` : `已新增「${data.title.trim()}」`);
          }
        }
      ]
    });
  }

  async function removePrize(id) {
    const p = Prizes.find(ctx.store.state, id);
    if (!await UI.confirm(`確定刪除「${p.title}：${p.item}」？`, { danger: true, okText: '刪除' })) return;
    UI.run(() => ctx.store.mutate(s => Prizes.remove(s, id)), `已刪除「${p.title}」`);
  }

  /** 資格設定：勾選＝可參加本獎項。每次勾選立即儲存。 */
  function eligibilityDialog(prizeId) {
    let q = '';
    let onlyExcluded = false;
    const body = document.createElement('div');
    body.innerHTML = `
      <p class="summary" id="eligSummary"></p>
      <h3>依部門 <small class="hint">取消勾選＝整個部門不可參加本獎項</small></h3>
      <div class="check-grid" id="eligDepts"></div>
      <h3>個別設定 <small class="hint">打勾＝可參加本獎項</small></h3>
      <div class="toolbar">
        <input type="search" id="eligSearch" placeholder="搜尋工號、姓名或部門">
        <label class="check"><input type="checkbox" id="eligOnly"> 只顯示被排除的人</label>
        <span class="spacer"></span>
        <button class="btn small" id="eligReset">全部恢復資格</button>
      </div>
      <div class="check-list" id="eligList"></div>`;

    function render() {
      const s = ctx.store.state;
      const prize = s.prizes.find(p => p.id === prizeId);
      if (!prize) return;
      const ex = new Set(prize.excluded);
      body.querySelector('#eligSummary').innerHTML =
        `「${esc(prize.title)}：${esc(prize.item)}」目前可抽 <b>${Draw.eligiblePool(s, prizeId).length}</b> 人；排除 ${ex.size} 人` +
        '<br><span class="hint">可抽人數已扣除未參加抽獎的人，以及依規則不能再中獎的人。</span>';

      const depts = Employees.departments(s);
      body.querySelector('#eligDepts').innerHTML = depts.length ? depts.map(d => {
        const members = s.employees.filter(e => e.department === d);
        const n = members.filter(e => ex.has(e.id)).length;
        return `<label class="check"><input type="checkbox" data-dept="${esc(d)}" ${n === 0 ? 'checked' : ''}
          data-partial="${n > 0 && n < members.length ? 1 : 0}"> ${esc(d)}
          <small>${members.length} 人${n ? `，排除 ${n}` : ''}</small></label>`;
      }).join('') : '<span class="hint">名單中沒有部門資料。</span>';
      body.querySelectorAll('[data-partial="1"]').forEach(cb => { cb.indeterminate = true; });

      const kw = q.toLowerCase();
      const list = s.employees.filter(e =>
        (!onlyExcluded || ex.has(e.id)) &&
        (!kw || `${e.empNo} ${e.name} ${e.department}`.toLowerCase().includes(kw)));
      body.querySelector('#eligList').innerHTML = list.length
        ? list.slice(0, MAX_LIST).map(e => `
          <label class="check${e.active ? '' : ' inactive'}"><input type="checkbox" data-emp="${e.id}" ${ex.has(e.id) ? '' : 'checked'}>
            <span class="mono">${esc(e.empNo)}</span> ${esc(e.name)}
            <small>${esc(e.department)}${e.active ? '' : '・未參加抽獎'}</small></label>`).join('') +
          (list.length > MAX_LIST ? `<p class="hint">只顯示前 ${MAX_LIST} 人，請用搜尋縮小範圍。</p>` : '')
        : '<p class="hint">沒有符合條件的員工。</p>';
    }

    body.addEventListener('change', e => {
      const t = e.target;
      if (t.dataset.dept !== undefined) {
        UI.run(() => ctx.store.mutate(s => Prizes.setDepartmentExcluded(s, prizeId, t.dataset.dept, !t.checked)));
      } else if (t.dataset.emp) {
        UI.run(() => ctx.store.mutate(s => Prizes.setExcluded(s, prizeId, Number(t.dataset.emp), !t.checked)));
      } else if (t.id === 'eligOnly') {
        onlyExcluded = t.checked;
        render();
      }
    });
    body.querySelector('#eligSearch').addEventListener('input', e => { q = e.target.value.trim(); render(); });
    body.querySelector('#eligReset').addEventListener('click', () =>
      UI.run(() => ctx.store.mutate(s => Prizes.clearExcluded(s, prizeId)), '已恢復所有人的資格'));

    const unsubscribe = ctx.store.subscribe(render);
    const prize = Prizes.find(ctx.store.state, prizeId);
    UI.modal({
      title: `資格設定：${prize.title}`,
      body,
      wide: true,
      buttons: [{ text: '完成', kind: 'primary' }],
      onClose: unsubscribe
    });
    render();
  }

  LT.PrizeTab = { mount, update };
})(window);
