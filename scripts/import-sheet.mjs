#!/usr/bin/env node
/**
 * Import facilities (and optional call logs) into Supabase.
 *
 * Usage:
 *   node scripts/import-sheet.mjs --csv path/to/facilities.csv
 *   node scripts/import-sheet.mjs --csv facilities.csv --logs calllog.csv
 *   node scripts/import-sheet.mjs --from-sheet
 *
 * Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment
 * or in a .env file at the project root.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SHEET_ID = '1lRDxkAI7GGHssohINtTKhM9t7o_DXhRlvUcyX2fdm4M';
const FACILITIES_GID = '1894856904';
const CALL_LOG_GID = '';

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

loadEnv();

const args = parseArgs(process.argv.slice(2));
const supabaseUrl = requiredEnv('SUPABASE_URL').replace(/\/$/, '');
const serviceKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');

const facilitiesCsv = args['from-sheet']
  ? await fetchCsv(sheetCsvUrl(SHEET_ID, FACILITIES_GID))
  : args.csv
    ? readFileSync(resolve(args.csv), 'utf8')
    : null;

if (!facilitiesCsv) {
  console.error('Pass --csv path/to/facilities.csv or --from-sheet');
  process.exit(1);
}

const facilities = parseCsv(facilitiesCsv)
  .map(rowToFacility)
  .filter((row) => row.name);

if (!facilities.length) {
  console.error('No facility rows found. Check that the CSV has a Facility Name column.');
  process.exit(1);
}

console.log(`Upserting ${facilities.length} facilities…`);
await upsert('facilities', facilities, 'name');

let logsCsv = null;
if (args.logs) {
  logsCsv = readFileSync(resolve(args.logs), 'utf8');
} else if (args['from-sheet'] && CALL_LOG_GID) {
  logsCsv = await fetchCsv(sheetCsvUrl(SHEET_ID, CALL_LOG_GID));
}

if (logsCsv) {
  const logs = parseCsv(logsCsv).map(rowToLog).filter((row) => row.facility_name || row.note);
  if (logs.length) {
    console.log(`Inserting ${logs.length} call logs…`);
    await insert('call_logs', logs);
  }
}

console.log('Import complete.');

function rowToFacility(row) {
  const name = clean(row['Facility Name'] || row.name || row.Name);
  const memoryCare = yesNo(row['Memory Care'] || row.memory_care);
  const claimed = clean(row['Claimed By'] || row.claimed_by)
    .split(/\s*,\s*/)
    .filter(Boolean);
  const status = clean(row.Status || row.status) || (
    memoryCare === 'no' ? 'not-fit' : (yesNo(row['Called?']) === 'yes' ? 'spoke' : 'not-started')
  );
  const placeFlag = yesNo(row['place for mom top ten'] || row.place_for_mom_top_ten) === 'yes'
    || isPlaceForMomTopTen(name);
  return {
    name,
    memory_care: memoryCare,
    address: clean(row.Address || row.address),
    zip: clean(row.ZIP || row.zip),
    drive_minutes: clean(row['Driving Minutes from Parkway Village'] || row.drive || row.drive_minutes),
    phone: clean(row.Phone || row.phone),
    capacity: clean(row.Capacity || row.capacity),
    unit_type: clean(row['Unit Type'] || row.unit_type),
    monthly_cost: clean(row['Monthly Cost'] || row.monthly_cost),
    key_services: clean(row['Key Services'] || row.key_services),
    place_for_mom_top_ten: placeFlag,
    status,
    claimed_by: claimed,
    next_step: clean(row['Next Step'] || row.next_step),
    next_date: toDate(row['Next Step Date'] || row.next_date),
    action_kind: clean(row['Action Kind'] || row.action_kind),
    action_time: toTime(row['Action Time'] || row.action_time),
    last_contact_by: clean(row['Last Contact By'] || row.last_contact_by),
    last_contact_at: toTimestamp(row['Last Contact At'] || row.last_contact_at),
    waitlist_date: clean(row['Waitlist Date'] || row.waitlist_date),
    estimated_wait: clean(row['Estimated Wait'] || row.estimated_wait),
    deposit: clean(row.Deposit || row.deposit),
    not_a_fit_reason: clean(row['Not a Fit Reason'] || row.not_a_fit_reason)
      || (memoryCare === 'no' ? 'Not memory care — already crossed off the sheet.' : ''),
    admissions_contact: clean(row['Admissions Contact'] || row.admissions_contact),
    locked_unit: clean(row['Locked Unit'] || row.locked_unit),
    dementia_staff: clean(row['Dementia Staff'] || row.dementia_staff),
    nurse_on_site: clean(row['Nurse On Site'] || row.nurse_on_site),
    wandering_protocol: clean(row['Wandering Protocol'] || row.wandering_protocol),
    memory_care_beds: clean(row['Memory Care Beds'] || row.memory_care_beds),
    medicaid_transition: clean(row['Medicaid Transition'] || row.medicaid_transition),
    medicaid_beds: clean(row['Medicaid Beds'] || row.medicaid_beds),
    rate_includes: clean(row['Rate Includes'] || row.rate_includes),
    visiting_hours: clean(row['Visiting Hours'] || row.visiting_hours),
    latest_note: clean(row.Notes || row.latest_note)
  };
}

