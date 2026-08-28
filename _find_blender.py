import json, re
pat = re.compile(r'[A-Za-z]:[\\/][^"\\]*?[Bb]lender[^"\\]*?\.exe')
for day in ('20260825','20260826'):
    p = rf'c:\Users\jiaha\.trae-cn\memory\projects\-c-Users-jiaha-Documents-trae-projects-model-build--p2-62c1604397a441f17161\{day}\session_memory_6a840c4d24f88072ff4def7b.jsonl'
    try:
        with open(p, encoding='utf-8') as f:
            for i, line in enumerate(f):
                for m in pat.finditer(line):
                    print(day, i, m.group(0))
    except FileNotFoundError:
        pass
print('done')
