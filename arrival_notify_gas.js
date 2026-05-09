// 2026-05-09 重啟版 v2 — PWA + 21 欄 schema
/**
 * ============================================
 *  到貨即時通知（Google Apps Script 版）
 *  每小時由 Apps Script 時間觸發器自動執行
 *  偵測新到貨記錄 → 發送 Email 通知
 * ============================================
 *
 *  設定步驟：
 *  1. 打開你的到貨登記 Google Sheet
 *  2. 選單 → 擴充功能 → Apps Script
 *  3. 在左側新增一個檔案（點 +），取名 arrival_notify
 *  4. 把這整段程式碼貼進去
 *  5. 修改下方「設定區」的值
 *  6. 按照最下方說明設定「時間觸發器」
 */

// ══════════════════════════════════════
// ▼ 設定區
// ══════════════════════════════════════
const NOTIFY_CONFIG = {
  sheetName:   "到貨記錄",          // 你的工作表名稱（Sheet tab 名稱）
  mailTo:      "chengchieh.huang@gmail.com",  // 收件人
  mailCc:      "",                  // 副本（留空不寄）
  quietStart:  20,                  // 靜默開始（24h），20 = 晚上 8 點
  quietEnd:    7,                   // 靜默結束（24h），7 = 早上 7 點
};
// ══════════════════════════════════════


/**
 * 主函式 — 由觸發器每小時呼叫
 */
function checkArrivalNotify() {
  const props = PropertiesService.getScriptProperties();
  const lastSeen = props.getProperty("notify_last_seen") || "";

  Logger.log("到貨通知檢查開始");
  Logger.log("上次已知記錄時間：" + (lastSeen || "（首次執行）"));

  // 1. 讀取工作表
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(NOTIFY_CONFIG.sheetName);
  if (!sheet) {
    Logger.log("找不到工作表：" + NOTIFY_CONFIG.sheetName);
    return;
  }

  const data = sheet.getDataRange().getValues();
  if (data.length < 2) {
    Logger.log("工作表無資料");
    return;
  }

  // 2. 取得欄位索引（用標題列自動對應）
  const headers = data[0].map(h => String(h).trim());
  const col = {
    createdAt:  findCol(headers, ["建立時間", "createdAt", "timestamp"]),
    recordId:   findCol(headers, ["記錄ID", "recordId", "ID"]),
    sender:     findCol(headers, ["寄件廠商", "sender", "廠商"]),
    tracking:   findCol(headers, ["追蹤單號", "tracking", "單號"]),
    arrivalDate:findCol(headers, ["到貨日期", "arrivalDate", "日期"]),
    operator:   findCol(headers, ["登記人員", "operator", "人員"]),
    handler:    findCol(headers, ["處理人", "handler", "拆貨/收貨者"]),
    item:       findCol(headers, ["品項", "item", "品名"]),
    model:      findCol(headers, ["型號", "model"]),
    batch:      findCol(headers, ["批號", "batch", "LOT"]),
    qty:        findCol(headers, ["數量", "qty", "quantity"]),
    unit:       findCol(headers, ["單位", "unit"]),
    carrier:    findCol(headers, ["託運公司", "carrier", "貨運"]),
  };

  if (col.createdAt === -1) {
    Logger.log("找不到「建立時間」欄位，請確認標題列");
    return;
  }

  // 3. 找出新記錄（createdAt > lastSeen），合併同 ID
  const grouped = {};
  let latestTime = lastSeen;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const created = formatTimestamp(row[col.createdAt]);
    if (!created) continue;
    if (lastSeen && created <= lastSeen) continue;

    const rid = col.recordId !== -1 ? String(row[col.recordId]) : String(i);
    if (!rid) continue;

    if (!grouped[rid]) {
      grouped[rid] = {
        id:       rid,
        sender:   col.sender !== -1 ? String(row[col.sender] || "") : "",
        tracking: col.tracking !== -1 ? String(row[col.tracking] || "") : "",
        carrier:  col.carrier !== -1 ? String(row[col.carrier] || "") : "",
        date:     col.arrivalDate !== -1 ? formatDate(row[col.arrivalDate]) : "",
        operator: col.operator !== -1 ? String(row[col.operator] || "") : "",
        handler:  col.handler !== -1 ? String(row[col.handler] || "") : "",
        items:    [],
        created:  created,
      };
    }

    const itemName = col.item !== -1 ? String(row[col.item] || "") : "";
    const itemModel = col.model !== -1 ? String(row[col.model] || "") : "";
    const itemBatch = col.batch !== -1 ? String(row[col.batch] || "") : "";
    const itemQty  = col.qty !== -1 ? String(row[col.qty] || "") : "";
    const itemUnit = col.unit !== -1 ? String(row[col.unit] || "") : "";
    if (itemName) {
      let label = (itemName + " " + itemQty + " " + itemUnit).trim();
      if (itemModel) label += " [型號:" + itemModel + "]";
      if (itemBatch) label += " [批號:" + itemBatch + "]";
      grouped[rid].items.push(label);
    }

    if (created > latestTime) latestTime = created;
  }

  const newRecords = Object.values(grouped);
  Logger.log("新增到貨：" + newRecords.length + " 筆");

  if (newRecords.length === 0) {
    Logger.log("無新到貨，不發通知");
    return;
  }

  // 4. 更新 lastSeen
  props.setProperty("notify_last_seen", latestTime);

  // 5. 檢查靜默時段
  if (isQuietHour()) {
    Logger.log("靜默時段（" + NOTIFY_CONFIG.quietStart + ":00～" + NOTIFY_CONFIG.quietEnd + ":00），不發通知");
    return;
  }

  // 6. 發送通知
  sendArrivalNotification(newRecords);
  Logger.log("通知郵件已寄送至 " + NOTIFY_CONFIG.mailTo);
}


