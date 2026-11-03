# Serveur Premium de Kapa Trader

> **Hébergement recommandé : Netlify.** Le serveur tourne sur Netlify sans aucun code à copier. Netlify importe le dépôt `kapa-trader` (branche `main`), qui contient `netlify.toml`, la fonction `premium-server/netlify/functions/kapa.mjs` (copie de `server/netlify/kapa.mjs`) et le serveur en un fichier (`node server/bundle.mjs`). Le guide pas à pas est dans `premium-server/GUIDE-NETLIFY.md` sur `main`. Sur Netlify, le stockage est Netlify Blobs et `SESSION_KEY` est créée automatiquement : seules les variables `ADMIN_SECRET` et `PREMIUM_CODE` sont à saisir. La suite de ce document décrit l'hébergement Cloudflare, qui reste possible.

Ce petit serveur (un *Cloudflare Worker*, gratuit jusqu'à 100 000 requêtes par jour) gère le Premium :

- il vérifie auprès de Deriv à quel compte appartient chaque visiteur connecté ;
- il crée les paiements **CinetPay** (Orange Money, MTN, Moov, Wave, Visa/Mastercard) ;
- il vérifie le **code secret Premium** : c'est vous qui le choisissez (onglet **Admin**), vous l'utilisez vous-même, et vous l'envoyez aux clients qui ont payé. Vous pouvez le changer à tout moment : tous les appareils qui utilisaient l'ancien code sont alors reverrouillés ;
- il **revérifie chaque paiement auprès de CinetPay** et l'affiche dans l'Admin, avec sa référence. Payer ne débloque rien tout seul : le client vous envoie sa référence, vous lui envoyez le code ;
- il **fait tourner les stratégies Premium** : le site lui envoie le résultat de chaque contrat et reçoit le trade suivant. Les règles (barrières, récupération, multiplicateur), le scanner et les réglages des bots Premium ne sont jamais envoyés au site.

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
openssl rand -hex 32                             # génère une clé aléatoire à copier ci-dessous
wrangler secret put SESSION_KEY                  # collez la clé générée (signe les sessions et les accès Premium)
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
- Sur le site, l'onglet KAPA AI affiche « PREMIUM LOCKED » et le champ « Premium code ».
- Onglet **Admin** → entrez votre `ADMIN_SECRET` → carte **Premium code** : choisissez votre code (8 caractères ou plus) et enregistrez-le.
- Onglet KAPA AI → entrez ce code → « Unlock » : toutes les options Premium apparaissent sur cet appareil.
- Faites un vrai paiement de test du plus petit montant possible : il apparaît dans Admin → *Payments* avec sa référence.

## 5. Le code Premium au quotidien

- **Vous** : entrez le code une fois par appareil (téléphone, ordinateur). Il reste actif tant que vous ne changez pas le code.
- **Un client paie** (CinetPay, ou mobile money directement chez vous) : son écran affiche une référence de paiement. Il vous l'envoie sur WhatsApp ou Telegram ; vous vérifiez dans Admin → *Payments* qu'elle est « paid », puis vous lui envoyez le code.
- **Changer le code** (fin d'abonnement, code partagé sans votre accord…) : Admin → *Premium code* → nouveau code. Tous les appareils sont reverrouillés immédiatement, y compris les vôtres ; renvoyez le nouveau code à vous-même et aux clients à jour de paiement.
- Les espaces, les tirets et les majuscules ne comptent pas : « ABCD-1234-XYZ » et « abcd 1234 xyz » sont le même code.
- Le code n'est jamais enregistré en clair : le serveur n'en garde qu'une empreinte chiffrée avec `SESSION_KEY`. Notez-le en lieu sûr, l'Admin ne peut pas vous le réafficher.
- Après 10 codes faux, l'adresse du visiteur est bloquée une heure.
- Option : vous pouvez définir un premier code sans passer par l'Admin avec `wrangler secret put PREMIUM_CODE`. Un code enregistré depuis l'Admin le remplace.
- Ajoutez vos liens WhatsApp/Telegram dans `brand.config.json` → `platform.social` : un bouton « Contact Kapa » apparaît alors dans la carte Premium.

## Ce qui est protégé

- **Les stratégies Premium tournent sur le serveur.** Le navigateur ne reçoit que l'ordre du prochain contrat (marché, barrière, mise). Sans accès Premium valide, le serveur répond « 402 » et ne donne aucun trade. L'accès est revérifié à chaque décision : si vous changez le code pendant une session, elle s'arrête.
- **Le code est vérifié par le serveur, jamais par le site.** Un code juste donne à l'appareil un « pass » signé, lié à la version actuelle du code. Modifier la page ou fabriquer un pass ne sert à rien : le serveur le refuse.
- **Les sessions sont signées** (HMAC avec `SESSION_KEY`) : une session modifiée, expirée (6 h) ou appartenant à un autre compte est refusée. Le serveur ne stocke rien et ne garde jamais le jeton Deriv.
- **Les limites sont imposées par le serveur** : stop-loss obligatoire, mise jamais supérieure au stop-loss, nombre de pertes d'affilée plafonné.
- **Paiements** : chaque paiement est revérifié auprès de CinetPay, une seule fois (une notification rejouée n'ajoute pas de jours).
- **Admin** : secret de 20 caractères minimum ; après 10 essais faux, l'adresse IP est bloquée une heure.
- **Ce qui reste possible** : chaque client place lui-même ses trades avec son compte Deriv, donc personne ne peut l'empêcher d'écrire sa propre stratégie. Mais il n'obtient ni les stratégies Kapa, ni le scanner, ni les bots Premium sans payer.

## Garder vos réglages de stratégie privés

Le code de ce serveur est public sur GitHub, avec des valeurs par défaut pour les stratégies (barrières, multiplicateur…). Pour utiliser des valeurs que personne ne peut lire, enregistrez-les dans un secret Cloudflare. Elles remplacent alors celles du code :

```bash
wrangler secret put PREMIUM_RULES
```

Collez un texte JSON de ce format (chaque partie est facultative) :

```json
{
  "presets": {
    "pegasus":    { "barrier": 1, "recovery": 5, "recMode": "mult",    "martingale": 2.2, "maxLosses": 4 },
    "martingale": { "barrier": 2, "recovery": 4, "recMode": "mult",    "martingale": 2.2, "maxLosses": 5 },
    "recover":    { "barrier": 1, "recovery": 5, "recMode": "recover", "martingale": 1,   "maxLosses": 4 }
  },
  "bots": {
    "under7-dalembert": { "symbol": "R_75", "prediction": 7 },
    "odd-oscars":       { "symbol": "R_25" }
  }
}
```

`barrier` et `recovery` : chiffre de 0 à 8 (contrat « Over ») ; `recMode` : `mult` (mise multipliée), `recover` (récupère les pertes en un gain) ou `none` ; `martingale` : de 1 à 5 ; `maxLosses` : de 1 à 20. Si le texte est invalide, les stratégies Premium s'arrêtent (aucun trade), mais les paiements et l'Admin continuent de fonctionner.

## Changer une clé

Si un secret a pu fuiter, remplacez-le avec `wrangler secret put <NOM>`. Changer `SESSION_KEY` arrête simplement les sessions KAPA AI en cours (les membres relancent). Changer `ADMIN_SECRET` n'affecte pas les membres.
