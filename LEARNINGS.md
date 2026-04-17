# Options Paper Trading — LEARNINGS

Persistent log across iterations of the `specs/options-paper.md` ralph loop. Append to this file every iteration. Read it first to avoid re-doing work or re-discovering gotchas.

## Design-phase findings (pre-iteration-1)

### Data source landscape (as of 2026-04-16)

- **Hyperliquid** has no native options. HIP-3 is perps only. HIP-4 (options-ish prediction markets) on testnet, mainnet expected Q2 2026.
- **Deribit** — crypto options only (BTC/ETH/SOL). Full CORS, no auth for market data. Reserved for future v2 crypto-options support.
- **Yahoo Finance** `/v7/finance/options/{SYMBOL}` — works, returns full chain with bid/ask/IV/volume/OI for any US equity or ETF. No Greeks (compute client-side). Huge coverage. Not an official API; needs cookie+crumb handshake.
- **Polygon free tier** — contracts list works, but snapshot/quote endpoints are locked behind paid tier. Free only gives EOD aggregates. Not enough for live paper trading.
- **Tradier sandbox** — free, Greeks included, CORS-enabled, browser-direct. User's application pending approval. If it comes through later, add a TradierAdapter behind the same interface.
- **Alpaca** — data endpoint blocks CORS, requires proxy. Not worth it.

Chose **Yahoo via a Vite dev-plugin proxy** for v1.

### Yahoo proxy — verified working (scratch at `/tmp/yahoo-proxy-test/`)

Real numbers from end-to-end test (browser → Vite → Yahoo):
```
TSLA  price $387.71  |  22 expirations  |  194 strikes
sample: TSLA260417C00005  bid 381.55  ask 382.80  IV 22.88
```

**Gotchas discovered:**

1. Node's default `fetch` (undici 16KB header limit) crashes on Yahoo's huge response headers. Must use `undici` with `new Agent({ maxHeaderSize: 128 * 1024 })`. Silent failure without this.
2. Vite's built-in `server.proxy` cannot do the multi-step cookie+crumb dance. Must use a `configureServer` middleware.
3. `Headers.get('set-cookie')` joins multiple cookies with commas and corrupts `Expires=...` dates. Use `headers.getSetCookie()` (array return).
4. `/v1/test/getcrumb` is aggressively IP-rate-limited. Cache the cookie+crumb for the process; refresh only on 401/403/429. Don't re-handshake per request.
5. User-Agent must be a real Chrome UA string. Generic or missing UA → 429 immediately.
6. Cookie + crumb stable for hours once acquired.
7. Yahoo is not an official API; ToS discourages scraping; fine for personal paper-trading but don't monetize.

### UX anchor — Robinhood Legend options chain

- Side-by-side layout (calls left / puts right / strike centered), NOT 4-column buy/sell grid
- Click **bid = sell**, click **ask = buy** — the cell encodes direction
- Up to 4 legs; each click appends a leg to the sticky order form
- Calendar/diagonal spreads supported (legs at different expirations)
- Net Greeks + simulated returns panel with time/IV sliders
- Gotchas to avoid: strategy-name loss on close, closed positions disappearing, no qty presets

### User preferences locked in

- Very broad symbol coverage (search box + free-form ticker entry + static popular list)
- 4-leg max is fine
- Compute Greeks client-side from IV (Black-Scholes)
- Shared paper account across perps and options
- Auto-exercise ITM at expiration, cash-settle, no early exercise, no share delivery
- Only operate during market hours
- Market-hours only — disable when closed
- Ralph agent picks one task per iteration, commits locally, branch `options-paper`, no push

## Iterations

<!-- Append iteration logs below this line -->

## Iteration: 2026-04-17 10:53

### Picked
Task 1 from iteration list: port the Yahoo proxy plugin from `/tmp/yahoo-proxy-test/vite.config.ts` into the main project. Highest priority because every downstream task (fixture capture, adapter, chain UI, paper trading) depends on having a working live chain source in the real dev server. Without this, nothing else can be built or tested end-to-end.

