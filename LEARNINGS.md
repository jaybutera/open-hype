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

## Iteration: 2026-04-17 11:10

### Picked
Iteration 8: `SymbolSearch` component. First real UI piece. Ties `symbols.ts` (popular list, recents, ranked search) to the `#/options` page scaffold from iteration 7. Prerequisite for `ExpirationTabs` and `ChainGrid` — neither has meaning without a selected symbol.

### Did
- `src/components/options/SymbolSearch.tsx`:
  - 300ms-debounced dropdown (`DEBOUNCE_MS = 300`).
  - Empty query → shows recents (from `getRecentSymbols()`), labeled with a `Recent` section header.
  - Non-empty query → `searchPopularSymbols(query, 12)`; if upper-cased query isn't an exact match inside the hits, prepend it as a free-form row so users can type unlisted tickers (AMZN-style).
  - Click a row, press Enter, or commit typed text → calls `addRecentSymbol()` to push it to the front of localStorage recents, clears input, fires `onChange(symbol)` up to the parent.
  - Keyboard: ArrowDown/Up navigate, Enter commits active row (or free-form typed value), Escape closes + blurs.
  - Outside-click closes via `mousedown` listener on `document`, mirroring `AssetSelector.tsx` convention.
  - `onMouseDown` (not `onClick`) to commit a row — `onClick` fires after the input's `blur`, which lets the outside-click handler close the dropdown before the selection registers; `onMouseDown` with `preventDefault` sidesteps that race.
  - Styling matches existing dark tokens (`#141820` bg, `#2a2f3e` border, `#1a1f2e` hover/selected, no rounding, monospace-ish letter-spacing on the input).
- `src/components/options/OptionsPage.tsx`:
  - New `symbol` state (`useState<string | null>(null)`).
  - Second top bar below the market-status bar hosting `<SymbolSearch>` + a "Loaded: TSLA" indicator when a symbol is selected.
  - Body placeholder text now switches on `symbol` — `"Select a symbol above to load its option chain."` vs. `"Chain for TSLA will render here."`.
- `npx tsc --noEmit` clean.
- `npm test` → 161/161 green (no new tests; `symbols.ts` helpers already have 20 dedicated tests from iteration 6, and the component is a thin presentational shell over those helpers).

