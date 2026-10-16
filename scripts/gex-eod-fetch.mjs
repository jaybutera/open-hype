#!/usr/bin/env node
// Download GEXBot's end-of-day report for every ticker GEXBot covers.
// The /hist/eod/{ticker} route only serves the latest available day, so a day
// that is not fetched before the next export is gone. Run daily (deploy/gex-eod-fetch.timer).
//
// Layout: $GEX_EOD_DIR/{YYYY-MM-DD}/{TICKER}.zip  (default ~/data/gexbot-eod), the zip as served.
// The date comes from the Content-Disposition filename, never from the clock.
// Key: GEXBOT_API_KEY from the environment or the repo's .env.
// Usage: node scripts/gex-eod-fetch.mjs [TICKER ...]   (default: all tickers from /tickers)
import { readFileSync, existsSync, mkdirSync, renameSync, unlinkSync, statSync, createWriteStream } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { execFileSync } from 'node:child_process'

const API = 'https://api.gexbot.com'
const UA = 'hl-frontend-gex-eod-fetch/1.0'
const DIR = process.env.GEX_EOD_DIR || join(homedir(), 'data', 'gexbot-eod')
const CONCURRENCY = 2
const TRIES = 4

function apiKey() {
  if (process.env.GEXBOT_API_KEY) return process.env.GEXBOT_API_KEY.trim()
  const env = join(dirname(fileURLToPath(import.meta.url)), '..', '.env')
  const m = existsSync(env) && readFileSync(env, 'utf8').match(/^\s*GEXBOT_API_KEY\s*=\s*["']?([^"'\r\n]+)/m)
  if (!m) throw new Error('GEXBOT_API_KEY not set and not in .env')
  return m[1].trim()
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const etToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
const target = (date, t) => join(DIR, date, `${t}.zip`)

async function tickers() {
  const res = await fetch(`${API}/tickers`, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`/tickers HTTP ${res.status}`)
  const j = await res.json()
  return [...new Set(Object.values(j).flat().filter((t) => typeof t === 'string'))]
}

function verifyZip(path) {
  execFileSync('unzip', ['-tqq', path], { stdio: 'ignore' })
  const list = execFileSync('unzip', ['-Z1', path], { encoding: 'utf8' })
  if (!/\.json\.gz$/m.test(list)) throw new Error('zip has no .json.gz')
}

// -> { status: 'ok'|'skip', date, bytes }
async function fetchOne(t, key, today) {
  if (existsSync(target(today, t))) return { status: 'skip', date: today, bytes: 0 }
  const res = await fetch(`${API}/hist/eod/${encodeURIComponent(t)}`, {
    headers: { Authorization: `Basic ${key}`, 'User-Agent': UA },
    signal: AbortSignal.timeout(15 * 60_000),
  })
  if (!res.ok) {
    await res.body?.cancel()
    const err = new Error(`HTTP ${res.status}`)
    err.retry = res.status === 429 || res.status >= 500
    throw err
  }
  const cd = res.headers.get('content-disposition') || ''
  const date = cd.match(/(\d{4}-\d{2}-\d{2})\.zip/)?.[1]
  if (!date) { await res.body?.cancel(); throw new Error(`no date in Content-Disposition: ${cd}`) }
  const out = target(date, t)
  if (existsSync(out)) { await res.body?.cancel(); return { status: 'skip', date, bytes: 0 } }
  mkdirSync(dirname(out), { recursive: true })
  const tmp = `${out}.part-${process.pid}`
  try {
    await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp))
    verifyZip(tmp)
    renameSync(tmp, out)
  } catch (e) {
    try { unlinkSync(tmp) } catch {}
    e.retry = true
    throw e
  }
  return { status: 'ok', date, bytes: statSync(out).size }
}

async function withRetry(t, key, today) {
  for (let i = 1; ; i++) {
    try { return await fetchOne(t, key, today) } catch (e) {
      const transient = e.retry || e.name === 'TimeoutError' || e.name === 'TypeError' // TypeError = network failure in fetch
      if (!transient || i >= TRIES) throw e
      const wait = 10_000 * 3 ** (i - 1)
      console.error(`${t}: ${e.message}; retry ${i}/${TRIES - 1} in ${wait / 1000}s`)
      await sleep(wait)
    }
  }
}

const key = apiKey()
const today = etToday()
const list = process.argv.length > 2 ? process.argv.slice(2) : await tickers()
const res = { ok: 0, skip: 0, fail: 0, bytes: 0, dates: new Set(), failed: [] }
const queue = [...list]
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  for (let t; (t = queue.shift()); ) {
    try {
      const r = await withRetry(t, key, today)
      res[r.status]++; res.bytes += r.bytes; res.dates.add(r.date)
      if (r.status === 'ok') console.error(`${t}: ${r.date} ${(r.bytes / 1e6).toFixed(1)} MB`)
    } catch (e) {
      res.fail++; res.failed.push(t)
      console.error(`${t}: FAILED ${e.message}`)
    }
  }
}))
const dates = [...res.dates].sort().join(',') || '-'
console.log(`gex-eod run_et=${today} served=${dates} tickers=${list.length} ok=${res.ok} skip=${res.skip} fail=${res.fail} bytes=${res.bytes} (${(res.bytes / 1e6).toFixed(1)} MB) dir=${DIR}` + (res.failed.length ? ` failed=${res.failed.join(',')}` : ''))
process.exit(res.fail ? 1 : 0)
