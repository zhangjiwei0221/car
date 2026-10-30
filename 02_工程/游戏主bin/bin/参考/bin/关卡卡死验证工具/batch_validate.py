#!/usr/bin/env python3
"""
批量验证关卡是否死锁（卡死）
完全复现 validator/js/app.js 中 LevelActivityValidator 的逻辑
对 json关卡文件 目录下所有 JSON 文件进行验证
"""

import json
import os
import re
import sys
from collections import deque

PIPE_TYPES = {11, 12, 13, 14}
LINK_TYPE = 5
ORTHOGONAL_DIRECTIONS = [(-1, 0), (1, 0), (0, -1), (0, 1)]


def type_list(t):
    """将 type 转为列表"""
    if isinstance(t, list):
        return t[:]
    if t == 0 or t is None:
        return []
    return [t]


def has_type(t, target_type):
    """检查 type 是否包含指定类型"""
    return target_type in type_list(t)


def has_pipe(t):
    """检查 type 是否包含管道"""
    for v in type_list(t):
        if v in PIPE_TYPES:
            return True
    return False


def classify_cell(cell):
    """分类单元格"""
    cid = cell.get("id")
    ctype = cell.get("type")
    
    if cid == -1:
        return "dead"
    if has_pipe(ctype):
        return "dead"
    if cid == 0 and ctype == 0:
        return "empty"
    if cid == 0:
        return "invalid"
    if has_type(ctype, LINK_TYPE):
        return "link"
    return "normal"


def format_type(t):
    if isinstance(t, list):
        return "[" + ",".join(str(x) for x in t) + "]"
    return str(t)