### Discovered
- Decision: kept the selected symbol in `OptionsPage` local state, not a Zustand store. Rationale: so far only `OptionsPage` needs it; `ExpirationTabs`/`ChainGrid`/`OrderForm` will all be children of `OptionsPage` and receive it via props. If `PositionsOptions` eventually wants to jump-to-chain on click, promotion to a store is a one-file change. Premature store is worse than late store.
- `onMouseDown(preventDefault)` is the right pattern for dropdown items when the anchor input has focus — `onClick` races with the outside-click `mousedown` handler on `document` and the dropdown can close before the click commits. Both `AssetSelector` and `PaperAccountSelector` use `mousedown` for the outside-close; matching their convention avoids surprise.
- `autoCapitalize="characters"` on the input is a nice hint for mobile, but it doesn't affect desktop typing. We rely on `searchPopularSymbols` upper-casing the query internally and on `commit()` upper-casing the final value via `addRecentSymbol` (which also normalizes). Both layers defend against case drift.
- The free-form fallback row (prepending the raw query when it isn't in the popular list) has no `name` field, so the UI shows `"Free-form"` as a subtitle. That makes it visually distinct from curated entries and hints that the fetch might 404.
- No dedicated unit test file for the component this iteration. The component is a presentation shell over `symbols.ts` helpers (which have 20 tests) and browser event handling — the interactive behavior is hard to cover meaningfully without jsdom + `@testing-library/react`, and the repo doesn't currently use either. If we add RTL later, this component is a natural candidate; skipping for now to stay in scope.

### Next
**Iteration 9: `ExpirationTabs`.** The symbol's now selectable, so the next user-facing flow is picking an expiration. `ExpirationTabs` should render horizontally-scrollable tabs from `chain.expirations[]`, each labeled `Apr 17 (1d)` / `May 16 (29d)` etc., and fire a callback on selection. To render real tabs it needs an `OptionChain` — which means `OptionsPage` has to actually call `yahooAdapter.getChain(symbol)` when the symbol changes. Bundle the fetch into iteration 9 (chain-loading effect + loading state + the tabs UI). After that, iteration 10 (`ChainGrid` render-only) is the natural follow-up.

## Iteration: 2026-04-17 11:13

### Picked
Iteration 9: `ExpirationTabs` + chain-loading in `OptionsPage`. Bundled the chain fetch into this iteration as spec'd — tabs can't render without a loaded `OptionChain`, and the `ChainGrid` in iteration 10 also needs a loaded chain. This removes two blockers at once.

### Did
- `src/components/options/ExpirationTabs.tsx` — new component. Horizontal scroll strip of clickable tabs. Exports `formatExpirationLabel(exp, now)` as a pure helper so label formatting is testable without rendering. Each tab shows `Mon D (Nd)`; the selected tab gets a `#3861fb` border and `#1a1f2e` fill, others get the dim border `#2a2f3e` and transparent fill. `whiteSpace: nowrap` + `overflowX: auto` on the wrapper is what makes it scroll horizontally on narrow screens.
- `src/components/options/__tests__/ExpirationTabs.test.ts` — 4 unit tests for `formatExpirationLabel`: same-day → 0d, month-ahead → expected day count, past → floored at 0d (never negative), NY-timezone day-rollover for a UTC midnight expiration. Uses explicit `Date.UTC(...)` constructions to avoid any ambient-timezone drift in CI.
- `src/components/options/OptionsPage.tsx` — added chain-loading effect: when `symbol` or `selectedExp` changes, calls `adapter.getChain(symbol, selectedExp ?? undefined)`, updates `chain`, shows loading/error states in the second top bar, and (on symbol change) pins `selectedExp` to `chain.loadedExpiration` so the tab strip renders with a correct default selection. A new `handleSymbolChange` resets chain + selectedExp before kicking the effect so there's no stale-data flash between symbols. Renders the tabs strip between the symbol bar and the (still placeholder) body, plus the now-live underlying price next to the `Loaded:` label.
- `YahooOptionsAdapter` is instantiated once at module scope (`const adapter = new YahooOptionsAdapter()`), not inside the component. Adapter is stateless so this is fine and avoids a new instance per render.
- `npx tsc --noEmit` clean.
- `npm test` → 165/165 green (was 161; +4 from `ExpirationTabs.test.ts`).

### Discovered
- Yahoo's `expirationDates` are all UTC midnight of the expiry date (the "contract expires at market close" is implicit — for US equity options that's 4pm ET on the date). For DTE math, ceiling the millisecond diff against `Date.now()` is the right call: at 10am ET on expiration day, `Math.ceil((expMs - nowMs) / 86_400_000)` lands on 0, not 1. `Math.floor` would give -1 for any time past UTC midnight on expiry day, which is wrong.
- `Math.max(0, ceil(...))` floors past-expiration DTE at 0 rather than showing negative. Real expired tabs shouldn't be in `expirations[]` (Yahoo only returns future ones) but it costs nothing to be defensive, and the 0DTE case on-the-day needs to not look like `-0d`.
- Wrote the effect with a `cancelled` flag rather than `AbortController`. Reason: the `fetch` call is inside `adapter.getChain`, which doesn't currently accept a signal. Adding signal support would be a larger API change for no user-visible benefit (we just need to not apply stale results). The cancel flag handles symbol-switch races and the StrictMode double-run in dev.
- Keeping `selectedExp` separate from `chain.loadedExpiration` in component state (rather than always deriving from `chain`) lets the UI show an optimistic tab highlight *during* the refetch — user clicks a tab, the tab immediately goes active, then the chain catches up. If we bound the highlight to `chain.loadedExpiration` only, there'd be a visual lag.
- One subtle: the effect depends on both `symbol` and `selectedExp`. When `symbol` changes, `handleSymbolChange` resets both, which fires the effect twice in quick succession on some React scheduling paths. The `cancelled` flag handles it, but it's worth knowing that in dev we may briefly see two in-flight fetches. The fix would be to collapse the state into a single `{ symbol, selectedExp }` object updated atomically; not worth it yet for the rarity.
- No component-render test for `ExpirationTabs` itself — still no jsdom/RTL in the repo. Extracting `formatExpirationLabel` as a pure export is the compromise: the label logic (the part most likely to regress) is tested, the layout/click handlers aren't. When the repo gains RTL, interaction tests here are a natural follow-up.

