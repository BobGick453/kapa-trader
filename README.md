# Kapa Trader

A one-file web bot that trades on your own Deriv account through Deriv's official WebSocket API (`wss://ws.derivws.com/websockets/v3`). There's no backend: the page talks to Deriv directly from your browser.

## Use it

1. Open `index.html` in a browser, or host it anywhere static (GitHub Pages, Netlify Drop, Cloudflare Pages).
2. On Deriv, go to **Settings → API token** and create a token with **Read** and **Trade** scopes only. Do not enable Payments or Admin.
3. Paste the token and press **Connect with token**. Start on your **Demo** account.

### Optional: "Log in with Deriv"
1. Register an app at https://api.deriv.com and set the redirect URL to wherever you host `index.html`.
2. Put your App ID in the **App ID** field and press **Log in with Deriv**.
3. You'll come back logged in, with all your accounts in the header dropdown. The bot starts on the demo account.

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
