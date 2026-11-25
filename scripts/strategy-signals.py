#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["pyarrow>=15"]
# ///
"""Run an ict-strategies preset on live Hyperliquid candles and post the plans
it has resting to the dev server's /api/signals, where they show as cards in
the right column.

Just after every minute closes:
  1. fetch the closed 1m candles of the preset's assets from Hyperliquid and
     append them to a parquet store (~/.hl-signals/data);
  2. replay the store through the backtest engine with a decision trace;
  3. read the plans the strategy has placed and not yet cancelled or closed
     from the trace, with the sweep, the structure break and the entry gap
     behind each (v3.rhai traces those);
  4. POST that list to <url>/api/signals with replace: true, so a plan the
     strategy killed leaves the app on the same cycle.

Timing. The engine handles a 5m (15m, 1h, 4h) bar when the first 1m bar after
it arrives. Waiting for that 1m bar to close would cost a minute, so the replay
input ends with a flat placeholder for the minute that has just opened: the
bar that closed a moment ago is acted on at once. The placeholder is never
stored, and a 1m-timeframe plan first seen on it is held back until the real
bar has closed.

History. The replay starts at a Monday at least --window-days back and uses
1m bars from a Monday at least --fine-days back; before that it is fed 5m bars
(one row per bar), which leaves the 5m and higher timeframes unchanged and
makes a cycle about three times shorter. Both starts move once a week, so the
detector state behind a plan is the same on every cycle of a week.

Hyperliquid serves the last 5000 candles per interval, so its 1m history
reaches back about 3.5 days. Older history comes from --seed-dir (a
collector's {asset}_1m.parquet files) where given, and otherwise from 5m and
15m candles.

  scripts/strategy-signals.py --once --dry-run         # one cycle, print the signals
  scripts/strategy-signals.py                          # run until stopped

Environment: ICT_STRATEGIES_DIR (default ~/src/ict-strategies), BT_BIN (the v3
engine binary), HL_FRONTEND_URL (default http://localhost:3000).
"""
from __future__ import annotations

import argparse
import bisect
import datetime as dt
import json
import os
import shutil
import subprocess
import sys
import time
import tomllib
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from zoneinfo import ZoneInfo

import pyarrow as pa
import pyarrow.parquet as pq

HL_INFO = "https://api.hyperliquid.xyz/info"
ET = ZoneInfo("America/New_York")
UTC = dt.timezone.utc
ENGINE_CANDIDATES = [
    "~/src/wt/engine-v3/target/release/backtest",
    "~/src/backtest-engine-v3/target/release/backtest",
    "~/src/backtest-engine/target/release/backtest",
]
LEVEL_NAMES = {
    "pdh": "PDH", "pdl": "PDL", "pwh": "PWH", "pwl": "PWL",
    "session_high": "Session high", "session_low": "Session low",
    "swing_high": "Swing high", "swing_low": "Swing low",
}
ORANGE, PURPLE, BLUE, GRAY = "#ff8c1a", "#a970ff", "#3d9bff", "#8a8f98"


def log(msg: str) -> None:
    print(f"{dt.datetime.now().strftime('%H:%M:%S')} {msg}", file=sys.stderr, flush=True)


def et(ts: float) -> str:
    return dt.datetime.fromtimestamp(ts, ET).strftime("%H:%M ET")


def tf_secs(tf: str) -> int:
    unit = {"m": 60, "h": 3600, "d": 86400, "D": 86400, "w": 604800, "W": 604800}[tf[-1]]
    return int(tf[:-1]) * unit


def px(p: float) -> str:
    return f"{p:.8g}"


# ----------------------------------------------------------------- candles ---

def hl_candles(coin: str, interval: str, start_ms: int, end_ms: int) -> list[dict]:
    body = json.dumps({"type": "candleSnapshot",
                       "req": {"coin": coin, "interval": interval, "startTime": start_ms, "endTime": end_ms}}).encode()
    req = urllib.request.Request(HL_INFO, data=body, headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)


Row = tuple[float, float, float, float, float]  # open, high, low, close, volume


