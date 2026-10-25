#!/usr/bin/env node
/**
 * Run one sim session: a normal Claude Code trading session against recorded
 * candles. See specs/sim.md.
 *
 *   node scripts/sim.mjs --asset xyz:SP500 --interval 5m \
 *     --start "2026-07-07 09:00 ET" --end "2026-07-07 16:00 ET" \
 *     --prompt "Trade the SP500 open." [--model claude-fable-5-1] [--port 3001]
 *     [--profile 2022-v1] [--memory-seed DIR] [--shift today|none|YYYY-MM-DD]
 *     [--no-faketime] [--out DIR]
 *     [--ref origin/master]   (the commit the agent's checkout is made from)
 *
 * Starts a SIM=1 dev server on --port, opens the page in headless Chrome,
 * enters replay at --start, then runs `claude -p` with the hl-chart MCP
 * pointed at that server, hooks that tell the server when the agent's turn
 * ends, cron tools off, the bot's instructions from bot/profiles/<profile>.json
 * appended to the system prompt (see bot/README.md), and auto memory in the run
 * directory (empty unless --memory-seed).
 *
 * --shift (default today) moves the recording so the --start day is served
 * as that date, keeping the ET time of day: Claude Code states the real date
 * in its prompt and cannot run under libfaketime, so the data moves instead.
 * Bash commands run under faketime at the replay cursor (CLAUDE_CODE_SHELL_PREFIX)
 * unless --no-faketime. Everything lands in --out (default /tmp/hl-sim/<run id>):
 * sim.jsonl (clock events), claude.jsonl (the transcript), shots/*.png
 * (the chart at each wake), summary.json.
 */
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const REPO = resolve(fileURLToPath(import.meta.url), '../..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const run = (cmd, argv) => new Promise((ok, fail) => {
  const p = spawn(cmd, argv, { stdio: 'inherit' });
  p.on('exit', code => (code === 0 ? ok() : fail(new Error(`${cmd} ${argv.join(' ')} exited ${code}`))));
});

/* --------------------------------------------------------------- args --- */

function parseArgs(argv) {
  const out = { interval: '5m', model: 'claude-fable-5-1', port: 3001, faketime: true, shift: 'today', profile: '2022-v1' };
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

/** ET calendar date (YYYY-MM-DD) of a UTC instant. */
function etDate(ms) {
  return new Date(ms + nyOffsetMs(ms)).toISOString().slice(0, 10);
}

/** ms to add to recorded times so the start day plays as `target` (ET wall time kept). */
function shiftFor(startMs, target) {
  if (target === 'none') return 0;
  const day = target === 'today' ? etDate(Date.now()) : target;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`--shift must be today, none or YYYY-MM-DD`);
  return parseTime(`${day} 00:00 ET`) - parseTime(`${etDate(startMs)} 00:00 ET`);
}

/** Newest `<dir>/<version>/chrome-linux64/chrome` under a cache dir, filtered by version prefix. */
function newestChrome(dir, prefix = '') {
  const vs = existsSync(dir) ? readdirSync(dir).filter(v => v.startsWith(prefix)) : [];
  vs.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  for (const v of vs) {
    const p = join(dir, v, 'chrome-linux64/chrome');
    if (existsSync(p)) return p;
  }
  return null;
}

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const p = newestChrome(join(homedir(), '.cache/puppeteer/chrome'))
    ?? newestChrome(join(homedir(), '.cache/ms-playwright'), 'chromium-')
    ?? ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(existsSync);
  if (p) return p;
  throw new Error('no Chrome found; set CHROME_PATH');
}

/* ---------------------------------------------------------------- run --- */

const args = parseArgs(process.argv.slice(2));
const recStart = parseTime(args.start);
const shift = shiftFor(recStart, args.shift);
const start = recStart + shift;
const end = parseTime(args.end) + shift;
const runId = `${etDate(recStart)}-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
const out = resolve(args.out ?? join('/tmp/hl-sim', runId));
const BASE = `http://127.0.0.1:${args.port}`;
mkdirSync(join(out, 'shots'), { recursive: true });
mkdirSync(join(out, 'memory'), { recursive: true });

if (args.memorySeed) cpSync(args.memorySeed, join(out, 'memory'), { recursive: true });

// The bot's instructions: the profile's files from bot/, in order, with the
// run directory filled in. Saved beside the transcript and hashed into the
// summary so runs can be compared by what the agent was told.
const profileFile = join(REPO, 'bot/profiles', `${args.profile}.json`);
if (!existsSync(profileFile)) throw new Error(`no bot profile ${args.profile} (expected ${profileFile})`);
const instructions = JSON.parse(readFileSync(profileFile, 'utf8')).files
  .map(f => readFileSync(join(REPO, 'bot', f), 'utf8').trimEnd())
  .join('\n\n')
  .replaceAll('{{RUN_DIR}}', out);
