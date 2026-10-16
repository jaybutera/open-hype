# GEXBot EOD history

Box saves GEXBot's end-of-day report for every ticker from `GET /tickers` once per
weekday, so GEX history accumulates for replay and sim work.

- Data: `box:~/data/gexbot-eod/{YYYY-MM-DD}/{TICKER}.zip`, the zip as served. Each holds
  `{TICKER}/classic/{gex_full,gex_one,gex_zero}/{date}_{TICKER}_classic_*.json.gz`, a list
  of snapshots (timestamp, spot, zero_gamma, major strikes, strikes) about every 1.5 s through RTH.
- Size: about 0.5 GB per trading day for all tickers.
- Script: `scripts/gex-eod-fetch.mjs [TICKER ...]`. The date is the one in the served
  filename. Saved files are skipped, so reruns are cheap.
- Schedule: `deploy/gex-eod-fetch.timer`, Mon..Fri 18:30 and 23:30 ET, Tue..Sat 04:00 ET.
  `/hist/eod` serves only the latest exported day, so a day not fetched before the next
  export is lost.
- Logs: `journalctl --user -u gex-eod-fetch`, one `gex-eod ...` summary line per run.
