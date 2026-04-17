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

## Iteration: 2026-04-17 11:03

### Picked
Iteration 5: `services/options/marketHours.ts` + tests. Small, independent, unblocks the "Market closed" banner and submit-disabled gate. Also cheap to pair with iteration 6 next, so burning through the foundation pieces before committing to UI work.

### Did
- `src/services/options/marketHours.ts`:
  - `isMarketOpen(now?)`, `isHoliday(now?)`, `isEarlyCloseDay(now?)`, `nextOpen(now?)`.
  - `NYSE_HOLIDAYS_2026` (10 entries — NYE, MLK, Presidents, Good Friday, Memorial, Juneteenth, Jul 3 observed for Sat Jul 4, Labor, Thanksgiving, Christmas).
  - `NYSE_EARLY_CLOSE_2026` (Nov 27 day-after-Thanksgiving and Dec 24 Christmas Eve) closing at 13:00 ET.
  - DST handled via `Intl.DateTimeFormat` with `America/New_York` — no hardcoded UTC offsets. `openInstantForNyDate` iteratively corrects a UTC guess by reading it back through the formatter (converges in ≤4 passes).
- `src/services/options/__tests__/marketHours.test.ts` — 18 tests using a local `nyDate()` helper that inverse-maps NY wall-clock → UTC. Covers:
  - Constants/holiday-list integrity.
  - Open boundaries (09:29 closed, 09:30 open, 15:59 open, 16:00 closed).
  - Weekend closed (Sat + Sun).
  - Good Friday and New Year holidays closed mid-session.
  - Early-close day 13:00 boundary.
  - `nextOpen`: already-open returns now; pre-open same day → 09:30; after-close → next day 09:30; Friday after-close → Monday 09:30; Thu Apr 2 after-close → Mon Apr 6 09:30 (skips Good Friday).
- `npx tsc --noEmit` clean.
- `npm test` → 141/141 green (was 123; +18).

### Discovered
- `Intl.DateTimeFormat` with `hour: '2-digit'` and `hour12: false` can emit `'24'` at midnight on some V8 builds (observed locally), so modulo-24 normalization in `partsInNewYork` is defensive but cheap.
- Tried fixed UTC offset shortcuts first; abandoned them because DST makes the offset +/−5 depending on month, and the 2026 spring-forward (Mar 8) / fall-back (Nov 1) would silently produce off-by-one-hour bugs near those dates. Iterating on a live formatter is robust and runs in microseconds.
- 2026 calendar quirks: Jul 4 is Saturday (observed Jul 3 full holiday, no early close there), Christmas Dec 25 is Friday, July 3 is Friday. Day-after-Thanksgiving and Christmas Eve are the only early-close days; no post-Independence-Day half-day this year.
- Chose `minutesSinceMidnight` as the core time representation so boundary checks are plain integer comparisons — avoids any `new Date` re-construction inside the hot path.

### Next
**`services/options/symbols.ts` + static popular-list + `localStorage` recents** (iteration 6). Small and independent — finishes the data-layer scaffold. Then iteration 7 (route scaffold `#/options`) becomes the only gate on every UI task. After symbols lands, adapter/Greeks/market-hours/symbols are all in place and UI work can start flowing.

## Iteration: 2026-04-17 11:06

### Picked
Iteration 6: `services/options/symbols.ts` — static popular-symbols list + `localStorage` recents + symbol search. Small, independent, final data-layer piece. Landing it now closes out the foundation so the next iteration can be the `#/options` route scaffold without any remaining service-layer gaps.

### Did
- `src/services/options/symbols.ts`:
  - `POPULAR_SYMBOLS` — 208 entries covering mega-cap tech, financials, healthcare, consumer, energy/industrials/materials, REITs, broad-market ETFs, sector ETFs (XLK/XLF/…), fixed-income (TLT/HYG/…), commodities (GLD/SLV/USO/…), volatility (VXX/UVXY/…), leveraged (TQQQ/SOXL/…), and crypto-adjacent (IBIT, FBTC, GBTC, ARKB, BITB, ETHA, ETHE, FETH, MSTR, MARA, RIOT, CLSK). Each entry has `{ symbol, name }`.
  - `searchPopularSymbols(query, limit = 10)` — case-insensitive ranking: exact → prefix → substring (symbol) → substring (name). Empty query returns `[]`.
  - `getRecentSymbols()`, `addRecentSymbol(symbol)`, `clearRecentSymbols()` — `localStorage` key `hl-options-recent-symbols`, 10-entry cap, most-recent-first, dedup by upper-cased symbol, trims and upper-cases input, gracefully tolerates missing `window`, corrupt JSON, quota errors, non-string array entries.
- `src/services/options/yahooAdapter.ts#searchSymbols` — replaced stub with real implementation: upper-cases query, runs `searchPopularSymbols`, and if the exact ticker isn't already in the results, prepends it as a free-form fallback so the UI can still try to fetch a chain for unlisted tickers.
- `src/services/options/__tests__/symbols.test.ts` — 20 tests covering list integrity (no dupes, uppercase, required anchors TSLA/SPY/QQQ/IBIT/FBTC, ≥150 entries), search ranking (exact-first, case-insensitive, prefix-before-substring ordering invariant, name fallback, limit honored), and full recents-storage lifecycle (empty, push-to-front, dedup, upper/trim, empty-input no-op, 10-cap, clear, corrupt-JSON, non-string filtering). Uses `vi.stubGlobal('window', ...)` with an in-memory Map-backed `localStorage` mock.
- `npx tsc --noEmit` clean.
- `npm test` → 161/161 green (was 141; +20).

