import json
j=json.load(open('judge.json'))
for k,v in j.items():
    print(k,v['judge'].get('score'),v['judge'].get('items'),str(v['judge'].get('hallucinated'))[:200],v['auto']['ac_lines'],v['auto']['chars'])
for n in "A1 A2 B1 B2 C1 C2 redo_full redo_sel".split():
    s=json.load(open(n+'.json'))['summary']
    print(n,s['calls'],s['in'],s['out'],s['cache_read'],s['cache_write'],s['in']+s['out']+s['cache_read']+s['cache_write'],s['wall_s'],s['cost_usd'])
