# Les stratégies de Kapa Trader, vérifiées sur les vraies données de Deriv

Mesures du 4 novembre 2026, faites sur les serveurs de Deriv (`api.derivws.com`) :
- **300 000 vrais ticks** : 30 000 sur chacun des 10 indices Volatility (R_10 à R_100, 1HZ10V à 1HZ100V) ;
- **30 000 ticks plus anciens** de 1HZ50V pour un contrôle ;
- **les vrais prix** de 32 contrats chiffres sur chacun des 10 marchés.

## 1. Les vrais prix de Deriv

La marge est ce que Deriv garde en moyenne sur chaque mise. Elle est la même sur les 10 marchés. Mise de 10, 1 tick :

| Contrat | Chance | Deriv paie | Marge |
|---|---|---|---|
| Differs, Over 0, Under 9 | 90 % | 10,96 | 1,36 % |
| Over 1, Under 8 | 80 % | 12,32 | 1,44 % |
| Over 2, Under 7 | 70 % | 14,04 | 1,72 % |
| Over 3, Under 6 | 60 % | 16,34 | 1,96 % |
| Even, Odd, Over 4, Under 5 | 50 % | 19,53 | 2,35 % |
| Over 5, Under 4 | 40 % | 24,27 | 2,92 % |
| Over 6, Under 3 | 30 % | 32,05 | 3,85 % |
| Over 7, Under 2 | 20 % | 47,17 | 5,66 % |
| Over 8, Under 1, Matches | 10 % | 89,29 | 10,71 % |

Une mise de 1 coûte un peu plus cher, à cause de l'arrondi au centime (2,50 % sur Even, 1,60 % sur Over 1).

## 2. Les chiffres sont-ils prévisibles ? Non

- **Fréquence de chaque chiffre, paires de chiffres successifs, parité, séries :** 30 tests sur les 10 marchés. Le plus petit p vaut 0,003 (parité sur 1HZ50V).
- **Contrôle de ce résultat :** sur 30 000 autres ticks de 1HZ50V, l'effet disparaît (50,3 % de parité répétée, p = 0,27). C'était le hasard : sur 30 tests, un résultat de ce genre est attendu.
- **Le « signal » le plus vendu :** « Even après plusieurs Odd », mesuré sur jusqu'à 150 000 occurrences :

  | Après | Fois | Pair ensuite |
  |---|---|---|
  | 1 Odd | 149 661 | 50,06 % |
  | 3 Odd | 37 483 | 49,72 % |
  | 5 Odd | 9 483 | 49,75 % |
  | 8 Odd | 1 157 | 52,6 % (intervalle 49,6 %–55,5 %) |

  Pour gagner sur Even avec le prix de Deriv, il faudrait dépasser 51,2 % de façon stable. Aucun signal n'y arrive.

## 3. Quel contrat choisir ?

La marge par trade est plus petite sur Over 1 (1,44 %) que sur Even (2,35 %). Mais un gain sur Over 1 ne rapporte que 23 % de la mise, contre 95 % sur Even. Pour atteindre le même objectif, il faut donc miser beaucoup plus, et la perte totale est plus grande.

Le bon critère est la marge divisée par le gain : c'est le coût d'une unité de profit possible.
- Even : 0,0235 / 0,953 = 2,5 %
- Over 1 : 0,0144 / 0,232 = 6,2 %
- Over 0 : 14 %

Kapa trade donc les contrats à 50 %, et prend celui que Deriv paie le mieux à l'instant.

## 4. Les stratégies rejouées sur les 300 000 vrais ticks

Moteur réel de Kapa, prix réels de Deriv, sessions enchaînées. Objectif +10, stop-loss 50. Pour le bot exemplaire : tout le solde de 392 sur Over 1.

| Stratégie | Atteint l'objectif | Moyenne par session | Pire session |
|---|---|---|---|
| **Pegasus (mise audacieuse)** | **82,3 %** | **−0,64** | −50 |
| Steady (×2,1, cycles qui tiennent) | 72,2 % | −1,19 | −36 |
| Exact recovery | 70,5 % | −1,20 | −34 |
| Gratuite (mise fixe Even) | 18,9 % | −1,14 | −33 |
| Bot exemplaire (tout le solde sur Over 1) | 80,1 % | −5,17 | **−392 (compte vidé)** |