### Did
- `npm install undici` (added as direct dep; Node 22 ships it but the explicit `Agent` API requires the package).
- Rewrote `vite.config.ts`:
  - Preserved existing `@vitejs/plugin-react`.
  - Added `yahooProxyPlugin()` implementing the 3-step cookie+crumb handshake, cached in module scope, refreshed on 401/403/429.
  - `undici`'s custom `Agent` with `maxHeaderSize: 128 * 1024` wired in so Yahoo's giant headers don't crash the response.
  - Uses `Headers.getSetCookie()` (array) rather than `.get('set-cookie')` which mangles commas inside `Expires=` dates.
  - Endpoint: `GET /api/options/:symbol` and `GET /api/options/:symbol?date=<unix>` (spec-called-for optional expiration param).
- Created `options-paper` branch off `master`.
- Verified end-to-end: `npm run dev` → `curl http://localhost:3000/api/options/TSLA` returns the full chain JSON (22 expirations, ~194 strikes, matches scratch-prototype numbers).
- `npm test` → 97/97 green.

### Discovered
- The scratch prototype dev server bound to `127.0.0.1` explicitly; the project's default binds to `localhost` (IPv6-preferred on some systems), so early curl against `127.0.0.1` failed. Kept project default — `localhost` works from the browser and that's what matters.
- Pre-existing `tsc --noEmit` errors in `src/engine/paper/__tests__/PaperEngine.test.ts:431,447` (string|number vs string). Exist on `master` before this iteration — NOT introduced by my changes. Spec requires clean typecheck after iterations; will need to address these soon so the gate remains meaningful. Flagging for next iteration.
- `plugin-react` needs to be registered BEFORE the custom middleware plugin in the plugins array — Vite middleware order matters; our proxy path never collides with React HMR so either order works in practice, but putting react first matches convention.
- Undici's `fetch` type signatures don't play perfectly with a thin wrapper that adds `dispatcher`; needed a small `unknown`-based cast to keep TS quiet without `any`.

### Next
Most important next task: **capture a real TSLA chain response as a fixture JSON** (iteration 2). Reason: the adapter, Greeks, and chain-rendering components all need a deterministic test input. Once a fixture exists, the adapter + `OptionChain` parser (iteration 3) can be built and tested offline, and subsequent UI work isn't gated by Yahoo availability. Also worth addressing the pre-existing `PaperEngine.test.ts` tsc errors to restore the clean-typecheck gate.

## Iteration: 2026-04-17 10:56

### Picked
Iteration 2 from the list — capture a real TSLA chain as fixture JSON. Highest priority because every downstream pure-logic task (adapter parser, Greeks tests, chain-row rendering, strategy detection) needs deterministic offline input. Also addressed the pre-existing `PaperEngine.test.ts` tsc errors flagged last iteration so the clean-typecheck gate is actually meaningful again.

### Did
- Created `src/services/options/__fixtures__/` directory.
- Ran `npm run dev` in the background, curled `/api/options/TSLA`, saved the raw Yahoo response as `src/services/options/__fixtures__/tsla_chain.json` (117 KB).
- Verified fixture integrity with Node: `symbol=TSLA`, `price=$406.41`, 22 expirations, 194 strikes, 183 calls + 188 puts for the first expiration (1776384000 = 2026-04-17). Sample call `TSLA260417C00005000` bid/ask/IV match shape expected by the adapter interface.
- Fixed `src/engine/paper/__tests__/PaperEngine.test.ts` tsc errors at lines 431,447 by wrapping `r.oid!` with `String(...)` since `PlaceOrderResult.oid` is `number | string` and `cancelOrder` takes `string`.
- `npx tsc --noEmit` → clean.
- `npm test` → 97/97 green.

