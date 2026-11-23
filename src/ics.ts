// A small ICS reader for collection calendars: enough of RFC 5545 to turn a
// city's or hauler's feed into a list of dated pickups. Everything works in
// calendar dates ("2026-11-24"), never instants, because a pickup is a day.

/** A calendar date as `YYYY-MM-DD`. */
export type DateKey = string;

export interface IcsEvent {
  uid: string;
  summary: string;
  description: string;
  /** The date the event (or the first of its series) falls on. */
  date: DateKey;
  rrule: Record<string, string> | null;
  exdates: Set<DateKey>;
  /** Set on an edited single occurrence of a series: the date it replaces. */
  recurrenceId: DateKey | null;
  cancelled: boolean;
}

export interface Occurrence {
  date: DateKey;
  summary: string;
  description: string;
}

// ── Dates ────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

function keyFromParts(y: number, m: number, d: number): DateKey {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Days since 1970-01-01 for a date key; the unit all date arithmetic uses. */
export function dayNumber(key: DateKey): number {
  const [y, m, d] = key.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

export function keyFromDayNumber(n: number): DateKey {
  const d = new Date(n * DAY_MS);
  return keyFromParts(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function addDays(key: DateKey, days: number): DateKey {
  return keyFromDayNumber(dayNumber(key) + days);
}

/** 0 = Sunday through 6 = Saturday. */
export function weekday(key: DateKey): number {
  return (dayNumber(key) + 4) % 7; // 1970-01-01 was a Thursday
}

/** Today's date in a time zone, falling back to the device's own. */
export function todayKey(now: Date, timeZone?: string): DateKey {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || undefined, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(now);
    if (/^\d{4}-\d{2}-\d{2}$/.test(parts)) return parts;
  } catch { /* unknown time zone: use the device's */ }
  return keyFromParts(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** The date an ICS date or date-time value falls on. A UTC time (`...Z`) is
 *  moved into the household time zone first; a local or floating time
 *  already names its own date. */
export function icsDateKey(value: string, timeZone?: string): DateKey | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, hh, mm, ss, z] = m;
  if (z) {
    const instant = new Date(Date.UTC(+y, +mo - 1, +d, +hh, +mm, +(ss ?? 0)));
    return todayKey(instant, timeZone);
  }
  return keyFromParts(+y, +mo, +d);
}

// ── Parsing ──────────────────────────────────────────────────────────────

interface ContentLine {
  name: string;
  value: string;
}

/** Splits `NAME;PARAM=x:value` at the first colon outside quotes. */
function parseLine(line: string): ContentLine | null {
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') quoted = !quoted;
    else if (c === ':' && !quoted) {
      const name = line.slice(0, i).split(';')[0].trim().toUpperCase();
      return name ? { name, value: line.slice(i + 1) } : null;
    }
  }
  return null;
}

function unescapeText(value: string): string {
  return value
    .replace(/\\[nN]/g, ' ')
    .replace(/\\([,;\\])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseRrule(value: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of value.split(';')) {
    const [k, v] = part.split('=');
    if (k && v) out[k.trim().toUpperCase()] = v.trim().toUpperCase();
  }
  return out;
}

/** True when the text looks like an ICS calendar at all. */
export function isCalendar(text: string): boolean {
  return /BEGIN:VCALENDAR/i.test(text);
}

/** Every event in an ICS document. Nested components (alarms) are ignored,
 *  and events without a readable start date are skipped. */
export function parseIcs(text: string, timeZone?: string): IcsEvent[] {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const events: IcsEvent[] = [];
  let current: Partial<IcsEvent> & { exdates?: Set<DateKey> } | null = null;
  let depth = 0;

  for (const raw of lines) {
    const line = parseLine(raw);
    if (!line) continue;
    const upper = line.value.trim().toUpperCase();

    if (line.name === 'BEGIN') {
      if (upper === 'VEVENT' && !current) { current = { exdates: new Set() }; depth = 0; }
      else if (current) depth++;
      continue;
    }
    if (line.name === 'END') {
      if (current && depth > 0) { depth--; continue; }
      if (current && upper === 'VEVENT') {
        if (current.date) {
          events.push({
            uid: current.uid ?? '',
            summary: current.summary ?? '',
            description: current.description ?? '',
            date: current.date,
            rrule: current.rrule ?? null,
            exdates: current.exdates ?? new Set(),
            recurrenceId: current.recurrenceId ?? null,
            cancelled: current.cancelled ?? false,
          });
        }
        current = null;
      }
      continue;
    }
    if (!current || depth > 0) continue;

    switch (line.name) {
      case 'UID': current.uid = line.value.trim(); break;
      case 'SUMMARY': current.summary = unescapeText(line.value); break;
      case 'DESCRIPTION': current.description = unescapeText(line.value); break;
      case 'DTSTART': current.date = icsDateKey(line.value, timeZone) ?? undefined; break;
      case 'RRULE': current.rrule = parseRrule(line.value); break;
      case 'RECURRENCE-ID': current.recurrenceId = icsDateKey(line.value, timeZone); break;
      case 'STATUS': current.cancelled = upper === 'CANCELLED'; break;
      case 'EXDATE':
        for (const v of line.value.split(',')) {
          const key = icsDateKey(v, timeZone);
          if (key) current.exdates!.add(key);
        }
        break;
    }
  }
  return events;
}

// ── Recurrence ───────────────────────────────────────────────────────────

const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
/** Generation stops after this many dates so a bad rule can't hang the wall. */
const MAX_STEPS = 5000;

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** The dates in one month that a MONTHLY rule's BYDAY (`1MO`, `-1FR`, `TU`)
 *  or plain day-of-month picks. */
function monthDates(y: number, m: number, byDay: string | undefined, dayOfMonth: number): DateKey[] {
  const last = daysInMonth(y, m);
  if (!byDay) return dayOfMonth <= last ? [keyFromParts(y, m, dayOfMonth)] : [];
  const out: DateKey[] = [];
  for (const token of byDay.split(',')) {
    const t = /^([+-]?\d+)?([A-Z]{2})$/.exec(token);
    if (!t) continue;
    const wd = WEEKDAYS.indexOf(t[2]);
    if (wd < 0) continue;
    const matches: number[] = [];
    for (let d = 1; d <= last; d++) if (weekday(keyFromParts(y, m, d)) === wd) matches.push(d);
    if (!t[1]) { matches.forEach((d) => out.push(keyFromParts(y, m, d))); continue; }
    const n = Number(t[1]);
    const d = n > 0 ? matches[n - 1] : matches[matches.length + n];
    if (d) out.push(keyFromParts(y, m, d));
  }
  return out.sort();
}

/** Every date a series produces from its start, in order, until `end`. */
function seriesDates(start: DateKey, rule: Record<string, string>, end: DateKey): DateKey[] {
  const interval = Math.max(1, Number(rule.INTERVAL) || 1);
  const count = rule.COUNT ? Number(rule.COUNT) : Infinity;
  const untilRaw = rule.UNTIL ? /^(\d{8})/.exec(rule.UNTIL)?.[1] : undefined;
  const until = untilRaw ? icsDateKey(untilRaw) : null;
  const stop = until && until < end ? until : end;
  const out: DateKey[] = [];
  const push = (key: DateKey) => {
    if (key < start || key > stop || out.length >= count) return false;
    out.push(key);
    return true;
  };
  const startDay = dayNumber(start);
  const [sy, sm, sd] = start.split('-').map(Number);

  switch (rule.FREQ) {
    case 'DAILY':
      for (let i = 0; i < MAX_STEPS; i++) {
        const key = keyFromDayNumber(startDay + i * interval);
        if (key > stop || out.length >= count) break;
        push(key);
      }
      break;
    case 'WEEKLY': {
      const days = (rule.BYDAY ? rule.BYDAY.split(',') : [WEEKDAYS[weekday(start)]])
        .map((d) => WEEKDAYS.indexOf(d.replace(/^[+-]?\d+/, '')))
        .filter((d) => d >= 0)
        // Weeks start on Monday (the ICS default), so order Mon..Sun.
        .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
      const weekStart = startDay - ((weekday(start) + 6) % 7);
      for (let w = 0; w < MAX_STEPS; w++) {
        const base = weekStart + w * 7 * interval;
        if (keyFromDayNumber(base) > stop || out.length >= count) break;
        for (const d of days) push(keyFromDayNumber(base + ((d + 6) % 7)));
      }
      break;
    }
    case 'MONTHLY':
      for (let i = 0; i < MAX_STEPS; i++) {
        const total = sm - 1 + i * interval;
        const y = sy + Math.floor(total / 12);
        const m = (total % 12) + 1;
        if (keyFromParts(y, m, 1) > stop || out.length >= count) break;
        for (const key of monthDates(y, m, rule.BYDAY, sd)) push(key);
      }
      break;
    case 'YEARLY':
      for (let i = 0; i < MAX_STEPS; i++) {
        const y = sy + i * interval;
        if (keyFromParts(y, 1, 1) > stop || out.length >= count) break;
        if (sd <= daysInMonth(y, sm)) push(keyFromParts(y, sm, sd));
      }
      break;
    default:
      push(start);
  }
  return out;
}

/** Every pickup between `from` and `to` (inclusive), soonest first. Series
 *  are expanded; skipped dates (EXDATE), edited occurrences (RECURRENCE-ID)
 *  and cancelled events are honoured. */
export function occurrences(events: IcsEvent[], from: DateKey, to: DateKey): Occurrence[] {
  const replaced = new Map<string, Set<DateKey>>();
  for (const e of events) {
    if (e.recurrenceId && e.uid) {
      if (!replaced.has(e.uid)) replaced.set(e.uid, new Set());
      replaced.get(e.uid)!.add(e.recurrenceId);
    }
  }

  const out: Occurrence[] = [];
  for (const e of events) {
    if (e.cancelled) continue;
    const skip = e.recurrenceId ? null : replaced.get(e.uid);
    const dates = e.rrule && !e.recurrenceId ? seriesDates(e.date, e.rrule, to) : [e.date];
    for (const date of dates) {
      if (date < from || date > to) continue;
      if (e.exdates.has(date) || skip?.has(date)) continue;
      out.push({ date, summary: e.summary, description: e.description });
    }
  }
  const order = (a: Occurrence, b: Occurrence) =>
    a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.summary.localeCompare(b.summary);
  return out.sort(order);
}
