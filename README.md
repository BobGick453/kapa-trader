# Kapa Trader

Live at **https://bobgick453.github.io/kapa-trader/**

Kapa Trader is a Deriv trading platform built on Deriv's open-source [trading-bot-template](https://github.com/deriv-com/trading-bot-template) (MIT licence, copyright Deriv.com). It has the full Deriv Bot interface (Dashboard, Bot Builder, Charts, Tutorials) plus the **KAPA AI** tab.

## What's in this repository

| Path | What it is |
|---|---|
| `/` (this branch) | The built platform that GitHub Pages serves |
| `classic/` | The earlier one-file Kapa bot, kept as a fallback |
| `token-exchange-worker.js` | Optional Cloudflare Worker for the classic bot's login |
| branch `platform-source` | The platform's source code. Build steps are in `KAPA.md` there |

## Logging in

Tap **Log in with Deriv**. The app uses Deriv's OAuth 2.0 login with the App ID `34QvhOYOwdiGB0X15zX0W`. The app's redirect URL on developers.deriv.com must be exactly `https://bobgick453.github.io/kapa-trader/`.

The classic bot at `/kapa-trader/classic/` returns to its own address after login. To use its "Log in with Deriv" button, add `https://bobgick453.github.io/kapa-trader/classic/` as a second redirect URL on developers.deriv.com.

## Screens, as in the reference bot

- Splash screen, then pill tabs: **Admin · KAPA AI · Dashboard · Bot Builder · Free Bot · Charts · Tutorials**
- **Dashboard**: WhatsApp and Telegram icons (links go in `brand.config.json` → `platform.social`), and cards for My computer, Google Drive, Quick strategy, Speed Bot (coming soon) and Bot Builder
- **AI orb on every page**: shows LIVE, CONNECTING, RECONNECTING or OFFLINE, and opens the **KAPA Live Scanner**. It shows true win chances and Deriv's live payouts, and never places trades
- **⚠ button**: risk warning
- **Free Bot**: a library of Kapa bots that load into Bot Builder
- **Admin**: Premium members and payments

## Premium

Premium unlocks the recovery strategies, the scanner, advanced settings and the Premium bots. The session plan stays free. Payments go through **CinetPay** (mobile money and cards) to a small server you run on Cloudflare. Its source and setup guide are in `server/` on the `platform-source` branch. Until that server's address is added to the build, Premium is off and everything is open.

## KAPA AI

- **Strategies**:
  - Over 1 with ×2.2 recovery on Over 5
  - Over 2 with ×2.2 recovery on Over 4
  - Over 1 with a recovery sized to win back losses exactly
  - Fixed stake
  - Every setting is adjustable under "advanced settings"
- **Session plan**: simulates your settings 4,000 times with your balance, the true win chances and Deriv's live payouts. It shows how often the take-profit is reached, how often the session stops at a loss and how much, and the average result.
- **Scanner**: compares live Deriv prices across Volatility indices and shows the three best-priced markets.
- **Safety**:
  - Stop-loss is required
  - Maximum stake and a limit on losses in a row
  - Confirmation before trading real money
  - KAPA AI won't start while a Bot Builder strategy is running

## Honest note

Synthetic indices are random by design, and Deriv pays less than the true odds on every contract. Recovery strategies reach small targets often, but each failure costs far more than a success earns, so the long-run average result is a loss. The session plan shows these numbers for your own settings. Only trade money you can afford to lose.