### Next
**Iteration 10: `ChainGrid` + `ChainRow` (render-only).** With symbol + expiration + chain loaded, the next visible piece is the options chain grid itself: calls left, strike center, puts right, one row per strike, sorted ascending. Start render-only (no click-to-add-leg — that's iteration 11). Default metrics columns: IV + OI (per spec — pick 2). Need to handle the strike-union case where a strike only has a call or only a put (rare but happens for deep ITM/OTM). Shade ITM rows subtly using a `background: rgba(56,97,251,0.05)` on the ITM side. The row component should be a pure presentational component taking `{ strike, call?, put?, underlyingPrice }` so interaction (iteration 11) layers on top cleanly.

## Iteration: 2026-04-17 11:16

### Picked
Iteration 10: `ChainGrid` + `ChainRow` (render-only). Natural follow-up to iteration 9 — symbol + expiration + chain are all in place, so the grid is the next visible surface. Render-only first (no click-to-add-leg) keeps the iteration small and gives iteration 11 a clean presentational shell to attach interaction to.

### Did
- `src/components/options/ChainRow.tsx` — pure presentational `<tr>` for a single strike. Columns per spec: `[IV | OI | Bid | Ask] STRIKE [Bid | Ask | OI | IV]`. Bid cells green (`#0ecb81`), ask cells red (`#f6465d`), dimmed (`#3d4250`) when bid/ask = 0. Tooltips on bid/ask cells foreshadow iteration 11's click-to-sell / click-to-buy semantics. Strike cell is bold, centered, with left+right borders delimiting the CALL / PUT halves. ITM side gets `background: rgba(56,97,251,0.05)` per spec. Local formatting helpers: `fmtPrice` (2-decimal, `—` for 0/NaN), `fmtIv` (decimal → percent, clamps IV > 5 with `*` marker to flag absurd wings — see Greeks discovery from iteration 4), `fmtInt` (compact k/M for OI).
- `src/components/options/ChainGrid.tsx` — container `<table>` with 9 `<col>` widths tuned so the STRIKE column is centered and calls/puts are mirror-balanced. Header row echoes the column semantics. Exports `buildStrikeRows(chain) → StrikeRow[]` as a pure helper — unions calls + puts by strike (handles strikes that only have one side), sorts ascending. Uses the loaded-expiration's calls/puts only, not the symbol-wide `chain.strikes`, because Yahoo's `strikes[]` is the universe across all expirations.
- `src/components/options/__tests__/ChainGrid.test.ts` — 5 tests: pair call+put at same strike, strike-only-one-side, ascending sort, empty chain → [], dedup when both sides share some strikes and diverge on others.
- `OptionsPage` now renders `<ChainGrid chain={chain} />` in place of the placeholder body text, gated on `chain` being loaded. Loading / error / empty-symbol copy still shows above when there's no chain.
- `npx tsc --noEmit` clean.
- `npm test` → 170/170 green (was 165; +5).

### Discovered
- The spec says "Metrics columns configurable (v1: IV, delta, volume, OI — pick 2 defaults)" — but delta isn't in the OptionContract (it's computed from Greeks, not returned by Yahoo). Picked **IV + OI** for now because both are directly on the contract and don't require running the BS pricer for every strike on render. Delta/gamma columns are a natural add in iteration 23 (metrics customization) where we can decide whether to compute Greeks for every visible row (194 strikes × 2 sides = 388 BS calls per chain render — probably fine, ~ms).
- IV clamp: a 40+ IV on deep-wing contracts (discovered iteration 3) would render as `4000%` which is visually alarming. Clamping to `>5` showing `500%*` with asterisk preserves the information ("this number is not trustworthy") without forcing the user to squint at huge values. Real ATM IVs all fit under 5.
- Yahoo's `chain.strikes[]` is the full union across all expirations; it's NOT the strike list for the loaded expiration. `buildStrikeRows` must derive strikes from the loaded calls/puts, otherwise the grid would render many empty rows for strikes that exist on other expirations. Missed this on the first draft.
- Table layout via `<table>` + `<colgroup>` + fixed percentages gives reliable centering of the STRIKE column without flexbox subpixel drift. Considered CSS grid but `<table>` semantics + consistent alignment won out — and the HTML ends up tiny.
- Kept `ChainRow` a real `<tr>` element (not a div-simulated row) so accessibility tools and screen readers see it as a data table. Probably moot for this UI but costs nothing.
- The bid/ask tooltip text ("Sell call @ bid ...", "Buy call @ ask ...") is forward-looking for iteration 11 where clicking these cells will be the primary trading interaction. Adding them now means when click handlers land, the hover affordance is already in place.
- No jsdom/RTL in repo (per iteration 8 & 9 notes); component-render interactions still untested. `buildStrikeRows` is pure and tested, which covers the part most likely to regress (row-union logic). Visual styling is reviewed by eye.

### Next
**Iteration 11: click-to-add-leg interaction.** Layer on top of `ChainRow`: clicking a bid cell appends a SELL leg, clicking an ask cell appends a BUY leg. Needs (a) a `legs[]` state somewhere reachable by both `ChainGrid` and the upcoming `OrderForm`, (b) per-cell highlighting when that cell's contract is in `legs[]`, (c) 4-leg cap, (d) toggle-off by clicking the same cell again. State likely lifts to `OptionsPage` (same reasoning as `symbol` in iteration 8). `OrderForm` in iteration 12 then consumes the same `legs[]`. Shape leg state as `{ contract, side: 'buy'|'sell', qty: number }`.

## Iteration: 2026-04-17 11:19

### Picked
Iteration 11: click-to-add-leg interaction. Direct continuation of iteration 10 — the chain grid exists but is inert. Without this, nothing downstream (order form, submit flow, positions) has any source of legs. Small enough to land in one iteration, with a pure helper as the tested core.

### Did
- `src/services/options/types.ts` — added `LegSide` and `Leg` ({ contract, side, qty }).
- `src/services/options/legs.ts` — new pure module. `MAX_LEGS = 4`, `legKey`, `findLegIndex`, `hasLeg`, `toggleLeg(legs, contract, side)`. Toggle semantics:
  - Same contract + same side present → remove.
  - Same contract + opposite side present → flip side, preserve qty.
  - New contract → append (no-op if already at 4).
  - Removals and side-flips are always allowed, even at the cap.
- `src/services/options/__tests__/legs.test.ts` — 11 tests covering all toggle branches (append, remove, flip, cap-enforcement, cap-bypass for remove/flip, multi-leg, distinct-symbol, immutability). Input-mutation invariant explicitly asserted via deep-clone snapshot compare.
- `ChainRow` — now takes `legs`, `onCellClick`, `atCapacity` props. Bid/ask cells are click-targets (bid → sell, ask → buy). Selected cells get a coloured background (green for sell, red for buy) and an outline. Cells with no bid/ask (=0) remain uninteractive (greyed + no cursor). When the leg cap is reached, only already-selected cells (for removal/flip) remain interactive — everything else shows `cursor: default`.
- `ChainGrid` — threads legs + onCellClick through to rows; computes `atCapacity = legs.length >= MAX_LEGS` once.
- `OptionsPage` — new `legs` state, `handleCellClick` wraps `toggleLeg`. Symbol change clears legs (old legs reference contracts from a stale chain). New indicator strip above the grid shows leg count (N/4), per-leg chips with side/type/strike/price, a "Max legs reached" warning at the cap, and a "Clear" button to reset. This strip is the provisional surface the real `OrderForm` (iteration 12) will replace.
- `npx tsc --noEmit` clean.
- `npm test` → 181/181 green (was 170; +11).

