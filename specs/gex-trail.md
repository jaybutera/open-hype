# GEX level history and trails

GEXBot's classic feed returns only the current reading. Per strike it carries
`priors`, that strike's volume GEX 1, 5, 10, 15 and 30 minutes earlier (in that
order, most recent first), and `max_priors`, the biggest volume-GEX build over
1, 5, 10, 15, 30 and 60 minute windows. It has no history of zero gamma or the
major strikes, so the dev server records one.

## Stored data

One sample per GEXBot `timestamp` per `TICKER/dte`, deduped on that timestamp
(the feed freezes after the close, so repeats are not stored):

    { t, spot, zeroGamma, majorPosVol, majorNegVol, majorPosOi, majorNegOi, sumGexVol, sumGexOi }

`t` is UTC ms. Files: `GEX_SAMPLE_DIR/YYYY-MM-DD/TICKER_dte.jsonl`, append-only,
one sample per line, foldered by the ET date of `t`. On startup the server loads
the last 5 trading days (weekdays; holidays count) and keeps that window in memory.

## Sampler

`vite-gex-plugin.ts`. Every fresh upstream reading becomes a sample, whether a
page or the sampler asked for it. Every 60 s, Mon..Fri 09:30 to 16:00 ET, the
sampler fetches each ticker in `GEX_SAMPLE_TICKERS` for `zero`, `one` and `full`
through the same 60 s cache the page uses, so they share one upstream call.
Off when `SIM=1` or `GEXBOT_API_KEY` is unset.

| env | default |
|---|---|
| `GEX_SAMPLE_TICKERS` | `SPX,NDX,TSLA,SPY,QQQ` |
| `GEX_SAMPLE_DIR` | `~/data/gex-samples` |

## Endpoint

`GET /api/gex/:ticker/:dte/history?from=&to=&interval=&lookbacks=`

- `from`, `to`: UTC ms. `to` defaults to now, `from` to 00:00 ET today.
- Returns `{ ticker, dte, samples, lookbacks }`, samples ascending by `t`.
- `lookbacks`: for each N, the last sample at or before (latest sample at or
  before `to`) minus N minutes, as `{ minutes, asOf, zeroGamma, majorPosVol,
  majorNegVol, majorPosOi, majorNegOi }`. N comes from `lookbacks=15,30` or
  from the table below for `interval`. A lookback with no sample that old is left out.

## Lookback table

`src/services/gex/lookbacks.ts`, used by the chart trail, the strike outline,
`get_chart_view.gex.lookbacks` and `get_gex`.

| interval | lookbacks (min) | strike outline (min) |
|---|---|---|
| 1m | 15, 30 | 15 |
| 5m | 30, 60 | 30 |
| 15m | 60, 120 | 30 |
| 1h | 120, 240 | 30 |
| 4h, 1d, other | 120, 240 | 30 |

## Chart

- `Trail` (needs `Levels`, default on): `GexTrailPrimitive` draws each headline
  level as a stepped 1 px path through the session's samples behind the candles,
  solid for zero gamma and the vol pair, dashed for the OI pair, with a dot and a
  label such as `0γ -1h` at each lookback. The session is the ET day of the latest reading.
- `γ vol`: each bar gets a 1 px outline at its prior width, on the current bars' scale.
  Not drawn in `γ OI` mode; the priors are volume only.
