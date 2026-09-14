import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const WHO_KEY = 'for-phil-who';
const SORT_KEY = 'for-phil-sort';
const MEMORY_FILTER_KEY = 'for-phil-hide-not-memory';
const FACILITY_KEY = 'for-phil-open';
const DASHBOARD_KEY = 'for-phil-dashboard';

const STATUSES = [
  { id: 'not-started', label: 'Not called yet' },
  { id: 'voicemail', label: 'Left voicemail' },
  { id: 'spoke', label: 'Spoke with admissions' },
  { id: 'tour', label: 'Tour scheduled' },
  { id: 'application', label: 'Application sent' },
  { id: 'waitlist', label: 'On waitlist' },
  { id: 'not-fit', label: 'Not a good fit' }
];

const SORTS = [
  { id: 'distance', label: 'Distance' },
  { id: 'price', label: 'Price' },
  { id: 'place', label: 'Place for Mom rating' },
  { id: 'status', label: 'Status' },
  { id: 'name', label: 'Name' }
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

const CALL_PROMPTS = [
  { key: 'bedsAvailable', ask: 'Do you have memory care beds available, and what\'s the current wait time?', placeholder: 'Beds open, wait time' },
  { key: 'medicaidTransition', ask: 'After the upfront funds run out, can residents transition to Medicaid? Do you maintain care continuity?', placeholder: 'Medicaid transition, care continuity' },
  { key: 'medicaidBeds', ask: 'How many Medicaid beds do you currently have, and what\'s your typical wait for Medicaid placement?', placeholder: 'Medicaid beds and wait' },
  { key: 'rateIncludes', ask: 'What\'s included in the monthly cost, and what costs extra?', placeholder: 'Included vs extra' },
  { key: '', ask: 'Can we schedule a tour?', hint: 'If they can, tap Tour below and pick a date and time.' }
];

const QUESTIONS = [
  ['lockedUnit', 'Locked / secure memory care unit?'],
  ['dementiaStaff', 'Dementia-trained staff?'],
  ['nurseOnSite', 'Nurse on site? When?'],
  ['wandering', 'What happens if he wanders?'],
  ['visitingHours', 'Visiting hours / family involvement?']
];

const ACTION_KINDS = [
  { id: 'callback', label: 'Call back', timed: 'optional', status: '', calendar: true },
  { id: 'tour', label: 'Tour', timed: 'yes', status: 'tour', calendar: true },
  { id: 'waitlist-check', label: 'Waitlist check', timed: '', status: 'waitlist', calendar: true },
  { id: 'assessment', label: 'Assessment', timed: 'yes', status: '', calendar: true },
  { id: 'deadline', label: 'Deadline', timed: '', status: '', calendar: true }
];

const ACTION_DEFAULT_NOTE = {
  callback: 'Call back',
  tour: 'Tour',
  'waitlist-check': 'Call back in one month to check waitlist',
  assessment: 'Clinical assessment',
  deadline: 'Application or deposit due'
};

const WHEN_CHIPS = [
  { id: '1', label: 'Tomorrow' },
  { id: '3', label: 'In 3 days' },
  { id: '7', label: 'In 1 week' },
  { id: '30', label: 'In 1 month' },
  { id: 'pick', label: 'Pick date' }
];

const PEOPLE = ['Rhys', 'Janet', 'Bill', 'Alice', 'Fred', 'Ben', 'Emily', 'Grace'];

const cfg = window.FOR_PHIL || {};
let supabase = null;
let realtimeChannel = null;
let quietRefreshTimer = 0;

const state = {
  sorts: loadSorts(),
  hideNotMemoryCare: localStorage.getItem(MEMORY_FILTER_KEY) !== 'no',
  query: '',
  facilityName: sessionStorage.getItem(FACILITY_KEY) || '',
  carouselIndex: 0,
  dashboardOpen: localStorage.getItem(DASHBOARD_KEY) === 'yes',
  who: localStorage.getItem(WHO_KEY) || '',
  facilities: [],
  logs: [],
  people: PEOPLE.slice(),
  setupOpen: false,
  whoOpen: false,
  pinOpen: false,
  pinError: '',
  locked: true,
  configMissing: !hasConfig(),
  toast: '',
  loading: true,
  saving: false,
  error: ''
};

function loadSorts() {
  const ids = SORTS.map((s) => s.id);
  const raw = localStorage.getItem(SORT_KEY);
  if (!raw) return ids.slice();
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const next = parsed.filter((id) => ids.includes(id));
      ids.forEach((id) => { if (!next.includes(id)) next.push(id); });
      return next;
    }
  } catch {
    /* old single-key value */
  }
  if (ids.includes(raw)) return [raw, ...ids.filter((id) => id !== raw)];
  return ids.slice();
}

function persistSorts() {
  localStorage.setItem(SORT_KEY, JSON.stringify(state.sorts));
}

function compareBySort(id, a, b) {
  if (id === 'price') return monthlyPrice(a) - monthlyPrice(b);
  if (id === 'place') return Number(b.placeForMomTopTen === 'yes') - Number(a.placeForMomTopTen === 'yes');
  if (id === 'status') return statusRank(a.status) - statusRank(b.status);
  if (id === 'name') return a.name.localeCompare(b.name);
  return driveMinutes(a) - driveMinutes(b);
}

function clean(s) {
  return String(s == null ? '' : s).replace(/\u0336/g, '').replace(/\s+/g, ' ').trim();
}

function startedNames(facility) {
  return clean(facility && facility.claimedBy).split(/,\s*/).filter(Boolean);
}

function formatStarted(names) {
  if (!names.length) return '';
  if (names.length === 1) return names[0] + ' started this';
  if (names.length === 2) return names[0] + ' and ' + names[1] + ' started this';
  return names.slice(0, -1).join(', ') + ', and ' + names[names.length - 1] + ' started this';
}

function withStarted(names, who) {
  if (!who || names.includes(who)) return names.slice();
  return names.concat(who);
}

function withoutStarted(names, who) {
  return names.filter((name) => name !== who);
}

function statusLabel(id) {
  return (STATUSES.find((s) => s.id === id) || { label: id }).label;
}

function statusRank(id) {
  const i = STATUSES.findIndex((s) => s.id === id);
  return i === -1 ? STATUSES.length : i;
}

function telHref(phone) {
  const digits = clean(phone).replace(/[^\d+]/g, '');
  if (digits.length < 7) return '';
  return 'tel:' + digits;
}

function facilityLocation(facility) {
  const street = clean(facility.Address);
  const zip = clean(facility.ZIP);
  if (street && zip) return `${street}, Bellingham, WA ${zip}`;
  if (street) return `${street}, Bellingham, WA`;
  if (zip) return `Bellingham, WA ${zip}`;
  return 'Bellingham, WA';
}

