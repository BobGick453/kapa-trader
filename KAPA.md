# Kapa Trader platform

Kapa Trader is built on Deriv's open-source [trading-bot-template](https://github.com/deriv-com/trading-bot-template) (MIT licence, copyright Deriv.com, see `LICENSE`), with:

- **KAPA AI tab** (`src/pages/kapa-ai/`): the trade runner, session plan, live contract card, transactions, journal and result popups. It trades through the app's own authorized Deriv connection. The free fixed-stake strategy runs in the browser; the Premium strategies, the scanner and Premium plans run on the Kapa server, which sends the next trade after each settled contract.
- **Kapa branding**: navy and gold dark theme by default, Kapa logo and name (`brand.config.json`, `_themes.scss`, `BrandLogo.tsx`).
- **Sub-folder hosting**: `PUBLIC_PATH` sets where the app is served from, including the OAuth redirect URL (`src/utils/base-path.ts`).
- **Privacy**: the template's Google Tag Manager IDs, Survicate surveys and the upload of strategies and transactions to Deriv's analytics service are switched off.

- **Reference-bot screens**: splash, pill tabs (Admin, KAPA AI, Dashboard, Bot Builder, Free Bot, Charts, Tutorials), dashboard carousel with social icons, floating AI orb with the live connection state and the KAPA Live Scanner, risk warning, Free Bot library.
- **Premium** (`server/`): a Cloudflare Worker. Premium is unlocked with a secret code the owner sets and changes from the Admin tab; the server checks the code and runs the Premium tools. Payments go through CinetPay (mobile money and cards); the owner then sends the code. Setup guide in `server/README.md`. Without `KAPA_API_URL` at build time the Premium tools are unavailable and only the free tools work. Security notes and the audit are in `SECURITY.md`.

## Build for GitHub Pages

```bash
npm ci --ignore-scripts
CLIENT_ID=34QvhOYOwdiGB0X15zX0W APP_ENV=production PUBLIC_PATH=/kapa-trader/ [KAPA_API_URL=https://…workers.dev] npm run build
```

Copy the contents of `dist/` to the root of the `main` branch of `kapa-trader`, and copy `index.html` to `404.html`.

`CLIENT_ID` is the App ID of the app on developers.deriv.com. Its redirect URL must be `https://bobgick453.github.io/kapa-trader/`.