class LevelActivityValidator:
    def __init__(self, level_data):
        self.level_data = level_data
        self.spools = []
        self.rows = 0
        self.cols = 0
        self.class_map = []
        self.active_map = []
        self.failures = []
        self.warnings = []
        self.link_pairs = []
        self.link_pair_by_key = {}
        self.link_endpoint_active = {}

    def validate(self):
        data_result = self._validate_and_load_data()
        if not data_result["success"]:
            return data_result

        self._build_class_map()
        invalid_cells = self._collect_invalid_cells()
        if invalid_cells:
            return self._result(False, "关卡数据错误：存在无效元素数据", invalid_cells)

        link_result = self._build_link_pairs()
        if not link_result["success"]:
            return self._result(False, "验证失败：链条配对异常", link_result["failures"])

        self._initialize_active_map()
        self._run_fixed_point_search()

        blocked = self._collect_blocked_elements()
        if blocked:
            return self._result(False, "验证失败：存在不可活动元素", blocked)

        return self._result(True, "验证通过：全部元素均可活动", [])

    def _result(self, success, message, failures=None):
        return {
            "success": success,
            "message": message,
            "failures": failures or [],
            "warnings": self.warnings[:],
            "rows": self.rows,
            "cols": self.cols,
        }

    def _validate_and_load_data(self):
        data = self.level_data
        if not isinstance(data, dict):
            return self._result(False, "关卡数据错误：JSON 根节点必须是对象",
                              [{"type": "invalid_data", "message": "JSON 根节点必须是对象"}])

        if "spools" not in data or not isinstance(data["spools"], list):
            return self._result(False, "关卡数据错误：缺少 spools 二维数组",
                              [{"type": "invalid_data", "message": "缺少 spools 二维数组"}])

        maprow = data.get("maprow")
        mapcol = data.get("mapcol")
        if not isinstance(maprow, int) or not isinstance(mapcol, int):
            return self._result(False, "关卡数据错误：maprow/mapcol 必须是数字",
                              [{"type": "invalid_data", "message": "maprow/mapcol 必须是数字"}])

        if maprow < 0 or mapcol < 0:
            return self._result(False, "关卡数据错误：maprow/mapcol 必须是非负整数",
                              [{"type": "invalid_data", "message": "maprow/mapcol 必须是非负整数"}])

        if len(data["spools"]) != maprow:
            return self._result(False, "关卡数据错误：maprow 与 spools 行数不一致",
                              [{"type": "invalid_data",
                                "message": f"maprow={maprow}，spools行数={len(data['spools'])}"}])

        if maprow == 0 or mapcol == 0:
            return self._result(False, "关卡数据错误：元素区不能为空",
                              [{"type": "invalid_data", "message": "maprow/mapcol 不能为0"}])

        failures = []
        for r, row in enumerate(data["spools"]):
            if not isinstance(row, list):
                failures.append({"type": "invalid_data", "message": f"spools[{r}] 不是数组"})
                continue
            if len(row) != mapcol:
                failures.append({"type": "invalid_data",
                                "message": f"spools[{r}]长度={len(row)}，mapcol={mapcol}"})
            for c, cell in enumerate(row):
                if not isinstance(cell, dict):
                    failures.append({"type": "invalid_data", "pos": {"row": r, "col": c},
                                    "message": "单元格必须是对象"})
                    continue
                if "id" not in cell or not isinstance(cell["id"], (int, float)):
                    failures.append({"type": "invalid_data", "pos": {"row": r, "col": c},
                                    "message": "id 必须是数字"})
                if "type" not in cell:
                    failures.append({"type": "invalid_data", "pos": {"row": r, "col": c},
                                    "message": "缺少 type 字段"})
                elif not isinstance(cell["type"], (int, float, list)):
                    failures.append({"type": "invalid_data", "pos": {"row": r, "col": c},
                                    "message": "type 必须是数字或数组"})

        if failures:
            return self._result(False, "关卡数据错误：spools 格式不合法", failures)

        # 深拷贝 spools
        self.spools = []
        for row in data["spools"]:
            new_row = []
            for cell in row:
                new_row.append({
                    "id": cell["id"],
                    "type": cell["type"][:] if isinstance(cell["type"], list) else cell["type"],
                })
            self.spools.append(new_row)

        self.rows = len(self.spools)
        self.cols = len(self.spools[0]) if self.rows > 0 else 0
        return {"success": True}

    def _build_class_map(self):
        self.class_map = []
        for r in range(self.rows):
            row = []
            for c in range(self.cols):
                row.append(classify_cell(self.spools[r][c]))
            self.class_map.append(row)

    def _collect_invalid_cells(self):
        failures = []
        for r in range(self.rows):
            for c in range(self.cols):
                if self.class_map[r][c] == "invalid":
                    failures.append({
                        "type": "invalid_data",
                        "pos": {"row": r, "col": c},
                        "cell": self.spools[r][c],
                        "message": "id 为0时仅允许 type=0 的空格或管道",
                    })
        return failures

    def _build_link_pairs(self):
        link_keys = {}
        failures = []
        self.link_pairs = []
        self.link_pair_by_key = {}

        for r in range(self.rows):
            for c in range(self.cols):
                if self.class_map[r][c] == "link":
                    link_keys[self._key(r, c)] = (r, c)

        visited = set()
        for key, (r, c) in link_keys.items():
            if key in visited:
                continue
            neighbors = self._link_neighbors(r, c)
            if len(neighbors) != 1:
                msg = "链条元素没有上下左右相邻伙伴" if len(neighbors) == 0 else "链条元素有多个上下左右相邻伙伴"
                failures.append({
                    "type": "invalid_link_pair",
                    "pos": {"row": r, "col": c},
                    "cell": self.spools[r][c],
                    "message": msg,
                })
                visited.add(key)
                continue

            partner = neighbors[0]
            partner_key = self._key(partner[0], partner[1])
            reverse_neighbors = self._link_neighbors(partner[0], partner[1])
            if len(reverse_neighbors) != 1 or self._key(reverse_neighbors[0][0], reverse_neighbors[0][1]) != key:
                failures.append({
                    "type": "invalid_link_pair",
                    "pos": {"row": r, "col": c},
                    "cell": self.spools[r][c],
                    "message": "链条伙伴关系不唯一",
                })
                visited.add(key)
                visited.add(partner_key)
                continue

            pair = {
                "a": (r, c),
                "b": partner,
                "orientation": "horizontal" if r == partner[0] else "vertical",
            }
            idx = len(self.link_pairs)
            self.link_pairs.append(pair)
            self.link_pair_by_key[key] = {"pair_index": idx, "partner": partner}
            self.link_pair_by_key[partner_key] = {"pair_index": idx, "partner": (r, c)}
            visited.add(key)
            visited.add(partner_key)

        return {"success": len(failures) == 0, "failures": failures}

    def _link_neighbors(self, row, col):
        result = []
        for dr, dc in ORTHOGONAL_DIRECTIONS:
            nr, nc = row + dr, col + dc
            if self._in_bounds(nr, nc) and self.class_map[nr][nc] == "link":
                result.append((nr, nc))
        return result

    def _initialize_active_map(self):
        self.active_map = [[False] * self.cols for _ in range(self.rows)]
        self.link_endpoint_active = {}

        for c in range(self.cols):
            cls = self.class_map[0][c]
            if cls in ("empty", "normal"):
                self.active_map[0][c] = True
            elif cls == "link":
                self.link_endpoint_active[self._key(0, c)] = True

    def _run_fixed_point_search(self):
        changed = True
        while changed:
            changed = False
            if self._spread_active_paths():
                changed = True
            if self._activate_link_pairs():
                changed = True

    def _spread_active_paths(self):
        changed = False
        queue = deque()
        for r in range(self.rows):
            for c in range(self.cols):
                if self.active_map[r][c]:
                    queue.append((r, c))

        while queue:
            cr, cc = queue.popleft()
            for dr, dc in ORTHOGONAL_DIRECTIONS:
                nr, nc = cr + dr, cc + dc
                if not self._in_bounds(nr, nc):
                    continue
                cls = self.class_map[nr][nc]
                if cls == "dead":
                    continue
                if cls in ("empty", "normal"):
                    if not self.active_map[nr][nc]:
                        self.active_map[nr][nc] = True
                        changed = True
                        queue.append((nr, nc))
                elif cls == "link":
                    key = self._key(nr, nc)
                    if self._can_link_endpoint_use_source(nr, nc, cr, cc) and not self.link_endpoint_active.get(key):
                        self.link_endpoint_active[key] = True
                        changed = True

        return changed

    def _activate_link_pairs(self):
        changed = False
        for pair in self.link_pairs:
            ar, ac = pair["a"]
            br, bc = pair["b"]
            if self.active_map[ar][ac] and self.active_map[br][bc]:
                continue
            a_key = self._key(ar, ac)
            b_key = self._key(br, bc)
            if self.link_endpoint_active.get(a_key) and self.link_endpoint_active.get(b_key):
                self.active_map[ar][ac] = True
                self.active_map[br][bc] = True
                changed = True
        return changed

    def _can_link_endpoint_use_source(self, link_row, link_col, source_row, source_col):
        if link_row == 0:
            return True
        key = self._key(link_row, link_col)
        info = self.link_pair_by_key.get(key)
        if not info:
            return False
        partner = info["partner"]
        return not (partner[0] == source_row and partner[1] == source_col)

    def _collect_blocked_elements(self):
        failures = []
        for r in range(self.rows):
            for c in range(self.cols):
                cls = self.class_map[r][c]
                if cls in ("normal", "link") and not self.active_map[r][c]:
                    failures.append({
                        "type": "blocked",
                        "pos": {"row": r, "col": c},
                        "cell": self.spools[r][c],
                        "message": "元素无法连通到第一行活路",
                    })
        return failures

    def _key(self, row, col):
        return f"{row},{col}"

    def _in_bounds(self, row, col):
        return 0 <= row < self.rows and 0 <= col < self.cols


