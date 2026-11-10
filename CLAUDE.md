# Kapa Trader: project brief for Claude and its agents

The owner speaks French: every message to the owner is in French. Agents report to the supervisor (the main
Claude session), which reviews, tests, publishes and reports to the owner.

## Where things are

| What | Where |
|---|---|
| Live site | https://bobgick453.github.io/kapa-trader/ (GitHub Pages, this repo's `main` branch: built files only) |
| Source code | branch `platform-source` of this repo. Clone it next to this checkout: `git clone -b platform-source https://github.com/BobGick453/kapa-trader ../kapa-platform` |
| Premium server | `server/` in the source; deployed by Netlify (site `kapa-premium`) from `main`'s `premium-server/` folder |
| Tests | `qa/` in the source: `bash qa/run-all.sh` (see `qa/README.md`) |
| Strategy evidence | `STRATEGIES.md` (source and `main`) |

The app is Deriv's open-source Bot template (React, MobX, rsbuild), rebranded Kapa. Kapa-specific code:
`src/pages/kapa-ai/` (KAPA AI page, engine, classic bots, lab), `src/pages/premium/`, `src/pages/free-bot/`,
`src/pages/admin/`, `src/components/kapa-*`, `server/` (strategies, Premium code, CinetPay).

## Build and publish (supervisor only)

1. In `../kapa-platform`: `bash qa/run-all.sh` must pass.
2. Commit on the source branch, then `git push origin HEAD:platform-source`.
3. Build: `CLIENT_ID=34QvhOYOwdiGB0X15zX0W APP_ENV=production PUBLIC_PATH=/kapa-trader/ KAPA_API_URL=https://kapa-premium.netlify.app npm run build`.
4. In this checkout (`main`): replace `assets js static index.html 404.html front-channel.html deriv-logo.svg kapa-logo.svg` with `dist/*`, copy `index.html` to `404.html`; if `server/` changed, also copy `server/dist/kapa-premium-worker.js` and `server/dist/netlify/functions/kapa.mjs` into `premium-server/`; commit and `git push -u origin main`. Netlify redeploys only when `premium-server/`, `netlify.toml` or `package*.json` change (it costs build credits).

## Rules every agent follows

- **Honesty about trading.** Deriv's digits are random (tested on 300,000 real ticks) and every contract pays
  under its odds, so no strategy is profitable in the long run. Never claim otherwise in the app, in docs or to
  the owner. "Better" means: higher chance of reaching the target, lower average loss, never past the
  stop-loss, capital protected. Back every claim with a backtest on real ticks (`qa/real/`).
- **Capital protection stays on:** session stop-loss at most 25% of the balance, daily loss limit, no stake
  past the stop-loss or the maximum stake, recovery cycles that fit the stop-loss.
- **Premium stays server-side.** Premium rules live in `server/strategy.js`; the website only receives the
  next trade. Never move Premium logic into the browser.
- **Reference bot (goldstandardmarket.site): reuse allowed, brand excluded.** On 2026-11-09 the owner reported
  that the reference bot's owner authorised Kapa (on Telegram) to reproduce its look, layout, animations, design
  assets and bot settings. Kapa may now match it closely and reuse its visual files where useful, but keeps its own
  name and logo: never show "Pegasus", "GSM" or the reference's logo, and never copy its untrue claims
  ("machine learning", crossed-out fake prices, profit promises). The honesty rules above still apply.
- **Secrets:** never ask for, print or commit `ADMIN_SECRET`, `PREMIUM_CODE`, API keys or tokens.
- Test on the fake Deriv or a demo account; never place trades on a real account.
- Agents do not push or publish; they hand finished, tested changes to the supervisor.

## Network

The cloud environment allows `api.derivws.com`, `ws.derivws.com`, `ws.binaryws.com` (real Deriv data) and
`goldstandardmarket.site` (reference bot). Deriv rate-limits requests: pace them (see `qa/real/collect.cjs`).