Avec un objectif +5 et un stop-loss de 50, Pegasus atteint l'objectif dans 90,1 % des sessions, pour −0,42 par session.

## Ce que cela veut dire

- **Aucune stratégie n'est gagnante à long terme** sur ces contrats : les chiffres sont aléatoires et Deriv garde une marge. Les vraies données le confirment.
- **Pegasus est la meilleure** : la plus grande chance d'atteindre l'objectif et la plus petite perte moyenne. Elle perd 8 fois moins par session que la méthode du bot exemplaire, et ne vide jamais le compte.
- **Le capital est protégé** : jamais plus de 25 % du solde par session, une limite de perte par jour, et aucun cycle de récupération qui dépasse le stop-loss.
- **Le laboratoire du bot** (Réglages KAPA AI → « Run the test on real Deriv data ») refait ces mesures sur votre téléphone, à tout moment.

## Premier test sur un compte démo (5 novembre 2026)

Quatre sessions Pegasus, perdues chacune en un seul trade de 25. Deux constats :
- **Le prix reçu était moins bon que le prix public.** Deriv a payé 46,13 pour 25 misés sur Even (45,45 sur Volatility 50), alors que son prix public était de 48,83 au même moment. Deriv gardait donc 7,7 % à 9,1 % de chaque mise au lieu de 2,35 %. Cause probable : une majoration (« markup ») réglée sur l'application dans developers.deriv.com. Kapa refuse maintenant de trader quand la marge dépasse 5 %, et explique pourquoi.
- **L'objectif demandait plus que le stop-loss.** Chaque session devenait un seul pari, gagné ou perdu d'un coup (environ 46 % de chances de gagner à ce prix). Kapa affiche maintenant un avertissement sous le take-profit dans ce cas. Avec un objectif petit par rapport au stop-loss (par exemple +5 pour 50), l'objectif est atteint environ 9 fois sur 10.

## Les Free Bots du bot exemplaire (5 novembre 2026)

Reconstruits à partir des vidéos de leurs blocs. L'intérieur de leurs fonctions repliées n'y était pas visible : ces parties sont reconstituées au plus près.
- **Digit Switcher** : achète la parité du dernier chiffre. Mise 1, martingale après 2 pertes, objectif 10, stop-loss 1 000.
- **Dollar Printer** : Over 0 quand les chiffres au-dessus de 0 ont fait au moins 90 % des 15 derniers ticks, puis Over 5 après une perte. Objectif 10.
- **Gold Premium Odd/Even** : Even quand au moins 4 des 5 derniers chiffres sont pairs et que le dernier est pair (Odd de même), martingale. Stop-loss 1 000.
- **Profit Maker** : Over 2, puis Over 4 après une perte, mise ×2,2. Objectif 5, stop-loss 1 000.

Sur les 300 000 vrais ticks, avec les vrais prix de Deriv :

