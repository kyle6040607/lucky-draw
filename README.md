# 尾牙／春酒抽獎系統

單一網頁的抽獎系統，不需安裝任何軟體：用 Chrome 或 Edge 開啟 `index.html` 即可使用，現場不需網路。

## 使用
- `index.html`：抽獎系統主畫面
- `test.html`：自動測試，開啟後應顯示「全部通過」
- `io-test.html`：匯入匯出手動測試頁（使用獨立測試資料）

## 資料
- 資料保存在瀏覽器 localStorage，可另外設定自動存檔到 `.json` 檔，或在「設定」下載備份。
- 員工名單、備份檔請勿提交到版本庫（已在 `.gitignore` 排除 `.json`、`.xlsx`、`.csv`）。

## 結構
```
js/core.js        命名空間、公平亂數、時間
js/store.js       資料結構與存檔
js/employees.js   名單管理
js/prizes.js      獎項管理
js/draw.js        抽獎邏輯
js/io.js          Excel／CSV 匯入匯出
js/backup.js      備份與自動存檔
js/ui/            介面
lib/              SheetJS（Apache-2.0）
tests/            測試
```