class Store:
    """1m candles of one asset: {open time in s: row}, mirrored to {asset}_1m.parquet."""

    def __init__(self, asset: str, data_dir: Path):
        self.asset = asset
        self.path = data_dir / f"{asset}_1m.parquet"
        self.rows: dict[int, Row] = {}
        self._coarse: dict[int, Row] = {}
        self._coarse_key: tuple[int, int] | None = None
        if self.path.exists():
            self.rows = read_parquet(self.path, 0)

    def last(self) -> int:
        return max(self.rows) if self.rows else 0

    def add(self, candles: list[dict], now: float, dur: int = 60, only_missing: bool = False) -> int:
        """Merge closed candles. With only_missing (coarse backfill), a bar is stored as
        one row at its open, and only where no row already lies inside it."""
        taken = sorted(self.rows) if only_missing else []
        n = 0
        for c in candles:
            t = int(c["t"]) // 1000
            if t + dur > now:
                continue  # still forming
            if only_missing and has_row_in(taken, t, t + dur):
                continue
            row = (float(c["o"]), float(c["h"]), float(c["l"]), float(c["c"]), float(c["v"]))
            if self.rows.get(t) != row:
                self.rows[t] = row
                n += 1
        return n

    def trim(self, before: int) -> None:
        for t in [t for t in self.rows if t < before]:
            del self.rows[t]

    def save(self) -> None:
        write_parquet(self.path, self.rows)

    def engine_rows(self, anchor: int, fine: int, minute: int) -> dict[int, Row]:
        """What the engine replays: 5m bars from `anchor` to `fine`, 1m bars after, and a flat
        placeholder for `minute` (the minute now forming) so the bars that just closed are handled."""
        if self._coarse_key != (anchor, fine):
            coarse: dict[int, list[float]] = {}
            for t in sorted(t for t in self.rows if anchor <= t < fine):
                o, h, l, c, v = self.rows[t]
                bar = coarse.get(t - t % 300)
                if bar is None:
                    coarse[t - t % 300] = [o, h, l, c, v]
                else:
                    bar[1] = max(bar[1], h); bar[2] = min(bar[2], l); bar[3] = c; bar[4] += v
            self._coarse = {t: tuple(b) for t, b in coarse.items()}
            self._coarse_key = (anchor, fine)
        out = dict(self._coarse)
        out.update((t, r) for t, r in self.rows.items() if fine <= t < minute)
        if out:
            c = out[max(out)][3]
            out[minute] = (c, c, c, c, 0.0)
        return out


def write_parquet(path: Path, rows: dict[int, Row]) -> None:
    ts = sorted(rows)
    cols = list(zip(*(rows[t] for t in ts))) if ts else [[], [], [], [], []]
    table = pa.table({
        "timestamp": pa.array([t * 1_000_000 for t in ts], pa.timestamp("us")),
        "open": cols[0], "high": cols[1], "low": cols[2], "close": cols[3], "volume": cols[4],
    })
    tmp = path.with_suffix(".tmp")
    pq.write_table(table, tmp, row_group_size=1440)
    tmp.replace(path)


def has_row_in(sorted_ts: list[int], lo: int, hi: int) -> bool:
    i = bisect.bisect_left(sorted_ts, lo)
    return i < len(sorted_ts) and sorted_ts[i] < hi


def read_parquet(path: Path, since: int) -> dict[int, Row]:
    t = pq.read_table(path)
    names = {n.lower(): n for n in t.column_names}
    ts = t.column(names["timestamp"]).cast(pa.timestamp("us")).cast(pa.int64()).to_pylist()
    cols = [t.column(names[n]).to_pylist() for n in ("open", "high", "low", "close")]
    vol = t.column(names["volume"]).to_pylist() if "volume" in names else [0.0] * len(ts)
    out: dict[int, Row] = {}
    for i, us in enumerate(ts):
        s = us // 1_000_000
        if s >= since:
            out[s] = (cols[0][i], cols[1][i], cols[2][i], cols[3][i], vol[i] or 0.0)
    return out


