# Serveur Premium de Kapa Trader

> **Hébergement recommandé : Netlify.** Le serveur tourne sur Netlify sans aucun code à copier. Netlify importe le dépôt `kapa-trader` (branche `main`), qui contient `netlify.toml`, la fonction `premium-server/netlify/functions/kapa.mjs` (copie de `server/netlify/kapa.mjs`) et le serveur en un fichier (`node server/bundle.mjs`). Le guide pas à pas est dans `premium-server/GUIDE-NETLIFY.md` sur `main`. Sur Netlify, le stockage est Netlify Blobs et `SESSION_KEY` est créée automatiquement : seule la variable `ADMIN_SECRET` est à saisir (plus `CINETPAY_APIKEY`, `CINETPAY_SITE_ID` et `PRICE_XOF` pour les paiements). La suite de ce document décrit l'hébergement Cloudflare, qui reste possible.

Ce petit serveur (un *Cloudflare Worker*, gratuit jusqu'à 100 000 requêtes par jour) gère le Premium :

- il vérifie auprès de Deriv à quel compte appartient chaque visiteur connecté ;
- il crée les paiements **CinetPay** (Orange Money, MTN, Moov, Wave, Visa/Mastercard) ;
- il donne **Premium à un compte Deriv pour 30 jours** : après un paiement confirmé par CinetPay, avec un code cadeau que vous créez dans l'Admin, ou quand vous l'activez vous-même dans l'Admin. Premium s'arrête tout seul, et vous pouvez l'arrêter à tout moment ;
- il **revérifie chaque paiement auprès de CinetPay** et l'affiche dans l'Admin, avec sa référence ;
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

- `https://<adresse-du-serveur>/plan` doit afficher le prix, avec `"configured": true` (ou `false` tant que CinetPay n'est pas réglé).
- Sur le site, l'onglet KAPA AI affiche « PREMIUM LOCKED » et le champ « Gift code ».
- Onglet **Admin** → entrez votre `ADMIN_SECRET` → carte **Premium accounts** : entrez votre identifiant de compte Deriv (CR…, VRTC…) → « Switch Premium on » : votre compte est Premium pour 30 jours.
- Faites un vrai paiement de test du plus petit montant possible : il apparaît dans Admin → *Payments*, et le compte de l'acheteur passe Premium tout seul.

## 5. Premium au quotidien

Premium appartient à un **compte Deriv** pendant `PLAN_DAYS` jours (30 par défaut) et s'arrête tout seul.
- **Un client paie** avec CinetPay : dès que CinetPay confirme le paiement, son compte Deriv devient Premium. Rien à envoyer.
- **Sans CinetPay** : Admin → *Contact for buyers* → votre numéro WhatsApp (avec l'indicatif, chiffres seulement). Le bouton « Get Premium on WhatsApp » ouvre WhatsApp avec l'identifiant de compte Deriv du visiteur dans le message ; vous l'activez dans Admin → *Premium accounts*. Sans numéro, la page indique « Premium purchase opens soon ».
- **Codes cadeaux** : Admin → *Gift codes* → un nom et un nombre d'utilisations. Le code (KAPA-XXXX-XXXX-XXXX) n'est affiché qu'une fois : copiez-le. Chaque utilisation donne 30 jours au compte Deriv qui l'entre (une fois par compte). Vous pouvez le désactiver à tout moment.
- **Arrêter un compte** : Admin → *Premium accounts* → « End now ».
- Les codes ne sont jamais enregistrés en clair : le serveur n'en garde qu'une empreinte chiffrée avec `SESSION_KEY`.
- Codes faux : 5 essais libres par appareil, puis une attente qui double (30 s, 1 min… 15 min au plus). Une adresse partagée (réseau mobile) n'est mise en pause 15 min qu'en cas d'avalanche (30 codes faux en une heure).
- **Ancien code partagé** (`PREMIUM_CODE` ou le code enregistré avant cette version) : un appareil qui l'avait déjà saisi reçoit une fois 30 jours sur son compte Deriv à sa prochaine visite connectée ; ensuite il ne sert plus à rien. Vous pouvez supprimer la variable `PREMIUM_CODE` quand vous voulez.

## Ce qui est protégé

- **Les stratégies Premium tournent sur le serveur.** Le navigateur ne reçoit que l'ordre du prochain contrat (marché, barrière, mise). Sans Premium actif sur le compte Deriv connecté, le serveur répond « 402 » et ne donne aucun trade. L'accès est revérifié à chaque décision : si Premium se termine ou si vous l'arrêtez pendant une session, elle s'arrête.
- **Le compte est vérifié par le serveur, jamais par le site** : il demande à Deriv à quels comptes appartient la connexion du visiteur. Le jeton Deriv n'est jamais enregistré.
- **Les sessions sont signées** (HMAC avec `SESSION_KEY`) : une session modifiée, expirée (6 h) ou appartenant à un autre compte est refusée.
- **Les limites sont imposées par le serveur** : stop-loss obligatoire, mise jamais supérieure au stop-loss, nombre de pertes d'affilée plafonné. Le site les revérifie avant chaque achat.
- **Paiements** : chaque paiement est revérifié auprès de CinetPay, une seule fois (une notification rejouée n'ajoute pas de jours).
- **Admin** : secret de 20 caractères minimum ; après 10 essais faux, l'adresse IP est bloquée une heure.
- **Ce qui reste possible** : chaque client place lui-même ses trades avec son compte Deriv, donc personne ne peut l'empêcher d'écrire sa propre stratégie. Mais il n'obtient ni les stratégies Kapa, ni le scanner, ni les bots Premium sans Premium.

## Garder vos réglages de stratégie privés

Le code de ce serveur est public sur GitHub, avec des valeurs par défaut pour les stratégies (barrières, multiplicateur…). Pour utiliser des valeurs que personne ne peut lire, enregistrez-les dans un secret Cloudflare. Elles remplacent alors celles du code :

```bash
wrangler secret put PREMIUM_RULES
```

Collez un texte JSON de ce format (chaque partie est facultative) :

```json
{
  "presets": {
    "target":     { "mode": "target",  "group": "half", "martingale": 1,   "maxLosses": 20 },
    "martingale": { "mode": "double",  "group": "half", "martingale": 2.1, "maxLosses": 6 },
    "recover":    { "mode": "recover", "group": "half", "martingale": 1,   "maxLosses": 6 }
  },
  "bots": {
    "under7-dalembert": { "symbol": "R_50", "loss": 15, "maxStake": 5 },
    "odd-oscars":       { "symbol": "R_25" }
  }
}
```

`mode` : `target` (mise audacieuse : la mise qu'un seul gain demande pour atteindre l'objectif), `double` (mise multipliée par `martingale` après une perte), `recover` (la mise qui récupère tout le cycle en un gain) ou `none` (mise fixe) ; `group` : `half` (contrats à 50 % : Even, Odd, Over 4, Under 5), `high` (80 % : Over 1, Under 8) ou `low` (40 % : Over 5, Under 4). Le serveur choisit toujours, dans le groupe, le contrat que Deriv paie le mieux, refuse de trader si sa marge dépasse la limite de l'utilisateur (12 % par défaut), et ne commence un cycle de récupération que si toutes ses mises tiennent sous le stop-loss. `martingale` : de 1 à 5 ; `maxLosses` : de 1 à 30. L'ancien nom `pegasus` est encore accepté pour `target`. Si le texte est invalide, les stratégies Premium s'arrêtent (aucun trade), mais les paiements et l'Admin continuent de fonctionner.

## Changer une clé

Si un secret a pu fuiter, remplacez-le avec `wrangler secret put <NOM>`. Changer `SESSION_KEY` arrête simplement les sessions KAPA AI en cours (les membres relancent). Changer `ADMIN_SECRET` n'affecte pas les membres.
