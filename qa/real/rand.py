import json, math
from scipy import stats
d=json.load(open(__import__('os').path.join(__import__('os').path.dirname(__file__),'real-2026-11-04.json')))
allp=[]
print(f"{'market':8s} {'ticks':>6s} {'uniform p':>9s} {'pairs p':>8s} {'parity-lag1 p':>13s} {'runs z':>7s}")
for s,t in d['ticks'].items():
    D=[int(c) for c in t['digits']]; n=len(D)
    cnt=[D.count(i) for i in range(10)]
    pu=stats.chisquare(cnt).pvalue
    M=[[0]*10 for _ in range(10)]
    for a,b in zip(D,D[1:]): M[a][b]+=1
    pt=stats.chi2_contingency(M)[1]
    P=[x%2 for x in D]; T=[[0,0],[0,0]]
    for a,b in zip(P,P[1:]): T[a][b]+=1
    pp=stats.chi2_contingency(T)[1]
    runs=1+sum(1 for a,b in zip(P,P[1:]) if a!=b); n1=sum(P); n0=n-n1
    mu=2*n0*n1/n+1; var=(mu-1)*(mu-2)/(n-1); z=(runs-mu)/math.sqrt(var)
    allp+= [pu,pt,pp]
    print(f"{s:8s} {n:6d} {pu:9.3f} {pt:8.3f} {pp:13.3f} {z:7.2f}")
print('smallest p of', len(allp), 'tests:', round(min(allp),4), '(with 30 tests, one below 0.033 is expected by chance)')
# conditional parity after streaks, pooled
from collections import Counter
for k in range(1,9):
    seen=won=0
    for s,t in d['ticks'].items():
        D=[int(c)%2 for c in t['digits']]
        for i in range(k,len(D)):
            if all(D[i-j]==1 for j in range(1,k+1)): seen+=1; won+= D[i]==0
    lo,hi=stats.binomtest(won,seen).proportion_ci() if seen else (0,0)
    print(f"Even after {k} odd in a row: {seen:6d} times, even {won/seen:.3%}  95% CI {lo:.3%}-{hi:.3%}")
