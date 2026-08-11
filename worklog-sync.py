#!/usr/bin/env python3
"""
Pull the day's "## Work Log" out of the Obsidian daily note and sync it to the
LCP Hours timesheet, so the report to Ashley says what was actually worked on.

Runs unattended from launchd at 5pm. Standard library only, on purpose: a daily
job should not break because a pip package moved.

  ./worklog-sync.py                    today
  ./worklog-sync.py --date 2026-08-10  a specific day (backfill)
  ./worklog-sync.py --dry-run          print what would sync, touch nothing
  ./worklog-sync.py --range 7          last 7 days

Hours are deliberately NOT derived from this file. The HH:MM stamps record when a
line was written, not how long the work took; the timer owns hours.
"""

import argparse
import datetime as dt
import json
import os
import re
import sys
import urllib.error
import urllib.request

VAULT = os.path.expanduser("~/LCP")
PROJECT_ID = "lcp-hours"
API_KEY = "AIzaSyCVUrdvIcvbej4P67yPs83ZQWrygZZDqMI"
DOC_ID = "jd-d0f8f6da107ffb10a294ed50"          # must match sync-config.js
COLLECTION = "worklog"
HEADING = "work log"
MAX_LEN = 170                                    # per bullet, after condensing
LOG_PATH = os.path.expanduser("~/Library/Logs/lcp-worklog-sync.log")

BASE = (f"https://firestore.googleapis.com/v1/projects/{PROJECT_ID}"
        f"/databases/(default)/documents/{COLLECTION}/{DOC_ID}?key={API_KEY}")


def log(msg):
    stamp = dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{stamp}] {msg}"
    print(line)
    try:
        with open(LOG_PATH, "a") as fh:
            fh.write(line + "\n")
    except OSError:
        pass


# ----------------------------------------------------------------- parsing

def read_worklog(date_str):
    """Return the raw '## Work Log' bullets from that day's note."""
    path = os.path.join(VAULT, f"{date_str}.md")
    if not os.path.exists(path):
        return None                              # no note at all
    with open(path, encoding="utf-8") as fh:
        lines = fh.read().splitlines()

    bullets, inside = [], False
    for raw in lines:
        line = raw.strip()
        if line.startswith("#"):
            # A heading either opens the Work Log section or closes it.
            inside = line.lstrip("#").strip().lower() == HEADING
            continue
        if not inside:
            continue
        if line.startswith(("- ", "* ", "+ ")):
            bullets.append(line[2:].strip())
        elif bullets and line:
            bullets[-1] += " " + line             # wrapped continuation line
    return bullets


def condense(text, max_len=MAX_LEN):
    """Keep the substance, drop the parenthetical detail dump."""
    text = re.sub(r"^\d{1,2}:\d{2}\s*[—–-]\s*", "", text.strip())   # leading stamp
    text = re.sub(r"^\[[ x]\]\s*", "", text)                        # checkbox

    # Parenthetical asides carry the fine-grained specifics. Drop them, but only
    # if what's left still says something.
    without_parens = re.sub(r"\s*\([^()]*\)", "", text)
    if len(without_parens.strip()) >= 40:
        text = without_parens

    text = re.sub(r"\s+", " ", text).strip()
    if len(text) <= max_len:
        return text

    # Truncate on a clause boundary rather than mid-word.
    cut = text[:max_len]
    for sep in (". ", "; ", ", "):
        i = cut.rfind(sep)
        if i > max_len * 0.5:
            return cut[:i].rstrip(" ,;.") + "…"
    i = cut.rfind(" ")
    return (cut[:i] if i > 0 else cut).rstrip(" ,;.") + "…"


def summarize(date_str):
    raw = read_worklog(date_str)
    if raw is None:
        return None, "no daily note"
    if not raw:
        return [], "note exists, Work Log empty"
    items = [c for c in (condense(b) for b in raw) if c]
    return items, f"{len(items)} item(s)"


# ---------------------------------------------------------------- firestore

def fs_get():
    try:
        with urllib.request.urlopen(BASE, timeout=20) as r:
            doc = json.load(r)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return {}                             # not created yet, fine
        body = e.read().decode("utf-8", "replace")
        raise RuntimeError(f"HTTP {e.code}: {body[:300]}")
    payload = doc.get("fields", {}).get("payload", {}).get("stringValue")
    if not payload:
        return {}
    try:
        return json.loads(payload).get("days", {})
    except json.JSONDecodeError:
        return {}


def fs_put(days):
    body = json.dumps({
        "fields": {
            "payload": {"stringValue": json.dumps({"days": days})},
            "updatedAt": {"integerValue": str(int(dt.datetime.now().timestamp() * 1000))},
        }
    }).encode()
    req = urllib.request.Request(BASE, data=body, method="PATCH",
                                headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            r.read()
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"HTTP {e.code}: {e.read().decode('utf-8', 'replace')[:300]}")


# --------------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date")
    ap.add_argument("--range", type=int, default=1,
                    help="sync the last N days (default 1)")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--vault")
    args = ap.parse_args()

    global VAULT
    if args.vault:
        VAULT = os.path.expanduser(args.vault)

    end = dt.date.fromisoformat(args.date) if args.date else dt.date.today()
    dates = [(end - dt.timedelta(days=i)).isoformat() for i in range(args.range)][::-1]

    found = {}
    for d in dates:
        items, why = summarize(d)
        log(f"{d}: {why}")
        if items:
            found[d] = items
            for it in items:
                log(f"    • {it}")

    if args.dry_run:
        log("dry run — nothing written")
        return 0
    if not found:
        log("nothing to sync")
        return 0

    try:
        days = fs_get()
        days.update(found)                        # this day's log replaces itself
        fs_put(days)
    except RuntimeError as e:
        msg = str(e)
        if "has not been used" in msg or "SERVICE_DISABLED" in msg:
            log("Firestore is not enabled yet — create the database in the Firebase "
                "console (Build > Firestore Database > Create database). "
                "Nothing was lost; re-run this once it exists.")
            return 2
        log(f"sync failed: {msg}")
        return 1

    log(f"synced {len(found)} day(s), {sum(len(v) for v in found.values())} item(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
