# 删除留档 · 2026-10-15（v139）

这个目录只放**本轮被整文件删除**的东西。改动前的备份（`*.bak-20261015`）不在
这里，它们跟各自的原文件放在一起（`bin/`、`bin/js/`、`bin/css/` 下）。

## levels.js —— 「示例 100 关」整文件下线

| 项 | 值 |
| --- | --- |
| 原件 | `bin/js/levels.js` |
| 体量 | 435,647 字节 |
| 内容 | ColonyFlow 关卡 1-100 的内置示例数据（`AntSolver.CF_LEVELS`） |
| 原来怎么用 | 模拟器页顶栏「示例100关」按钮 → `app.js loadSample()` → `utils.js getSampleLevels()`，把这 100 关铺进关卡列表 |

**删除时一并改掉的引用**：

- `bin/index.html`：`<script src="js/levels.js?v=138">` 标签、`<button id="btn-sample">示例100关</button>`
- `bin/js/utils.js`：`getSampleLevels()`、`cfLevelToBlocks()`、`cfLevelToBoard()`
- `bin/js/app.js`：`loadSample()` 与它的按钮绑定

**没有改的**：`AntSolver.CF_COLORS` / `CF_BASE`（那是渲染色板，不是示例关数据，仍在 `utils.js` 里）。

## 怎么恢复

把 `levels.js` 拷回 `bin/js/`，再把上面四处引用加回去，或者直接用本目录所在工程里的
`*.bak-20261015` 反打 `02_工程/补丁/补丁_老冰下线_数字冰生成器_v139.patch`。
