#!/usr/bin/env node
/**
 * Run one sim session: a normal Claude Code trading session against recorded
 * candles. See specs/sim.md.
 *
 *   node scripts/sim.mjs --asset xyz:SP500 --interval 5m \
 *     --start "2026-07-07 09:00 ET" --end "2026-07-07 16:00 ET" \
 *     --prompt "Trade the SP500 open." [--model claude-fable-5-1] [--port 3001]
 *     [--memory-seed DIR] [--no-faketime] [--out DIR]
 *
 * Starts a SIM=1 dev server on --port, opens the page in headless Chrome,
 * enters replay at --start, then runs `claude -p` with the hl-chart MCP
 * pointed at that server, hooks that tell the server when the agent's turn
 * ends, cron tools off, and auto memory in the run directory (seeded from
 * --memory-seed). Everything lands in --out (default /tmp/hl-sim/<run id>):
 * sim.jsonl (clock events), claude.jsonl (the transcript), shots/*.png
 * (the chart at each wake), summary.json.
 */
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const REPO = resolve(fileURLToPath(import.meta.url), '../..');
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* --------------------------------------------------------------- args --- */

function parseArgs(argv) {
  const out = { interval: '5m', model: 'claude-fable-5-1', port: 3001, faketime: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-faketime') { out.faketime = false; continue; }
    if (!a.startsWith('--')) throw new Error(`unexpected argument ${a}`);
    const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    out[key] = argv[++i];
  }
  if (out.config) Object.assign(out, JSON.parse(readFileSync(out.config, 'utf8')), { config: undefined });
  for (const k of ['asset', 'start', 'end', 'prompt']) if (!out[k]) throw new Error(`--${k} is required`);
  out.port = Number(out.port);
  return out;
}

/** New York UTC offset in ms at a UTC instant. */
function nyOffsetMs(ms) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ms)).reduce((o, x) => (o[x.type] = x.value, o), {});
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ms;
}

/** "YYYY-MM-DD HH:MM ET", ISO-8601 with zone, or UTC ms. */
function parseTime(s) {
  if (/^\d+$/.test(String(s))) return Number(s);
  const et = String(s).match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})\s*ET$/i);
  if (et) {
    const naive = Date.parse(`${et[1]}T${et[2]}:00Z`);
    return naive - nyOffsetMs(naive - nyOffsetMs(naive));
  }
  const ms = Date.parse(s);
  if (!Number.isFinite(ms)) throw new Error(`cannot read time ${s}`);
  return ms;
}

/** faketime's absolute format, in UTC (the run's TZ is set to New York). */
function faketimeSpec(ms) {
  return '@' + new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const base = join(homedir(), '.cache/puppeteer/chrome');
  for (const v of existsSync(base) ? readdirSync(base).sort().reverse() : []) {
    const p = join(base, v, 'chrome-linux64/chrome');
    if (existsSync(p)) return p;
  }
  throw new Error('no Chrome found; set CHROME_PATH');
}

/* ---------------------------------------------------------------- run --- */

const args = parseArgs(process.argv.slice(2));
const start = parseTime(args.start);
const end = parseTime(args.end);
const runId = `${new Date(start).toISOString().slice(0, 10)}-${Date.now().toString(36)}`;
const out = resolve(args.out ?? join('/tmp/hl-sim', runId));
const BASE = `http://127.0.0.1:${args.port}`;
mkdirSync(join(out, 'shots'), { recursive: true });
mkdirSync(join(out, 'memory'), { recursive: true });

const seed = args.memorySeed ?? join(homedir(), '.config/hl-sim/memory-seed');
if (existsSync(seed)) cpSync(seed, join(out, 'memory'), { recursive: true });

const log = msg => console.log(`[sim ${new Date().toISOString().slice(11, 19)}] ${msg}`);
const children = [];
let browser = null;
async function cleanup() {
  try { await browser?.close(); } catch { /* ignore */ }
  for (const c of children) if (c.exitCode === null) c.kill('SIGTERM');
}
process.on('SIGINT', () => { void cleanup().then(() => process.exit(130)); });