### Discovered
- Legs must not survive a symbol swap. They hold references to `OptionContract` objects from the previous chain — displaying or re-toggling them after symbol change would be nonsensical. Clear in `handleSymbolChange`. Expiration change is trickier (iteration 12+ question): a diagonal/calendar spread *needs* legs to persist across exp switches because switching tabs is how you pick a second leg's expiration. So only `symbol` change clears; exp change doesn't. This matches spec §Expiration selector: "Each tab independently owned by each leg — default is chain's current expiration. Changing a leg's expiration (for calendars/diagonals): click a cell on a different expiration tab."
- Side-flip on opposite-side click (rather than append-second-leg-same-contract) is the right default — you can't have both a long and a short of the same exact contract in a normal strategy; if a user clicks the same row's ask then bid, they almost certainly meant "I changed my mind, make it a sell." It also avoids the weird case where naïve append would instantly hit the cap after two clicks on one row.
- Cells with `bid = 0` or `ask = 0` (75/183 calls have bid=0 in the TSLA fixture, noted iteration 3) are intentionally not interactive. Clicking into a position at a zero price makes no sense; the fill-model decision (fall back to last, disable, or mid) is a paper-engine concern for the Submit iteration, not a click-handling concern here.
- Kept the leg-chip strip deliberately minimal and temporary. The real `OrderForm` (right-side panel per spec) will show buy/sell badge + full contract string + mark + qty stepper + remove + net-debit/credit/Greeks footer. Building that as a proper panel is iteration 12's scope; for iteration 11 the chip strip is enough to prove click-to-add works and to visualize state during interactive testing.
- The `atCapacity` flag plus per-cell interactive-override (still clickable if already selected on that cell OR its flip-side) is what lets the user *remove* or *flip* legs at the cap without getting trapped. Tested in `legs.test.ts` via the "still allows removal / side-flip even when at the cap" cases.
- Styled selection with both background shade AND outline — background alone was subtle enough that on ITM rows (already tinted blue) selected-sell-green bled into the ITM blue. Outline gives a hard edge; keep both.

### Next
**Iteration 12: `OrderForm` right-side panel.** Replace the provisional leg-chip strip with the real panel: per-leg rows with Buy/Sell badge (editable), contract string (e.g. `TSLA 4/17 $300 Call`), mark price (mid), qty stepper, remove button. Footer: net debit/credit (signed per contract + total × 100), limit price (default net mid), order type (Limit/Market), qty scalar applied to all legs, Submit button. Needs a per-leg `qty` update handler (already have the state shape — just add a setter). Net-Greeks (iteration 13) is a natural pair with the footer; could bundle or split depending on scope. Layout shift: the page becomes two columns (chain left, order form right) once the form gets real — pick a CSS grid or flex split at 70/30.

## Iteration: 2026-04-17 11:24

### Picked
Iteration 12: `OrderForm` right-side panel, **bundled with iteration 13 (net Greeks)**. The Net-Greeks footer and the net debit/credit footer are the same panel section, so splitting them would have meant shipping an OrderForm with a partial footer and then editing the same file next iteration. One coherent cut.

### Did
- `src/services/options/netSummary.ts` — pure helpers. `legMark` (mid preferred, falls back to bid/ask/last, reports `reliable` when both sides are >0), `legSignedMark`, `netPerShare`, `netTotal` (× 100 × qtyScalar), `legGreeks` (signs + qty-weights `blackScholes`), `netGreeks` (sums across legs). `CONTRACT_MULTIPLIER = 100` exported.
- `src/services/options/__tests__/netSummary.test.ts` — 16 tests: legMark fallback chain, legSignedMark sign-by-side, netPerShare empty/weighted/net-credit, netTotal multiplier + scalar + default, netGreeks zero/cancellation/qty-scaling/sign-symmetry. Uses a 30-days-out synthetic expiration so Greeks avoid the degenerate T=0 branch that bit iteration 4.
- `src/components/options/LegRow.tsx` — one leg row: BUY/SELL toggle (two mini-buttons, active side colored), contract label (`TSLA 4/17 $400 Call`), mark with one-sided warning, qty stepper with ± buttons + direct integer input, × remove button. Grid layout (`74px 1fr auto auto`).
- `src/components/options/NetSummary.tsx` — shared footer block. Top: `Net Debit / Credit / Even` with per-contract + per-share breakdown, colored red/green/gray. Bottom: 2×5 Net Greeks grid (Δ Γ ν Θ ρ). Empty-state prompt when no legs. Calls `netPerShare` + `netGreeks` via `useMemo`.
- `src/components/options/OrderForm.tsx` — right-side panel. Header (`Order · strategyLabel · N/4 legs` + Clear). Scrollable leg rows. `NetSummary` footer. Controls grid: order type (Limit/Market), qty scalar, limit-price input that defaults to net mid and becomes overridable (override resets when leg count changes so the default tracks new legs). Submit button green/blue-ified when `marketOpen && legs.length > 0`, disabled with a "Market closed" tagline otherwise. Submit payload `{ orderType, limitPrice, qtyScalar }` — placeholder `console.log` at the call site; paper-engine wiring is iteration 15.
- `OptionsPage.tsx` — removed the provisional leg-chip strip, replaced with a 2-column grid: `minmax(0, 1fr) 340px` (chain / form). Wired leg update/remove/clear handlers and a `marketOpen` prop so the submit button follows the market-hours pill.
- `npx tsc --noEmit` clean.
- `npm test` → 197/197 green (was 181; +16).

