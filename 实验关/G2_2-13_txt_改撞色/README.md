# G2 2–13 目标图 txt（2026-11-10）

> 从 `G2_bq_level_2..13.json` 的 `blocks` 导出；只改 txt，不改原关卡 JSON。
> 替换规则：同一关里两色**都出现**才替换：`3→2`、`12→4`、`31→32`；只有其中一色则不替换。

| 关 | 尺寸 | 应用替换 | 文件 |
|---:|---|---|---|
| 2 | 40x40 | 3→2 12→4 | [G2_bq_level_2.txt](G2_bq_level_2.txt) |
| 3 | 40x40 | 12→4 | [G2_bq_level_3.txt](G2_bq_level_3.txt) |
| 4 | 40x40 | 31→32 | [G2_bq_level_4.txt](G2_bq_level_4.txt) |
| 5 | 40x40 | 31→32 | [G2_bq_level_5.txt](G2_bq_level_5.txt) |
| 6 | 40x40 | 无 | [G2_bq_level_6.txt](G2_bq_level_6.txt) |
| 7 | 40x40 | 31→32 | [G2_bq_level_7.txt](G2_bq_level_7.txt) |
| 8 | 40x40 | 3→2 31→32 | [G2_bq_level_8.txt](G2_bq_level_8.txt) |
| 9 | 40x40 | 无 | [G2_bq_level_9.txt](G2_bq_level_9.txt) |
| 10 | 40x40 | 31→32 | [G2_bq_level_10.txt](G2_bq_level_10.txt) |
| 11 | 38x38 | 无 | [G2_bq_level_11.txt](G2_bq_level_11.txt) |
| 12 | 40x40 | 31→32 | [G2_bq_level_12.txt](G2_bq_level_12.txt) |
| 13 | 40x40 | 3→2 31→32 | [G2_bq_level_13.txt](G2_bq_level_13.txt) |

## 说明

- `3→2`：L2/L8/L13；这三关同时有 2 和 3。
- `12→4`：L2/L3；这两关同时有 4 和 12。
- `31→32`：L4/L5/L7/L8/L10/L12/L13；这些关同时有 31 和 32。
- L9/L11 只有 32，没有 31；L2/L3/L6 只有 31，没有 32；都不替换。
- 只导出了 `blocks`（目标图）；`spools` 容量未同步，不能直接当可玩关卡导入。