function mapsHref(facility) {
  return 'https://maps.google.com/?q=' + encodeURIComponent(facilityLocation(facility));
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function calendarStamp(d) {
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}T${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
}

function actionKindMeta(id) {
  return ACTION_KINDS.find((k) => k.id === id) || null;
}

function inferActionKind(facility) {
  const kind = clean(facility && facility.actionKind);
  if (actionKindMeta(kind)) return kind;
  if (!facility) return '';
  if (facility.status === 'tour') return 'tour';
  if (facility.status === 'waitlist' && (facility.nextDate || facility.nextStep)) return 'waitlist-check';
  if (facility.nextDate || facility.nextStep) return 'callback';
  return '';
}

function calendarAllDayStamp(d) {
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
}

function parseTime(value) {
  const m = String(value || '').match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return { h, min };
}

function formatTimeLabel(value) {
  const t = parseTime(value);
  if (!t) return '';
  const suffix = t.h >= 12 ? 'PM' : 'AM';
  const h = t.h % 12 || 12;
  return `${h}:${pad2(t.min)} ${suffix}`;
}

function formatShortDate(value) {
  const d = parseDate(value);
  if (!d) return clean(value);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function toIsoDate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function addDays(n) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return toIsoDate(d);
}

function addMonths(n) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setMonth(d.getMonth() + n);
  return toIsoDate(d);
}

function relativeDate(token) {
  if (token === '1') return addDays(1);
  if (token === '3') return addDays(3);
  if (token === '7') return addDays(7);
  if (token === '30') return addMonths(1);
  return '';
}

function calendarTitle(facility, kind, reminder) {
  const name = clean(facility.name);
  if (kind === 'tour') return `Tour — ${name} (Phil)`;
  if (kind === 'waitlist-check') return `Waitlist check — ${name} (Phil)`;
  if (kind === 'assessment') return `Assessment — ${name} (Phil)`;
  if (kind === 'deadline') return `Due: ${reminder || 'application / deposit'} — ${name} (Phil)`;
  return `Call ${name} (Phil)`;
}

function calendarButtonLabel(kind) {
  if (kind === 'tour') return 'Add tour to calendar';
  if (kind === 'waitlist-check') return 'Add waitlist check to calendar';
  if (kind === 'assessment') return 'Add assessment to calendar';
  if (kind === 'deadline') return 'Add deadline to calendar';
  if (kind === 'callback') return 'Add call to calendar';
  return 'Add to Google Calendar';
}

function calendarEventHref(facility) {
  const kind = inferActionKind(facility);
  const meta = actionKindMeta(kind);
  if (!meta || !meta.calendar) return '';
  const day = parseDate(facility.nextDate);
  if (!day) return '';
  const reminder = clean(facility.nextStep);
  const time = parseTime(facility.actionTime);
  const timed = meta.timed === 'yes' || (meta.timed === 'optional' && time);
  const details = [
    reminder,
    kind === 'waitlist-check' && facility.waitlistDate ? `Joined waitlist: ${facility.waitlistDate}` : '',
    facility.estWait ? `Estimated wait: ${facility.estWait}` : '',
    facility.Phone ? `Phone: ${facility.Phone}` : '',
    facility.admissionsContact ? `Ask for: ${facility.admissionsContact}` : '',
    facility.drive ? `Drive: ${facility.drive} from Parkway Village` : '',
    'Logged in For Phil.'
  ].filter(Boolean);
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: calendarTitle(facility, kind, reminder),
    details: details.join('\n'),
    ctz: 'America/Los_Angeles'
  });
  if (kind === 'tour' || kind === 'assessment') {
    params.set('location', facilityLocation(facility));
  }
  if (timed) {
    const start = new Date(
      day.getFullYear(),
      day.getMonth(),
      day.getDate(),
      time ? time.h : 10,
      time ? time.min : 0,
      0
    );
    const minutes = kind === 'callback' ? 30 : 60;
    const end = new Date(start.getTime() + minutes * 60 * 1000);
    params.set('dates', `${calendarStamp(start)}/${calendarStamp(end)}`);
  } else {
    const end = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
    params.set('dates', `${calendarAllDayStamp(day)}/${calendarAllDayStamp(end)}`);
  }
  return 'https://calendar.google.com/calendar/render?' + params.toString();
}

function actionLine(facility) {
  const kind = inferActionKind(facility);
  const label = actionKindMeta(kind) ? actionKindMeta(kind).label : '';
  const date = facility.nextDate ? formatShortDate(facility.nextDate) : '';
  const time = formatTimeLabel(facility.actionTime);
  const when = date && time ? `${date} at ${time}` : date;
  const note = clean(facility.nextStep);
  const bits = [label, when, note].filter(Boolean);
  if (bits.length && label && note && note.toLowerCase() === label.toLowerCase()) {
    return [label, when].filter(Boolean).join(' · ');
  }
  return bits.join(' · ');
}

function setOpenFacility(name) {
  state.facilityName = name || '';
  if (name) sessionStorage.setItem(FACILITY_KEY, name);
  else sessionStorage.removeItem(FACILITY_KEY);
}

function openFacilityNotes(name, opts) {
  const cards = carouselCards();
  const idx = cards.findIndex((el) => el.dataset.openFacility === name);
  if (idx >= 0) state.carouselIndex = idx;
  setOpenFacility(name);
  render();
  window.scrollTo(0, 0);
  if (opts && opts.focusNote) {
    const prompts = [...document.querySelectorAll('[data-call-prompt]')];
    const empty = prompts.find((el) => !clean(el.value));
    const target = empty || document.querySelector('[data-focus-note]');
    if (target) target.focus();
  }
}

function driveMinutes(facility) {
  const m = clean(facility.drive || facility['Driving Minutes from Parkway Village']).match(/\d+/);
  return m ? Number(m[0]) : 999;
}

function monthlyPrice(facility) {
  const s = clean(facility['Monthly Cost']).replace(/,/g, '');
  const nums = [...s.matchAll(/(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1])).filter((n) => n > 100);
  if (!nums.length) return Infinity;
  return Math.min(...nums);
}

function parseDate(value) {
  if (!value) return null;
  const iso = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isFollowup(facility) {
  if (facility.status === 'not-fit') return false;
  const next = parseDate(facility.nextDate);
  if (!next) return false;
  const due = new Date(next);
  due.setHours(0, 0, 0, 0);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return due <= now;
}

function hasConfig() {
  const url = clean(cfg.supabaseUrl);
  const key = clean(cfg.supabaseAnonKey);
  const email = clean(cfg.familyEmail);
  if (!url || !key || !email) return false;
  if (url.includes('YOUR_PROJECT') || key.includes('YOUR_ANON_KEY')) return false;
  return true;
}

function throwIfError(error, fallback) {
  if (!error) return;
  throw new Error(error.message || fallback);
}

function formatWhen(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return clean(value);
  return d.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });
}

function dateToText(value) {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(String(value))) return String(value).slice(0, 10);
  return clean(value);
}

function timeToText(value) {
  const s = clean(value);
  if (!s) return '';
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  return m ? `${String(m[1]).padStart(2, '0')}:${m[2]}` : s;
}

function claimedToText(value) {
  if (Array.isArray(value)) return value.map(clean).filter(Boolean).join(', ');
  return clean(value);
}