### Discovered
- Spec's `netPerShare` is signed (debit positive, credit negative) but the UI shows absolute values with a "Debit / Credit" label. Keeping the sign in the helper (not the display) means downstream paper-engine wiring can trust the sign, and only the view layer has to `Math.abs` + color-branch.
- Limit-override reset: I reset `limitOverride` when `legs.length` changes. Changing a qty or side on an existing leg keeps the override. That matches intuition — a user who typed `$2.50` doesn't want it wiped because they clicked the qty +. But adding/removing a leg materially changes what "net mid" means, so the default should re-take.
- `useEffect`-based override reset is a code smell in abstract — derived state updated by effect — but the alternative (derive override-vs-auto from a comparison of the displayed input against the current mid) requires floating-point equality and defeats the purpose. Effect is the pragmatic pick.
- Fixed 340px right column width: narrower feels cramped with 5 Greeks values + qty stepper; wider eats chain grid real-estate. Not responsive yet; if we care about mobile we'll swap to a flex-wrap layout, but the spec's UX anchor is desktop (Robinhood Legend is desktop-dominant).
- No jsdom/RTL still — component unit tests are limited to pure helpers (`netSummary.ts`). The OrderForm has a handful of nuanced behaviors (limit default vs override sticky/reset, submit disable logic, strategy label selection) that would benefit from rendering tests. When RTL lands, these are the obvious targets.
- `strategyLabel` is a placeholder — it returns `"1-leg"`, `"Long Call"`, or `"N-leg spread"`. Iteration 19 is proper strategy auto-detection (Vertical / Calendar / Iron Condor / …). Deliberately kept this trivial so I don't ship a half-detector that has to be replaced.

### Next
**Iteration 14: extend the paper engine to hold option positions.** Types + storage first, no trading behavior yet. Needs (a) a new `OptionPosition` shape, (b) discriminated `Instrument` union in the engine's position/trade records, (c) `spreadId` linking multi-leg positions, (d) the account store surviving a round-trip through persistence. Once types are in place, iteration 15 (wire Submit → place option paper trade, debit/credit balance) becomes straightforward. Between iterations 14 and 15, the Submit button in the new OrderForm will stay as its console-log placeholder.

## Iteration: 2026-04-17 11:29

### Picked
Iteration 14: extend the paper engine to hold option positions — types + storage, no trading behavior yet. Gating task for iteration 15 (Submit → place paper trade) because Submit needs a home for newly-opened legs. Chose to land it before iteration 15 so the persistence contract is pinned down first; implementing trade flow before storage would mean touching storage twice.

### Did
- `src/engine/paper/options/OptionPosition.ts` — new module:
  - `OptionPosition` shape: `{ id, spreadId, contractSymbol, underlying, type, strike, expiration, szi, entryPx, marginUsed, openedAt }`. `szi` is signed Decimal (+ long, − short) matching `PaperPosition` convention; `strike/szi/entryPx/marginUsed` are `Decimal` for precision.
  - `OptionPositionJSON` parallel type with `string` for Decimal fields; `serializeOptionPosition` / `deserializeOptionPosition` for persistence round-trip.
  - Pure helpers: `CONTRACT_MULTIPLIER = 100`, `legNotional`, `legCostBasis`, `legUnrealizedPnl`, `groupBySpread(positions) → Map<spreadId, legs[]>`.
- `src/engine/paper/persistence.ts` — `PaperAccount.optionPositions?: OptionPositionJSON[]` (optional so legacy saved accounts still load). `createDefaultAccount()` seeds `optionPositions: []`.
- `src/engine/paper/PaperEngine.ts`:
  - New `Map<string, OptionPosition>` field.
  - `loadState(saved)` accepts optional `optionPositions` and rehydrates; legacy saves (no key) load cleanly as empty.
  - `getState()` now includes `optionPositions: OptionPositionJSON[]` (always present, possibly empty).
  - New methods: `getOptionPositions()`, `getOptionPosition(id)`, `getOptionPositionsBySpread(spreadId)`, `addOptionPosition(p)`, `removeOptionPosition(id)`. `addOptionPosition` is storage-only — no balance debit, no margin check. Iteration 15 will replace with a proper `openOptionLegs()` that debits premium and enforces cash margin.
