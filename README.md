# Kapa Trader

A one-file web bot that trades on your own Deriv account through Deriv's official WebSocket API (`wss://ws.derivws.com/websockets/v3`). There's no backend: the page talks to Deriv directly from your browser.

## Connect your Deriv account (OAuth 2.0)

Deriv's newer accounts log in with OAuth 2.0. You never type a password or token into the bot.

**One-time setup (5 minutes):**
1. Sign in at **https://developers.deriv.com** and register a new app with **OAuth 2.0** login.
2. For the redirect URL, enter exactly `https://bobgick453.github.io/kapa-trader/`. The bot also shows it under **Connect → OAuth settings**, with a Copy button.
3. Copy the app's **client ID**. It isn't a secret, so it's safe to put in the page.
4. In the bot, open **OAuth settings**, paste the client ID, and tap **Log in with Deriv**. To make it permanent for every visitor, set `DEFAULT_CLIENT_ID` in `index.html`.

**After that:**
- When you open the bot, it goes straight to Deriv. If you're already signed in to Deriv in that browser, you just approve, and you come back linked to your **demo** account first.
- The login is remembered on that device, and expired logins renew automatically when Deriv provides a refresh token. **Admin → Disconnect** unlinks it.
- Switch between Demo and Real from the account name in the header.

No website can read your deriv.com login by itself, because browsers block that to protect your account. Deriv's approve screen is the safe version of "detect my account automatically".

**If login fails with "blocked by the browser":** Deriv's token server isn't accepting requests directly from web pages. Deploy `token-exchange-worker.js` as a free Cloudflare Worker (dash.cloudflare.com → Workers → Create → paste the file → Deploy). Then paste the worker's URL into **OAuth settings → Token exchange URL**.

### Older Deriv accounts
Accounts still on the old API can use **Older Deriv accounts: API token**: paste a token with **Read** + **Trade** scopes, or use an App ID from api.deriv.com.

## Screens (same layout as the reference video)
- **Header**: account type and balance (tap to switch accounts after OAuth login), **Transfer** opens Deriv's cashier
- **Pill menu**: Admin · KAPA (scanner) · Dashboard · Bot Builder, plus the floating orb with a LIVE/OFFLINE badge
- **Scanner**: stake, take-profit and stop-loss, then the gold "Activate" ring. It pulls live Deriv prices for Over 1 and Over 2 across five Volatility indices, ranks them by expected result, and shows the top 3 cards with **Use this market**
- **Activation popup**, then the **Dashboard** with Summary / Transactions / Journal, Download / View Detail and the stats grid
- **Run / Stop bar** with the Starting → Buying → Bought progress line and a Won/Lost state
- A **result popup** when the bot hits take-profit (or stop-loss / loss limit)
- **Bot Builder**: the settings drawn as blocks

To rename the bot, go to **Admin → Bot name**, or change `DEFAULT_BRAND` in `index.html`.

## What it does
- Contracts: Digit Over/Under/Matches/Differs/Even/Odd on Volatility indices, 1–10 ticks
- Take-profit, **required** stop-loss, stake cap, max losses in a row, max trades
- Optional martingale (multiplier after a loss) and a recovery prediction digit used after a loss
- The scanner shows each market's true win chance, Deriv's payout and the expected result per trade
- Session stats, transactions (CSV export, contract detail) and a journal
- Asks for confirmation before trading on a real account. Stop waits for the open contract to finish.

## Honest note
Synthetic indices are random by design. Deriv's payout is always below fair odds: Over 1 pays about +17–19% while the true odds would justify +25%. So the expected result of every contract is negative, about −6%, whatever the "signal" or stake plan. Martingale doesn't change that. It trades many small wins for occasional large losses. Use stakes you can afford to lose.
