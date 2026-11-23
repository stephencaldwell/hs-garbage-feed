import { describe, expect, it } from 'vitest';
import { addDays, icsDateKey, isCalendar, occurrences, parseIcs, todayKey, weekday } from './ics';
import { compilePattern, isHighlighted, nextPickup, whenText } from './pickups';

const cal = (...events: string[]) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', ...events, 'END:VCALENDAR'].join('\r\n');
const event = (...lines: string[]) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT'].join('\r\n');

describe('dates', () => {
  it('does day arithmetic across months and years', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(weekday('2026-11-23')).toBe(1); // a Monday
  });

  it('reads date and date-time values', () => {
    expect(icsDateKey('20261124')).toBe('2026-11-24');
    expect(icsDateKey('20261124T070000')).toBe('2026-11-24');
    // 02:00 UTC is still the evening before in New York.
    expect(icsDateKey('20261124T020000Z', 'America/New_York')).toBe('2026-11-23');
    expect(icsDateKey('nonsense')).toBeNull();
  });

  it('finds today in the household time zone', () => {
    const now = new Date('2026-11-24T03:00:00Z');
    expect(todayKey(now, 'America/New_York')).toBe('2026-11-23');
    expect(todayKey(now, 'Europe/Berlin')).toBe('2026-11-24');
  });
});

describe('parseIcs', () => {
  it('reads events, unfolds long lines and unescapes text', () => {
    const text = cal(
      event('UID:1', 'DTSTART;VALUE=DATE:20261124', 'SUMMARY:Garbage\\, Recycling', 'DESCRIPTION:Put bins out\\nby 7', ' am'),
      event('UID:2', 'DTSTART;TZID="America/New_York":20261125T060000', 'SUMMARY:Yard', '  waste'),
    );
    const events = parseIcs(text);
    expect(events.map((e) => [e.date, e.summary])).toEqual([
      ['2026-11-24', 'Garbage, Recycling'],
      ['2026-11-25', 'Yard waste'],
    ]);
    expect(events[0].description).toBe('Put bins out by 7am');
  });

  it('ignores alarms and events without a date', () => {
    const text = cal(
      event('UID:1', 'DTSTART:20261124', 'SUMMARY:Trash', 'BEGIN:VALARM', 'SUMMARY:Reminder', 'END:VALARM'),
      event('UID:2', 'SUMMARY:No date'),
    );
    expect(parseIcs(text).map((e) => e.summary)).toEqual(['Trash']);
  });

  it('knows a calendar from something else', () => {
    expect(isCalendar(cal())).toBe(true);
    expect(isCalendar('<html>Not found</html>')).toBe(false);
  });
});