- `src/store/useAccountStore.ts` — added `paperOptionPositions: OptionPositionJSON[]` slice + `updatePaperState` accepts optional `optionPositions`.
- `src/store/usePaperAccountsStore.ts` — `saveActiveAccountState` accepts optional `optionPositions`; only writes the key when present (preserves JSON shape for perp-only callers).
- Tests:
  - `src/engine/paper/options/__tests__/OptionPosition.test.ts` — 15 tests: serialize/deserialize round-trip (incl. fractional and short), notional/cost-basis/PnL signs for long & short, qty scaling, `groupBySpread`.
  - `src/engine/paper/__tests__/PaperEngine.test.ts` +8 tests: initial empty, add/get by id, group by spread, remove (found/missing), getState JSON-shape check, full JSON round-trip with negative szi + high-precision entry, legacy saved-state (no key) loads clean, options-added-doesn't-disturb-perps.
- `npx tsc --noEmit` clean.
- `npm test` → 221/221 green (was 197; +24).

### Discovered
- Making `optionPositions` optional on `PaperAccount` (with `?`) rather than required-with-default is the right compatibility move: any localStorage JSON persisted before this iteration loads without a migration pass. The engine's `loadState` is the one place that reads it, and it uses `saved.optionPositions ?? []`. No writer code path produces an account without the key from now on, so real accounts always have it.
- `PaperState.optionPositions` is NON-optional (unlike `PaperAccount.optionPositions`). The engine always produces it — even if empty — because the field is under the engine's control. `PaperAccount` is the serialized-account shape which must accept *external* inputs (old localStorage), so its field is optional. Two different invariants, same underlying data.
- Kept `addOptionPosition` deliberately unsafe (no balance debit, no margin check). Iteration 15's trade flow will layer balance/margin/ledger semantics on top. If I'd bundled them here, the storage API would be tangled with fill semantics and harder to test in isolation. Now the storage is a thin CRUD layer; the trade submission layer in iteration 15 will own the economics.
- `useAccountStore.updatePaperState` takes the wider PaperState shape (includes options) but its parameter type lists only a subset. TS allows the super-set-in / subset-out pattern via structural compatibility, so `engine.getState()` wires straight into the store without adapters. Kept `optionPositions?` optional on the param to mirror the legacy-compat invariant on `PaperAccount`.
- `groupBySpread` is the obvious primitive the positions view (iteration 16) and strategy-detector (iteration 19) will share. Shipping it now with tests keeps them dependency-free.
- `CONTRACT_MULTIPLIER` is duplicated across `services/options/netSummary.ts` (exported) and here. They MUST stay in sync. Considered cross-importing but didn't want a service→engine dependency (wrong direction) or engine→service (works but unusual). If they drift, tests on both sides will catch the regression via PnL and notional mismatches. Small duplication; document here as the reason.

### Next
**Iteration 15: wire Submit → place option paper trade.** This is the biggest unlocked step now. Needs:
1. A new `openOptionLegs(legs: Leg[], fillModel: 'mid'|'ask-buy-bid-sell', qtyScalar: number)` method on `PaperEngine` that (a) derives a per-leg fill price from the contract's current bid/ask per the fill model, (b) computes premium debit (long) / credit (short) × 100 × qty × scalar, (c) validates total debit ≤ available balance (including a conservative 5× short-premium cash reservation per spec), (d) assigns a fresh `spreadId`, (e) appends `OptionPosition`s + writes a new ledger entry kind tagged `option-open`.
2. A new ledger-entry variant to record option fills (the current `LedgerEntry` shape is very perp-coin-oriented; either add an optional `instrument` field or add a parallel `OptionLedgerEntry` type).
3. Wire the OrderForm Submit button's `onSubmit` to call this new engine method via the store, then clear legs + show toast on success.

Suggest breaking into sub-iterations if this grows too big: (15a) ledger + `openOptionLegs` engine method + tests; (15b) wire OrderForm → engine through the store.

## Iteration: 2026-04-17 11:34

### Picked
Iteration 15a: ledger + `openOptionLegs` engine method + tests. Previous iteration flagged this split; doing the engine-side in isolation keeps the test surface tight and leaves the store/UI wiring (15b) as a clean follow-up. Biggest unlocked step since the paper account can't actually *open* an options trade yet.

### Did
- `src/engine/paper/ledger.ts`:
  - Added `LedgerKind` (`'perp' | 'option-open' | 'option-close' | 'option-expire'`) and optional `kind` + `spreadId` fields on `LedgerEntry`. Perp entries don't set these and behave identically to before (the PnL calendar reads size/price/fee/realizedPnl unchanged).
  - New `createOptionLedgerEntry({ kind, contractSymbol, side, qty, premiumPerShare, cashDelta, realizedPnl, balanceAfter, spreadId })` — stamps a leg-level entry with `coin = contractSymbol`, `size = qty`, `price = premium`, `fee = 0`, and the new `kind`/`spreadId` tags.