function normalizeFacility(raw) {
  const name = clean(raw.cleanName || raw['Facility Name'] || raw.name);
  const memoryCare = yesNo(raw.memoryCare || raw.memory_care || raw['Memory Care']);
  const status = raw.status || raw.Status || (memoryCare === 'no' ? 'not-fit' : 'not-started');
  const nextDate = dateToText(raw.next_date || raw.nextDate || raw['Next Step Date']);
  const actionTime = timeToText(raw.action_time || raw.actionTime || raw['Action Time']);
  return {
    name,
    memoryCare,
    Address: clean(raw.Address || raw.address),
    ZIP: clean(raw.ZIP || raw.zip),
    drive: clean(raw.drive_minutes || raw.drive || raw['Driving Minutes from Parkway Village']),
    Phone: clean(raw.Phone || raw.phone),
    Capacity: clean(raw.Capacity || raw.capacity),
    'Unit Type': clean(raw.unit_type || raw['Unit Type'] || raw.unitType),
    'Monthly Cost': clean(raw.monthly_cost || raw['Monthly Cost'] || raw.cost),
    'Key Services': clean(raw.key_services || raw['Key Services'] || raw.services),
    nextStep: clean(raw.next_step || raw.nextStep || raw['Next Step']),
    nextDate,
    actionKind: clean(raw.action_kind || raw.actionKind || raw['Action Kind']),
    actionTime,
    status,
    claimedBy: claimedToText(raw.claimed_by || raw.claimedBy || raw['Claimed By']),
    lastBy: clean(raw.last_contact_by || raw.lastBy || raw['Last Contact By']),
    lastAt: formatWhen(raw.last_contact_at || raw.lastAt || raw['Last Contact At']),
    waitlistDate: clean(raw.waitlist_date || raw.waitlistDate || raw['Waitlist Date']),
    estWait: clean(raw.estimated_wait || raw.estWait || raw['Estimated Wait']),
    deposit: clean(raw.deposit || raw.Deposit),
    notFitReason: clean(raw.not_a_fit_reason || raw.notFitReason || raw['Not a Fit Reason']) || (memoryCare === 'no' ? 'Not memory care — already crossed off the sheet.' : ''),
    admissionsContact: clean(raw.admissions_contact || raw.admissionsContact || raw['Admissions Contact']),
    lockedUnit: clean(raw.locked_unit || raw.lockedUnit || raw['Locked Unit']),
    dementiaStaff: clean(raw.dementia_staff || raw.dementiaStaff || raw['Dementia Staff']),
    nurseOnSite: clean(raw.nurse_on_site || raw.nurseOnSite || raw['Nurse On Site']),
    wandering: clean(raw.wandering_protocol || raw.wandering || raw['Wandering Protocol']),
    bedsAvailable: clean(raw.memory_care_beds || raw.bedsAvailable || raw['Memory Care Beds']),
    medicaidTransition: clean(raw.medicaid_transition || raw.medicaidTransition || raw['Medicaid Transition']),
    medicaidBeds: clean(raw.medicaid_beds || raw.medicaidBeds || raw['Medicaid Beds']),
    rateIncludes: clean(raw.rate_includes || raw.rateIncludes || raw['Rate Includes']),
    visitingHours: clean(raw.visiting_hours || raw.visitingHours || raw['Visiting Hours']),
    latestNote: clean(raw.latest_note || raw.latestNote || raw.Notes),
    placeForMomTopTen: raw.place_for_mom_top_ten === true || yesNo(raw.place_for_mom_top_ten || raw.placeForMomTopTen || raw['place for mom top ten']) === 'yes' || isPlaceForMomTopTen(name) ? 'yes' : ''
  };
}

function normalizeLog(row) {
  return {
    at: formatWhen(row.created_at || row.at),
    facility: clean(row.facility_name || row.facility),
    who: clean(row.who),
    action: clean(row.action),
    note: clean(row.note),
    status: clean(row.status)
  };
}

function isPlaceForMomTopTen(name) {
  const n = clean(name).replace(/\u0336/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  return PLACE_FOR_MOM_TOP_TEN_KEYS.some((key) => n.includes(key));
}

function yesNo(value) {
  const s = clean(value).toLowerCase();
  if (s === 'yes' || s === 'y') return 'yes';
  if (s === 'no' || s === 'n') return 'no';
  return s;
}

function applyRemoteState(data) {
  state.facilities = (data.facilities || []).map(normalizeFacility);
  state.logs = (data.logs || []).map(normalizeLog);
  const names = (data.people || []).map((row) => clean(row.name || row)).filter(Boolean);
  state.people = names.length ? names : PEOPLE.slice();
}

async function loadState() {
  if (!supabase) throw new Error('Supabase is not configured.');
  const [facilitiesRes, logsRes, peopleRes] = await Promise.all([
    supabase.from('facilities').select('*').order('name'),
    supabase.from('call_logs').select('*').order('created_at', { ascending: false }).limit(80),
    supabase.from('people').select('name').order('name')
  ]);
  throwIfError(facilitiesRes.error, 'Could not load facilities.');
  throwIfError(logsRes.error, 'Could not load call history.');
  throwIfError(peopleRes.error, 'Could not load family names.');
  applyRemoteState({
    facilities: facilitiesRes.data || [],
    logs: logsRes.data || [],
    people: peopleRes.data || []
  });
}

async function refresh() {
  if (state.locked || !supabase) {
    state.loading = false;
    render();
    return;
  }
  state.loading = true;
  state.error = '';
  render();
  try {
    await loadState();
  } catch (err) {
    state.error = err.message;
  } finally {
    state.loading = false;
    render();
  }
}

function quietRefresh() {
  clearTimeout(quietRefreshTimer);
  quietRefreshTimer = window.setTimeout(async () => {
    if (state.locked || state.saving || !supabase) return;
    try {
      await loadState();
      render();
    } catch (err) {
      state.error = err.message;
      render();
    }
  }, 250);
}

function subscribeRealtime() {
  if (!supabase || realtimeChannel) return;
  realtimeChannel = supabase
    .channel('for-phil')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'facilities' }, quietRefresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'call_logs' }, quietRefresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'people' }, quietRefresh)
    .subscribe();
}

function compactPayload(obj) {
  const out = {};
  Object.entries(obj).forEach(([key, value]) => {
    if (value !== undefined) out[key] = value;
  });
  return out;
}

function savePayload(params, who) {
  const note = clean(params.note || params.latestNote);
  return compactPayload({
    name: params.name,
    who,
    status: params.status,
    next_step: params.nextStep,
    next_date: params.nextDate,
    action_kind: params.actionKind,
    action_time: params.actionTime,
    waitlist_date: params.waitlistDate,
    estimated_wait: params.estWait,
    deposit: params.deposit,
    not_a_fit_reason: params.notFitReason,
    admissions_contact: params.admissionsContact,
    locked_unit: params.lockedUnit,
    dementia_staff: params.dementiaStaff,
    nurse_on_site: params.nurseOnSite,
    wandering_protocol: params.wandering,
    memory_care_beds: params.bedsAvailable,
    medicaid_transition: params.medicaidTransition,
    medicaid_beds: params.medicaidBeds,
    rate_includes: params.rateIncludes,
    visiting_hours: params.visitingHours,
    latest_note: params.latestNote,
    note,
    action_label: params.actionLabel
  });
}

function needWho() {
  if (state.who) return true;
  state.whoOpen = true;
  render();
  return false;
}

