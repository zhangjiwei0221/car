#!/usr/bin/env python3
"""冰造难度实验（pid 48830）：从底座去掉锁链格（type 5→0、param→0），记录逐格 diff。

只改目标格的 type/param；id/count/blocks 等全不动。
用法：
  python3 remove_chains_48830.py <base.json> --cells "r,c;r,c" --out <变体.json> --report <diff.json>
"""
import json, sys, argparse, os

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('base')
    ap.add_argument('--cells', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--report', required=True)
    a = ap.parse_args()

    g = json.load(open(a.base, encoding='utf-8'))
    out = json.loads(json.dumps(g))
    cells = []
    for tok in a.cells.split(';'):
        tok = tok.strip()
        if not tok:
            continue
        r, c = [int(x) for x in tok.split(',')]
        cells.append((r, c))

    changes = []
    for r, c in cells:
        sp = out['spools'][r][c]
        before = {'type': sp.get('type'), 'param': sp.get('param'), 'id': sp.get('id'), 'count': sp.get('count')}
        if sp.get('type') != 5:
            raise SystemExit(f'格 {r},{c} 不是锁链（type={sp.get("type")}）')
        sp['type'] = 0
        sp['param'] = 0
        after = {'type': sp.get('type'), 'param': sp.get('param')}
        changes.append({'r': r, 'c': c, 'before': before, 'after': after})

    # 逐格 diff：除目标格外 spools 必须完全一致
    diffs = []
    for r in range(len(g['spools'])):
        for c in range(len(g['spools'][r])):
            if g['spools'][r][c] != out['spools'][r][c]:
                diffs.append({'r': r, 'c': c, 'before': g['spools'][r][c], 'after': out['spools'][r][c]})
    # blocks / toprow / maprow / mapcol 必须全同
    for k in ('blocks', 'toprow', 'maprow', 'mapcol'):
        if g.get(k) != out.get(k):
            raise SystemExit(f'{k} 被意外改动')

    # 守恒 / 空格
    px = sum(1 for row in out['blocks'] for v in row if v > 0)
    cap = 0
    empty = 0
    for row in out['spools']:
        for sp in row:
            if sp.get('id', 0) > 0:
                cap += sp['count']
            else:
                empty += 1
    color_px, color_cap = {}, {}
    for row in out['blocks']:
        for v in row:
            if v > 0:
                color_px[v] = color_px.get(v, 0) + 1
    for row in out['spools']:
        for sp in row:
            if sp.get('id', 0) > 0:
                color_cap[sp['id']] = color_cap.get(sp['id'], 0) + sp['count']
    mismatch = []
    for k in set(color_px) | set(color_cap):
        if color_px.get(k, 0) != color_cap.get(k, 0):
            mismatch.append({'color': k, 'px': color_px.get(k, 0), 'cap': color_cap.get(k, 0)})

    report = {
        'source': a.base,
        'removed': changes,
        'diff_cells': diffs,
        'total_px': px,
        'total_cap': cap,
        'conservation': px == cap and not mismatch,
        'color_mismatch': mismatch,
        'empty_cells': empty,
    }
    json.dump(out, open(a.out, 'w', encoding='utf-8'), ensure_ascii=False)
    json.dump(report, open(a.report, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(json.dumps({k: report[k] for k in ('source', 'total_px', 'total_cap', 'conservation', 'empty_cells')}, ensure_ascii=False))
    print('removed:', [(x['r'], x['c'], x['before']['id'], x['before']['param']) for x in changes])

if __name__ == '__main__':
    main()
