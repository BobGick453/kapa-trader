# Blockly XML -> compact pseudo-code (generic: fields, values, statements, next)
import sys, xml.etree.ElementTree as ET
NS='{https://developers.google.com/blockly/xml}'
def tag(e): return e.tag.replace(NS,'')
def fields(b): return {f.get('name'):(f.text or '') for f in b if tag(f)=='field'}
def child(b,kind,name):
    for c in b:
        if tag(c)==kind and c.get('name')==name: return c
def inner(v):
    if v is None: return None
    for c in v:
        if tag(c)=='block': return c
    for c in v:
        if tag(c)=='shadow': return c
def expr(b):
    if b is None: return '∅'
    t=b.get('type'); f=fields(b)
    vals={c.get('name'):expr(inner(c)) for c in b if tag(c)=='value'}
    if t=='math_number': return f.get('NUM')
    if t=='text': return repr(f.get('TEXT'))
    if t=='logic_boolean': return f.get('BOOL')
    if t=='variables_get': return f.get('VAR')
    if t=='math_arithmetic': return f"({vals.get('A')} {dict(ADD='+',MINUS='-',MULTIPLY='*',DIVIDE='/',POWER='^').get(f.get('OP'),f.get('OP'))} {vals.get('B')})"
    if t=='logic_compare': return f"({vals.get('A')} {dict(EQ='==',NEQ='!=',LT='<',LTE='<=',GT='>',GTE='>=').get(f.get('OP'))} {vals.get('B')})"
    if t=='logic_operation': return f"({vals.get('A')} {f.get('OP').lower()} {vals.get('B')})"
    if t=='logic_negate': return f"not {vals.get('BOOL')}"
    if t=='logic_ternary': return f"({vals.get('IF')} ? {vals.get('THEN')} : {vals.get('ELSE')})"
    if t=='procedures_callreturn' or t=='procedures_callnoreturn':
        ms=[c for c in b if tag(c)=='mutation']; m=ms[0] if ms else None
        args=[a.get('name') for a in m if tag(a)=='arg'] if m is not None else [k for k in vals]
        nm=m.get('name') if m is not None else f.get('NAME','?')
        return f"{nm}({', '.join(f'{a}={vals.get(f'ARG{i}', vals.get(a))}' for i,a in enumerate(args))})"
    parts=[f"{k}={v}" for k,v in f.items()]+[f"{k}={v}" for k,v in vals.items()]
    return f"{t}[{', '.join(parts)}]"
def stmts(b,ind):
    out=[]
    while b is not None:
        t=b.get('type'); f=fields(b)
        vals={c.get('name'):expr(inner(c)) for c in b if tag(c)=='value'}
        subs=[c for c in b if tag(c)=='statement']
        if t=='variables_set': out.append(f"{ind}{f.get('VAR')} = {vals.get('VALUE')}")
        elif t in ('procedures_callnoreturn',): out.append(ind+expr(b))
        elif t in ('procedures_defnoreturn','procedures_defreturn'):
            ms=[c for c in b if tag(c)=='mutation']; args=[a.get('name') for a in ms[0] if tag(a)=='arg'] if ms else []
            out.append(f"{ind}def {f.get('NAME')}({', '.join(args)}):")
            for s_ in subs: out+=stmts(inner(s_),ind+'  ')
            if 'RETURN' in vals: out.append(f"{ind}  return {vals['RETURN']}")
        elif t=='math_change': out.append(f"{ind}{f.get('VAR')} += {vals.get('DELTA')}")
        elif t=='controls_if':
            n=0
            while f"IF{n}" in vals:
                out.append(f"{ind}{'if' if n==0 else 'elif'} {vals[f'IF{n}']}:")
                out+=stmts(inner(child(b,'statement',f'DO{n}')),ind+'  '); n+=1
            if child(b,'statement','ELSE') is not None:
                out.append(f"{ind}else:"); out+=stmts(inner(child(b,'statement','ELSE')),ind+'  ')
        else:
            desc=', '.join([f"{k}={v}" for k,v in f.items()]+[f"{k}={v}" for k,v in vals.items()])
            out.append(f"{ind}{t}({desc})")
            for s in subs: out.append(f"{ind}  [{s.get('name')}]"); out+=stmts(inner(s),ind+'    ')
        nx=child(b,'next',None) if False else next((c for c in b if tag(c)=='next'),None)
        b=inner(nx) if nx is not None else None
    return out
root=ET.parse(sys.argv[1]).getroot()
for b in root:
    if tag(b)!='block': continue
    print('\n'.join(stmts(b,''))); print('-'*40)
