#!/usr/bin/env python3
"""把分散在多个 PInterp 输出目录的 per-p summary.json 合并成一个 summary_all.json。
用法：python3 merge_pinterp_48830.py <outdir> <root1> [<root2> ...]
"""
import glob, json, os, sys

P = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]

def main():
    outdir, roots = sys.argv[1], sys.argv[2:]
    rows = []
    for p in P:
        hit = None
        for root in roots:
            hits = glob.glob(os.path.join(root, 'p%.3f' % p, '*', 'summary.json'))
            if hits:
                hit = hits[0]
                break
        if not hit:
            print('missing p', p)
            continue
        sm = json.load(open(hit))
        rows.append({k: sm[k] for k in ('level', 'levelNo', 'p', 'games', 'seeds', 'winRate', 'deathMean', 'deathDist')})
    json.dump(rows, open(os.path.join(outdir, 'summary_all.json'), 'w'), ensure_ascii=False)
    print('wrote', os.path.join(outdir, 'summary_all.json'), 'rows', len(rows))

if __name__ == '__main__':
    main()
