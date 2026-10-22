/* 第 3 階段：介面用到的資料功能 */
(function () {
  'use strict';
  const { Store, Employees, Prizes, Draw, Backup } = LT;
  const { test, section, eq, setup } = T;

  section('第 3 階段：介面相關資料功能');

  test('重新讀取：另一個視窗寫入後 reload 取得最新資料並通知畫面', () => {
    const adapter = Store.memoryAdapter();
    const a = Store.createStore(adapter);
    const b = Store.createStore(adapter);
    let notified = 0;
    a.subscribe(() => notified++);
    b.mutate(s => Employees.add(s, { empNo: 'A1', name: '甲' }));
    eq(a.state.employees.length, 0);
    a.reload();
    eq([a.state.employees.length, notified], [1, 1]);
  });

  test('清除抽獎紀錄：名單與獎項保留，名額與資格恢復，員工可刪除', () => {
    const s = setup(3);
    const p = Prizes.add(s, { title: '頭獎', item: 'x', quantity: 1 });
    const rec = Draw.draw(s, p.id).records[0];
    eq(Draw.clearRecords(s), 1);
    eq([s.employees.length, s.prizes.length, s.draws.length], [3, 1, 0]);
    eq(Draw.remaining(s, p.id), 1);
    eq(Draw.eligiblePool(s, p.id).length, 3);
    Employees.remove(s, rec.employeeId);
    eq(s.employees.length, 2);
  });

  test('清除抽獎紀錄後流水號不重用，新紀錄不會與舊備份混淆', () => {
    const s = setup(2);
    const p = Prizes.add(s, { title: '普獎', item: 'x', quantity: 2 });
    Draw.draw(s, p.id);
    Draw.clearRecords(s);
    eq(Draw.draw(s, p.id).records[0].id, 2);
  });

  test('全部恢復資格：清空排除名單', () => {
    const s = setup(4);
    const p = Prizes.add(s, { title: '頭獎', item: 'x', quantity: 1 });
    Prizes.setDepartmentExcluded(s, p.id, '業務部', true);
    Prizes.clearExcluded(s, p.id);
    eq(Draw.eligiblePool(s, p.id).length, 4);
  });

  test('自動存檔狀態：選檔後為 on，寫入失敗變 paused，停止後為 off', async () => {
    const store = Store.createStore(Store.memoryAdapter());
    let fail = false;
    const handle = {
      name: 'data.json',
      async createWritable() {
        if (fail) throw new Error('磁碟已拔除');
        return { async write() {}, async close() {} };
      }
    };
    const errors = [];
    const original = window.showSaveFilePicker;
    window.showSaveFilePicker = async () => handle;
    try {
      const sync = Backup.createFileSync(store, { onError: e => errors.push(e.message) });
      eq(sync.status, 'off');
      await sync.choose();
      eq([sync.status, sync.fileName], ['on', 'data.json']);
      fail = true;
      store.mutate(s => { s.settings.eventName = '改名'; });
      await sync.whenIdle();
      eq([sync.status, errors], ['paused', ['磁碟已拔除']]);
      await sync.disconnect();
      eq([sync.status, sync.fileName], ['off', null]);
    } finally {
      window.showSaveFilePicker = original;
    }
  });
})();
