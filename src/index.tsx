import React from 'react';
import type { PluginComponentProps } from './hs-plugin';
import { hostFrameStyle } from './host-style';
import { addDays, isCalendar, occurrences, parseIcs, todayKey, type DateKey } from './ics';
import {
  compilePattern,
  isHighlighted,
  nextPickup,
  whenText,
  type DayNames,
  type HighlightMode,
  type Kind,
  type Matcher,
} from './pickups';

const PLUGIN_ID = 'hs-garbage-feed';
/** How far ahead to look for each row's next pickup. */
const LOOKAHEAD_DAYS = 120;

// The built-in module's text tiers, and its ink mixed from the text color.
const OPACITY = { primary: 1, secondary: 0.6, tertiary: 0.35 } as const;
const ink = (alpha: number) => `color-mix(in srgb, var(--module-ink, currentcolor) ${Math.round(alpha * 100)}%, transparent)`;

type Problem = 'no-feed' | 'bad-address' | 'not-calendar' | 'unreachable';

const PROBLEM_TEXT: Record<Problem, string> = {
  'no-feed': 'Add your collection calendar’s address in module settings',
  'bad-address': 'The calendar address should start with https://',
  'not-calendar': 'That address isn’t a calendar',
  unreachable: 'Can’t reach the collection calendar right now',
};

/** The feed address as something the proxy can fetch: webcal:// is the
 *  same calendar over https. */
function feedAddress(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const value = raw.trim().replace(/^webcals?:\/\//i, 'https://');
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Fetches the calendar through the host proxy, keeping the last good copy
 *  through a failed refresh so a network blip doesn't blank the wall. */
function useFeed(url: string | null, refreshMs: number) {
  const [text, setText] = React.useState<string | null>(null);
  const [problem, setProblem] = React.useState<Problem | null>(null);
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    setText(null);
    setLoaded(false);
    if (!url) { setProblem(null); setLoaded(true); return; }
    let alive = true;
    const maybeSdk = window.__HS_SDK__;
    if (!maybeSdk) return;
    const sdk = maybeSdk;

    async function load() {
      try {
        const res = await sdk.pluginFetch(PLUGIN_ID, {
          url: url!,
          headers: { Accept: 'text/calendar, text/plain, */*' },
          // Let the proxy share one copy between every instance on the wall.
          cacheTtlMs: Math.max(60_000, refreshMs - 60_000),
        });
        if (!alive) return;
        if (!res.ok) {
          setProblem('unreachable');
        } else {
          const body = await res.text();
          if (!alive) return;
          if (isCalendar(body)) { setText(body); setProblem(null); }
          else { setText(null); setProblem('not-calendar'); }
        }
      } catch {
        if (alive) setProblem('unreachable');
      }
      if (alive) setLoaded(true);
    }

    load();
    const id = setInterval(load, refreshMs);
    return () => { alive = false; clearInterval(id); };
  }, [url, refreshMs]);

  return { text, problem, loaded };
}

/** Today's date in the household's time zone, rechecked every minute. */
function useToday(timeZone?: string): DateKey {
  const [today, setToday] = React.useState(() => todayKey(new Date(), timeZone));
  React.useEffect(() => {
    const check = () => setToday(todayKey(new Date(), timeZone));
    check();
    const id = setInterval(check, 60_000);
    return () => clearInterval(id);
  }, [timeZone]);
  return today;
}

function useDayNames(): DayNames {
  return React.useMemo(() => {
    const at = (key: DateKey) => {
      const [y, m, d] = key.split('-').map(Number);
      return new Date(Date.UTC(y, m - 1, d, 12));
    };
    const long = new Intl.DateTimeFormat(undefined, { weekday: 'long', timeZone: 'UTC' });
    const short = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
    // 2026-11-22 is a Sunday.
    const weekdays = Array.from({ length: 7 }, (_, i) => long.format(at(addDays('2026-11-22', i))));
    return { today: 'Today', tomorrow: 'Tomorrow', weekdays, shortDate: (key) => short.format(at(key)) };
  }, []);
}

function longDate(key: DateKey): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(y, m - 1, d, 12)));
}

// ── Icons (the built-in Garbage Day module's own) ───────────────────────

