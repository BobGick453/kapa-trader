# Les stratégies de Kapa Trader

## Ce qui est prouvé, et ce qui ne l'est pas

- **Les chiffres sont aléatoires.** Les indices Volatility de Deriv sont produits par un générateur de nombres aléatoires. Chaque dernier chiffre a une chance sur dix et ne dépend pas des précédents. Aucune suite de ticks ne dit ce qui vient ensuite. Kapa ne « guette » donc pas de signal : le scanner teste les 1 000 derniers ticks de chaque marché pour le montrer (test du chi carré sur les chiffres, test de suite pair/impair).
- **Deriv paie un peu moins que les vraies chances.** Chaque contrat a donc un résultat moyen légèrement négatif : c'est la marge de Deriv. Aucune méthode de mise (martingale, D'Alembert, Oscar's Grind…) ne change cette moyenne : c'est le théorème de la ruine du joueur. Une stratégie peut seulement changer trois choses :
  - la chance d'atteindre l'objectif avant le stop-loss ;
  - la somme misée en route : la perte moyenne vaut la marge multipliée par cette somme ;
  - la profondeur d'une mauvaise série.
- **Ce qu'aucun bot honnête ne peut promettre :** gagner à coup sûr, ou être rentable à long terme sur ces contrats.

## Les règles de Kapa

1. **Le contrat le moins cher.** Avant chaque trade, Kapa compare les prix réels de Deriv parmi des contrats qui ont la même chance (Even, Odd, Over 4, Under 5 : 50 %), et prend le mieux payé. Les contrats à 50 % ont la plus petite marge : environ 2,5 % de la mise si Deriv paie Even environ 1,95 fois la mise, contre environ 7 % pour Over 1. Ces chiffres sont des estimations : le scanner affiche la marge réelle de chaque marché.
2. **Pas de trade sur de mauvais prix.** Si même le meilleur contrat a une marge de plus de 10 %, Kapa ne trade pas.
3. **Jamais de cycle impossible à finir.** Un cycle de récupération ne commence que si toutes ses mises tiennent ensemble sous le stop-loss et sous la mise maximale. Une mauvaise série s'arrête donc à une perte prévue, jamais sur une mise que le compte ne peut pas suivre.
4. **Pegasus : la mise audacieuse.** Chaque mise est ce qu'un seul gain demande pour atteindre l'objectif. Dubins et Savage ont prouvé que, quand chaque pari paie moins que ses chances, cette façon de miser donne la plus grande chance d'atteindre un objectif avant de perdre un budget. Elle mise aussi le moins en tout, donc perd le moins en moyenne.
5. **Le capital est protégé.**
   - Une session ne peut pas risquer plus de 25 % du solde.
   - Une limite de perte par jour (30 % du solde par défaut, réglable) arrête Kapa jusqu'au lendemain.
   - Une mise ne dépasse jamais le solde ni le stop-loss.

## Résultats simulés

20 000 sessions par ligne, mise de départ 1, objectif +10, stop-loss 50, avec les paiements habituels de Deriv :

| Stratégie | Atteint l'objectif | Résultat moyen par session |
|---|---|---|
| Pegasus (mise audacieuse, Even/Odd) | 82 % | −0,69 |
| Steady (×2,1, cycles sous le stop-loss) | 73 % | −0,84 |
| Exact recovery | 71 % | −0,98 |
| Ancienne approche : Over 1, mise fixe | 0 % | −49,91 |
| Over 2, martingale ×2,2 | 14 % | −39,63 |

Pegasus atteint presque le plafond théorique : avec un objectif de 10 et un stop-loss de 50, aucune stratégie ne peut dépasser environ 83 %, car 50 / (50 + 10) = 0,83.

## Le bot exemplaire

Sur les captures du bot exemplaire, Pegasus mise tout le solde (392 USD sur un solde de 392,18) pour gagner 10 USD, avec un stop-loss de 5 000. Une seule perte, environ une fois sur cinq sur Over 1, vide le compte. Kapa ne fait jamais cela.