async function persist(action, params, localMutate) {
  if (state.locked) {
    state.pinOpen = true;
    render();
    return false;
  }
  if (action !== 'addPerson' && !needWho()) return false;
  state.saving = true;
  render();
  try {
    if (localMutate) localMutate();
    if (!supabase) throw new Error('Supabase is not configured.');
    if (action === 'claim') {
      const { error } = await supabase.rpc('claim_facility', { p_name: params.name, p_who: state.who });
      throwIfError(error, 'Could not mark this facility as started.');
    } else if (action === 'release') {
      const { error } = await supabase.rpc('release_facility', { p_name: params.name, p_who: state.who });
      throwIfError(error, 'Could not remove your name.');
    } else if (action === 'addPerson') {
      const { error } = await supabase.rpc('add_person', { p_name: params.name });
      throwIfError(error, 'Could not add that name.');
    } else {
      const payload = savePayload(params, state.who);
      if (action === 'note') {
        payload.note = clean(params.note || params.latestNote);
        payload.latest_note = payload.note;
        payload.action_label = params.actionLabel || 'Logged a call';
      }
      const { error } = await supabase.rpc('save_facility', { payload });
      throwIfError(error, 'Save failed.');
    }
    await loadState();
    toast('Saved.');
    return true;
  } catch (err) {
    toast(err.message);
    return false;
  } finally {
    state.saving = false;
    render();
  }
}

async function unlockWithPin(pin) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { error } = await supabase.auth.signInWithPassword({
    email: cfg.familyEmail,
    password: pin
  });
  if (error) {
    const code = String(error.code || '');
    const raw = error.message || '';
    const message = code === 'email_provider_disabled' || /email logins are disabled/i.test(raw)
      ? 'Email logins are turned off in Supabase. Authentication → Providers → Email → enable it.'
      : code === 'email_not_confirmed' || /email not confirmed/i.test(raw)
        ? 'Confirm the facilities@phil.app user, or turn off Confirm email in Authentication → Providers → Email.'
        : /invalid login credentials/i.test(raw)
          ? 'That PIN didn’t work.'
          : /failed to fetch|network/i.test(raw)
            ? 'Could not reach Supabase. Check the project URL in config.js.'
            : raw;
    throw new Error(message);
  }
}

async function boot() {
  if (!hasConfig()) {
    state.configMissing = true;
    state.locked = true;
    state.setupOpen = true;
    state.loading = false;
    render();
    return;
  }
  supabase = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false
    }
  });
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    state.error = error.message;
    state.locked = true;
    state.pinOpen = true;
    state.loading = false;
    render();
    return;
  }
  if (data.session) {
    state.locked = false;
    state.pinOpen = false;
    state.whoOpen = !state.who;
    subscribeRealtime();
    await refresh();
    return;
  }
  state.locked = true;
  state.pinOpen = true;
  state.loading = false;
  render();
}

function prependLog(facility, action, note, status) {
  state.logs.unshift({
    at: new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }),
    facility,
    who: state.who,
    action,
    note,
    status: status || ''
  });
}

function toast(message) {
  state.toast = message;
  render();
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    state.toast = '';
    render();
  }, 2600);
}

function familyAppUrl() {
  if (typeof location === 'undefined') return '';
  return `${location.origin}${location.pathname.replace(/index\.html$/, '')}${location.search}`;
}

async function copyFamilyLink(url) {
  const input = document.querySelector('[data-select-link]');
  if (input) {
    input.focus();
    input.select();
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await Promise.race([
        navigator.clipboard.writeText(url),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 800))
      ]);
      return true;
    } catch (_) {}
  }
  try {
    return document.execCommand('copy');
  } catch (_) {
    return false;
  }
}

function isAppleTouchShare() {
  const ua = navigator.userAgent || '';
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

async function shareFamilyLink() {
  const url = familyAppUrl();
  const title = 'For Phil';
  const text = 'Family board for Phil’s memory care search. The family PIN has been set to 844800.';
  const message = `${text}\n${url}`;
  if (typeof navigator.share === 'function') {
    try {
      // iOS drops `url` when `text` is also set, so include the link in the message.
      const payload = isAppleTouchShare()
        ? { title, text: message }
        : { title, text, url };
      if (!navigator.canShare || navigator.canShare(payload)) {
        await navigator.share(payload);
        return;
      }
    } catch (err) {
      if (err && err.name === 'AbortError') return;
    }
  }
  const copied = await copyFamilyLink(message);
  toast(copied ? 'Family link and PIN copied.' : 'Copy the site link from the top of the app.');
}

function listedFacilities() {
  const q = state.query.toLowerCase();
  return state.facilities
    .filter((f) => {
      if (state.hideNotMemoryCare && f.memoryCare !== 'yes') return false;
      if (q && !`${f.name} ${f.Address} ${f.ZIP} ${statusLabel(f.status)}`.toLowerCase().includes(q)) return false;
      return true;
    })
    .sort((a, b) => {
      for (let i = 0; i < state.sorts.length; i++) {
        const d = compareBySort(state.sorts[i], a, b);
        if (d) return d;
      }
      return a.name.localeCompare(b.name);
    });
}

function currentFacility() {
  return state.facilities.find((f) => f.name === state.facilityName);
}

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content;
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
}

function render() {
  const root = document.getElementById('app');
  const facility = currentFacility();
  const list = listedFacilities();
  root.replaceChildren();
  root.append(el(`
    <div class="app ${facility ? 'is-detail' : ''} ${state.dashboardOpen ? 'dashboard-open' : ''}">
      <header class="topbar">
        <div>
          <p class="eyebrow">Bellingham memory care</p>
          <h1>For Phil</h1>
          ${state.dashboardOpen ? `<p class="lede">Tap a phone number to call and take notes. Book a tour or callback on the facility page, then add it to Google Calendar.</p>` : ''}
        </div>
        <div class="top-actions">
          <button class="ghost" data-toggle-dashboard type="button" aria-expanded="${state.dashboardOpen ? 'true' : 'false'}">${state.dashboardOpen ? 'Hide dashboard' : 'Show dashboard'}</button>
          ${state.dashboardOpen ? `
            <button class="who-chip" data-open-who type="button">${state.who ? esc(state.who) : 'Who are you?'}</button>
            <button class="ghost" data-open-setup type="button">Setup</button>
          ` : ''}
        </div>
        ${state.dashboardOpen ? `
          <div class="family-link">
            <p class="tiny">Family link — send this plus the PIN</p>
            <div class="family-link-row">
              <input class="family-link-url" data-select-link readonly value="${esc(familyAppUrl())}">
              <button class="primary" data-share-link type="button">Share</button>
            </div>
          </div>
        ` : ''}
      </header>
      ${state.dashboardOpen && state.configMissing ? `
        <div class="banner">
          <strong>This copy is not connected to Supabase yet.</strong>
          Copy <span class="mono">config.example.js</span> to <span class="mono">config.js</span> and paste your project URL, anon key, and family email.
          <div class="row-actions">
            <button class="primary" data-open-setup type="button">How to connect</button>
          </div>
        </div>
      ` : ''}
      ${state.dashboardOpen && state.locked && !state.configMissing ? `
        <div class="banner">
          <strong>Enter the family PIN to open the shared board.</strong>
          Everyone uses the same PIN. Then pick your name so notes are stamped.
        </div>
      ` : ''}
      ${state.error ? `<div class="banner">${esc(state.error)}</div>` : ''}
      <div id="main"></div>
    </div>
  `));

  const main = root.querySelector('#main');
  if (facility) main.append(renderDetail(facility));
  else main.append(renderList(list));

  if (state.whoOpen) root.append(renderWho());
  if (state.pinOpen) root.append(renderPin());
  if (state.setupOpen) root.append(renderSetup());
  if (state.toast) root.append(el(`<div class="toast">${esc(state.toast)}</div>`));
  bind(root);
  restoreCarousel(list);
  if (state.pinOpen) {
    requestAnimationFrame(() => {
      const pin = document.querySelector('[data-unlock] [name="pin"]');
      if (pin) pin.focus();
    });
  }
}