/**
 * 發送到貨通知郵件
 */
function sendArrivalNotification(records) {
  const count = records.length;
  const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy/MM/dd HH:mm");
  const subject = "【到貨通知】" + now + "　新增 " + count + " 筆到貨";

  const lines = records.map(function(rec, i) {
    const items = rec.items.length > 0 ? rec.items.join("、") : "（未填品項）";
    const carrierInfo = rec.carrier ? "　貨運：" + rec.carrier : "";
    const people = rec.handler
      ? "   登記人：" + rec.operator + " / 處理人：" + rec.handler
      : "   登記人：" + rec.operator;
    return (i + 1) + ". [" + rec.date + "] " + rec.sender + "　單號：" + rec.tracking + carrierInfo + "\n" +
           "   品項：" + items + "\n" +
           people;
  });

  const sep = "────────────────────────────────────────";
  const body = "主管您好，\n\n" +
    "系統偵測到 " + count + " 筆新到貨記錄，摘要如下：\n\n" +
    sep + "\n" +
    lines.join("\n") + "\n" +
    sep + "\n\n" +
    "如需查看完整記錄，請至 Google Sheets 或等待今日 18:00 日報。\n\n" +
    "此信由倉庫到貨管理系統自動發送。";

  const options = {};
  if (NOTIFY_CONFIG.mailCc) {
    options.cc = NOTIFY_CONFIG.mailCc;
  }

  MailApp.sendEmail(NOTIFY_CONFIG.mailTo, subject, body, options);
}


// ── 工具函式 ──────────────────────────

function findCol(headers, candidates) {
  for (let c = 0; c < candidates.length; c++) {
    const idx = headers.indexOf(candidates[c]);
    if (idx !== -1) return idx;
  }
  return -1;
}

function formatTimestamp(val) {
  if (!val) return "";
  if (val instanceof Date) {
    return Utilities.formatDate(val, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss");
  }
  return String(val);
}

function formatDate(val) {
  if (!val) return "";
  if (val instanceof Date) {
    return Utilities.formatDate(val, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }
  return String(val).split("T")[0];
}

function isQuietHour() {
  const h = new Date().getHours();
  const qs = NOTIFY_CONFIG.quietStart;
  const qe = NOTIFY_CONFIG.quietEnd;
  if (qs > qe) {
    return h >= qs || h < qe;
  }
  return h >= qs && h < qe;
}


/**
 * ── 手動測試用 ──
 * 在 Apps Script 編輯器中選這個函式 → 按「執行」
 * 會重設 lastSeen 並立刻跑一次通知檢查
 */
function testArrivalNotify() {
  // 清除上次記錄，模擬首次執行
  PropertiesService.getScriptProperties().deleteProperty("notify_last_seen");
  Logger.log("已清除 lastSeen，開始測試...");
  checkArrivalNotify();
}


/**
 * ── 自動建立觸發器 ──
 * 執行一次即可，會建立「每小時」的時間觸發器
 * 如果已有同名觸發器會先刪除避免重複
 */
function setupArrivalNotifyTrigger() {
  // 先刪除已有的同名觸發器
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(t) {
    if (t.getHandlerFunction() === "checkArrivalNotify") {
      ScriptApp.deleteTrigger(t);
      Logger.log("已刪除舊觸發器");
    }
  });

  // 建立新的每小時觸發器
  ScriptApp.newTrigger("checkArrivalNotify")
    .timeBased()
    .everyHours(1)
    .create();

  Logger.log("已建立每小時觸發器 ✓");
}
