# Mettre le serveur Premium en ligne depuis le navigateur (sans rien installer)

Durée : environ 15 minutes. Tout se fait sur le site de Cloudflare, depuis un ordinateur (plus confortable) ou un téléphone. C'est gratuit jusqu'à 100 000 requêtes par jour.

Vous aurez besoin du fichier **`kapa-premium-worker.js`** : c'est tout le serveur Kapa dans un seul fichier.

## 1. Créer le compte Cloudflare

1. Allez sur **https://dash.cloudflare.com/sign-up**, inscrivez-vous avec votre e-mail, puis confirmez l'e-mail reçu.
2. Activez la double authentification : icône du profil → *Profile* → *Authentication*.

## 2. Créer le stockage (KV)

1. Menu de gauche : **Storage & Databases** → **KV** (parfois *Workers & Pages → KV*).
2. **Create** (ou *Create namespace*) → nom : `KAPA_KV` → **Add**.

## 3. Créer le serveur (Worker)

1. Menu de gauche : **Workers & Pages** → **Create** → **Create Worker** (ou *Start with Hello World*).
2. Nom : `kapa-premium` → **Deploy**.
3. Cliquez sur **Edit code**. Effacez tout le code affiché, puis collez **tout** le contenu du fichier `kapa-premium-worker.js`.
4. Cliquez sur **Deploy** (en haut à droite), puis revenez au Worker.

## 4. Relier le stockage

1. Dans votre Worker : onglet **Settings** → **Bindings** → **Add** → **KV namespace**.
2. *Variable name* : `KAPA_KV` (exactement). *KV namespace* : choisissez `KAPA_KV`. Puis **Save** / **Deploy**.

## 5. Ajouter les réglages et les secrets

Dans **Settings** → **Variables and Secrets** → **Add**. Ajoutez chaque ligne ci-dessous, avec le type indiqué, puis cliquez sur **Deploy**.

| Nom | Type | Valeur |
|---|---|---|
| `SITE_URL` | Text | `https://bobgick453.github.io/kapa-trader/` |
| `ALLOWED_ORIGINS` | Text | `https://bobgick453.github.io` |
| `CURRENCY` | Text | `XOF` |
| `PLAN_DAYS` | Text | `30` |
| `PRICE_XOF` | Text | `0` pour l'instant ; le prix en francs CFA quand CinetPay sera prêt |
| `SESSION_KEY` | **Secret** | une suite d'au moins **40** caractères au hasard (tapez n'importe quoi, longtemps, lettres et chiffres mélangés) |
| `ADMIN_SECRET` | **Secret** | votre mot de passe Admin : une longue phrase d'au moins **20** caractères |
| `PREMIUM_CODE` | **Secret** | votre **code Premium** (8 caractères ou plus). Vous pourrez le changer ensuite depuis l'onglet Admin |

Notez `ADMIN_SECRET` et `PREMIUM_CODE` dans un endroit sûr. Ne les envoyez à personne, pas même à Claude.

## 6. Vérifier

1. En haut de la page du Worker, copiez son adresse. Elle ressemble à `https://kapa-premium.votre-nom.workers.dev`.
2. Ouvrez cette adresse suivie de `/plan`, par exemple `https://kapa-premium.votre-nom.workers.dev/plan`. Vous devez voir un petit texte du type `{"price":0,"currency":"XOF","days":30,"configured":false}`.

## 7. Dernière étape

Envoyez **uniquement l'adresse du Worker** à Claude, qui reconstruira le site avec. Ensuite, sur le site :

- **KAPA AI** → champ *Premium code* → votre code → **Unlock** : tout le Premium apparaît.
- **Admin** → votre `ADMIN_SECRET` : vous pouvez changer le code et voir les paiements.

## Plus tard : les paiements en ligne CinetPay

Quand votre compte marchand CinetPay est validé, ajoutez deux secrets, `CINETPAY_APIKEY` et `CINETPAY_SITE_ID`, et mettez votre prix dans `PRICE_XOF` (un multiple de 5). Le bouton « Pay with CinetPay » apparaîtra alors pour vos clients.

## Mettre à jour le serveur

Si Claude vous envoie une nouvelle version de `kapa-premium-worker.js`, retournez dans **Edit code**, remplacez tout le code, puis cliquez sur **Deploy**. Vos réglages, secrets et codes sont conservés.
