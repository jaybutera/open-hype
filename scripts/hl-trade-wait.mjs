#!/usr/bin/env node
/**
 * Block until a trade proposal is decided, then print the outcome and exit.
 * Meant to be run in the background by the AI session that proposed it (Bash
 * run_in_background), so the session wakes when the user confirms or rejects.
 *
 *   node scripts/hl-trade-wait.mjs <proposal id>
 *
 * Long-polls GET /api/ai/trades/wait on the dev server (HL_FRONTEND_URL, default
 * http://localhost:3000). A dev server restart is retried, but proposals live in
 * memory, so a restart loses them (reported as GONE). Exit 0 when the trade was
 * sent and the exchange accepted it, 1 otherwise.
 */
const BASE = (process.env.HL_FRONTEND_URL || 'http://localhost:3000').replace(/\/+$/, '');
const id = process.argv[2];
if (!id) { console.error('usage: hl-trade-wait.mjs <proposal id>'); process.exit(1); }

const sleep = ms => new Promise(r => setTimeout(r, ms));

for (;;) {
  let res, text;
  try {
    res = await fetch(`${BASE}/api/ai/trades/wait?id=${encodeURIComponent(id)}&timeout=30`);
    text = await res.text();
  } catch {
    await sleep(5000); // dev server down or restarting
    continue;
  }
  let body;
  try { body = JSON.parse(text); } catch { await sleep(5000); continue; }
  if (res.status === 404) {
    console.log(`TRADE GONE: ${id} no longer exists (the dev server restarted or dropped it)`);
    process.exit(1);
  }
  if (body.trade) {
    const t = body.trade;
    const by = t.decidedBy ? ` by ${t.decidedBy === 'auto' ? 'auto-confirm' : 'the user'}` : '';
    console.log(`TRADE ${t.status.toUpperCase()}${by}: ${t.id} (${t.mode}) ${t.result?.message ?? ''}`);
    console.log(JSON.stringify(t));
    process.exit(t.status === 'done' ? 0 : 1);
  }
  // still pending or executing: poll again
}
