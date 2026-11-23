// Which pickup each row shows, and how its date reads. Pure, so it's tested.

import { addDays, dayNumber, weekday, type DateKey, type Occurrence } from './ics';

export type Kind = 'trash' | 'recycling' | 'yard';
export type HighlightMode = 'day-of' | 'day-before';

export type Matcher =
  | { kind: 'off' }
  | { kind: 'bad' }
  | { kind: 'ok'; regex: RegExp };

/** A row's pattern as a case-insensitive regex. An empty pattern turns the
 *  row off; one that isn't a valid regex is reported so the row can say so. */
export function compilePattern(pattern: unknown): Matcher {
  if (typeof pattern !== 'string' || !pattern.trim()) return { kind: 'off' };
  try {
    return { kind: 'ok', regex: new RegExp(pattern.trim(), 'i') };
  } catch {
    return { kind: 'bad' };
  }
}

/** The soonest pickup on or after `today` whose event title matches. */
export function nextPickup(list: Occurrence[], matcher: Matcher, today: DateKey): Occurrence | null {
  if (matcher.kind !== 'ok') return null;
  return list.find((o) => o.date >= today && matcher.regex.test(o.summary)) ?? null;
}

/** Whether the row should stand out: on pickup day, or the evening before
 *  when the bins go out. */
export function isHighlighted(date: DateKey, today: DateKey, mode: HighlightMode): boolean {
  return mode === 'day-of' ? date === today : date === addDays(today, 1);
}

export interface DayNames {
  today: string;
  tomorrow: string;
  /** Full weekday names, Sunday first. */
  weekdays: string[];
  /** A short date for pickups two weeks or more away. */
  shortDate: (date: DateKey) => string;
}

/** How far off a pickup is, in the built-in Garbage Day module's words:
 *  Today, Tomorrow, a weekday within the week, "Next Monday", then a date. */
export function whenText(date: DateKey, today: DateKey, names: DayNames): string {
  const days = dayNumber(date) - dayNumber(today);
  if (days <= 0) return names.today;
  if (days === 1) return names.tomorrow;
  const day = names.weekdays[weekday(date)];
  if (days <= 6) return day;
  if (days <= 13) return `Next ${day}`;
  return names.shortDate(date);
}
