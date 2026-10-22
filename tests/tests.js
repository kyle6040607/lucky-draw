/* 第 1 階段：名單、獎項、抽獎邏輯、存檔 */
(function () {
  'use strict';
  const { Store, Employees, Prizes, Draw, Random } = LT;
  const { test, section, assert, eq, throwsCode, setup, empIds } = T;
  // 卡方臨界值（p = 0.001）
  const CHI_CRIT = { 6: 22.46, 9: 27.88 };

  section('第 1 階段：名單、獎項、抽獎邏輯');

  /* ---------- 亂數 ---------- */

  test('亂數：int(7) 範圍正確且分布均勻（70000 次卡方檢定）', () => {
    const counts = new Array(7).fill(0);
    const N = 70000;
    for (let i = 0; i < N; i++) {
      const x = Random.int(7);
      assert(Number.isInteger(x) && x >= 0 && x < 7, `超出範圍：${x}`);
      counts[x]++;
    }
    const exp = N / 7;
    const chi = counts.reduce((s, c) => s + (c - exp) ** 2 / exp, 0);
    assert(chi < CHI_CRIT[6], `卡方值 ${chi.toFixed(2)} 超過臨界值 ${CHI_CRIT[6]}`);
  });

  test('亂數：sample 不重複、不改動原陣列、k 大於長度時取全部', () => {
    const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const s = Random.sample(arr, 6);
    eq(new Set(s).size, 6, '抽出結果有重複');
    eq(arr, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], '原陣列被改動');
    eq(Random.sample(arr, 99).length, 10);
  });

  /* ---------- 名單 ---------- */

  test('名單：同名不同工號視為不同人', () => {
    const s = Store.emptyState();
    Employees.add(s, { empNo: 'A1', name: '王小明' });
    Employees.add(s, { empNo: 'A2', name: '王小明' });
    eq(s.employees.length, 2);
  });

  test('名單：工號重複（不分大小寫、忽略前後空白）會被拒絕', () => {
    const s = Store.emptyState();
    Employees.add(s, { empNo: 'a1', name: '甲' });
    throwsCode(() => Employees.add(s, { empNo: ' A1 ', name: '乙' }), 'EMP_NO_DUPLICATE');
  });

  test('名單：工號或姓名空白會被拒絕', () => {
    const s = Store.emptyState();
    throwsCode(() => Employees.add(s, { empNo: '', name: '甲' }), 'EMP_NO_REQUIRED');
    throwsCode(() => Employees.add(s, { empNo: 'A1', name: '  ' }), 'EMP_NAME_REQUIRED');
  });

  test('名單：修改姓名，修改成他人工號會被拒絕', () => {
    const s = setup(2);
    Employees.update(s, 1, { name: '新名字' });
    eq(Employees.find(s, 1).name, '新名字');
    throwsCode(() => Employees.update(s, 1, { empNo: 'E002' }), 'EMP_NO_DUPLICATE');
  });

  test('名單：參與人數只計算啟用中的員工', () => {
    const s = setup(5);
    Employees.update(s, 2, { active: false });
    eq(Employees.activeCount(s), 4);
  });

  test('名單：刪除員工同時移除各獎項的排除設定', () => {
    const s = setup(3);
    const p = Prizes.add(s, { title: '頭獎', item: '電視', quantity: 1 });
    Prizes.setExcluded(s, p.id, 2, true);
    Employees.remove(s, 2);
    eq(s.employees.length, 2);
    eq(Prizes.find(s, p.id).excluded, []);
  });

  test('名單：已有抽獎紀錄的員工不可刪除', () => {
    const s = setup(1);
    const p = Prizes.add(s, { title: '普獎', item: '禮券', quantity: 1 });
    Draw.draw(s, p.id);
    throwsCode(() => Employees.remove(s, 1), 'EMP_HAS_DRAWS');
  });

  /* ---------- 獎項 ---------- */

  test('獎項：數量、每次抽出人數必須為正整數', () => {
    const s = Store.emptyState();
    throwsCode(() => Prizes.add(s, { title: 'A', item: 'B', quantity: 0 }), 'PRIZE_BAD_QUANTITY');
    throwsCode(() => Prizes.add(s, { title: 'A', item: 'B', quantity: 1.5 }), 'PRIZE_BAD_QUANTITY');
    throwsCode(() => Prizes.add(s, { title: 'A', item: 'B', quantity: 3, batchSize: 0 }), 'PRIZE_BAD_BATCH');
  });

  test('獎項：排序與上下移動', () => {
    const s = Store.emptyState();
    const a = Prizes.add(s, { title: '普獎', item: 'x', quantity: 1 });
    const b = Prizes.add(s, { title: '二獎', item: 'x', quantity: 1 });
    const c = Prizes.add(s, { title: '頭獎', item: 'x', quantity: 1 });
    eq(Prizes.sorted(s).map(p => p.title), ['普獎', '二獎', '頭獎']);
    Prizes.move(s, c.id, -1);
    eq(Prizes.sorted(s).map(p => p.title), ['普獎', '頭獎', '二獎']);
    Prizes.move(s, a.id, -1); // 已在最前面，不動
    eq(Prizes.sorted(s)[0].id, a.id);
    Prizes.remove(s, b.id);
    eq(Prizes.sorted(s).map(p => p.order), [1, 2]);
  });

  test('獎項：數量不可改成少於已抽出數；有紀錄不可刪除', () => {
    const s = setup(5);
    const p = Prizes.add(s, { title: '普獎', item: 'x', quantity: 3, batchSize: 3 });
    Draw.draw(s, p.id);
    throwsCode(() => Prizes.update(s, p.id, { quantity: 2 }), 'PRIZE_QTY_BELOW_DRAWN');
    Prizes.update(s, p.id, { quantity: 4 });
    throwsCode(() => Prizes.remove(s, p.id), 'PRIZE_HAS_DRAWS');
  });

  test('獎項：依部門一次排除', () => {
    const s = setup(5);
    const p = Prizes.add(s, { title: '頭獎', item: 'x', quantity: 1 });
    eq(Prizes.setDepartmentExcluded(s, p.id, '研發部', true), 2);
    eq(empIds(Draw.eligiblePool(s, p.id)), [1, 3, 5]);
    Prizes.setDepartmentExcluded(s, p.id, '研發部', false);
    eq(Draw.eligiblePool(s, p.id).length, 5);
  });

  /* ---------- 抽獎規則 ---------- */

  test('抽獎：預設不重複中獎，抽完後其他獎項沒有人可抽', () => {
    const s = setup(3);
    const p1 = Prizes.add(s, { title: '普獎', item: 'x', quantity: 3, batchSize: 3 });
    const p2 = Prizes.add(s, { title: '頭獎', item: 'y', quantity: 1 });
    eq(Draw.draw(s, p1.id).records.length, 3);
    const c = Draw.check(s, p2.id);
    eq([c.ok, c.code], [false, 'NO_ELIGIBLE']);
    throwsCode(() => Draw.draw(s, p2.id), 'NO_ELIGIBLE');
  });

  test('抽獎：開放已中獎者的獎項可抽到前面的得主，但同一獎項不會重複', () => {
    const s = setup(3);
    const p1 = Prizes.add(s, { title: '普獎', item: 'x', quantity: 3, batchSize: 3 });
    const bonus = Prizes.add(s, { title: '加碼獎', item: '現金', quantity: 5, batchSize: 5, allowWinners: true });
    Draw.draw(s, p1.id);
    const r = Draw.draw(s, bonus.id);
    eq(r.records.length, 3, '應抽出全部 3 人');
    eq(new Set(r.records.map(x => x.employeeId)).size, 3, '同一獎項出現重複得主');
    eq(Draw.check(s, bonus.id).code, 'NO_ELIGIBLE');
  });

  test('抽獎：全場開關開啟後所有獎項都允許重複中獎', () => {
    const s = setup(2);
    s.settings.allowRepeatGlobal = true;
    const p1 = Prizes.add(s, { title: '普獎', item: 'x', quantity: 2, batchSize: 2 });
    const p2 = Prizes.add(s, { title: '頭獎', item: 'y', quantity: 1 });
    Draw.draw(s, p1.id);
    eq(Draw.eligiblePool(s, p2.id).length, 2);
  });

  test('抽獎：停用與被排除的員工不在資格池中', () => {
    const s = setup(5);
    const p = Prizes.add(s, { title: '頭獎', item: 'x', quantity: 1 });
    Employees.update(s, 1, { active: false });
    Prizes.setExcluded(s, p.id, 2, true);
    eq(empIds(Draw.eligiblePool(s, p.id)), [3, 4, 5]);
  });

  test('抽獎：一次抽多人，最後一批依剩餘名額調整，抽完提示 PRIZE_DONE', () => {
    const s = setup(10);
    const p = Prizes.add(s, { title: '普獎', item: 'x', quantity: 5, batchSize: 3 });
    eq(Draw.draw(s, p.id).records.length, 3);
    eq(Draw.check(s, p.id).count, 2);
    eq(Draw.draw(s, p.id).records.length, 2);
    eq(Draw.remaining(s, p.id), 0);
    const c = Draw.check(s, p.id);
    eq([c.ok, c.code], [false, 'PRIZE_DONE']);
    throwsCode(() => Draw.draw(s, p.id), 'PRIZE_DONE');
  });

  test('抽獎：符合資格人數不足一批時提示 SHORTFALL 並只抽可抽人數', () => {
    const s = setup(2);
    const p = Prizes.add(s, { title: '普獎', item: 'x', quantity: 10, batchSize: 5 });
    const c = Draw.check(s, p.id);
    eq([c.ok, c.code, c.count], [true, 'SHORTFALL', 2]);
    eq(Draw.draw(s, p.id).records.length, 2);
  });

  test('抽獎：紀錄保存快照與當下資格人數，事後改名不影響紀錄', () => {
    const s = setup(4);
    const p = Prizes.add(s, { title: '頭獎', item: '電視', quantity: 1 });
    const rec = Draw.draw(s, p.id).records[0];
    eq([rec.prizeTitle, rec.prizeItem, rec.poolSize, rec.status], ['頭獎', '電視', 4, 'valid']);
    assert(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(rec.drawnAt), `時間格式錯誤：${rec.drawnAt}`);
    const oldName = rec.empName;
    Employees.update(s, rec.employeeId, { name: '改過的名字' });
    Prizes.update(s, p.id, { item: '冰箱' });
    eq([s.draws[0].empName, s.draws[0].prizeItem], [oldName, '電視']);
  });

  test('抽獎：nextPrize 依順序回傳第一個還有名額的獎項', () => {
    const s = setup(5);
    const a = Prizes.add(s, { title: '普獎', item: 'x', quantity: 1 });
    const b = Prizes.add(s, { title: '頭獎', item: 'y', quantity: 1 });
    eq(Draw.nextPrize(s).id, a.id);
    Draw.draw(s, a.id);
    eq(Draw.nextPrize(s).id, b.id);
    Draw.draw(s, b.id);
    eq(Draw.nextPrize(s), null);
  });

  /* ---------- 撤銷與放棄 ---------- */

  test('撤銷：撤銷最近一整批，名額與資格恢復，紀錄保留為 revoked', () => {
    const s = setup(6);
    const p1 = Prizes.add(s, { title: '普獎', item: 'x', quantity: 2, batchSize: 2 });
    const p2 = Prizes.add(s, { title: '二獎', item: 'y', quantity: 2, batchSize: 2 });
    Draw.draw(s, p1.id);
    const second = Draw.draw(s, p2.id).records;
    eq(empIds(Draw.lastBatch(s)), empIds(second), '預覽的不是最後一批');
    const undone = Draw.undoLast(s);
    eq(undone.map(d => d.status), ['revoked', 'revoked']);
    eq(Draw.remaining(s, p2.id), 2);
    eq(Draw.eligiblePool(s, p2.id).length, 4, '撤銷後應恢復資格');
    eq(s.draws.length, 4, '紀錄不應被刪除');
    Draw.undoLast(s);
    throwsCode(() => Draw.undoLast(s), 'NOTHING_TO_UNDO');
  });

  test('放棄：名額歸還可重抽；本人不能再抽本獎項，但可參加其他獎項', () => {
    const s = setup(3);
    const p1 = Prizes.add(s, { title: '頭獎', item: 'x', quantity: 1 });
    const p2 = Prizes.add(s, { title: '普獎', item: 'y', quantity: 1 });
    const rec = Draw.draw(s, p1.id).records[0];
    Draw.forfeit(s, rec.id);
    eq(Draw.remaining(s, p1.id), 1);
    assert(!empIds(Draw.eligiblePool(s, p1.id)).includes(rec.employeeId), '放棄者不應再出現在本獎項');
    assert(empIds(Draw.eligiblePool(s, p2.id)).includes(rec.employeeId), '放棄者應可參加其他獎項');
    throwsCode(() => Draw.forfeit(s, rec.id), 'DRAW_NOT_VALID');
  });

  /* ---------- 公平性 ---------- */

  test('公平性：10 人抽 1 名重複 10000 次，每人機率相同（卡方檢定）', () => {
    const base = setup(10);
    const p = Prizes.add(base, { title: '頭獎', item: 'x', quantity: 1 });
    const counts = new Map();
    const N = 10000;
    for (let i = 0; i < N; i++) {
      const s = structuredClone(base);
      const id = Draw.draw(s, p.id).records[0].employeeId;
      counts.set(id, (counts.get(id) || 0) + 1);
    }
    eq(counts.size, 10, '應該每個人都中過');
    const exp = N / 10;
    let chi = 0;
    counts.forEach(c => { chi += (c - exp) ** 2 / exp; });
    assert(chi < CHI_CRIT[9], `卡方值 ${chi.toFixed(2)} 超過臨界值 ${CHI_CRIT[9]}`);
  });

  test('公平性：抽獎只從資格池選人（注入假亂數驗證）', () => {
    const s = setup(5);
    const p = Prizes.add(s, { title: '頭獎', item: 'x', quantity: 1 });
    Prizes.setExcluded(s, p.id, 1, true);
    let seen = null;
    const fakeRng = { sample(pool, k) { seen = pool; return pool.slice(0, k); } };
    const rec = Draw.draw(s, p.id, fakeRng).records[0];
    eq(empIds(seen), [2, 3, 4, 5]);
    eq(rec.employeeId, 2);
  });

  /* ---------- 存檔 ---------- */

  test('存檔：mutate 成功後寫入轉接器，可重新載入', () => {
    const adapter = Store.memoryAdapter();
    const store = Store.createStore(adapter);
    store.mutate(s => Employees.add(s, { empNo: 'A1', name: '甲' }));
    const again = Store.createStore(adapter);
    eq(again.state.employees[0].name, '甲');
  });

  test('存檔：抽獎結果在 mutate 回傳前已寫入', () => {
    const adapter = Store.memoryAdapter();
    const store = Store.createStore(adapter);
    const pid = store.mutate(s => {
      Employees.add(s, { empNo: 'A1', name: '甲' });
      return Prizes.add(s, { title: '頭獎', item: 'x', quantity: 1 }).id;
    });
    store.mutate(s => Draw.draw(s, pid));
    eq(JSON.parse(adapter.raw).draws.length, 1);
  });

  test('存檔：驗證失敗時狀態與存檔都不變（原子性）', () => {
    const adapter = Store.memoryAdapter();
    const store = Store.createStore(adapter);
    store.mutate(s => Employees.add(s, { empNo: 'A1', name: '甲' }));
    const before = adapter.raw;
    throwsCode(() => store.mutate(s => {
      Employees.add(s, { empNo: 'A2', name: '乙' });
      Employees.add(s, { empNo: 'A2', name: '丙' });
    }), 'EMP_NO_DUPLICATE');
    eq(store.state.employees.length, 1);
    eq(adapter.raw, before);
  });

  test('存檔：寫入失敗（例如空間不足）時狀態不變', () => {
    const adapter = Store.memoryAdapter();
    const store = Store.createStore(adapter);
    adapter.save = () => { throw new Error('QuotaExceededError'); };
    let failed = false;
    try { store.mutate(s => Employees.add(s, { empNo: 'A1', name: '甲' })); } catch (e) { failed = true; }
    assert(failed, '應該拋出寫入錯誤');
    eq(store.state.employees.length, 0);
  });

  test('存檔：localStorage 轉接器可寫入與讀回', () => {
    const key = 'lottery-test-' + Date.now();
    try {
      const store = Store.createStore(Store.localStorageAdapter(key));
      store.mutate(s => { s.settings.eventName = '測試春酒'; });
      eq(Store.createStore(Store.localStorageAdapter(key)).state.settings.eventName, '測試春酒');
    } finally {
      localStorage.removeItem(key);
    }
  });

  test('存檔：版本不符的資料拒絕載入', () => {
    throwsCode(() => Store.normalize({ version: 999 }), 'BAD_VERSION');
  });
})();
