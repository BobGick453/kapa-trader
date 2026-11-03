# Mettre le serveur Premium en ligne avec Netlify (environ 5 minutes, sur téléphone)

Vous n'avez aucun code à copier. Netlify lit directement votre dépôt GitHub `kapa-trader`, où tout est déjà prêt. Le stockage des données est inclus, rien à créer.

## 1. Créer le compte Netlify avec GitHub

1. Ouvrez **https://app.netlify.com/signup**.
2. Touchez **GitHub** (*Sign up with GitHub*), puis **Authorize Netlify**.
3. Si Netlify pose quelques questions (nom, usage…), répondez librement ou passez-les.

## 2. Importer le dépôt `kapa-trader`

1. Touchez **Add new project** (ou **Add new site**) → **Import an existing project**.
2. Touchez **GitHub**. Si GitHub demande une autorisation, choisissez **Only select repositories** → `kapa-trader` → **Install** (ou **Save**).
3. Dans la liste, touchez **kapa-trader**.

## 3. Régler le projet

1. **Project name** (ou *Site name*) : tapez `kapa-premium`. S'il est déjà pris, ajoutez un mot, par exemple `kapa-premium-vs39`.
2. **Branch to deploy** : laissez `main`.
3. Laissez **tous les autres champs** comme ils sont (*Build command*, *Publish directory*, *Functions directory*) : le dépôt les remplit tout seul.
4. Touchez **Add environment variables** (ou *Environment variables* → *Add variable*), puis ajoutez :

| Key | Value |
|---|---|
| `ADMIN_SECRET` | votre mot de passe Admin, **20 caractères minimum** |
| `PREMIUM_CODE` | votre code Premium, **8 caractères minimum** (modifiable ensuite dans l'Admin) |

5. Touchez **Deploy kapa-premium** (ou *Deploy site*).

## 4. Attendre la mise en ligne

Après 1 à 2 minutes, le statut passe à **Published**. L'adresse de votre serveur s'affiche en haut, par exemple `https://kapa-premium.netlify.app`.

Vérification : ouvrez cette adresse suivie de `/plan`, par exemple `https://kapa-premium.netlify.app/plan`. Vous devez voir un petit texte du type `{"price":0,"currency":"XOF","days":30,"configured":false}`.

## 5. Dernière étape

**Envoyez à Claude uniquement l'adresse** (par exemple `https://kapa-premium.netlify.app`), jamais vos mots de passe ni votre code. Claude reconnecte le site. Ensuite :

- **KAPA AI** → votre code → **Unlock** : tout le Premium apparaît.
- **Admin** → votre `ADMIN_SECRET` : changer le code, voir les paiements.

## Si vous avez oublié les variables à l'étape 3

Ouvrez votre projet → **Project configuration** (ou *Site configuration*) → **Environment variables** → **Add a variable**. Ajoutez `ADMIN_SECRET` et `PREMIUM_CODE`, puis allez dans **Deploys** → **Trigger deploy** → **Deploy project** pour qu'elles soient prises en compte.

## Plus tard : paiements CinetPay

Ajoutez les variables `CINETPAY_APIKEY`, `CINETPAY_SITE_ID` et `PRICE_XOF` (votre prix en francs CFA, un multiple de 5), puis faites **Trigger deploy**.