function renderList(list) {
  const wrap = document.createElement('div');
  wrap.className = 'list-page';
  wrap.append(el(`
    ${state.dashboardOpen ? `
      <input class="search" data-search placeholder="Search a facility, street, or status" value="${esc(state.query)}">
      <div class="sorts-wrap">
        <p class="sort-label">Sort by <span>Drag to rank — first is strongest</span></p>
        <div class="sorts" data-sorts>
          ${state.sorts.map((id, i) => {
            const s = SORTS.find((item) => item.id === id) || { id, label: id };
            return `<button data-sort="${s.id}" class="${i === 0 ? 'active' : ''}" type="button">
              <span class="sort-rank">${i + 1}</span>${esc(s.label)}
            </button>`;
          }).join('')}
        </div>
        <button data-hide-not-memory class="filter-toggle ${state.hideNotMemoryCare ? 'active' : ''}" type="button" aria-pressed="${state.hideNotMemoryCare ? 'true' : 'false'}">
          Hide not memory care
        </button>
      </div>
    ` : ''}
    <div class="carousel-bar" aria-live="polite">
      <button class="ghost carousel-nav" data-carousel-prev type="button" aria-label="Previous facility">↑</button>
      <p class="carousel-label" data-carousel-label>${list.length ? `${Math.min(state.carouselIndex, list.length - 1) + 1} of ${list.length}` : '0 of 0'}</p>
      <button class="ghost carousel-nav" data-carousel-next type="button" aria-label="Next facility">↓</button>
    </div>
  `));
  const track = document.createElement('div');
  track.className = 'facility-track';
  track.setAttribute('data-carousel', '');
  if (state.loading) track.append(el(`<p class="empty">Loading facilities…</p>`));
  else if (!list.length) track.append(el(`<p class="empty">Nothing matches that search.</p>`));
  else list.forEach((f) => track.append(facilityCard(f)));
  wrap.append(track);
  return wrap;
}

function facilityCard(f) {
  const drive = f.drive || 'Drive time unknown';
  const phone = telHref(f.Phone);
  return el(`
    <article class="card facility-card" data-open-facility="${esc(f.name)}">
      <div class="card-head">
        <div>
          <h2>${esc(f.name)}</h2>
          <p class="meta">${esc(drive)}</p>
        </div>
        <span class="status ${esc(f.status)}">${esc(statusLabel(f.status))}</span>
      </div>
      <div class="card-actions">
        ${phone
          ? `<a class="call card-call" href="${phone}" data-call-facility="${esc(f.name)}">${esc(f.Phone)}</a>`
          : (f.Phone ? `<span class="tiny">${esc(f.Phone)}</span>` : '<span class="tiny">No phone listed</span>')}
      </div>
    </article>
  `);
}

function renderDetail(f) {
  const phone = telHref(f.Phone);
  const names = startedNames(f);
  const iStarted = names.includes(state.who);
  const logs = state.logs.filter((l) => l.facility === f.name);
  const kind = inferActionKind(f);
  const cal = calendarEventHref(f);
  const dateValue = toDateInput(f.nextDate);
  const timeValue = clean(f.actionTime);
  const showTime = (() => {
    const meta = actionKindMeta(kind);
    return Boolean(meta && (meta.timed === 'yes' || meta.timed === 'optional'));
  })();
  const wrap = document.createElement('div');
  wrap.append(el(`
    <button class="ghost detail-back" data-close-detail type="button">← All facilities</button>
    <article class="card">
      <div class="card-head">
        <div>
          <h2>${esc(f.name)}</h2>
          <p class="meta">${esc(f.drive || 'Drive time unknown')} from Parkway Village</p>
        </div>
        <span class="status ${esc(f.status)}">${esc(statusLabel(f.status))}</span>
      </div>
      ${names.length ? `<p class="started-note">${esc(formatStarted(names))}. Anyone can still call or leave notes.</p>` : ''}
      <div class="card-tags">
        ${f.placeForMomTopTen === 'yes' ? '<span class="apfm-badge">A Place for Mom top 10</span>' : ''}
        ${f.memoryCare === 'yes' ? '<span class="tag">Memory care</span>' : '<span class="tag muted-tag">Not memory care</span>'}
        ${isFollowup(f) ? '<span class="tag follow-tag">Follow-up due</span>' : ''}
      </div>
      ${f.lastAt ? `<p class="tiny">Last update ${esc(f.lastAt)}</p>` : ''}
      ${actionLine(f) ? `<p class="next"><strong>Next:</strong> ${esc(actionLine(f))}</p>` : ''}
      <div class="row-actions">
        ${phone ? `<a class="call" href="${phone}" data-call-facility="${esc(f.name)}">Call ${esc(f.Phone)}</a>` : `<span class="tiny">${esc(f.Phone || 'No phone listed')}</span>`}
        <a class="ghost" target="_blank" rel="noreferrer" href="${mapsHref(f)}">Map</a>
        ${cal ? `<a class="ghost" href="${cal}" target="_blank" rel="noopener noreferrer">${esc(calendarButtonLabel(kind))}</a>` : ''}
        ${iStarted
          ? `<button class="ghost" data-release type="button">Remove my name</button>`
          : `<button class="primary" data-claim type="button">${names.length ? "I've started this too" : "I've started this"}</button>`}
      </div>
      <dl class="facts">
        <div><dt>Address</dt><dd>${esc(f.Address)} ${esc(f.ZIP)}</dd></div>
        <div><dt>Capacity</dt><dd>${esc(f.Capacity) || '—'} · ${esc(f['Unit Type'])}</dd></div>
        <div><dt>Monthly</dt><dd>${esc(f['Monthly Cost']) || 'Call for rates'}</dd></div>
        <div><dt>Memory care</dt><dd>${f.memoryCare === 'yes' ? 'Yes' : 'No'}</dd></div>
        <div><dt>Services</dt><dd>${esc(f['Key Services'])}</dd></div>
        <div><dt>Place for Mom</dt><dd>${f.placeForMomTopTen === 'yes' ? 'Yes — on their Bellingham top 10' : '—'}</dd></div>
      </dl>
    </article>

    <form id="facility-form" class="card action-card" data-save-facility>
      <h3>While you're on the phone</h3>
      <p class="action-lede">Ask these first and jot the answers. Then set the next follow-up — tours, callbacks, waitlist checks, assessments, and deadlines can go to Google Calendar.</p>
      <ol class="call-script">
        ${CALL_PROMPTS.map((item) => `
          <li>
            <p class="ask">${esc(item.ask)}</p>
            ${item.hint ? `<p class="ask-hint">${esc(item.hint)}</p>` : ''}
            ${item.key ? `<input name="${item.key}" type="text" data-call-prompt value="${esc(f[item.key])}" placeholder="${esc(item.placeholder || '')}">` : ''}
          </li>
        `).join('')}
      </ol>
      <input type="hidden" name="actionKind" value="${esc(kind)}">
      <div class="action-chips" data-action-kinds>
        ${ACTION_KINDS.map((item) => `
          <button type="button" data-action-kind="${item.id}" class="${kind === item.id ? 'active' : ''}">${esc(item.label)}</button>
        `).join('')}
      </div>
      <div class="action-chips" data-when-chips>
        ${WHEN_CHIPS.map((item) => {
          const iso = item.id === 'pick' ? '' : relativeDate(item.id);
          const active = item.id === 'pick' ? Boolean(dateValue && !WHEN_CHIPS.some((w) => w.id !== 'pick' && relativeDate(w.id) === dateValue)) : iso === dateValue;
          return `<button type="button" data-when="${item.id}" class="${active ? 'active' : ''}">${esc(item.label)}</button>`;
        }).join('')}
      </div>
      <div class="grid-2">
        <label class="field">
          <span>Date</span>
          <input name="nextDate" type="date" value="${esc(dateValue)}">
        </label>
        <label class="field" data-action-time-wrap ${showTime ? '' : 'hidden'}>
          <span>Time</span>
          <input name="actionTime" type="time" value="${esc(timeValue)}">
        </label>
      </div>
      <label class="field">
        <span>Reminder</span>
        <input name="nextStep" type="text" value="${esc(f.nextStep)}" placeholder="Call back in one month to check waitlist">
      </label>
      <label class="field">
        <span>Add a note</span>
        <textarea name="note" data-focus-note placeholder="Who you spoke with, waitlist, deposit, vibe, what they asked for."></textarea>
      </label>
      <div class="row-actions">
        <button class="primary" type="submit" data-open-calendar="1" ${state.saving ? 'disabled' : ''}>${state.saving ? 'Saving…' : 'Save and add to calendar'}</button>
        <button class="ghost" type="submit" ${state.saving ? 'disabled' : ''}>${state.saving ? 'Saving…' : 'Save notes'}</button>
      </div>
    </form>

    <section class="card">
      <h3>Notes and call history</h3>
      ${f.latestNote ? `<p class="latest-note">${esc(f.latestNote)}</p>` : ''}
      ${logs.length ? renderLogItems(logs, { hideFacility: true }) : (f.latestNote ? '' : `<p class="empty">No notes yet. Add one below.</p>`)}
    </section>

    <div class="card">
      <label class="field">
        <span>Pipeline status</span>
        <select name="status" form="facility-form">${STATUSES.map((s) => `<option value="${s.id}" ${f.status === s.id ? 'selected' : ''}>${s.label}</option>`).join('')}</select>
      </label>
      <label class="field">
        <span>Admissions contact</span>
        <input name="admissionsContact" type="text" form="facility-form" value="${esc(f.admissionsContact)}" placeholder="Name, extension, email">
      </label>
      <div class="grid-2">
        <label class="field"><span>Joined waitlist on</span><input name="waitlistDate" type="text" form="facility-form" value="${esc(f.waitlistDate)}" placeholder="Sep 13, 2026"></label>
        <label class="field"><span>Estimated wait</span><input name="estWait" type="text" form="facility-form" value="${esc(f.estWait)}" placeholder="3–6 months"></label>
      </div>
      <label class="field"><span>Deposit / extra costs</span><input name="deposit" type="text" form="facility-form" value="${esc(f.deposit)}"></label>
      <label class="field"><span>If not a fit, why?</span><input name="notFitReason" type="text" form="facility-form" value="${esc(f.notFitReason)}"></label>
      <h3>Ask every place the same things</h3>
      ${QUESTIONS.map(([key, label]) => `
        <label class="field"><span>${esc(label)}</span><input name="${key}" type="text" form="facility-form" value="${esc(f[key])}"></label>
      `).join('')}
    </div>
  `));
  return wrap;
}

