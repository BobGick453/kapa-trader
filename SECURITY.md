# Audit de sécurité de Kapa Trader (2 novembre 2026)

Ce document décrit ce qui a été vérifié et corrigé, ce qui reste exposé, et ce que le propriétaire du site doit faire de son côté.

## 1. Premium : impossible à débloquer en modifiant la page

**Avant :** les règles des stratégies Premium (barrières, récupération, multiplicateur), le scanner et les réglages des bots Premium étaient dans le code du site. Une personne qui modifie la page dans son navigateur pouvait les utiliser sans payer.

**Maintenant :**

- Les stratégies Premium tournent sur le serveur Kapa (`server/strategy.js`). Le site envoie le résultat de chaque contrat et reçoit l'ordre suivant (marché, barrière, mise). Les règles ne sont plus dans le code du site : une recherche dans le site compilé ne trouve aucune de leurs valeurs.
- Sans Premium actif, le serveur répond « 402 » : aucun ordre, aucun scan, aucun réglage de bot Premium. L'abonnement est revérifié à chaque décision : s'il expire pendant une session, la session s'arrête.
- Les sessions sont signées (HMAC-SHA256 avec `SESSION_KEY`). Une session modifiée, expirée (6 h) ou appartenant à un autre compte Deriv est refusée. Un même contrat envoyé deux fois n'est compté qu'une fois.
- Le scanner interroge lui-même les prix publics de Deriv. Le plan de session des stratégies Premium est calculé par le serveur (gratuit, limité en débit et en temps de calcul).
- Le serveur impose les limites : stop-loss obligatoire, mise jamais supérieure au stop-loss, pertes d'affilée plafonnées à 20.
- Le serveur ne stocke jamais le jeton Deriv. Il s'en sert uniquement pour demander à Deriv à quel compte appartient la personne (réponse gardée 2 minutes, sous forme d'empreinte).
- Le code du serveur est public sur GitHub. Les valeurs réelles des stratégies peuvent donc être gardées dans le secret Cloudflare `PREMIUM_RULES` (voir `server/README.md`). **Attention :** les anciennes valeurs par défaut figurent dans l'historique public du dépôt.

**Ce qui reste possible, et pourquoi c'est acceptable :** chaque client passe ses ordres avec son propre compte Deriv, donc personne ne peut l'empêcher d'écrire sa propre stratégie, par exemple dans Bot Builder. Mais il n'obtient ni les stratégies Kapa, ni le scanner, ni les bots Premium sans payer. Un membre qui ment au serveur sur le résultat d'un contrat ne fausse que sa propre session.

**Tests :** 57 tests unitaires du serveur et des tests navigateur. Ils vérifient les appels directs au serveur sans payer, les sessions falsifiées, la stratégie forcée dans le stockage local, la fin du Premium en cours de session et les clés « piégées » comme `constructor` ou `__proto__`.

## 2. Paiements et Admin

- Un paiement n'est accordé qu'après vérification auprès de l'API CinetPay : statut `ACCEPTED`, montant et devise corrects. Une notification seule ne suffit pas.
- L'octroi est idempotent : une notification rejouée n'ajoute pas de jours.
- L'adresse de paiement renvoyée par CinetPay doit être une adresse `cinetpay.com`.
- Les identifiants de transaction sont aléatoires et vérifiés par leur format.
- Une personne ne peut consulter que ses propres paiements.
- Admin :
  - le secret doit faire au moins 20 caractères, sinon l'Admin est désactivé ;
  - la comparaison du secret se fait en temps constant ;
  - après 10 essais faux, l'adresse IP est bloquée une heure ;
  - le secret n'est gardé que dans l'onglet ouvert.
- Limites de débit :
  - toutes les requêtes : 240 par minute et par adresse IP ;
  - paiements : 5 par 10 minutes ;
  - scans : 10 par minute ;
  - plans de session : 30 par minute ;
  - requêtes Premium : 120 par minute.
- Ces limites sont tenues par chaque instance du serveur. Pour une protection globale, ajoutez une règle « Rate limiting » dans Cloudflare (voir section 6).
- Toutes les réponses du serveur portent des en-têtes de sécurité :
  - `no-store`, `nosniff`, `X-Frame-Options: DENY`, `HSTS` ;
  - une CSP `default-src 'none'` ;
  - un CORS limité à `ALLOWED_ORIGINS`.
- Les corps de requête sont limités à 16 Ko.

## 3. Le site