### Discovered
- Yahoo's `impliedVolatility` field appears to be returned as a percentage-ish number in the fixture (e.g. `39.90625` for a deep-ITM TSLA call), not the `0.5 = 50%` decimal the adapter spec assumes. Need to verify on a near-ATM contract before deciding the normalization: the deep-ITM numbers might be garbage/high-IV from a wide spread rather than genuine scale mismatch. **Check during adapter work (iteration 3).** If truly percentage, divide by 100 in the normalizer.
- Yahoo returns `calls` and `puts` as separate arrays already sorted by strike — adapter doesn't need to re-sort, just trust the upstream.
- The top-level response shape is `{ optionChain: { result: [ { underlyingSymbol, expirationDates[], strikes[], quote{regularMarketPrice,bid?,ask?}, options:[{expirationDate, calls[], puts[]}] } ] } }`. `options` is an array of length 1 — the loaded expiration. All other expirations are just in `expirationDates[]`; you have to re-fetch with `?date=` to get their calls/puts.
- Fixture is checked in as-is (117 KB JSON, still well under any reasonable size limit).

### Next
**Build `services/options/types.ts` + `yahooAdapter.ts`** (iteration 3). Parse the fixture into a normalized `OptionChain`. Unit-test the parser against the fixture so IV scaling, ITM detection, and bid/ask defaulting are pinned down. This unblocks Greeks (iteration 4 — needs the normalized `OptionContract` shape) and every chain-rendering component.

## Iteration: 2026-04-17 10:58

### Picked
Iteration 3: build `services/options/types.ts` + `yahooAdapter.ts` and parse the TSLA fixture into a normalized `OptionChain`. Highest priority because Greeks, chain grid, order form, and paper engine options work all need the normalized `OptionContract` shape. Tested against the committed fixture so downstream work is offline-deterministic.

### Did
- `src/services/options/types.ts` — `OptionContract`, `OptionChain`, `OptionsAdapter`, `SymbolHit`.
- `src/services/options/yahooAdapter.ts` — exports `parseYahooChain(raw) → OptionChain` (pure) and a `YahooOptionsAdapter` class that hits `/api/options/:symbol[?date=...]` and pipes the response through the parser. `searchSymbols` is a stub that returns the upper-cased input; real symbol list lands in iteration 6.
- `src/services/options/__tests__/yahooAdapter.test.ts` — 9 tests against `__fixtures__/tsla_chain.json`: underlying metadata, 22 sorted expirations, 194 sorted strikes, 183 calls / 188 puts for the loaded expiration, deep-ITM contract field normalization, near-ATM IV decimal check, finite-number defaults, ITM flag sanity vs strike, and malformed-response throws.
- `npx tsc --noEmit` clean.
- `npm test` → 106/106 green (was 97; +9 new).

### Discovered
- IV is NOT uniformly scaled. ATM IV is a normal decimal (~0.33). Wings can be `4+` or even `40+` in the fixture — those appear to be genuine degenerate IV implied by very wide bid/ask on illiquid deep-ITM/OTM contracts, not a scale issue. **Do not normalize IV**; pass it through. The Greeks pricer will have to guard against stupidly large IVs if it ever tries to render them (probably clamp for display).
- Yahoo returns calls/puts already sorted by strike — our parser trusts that (we only sort `strikes[]` and `expirationDates[]` at the chain level as a defensive measure).
- 75/183 TSLA calls have `bid === 0` (no resting bid). The parser preserves this as-is; the order form will need a fill-model policy for unfilled-bid sells (e.g. fall back to last, or disable sell-to-open).
- Vitest `include` pattern is `src/**/__tests__/**/*.test.ts` — tests must live under a `__tests__/` directory, not adjacent `foo.test.ts` as the spec's file-layout sketch suggests. Honoring the repo convention, not the spec's.
- `tsconfig.json` already has `resolveJsonModule: true`, so `import fixture from '../__fixtures__/tsla_chain.json'` works without extra config.
- Kept `searchSymbols` stubbed to avoid coupling the adapter to `symbols.ts` ahead of its iteration. When iteration 6 lands, that method gets rewritten to filter the popular list + recents.