function toDateInput(value) {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = parseDate(value);
  if (!d) return '';
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

function renderLogItems(items, opts = {}) {
  if (!items.length) return `<p class="empty">No notes yet. Add one below.</p>`;
  return items.map((l) => `
    <div class="log-item">
      <p class="tiny">${esc(l.at)} · ${esc(l.who || 'Someone')} · ${esc(l.action)}</p>
      ${opts.hideFacility ? '' : `<p><strong>${esc(l.facility)}</strong>${l.status ? ` · ${esc(statusLabel(l.status))}` : ''}</p>`}
      ${opts.hideFacility && l.status ? `<p><strong>${esc(statusLabel(l.status))}</strong></p>` : ''}
      <p>${esc(l.note)}</p>
    </div>
  `).join('');
}

function renderWho() {
  const names = state.people.length ? state.people : PEOPLE;
  return el(`
    <div class="overlay" data-close-who>
      <div class="sheet" data-stop>
        <p class="eyebrow">Family</p>
        <h2>Who are you?</h2>
        <p class="lede">Your name is stamped on notes and on places you start.</p>
        <div class="people">
          ${names.map((name) => `<button class="primary" data-pick-who="${esc(name)}" type="button">${esc(name)}</button>`).join('')}
        </div>
        <form data-add-person>
          <label class="field">
            <span>Someone missing?</span>
            <input name="name" type="text" placeholder="Add a name" autocomplete="name">
          </label>
          <div class="row-actions">
            <button class="ghost" type="submit" ${state.saving || state.locked ? 'disabled' : ''}>Add to family</button>
          </div>
        </form>
      </div>
    </div>
  `);
}

function renderPin() {
  return el(`
    <div class="overlay">
      <div class="sheet" data-stop>
        <p class="eyebrow">Family</p>
        <h2>Enter the family PIN</h2>
        <p class="lede">Same PIN for everyone. After it unlocks, pick your name so notes are stamped.</p>
        <form data-unlock>
          <label class="field">
            <span>PIN</span>
            <input name="pin" type="password" inputmode="numeric" autocomplete="current-password" required>
          </label>
          ${state.pinError ? `<p class="banner">${esc(state.pinError)}</p>` : ''}
          <div class="row-actions">
            <button class="primary" type="submit">Unlock</button>
          </div>
        </form>
      </div>
    </div>
  `);
}

function renderSetup() {
  return el(`
    <div class="overlay" data-close-setup>
      <div class="sheet" data-stop>
        <p class="eyebrow">One-time setup</p>
        <h2>${state.configMissing ? 'Connect Supabase' : 'Family access'}</h2>
        ${state.configMissing ? `
          <ol>
            <li>Create a project at <a href="https://supabase.com" target="_blank" rel="noreferrer">supabase.com</a>.</li>
            <li>SQL Editor → paste <span class="mono">supabase/migrations/001_init.sql</span> → Run.</li>
            <li>Authentication → Providers → Email: turn off Confirm email.</li>
            <li>Authentication → Users → Add user. Email must match <span class="mono">familyEmail</span>. Password is the family PIN.</li>
            <li>Copy <span class="mono">config.example.js</span> to <span class="mono">config.js</span> and paste Project URL, anon key, and that email.</li>
            <li>Import the old sheet with <span class="mono">node scripts/import-sheet.mjs --csv facilities.csv</span>.</li>
          </ol>
        ` : `
          <p>Send family this site plus the shared PIN. After they unlock, they pick their name.</p>
          <ol>
            <li>Share the link at the top of this page.</li>
            <li>Tell them the PIN (the Auth user password in Supabase).</li>
            <li>Each person taps their name so notes and “I’ve started this” stay clear.</li>
          </ol>
        `}
        <p class="tiny">The Google Sheet / Apps Script backend is retired. Details are in README.md.</p>
      </div>
    </div>
  `);
}

function isMobileCarousel() {
  return window.matchMedia('(max-width: 720px)').matches;
}

function updateCarouselLabel(index, total) {
  const label = document.querySelector('[data-carousel-label]');
  if (label) label.textContent = total ? `${index + 1} of ${total}` : '0 of 0';
}

function carouselCards() {
  return [...document.querySelectorAll('[data-carousel] [data-open-facility]')];
}

function scrollCarouselTo(index, behavior) {
  const track = document.querySelector('[data-carousel]');
  const cards = carouselCards();
  if (!track || !cards.length) return;
  const next = Math.max(0, Math.min(index, cards.length - 1));
  state.carouselIndex = next;
  const card = cards[next];
  const top = card.offsetTop - Math.max(0, (track.clientHeight - card.offsetHeight) / 2);
  track.scrollTo({ top: Math.max(0, top), behavior: behavior || 'smooth' });
  updateCarouselLabel(next, cards.length);
}

function syncCarouselFromScroll() {
  const track = document.querySelector('[data-carousel]');
  const cards = carouselCards();
  if (!track || !cards.length) return;
  const mid = track.scrollTop + track.clientHeight / 2;
  let best = 0;
  let bestDist = Infinity;
  cards.forEach((card, i) => {
    const center = card.offsetTop + card.offsetHeight / 2;
    const dist = Math.abs(center - mid);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  });
  state.carouselIndex = best;
  updateCarouselLabel(best, cards.length);
}

function restoreCarousel(list) {
  if (!isMobileCarousel() || !list.length) return;
  const max = list.length - 1;
  if (state.carouselIndex > max) state.carouselIndex = max;
  requestAnimationFrame(() => {
    scrollCarouselTo(state.carouselIndex, 'instant');
  });
}

function numberSortChips(row) {
  [...row.querySelectorAll('[data-sort]')].forEach((btn, i) => {
    const rank = btn.querySelector('.sort-rank');
    if (rank) rank.textContent = String(i + 1);
    btn.classList.toggle('active', i === 0);
  });
}

function applySortOrder(ids, focusId) {
  state.sorts = ids;
  persistSorts();
  state.carouselIndex = 0;
  render();
  if (focusId) {
    requestAnimationFrame(() => {
      const btn = document.querySelector(`[data-sort="${focusId}"]`);
      if (btn) btn.focus();
    });
  }
}

function moveSort(id, delta) {
  const next = state.sorts.slice();
  const i = next.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= next.length) return;
  next.splice(j, 0, next.splice(i, 1)[0]);
  applySortOrder(next, id);
}

