import re, glob, json, sys
MON = {m:i+1 for i,m in enumerate(['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'])}
EST = {  # mill company name -> Stock estate name
 'SUNGAI MAK PLANTATION SDN BHD': 'Sungai Mak Plantation', 'MJM PLANTATION SDN BHD': 'MJM Plantation 1',
 'MJM PLANTATION SDN BHD 2': 'MJM Plantation 2', 'MJM PLANTATION SDN BHD 3': 'MJM Plantation 3',
 'MERIDIAN PALMA SDN BHD': 'Meridian Palma', 'MEGA JUTAMAS SDN BHD (ULU NIAH)': 'Ulu Niah Estate',
 'MEGA JUTAMAS SDN BHD': 'Mega Jutamas (Suai)', 'GAMA MENANG SDN BHD': 'Gama Menang', 'ESTET SERI MAWAR SDN BHD': 'Estet Seri Mawar',
 'ELEWSUN SDN BHD': 'Elewsun', 'MONO GAYA SDN BHD': 'Mono Gaya'}
rows = {}   # (estate, year, month) -> {ffb, bad_pct, src, stmt}
conflicts = []; problems = []
for t in sorted(glob.glob(sys.argv[1] + '/*.txt')):
    s = open(t).read()
    m = re.search(r'To\s*:\s*(.+?)\s{2,}Statement No\.\s*:\s*(\d+)', s); period = re.search(r'Statement Period\s*:\s*\d\d/(\d\d)/(\d{4}) TO', s)
    if not (m and period): problems.append((t, 'header')); continue
    company = m.group(1).strip(); stmt = m.group(2); cm, cy = int(period.group(1)), int(period.group(2))
    est = EST.get(company)
    if not est: problems.append((t, 'company ' + company)); continue
    mo = re.search(r'MONTH\s+(.+?)\n', s); ton = re.search(r'MONTHLY FFB TONNAGE \(MT\)\s+(.+?)\n', s); bad = re.search(r'UNSATISFACTORY FFB \(%\)\s+(.+?)\n', s)
    oldfmt = False
    if not (ton and bad):  # 2025 layout: graded tonnage + satisfactory %
        ton = re.search(r'MONTHLY ACCUMULATED GRADED TONNAGE\s+(.+?)\n', s) or re.search(r'MONTHLY ACCUMULATED GRADED\s*\n\s*(.+?)\n', s); bad = re.search(r'SATISFACTORY FFB \(%\)\s+(.+?)\n', s); oldfmt = True
    if not (mo and ton and bad): problems.append((t, 'history')); continue
    heads = re.findall(r'([A-Z]+ \d{4}|CURRENT MONTH)', mo.group(1)); tons = ton.group(1).split(); bads = bad.group(1).split()
    if oldfmt: bads = ['-' if b.strip() == '-' else str(round(100 - float(b.rstrip('%')), 2)) for b in bads]
    if not (len(heads) == len(tons) == len(bads)): problems.append((t, 'columns %s %s %s' % (heads, tons, bads))); continue
    for h, tv, bv in zip(heads, tons, bads):
        if h == 'CURRENT MONTH': y, mth = cy, cm
        else: name, y = h.split(); y = int(y); mth = MON[name]
        num = lambda x: None if x.strip() in ('-', '') else float(x.replace(',', ''))
        ffb = num(tv); badp = num(bv)
        if ffb is None: continue  # month with no delivery
        if badp is None: badp = 0.0 if h == 'CURRENT MONTH' else None
        key = (est, y, mth); val = {'ffb': ffb, 'bad': badp, 'stmt': stmt, 'current': h == 'CURRENT MONTH'}
        if key in rows and (abs(rows[key]['ffb'] - ffb) > 0.011 or (rows[key]['bad'] is not None and badp is not None and abs(rows[key]['bad'] - badp) > 0.011)):
            conflicts.append((key, rows[key], val))
        if key not in rows or val['current'] or (rows[key]['bad'] is None and badp is not None): rows[key] = val  # the month's own statement is the final word
out = [{'estate': k[0], 'year': k[1], 'month': k[2], 'ffb_mt': v['ffb'], 'grading_pct': None if v['bad'] is None else round(100 - v['bad'], 2), 'stmt': v['stmt']} for k, v in sorted(rows.items())]
json.dump(out, open(sys.argv[2], 'w'), indent=0)
print('rows', len(out), 'estates', len(set(r['estate'] for r in out)), 'problems', problems, 'conflicts', len(conflicts))
for c in conflicts[:10]: print('CONFLICT', c)
# coverage per estate
from collections import defaultdict
cov = defaultdict(list)
for r in out: cov[r['estate']].append('%d-%02d' % (r['year'], r['month']))
for e, l in sorted(cov.items()): print(e, len(l), l[0], '..', l[-1])
