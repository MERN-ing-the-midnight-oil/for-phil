// Paste this entire file into Apps Script as Code.gs, then Save.
// Deploy → Manage deployments → pencil → Version: New version.
// If the web app says "doGet not found", the live deployment is still the empty starter script.

const SHEET_ID = '1lRDxkAI7GGHssohINtTKhM9t7o_DXhRlvUcyX2fdm4M';
const FACILITIES_GID = 1894856904;

const EXTRA_HEADERS = [
  'Status',
  'Claimed By',
  'Next Step Date',
  'Action Kind',
  'Action Time',
  'Last Contact By',
  'Last Contact At',
  'Waitlist Date',
  'Estimated Wait',
  'Deposit',
  'Not a Fit Reason',
  'Admissions Contact',
  'Locked Unit',
  'Dementia Staff',
  'Nurse On Site',
  'Wandering Protocol',
  'Memory Care Beds',
  'Medicaid Transition',
  'Medicaid Beds',
  'Rate Includes',
  'Visiting Hours',
  'place for mom top ten'
];

const PLACE_FOR_MOM_TOP_TEN_KEYS = [
  'bellingham at orchard',
  'brookdale fairhaven',
  'spring creek',
  'cordata court',
  'rosewood villa',
  'silverado bellingham',
  'orchard park',
  'summit place',
  'highgate senior living',
  'village manor',
  'vista manor'
];

const FAMILY_DEFAULTS = ['Rhys', 'Janet', 'Bill', 'Alice', 'Fred', 'Ben', 'Emily', 'Grace'];