function placeSortChip(row, chip, clientX, clientY) {
  const over = document.elementFromPoint(clientX, clientY);
  const target = over && over.closest('[data-sort]');
  if (!target || target === chip || !row.contains(target)) return;
  const rect = target.getBoundingClientRect();
  const before = clientX < rect.left + rect.width / 2;
  if (before && chip.nextElementSibling === target) return;
  if (!before && target.nextElementSibling === chip) return;
  if (before) row.insertBefore(chip, target);
  else row.insertBefore(chip, target.nextSibling);
  numberSortChips(row);
}

function bindSortDrag(root) {
  const row = root.querySelector('[data-sorts]');
  if (!row) return;
  let drag = null;

  row.querySelectorAll('[data-sort]').forEach((btn) => {
    btn.setAttribute('draggable', 'true');
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        moveSort(btn.dataset.sort, -1);
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        moveSort(btn.dataset.sort, 1);
      }
    });
    btn.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', btn.dataset.sort);
      e.dataTransfer.effectAllowed = 'move';
      drag = { el: btn, moved: true };
      btn.classList.add('is-dragging');
    });
    btn.addEventListener('dragend', () => {
      if (!drag || drag.el !== btn) return;
      btn.classList.remove('is-dragging');
      const ids = [...row.querySelectorAll('[data-sort]')].map((b) => b.dataset.sort);
      if (ids.join() !== state.sorts.join()) applySortOrder(ids, btn.dataset.sort);
      drag = null;
    });
    btn.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      if (e.button && e.button !== 0) return;
      drag = { el: btn, x: e.clientX, y: e.clientY, moved: false, touch: true };
      btn.setPointerCapture(e.pointerId);
    });
    btn.addEventListener('pointermove', (e) => {
      if (!drag || drag.el !== btn || !drag.touch) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 8) return;
      drag.moved = true;
      btn.classList.add('is-dragging');
      btn.style.pointerEvents = 'none';
      placeSortChip(row, btn, e.clientX, e.clientY);
      btn.style.pointerEvents = '';
    });
    const endTouch = () => {
      if (!drag || drag.el !== btn || !drag.touch) return;
      btn.classList.remove('is-dragging');
      if (drag.moved) {
        applySortOrder([...row.querySelectorAll('[data-sort]')].map((b) => b.dataset.sort), btn.dataset.sort);
      }
      drag = null;
    };
    btn.addEventListener('pointerup', endTouch);
    btn.addEventListener('pointercancel', endTouch);
  });

  row.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (!drag) return;
    e.dataTransfer.dropEffect = 'move';
    placeSortChip(row, drag.el, e.clientX, e.clientY);
  });
  row.addEventListener('drop', (e) => e.preventDefault());
}

function bindActionStrip(root) {
  const form = root.querySelector('[data-save-facility]');
  if (!form) return;
  const kindInput = form.querySelector('[name="actionKind"]');
  const dateInput = form.querySelector('[name="nextDate"]');
  const timeWrap = form.querySelector('[data-action-time-wrap]');
  const stepInput = form.querySelector('[name="nextStep"]');
  const statusSelect = root.querySelector('[name="status"]');

  function markWhenChips() {
    const iso = dateInput ? dateInput.value : '';
    form.querySelectorAll('[data-when]').forEach((btn) => {
      if (btn.dataset.when === 'pick') {
        btn.classList.toggle('active', Boolean(iso && !WHEN_CHIPS.some((w) => w.id !== 'pick' && relativeDate(w.id) === iso)));
        return;
      }
      btn.classList.toggle('active', relativeDate(btn.dataset.when) === iso);
    });
  }

  function syncKindUi() {
    const kind = kindInput ? kindInput.value : '';
    form.querySelectorAll('[data-action-kind]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.actionKind === kind);
    });
    const meta = actionKindMeta(kind);
    if (timeWrap) timeWrap.hidden = !(meta && (meta.timed === 'yes' || meta.timed === 'optional'));
    if (statusSelect && meta && meta.status) statusSelect.value = meta.status;
    if (stepInput && meta) stepInput.placeholder = ACTION_DEFAULT_NOTE[kind] || 'What should we remember?';
  }

  form.querySelectorAll('[data-action-kind]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!kindInput) return;
      kindInput.value = btn.dataset.actionKind;
      if (stepInput && !clean(stepInput.value)) {
        stepInput.value = ACTION_DEFAULT_NOTE[btn.dataset.actionKind] || '';
      }
      syncKindUi();
    });
  });

  form.querySelectorAll('[data-when]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!dateInput) return;
      if (btn.dataset.when === 'pick') {
        dateInput.focus();
        if (dateInput.showPicker) dateInput.showPicker();
        return;
      }
      dateInput.value = relativeDate(btn.dataset.when);
      markWhenChips();
    });
  });

  if (dateInput) dateInput.addEventListener('change', markWhenChips);
  syncKindUi();
}