- `src/engine/paper/options/margin.ts` — new module. `SHORT_PREMIUM_MARGIN_MULT = 5` per spec. `legCashDelta(szi, entryPx)` (signed, cash OUT for long, cash IN for short). `legMarginRequired(szi, entryPx)` (zero for long, premium×100×qty×5 for short). `computeOpenLegsCost(legs)` aggregates `{ netDebit, totalMargin, cashRequired = netDebit + totalMargin }`.
- `src/engine/paper/options/pricing.ts` — new module. `FillModel = 'mid' | 'cross'`. `legFillPrice(contract, side, model) → { price, reliable }`. Cross: buy pays ask, sell hits bid. Either model falls back to the populated side, then `last`, then 0, marking `reliable=false`.
- `src/engine/paper/PaperEngine.ts`:
  - Module-scope `optionLegCounter` and `spreadCounter` reset in constructor; both resynced in `loadState` from regex-parsed max-id across rehydrated option positions. Prevents id collisions across process reloads.
  - `availableBalance()` now subtracts `marginUsed` across option positions too, so perp orders placed after a short-option leg correctly see the reduced available cash.
  - New `openOptionLegs(legs, { fillModel?, qtyScalar? })` — validates 1–4 legs, positive qtys, positive scalar, and a usable quote per leg; prices each via `legFillPrice`; aggregates cost via `computeOpenLegsCost`; rejects with `{ success: false, error }` if cashRequired > availableBalance. On success: mints a fresh `paper-spread-N` id, creates `paper-opt-M` leg positions (signed `szi`, rehydrated `strike` + `entryPx` + `marginUsed`), subtracts `netDebit` from `this.balance` (credit spreads INCREASE balance since netDebit is negative), appends one ledger entry per leg, emits ONE update.
- Tests:
  - `options/__tests__/margin.test.ts` — 14 tests: multiplier constant, long/short cash delta sign, short margin formula (1x/5x/empty), debit spread net math, credit spread with short margin dominant, empty input, qty scaling.
  - `options/__tests__/pricing.test.ts` — 10 tests: mid fallback chain (both/bid-only/ask-only/last/nothing), cross buy-pays-ask/sell-hits-bid, cross falling through to mid when the crossing side is zero, reliability flag semantics.
  - `__tests__/PaperEngine.test.ts` — 14 `openOptionLegs` tests: empty-legs reject, 5-leg reject, non-positive scalar reject, zero-quote reject, insufficient-balance reject, long-call opens (balance debit + ledger + sharedSpreadId), short-put opens (credit received + margin reserved), vertical debit spread (one spreadId, two ledger entries, correct net), cross fill model (buy=ask, sell=bid), **rollback on reject** (balance/positions/ledger all unchanged when one leg of a batch fails), qtyScalar scaling, single emitUpdate per batch, perp `availableBalance` correctly accounts for option short-margin, id collision survival across JSON round-trip.
- `npx tsc --noEmit` clean.
- `npm test` → 259/259 green (was 221; +38 new across three files).

### Discovered
- **Rollback semantics matter a lot here.** The naive write-as-you-go loop would half-open a spread if the 2nd or 3rd leg's quote were missing. I factored the loop in two passes: first `priced[]` with all validations/pricing, then a single pass that writes positions + debits balance + appends ledger entries. Any failure in pass 1 returns an error before any mutation happens. Pass 2 has no failure paths (everything is already validated), so "rollback" is automatic — there's nothing to roll back. Tested explicitly via the `rollback on reject` case.
- **Credit spread balance math**: `balance.sub(netDebit)` is the same expression for both debit and credit spreads because `netDebit` is signed. Debit spread: netDebit > 0, balance goes DOWN. Credit spread: netDebit < 0, `sub(negative)` ADDS, balance goes UP. No branching needed, no special-case code. Tested in the short-put case.
- **Margin is NOT subtracted from balance**, only from `availableBalance()`. The cash is still there; it's just reserved. This matches the perp engine's treatment of `marginUsed` and means closing a short leg restores capacity without a separate "margin release" step. `availableBalance()` now has a third summation (options) added alongside perp positions and pending entry orders.
- **`fee: '0'` on option-open ledger entries is a deliberate simplification**. Real options have per-contract commissions (+ SEC/ORF fees). Paper trading doesn't charge fees anywhere today (perps pay taker/maker rate but that's a percentage of notional, not a per-unit commission). Parking as zero matches the perp path's "no commission noise" stance.
- **Counter sync on `loadState`**: I parsed `paper-opt-(\d+)` and `paper-spread-(\d+)` out of rehydrated IDs with the same regex pattern as the existing order/fill counters. If a future iteration changes the ID format (e.g. to UUIDs) the counter sync logic will silently fail; documenting here so whoever does that knows to revisit three places at once.
- **`Leg` type lives in `src/services/options/types.ts`** and the engine now imports it. This crosses the engine→services boundary which felt wrong at first, but the alternative (duplicating `Leg` in the engine or inventing an intermediate shape) is worse. The engine *is* the consumer of user-facing legs from the order form, so depending on the same shape is coherent. Flagging in case a future architectural pass wants to invert: move `Leg` into a neutral `src/types/` module.
- **Test ordering quirk**: when I added a second `import type` inside the existing `PaperEngine.test.ts` mid-file (after the `onUpdate` section header), TS allowed it (imports can live anywhere in a module), and vitest didn't care. Kept the placement for organizational clarity — the `openOptionLegs` tests import things only they use. Not canonical but acceptable.

### Next
**Iteration 15b: wire the `OrderForm` Submit button through the store to `openOptionLegs`.** The engine-side machinery is ready. Needs:
1. Account store action: `submitOptionSpread(legs, opts)` that calls `engine.openOptionLegs`, bubbles success/failure, and on success calls `saveActiveAccountState` so the new positions and debited balance persist.
2. `OrderForm`'s `onSubmit` handler: invoke the store action, clear `legs` state on success, surface the error string inline on failure, show the submit button as `Submitting…` during the async (engine is sync today but make the hook treat it as sync or async).
3. Possibly a toast or transient success banner — existing perp flow does this somewhere; mirror it.
4. The market-hours gate is already in place on the Submit button (iteration 12). Short-margin path is tested. Only the plumbing from UI → store → engine is missing.

