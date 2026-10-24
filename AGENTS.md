# AGENTS.md · 毛线汽车（关卡生成器）

> 给所有 AI 会话的常驻须知。**先读 `01_交接文档/工程说明.md`**（全工程说明书），本文件只放"不看就会犯错"的红线。
> 工作日志 584 KB / 387 节，**不要整份读**——按日志顶部的主题索引 grep 到某一节再读。

## 这是什么

给游戏「车接小人」批量生成可玩关卡的工程（本项目代号 **毛线汽车**，前身是前辈的交接包）（切球 → 选盘 → 障碍 → 放车 → 求解 → 评估）。
生成器在 `02_工程/完整主bin快照_20261012/bin/`，本地服务 8060。

## 红线（违反过，别再犯）

1. **容量区间是用户输入**：`boxSizeMin/Max`、`capNormMin/Max` 不许被任何逻辑缩放、对半拆或按"目标车数"拆。
   踩过两次：v330（变体 ×1.06 把 70 变 74）、v337（`applyFillRatio` 写回 `targetCarCount` 把 60 拆成 30）。
2. **一个会话只走一条产线**：纠偏 `bandFixOnce`、兜底都必须走 `runFlowOnce()`，不许写死 `produceFixed`。
3. **交付必须改版本号**：`bin/index.html` 三处（`?v=NNN` 13 处、`<title>`、`<h1>` 徽标）+ `css/style.css?v=NNN`。
4. **改完先 `node --check`**：`generator.js` / `app.js` / `playersim.js`。
5. **验证必须用真关卡**：先写临时脚本跑出数字（改前 vs 改后），再改代码。单种子对比已误导 ≥5 次。
6. **客户端 bin 目录不要随便动**：桌面端在 `/Users/red/Desktop/ParkPassenger_patched.app/Contents/Resources/bin/`，动之前先备份。

## 工作方式

- 用户的抱怨优先当**证据**看：先复现（找对应 `输出文件/unnamed-*` 批次），再定位，再改。
- 改完在 `01_交接文档/工作日志_20261012.md` 追加一节，固定五段：问题（原话）/ 证据 / 改动 / 验证（改前后数字）/ 遗留。
- 收工前更新 `01_交接文档/工程说明.md` 的版本号、参数、已知问题、当前生成状态。
- 关键改动写补丁到 `02_工程/补丁/补丁_XXX_vNNN.patch`。

## 常用命令

```bash
cd 02_工程/完整主bin快照_20261012 && python3 -m http.server 8060
node --check bin/js/generator.js && node --check bin/js/app.js && node --check bin/js/playersim.js
node 03_工具/难度关系/死因分析.js <关卡json>
node 03_工具/难度关系/生成过程动画.js <关卡json>
grep -n "^### 246" 01_交接文档/工作日志_20261012.md   # 按节号查日志
```