def backfill(store: Store, anchor: int, seed_dir: Path | None, now: float) -> None:
    """Fill history back to `anchor`: the seed parquet, Hyperliquid 1m, then 5m and 15m for what is left."""
    if seed_dir:
        seed = seed_dir / f"{store.asset}_1m.parquet"
        if seed.exists():
            rows = read_parquet(seed, anchor)
            for t, row in rows.items():
                store.rows.setdefault(t, row)
            log(f"{store.asset}: {len(rows)} seed rows from {seed}")
    store._coarse_key = None
    now_ms = int(now * 1000)
    n1 = store.add(hl_candles(store.asset, "1m", now_ms - 5000 * 60_000, now_ms), now)
    n5 = store.add(hl_candles(store.asset, "5m", max(anchor * 1000, now_ms - 5000 * 300_000), now_ms), now, 300, True)
    n15 = store.add(hl_candles(store.asset, "15m", anchor * 1000, now_ms), now, 900, True)
    log(f"{store.asset}: backfilled {n1} 1m, {n5} 5m and {n15} 15m bars; "
        f"{len(store.rows)} rows from {dt.datetime.fromtimestamp(min(store.rows), UTC):%Y-%m-%d %H:%M} UTC")


def update(store: Store, now: float) -> int:
    """Fetch the latest closed 1m bars. Right after a minute closes its bar may not be served
    yet, so ask again briefly; a minute with no trades has no bar and is not waited for further."""
    just_closed = int(now) // 60 * 60 - 60
    n = 0
    for attempt in range(3):
        n += store.add(hl_candles(store.asset, "1m", (store.last() - 600) * 1000, int(time.time() * 1000)), time.time())
        if store.last() >= just_closed:
            break
        time.sleep(0.7)
    return n


def refresh(store: Store, anchor: int, seed_dir: Path | None, now: float) -> int:
    if not store.rows or min(store.rows) > anchor + 86400 or store.last() < now - 3 * 86400:
        backfill(store, anchor, seed_dir, now)
        n = 1
    else:
        n = update(store, now)
    store.trim(anchor - 86400)
    if n:
        store.save()
    return n


# ------------------------------------------------------------------ engine ---

def load_preset(path: Path) -> dict:
    cfg = tomllib.loads(path.read_text())
    if "base" in cfg:
        base = load_preset((path.parent / cfg["base"]).resolve())
        cfg = {**base, **cfg}
    return cfg


def run_engine(args, assets: list[str], data_dir: Path, trace_dir: Path, anchor: int) -> None:
    shutil.rmtree(trace_dir, ignore_errors=True)
    trace_dir.mkdir(parents=True)
    cmd = [args.engine, "replay", "--data-dir", str(data_dir), "--strategy", str(args.preset),
           "--from", dt.datetime.fromtimestamp(anchor, UTC).strftime("%Y-%m-%d"), "--trace", str(trace_dir)]
    if args.fill:
        cmd += ["--fill", str(args.fill)]
    for tf in args.timeframes:
        cmd += ["--timeframe", tf]
    for a in assets:
        cmd += ["-a", a]
    r = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True, timeout=300)
    if r.returncode != 0:
        raise RuntimeError(f"engine exited {r.returncode}: {r.stderr.strip()[-600:]}")


def read_trace(path: Path) -> dict:
    """The records a signal is built from, keyed the way they join."""
    out = {"sweep": {}, "break": {}, "gap": {}, "book": {}, "final": {}}
    with path.open() as f:
        for line in f:
            if '"k":"v3.' not in line and '"k":"book.' not in line and '"k":"sw.final"' not in line:
                continue
            r = json.loads(line)
            k, v = r["k"], r.get("v", {})
            if k == "sw.final":
                out["final"][(v["tf"], v["level_id"], v["extreme_ts"])] = v.get("level_formed_at")
            elif k == "v3.sweep":
                out["sweep"][r["run"]] = v
            elif k == "v3.break":
                out["break"][r["run"]] = v
            elif k == "v3.gap" and r.get("o") == "plan_placed":
                out["gap"][v["opp_id"]] = {**v, "run": r["run"], "tf": r["tf"]}
            elif k.startswith("book."):
                out["book"].setdefault(v["opportunity_id"], []).append({**v, "b": r["b"]})
    return out


def extreme_minute(rows: dict[int, Row], start: int, dur: int, high: bool) -> int:
    """The 1m bar inside [start, start + dur) that made the bar's high (or low)."""
    best, best_t = None, start
    for t in range(start, start + dur, 60):
        row = rows.get(t)
        if row is None:
            continue
        p = row[1] if high else row[2]
        if best is None or (p > best if high else p < best):
            best, best_t = p, t
    return best_t