| Bot exemplaire (réglages d'origine) | Atteint l'objectif | Moyenne par session | Pire session |
|---|---|---|---|
| Digit Switcher | 98,5 % | −3,16 | −1 000 |
| Dollar Printer | 98,6 % | −3,72 | −1 000 |
| Gold Premium | 98,7 % | −2,02 | −1 000 |
| Profit Maker | 99,1 % | −1,50 | −1 000 |

À objectif et stop-loss égaux, Pegasus fait mieux : 98,8 % et −1,92 par session pour +10 / 1 000, et 99,4 % et −1,02 pour +5 / 1 000. Les règles d'entrée (suivre le dernier chiffre, attendre une série) gagnent à la chance normale du contrat : elles n'aident pas.

**Versions Kapa** (Free Bot → « Run in KAPA AI »), avec un objectif +5 et un stop-loss de 50 :

| Bot Kapa | Atteint l'objectif | Moyenne par session | Pire session |
|---|---|---|---|
| Digit Switcher | 82,5 % | −0,77 | −34 |
| Dollar Printer (Over 1 au lieu d'Over 0) | 87,1 % | −1,07 | −50 |
| Gold Odd/Even | 83,8 % | −0,86 | −36 |
| Profit Maker (récupération sur le 50 % le mieux payé) | 86,8 % | −0,92 | −50 |
| *Pegasus, pour comparaison* | *90,1 %* | *−0,42* | *−50* |

Tous les cycles de récupération tiennent sous le stop-loss, et la mise après une perte est celle qui récupère tout le cycle en un gain.

## Les vrais fichiers des bots exemplaires (5 novembre 2026)

Avec l'accès au site, les 4 bots ont été lus en entier, fonctions repliées comprises. Ce qu'ils font réellement :
- **Digit Switcher** (1HZ100V) : Under 5 après un chiffre pair. Après 2 pertes de suite, il alterne Over 5 et Under 5 selon le nombre de pertes et la parité du dernier chiffre, et augmente la mise de ×2,1 jusqu'à 12 niveaux. Objectif 10, stop-loss 1 000.
- **Dollar Printer** (1HZ100V) : Over 0 quand au moins 90 % des 15 derniers chiffres sont non nuls, puis Over 5 après une perte, avec une mise de 1,25 × la perte. Objectif 10, **aucun stop-loss**.
- **Gold Premium Odd/Even** (R_100) : la parité d'au moins 4 des 5 derniers chiffres, si le dernier va dans le même sens. Mise ×2,2 jusqu'à 10 niveaux, **objectif 1 000**, stop-loss 1 000.
- **Profit Maker** (R_100) : Over 2, puis Over 4 après une perte, mise ×2,2 sans limite de niveaux. Objectif 5, stop-loss 1 000.

Rejoués à l'identique sur les 300 000 vrais ticks, au prix public de Deriv :

| Bot exemplaire | Atteint l'objectif | Moyenne par session | Pire session |
|---|---|---|---|
| Digit Switcher | 99,0 % | −1,41 | −1 517 (dépasse son stop-loss) |
| Dollar Printer | 99,0 % | −15,87 | **compte de 10 000 vidé 40 fois** |
| Gold Premium | 55,3 % | −224,50 | −2 189 |
| Profit Maker | 99,1 % | −1,50 | −1 005 |

Versions Kapa (objectif +5, stop-loss 50, mêmes ticks, prix public) :

| Bot Kapa | Atteint l'objectif | Moyenne | Pire session |
|---|---|---|---|
| Digit Switcher | 71,8 % | −0,57 | −19 |
| Dollar Printer | 87,2 % | −1,08 | −50 |
| Gold Odd/Even | 83,8 % | −0,86 | −36 |
| Profit Maker | 86,8 % | −0,92 | −50 |

Une mise qui dépasserait la marge restante sous le stop-loss n'est jamais placée : la session s'arrête avant.

## KAPA Apex, la stratégie Premium (5 novembre 2026)

À chaque trade, Apex calcule par programmation dynamique, sur les prix réels de Deriv, la chance d'atteindre l'objectif avant le stop-loss pour chaque niveau de chance de contrat (de 10 % à 90 %). Il prend ensuite le contrat qui donne la chance la plus haute, avec la mise qu'un seul gain demande pour atteindre l'objectif (mise audacieuse). C'est le maximum calculable sur ces contrats.

Sur les 300 000 vrais ticks :

| Objectif / stop-loss | Prix | Apex : objectif · moyenne | Pegasus : objectif · moyenne |
|---|---|---|---|
| +5 / 50 | public | 90,3 % · −0,34 | 90,1 % · −0,42 |
| +10 / 50 | public | 82,3 % · −0,63 | 82,3 % · −0,64 |
| +10 / 100 | public | 90,3 % · −0,68 | 90,1 % · −0,83 |
| +10 / 50 | votre connexion | 79,7 % · −2,19 | 79,2 % · −2,48 |

**Bots classiques :** ils gardent la règle d'entrée de l'original. Après une perte, Apex prend la main jusqu'à l'objectif ou au stop-loss. Avec un objectif +5 et un stop-loss de 50, au prix public, ils atteignent l'objectif dans 89,9 à 90,3 % des sessions, au lieu de 72 à 87 % avec leur propre récupération. Leur perte moyenne passe à −0,34 à −0,54 par session, soit environ deux fois moins.
