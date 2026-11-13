#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
多链实验 · 链组被拿率统计（2026-11-13）

从 PopulationSim_v1 的 routes_seed<seed>.json 里统计每个链组（gid）被拿到的比例。
- 一局内某链组的两格任一被点 = 该组被拿（与 指标_v1 的 took 同口径：取一端即整组进场）。
- 逐种子输出，并给出 8 种子合并的总被拿率。

用法：
  python3 -I 链统计_v1.py <关卡.json> <sim_out_dir> [--out <json>]
"""
import sys, json, glob, os

def type_list(c):
    t = c.get('type', 0)
    if isinstance(t, list):
        return t
    return [] if t in (0, None) else [t]

def cell_gid(c):
    ts = type_list(c)
    if 5 not in ts:
        return 0
    i = ts.index(5)
    p = c.get('param', 0)
    return (p[i] if isinstance(p, list) else p) or 0

def load_chains(level_path):
    g = json.load(open(level_path, encoding='utf-8'))
    chains = {}
    for r, row in enumerate(g['spools']):
        for c, cell in enumerate(row):
            if not cell or cell.get('id', 0) <= 0:
                continue
            gid = cell_gid(cell)
            if gid:
                chains.setdefault(gid, []).append((r, c, cell.get('id'), cell.get('count')))
    return chains

def main():
    if len(sys.argv) < 3:
        print('用法: python3 -I 链统计_v1.py <关卡.json> <sim_out_dir> [--out <json>]', file=sys.stderr)
        sys.exit(2)
    level = sys.argv[1]
    simdir = sys.argv[2]
    out = None
    if '--out' in sys.argv:
        out = sys.argv[sys.argv.index('--out') + 1]
    chains = load_chains(level)
    by_gid = {gid: set((r, c) for r, c, _, _ in cells) for gid, cells in chains.items()}
    files = sorted(glob.glob(os.path.join(simdir, 'routes_seed*.json')))
    if not files:
        print('没有 routes 文件: ' + simdir, file=sys.stderr)
        sys.exit(1)
    per_seed = []
    all_games = 0
    all_takes = {gid: 0 for gid in chains}
    for fp in files:
        d = json.load(open(fp, encoding='utf-8'))
        seed = d.get('seed')
        games = d.get('games', [])
        takes = {gid: 0 for gid in chains}
        n = len(games)
        for gm in games:
            picked = set((s['r'], s['c']) for s in gm.get('route', []))
            for gid, cells in by_gid.items():
                if picked & cells:
                    takes[gid] += 1
        all_games += n
        for gid in chains:
            all_takes[gid] += takes[gid]
        per_seed.append({'seed': seed, 'games': n,
                         'take': {str(g): (round(takes[g] / n, 3) if n else None) for g in chains},
                         'anyTake': round(sum(1 for gm in games
                                              if set((s['r'], s['c']) for s in gm.get('route', [])) & set.union(*by_gid.values())) / n, 3) if n and by_gid else None})
    agg = {str(g): (round(all_takes[g] / all_games, 3) if all_games else None) for g in chains}
    result = {
        'level': os.path.basename(level),
        'chains': {str(g): [{'r': r, 'c': c, 'color': col, 'count': cnt} for r, c, col, cnt in cells]
                   for g, cells in chains.items()},
        'games': all_games,
        'takeRateByGid': agg,
        'perSeed': per_seed,
    }
    if out:
        json.dump(result, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(json.dumps(result, ensure_ascii=False))

if __name__ == '__main__':
    main()
