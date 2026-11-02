# Serveur Premium de Kapa Trader

Ce petit serveur (un *Cloudflare Worker*, gratuit jusqu'à 100 000 requêtes par jour) gère le Premium :

- il vérifie auprès de Deriv à quel compte appartient chaque visiteur connecté ;
- il crée les paiements **CinetPay** (Orange Money, MTN, Moov, Wave, Visa/Mastercard) ;
- il **revérifie chaque paiement auprès de CinetPay** avant d'activer le Premium. Une notification seule ne suffit jamais ;
- il enregistre les abonnements par compte Deriv et alimente la page **Admin**.

Le secret Admin et les clés CinetPay restent sur le serveur. Ils ne sont jamais dans le site public.

## 1. Ouvrir un compte marchand CinetPay

1. Inscrivez-vous sur **https://cinetpay.com** et complétez la vérification (KYC) de votre entreprise.
2. Dans votre tableau de bord CinetPay, notez votre **API Key** et votre **Site ID** (menu *Intégrations*).
3. Activez les moyens de paiement voulus : mobile money de votre pays et carte bancaire.

## 2. Créer le serveur sur Cloudflare

Sur un ordinateur, avec Node.js installé :

```bash
npm install -g wrangler
wrangler login                                   # ouvre Cloudflare dans le navigateur (compte gratuit)
cd server
wrangler kv namespace create KAPA_KV             # copiez l'"id" affiché dans wrangler.toml
wrangler secret put CINETPAY_APIKEY              # collez votre API Key CinetPay
wrangler secret put CINETPAY_SITE_ID             # collez votre Site ID
wrangler secret put ADMIN_SECRET                 # choisissez une longue phrase secrète (20 caractères ou plus)
```

Dans `wrangler.toml`, réglez le prix et la durée :

```toml
PRICE_XOF = "5000"   # prix en francs CFA, multiple de 5
PLAN_DAYS = "30"     # jours d'accès par paiement
```

Puis publiez :

```bash
wrangler deploy
```

Wrangler affiche l'adresse du serveur, par exemple `https://kapa-premium.votre-nom.workers.dev`.

## 3. Brancher le site sur le serveur

Reconstruisez le site avec cette adresse :

```bash
CLIENT_ID=34QvhOYOwdiGB0X15zX0W APP_ENV=production PUBLIC_PATH=/kapa-trader/ \
KAPA_API_URL=https://kapa-premium.votre-nom.workers.dev npm run build
```

Ou envoyez simplement l'adresse à Claude, qui reconstruira et publiera le site.

## 4. Vérifier

- `https://<adresse-du-serveur>/plan` doit afficher le prix, avec `"configured": true`.
- Sur le site, l'onglet KAPA AI affiche « PREMIUM LOCKED » et le bouton « Get Premium ».
- L'onglet **Admin** accepte votre `ADMIN_SECRET` et affiche les membres et les paiements.
- Faites un vrai paiement de test du plus petit montant possible. Vous pouvez aussi offrir le Premium à votre propre compte depuis Admin → *Grant Premium* (identifiant du compte Deriv, par exemple `ROT90001`).

## Ce qui est protégé, et ce qui ne l'est pas

- **Protégé par le serveur :** qui a payé, pour quel compte Deriv, jusqu'à quand ; les fonctions Admin ; les clés CinetPay.
- **Limite :** le trading se fait dans le navigateur du client, avec son propre compte Deriv. Une personne qui sait modifier le code d'une page web pourrait débloquer l'affichage des outils Premium chez elle sans payer. Pour l'empêcher totalement, il faudrait faire tourner les stratégies sur le serveur, ce qui est une étape à part.
