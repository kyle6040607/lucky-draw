/* 共用基礎：命名空間、錯誤類別、公平亂數、時間格式
 * 注意：雙擊 HTML 以 file:// 開啟時瀏覽器不允許 ES module，
 * 因此所有模組都以一般 <script> 載入並掛在全域 LT 底下。 */
(function (global) {
  'use strict';
  const LT = global.LT = global.LT || {};

  /** 可預期的業務錯誤：code 供程式判斷，message 直接顯示給使用者 */
  class LotteryError extends Error {
    constructor(code, message) {
      super(message);
      this.name = 'LotteryError';
      this.code = code;
    }
  }
  LT.LotteryError = LotteryError;

  /** 密碼學等級亂數（crypto.getRandomValues），以拒絕取樣消除取模偏差，
   *  確保每個結果機率完全相等。 */
  const Random = {
    /** 回傳 0 ~ n-1 的均勻整數 */
    int(n) {
      if (!Number.isInteger(n) || n <= 0) throw new RangeError('n 必須為正整數');
      const limit = Math.floor(0x100000000 / n) * n;
      const buf = new Uint32Array(1);
      let x;
      do {
        global.crypto.getRandomValues(buf);
        x = buf[0];
      } while (x >= limit);
      return x % n;
    },
    /** 從陣列中不重複均勻抽出 k 個（部分 Fisher–Yates 洗牌），不修改原陣列 */
    sample(arr, k) {
      const a = arr.slice();
      const n = Math.min(k, a.length);
      for (let i = 0; i < n; i++) {
        const j = i + Random.int(a.length - i);
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a.slice(0, n);
    },
    pick(arr) {
      return arr[Random.int(arr.length)];
    }
  };
  LT.Random = Random;

  const pad = n => String(n).padStart(2, '0');
  /** 本地時間 YYYY-MM-DD HH:mm:ss，方便直接顯示與匯出 */
  LT.now = function () {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
      `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  LT.clean = v => String(v ?? '').trim();
})(window);