describe('occurrences', () => {
  const list = (text: string, from: string, to: string) =>
    occurrences(parseIcs(text), from, to).map((o) => `${o.date} ${o.summary}`);

  it('keeps single events in the window, soonest first', () => {
    const text = cal(
      event('UID:b', 'DTSTART:20261201', 'SUMMARY:Recycling'),
      event('UID:a', 'DTSTART:20261124', 'SUMMARY:Trash'),
      event('UID:c', 'DTSTART:20261101', 'SUMMARY:Old'),
    );
    expect(list(text, '2026-11-23', '2027-01-01')).toEqual(['2026-11-24 Trash', '2026-12-01 Recycling']);
  });

  it('expands weekly and every-other-week series', () => {
    const text = cal(
      event('UID:t', 'DTSTART;VALUE=DATE:20260105', 'RRULE:FREQ=WEEKLY', 'SUMMARY:Trash'),
      event('UID:r', 'DTSTART;VALUE=DATE:20260105', 'RRULE:FREQ=WEEKLY;INTERVAL=2', 'SUMMARY:Recycling'),
    );
    expect(list(text, '2026-11-23', '2026-12-07')).toEqual([
      '2026-11-23 Recycling',
      '2026-11-23 Trash',
      '2026-11-30 Trash',
      '2026-12-07 Recycling',
      '2026-12-07 Trash',
    ]);
  });

  it('honours BYDAY, COUNT and UNTIL', () => {
    const text = cal(
      event('UID:a', 'DTSTART:20261123', 'RRULE:FREQ=WEEKLY;BYDAY=MO,TH;COUNT=3', 'SUMMARY:Twice'),
      event('UID:b', 'DTSTART:20261123', 'RRULE:FREQ=DAILY;UNTIL=20261125T235959Z', 'SUMMARY:Daily'),
    );
    expect(list(text, '2026-11-01', '2026-12-31')).toEqual([
      '2026-11-23 Daily',
      '2026-11-23 Twice',
      '2026-11-24 Daily',
      '2026-11-25 Daily',
      '2026-11-26 Twice',
      '2026-11-30 Twice',
    ]);
  });

  it('expands monthly rules by weekday and by date', () => {
    const text = cal(
      event('UID:a', 'DTSTART:20261102', 'RRULE:FREQ=MONTHLY;BYDAY=1MO', 'SUMMARY:First Monday'),
      event('UID:b', 'DTSTART:20261031', 'RRULE:FREQ=MONTHLY', 'SUMMARY:The 31st'),
    );
    expect(list(text, '2026-11-01', '2027-01-31')).toEqual([
      '2026-11-02 First Monday',
      '2026-12-07 First Monday',
      '2026-12-31 The 31st',
      '2027-01-04 First Monday',
      '2027-01-31 The 31st',
    ]);
  });

  it('skips EXDATEs, cancelled events and moved occurrences', () => {
    const text = cal(
      event('UID:s', 'DTSTART:20261123', 'RRULE:FREQ=WEEKLY', 'EXDATE:20261130', 'SUMMARY:Trash'),
      // The holiday week: the 7th moves to the 8th.
      event('UID:s', 'RECURRENCE-ID:20261207', 'DTSTART:20261208', 'SUMMARY:Trash (holiday)'),
      event('UID:x', 'DTSTART:20261125', 'STATUS:CANCELLED', 'SUMMARY:Yard'),
    );
    expect(list(text, '2026-11-23', '2026-12-14')).toEqual([
      '2026-11-23 Trash',
      '2026-12-08 Trash (holiday)',
      '2026-12-14 Trash',
    ]);
  });
});

describe('pickups', () => {
  const events = occurrences(parseIcs(cal(
    event('UID:1', 'DTSTART:20261124', 'SUMMARY:Garbage and Recycling'),
    event('UID:2', 'DTSTART:20261126', 'SUMMARY:Garbage'),
    event('UID:3', 'DTSTART:20261203', 'SUMMARY:Yard Waste'),
  )), '2026-11-23', '2027-01-31');

  it('finds the next pickup each pattern matches, ignoring case', () => {
    const trash = compilePattern('garbage|trash');
    expect(nextPickup(events, trash, '2026-11-23')?.date).toBe('2026-11-24');
    expect(nextPickup(events, trash, '2026-11-25')?.date).toBe('2026-11-26');
    expect(nextPickup(events, compilePattern('recycl'), '2026-11-25')).toBeNull();
    expect(nextPickup(events, compilePattern('^yard'), '2026-11-23')?.date).toBe('2026-12-03');
  });

  it('turns a row off when empty and flags a broken pattern', () => {
    expect(compilePattern('  ').kind).toBe('off');
    expect(compilePattern(undefined).kind).toBe('off');
    expect(compilePattern('(unclosed').kind).toBe('bad');
  });

  it('highlights on the day or the day before', () => {
    expect(isHighlighted('2026-11-24', '2026-11-24', 'day-of')).toBe(true);
    expect(isHighlighted('2026-11-24', '2026-11-23', 'day-of')).toBe(false);
    expect(isHighlighted('2026-11-24', '2026-11-23', 'day-before')).toBe(true);
    expect(isHighlighted('2026-11-24', '2026-11-24', 'day-before')).toBe(false);
  });

  it('says how far off a pickup is', () => {
    const names = {
      today: 'Today', tomorrow: 'Tomorrow',
      weekdays: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
      shortDate: (d: string) => `on ${d}`,
    };
    expect(whenText('2026-11-23', '2026-11-23', names)).toBe('Today');
    expect(whenText('2026-11-24', '2026-11-23', names)).toBe('Tomorrow');
    expect(whenText('2026-11-26', '2026-11-23', names)).toBe('Thursday');
    expect(whenText('2026-12-03', '2026-11-23', names)).toBe('Next Thursday');
    expect(whenText('2026-12-10', '2026-11-23', names)).toBe('on 2026-12-10');
  });
});