function doGet(e) {
  var params = (e && e.parameter) || {};
  if (!params.action) {
    try {
      // Must be createTemplateFromFile().evaluate() so <?!= include(...) ?> runs.
      // createHtmlOutputFromFile leaves those tags in the page and the app stays blank.
      return HtmlService.createTemplateFromFile('Index').evaluate()
        .setTitle('For Phil')
        .addMetaTag('viewport', 'width=device-width, initial-scale=1')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    } catch (err1) {
      try {
        return HtmlService.createTemplateFromFile('index').evaluate()
          .setTitle('For Phil')
          .addMetaTag('viewport', 'width=device-width, initial-scale=1')
          .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
      } catch (err) {
        var error = String(err && err.message ? err.message : err);
        return HtmlService.createHtmlOutput(
          '<meta name="viewport" content="width=device-width, initial-scale=1">' +
          '<div style="font-family:-apple-system,sans-serif;padding:1.5rem;line-height:1.45">' +
          '<p><strong>For Phil is not ready to share yet.</strong></p>' +
          '<p>In the sheet go to Extensions → Apps Script. The left file list must include <code>Index.html</code>, <code>styles.html</code>, and <code>app.html</code>.</p>' +
          '<p>Save those files, then Deploy → Manage deployments → pencil → Version: New version → Deploy.</p>' +
          '<p style="color:#6b5848;font-size:0.9rem">Google said: ' + error.replace(/</g, '&lt;') + '</p>' +
          '</div>'
        ).setTitle('For Phil setup');
      }
    }
  }

  try {
    var data = withLock_(function () {
      return handle_(params);
    });
    return jsonOut_(params, { ok: true, data: data });
  } catch (err) {
    return jsonOut_(params, { ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function include(filename) {
  try {
    return HtmlService.createHtmlOutputFromFile(filename).getContent();
  } catch (err) {
    return HtmlService.createHtmlOutputFromFile(String(filename || '').toLowerCase()).getContent();
  }
}

function clientGetState() {
  return withLock_(function () {
    ensureSchema_();
    return getState_();
  });
}

function clientAction(action, params) {
  params = params || {};
  params.action = action;
  return withLock_(function () {
    return handle_(params);
  });
}

function handle_(p) {
  ensureSchema_();
  var action = String(p.action || 'list');
  if (action === 'list' || action === 'state') return getState_();
  if (action === 'save') return saveFacility_(p);
  if (action === 'note') return addNote_(p);
  if (action === 'claim') return claim_(p);
  if (action === 'release') return release_(p);
  if (action === 'addPerson') return addPerson_(p);
  throw new Error('Unknown action');
}

function getState_() {
  return {
    facilities: readFacilities_(),
    logs: readLogs_(),
    people: readPeople_(),
    syncedAt: new Date().toISOString()
  };
}

function saveFacility_(p) {
  var row = findFacilityRow_(p.name);
  var sheet = facilitiesSheet_();
  var map = headerMap_(sheet);
  var who = clean_(p.who);
  var now = formatNow_();

  setIf_(sheet, row, map, 'Status', p.status);
  setIf_(sheet, row, map, 'Claimed By', p.claimedBy === '__clear__' ? '' : p.claimedBy);
  setIf_(sheet, row, map, 'Next Step', p.nextStep);
  setIf_(sheet, row, map, 'Next Step Date', p.nextDate);
  setIf_(sheet, row, map, 'Action Kind', p.actionKind);
  setIf_(sheet, row, map, 'Action Time', p.actionTime);
  setIf_(sheet, row, map, 'Waitlist Date', p.waitlistDate);
  setIf_(sheet, row, map, 'Estimated Wait', p.estWait);
  setIf_(sheet, row, map, 'Deposit', p.deposit);
  setIf_(sheet, row, map, 'Not a Fit Reason', p.notFitReason);
  setIf_(sheet, row, map, 'Admissions Contact', p.admissionsContact);
  setIf_(sheet, row, map, 'Locked Unit', p.lockedUnit);
  setIf_(sheet, row, map, 'Dementia Staff', p.dementiaStaff);
  setIf_(sheet, row, map, 'Nurse On Site', p.nurseOnSite);
  setIf_(sheet, row, map, 'Wandering Protocol', p.wandering);
  setIf_(sheet, row, map, 'Memory Care Beds', p.bedsAvailable);
  setIf_(sheet, row, map, 'Medicaid Transition', p.medicaidTransition);
  setIf_(sheet, row, map, 'Medicaid Beds', p.medicaidBeds);
  setIf_(sheet, row, map, 'Rate Includes', p.rateIncludes);
  setIf_(sheet, row, map, 'Visiting Hours', p.visitingHours);
  setIf_(sheet, row, map, 'Notes', p.latestNote);

  if (p.status) {
    sheet.getRange(row, map['Called?']).setValue(p.status === 'not-started' ? '' : 'Yes');
  }

  if (who && (p.status || p.note || p.nextStep || p.nextDate || p.actionKind)) {
    sheet.getRange(row, map['Last Contact By']).setValue(who);
    sheet.getRange(row, map['Last Contact At']).setValue(now);
  }

  if (clean_(p.note)) {
    appendLog_(clean_(p.name), who, p.actionLabel || 'Updated', clean_(p.note), p.status || '');
  } else if (p.status || p.nextStep || p.nextDate || p.actionKind) {
    appendLog_(clean_(p.name), who, p.actionLabel || 'Updated', summarizeUpdate_(p), p.status || '');
  }

  return getState_();
}

function addNote_(p) {
  p.actionLabel = 'Logged a call';
  p.latestNote = clean_(p.note);
  return saveFacility_(p);
}

function claim_(p) {
  var row = findFacilityRow_(p.name);
  var sheet = facilitiesSheet_();
  var map = headerMap_(sheet);
  var who = clean_(p.who);
  if (!who) throw new Error('Pick your name before marking a facility as started.');
  var current = String(sheet.getRange(row, map['Claimed By']).getDisplayValue() || '')
    .split(/\s*,\s*/)
    .filter(function (name) { return name; });
  if (current.indexOf(who) === -1) current.push(who);
  sheet.getRange(row, map['Claimed By']).setValue(current.join(', '));
  return getState_();
}

function release_(p) {
  var row = findFacilityRow_(p.name);
  var sheet = facilitiesSheet_();
  var map = headerMap_(sheet);
  var who = clean_(p.who);
  var current = String(sheet.getRange(row, map['Claimed By']).getDisplayValue() || '')
    .split(/\s*,\s*/)
    .filter(function (name) { return name && name !== who; });
  sheet.getRange(row, map['Claimed By']).setValue(current.join(', '));
  return getState_();
}

function addPerson_(p) {
  var name = clean_(p.name);
  if (!name) throw new Error('Name is empty.');
  var sheet = getOrCreateSheet_('Family', ['Name']);
  var names = readPeople_();
  if (names.indexOf(name) === -1) sheet.appendRow([name]);
  return getState_();
}

function readFacilities_() {
  var sheet = facilitiesSheet_();
  var values = sheet.getDataRange().getDisplayValues();
  if (values.length < 2) return [];
  var headers = values[0].map(function (h) { return String(h || '').trim(); });
  var out = [];
  for (var r = 1; r < values.length; r++) {
    var name = clean_(values[r][0]);
    if (!name) continue;
    var rec = { row: r + 1 };
    headers.forEach(function (header, i) {
      rec[header] = values[r][i] == null ? '' : String(values[r][i]);
    });
    rec.cleanName = name;
    rec.memoryCare = yesNo_(rec['Memory Care']);
    rec.status = rec.Status || defaultStatus_(rec);
    rec['place for mom top ten'] = yesNo_(rec['place for mom top ten']) === 'yes' || isPlaceForMomTopTen_(name) ? 'yes' : '';
    out.push(rec);
  }
  return out;
}

function readLogs_() {
  var sheet = getOrCreateSheet_('CallLog', ['Timestamp', 'Facility', 'Who', 'Action', 'Note', 'Status']);
  var values = sheet.getDataRange().getDisplayValues();
  var logs = [];
  for (var i = values.length - 1; i >= 1 && logs.length < 80; i--) {
    if (!values[i][0] && !values[i][1]) continue;
    logs.push({
      at: String(values[i][0] || ''),
      facility: String(values[i][1] || ''),
      who: String(values[i][2] || ''),
      action: String(values[i][3] || ''),
      note: String(values[i][4] || ''),
      status: String(values[i][5] || '')
    });
  }
  return logs;
}

function readPeople_() {
  return FAMILY_DEFAULTS.slice();
}

function appendLog_(facility, who, action, note, status) {
  var sheet = getOrCreateSheet_('CallLog', ['Timestamp', 'Facility', 'Who', 'Action', 'Note', 'Status']);
  sheet.appendRow([formatNow_(), facility, who || '', action || '', note || '', status || '']);
}

function findFacilityRow_(name) {
  var want = clean_(name);
  if (!want) throw new Error('Missing facility name.');
  var sheet = facilitiesSheet_();
  var names = sheet.getRange(2, 1, Math.max(sheet.getLastRow() - 1, 1), 1).getDisplayValues();
  for (var i = 0; i < names.length; i++) {
    if (clean_(names[i][0]) === want) return i + 2;
  }
  throw new Error('Could not find ' + want + ' in the sheet.');
}

function setIf_(sheet, row, map, header, value) {
  if (value === undefined || !map[header]) return;
  sheet.getRange(row, map[header]).setValue(value);
}

function headerMap_(sheet) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var map = {};
  headers.forEach(function (h, i) {
    var key = String(h || '').trim();
    if (key) map[key] = i + 1;
  });
  return map;
}

function ensureSchema_() {
  var sheet = facilitiesSheet_();
  var map = headerMap_(sheet);
  EXTRA_HEADERS.forEach(function (header) {
    if (!map[header]) {
      var col = sheet.getLastColumn() + 1;
      sheet.getRange(1, col).setValue(header);
      map[header] = col;
    }
  });
  markPlaceForMomTopTen_(sheet, map);

  var family = getOrCreateSheet_('Family', ['Name']);
  if (family.getLastRow() < 2) {
    FAMILY_DEFAULTS.forEach(function (name) { family.appendRow([name]); });
  }

  getOrCreateSheet_('CallLog', ['Timestamp', 'Facility', 'Who', 'Action', 'Note', 'Status']);
}

function facilitiesSheet_() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getSheetId() === FACILITIES_GID) return sheets[i];
  }
  return ss.getSheets()[0];
}

