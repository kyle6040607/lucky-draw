/* 極簡測試框架：各測試檔以 T.test 註冊，最後由 T.run 執行並顯示結果（支援 async 測試） */
(function (global) {
  'use strict';
  const { Store, Employees, LotteryError } = global.LT;
  const tests = [];

  function test(name, fn) { tests.push({ name, fn }); }
  function section(title) { tests.push({ section: title }); }

  function assert(cond, msg) {
    if (!cond) throw new Error(msg || '斷言失敗');
  }
  function eq(actual, expected, msg) {
    const a = JSON.stringify(actual), b = JSON.stringify(expected);
    if (a !== b) throw new Error(`${msg || '值不相等'}：預期 ${b}，實際 ${a}`);
  }
  function check(e, code) {
    if (e instanceof LotteryError && e.code === code) return e;
    throw new Error(`預期錯誤 ${code}，實際為 ${e.code || e.message}`);
  }
  function throwsCode(fn, code) {
    try { fn(); } catch (e) { return check(e, code); }
    throw new Error(`預期錯誤 ${code}，但沒有拋出`);
  }
  async function rejectsCode(fn, code) {
    try { await fn(); } catch (e) { return check(e, code); }
    throw new Error(`預期錯誤 ${code}，但沒有拋出`);
  }

  /** 建立 n 位員工：E001..，奇數業務部、偶數研發部 */
  function setup(n = 5) {
    const s = Store.emptyState();
    for (let i = 1; i <= n; i++) {
      Employees.add(s, {
        empNo: 'E' + String(i).padStart(3, '0'),
        name: '員工' + i,
        department: i % 2 ? '業務部' : '研發部'
      });
    }
    return s;
  }
  const empIds = list => list.map(x => x.employeeId ?? x.id).sort((a, b) => a - b);

  async function run() {
    const list = document.getElementById('results');
    const failures = [];
    let total = 0;
    const t0 = performance.now();
    for (const t of tests) {
      const li = document.createElement('li');
      if (t.section) {
        li.className = 'section';
        li.textContent = t.section;
        list.appendChild(li);
        continue;
      }
      total++;
      try {
        await t.fn();
        li.className = 'pass';
        li.textContent = '✔ ' + t.name;
      } catch (e) {
        li.className = 'fail';
        li.textContent = `✘ ${t.name} —— ${e.message}`;
        failures.push({ name: t.name, error: e.message });
      }
      list.appendChild(li);
    }
    const ms = Math.round(performance.now() - t0);
    const summary = document.getElementById('summary');
    summary.className = failures.length ? 'fail' : 'pass';
    summary.textContent = failures.length
      ? `${failures.length} 項失敗／共 ${total} 項（${ms} ms）`
      : `全部 ${total} 項通過（${ms} ms）`;
    global.__testResult = { total, failures };
  }

  global.T = { test, section, assert, eq, throwsCode, rejectsCode, setup, empIds, run };
})(window);