### Next
**Build `services/options/greeks.ts` + tests** (iteration 4). Black-Scholes delta/gamma/vega/theta/rho for `(S, K, T, r, σ, type)` with `r = 0.045` and `T` in years. Unit-test known-value benchmarks (standard BS pricing table entries) and a sanity test against the TSLA fixture (ATM call delta ~0.5, etc.). This unblocks the net-Greeks panel in the order form and the payoff diagram. After Greeks, market-hours (iteration 5) is a small independent piece that unblocks the market-closed banner.

## Iteration: 2026-04-17 11:00

### Picked
Iteration 4: build Black-Scholes Greeks module + tests. Highest priority because the order form's net-Greeks panel, position-level Greeks, and the payoff diagram all depend on a pricing function. Market-hours (iteration 5) is independent and comparable size, but Greeks unblocks more downstream UI surface area.

### Did
- `src/services/options/greeks.ts` — pure `blackScholes({ S, K, T, sigma, type, r? }) → { price, delta, gamma, vega, theta, rho }`. Exports `RISK_FREE_RATE = 0.045`, `SECONDS_PER_YEAR`, helpers `normCdf`, `normPdf`, `yearsUntil(expUnix, nowUnix?)`. `normCdf` uses the Abramowitz-Stegun 7.1.26 rational approximation (accurate to ~1e-7, no dependency on `erf`).
- Vega and rho reported per 1% change (divide by 100); theta per day (divide by 365). Standard broker-facing conventions — aligns with what the UI will show.
- Degenerate inputs (T≤0 or sigma≤0) collapse to intrinsic value with delta = step function at K.
- `src/services/options/__tests__/greeks.test.ts` — 17 tests:
  - `normCdf`/`normPdf` boundary values.
  - `yearsUntil` conversion + clamp.
  - Hull textbook case (S=42, K=40, r=0.10, σ=0.20, T=0.5) → call 4.759, put 0.808.
  - Put-call parity (C - P = S - Ke^-rT).
  - Call/put delta differ by 1; gamma and vega equal across types.
  - ATM r=0 delta sanity for both types.
  - T=0 intrinsic/degenerate branches.
  - TSLA-fixture sanity projected 30 days forward (ATM call delta in (0.3,0.7), positive gamma/vega, negative theta; ATM put symmetric).
- `npx tsc --noEmit` clean.
- `npm test` → 123/123 green (was 106; +17).

### Discovered
- The committed TSLA fixture's **loaded expiration equals the captured day** (both 2026-04-17). `yearsUntil(loadedExpiration, asOf)` returns 0, so any Greeks test that naively takes the front-month ATM contract falls into the degenerate T≤0 branch. Worked around by projecting to a 30-day synthetic horizon in the fixture sanity test. Future tests that want non-trivial Greeks against the fixture need to either (a) use a later expiration from `chain.expirations[1..]` once we fetch one (requires per-expiration re-fetch) or (b) project time forward synthetically.
- Divergent IV on deep-ITM/OTM wings (40+) noted in iteration 3 is a *real* hazard for Greeks display — a 40.0 IV ATM option would produce gamma/vega that dwarf everything else in a net-Greeks sum. The Greeks function itself is correct; the UI will need to clamp or flag absurd-IV contracts when rendering. Flagging for the order-form iteration.
- `Math.SQRT2` makes normCdf simpler and faster than a hand-rolled `Math.sqrt(2)` constant; also avoids floating-point reproducibility concerns across V8 versions.
- Kept `searchSymbols` stubbed in the adapter from last iteration — still valid. No changes to adapter or types this iteration.

### Next
**`services/options/marketHours.ts` + tests** (iteration 5). Small, independent, unblocks the "Market closed" banner and the submit-disabled gate. Needs `isMarketOpen(now?)`, `nextOpen(now?)`, and a hardcoded NYSE 2026 holiday list. Pure function, easy to unit-test. After that, iteration 6 (static popular-symbols list + localStorage recents) is also small and independent. These two cheap wins leave the adapter/Greeks/fixture/market-hours/symbols foundation complete, at which point the route scaffold (iteration 7) becomes the gating task for any UI work.