function Icon({ kind, active, color }: { kind: Kind; active: boolean; color: string }) {
  const common = {
    width: '1.5em', height: '1.5em', viewBox: '0 0 24 24', fill: 'none', stroke: color,
    strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
    style: { opacity: active ? OPACITY.primary : OPACITY.tertiary, flexShrink: 0 },
  };
  if (kind === 'recycling') {
    return (
      <svg {...common} strokeWidth={2}>
        <path d="M12 17l-2 2 2 2" />
        <path d="M10 19h9a2 2 0 0 0 1.75-2.75l-.55-1" />
        <path d="M8.536 11l-.732-2.732-2.732.732" />
        <path d="M7.804 8.268l-4.5 7.794a2 2 0 0 0 1.506 2.89l1.141.048" />
        <path d="M15.464 11l2.732.732.732-2.732" />
        <path d="M18.196 11.732l-4.5-7.794a2 2 0 0 0-3.256-.14l-.591.976" />
      </svg>
    );
  }
  if (kind === 'yard') {
    return (
      <svg {...common} strokeWidth={1.5}>
        <path d="M17 8C8 10 5.9 16.17 3.82 21.34l1.89.66.95-2.3c.48.17.98.3 1.34.3C19 20 22 3 22 3c-1 2-8 2.25-13 3.25S2 11.5 2 13.5s1.75 3.75 1.75 3.75" />
      </svg>
    );
  }
  return (
    <svg {...common} strokeWidth={1.5}>
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <rect x="5" y="6" width="14" height="15" rx="2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

// ── Rows ─────────────────────────────────────────────────────────────────

interface RowSpec {
  kind: Kind;
  label: string;
  color: string;
  matcher: Matcher;
}

/** The manifest's defaults, used when a config has no value saved. An
 *  empty pattern that was saved still hides its row. */
const ROW_DEFAULTS: Record<Kind, { label: string; color: string; pattern: string }> = {
  trash: { label: 'Trash', color: '#6ee7b7', pattern: 'trash|garbage|refuse|rubbish' },
  recycling: { label: 'Recycling', color: '#93c5fd', pattern: 'recycl' },
  yard: { label: 'Yard Waste', color: '#fbbf24', pattern: 'yard|green|garden|compost|organic|leaf|leaves|brush' },
};

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function Row({ row, date, today, mode, names }: {
  row: RowSpec;
  date: DateKey | null;
  today: DateKey;
  mode: HighlightMode;
  names: DayNames;
}) {
  const active = date !== null && isHighlighted(date, today, mode);
  const detail = row.matcher.kind === 'bad'
    ? 'Check this row’s match pattern'
    : date ? longDate(date) : 'Nothing on the calendar';
  const when = date ? whenText(date, today, names) : '';

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: '0.5em',
        padding: '0.42em 0.5em', borderRadius: '0.33em',
        background: active ? ink(0.1) : 'transparent',
        border: `1px solid ${active ? ink(0.15) : 'transparent'}`,
      }}
    >
      <Icon kind={row.kind} active={active} color={row.color} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontWeight: 500, fontSize: '0.95em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', opacity: active ? OPACITY.primary : OPACITY.secondary }}>
          {row.label}
        </p>
        <p style={{ margin: 0, fontSize: '0.75em', opacity: active ? OPACITY.secondary : OPACITY.tertiary }}>
          {detail}
        </p>
      </div>
      {active ? (
        <span style={{ flexShrink: 0, padding: '0.15em 0.6em', borderRadius: 999, fontWeight: 600, fontSize: '0.6em', textTransform: 'uppercase', letterSpacing: '0.05em', background: ink(0.15) }}>
          {when}
        </span>
      ) : when ? (
        <span style={{ flexShrink: 0, fontSize: '0.7em', opacity: OPACITY.tertiary }}>{when}</span>
      ) : null}
    </div>
  );
}

export default function GarbageFeed({ config, style, timezone }: PluginComponentProps) {
  const rawUrl = typeof config.feedUrl === 'string' ? config.feedUrl.trim() : '';
  const url = feedAddress(rawUrl);
  const refreshMinutes = Number(config.refreshMinutes);
  const refreshMs = (Number.isFinite(refreshMinutes) && refreshMinutes >= 15 ? refreshMinutes : 60) * 60_000;
  const mode: HighlightMode = config.highlightMode === 'day-of' ? 'day-of' : 'day-before';

  const today = useToday(timezone);
  const names = useDayNames();
  const { text: feed, problem: feedProblem, loaded } = useFeed(url, refreshMs);
  const problem: Problem | null = !rawUrl ? 'no-feed' : !url ? 'bad-address' : feedProblem;

  // Parsed once per copy of the feed, expanded once per day.
  const events = React.useMemo(() => (feed ? parseIcs(feed, timezone) : []), [feed, timezone]);
  const upcoming = React.useMemo(
    () => occurrences(events, today, addDays(today, LOOKAHEAD_DAYS)),
    [events, today],
  );

  const rows: RowSpec[] = (['trash', 'recycling', 'yard'] as Kind[])
    .map((kind) => ({
      kind,
      label: text(config[`${kind}Label`], ROW_DEFAULTS[kind].label),
      color: text(config[`${kind}Color`], ROW_DEFAULTS[kind].color),
      matcher: compilePattern(config[`${kind}Pattern`] ?? ROW_DEFAULTS[kind].pattern),
    }))
    .filter((row) => row.matcher.kind !== 'off');

  const frame: React.CSSProperties = {
    ...hostFrameStyle(style, { baseFontSize: 24 }),
    display: 'flex',
    flexDirection: 'column',
  };

  // Without a copy of the feed the rows have nothing true to say.
  const message = problem && !feed
    ? PROBLEM_TEXT[problem]
    : !loaded
      ? 'Loading…'
      : rows.length === 0
        ? 'Add a match pattern for trash, recycling or yard waste'
        : null;

  return (
    <div style={frame}>
      {config.showTitle !== false && (
        <span style={{ fontSize: '0.7em', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', opacity: OPACITY.secondary, marginBottom: '0.6em' }}>
          {text(config.title, 'Collection Schedule')}
        </span>
      )}
      {message ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p style={{ margin: 0, textAlign: 'center', fontSize: '0.85em', opacity: OPACITY.tertiary }}>{message}</p>
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '0.25em' }}>
          {rows.map((row) => (
            <Row
              key={row.kind}
              row={row}
              date={nextPickup(upcoming, row.matcher, today)?.date ?? null}
              today={today}
              mode={mode}
              names={names}
            />
          ))}
          {problem === 'unreachable' && (
            <p style={{ margin: '0.3em 0 0', textAlign: 'center', fontSize: '0.6em', opacity: OPACITY.tertiary }}>
              Not updating right now
            </p>
          )}
        </div>
      )}
    </div>
  );
}