def build_signals(asset: str, tr: dict, rows: dict[int, Row], strategy: str, minute: int) -> list[dict]:
    """The plans the strategy holds: placed, and neither cancelled nor closed. A plan whose
    setup the strategy killed has an entry_cancelled record and is left out, which removes
    its card. Whether the simulated book filled the entry is not reported."""
    signals = []
    for opp_id, events in tr["book"].items():
        placed = next((e for e in events if e["event"] == "entry_placed"), None)
        if not placed or any(e["event"] in ("entry_cancelled", "closed") for e in events):
            continue
        bull = placed["direction"] == "bull"
        entry, stop, target = placed["entry"], placed["stop"], placed["tp"]
        t_placed = placed["b"]
        gap = tr["gap"].get(opp_id)
        # Seen only on the placeholder for the forming minute: wait for the real 1m bar.
        if t_placed >= minute and (gap["tf"] if gap else "1m") == "1m":
            continue

        sig = {
            "asset": asset, "strategy": strategy, "side": "long" if bull else "short",
            "time": t_placed * 1000, "entry": entry, "stop": stop, "target": target,
        }
        until = "now"

        sweep = tr["sweep"].get(gap["run"]) if gap else None
        if not gap or not sweep:
            sig["key"] = f"{asset}|{'bull' if bull else 'bear'}|{t_placed}|{px(entry)}"
            signals.append(sig)
            continue

        tf = sweep["tf"]
        dur = tf_secs(tf)
        brk = tr["break"].get(gap["run"], {})
        sig["tf"] = tf
        sig["key"] = f"{asset}|{tf}|{'bull' if bull else 'bear'}|{sweep['extreme_ts']}|{px(entry)}"

        # A bear setup sweeps a high and breaks a swing low; a bull setup the mirror.
        t_ext = extreme_minute(rows, sweep["extreme_ts"], dur, high=not bull)
        level = LEVEL_NAMES.get(sweep.get("level_source"), "Level")
        formed = tr["final"].get((tf, sweep["level_id"], sweep["extreme_ts"])) or sweep["start_ts"] - 20 * dur
        shapes = [
            {"type": "hline", "price": sweep["level_price"], "from": formed * 1000, "to": (t_ext + 60) * 1000,
             "style": "dashed", "color": GRAY, "text": f"{level} {px(sweep['level_price'])}"},
            {"type": "arrow", "time": t_ext * 1000, "price": sweep["extreme_price"],
             "dir": "up" if bull else "down", "color": ORANGE, "text": f"Sweep {tf}"},
        ]
        note = f"{level} {px(sweep['level_price'])} swept to {px(sweep['extreme_price'])} at {et(t_ext)}"
        if brk:
            t_swing = extreme_minute(rows, brk["swing_ts"], dur, high=bull)
            t_break = min(brk["break_ts"] + dur - 60, t_placed)
            shapes.append({"type": "hline", "price": brk["break_level"], "from": t_swing * 1000, "to": t_break * 1000,
                           "color": PURPLE, "text": "MSS"})
            shapes.append({"type": "arrow", "time": t_break * 1000, "price": brk["break_level"],
                           "dir": "down" if bull else "up", "color": PURPLE})
            note += f"; {tf} close through {px(brk['break_level'])} at {et(brk['break_ts'] + dur)}"
            shapes.append({"type": "box", "t1": (brk["break_ts"] - dur) * 1000, "t2": until,
                           "p1": gap["near"], "p2": gap["far"], "color": BLUE, "text": "FVG"})
        note += f"; limit at the gap edge {px(entry)}, stop at the sweep extreme"
        sig["shapes"] = shapes
        sig["note"] = note
        signals.append(sig)
    return signals


# -------------------------------------------------------------------- main ---