- **Politique de sécurité du contenu (CSP).** Le site ne peut exécuter que ses propres scripts, plus ceux de Google pour Google Drive. Il ne peut se connecter qu'à Deriv, à Google Drive et au serveur Kapa. Les plugins et les formulaires vers d'autres sites sont bloqués. Tous les onglets ont été testés sans aucune violation.
- **`'unsafe-eval'` reste autorisé.** L'interpréteur de stratégies de Bot Builder (`js-interpreter`) en a besoin. Le risque reste faible tant qu'aucun script étranger ne peut s'exécuter.
- **Chat LiveChat de Deriv retiré.** Ce script tiers aurait envoyé l'identifiant, l'e-mail et le nom des clients au compte LiveChat de Deriv, et il aurait pu lire les jetons de connexion.
- **Anti-iframe (clickjacking).** GitHub Pages ne permet pas d'envoyer l'en-tête `frame-ancestors`. Le site refuse donc lui-même de s'afficher dans le cadre d'un autre site. Testé, y compris avec un cadre « sandbox ».
- **Données des bots Premium.** Qu'elles viennent du serveur ou du code, elles sont vérifiées champ par champ avant d'être insérées dans Bot Builder.
- **Ordres reçus.** Le moteur de trading vérifie chaque ordre : type de contrat, marché et durée doivent être connus, et la mise ne dépasse jamais le solde.
- **Graphiques.** La bibliothèque des graphiques charge désormais ses fichiers depuis `/kapa-trader/` (l'onglet Charts était cassé).
- **Jetons Deriv.** Ils restent dans le `sessionStorage` de l'onglet, effacé à la fermeture. C'est le comportement du modèle officiel de Deriv.
- **Suivi publicitaire.** Google Tag Manager, Survicate et l'envoi de données à Deriv restent désactivés.
- **Anciens fichiers retirés.** Le bot « classic » et `token-exchange-worker.js` ont été retirés du site publié. Ils formaient une seconde application de connexion sur la même adresse.

## 4. Dépendances (`npm audit`)

`npm audit` signale 44 alertes (1 élevée, 39 modérées, 4 faibles). Elles concernent les outils de compilation et de publication : npm, semantic-release, glob, minimatch, et undici (client HTTP de Node). Aucune n'est dans le code envoyé aux visiteurs, sauf `deepmerge`, une alerte faible via `react-joyride`, qui ne reçoit pas de données venant de l'extérieur. À refaire lors des mises à jour du modèle de Deriv.

## 5. Secrets

- L'historique Git des deux branches a été contrôlé : aucune clé ni aucun mot de passe.
- L'App ID Deriv (`34QvhOYOwdiGB0X15zX0W`) est public par nature. La sécurité de la connexion repose sur l'adresse de retour exacte et sur PKCE.
- Les secrets du serveur vivent uniquement dans Cloudflare : `CINETPAY_APIKEY`, `CINETPAY_SITE_ID`, `ADMIN_SECRET`, `SESSION_KEY` et `PREMIUM_RULES`.

## 6. À faire par le propriétaire

1. **Double authentification (2FA)** sur GitHub, Cloudflare, Deriv et CinetPay. Quiconque contrôle le compte GitHub peut modifier le site, et donc les ordres envoyés aux comptes Deriv des clients.
2. **Deriv (developers.deriv.com).** Gardez une seule adresse de retour, exactement `https://bobgick453.github.io/kapa-trader/`. Supprimez celle du bot « classic » si elle a été ajoutée.
3. **Secrets forts.**
   - `ADMIN_SECRET` : une longue phrase.
   - `SESSION_KEY` : générez-la avec `openssl rand -hex 32`.
   - Changez-les si vous pensez qu'ils ont fuité (`wrangler secret put …`).
4. **Cloudflare.** Ajoutez une règle *Rate limiting* sur le serveur, par exemple 300 requêtes par minute et par adresse IP. Surveillez les journaux du Worker.
5. **Domaine personnel (recommandé).** Tous les sites `bobgick453.github.io/…` partagent la même origine web : un autre projet publié sur ce même compte GitHub pourrait lire les jetons du site. Un domaine à vous (par exemple `kapatrader.com`) supprime ce risque. Pensez alors à mettre à jour l'adresse de retour Deriv, `SITE_URL` et `ALLOWED_ORIGINS`.
6. **Valeurs de stratégie privées** dans `PREMIUM_RULES`, si vous ne voulez pas que les valeurs du code public servent en production.
