# LCP Hours — Time Tracker

A small web app for tracking hours at Leggett Capital Partners and handing Ashley a
clean, pay-period report every payroll.

Built to match how LCP payroll actually runs:

- Pay periods are **1st–15th** and **16th–end of month**
- Target is **30 hrs/week**, prorated across the weekdays in each period
- Ashley gets a per-day breakdown with a total, rounded to the nearest quarter hour

## What it does

- **Live timer** — start/stop, with an optional note. Keeps running if you close the
  tab or reload the page.
- **Manual entry** — log a block by start/end time (hours auto-compute) or just type
  total hours.
- **Automatic pay-period bucketing** — entries land in the right half-month; arrows
  move between periods.
- **Progress vs target** — hours this period, prorated target, over/under, and average
  hours per week.
- **Report for Ashley** — formatted per-day summary with a total. Copy it, open a
  pre-filled email, or download a CSV. All three tie to the same numbers.

## Files

| File | Purpose |
|---|---|
| `index.html` | Markup |
| `styles.css` | LCP navy/teal styling, responsive |
| `app.js` | All app logic — periods, timer, entries, report |
| `sync-config.js` | Optional cross-device sync (off by default) |

No build step, no dependencies. Open `index.html` and it works.

## Storage

By default everything is saved in the browser you're using (`localStorage`), so hours
logged on your laptop don't appear on your phone. The header badge reads
**"This device only"** when that's the case.

To sync across devices, follow the step-by-step instructions at the top of
`sync-config.js` — it's a free Firebase project, about 3 minutes, no credit card. Once
the config is filled in, the badge reads **"Synced"** and your hours follow you
everywhere.

**Note:** the quick setup uses Firestore *test mode*, which leaves the database open to
anyone who has your config values and expires after 30 days. That's the trade-off for
having no login. Set `DOC_ID` to a long random string rather than a guessable name, and
see the comments in `sync-config.js`.

## Settings

At the bottom of the report card:

- **Your name** — appears in the report header and CSV filename
- **Ashley's email** — prefills the "Email to Ashley" button
- **Target/wk** — defaults to 30

## Rounding

The **Round to nearest ¼ hr** toggle rounds each *day's* total, not each entry, so the
day rows always add up to the reported total. The on-screen "hours this period" stat
always shows exact unrounded time; the report is what's rounded.