After 15b, iteration 16 (`PositionsOptions` view) becomes the natural next bottleneck: the user can now open spreads but not yet see them.

## Iteration: 2026-04-17 11:38

### Picked
Iteration 15b: wire the `OrderForm` Submit button through to `PaperEngine.openOptionLegs`. Flagged as next step in the previous iteration — the engine-side machinery was complete but there was no path from a clicked Submit to a real opened position. Highest priority because nothing in iterations 16+ (positions view, close flow, expiration settlement) has any data to work with until the user can actually open a spread in the paper account.

### Did
- `src/App.tsx` — now passes `engine` to `OptionsPage` at the `#/options` hash branch, mirroring how `AppLayout` receives it.
- `src/components/options/OptionsPage.tsx`:
  - Accepts `engine: PaperEngine` prop.
  - New `handleSubmit` calls `engine.openOptionLegs(legs, { qtyScalar, fillModel: 'mid' })`. On success: clears legs, shows `Opened N-leg spread (paper-spread-X).`. On failure: shows the engine's error string verbatim (`Insufficient balance …`, `No usable quote …`, etc.).
  - Submitting via the engine triggers `onUpdate` → `updatePaperState` (store) → `saveActiveAccountState` (localStorage) via the existing `useEngine` wiring, so positions and debited balance persist without any extra plumbing.
  - Reads `paperBalance` + `paperOptionPositions.length` from `useAccountStore`. Balance is shown on the right of the symbol-bar as `Paper balance: $10,000.00 · N open option legs`.
  - Symbol change, clear, and leg-click all clear the feedback banner so stale success/error messages don't linger.
- `src/components/options/OrderForm.tsx`:
  - New `feedback?: OrderFormFeedback | null` prop (`{ kind: 'success'|'error', message }`).
  - Renders an inline banner between `NetSummary` and the control grid (stays visible after legs clear on success). `role="alert"` for errors, `role="status"` for success. Colors follow the existing green/red tokens with 8%-alpha backgrounds.
- No new tests — the wiring is a thin glue layer over components already tested from both sides (59 engine tests cover `openOptionLegs`; 16 `netSummary` tests + 11 `legs` tests cover the OrderForm's inputs). RTL still isn't in the repo, so interactive-component tests stay out of scope.
- `npx tsc --noEmit` clean.
- `npm test` → 259/259 green (unchanged from iteration 15a).

### Discovered
- Decision: called `engine.openOptionLegs` directly from `handleSubmit` rather than adding a `submitOptionSpread` action to `usePaperAccountsStore`. The perp path follows the same convention (`OrderPanel.tsx` calls `engine.placeOrder` directly), and the engine's `onUpdate` callback already handles state + persistence. Adding a store action would just be a passthrough that duplicates the engine's return-type.
- The engine is synchronous, so there's no `Submitting…` transient state to show. Submit clicks finish in the same React tick. If fill-simulation ever gets a delay (e.g. for animated order-book eats), we'd need to introduce async state — for now, no.
- Feedback banner has to render outside the `legs.length > 0` guard on the control grid. Success clears legs → the grid unmounts → without a stable position, success messages would flash for zero frames. Placed it between `NetSummary` (always renders) and the control grid (legs > 0) so it survives the transition.
- `feedback` is cleared on symbol change, clear-all, and leg-click. NOT cleared on qty/side edits, because those don't materially invalidate the previous submission context. Matches the limit-override reset heuristic in iteration 12 (leg count, not per-leg edits).
- Balance indicator uses `Number(paperBalance).toLocaleString(...)`. The stored value is a `Decimal` string like `"10000"` — `Number(...)` works cleanly for display purposes (12 significant digits is plenty for $ balances; precision matters inside the engine, not in the header chip).
- Fill model is hard-coded `'mid'` at the call site. The spec mentions mid/bid-for-sell/ask-for-buy ('cross') as the two models; exposing a toggle in the OrderForm footer is a small future add but not scope for 15b. When added, the control should slot in next to `Order type` in the existing 2-col grid.

### Next
**Iteration 16: `PositionsOptions` view — options-positions subview in the existing positions list.** The user can now open spreads but has no way to see them after the OrderForm clears. Should:
1. Read `paperOptionPositions` from `useAccountStore` and group by `spreadId` via the `groupBySpread` helper from iteration 14.
2. Per spread: show a single row (strategy-name placeholder until iteration 19, net entry credit/debit from summing `legCostBasis`, current net mark from `legMark` on the current chain if it's the active symbol, unrealized PnL, net Greeks, DTE to nearest-leg expiration).
3. Expand-to-see-legs for each spread.
4. Click a spread → stub close-panel (actual close flow is iteration 17).
5. Live chain mark is only available for the currently-loaded underlying. For spreads on other symbols, show entry-basis + expiration + last-fill without a live mark; flag with a subtle indicator so users know why it's stale.
6. Decision needed: place this view inline on the options page (below the chain/form) or as its own tab/section. Inline on the options page is the minimum-friction option — the right-side form gets the live action, the bottom gets the positions list.

