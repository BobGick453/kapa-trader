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