function getOrCreateSheet_(name, headers) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  } else if (sheet.getLastColumn() < 1 || !String(sheet.getRange(1, 1).getValue())) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  return sheet;
}

function markPlaceForMomTopTen_(sheet, map) {
  var header = 'place for mom top ten';
  if (!map[header]) return;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  var names = sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues();
  var col = map[header];
  for (var i = 0; i < names.length; i++) {
    if (isPlaceForMomTopTen_(names[i][0])) {
      sheet.getRange(i + 2, col).setValue('yes');
    }
  }
}

function isPlaceForMomTopTen_(name) {
  var n = normalizeFacilityName_(name);
  if (!n) return false;
  for (var i = 0; i < PLACE_FOR_MOM_TOP_TEN_KEYS.length; i++) {
    if (n.indexOf(PLACE_FOR_MOM_TOP_TEN_KEYS[i]) !== -1) return true;
  }
  return false;
}

function normalizeFacilityName_(name) {
  return String(name || '')
    .replace(/\u0336/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function defaultStatus_(rec) {
  if (rec.memoryCare === 'no') return 'not-fit';
  if (String(rec['Called?'] || '').toLowerCase() === 'yes') return 'spoke';
  return 'not-started';
}

function yesNo_(value) {
  var s = clean_(value).toLowerCase();
  if (s === 'yes' || s === 'y') return 'yes';
  if (s === 'no' || s === 'n') return 'no';
  return s;
}

function summarizeUpdate_(p) {
  var bits = [];
  if (p.status) bits.push('Status: ' + p.status);
  if (p.actionKind) bits.push('Action: ' + clean_(p.actionKind));
  if (p.nextStep) bits.push('Next: ' + clean_(p.nextStep));
  if (p.nextDate) bits.push('On ' + p.nextDate + (p.actionTime ? ' ' + p.actionTime : ''));
  return bits.join(' · ') || 'Saved changes.';
}

function clean_(s) {
  return String(s == null ? '' : s).replace(/\u0336/g, '').replace(/\s+/g, ' ').trim();
}

function formatNow_() {
  return Utilities.formatDate(new Date(), 'America/Los_Angeles', "MMM d, yyyy h:mm a");
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function jsonOut_(params, obj) {
  var text = JSON.stringify(obj);
  if (params.callback) {
    return ContentService.createTextOutput(params.callback + '(' + text + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.JSON);
}