function rowToLog(row) {
  return {
    created_at: toTimestamp(row.Timestamp || row.created_at) || new Date().toISOString(),
    facility_name: clean(row.Facility || row.facility_name),
    who: clean(row.Who || row.who),
    action: clean(row.Action || row.action),
    note: clean(row.Note || row.note),
    status: clean(row.Status || row.status)
  };
}

function isPlaceForMomTopTen(name) {
  const n = clean(name)
    .replace(/\u0336/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return PLACE_FOR_MOM_TOP_TEN_KEYS.some((key) => n.includes(key));
}

function yesNo(value) {
  const s = clean(value).toLowerCase();
  if (s === 'yes' || s === 'y') return 'yes';
  if (s === 'no' || s === 'n') return 'no';
  return s;
}

function clean(s) {
  return String(s == null ? '' : s).replace(/\u0336/g, '').replace(/\s+/g, ' ').trim();
}

function toDate(value) {
  const s = clean(value);
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function toTime(value) {
  const s = clean(value);
  if (!s) return null;
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return `${String(m[1]).padStart(2, '0')}:${m[2]}:00`;
}

function toTimestamp(value) {
  const s = clean(value);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

async function upsert(table, rows, onConflict) {
  await rest(table, {
    method: 'POST',
    headers: { Prefer: `resolution=merge-duplicates,return=minimal` },
    search: `on_conflict=${onConflict}`,
    body: rows
  });
}

async function insert(table, rows) {
  await rest(table, {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: rows
  });
}

async function rest(table, { method, headers = {}, search = '', body }) {
  const url = `${supabaseUrl}/rest/v1/${table}${search ? `?${search}` : ''}`;
  const res = await fetch(url, {
    method,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      ...headers
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${table} ${res.status}: ${text}`);
  }
}

function sheetCsvUrl(id, gid) {
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;
}

async function fetchCsv(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`Could not download sheet CSV (${res.status}). Export it from Google Sheets and pass --csv instead.`);
  }
  const type = res.headers.get('content-type') || '';
  if (type.includes('text/html')) {
    throw new Error('Google returned a login page. Export the Facilities tab as CSV and pass --csv.');
  }
  return res.text();
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let i = 0;
  let inQuotes = false;
  const src = String(text).replace(/^\uFEFF/, '');
  while (i < src.length) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      row.push(cell);
      cell = '';
      i += 1;
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(cell);
      cell = '';
      if (row.some((value) => String(value).trim())) rows.push(row);
      row = [];
      i += 1;
      continue;
    }
    cell += ch;
    i += 1;
  }
  if (cell.length || row.length) {
    row.push(cell);
    if (row.some((value) => String(value).trim())) rows.push(row);
  }
  if (!rows.length) return [];
  const headers = rows[0].map((h) => String(h || '').trim());
  return rows.slice(1).map((values) => {
    const rec = {};
    headers.forEach((header, idx) => {
      rec[header] = values[idx] == null ? '' : String(values[idx]);
    });
    return rec;
  });
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--from-sheet') {
      out['from-sheet'] = true;
      continue;
    }
    if (token.startsWith('--') && argv[i + 1] && !argv[i + 1].startsWith('--')) {
      out[token.slice(2)] = argv[i + 1];
      i += 1;
    }
  }
  return out;
}

function loadEnv() {
  const paths = [resolve('.env'), resolve('.env.local')];
  for (const file of paths) {
    let text = '';
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  }
}

function requiredEnv(name) {
  const value = clean(process.env[name]);
  if (!value) {
    console.error(`Missing ${name}. Copy .env.example to .env and fill in your project keys.`);
    process.exit(1);
  }
  return value;
}