### Discovered
- Vitest's jsdom environment isn't enabled for these test files (no leading `@vitest-environment jsdom` and the config is node by default), so `window` doesn't exist. `vi.stubGlobal('window', { localStorage: mockStorage })` is enough — the module only touches `window.localStorage`. Saves setting up jsdom for pure-logic tests.
- The prefix-ranking assertion "all prefix matches precede all substring matches" needs to be stated as an ordering invariant rather than a count-based partition, because some queries (like `SP`) can have near-100% prefix matches, making a count split tautological. The invariant phrasing catches future regressions where substring or name matches accidentally slip ahead of prefix.
- Free-form fallback in `searchSymbols`: prepending the upper-cased query even when it doesn't match the popular list lets the UI keep letting users try `AMZN`, `WBA`, etc. Chain fetch will 404 cleanly if the ticker has no listed options. Avoids forcing the popular list to be exhaustive.
- Considered integrating the Yahoo `/v1/finance/search?q=` endpoint as an online autocomplete, but it requires the same cookie+crumb handshake as the chain endpoint and adds another rate-limit surface. Static list + free-form is good enough for v1; if we later want a real online search, it can be a proxy route at `/api/symbols/search?q=` that reuses the cached cookie/crumb.

### Next
**Iteration 7: wire `#/options` route + empty page scaffold into `App.tsx`.** Gating task for all UI work — `SymbolSearch`, `ExpirationTabs`, `ChainGrid`, etc. (iterations 8–13) can't land without it. Should be small: register the route alongside `#/pnl`, add a nav entry if there's a nav component, render an `OptionsPage.tsx` stub that just says "Options" so routing can be verified visually. Once that's in, iteration 8 (`SymbolSearch` using the new `symbols.ts` helpers) is the first real UI piece.

## Iteration: 2026-04-17 11:08

### Picked
Iteration 7: wire `#/options` route + empty page scaffold into `App.tsx`. Gating task for every UI iteration (8–13, 16, 18, 22). Without it there's no surface to render `SymbolSearch`, `ChainGrid`, `OrderForm`, etc. Small and unambiguous — cheap unblock.

### Did
- `src/components/options/OptionsPage.tsx` — new page component. Styled to match the `PnlCalendar` top-bar convention (back-link, bold title, existing color tokens). Renders:
  - `<- Back to Trading` link to `#/`.
  - `MARKET OPEN` / `MARKET CLOSED` pill computed from `isMarketOpen(now)`.
  - When closed, inline `Next open: <date> ET` label from `nextOpen()`.
  - Placeholder body text where chain + order form will render.
  - `useEffect` ticks `now` every 30s so the pill flips across the 9:30/16:00 boundary without a refresh.
- `src/App.tsx` — imported `OptionsPage`, added `hash === '#/options'` branch above the default `AppLayout` return. Mirrors the existing `#/pnl` pattern.
- `src/components/layout/Header.tsx` — added an `Options` nav link next to the existing `PnL` chip, same styling (no new tokens).
- `npx tsc --noEmit` clean.
- `npm test` → 161/161 green (unchanged — no new test files; the page is a thin presentational shell with no pure logic worth testing yet. The `isMarketOpen`/`nextOpen` bits already have 18 dedicated tests from iteration 5).
- Dev server smoke test: `npm run dev` + `curl http://localhost:3000/` → 200, `id="root"` present. Route hash changes happen client-side so curl-verifying the `/#/options` URL doesn't add signal; visual verification is deferred to the user.

### Discovered
- `App.tsx` does its hash routing with a simple `useHashRoute` hook (hashchange listener, no router library). New routes are two lines: import + hash comparison. Easier than pulling in react-router just for `/options`.
- The existing `#/pnl` top-bar pattern (back-link to `#/` + bold title) already handles the "sub-page without header" case perfectly. Reusing it keeps `OptionsPage` self-contained and avoids having to decide whether the global `Header` should change based on route — that would force paper-account state decisions we haven't made yet (options share the perps account, so we DO want the paper account indicator, but not yet, not with a placeholder body).
- The 30-second tick interval for the market-open pill is a tradeoff: finer ticks waste renders when the pill state flips only twice a day; coarser ticks risk missing the 9:30 open boundary by up to a minute. 30s is small enough to be unnoticeable.
- Kept `borderRadius: 0` and the exact color tokens (`#3861fb`, `#0ecb81`, `#f6465d`, `#1a1f2e`) from the existing PnL page so the new route doesn't introduce visual drift. The repo clearly treats borders as hard edges — no rounding anywhere in the header/trading chrome.
- No new Header imports required — just duplicated the chip-link JSX. If we end up with 3+ nav chips, worth extracting a `<NavChip>` component; not worth it for 2.

### Next
**Iteration 8: `SymbolSearch` component.** First real UI piece — ties together the static popular list, recents-storage, and free-form entry built in iteration 6. Should live in `src/components/options/SymbolSearch.tsx`, render a text input with a 300ms-debounced dropdown, wire Enter to commit a free-form ticker. Needs to hand its selected-symbol state *somewhere* — either lift it to `OptionsPage`'s local state or stash it in a dedicated Zustand store. A local `useState` on `OptionsPage` is the simplest until we need the symbol in a sibling like `PositionsOptions` view, at which point a store is warranted. Start local; promote if needed.
