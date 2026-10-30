#!/usr/bin/env python3
"""Shared TXT pixel-matrix export helpers for yarn/pattern level tools.

Canonical format confirmed by Tian Geng on 2026-05-14:

像素矩阵
1 2 3 ...
...

No color mapping header. Matrix rows use single spaces, not commas.
"""

from pathlib import Path


def matrix_to_txt(grid):
    """Return canonical TXT content for a 2D integer grid."""
    return "像素矩阵\n" + "\n".join(" ".join(str(int(v)) for v in row) for row in grid) + "\n"


def write_matrix_txt(path, grid):
    """Write a 2D integer grid using the canonical TXT format."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(matrix_to_txt(grid), encoding="utf-8")


def validate_matrix_txt(path, expected_rows=None, expected_cols=None):
    """Validate canonical TXT format and return parsed grid."""
    path = Path(path)
    lines = path.read_text(encoding="utf-8").splitlines()
    if not lines or lines[0].strip() != "像素矩阵":
        raise ValueError(f"{path}: first line must be 像素矩阵")
    grid = []
    for i, line in enumerate(lines[1:], start=2):
        parts = line.strip().split()
        if not parts:
            raise ValueError(f"{path}: empty matrix row at line {i}")
        try:
            row = [int(x) for x in parts]
        except ValueError as exc:
            raise ValueError(f"{path}: non-integer value at line {i}") from exc
        grid.append(row)
    if expected_rows is not None and len(grid) != expected_rows:
        raise ValueError(f"{path}: expected {expected_rows} rows, got {len(grid)}")
    if expected_cols is not None:
        bad = [idx + 1 for idx, row in enumerate(grid) if len(row) != expected_cols]
        if bad:
            raise ValueError(f"{path}: expected {expected_cols} cols, bad rows={bad[:10]}")
    return grid