function bind(root) {
  bindSortDrag(root);
  const toggleDashboard = root.querySelector('[data-toggle-dashboard]');
  if (toggleDashboard) toggleDashboard.addEventListener('click', () => {
    state.dashboardOpen = !state.dashboardOpen;
    localStorage.setItem(DASHBOARD_KEY, state.dashboardOpen ? 'yes' : 'no');
    render();
  });
  const hideNotMemory = root.querySelector('[data-hide-not-memory]');
  if (hideNotMemory) hideNotMemory.addEventListener('click', () => {
    state.hideNotMemoryCare = !state.hideNotMemoryCare;
    localStorage.setItem(MEMORY_FILTER_KEY, state.hideNotMemoryCare ? 'yes' : 'no');
    state.carouselIndex = 0;
    render();
  });
  const search = root.querySelector('[data-search]');
  if (search) {
    search.addEventListener('input', (e) => {
      state.query = e.target.value;
      state.carouselIndex = 0;
      const pos = e.target.selectionStart;
      render();
      const next = document.querySelector('[data-search]');
      if (next) {
        next.focus();
        next.setSelectionRange(pos, pos);
      }
    });
  }
  const track = root.querySelector('[data-carousel]');
  if (track) {
    track.addEventListener('scroll', () => {
      if (!isMobileCarousel()) return;
      syncCarouselFromScroll();
    }, { passive: true });
  }
  const prev = root.querySelector('[data-carousel-prev]');
  if (prev) prev.addEventListener('click', () => scrollCarouselTo(state.carouselIndex - 1));
  const nextBtn = root.querySelector('[data-carousel-next]');
  if (nextBtn) nextBtn.addEventListener('click', () => scrollCarouselTo(state.carouselIndex + 1));
  root.querySelectorAll('[data-open-facility]').forEach((card) => card.addEventListener('click', (e) => {
    if (e.target.closest('a, button, input, select, textarea')) return;
    openFacilityNotes(card.dataset.openFacility);
  }));
  root.querySelectorAll('[data-call-facility]').forEach((btn) => btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const f = state.facilities.find((item) => item.name === btn.dataset.callFacility);
    if (!f) return;
    openFacilityNotes(f.name, { focusNote: true });
    const href = telHref(f.Phone);
    if (href) window.setTimeout(() => { window.location.href = href; }, 80);
  }));
  root.querySelectorAll('[data-calendar-facility]').forEach((btn) => btn.addEventListener('click', (e) => {
    e.stopPropagation();
  }));
  bindActionStrip(root);
  const back = root.querySelector('[data-close-detail]');
  if (back) back.addEventListener('click', () => {
    setOpenFacility('');
    render();
  });
  root.querySelectorAll('[data-open-who]').forEach((btn) => btn.addEventListener('click', () => {
    state.whoOpen = true;
    render();
  }));
  const selectLink = root.querySelector('[data-select-link]');
  if (selectLink) selectLink.addEventListener('focus', () => selectLink.select());
  const shareLink = root.querySelector('[data-share-link]');
  if (shareLink) shareLink.addEventListener('click', () => { shareFamilyLink(); });
  root.querySelectorAll('[data-open-setup]').forEach((btn) => btn.addEventListener('click', () => {
    state.setupOpen = true;
    render();
  }));
  const closeWho = root.querySelector('[data-close-who]');
  if (closeWho) closeWho.addEventListener('click', (e) => {
    if (e.target === closeWho) {
      state.whoOpen = false;
      render();
    }
  });
  const closeSetup = root.querySelector('[data-close-setup]');
  if (closeSetup) closeSetup.addEventListener('click', (e) => {
    if (e.target === closeSetup) {
      state.setupOpen = false;
      render();
    }
  });
  root.querySelectorAll('[data-pick-who]').forEach((btn) => btn.addEventListener('click', () => {
    state.who = btn.dataset.pickWho;
    localStorage.setItem(WHO_KEY, state.who);
    state.whoOpen = false;
    render();
  }));
  const addPerson = root.querySelector('[data-add-person]');
  if (addPerson) addPerson.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = clean(new FormData(addPerson).get('name'));
    if (!name) return;
    const ok = await persist('addPerson', { name });
    if (ok) {
      state.who = name;
      localStorage.setItem(WHO_KEY, name);
      state.whoOpen = false;
      render();
    }
  });
  const unlock = root.querySelector('[data-unlock]');
  if (unlock) unlock.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pin = String(new FormData(unlock).get('pin') || '');
    state.pinError = '';
    const btn = unlock.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    try {
      await unlockWithPin(pin);
      state.locked = false;
      state.pinOpen = false;
      state.whoOpen = !state.who;
      subscribeRealtime();
      await refresh();
    } catch (err) {
      state.pinError = err.message;
      render();
    }
  });
  const claim = root.querySelector('[data-claim]');
  if (claim) claim.addEventListener('click', async () => {
    const f = currentFacility();
    if (!f) return;
    await persist('claim', { name: f.name });
  });
  const release = root.querySelector('[data-release]');
  if (release) release.addEventListener('click', async () => {
    const f = currentFacility();
    if (!f) return;
    await persist('release', { name: f.name });
  });
  const saveFac = root.querySelector('[data-save-facility]');
  if (saveFac) saveFac.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = currentFacility();
    if (!f) return;
    const fd = Object.fromEntries(new FormData(saveFac).entries());
    const openCal = Boolean(e.submitter && e.submitter.dataset.openCalendar);
    if (!fd.actionKind && (fd.nextDate || fd.nextStep)) fd.actionKind = inferActionKind({ ...f, ...fd }) || 'callback';
    if (!clean(fd.nextStep) && fd.actionKind) fd.nextStep = ACTION_DEFAULT_NOTE[fd.actionKind] || '';
    const meta = actionKindMeta(fd.actionKind);
    if (meta && meta.status) fd.status = meta.status;
    if (fd.actionKind === 'waitlist-check' && !clean(fd.waitlistDate)) fd.waitlistDate = toIsoDate(new Date());
    if (meta && !meta.timed) fd.actionTime = '';
    if (openCal && !parseDate(fd.nextDate)) {
      toast('Pick a follow-up date first.');
      return;
    }
    const note = clean(fd.note);
    Object.assign(f, fd, { latestNote: note || f.latestNote, lastBy: state.who, lastAt: new Date().toLocaleString() });
    if (openCal) {
      const href = calendarEventHref(f);
      if (href) window.open(href, '_blank', 'noopener');
    }
    if (note) prependLog(f.name, 'Logged a call', note, f.status);
    const payload = { name: f.name, ...fd };
    if (note) {
      payload.note = note;
      payload.latestNote = note;
      payload.actionLabel = 'Logged a call';
    }
    await persist(note ? 'note' : 'save', payload, () => {});
  });
}

boot();
let wasMobile = isMobileCarousel();
window.addEventListener('resize', () => {
  const now = isMobileCarousel();
  if (now !== wasMobile) {
    wasMobile = now;
    if (!state.facilityName) render();
    return;
  }
  if (state.facilityName) return;
  if (now) restoreCarousel(listedFacilities());
});
