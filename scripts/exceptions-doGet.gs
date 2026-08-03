/**
 * Exceptions sheet, read-only JSON API for the Product Matrix app.
 *
 * DEPLOY:
 *   1. Open the Exceptions Google Sheet.
 *   2. Extensions > Apps Script. Paste this file (replace any Code.gs content).
 *   3. Deploy > New deployment > type "Web app".
 *        Execute as:  Me
 *        Who has access:  Anyone with the link  (the app fetches it server-side)
 *   4. Copy the Web app URL and give it to the app as EXCEPTIONS_GS_URL.
 *
 * Returns JSON: { ok: true, updatedAt, count, rows: [ {header: value, ...}, ... ] }
 * One object per non-empty data row, keyed by the header row (row 1).
 * "Raised by" / "Approved by" are returned as-is (Slack id or name); the app
 * resolves Slack ids to names using its own Slack token.
 */

var SHEET_NAME = 'Exceptions';

function doGet() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];
    var values = sheet.getDataRange().getValues();

    if (!values || values.length < 2) {
      return json({ ok: true, updatedAt: new Date().toISOString(), count: 0, rows: [] });
    }

    var headers = values[0].map(function (h) { return String(h).trim(); });
    var rows = [];
    for (var i = 1; i < values.length; i++) {
      var row = values[i];
      // Skip fully empty rows.
      var hasData = row.some(function (c) { return String(c).trim() !== ''; });
      if (!hasData) continue;

      var obj = {};
      for (var c = 0; c < headers.length; c++) {
        if (!headers[c]) continue;
        var v = row[c];
        // Dates come back as Date objects, serialize to ISO for stable parsing.
        if (Object.prototype.toString.call(v) === '[object Date]') {
          v = v.toISOString();
        } else {
          v = String(v).trim();
        }
        obj[headers[c]] = v;
      }
      rows.push(obj);
    }

    return json({ ok: true, updatedAt: new Date().toISOString(), count: rows.length, rows: rows });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err), rows: [] });
  }
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