def main():
    level_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "json关卡文件")
    
    if not os.path.isdir(level_dir):
        print(f"错误：找不到目录 {level_dir}")
        sys.exit(1)

    files = sorted(
        [f for f in os.listdir(level_dir) if f.endswith(".json") and f.startswith("G5_uy_level_")],
        key=lambda x: int(re.search(r'\d+', x).group())
    )

    print(f"共发现 {len(files)} 个关卡文件，开始验证...\n")

    pass_count = 0
    fail_count = 0
    error_count = 0
    failed_levels = []
    error_levels = []

    for file in files:
        file_path = os.path.join(level_dir, file)
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                level_data = json.load(f)
        except Exception as e:
            error_count += 1
            error_levels.append({"file": file, "error": f"JSON解析失败: {e}"})
            continue

        validator = LevelActivityValidator(level_data)
        result = validator.validate()

        if result["success"]:
            pass_count += 1
        else:
            fail_count += 1
            failed_levels.append({"file": file, "result": result})

    # 输出汇总
    print("=" * 60)
    print("验证完成汇总")
    print("=" * 60)
    print(f"总关卡数: {len(files)}")
    print(f"验证通过: {pass_count}")
    print(f"验证失败(死锁): {fail_count}")
    print(f"文件错误: {error_count}")
    print("=" * 60)

    if error_levels:
        print("\n--- 文件错误列表 ---")
        for item in error_levels:
            print(f"  {item['file']}: {item['error']}")

    if failed_levels:
        print("\n--- 死锁关卡列表 ---")
        for item in failed_levels:
            level_num = re.search(r'\d+', item["file"]).group()
            result = item["result"]
            print(f"\n第 {level_num} 关 ({item['file']}):")
            print(f"  {result['message']}")
            if result["failures"]:
                max_show = 10
                failures = result["failures"]
                for i, f in enumerate(failures[:max_show]):
                    detail = f"  {i + 1}. [{f['type']}]"
                    if "pos" in f and f.get("pos") and "cell" in f and f.get("cell"):
                        pos = f["pos"]
                        cell = f["cell"]
                        detail += f" 第{pos['row']+1}行第{pos['col']+1}列 id={cell.get('id')} type={format_type(cell.get('type'))}"
                    if "message" in f and f.get("message"):
                        detail += f" - {f['message']}"
                    print(detail)
                if len(failures) > max_show:
                    print(f"  ... 还有 {len(failures) - max_show} 项")

    if not failed_levels and not error_levels:
        print("\n全部关卡验证通过，无死锁！")


if __name__ == "__main__":
    main()