async function http(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

// 1. Dev server.
log(`run ${runId} -> ${out}`);
const vite = spawn(process.execPath, [join(REPO, 'node_modules/.bin/vite'), '--port', String(args.port), '--strictPort', '--host', '127.0.0.1'], {
  cwd: REPO,
  env: { ...process.env, SIM: '1', SIM_LOG: join(out, 'sim.jsonl') },
  stdio: ['ignore', 'pipe', 'pipe'],
});
children.push(vite);
const viteLog = [];
vite.stdout.on('data', d => viteLog.push(String(d)));
vite.stderr.on('data', d => viteLog.push(String(d)));
for (let i = 0; ; i++) {
  try { if ((await http('GET', '/api/sim/clock')).status === 200) break; } catch { /* not up yet */ }
  if (vite.exitCode !== null || i > 120) { console.error(viteLog.join('')); throw new Error('sim dev server did not start'); }
  await sleep(500);
}
log(`dev server up on ${BASE}`);

// 2. Headless page.
browser = await puppeteer.launch({ executablePath: findChrome(), headless: true, args: ['--no-sandbox', '--window-size=1600,1000'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
page.on('pageerror', e => log(`page error: ${e.message}`));
await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 120_000 });

// 3. Enter replay.
let started = null;
for (let i = 0; i < 20 && !started; i++) {
  const r = await http('POST', '/api/sim/start', { asset: args.asset, interval: args.interval, start, end });
  if (r.status === 200) started = r.json;
  else { log(`start: ${r.json?.error}`); await sleep(2000); }
}
if (!started) { await cleanup(); throw new Error('could not start the replay'); }
log(`replay at ${new Date(started.cursor).toISOString()}`);
await page.screenshot({ path: join(out, 'shots/000-start.png') });

// 4. Claude session.
const hook = path => ({ type: 'command', command: `curl -s -m 5 -X POST ${BASE}/api/sim/${path} >/dev/null || true` });
writeFileSync(join(out, 'settings.json'), JSON.stringify({
  autoMemoryDirectory: join(out, 'memory'),
  hooks: {
    Stop: [{ hooks: [hook('idle')] }],
    PreToolUse: [{ matcher: '*', hooks: [hook('busy')] }],
    UserPromptSubmit: [{ hooks: [hook('busy')] }],
  },
}, null, 2));
writeFileSync(join(out, 'mcp.json'), JSON.stringify({
  mcpServers: {
    'hl-chart': { command: process.execPath, args: [join(REPO, 'scripts/hl-chart-mcp.mjs')], env: { HL_FRONTEND_URL: BASE } },
  },
}, null, 2));

const claudeArgs = [
  '-p', args.prompt,
  '--model', args.model,
  '--settings', join(out, 'settings.json'),
  '--mcp-config', join(out, 'mcp.json'), '--strict-mcp-config',
  '--disallowedTools', 'CronCreate', 'CronDelete', 'CronList', 'ScheduleWakeup',
  '--permission-mode', 'bypassPermissions',
  '--output-format', 'stream-json', '--verbose',
];
// CLAUDE_BIN swaps in another agent binary with the same flags (tests use a scripted one).
const claudeBin = process.env.CLAUDE_BIN || 'claude';
const claudeCmd = args.faketime ? 'faketime' : claudeBin;
const claudeFull = args.faketime ? ['-f', faketimeSpec(started.cursor), claudeBin, ...claudeArgs] : claudeArgs;
const env = { ...process.env, TZ: 'America/New_York' };
const tokenFile = join(homedir(), '.config/hl-sim/token');
if (!env.CLAUDE_CODE_OAUTH_TOKEN && existsSync(tokenFile)) env.CLAUDE_CODE_OAUTH_TOKEN = readFileSync(tokenFile, 'utf8').trim();
log(`claude ${args.model}${args.faketime ? ` (faketime ${faketimeSpec(started.cursor)})` : ''}`);
const claude = spawn(claudeCmd, claudeFull, { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'] });
children.push(claude);
const transcript = [];
let buf = '';
claude.stdout.on('data', d => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    transcript.push(line);
    writeFileSync(join(out, 'claude.jsonl'), transcript.join('\n') + '\n');
    try {
      const m = JSON.parse(line);
      for (const c of m.message?.content ?? []) {
        if (c.type === 'text' && m.type === 'assistant') log(`agent: ${c.text.replace(/\s+/g, ' ').slice(0, 200)}`);
        if (c.type === 'tool_use') log(`tool: ${c.name} ${JSON.stringify(c.input).slice(0, 160)}`);
      }
    } catch { /* partial or non-JSON */ }
  }
});
claude.stderr.on('data', d => log(`claude stderr: ${String(d).trim()}`));
const claudeDone = new Promise(r => claude.on('exit', code => r(code)));

// 5. Watch the clock: a screenshot at each wake, stop when the sim ends.
let lastState = null;
let shot = 1;
let endedAt = null;
let exitCode = null;
claudeDone.then(c => { exitCode = c; });
while (exitCode === null) {
  let clock = null;
  try { clock = (await http('GET', '/api/sim/clock')).json; } catch { /* server gone */ }
  if (clock && clock.state !== lastState) {
    log(`clock ${clock.state} at ${new Date(clock.cursor).toLocaleString('en-US', { timeZone: 'America/New_York' })} ET${clock.endReason ? ` (${clock.endReason})` : ''}`);
    if (clock.state === 'busy' && lastState === 'idle') {
      await page.screenshot({ path: join(out, `shots/${String(shot++).padStart(3, '0')}-wake.png`) }).catch(() => {});
    }
    lastState = clock.state;
  }
  if (clock?.state === 'ended' && endedAt === null) endedAt = Date.now();
  // Give the agent two minutes after the session ends, then stop it.
  if (endedAt !== null && Date.now() - endedAt > 120_000) { claude.kill('SIGTERM'); break; }
  await sleep(1000);
}
await claudeDone;
if (lastState !== 'ended') await http('POST', '/api/sim/stop').catch(() => {});

// 6. Summary.
const view = (await http('GET', '/api/ai/view').catch(() => ({ json: null }))).json;
const paper = await page.evaluate(() => localStorage.getItem('hl-paper-accounts')).catch(() => null);
await page.screenshot({ path: join(out, 'shots/999-end.png') }).catch(() => {});
const result = transcript.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(m => m?.type === 'result').at(-1);
writeFileSync(join(out, 'paper-accounts.json'), paper ?? 'null');
writeFileSync(join(out, 'summary.json'), JSON.stringify({
  runId, params: { ...args, start, end }, claudeExit: exitCode,
  cost: result?.total_cost_usd ?? null,
  end: { cursor: view?.takenAt ?? null, mid: view?.mid ?? null, position: view?.position ?? null, orders: view?.orders ?? [] },
}, null, 2));
writeFileSync(join(out, 'vite.log'), viteLog.join(''));
log(`done: ${out}`);
await cleanup();
process.exit(0);
