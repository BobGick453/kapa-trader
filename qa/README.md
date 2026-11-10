# Kapa QA

`bash qa/run-all.sh` runs everything. Browser tests use Playwright (pre-installed in Claude cloud sessions)
and a fake Deriv (`browser/derivmock.js`, `browser/trademock.js`); they never touch a real account.

- `server/` — strategy engine, KAPA AI trade runner (`engine.test.mjs`: stake rounding, stake caps, lost
  connection, daily loss record; loads the TypeScript through `ts-load.mjs`), Premium server (Cloudflare-style
  worker) and Netlify adapter tests.
- `browser/` — end-to-end: Premium code, KAPA Apex with default settings (`apex.js`), lost connection during a
  contract (`conn.js`), capital limits, strategy lab, classic bots, UI, Deriv relink,
  floating buttons, marked-up prices, the 4 Free Bots in Bot Builder (`freebot.js`: load, run, stop-loss).
  Screenshots go to `browser/x/`.
- `real/` — real Deriv data and backtests:
  - `real-2026-11-04.json`: 300,000 real ticks (10 Volatility indices) and real prices of 32 contracts.
  - `collect.cjs`: downloads fresh ticks and prices from Deriv's public API (needs `api.derivws.com` allowed).
  - `engine-real.mjs`, `apex-bt.mjs`: Kapa's server strategies replayed on the real ticks.
  - `classic-bt2.mjs`: the classic bots (build `src/pages/kapa-ai/classic.ts` to `real/classic.mjs` with
    `npx esbuild src/pages/kapa-ai/classic.ts --format=esm --outfile=qa/real/classic.mjs`).
  - `exact.py`, `rand.py`: the reference bots replayed exactly; randomness tests.
  - `freebots-bt.mjs`: the 4 Free Bots, reference XML vs Kapa's XML (`src/pages/free-bot/xml/`), at the public
    and a marked-up price.
  - `blockly-to-text.py`: turns a Bot Builder XML into readable pseudo-code.