def post(url: str, body: dict) -> dict:
    req = urllib.request.Request(f"{url.rstrip('/')}/api/signals", data=json.dumps(body).encode(),
                                 headers={"content-type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"POST /api/signals {e.code}: {e.read().decode()[:600]}") from None


def monday_anchor(now: float, window_days: int) -> int:
    d = dt.datetime.fromtimestamp(now, UTC).date() - dt.timedelta(days=window_days)
    d -= dt.timedelta(days=d.weekday())
    return int(dt.datetime(d.year, d.month, d.day, tzinfo=UTC).timestamp())


def main() -> int:
    strategies = Path(os.environ.get("ICT_STRATEGIES_DIR", "~/src/ict-strategies")).expanduser()
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--preset", type=Path, default=strategies / "v3" / "v3.toml", help="strategy preset TOML")
    ap.add_argument("--fill", type=Path, help="fill lens TOML (default: the preset's [viz] fill, under fill/ next to its family)")
    ap.add_argument("--engine", default=os.environ.get("BT_BIN"), help="backtest engine binary (v3 branch for the v3 preset)")
    ap.add_argument("--url", default=os.environ.get("HL_FRONTEND_URL", "http://localhost:3000"))
    ap.add_argument("--state", type=Path, default=Path("~/.hl-signals").expanduser(), help="candle store and trace scratch")
    ap.add_argument("--seed-dir", type=Path, help="directory of {asset}_1m.parquet files to take older history from")
    ap.add_argument("--assets", help="comma list; default: the preset's assets")
    ap.add_argument("--timeframes", default="5m,15m,1h,4h")
    ap.add_argument("--window-days", type=int, default=28, help="replay starts at a Monday at least this far back")
    ap.add_argument("--fine-days", type=int, default=3, help="1m bars from a Monday at least this far back; 5m bars before it")
    ap.add_argument("--source", help="source name in /api/signals (default: the preset's file name)")
    ap.add_argument("--once", action="store_true", help="one cycle, then exit")
    ap.add_argument("--dry-run", action="store_true", help="print the signals instead of posting them")
    args = ap.parse_args()

    args.preset = args.preset.expanduser().resolve()
    cfg = load_preset(args.preset)
    assets = args.assets.split(",") if args.assets else cfg["assets"]
    args.timeframes = [t for t in args.timeframes.split(",") if t]
    source = args.source or args.preset.stem
    if not args.fill:
        lens = tomllib.loads(args.preset.read_text()).get("viz", {}).get("fill")
        args.fill = args.preset.parent.parent / "fill" / lens if lens else None
    if not args.engine:
        args.engine = next((str(p) for p in (Path(c).expanduser() for c in ENGINE_CANDIDATES) if p.exists()), None)
    if not args.engine or not Path(args.engine).exists():
        log("no engine binary: build the v3 branch of backtest-engine and pass --engine or set BT_BIN")
        return 2

    data_dir = args.state / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    shm = Path("/dev/shm")
    scratch = (shm if shm.is_dir() else args.state) / f"hl-signals-{source}"
    trace_dir, input_dir = scratch / "trace", scratch / "input"
    input_dir.mkdir(parents=True, exist_ok=True)
    log(f"{source}: {', '.join(assets)} on {', '.join(args.timeframes)}; engine {args.engine}; posting to {args.url}")

    stores = {a: Store(a, data_dir) for a in assets}
    pool = ThreadPoolExecutor(len(assets))
    last_sent: str | None = None
    while True:
        now = time.time()
        minute = int(now) // 60 * 60
        anchor = monday_anchor(now, args.window_days)
        fine = max(anchor, monday_anchor(now, args.fine_days))
        try:
            list(pool.map(lambda st: refresh(st, anchor, args.seed_dir, now), stores.values()))
            for a, st in stores.items():
                write_parquet(input_dir / f"{a}_1m.parquet", st.engine_rows(anchor, fine, minute))
            run_engine(args, assets, input_dir, trace_dir, anchor)
            signals = []
            for a in assets:
                tp = trace_dir / f"{a.replace(':', '_')}.trace.jsonl"
                if tp.exists():
                    signals += build_signals(a, read_trace(tp), stores[a].rows, source, minute)
            signals.sort(key=lambda s: -s["time"])
            signals = signals[:100]
            body = {"source": source, "replace": True, "signals": signals}
            if args.dry_run:
                print(json.dumps(body, indent=1))
            else:
                res = post(args.url, body)
                for what in ("added", "removed"):
                    if res.get(what):
                        log(f"{what}: {', '.join(res[what])}")
            sent = json.dumps(signals, sort_keys=True)
            if sent != last_sent:
                log(f"{len(signals)} live plans; posted {time.time() - minute:.1f}s after the {et(minute)} close")
            last_sent = sent
        except Exception as e:  # a failed cycle must not stop the loop
            log(f"cycle failed: {e}")
            if args.once:
                return 1
        if args.once:
            return 0
        # Wake just after the next minute closes.
        time.sleep(60 - time.time() % 60 + 1.5)


if __name__ == "__main__":
    sys.exit(main())
