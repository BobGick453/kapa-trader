# Kapa QA

`bash qa/run-all.sh` runs everything. Browser tests use Playwright (pre-installed in Claude cloud sessions)
and a fake Deriv (`browser/derivmock.js`, `browser/trademock.js`); they never touch a real account.

- `server/` — strategy engine, Premium server (Cloudflare-style worker) and Netlify adapter tests.
- `browser/` — end-to-end: Premium code, capital limits, strategy lab, classic bots, UI, Deriv relink,
  floating buttons, marked-up prices. Screenshots go to `browser/x/`.
- `real/` — real Deriv data and backtests:
  - `real-2026-11-04.json`: 300,000 real ticks (10 Volatility indices) and real prices of 32 contracts.
  - `collect.cjs`: downloads fresh ticks and prices from Deriv's public API (needs `api.derivws.com` allowed).
  - `engine-real.mjs`, `apex-bt.mjs`: Kapa's server strategies replayed on the real ticks.
  - `classic-bt2.mjs`: the classic bots (build `src/pages/kapa-ai/classic.ts` to `real/classic.mjs` with
    `npx esbuild src/pages/kapa-ai/classic.ts --format=esm --outfile=qa/real/classic.mjs`).
  - `exact.py`, `rand.py`: the reference bots replayed exactly; randomness tests.
  - `blockly-to-text.py`: turns a Bot Builder XML into readable pseudo-code.
