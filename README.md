# Garbage Day Calendar

A Home Screens plugin that works like the built-in **Garbage Day** module, but takes its
pickup days from your city's or hauler's collection calendar (an ICS feed) instead of a
fixed weekly schedule. A regular expression for each row decides which calendar events
count as trash, recycling or yard waste, so holiday shifts, every-other-week recycling
and seasonal yard waste come straight from the calendar.

Each row shows the next pickup its pattern matches, in the built-in module's words
(Today, Tomorrow, Thursday, Next Thursday, then a date). The row lights up the day
before pickup, or on the day if you prefer.

## Setup

1. Install the plugin (`npm run pack` makes `plugin.tar.gz`; use **Install from URL…**,
   or copy `manifest.json` and `dist/bundle.js` into `data/plugins/hs-garbage-feed/`).
2. Drop **Garbage Day Calendar** on a screen.
3. Paste your collection calendar's address into **Calendar address**. It usually ends
   in `.ics`; a `webcal://` link works too.
4. Adjust each row's **Match pattern** to fit your calendar's event titles, or empty a
   pattern to hide that row.

## Match patterns

Each pattern is a regular expression tested against every event's title (`SUMMARY`),
ignoring case. One event can light up more than one row, so an event called
"Garbage & Recycling" matches both of the defaults below.

| Row | Default pattern |
|---|---|
| Trash | `trash\|garbage\|refuse\|rubbish` |
| Recycling | `recycl` |
| Yard Waste | `yard\|green\|garden\|compost\|organic\|leaf\|leaves\|brush` |

Some examples:

- `^garbage` only matches titles that start with "Garbage".
- `\bblue\b` matches "Blue Bin" but not "Bluebell".
- `recycl(?!.*cancel)` skips titles that mention a cancellation.

A pattern that isn't a valid regular expression leaves its row saying
"Check this row's match pattern".

## Module options

| Field | Default | What it does |
|---|---|---|
| `feedUrl` | empty | The ICS calendar address (`https://`, `http://` or `webcal://`) |
| `refreshMinutes` | 60 | How often to fetch the calendar again |
| `trashPattern`, `recyclingPattern`, `yardPattern` | see above | Regex per row; empty hides the row |
| `trashLabel`, `recyclingLabel`, `yardLabel` | Trash, Recycling, Yard Waste | Row names |
| `trashColor`, `recyclingColor`, `yardColor` | `#6ee7b7`, `#93c5fd`, `#fbbf24` | Icon colors |
| `title` | Collection Schedule | Heading text |
| `showTitle` | on | Show the heading |
| `highlightMode` | `day-before` | `day-before` or `day-of` |

## What the calendar reader understands

Single events, plus repeating ones (`RRULE` with `DAILY`, `WEEKLY` with `BYDAY`,
`MONTHLY` by date or by weekday such as `1MO`, and `YEARLY`, with `INTERVAL`, `COUNT`
and `UNTIL`). Skipped dates (`EXDATE`), moved occurrences (`RECURRENCE-ID`) and
cancelled events are honoured. Times in UTC are placed on the right day in the
household's time zone. Rows look 120 days ahead.

The feed is fetched through the hub's plugin proxy. Because the address can be any
site, the plugin declares the `localNetwork` permission, which the proxy requires for
a wildcard domain list.

## Develop

```bash
npm install
npm test        # calendar and matching rules
npm run build   # dist/bundle.js
npm run dev     # serve on :5173 for the editor's Developer tab
```

## Releases

`.github/workflows/release.yml` runs on every push to `main`: it installs, type-checks,
runs the tests and runs `npm run pack`. When the `version` in `manifest.json` has no
release yet, it publishes release `v<version>` with `plugin.tar.gz` and its SHA-256
attached (a version with a `-` such as `1.1.0-beta.1` is marked as a pre-release).
A push that doesn't bump the version builds and tests but publishes nothing.

To ship a new version, bump `version` in both `manifest.json` and `package.json`
(the workflow fails if they differ) and push. Install it with **Install from URL…**
using `https://github.com/<owner>/<repo>/releases/download/v{version}/plugin.tar.gz`
so the editor can follow later versions.