const instructionsHash = createHash('sha256').update(instructions).digest('hex');
writeFileSync(join(out, 'instructions.md'), instructions + '\n');

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
log(`run ${runId} -> ${out}${shift ? ` (recording ${etDate(recStart)} plays as ${etDate(start)})` : ''}`);
const vite = spawn(process.execPath, [join(REPO, 'node_modules/.bin/vite'), '--port', String(args.port), '--strictPort', '--host', '127.0.0.1'], {
  cwd: REPO,
  env: { ...process.env, SIM: '1', SIM_LOG: join(out, 'sim.jsonl'), SIM_SHIFT_MS: String(shift) },
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
// SIM_PAGE_LOG=1 forwards the page's console (replay/sim debugging).
if (process.env.SIM_PAGE_LOG) page.on('console', m => log(`page ${m.type()}: ${m.text()}`));
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

// 4. Claude session. The agent works in a throwaway checkout of master with
// the sim's own files removed, so its repo looks like a normal one.
const agentDir = join(homedir(), '.cache/hlw', runId, 'hl-frontend');
await run('git', ['-C', REPO, 'fetch', '-q', 'origin']);
await run('git', ['-C', REPO, 'worktree', 'add', '-q', '--detach', agentDir, args.ref ?? 'origin/master']);
for (const f of ['scripts/sim.mjs', 'sim-clock.ts', 'specs/sim.md', 'bot']) rmSync(join(agentDir, f), { recursive: true, force: true });
if (existsSync(join(REPO, '.env'))) cpSync(join(REPO, '.env'), join(agentDir, '.env'));
symlinkSync(join(REPO, 'node_modules'), join(agentDir, 'node_modules'));

const hook = path => ({ type: 'command', command: `curl -s -m 5 -X POST ${BASE}/api/sim/${path} >/dev/null || true` });
writeFileSync(join(out, 'settings.json'), JSON.stringify({
  autoMemoryDirectory: join(out, 'memory'),
  // Nothing a sim agent does may reach the real repo or box.
  permissions: {
    deny: ['Bash(git push:*)', 'Bash(scripts/deploy-box.sh:*)', 'Bash(*deploy-box*)', 'Bash(ssh:*)', 'Bash(systemctl:*)'],
  },
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
  '--append-system-prompt', instructions,
  '--model', args.model,
  '--settings', join(out, 'settings.json'),
  '--mcp-config', join(out, 'mcp.json'), '--strict-mcp-config',
  '--disallowedTools', 'CronCreate', 'CronDelete', 'CronList', 'ScheduleWakeup',
  '--permission-mode', 'bypassPermissions',
  '--output-format', 'stream-json', '--verbose',
];
// Bash commands (and hooks) run through this prefix, which makes `date` read
// the replay cursor. Only `date`: Claude's shell snapshot routes grep/find/rg
// through the claude binary, which hangs under libfaketime's LD_PRELOAD.
const prefix = join(out, 'shell-prefix.sh');
writeFileSync(prefix, `#!/usr/bin/env bash
export TZ=America/New_York
c=$(curl -s -m 2 ${BASE}/api/sim/clock | sed -n 's/.*"cursor":\\([0-9]*\\).*/\\1/p')
if [ -n "$c" ]; then
  t=$(/usr/bin/date -d @$((c / 1000)) '+%Y-%m-%d %H:%M:%S')
  exec bash -c "date() { faketime -f '@$t' /usr/bin/date \\"\\$@\\"; }; $*"
fi
exec bash -c "$*"
`, { mode: 0o755 });

// CLAUDE_BIN swaps in another agent binary with the same flags (tests use a scripted one).
const claudeBin = process.env.CLAUDE_BIN || 'claude';
const env = { ...process.env, TZ: 'America/New_York' };
if (args.faketime) env.CLAUDE_CODE_SHELL_PREFIX = prefix;
const tokenFile = join(homedir(), '.config/hl-sim/token');
if (!env.CLAUDE_CODE_OAUTH_TOKEN && existsSync(tokenFile)) env.CLAUDE_CODE_OAUTH_TOKEN = readFileSync(tokenFile, 'utf8').trim();
log(`claude ${args.model}, profile ${args.profile} (${instructionsHash.slice(0, 12)})`);
const claude = spawn(claudeBin, claudeArgs, { cwd: agentDir, env, stdio: ['ignore', 'pipe', 'pipe'] });
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
  runId, params: { ...args, start, end, shiftMs: shift, recordedStart: recStart }, claudeExit: exitCode,
  profile: args.profile, instructionsHash,
  cost: result?.total_cost_usd ?? null,
  end: { cursor: view?.takenAt ?? null, mid: view?.mid ?? null, position: view?.position ?? null, orders: view?.orders ?? [] },
}, null, 2));
writeFileSync(join(out, 'vite.log'), viteLog.join(''));
await run('git', ['-C', REPO, 'worktree', 'remove', '--force', agentDir]).catch(e => log(`worktree remove: ${e.message}`));
rmSync(dirname(agentDir), { recursive: true, force: true });
log(`done: ${out}`);
await cleanup();
process.exit(0);
