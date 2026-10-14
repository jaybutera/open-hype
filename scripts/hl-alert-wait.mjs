#!/usr/bin/env node
/**
 * Block until a price alert fires, then print it and exit. Meant to be run in
 * the background by the AI session that armed the alert (Bash run_in_background),
 * so the session is woken when the alert fires.
 *
 *   node scripts/hl-alert-wait.mjs <alert id>
 *
 * Long-polls GET /api/ai/alerts/wait on the dev server (HL_FRONTEND_URL, default
 * http://localhost:3000). A dev server restart is retried silently. Exit 0 when
 * the alert fired, 1 when it no longer exists or the id is missing.
 */
const BASE = (process.env.HL_FRONTEND_URL || 'http://localhost:3000').replace(/\/+$/, '');
const id = process.argv[2];
if (!id) { console.error('usage: hl-alert-wait.mjs <alert id>'); process.exit(1); }

const sleep = ms => new Promise(r => setTimeout(r, ms));

for (;;) {
  let res, text;
  try {
    res = await fetch(`${BASE}/api/ai/alerts/wait?id=${encodeURIComponent(id)}&timeout=30`);
    text = await res.text();
  } catch {
    await sleep(5000); // dev server down or restarting
    continue;
  }
  let body;
  try { body = JSON.parse(text); } catch { await sleep(5000); continue; }
  if (res.status === 404) {
    console.log(`ALERT GONE: ${id} no longer exists (removed or the dev server lost it)`);
    process.exit(1);
  }
  if (body.status === 'fired') {
    const a = body.alert;
    const when = new Date(a.firedAt).toISOString();
    console.log(`ALERT FIRED: ${a.asset} ${a.kind}${a.interval ? ' ' + a.interval : ''} ${a.direction} ${a.level} at ${a.firedPrice} (${when})${a.note ? ' - ' + a.note : ''}`);
    console.log(JSON.stringify(a));
    process.exit(0);
  }
  // still armed: poll again
}
