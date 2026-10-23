/**
 * 蚂蚁拿块 - 关卡生成器
 * 
 * 基于TXT目标图生成蚂蚁盒队列。
 * 
 * 生成流程：
 * 1. 导入TXT目标图（尺寸、颜色种类自动识别，不可调）
 * 2. 分析目标图的消除层次（从边界向内BFS分层）
 * 3. 按层次+颜色生成蚂蚁盒队列（容量自洽校验）
 * 4. 铺盒到棋盘 + 放置障碍/管道（全部在棋盘上）
 * 5. 运行求解器验证可解性 + 输出难度评分
 * 6. 解后【区域换球】：按求解进度%圈定区间换无障碍盒制造卡点，重解校验
 * 7. 输出关卡JSON
 * 
 * 可调参数：
 * - boxSizeMin/boxSizeMax: 蚂蚁盒容量范围（每盒的蚂蚁数上下限）
 * - queueCount: 队列数 (2~5)
 * - bufferLimit: 暂存上限 (3~7)
 * - swapRegionMin/Max: 卡点换球(B支)的后期区域进度区间(%)；基础阶段不换球
 * 注：难度非输入参数；关卡难度分由生产(可解)后的求解器表现反推计算(见 computeDifficulty→Analysis.difficulty)。
 * - icePercent: 数字冰比例（【v139】老冰下线：这里的「冰」一律指数字冰 type 7）
 * - blackPercent: 黑块比例
 * - chainCount: 锁链对数
 * 
 * 蚂蚁盒容量自洽规则：
 * - 对每种颜色：总像素数 = 所有该色蚂蚁盒的count之和
 * - 按 boxSizeMin~boxSizeMax 均分，最后一盒不满则与前一盒求和均分
 */

var AntSolver = AntSolver || {};

AntSolver.Generator = (function() {

  // 【v193】可复现随机源：config.seed 一旦给出，生成器内部所有随机都走本地 LCG；
  //   不给 seed 时逐值等于 Math.random（生产行为不变）。
  //   为什么需要：① 重建/重试要能和原局对比（v192 的调压就在这一步失准）；
  //   ② 风险清单 R5「随机种子未固定」一直挂着；③ 所有 A/B 才可复现。
  var _RNG = { on: false, s: 1 };
  function rnd() {
    if (!_RNG.on) return Math.random();   // ← 这里必须是 Math.random：不能被批量替换成 rnd（会无限递归）
    _RNG.s = (_RNG.s * 1664525 + 1013904223) >>> 0;
    return _RNG.s / 4294967296;
  }
  function seedRng(seed) {
    if (seed == null || seed === '' || isNaN(+seed)) { _RNG.on = false; return; }
    _RNG.on = true;
    // ⚠ LCG 的经典弱点：**相邻 seed 会产生高度相关的序列**（101/102/103… 前几十个数几乎一样）。
    //   所以先做一次散列 + 8 步预热，再当起点，保证相邻 seed 互不相关（实测：修前 10 个相邻 seed 峰窗全是 3）。
    var s = ((+seed) >>> 0) || 1;
    s = (s ^ 0x9e3779b9) >>> 0;
    for (var i = 0; i < 8; i++) s = (s * 1664525 + 1013904223) >>> 0;
    _RNG.s = s;
  }

  var DIRS4 = [[1,0],[-1,0],[0,1],[0,-1]];   // 【v348】四方向常量
  var DEFAULT_CONFIG = {
    // 【默认参数基线：v95四方向消除统一默认参数】2026-07-31 起，以下标注「统一默认」的字段
    // 取自 方案文件夹/方案_v95四方向消除统一默认参数.json 的 config，作为四方向消除的统一默认口径。
    channelMode: false,     // 【v340·实验】通道模式：第 0 行只留 channelEntryCol 一个入口，其余封黑
    channelEntryCol: 0,     // 通道入口列（channelMode 时生效）
    channelK: 0,            // 第 1 行封堵格数（从入口右侧循环封）
    boxSizeMin: 35,     // 【统一默认】蚂蚁盒容量下限（原 25）
    boxSizeMax: 80,     // 【统一默认】蚂蚁盒容量上限（原 52）
    boxSizeMode: 'random', // 盒容量策略：random(区间内随机,默认)/max(接近满容量)/min(偏小)/polar(两极化,见 makeCapPicker)
    // polar 模式专用（其他模式忽略）：两端窄带的命中概率与窄带宽度占区间比例
    boxSizePolarBias: 0.7,
    boxSizePolarBandRatio: 0.25,
    // ===== 盒切分方式（v137，用户 2026-10-14 批准移植）=====
    // 'trend'（默认）= 现有几何趋势流切分（baseFillBoxes / 底部模式 baseFillBoxesBottom）；
    // 'anchor'        = 锚点切盒（AntSolver.AnchorCut，双锚点分成 A/B 两片，**A 片整车先出、B 片后出**）。
    //   ★ 默认 'trend' 时 pickBoxSplit 里那段分支整段不进 → 现有生产口径与本次改动前逐字节一致。
    //   为什么要它：趋势切永远挑"当前最好摸的颜色"，玩家手上不攒色 → 实测 14 组参数后期峰窗最高只到 2.0
    //   （合格线 3.2 / 简单关线 2.5），压力调不出来；锚点切盒靠"同色前后各来一次"把暂存顶起来。
    boxCutMode: 'trend',
    // ===== 【v147】错位量：车在棋盘上的排位，相对"像素该露头的时刻"整体旋转多少% =====
    //
    // ⚠⚠ 实测结论：**这条路走不通，默认必须保持 0，也不进界面**（保留实现只为留证据，别再试一遍）。
    //
    // 当初的模型是"难度 = 「货的时间线」与「车的时间线」的相位差"：货的时间线 = 盒在盒队列里的位次
    // （= 像素大概第几步露头），车的时间线 = 填盘顺序（由 elimSeq 决定）。默认两者锁死同序，
    // 于是车可点时货刚好露头 → 顺畅、没压力。把排位整体旋转 k% 想让它们错开。
    //
    // 55×55 大图（2809 像素）每档 6 轮的实测：
    //     错位  0% → 出关 6/6 ｜ 有卡点 3/6 ｜ 卡点区峰窗均 3.10 ｜ 前期均 1.19
    //     错位 40% → 出关 5/6 ｜ 有卡点 2/5 ｜ 卡点区峰窗均 2.75 ｜ 前期均 1.05
    // 即**整体错位既没把压力顶上来、也没把压力挪到后期**，反而略差；早先小样本看到的"40% 时 3/3 有卡点"
    // 是噪声。小图（27×32）更明显，错位 0→40% 卡点区峰窗基本不动、有卡点始终 0。
    //
    // 机理：旋转让一半车"车晚于货"、另一半"车早于货"。而"车早于货"的那批一到手就没货可吃，
    // 全堵在暂存区开头 → 压力被推到**前期**（恰恰是审核判不合格的形状），并没有沉淀成中后期的卡点。
    //
    // 修正后的认识：真正管用的杠杆是【一辆车的像素在时间轴上跨多宽】= **切盒的形状**，不是排位。
    //   证据：同一张图把切盒方式从"趋势切"换成"锚点切盒"（把同一色拆到前后两半，车的跨度变大），
    //   v137 实测 5 轮里 3 轮直接变成"有卡点合格"。要加压请走切盒形状族那条路。
    boxPhaseShiftPct: 0,
    // ===== 【v148】切盒"跨度"轴：像素流的排序键在「趋势序」与「等深线序」之间插值 =====
    //
    // ⚠⚠ 实测结论：**这条轴（无论往哪个方向）都没有可辨别的效果，默认必须保持 0、不进界面。**
    //    保留实现只为留证据，别再试一遍。要加压请走【地理分片】（锚点切盒）那条路。
    //
    // 当初的假设：难度杠杆是"一辆车的像素在时间轴上跨多宽"（v147 由锚点切的效果反推），
    //   于是把"跨度"做成本轴：0 = 趋势序（自下而上逐行）、1 = 等深线序（同层先装、跨度最小）。
    //
    // 实测（图 27×32 / 盒容量 40~60 / 每臂 12 轮 / **配对固定种子** / 管道下限 1）：
    //     方案                出关     卡点区峰窗均   峰值暂存均   空转比
    //     趋势切（0，现状）    12/12      0.67          0.67        5%
    //     等深线（1）          12/12      0.92          0.92        7%
    //     列优先（跨度最大）    12/12      0.67          0.67        5%
    //     锚点切盒（对照组）    12/12      1.67          1.67       12%   ← 配对比较 10 胜 2 负
    //   → 排序键这条轴的两端与中间都没有效果；**有效的是"地理分片"**（把图切成 A/B 两片、
    //     片内照常切盒、片间串行出场）——那不是排序问题，是分区问题。
    //
    // 【评估方法（比结论更重要）】用小样本 + 二元统计量（"这关有没有卡点"）**分不出差异**：
    //   同一份代码在 5 轮里能在 1/5 与 5/5 之间跳。要评估请用 /private/tmp/numice_gen/seeded_ab.js
    //   那种【配对固定种子 + 连续量（卡点区峰窗 / 峰值暂存 / 空转比）】的做法。
    boxCutSpan: 0,
    // 【v148】'trend'(默认/现状) | 'column'（按列、列内由外向内 = 深度跨度最大）—— 同上，实测无效
    boxCutOrder: 'trend',
    // —— 锚点切盒专用参数（仅 boxCutMode:'anchor' 生效；沿用沙盒 anchor-cut.js 的原生字段名）——
    // 双锚点 = 左下 + 右下；'single' = 只留底部中点（A/B 退化为单组，对照用）
    anchorMode: 'double',
    anchorBigBoxMax: 5,        // 最多促成几个「大盒」（≥71 像素的整车，用于吃掉大块连色）
    anchorBoxAvg: null,        // 目标平均盒容量；null → 取 boxSizeMin/Max 中值（用户拍板：不新增输入框）
    anchorMinBoxCap: null,     // 单盒容量下限；null → 取 boxSizeMin
    anchorRoleAwareCut: true,  // 按颜色角色切（阻隔色拆成小盒分阶段释放、大块连色合并成大盒）
    // ===== 底部消除·多色并行吐球（v110，任务 ANT-GEN-BOTTOM-PARALLEL-V3-20260826）=====
    // 只作用于 bottomOnly 分支的盒切分（baseFillBoxesBottom），四方向分支不受影响。
    // 同时保持 P 个颜色在累积单盒进度，tick 轮询、装满即挤出 → 盒队列天然交错。
    //   null（默认）= 取 bufferLimit（暂存区上限，实为 5），语义是"手上同时能攒几种颜色"
    //   0           = 关闭，回退到旧的 eliminationOrder 单色批量路径
    //   >=1         = 指定并行路数
    boxParallelCount: null,
    // ===== 填盘层局部交错（v114，任务 ANT-GEN-FILL-INTERLEAVE-20260827）=====
    // 只影响「盒怎么摆到棋盘」，不影响「盒怎么挤出来」。四方向与底部两种入口模式共用。
    // 每个可放格从队列头部宽 W 的前瞻窗口里挑与左邻/上邻不同色的盒；W 即位移上限。
    //   0 = 关闭（逐行左→右原行为）　默认 6（裸盘实验里 6/9/12 等效，取位移最小的 6）
    fillInterleaveWindow: 6,
    // ===== 参数区间化（v115，任务 ANT-GEN-PARAM-RANGE-CHOKE-PROB-20260827）=====
    // 用户口径：「不同的候选都可以随机选取参数限制范围内。因为当前批次关卡都是同样的参数，
    //           输出的关卡结构会同质化」→ 每个候选各采样一组，制造批次内结构多样性。
    // 采样时机：produceFixed 的候选循环（for k<K）每轮一次，见 sampleRangedConfig。
    // 兼容：下面这些 *Min/*Max 若为 null，则退回读同名单值参数（icePercent 等），
    //       即「只给单值 → 视为 min=max」，旧方案文件不失效。
    // 默认全部 null → 逐值等价 v114 行为。
    icePercentMin: null, icePercentMax: null,
    blackPercentMin: null, blackPercentMax: null,
    chainCountMin: null, chainCountMax: null,
    // 【锁链档位组合】任务 ANT-DIFFICULTY-SYSTEM-V2-20260901，用户 2026-09-02 授权。
    //   原实现每组 2 连还是 3 连由写死的抛硬币决定，`chainCount` 只管组数 → 「2连/3连 拆分」不可控，
    //   评分体系 2.0 的锁链 18 档表依赖该拆分，实测组数钉死后档位仍漂 1.7 档。
    //   三个入口（优先级从高到低）：
    //     chainTierPool 非空  → 每关从池中随机抽一档（用户要的「赋予全部档位的生产选择组合」）
    //     chain2Count+chain3Count 同时给 → 用这组显式定值（受控实验用）
    //     都为 null（缺省） → **逐值回到抛硬币原行为**，旧方案与已产出批次逐字节可复现
    //   队列模式下总组数 = g2+g3（不再读 chainCount）；长度不精确匹配不算放置成功，
    //   放不满时把缺口记进 `_chainTierActual.shortfall`，不静默降级。
    chainTierPool: null,   // 档位池：[[g2,g3],…] 或 [{g2,g3},…]。null=不启用
    chain2Count: null,     // 显式 2 连组数（须与 chain3Count 同时给）
    chain3Count: null,     // 显式 3 连组数
    // 【顶部锁链豁免】用户 2026-09-02「关于首行豁免。可以打开，不用完全限制前两行」。
    //   顶部障碍后处理原本硬编码「前2行最多 1 对锁链，超出整组清标」，且密度封顶也会拿锁链整组开刀。
    //   实测这是档位不可控的主因：规划/绑定都精确(3/3/3、失败0)，到后处理只剩均值 2.29 组。
    //   缺省 null/false → 逐值回到原行为，正式生产不变。
    topChainMaxGroups: null,  // 前2行允许的锁链组数上限；null=沿用原硬编码 1
    topChainExempt: false,    // true=前2行锁链完全豁免（组数上限与密度封顶都不摘锁链）
    // 【锁链落位组合】用户 2026-09-02 要求测六类落位：①随机 ②叠加冰块 ③窄路附近
    //   ④与换球位置组合 ⑤与大容量球位置组合 ⑥与稀有色位置组合。
    //   ①②③ 已有实现（默认随机 / chainIce / narrowGapChain）。
    //   ④⑤⑥ 的实现方式是**反向共位**：换球、大容量球、稀有色都在填色后执行且自带目标选择，
    //   而它们原本都用 `chain === 0` 主动避开锁链格。这里放开该限制并把目标**优先偏向锁链格**，
    //   即可得到「锁链与该手段同格」的效果，**不需要搬动锁链**（搬动会破坏可激活性与求解口径）。
    //   取值：null（缺省，行为不变）/ 'swap' / 'bigBox' / 'rareColor'
    chainComboWith: null,
    // 【同比难度缩放 · 用户 2026-09-02 裁定】缺省关闭，开启后改变生成期调参口径。
    //   现行问题：调难度时是「挑最便宜的参数往端点推」——
    //     · 不可解重试减负（generateFromBlocks 内）对 icePercent 逐轮 ×0.9 累乘，
    //       15% 经约 30 轮会掉到 0.6%，再经 Math.floor(boxTarget × pct/100) 就是 **0 个冰格**；
    //     · applyPressureAdjust 对 chainCount 是**绝对 ±1**，1 组一次就归零。
    //   后果：权重分低的障碍（冰块 2.0 分）最先被牺牲掉，因为抹掉它掉分最少，
    //         于是「简单关」变成「没有冰块的关」而不是「各项都轻一点的关」。
    //   新口径：每个障碍参数按**它自己那一项的权重分**同比缩放，各项等比例让分，
    //         并给每项设保底下限，不允许被压到端点/清零。
    proportionalDifficultyAdjust: false,
    // 同比缩放时每项的保底比例：该项自身归一分不得低于「原归一分 × 此值」。
    //   0.25 表示最多只让掉自己那一项的 75%，避免任何一项被抹除。
    proportionalFloorRatio: 0.25,
    questionPercentMin: null, questionPercentMax: null,
    // q2：原 UI 标为「瞬时连锁专用」的三项加区间。
    // 【注】那个「专用」标签自 v99 起即失准 —— 引擎里这些参数从无 instantChain 门控，
    //       app.js 也无条件透传；输出文件/底部消除 那批正是靠 minPipes=4/usableSpaceTarget=0.74 跑出来的。
    minPipesMin: null, minPipesMax: null,
    pipeMaxDepthMin: null, pipeMaxDepthMax: null,
    usableSpaceTargetMin: null, usableSpaceTargetMax: null,
    // ===== 卡点类型出现概率机制（v115，替代固定数量）=====
    // 用户口径：「替代，因为旧的机制无法用稳定的期望算出会出多少这样卡点类型，同时也无法制造波动」
    //           「预算是指检查次数预算耗尽」
    // 掷 rolls 次，每次以 chokeTypeProb 判定是否出现；出现则从【已勾选且未被抽中】的池里随机取一个
    // （沿用任务 W 的「同关内类型不重合」约束）。池耗尽后剩余次数不再产生新类型。
    // 0 = 不启用类型化（与旧 chokeTypeCountNormal:0 等价）。
    chokeTypeRollsNormal: 0,
    chokeTypeRollsBoss: 0,
    chokeTypeProb: 0.5,
    // ===== 死亡边界救援兜底（用户 2026-08-04 指定；默认关闭，开启才生效）=====
    // 最终候选若"玩家版暂存峰值触达上限"(死亡边界，现行审核直接判不合格)，
    // 就在原关卡上做一轮障碍缩减尝试救援：拆 1~2 个冰块 + 解除 1 组锁链，
    // 且必须"全知仍通关 + 玩家仍通关 + 峰值降到上限以下"才采用，否则保留原关卡不掩盖问题。
    deathEdgeRescue: false,
    deathEdgeRescueIceCut: 2,      // 数字冰最多拆几个（第1轮拆1个，第2轮拆到该上限）
    deathEdgeRescueChainCut: 1,    // 解除几组锁链
    // ===== 管道数量下限（用户 2026-08-04 指定：不低于 4 个）=====
    // 0 = 不约束（默认，原行为）。>0 时在选棋盘尺寸阶段反推格数上限来保证，见 chooseBoardDims。
    minPipes: 0,
    // ===== 管道队列深度参数化 + 管道不足兜底（任务 ANT-GEN-PIPE-DEPTH-FALLBACK-20260825）=====
    // 用户 2026-08-25：「可调管道队列深度，作为新参数」+「如果其他参数影响导致管道不够，
    //   则保底 2 个管道、深度 3」。
    //
    // pipeMaxDepth：单条管道最多排几个盒（原写死常量 MAX_PIPE_DEPTH=6）。默认 6 = 原行为。
    //   官方格式 spools[].param 是不限长的队列数组、simulator 也不校验队列长度，
    //   因此调这个值不触及求解器与游戏端格式，只改生成期的容量口径。
    // pipeMinFill：单条管道【最少】要排几个盒（原写死在 solveSpaceQuota 的 ⌊D/4⌋ 里）。默认 4 = 原行为。
    //   它决定「溢出盒 D 最多摊给几条管道」：P ≤ ⌊D/pipeMinFill⌋。
    //   ⚠ 这两个值与 minPipes 联立后有硬性算术约束：minPipes 条管道要求 D ≥ minPipes × pipeMinFill。
    //     实测教训（08-25，方案_v104）：minPipes=4 + pipeMinFill=4 需要 D≥16，而该批源图只能产出
    //     D=2~8 → 53 张过闸源图 0 产出，全灭于 usablePipeShort。故有下面的兜底。
    pipeMaxDepth: 6,
    pipeMinFill: 4,
    // 管道阶梯（用户 2026-08-25 两次裁决合并）。按顺序降级，每级都是【硬下限】：
    //   ① 主轮       minPipes 条 / 每管 ≥ pipeMinFill
    //   ② 兜底       pipeFallbackCount 条 / 每管 ≥ pipeFallbackDepth
    //   ③ 绝对下限   pipeFloorCount 条 / 每管 ≥ pipeFloorDepth  ← 用户：「最低 2 个管道 2 层深度」
    //   ④ 去除管道   连 ③ 都到不了 → P=0，管道格全让给盒 ← 用户：「低于这个下限就直接去除管道」
    // pipeFallbackCount = 0 关闭 ②；pipeFloorCount = 0 关闭 ③。
    // ④ 不可关：它是守恒兜底，且 D ≤ 0（棋盘本就装得下）时必须走它——否则只会得到装不满的空管道。
    // 守恒硬约束贯穿全阶梯：D ≤ P × pipeMaxDepth，且 P=0 时必须 D=0（靠少铺 D 个墙腾出格子）。
    pipeFallbackCount: 2,
    pipeFallbackDepth: 3,
    pipeFloorCount: 2,
    pipeFloorDepth: 2,
    // ===== 可用棋盘空间一致性（用户 2026-08-04）=====
    // 可用空间 = (总格 − 墙 − 管道占位) / 总格。设为 0 表示关闭（默认，原行为完全不变）。
    // 开启后：各候选尺寸都按该目标联立求解 (管道数, 黑块数)，只保留有解的尺寸并在其中随机选，
    // 从而让同一批像素图产出不同大小的棋盘、而可用空间保持一致。详见 solveSpaceQuota。
    usableSpaceTarget: 0,
    usableSpaceTolPp: 5,             // 可用空间允许偏离目标多少个百分点（结构层闸门按此淘汰候选）
    usableSpaceBlackTolPp: 5,        // 黑块比例基础容差（个百分点）
    usableSpaceBreachStepPp: 5,      // 每次突破放宽多少个百分点
    usableSpaceBreachBudget: 2,      // 突破预算次数（2 次 × 5pp = 最大突破 10 个百分点，用于保护小棋盘）
    // 注：基础阶段不换球(v86 起)；swapRegionMin/Max 仍保留——供【卡点B支】chokeSwap 定义"后期区域"起点用。
    swapRegionMin: 50,  // 卡点换球的后期区域进度下限(%)：chokeSwap 据此把 pickOrder 切成早/后两段
    swapRegionMax: 100, // (上限目前未在 chokeSwap 中使用，保留兼容旧方案JSON)
    queueCount: 3,
    bufferLimit: 5,     // 暂存上限（基线固定=5）

    icePercent: 15,       // 【统一默认】数字冰比例(≥10)（原 18；键名保留以兼容历史方案）
    blackPercent: 10,     // 【统一默认】黑块比例——指最终棋盘的黑块目标占比（原 13）
    chainCount: 3,        // 【统一默认】锁链对数(2-6)（原 4）
    chainInitialRatio: 0.5, // 【可调,预设0.5】基础棋盘只放此比例的锁链；剩余一半留【卡点阶段(P2)】按依赖定向补链
    questionPercent: 10,  // 【统一默认】问号比例（原 14）（软障碍，隐藏颜色；强制偶数生成）；可与冰块叠加；不在第0行
    topObstacleMaxPercent: 50, // 前2行(索引0/1)障碍密度上限(%)：障碍格(黑/管道/冰/锁链/问号) ÷ 实际占用格 ≤ 此值；另前2行最多1对锁链
    wallDisperse: 0.85,  // 墙(黑块)分散系数(0~1)：越大越优先选四邻无墙的孤立格分散铺墙——多余黑块打散避免堆成L形连续墙/关卡同质化；墙可现于2-3行，不现于首行
    pipeRowStart: 3,      // 管道最早出现行(默认第3行以后=索引>=3的第4行)；不在第0行/末行
    pipeRowBias: 0.35,    // 管道靠后偏置：起点再下压 rows×该比例(0=不偏置，越大越靠底部)
    // 【统一默认】棋盘行列范围（原 8-9 行 × 11-16 列）。
    // 新范围下满足「列>行 且 列-行∈{1,2}」的合法组合共 7 个：
    // 6×7、6×8、7×8、7×9、8×9、8×10、9×10，够用且不会因约束把候选压空。
    boardRowsMin: 6,
    boardRowsMax: 9,
    boardColsMin: 7,
    boardColsMax: 10,
    // 交错随机铺盒参数（对齐 bin 毛线生成器）
    singleColorExtractPercent: 5,   // 单色抽取比例（散布制造交错/暂存压力）
    firstRowRangeMultiplier: 1,     // 首行候选窗口倍数
    nextRowRangeMultiplier: 1.1,    // 后续行候选窗口倍数
    diffLevel: 2,         // 难度阶梯：1=默认 2=障碍偏后期 3=聚集/锁链覆冰（复用bin diffLevel思路）
    fillRatio: 1.0,       // 棋盘选尺寸时的填充率(<1 留空位余量；1.0=旧行为；packFull 时忽略)
    packFull: true,       // 【统一默认】填满棋盘：棋盘按盒数进一步缩小、多余盒进管道，尽量无空洞（原 false）
    onBoardFrac: 0.8,     // packFull 时目标上盘盒比例(其余走管道；盒越多棋盘越小)
    narrowPath: true,     // 【55×55基础参数】窄路卡点默认开：不规律锯齿墙(斜向/边缘锚定/连通楼梯)+缺口，制造唯一可达通道
    // 窄路出现概率（用户 2026-08-04：窄路必定出现，希望改为按概率出现）。
    // 1 = 必定出现（默认，与本参数引入前完全一致）；0.6 = 约六成关卡出现窄路。
    // 仅控制「本关是否建窄路墙」，窄路自身的形态与缺口数仍由 narrowPathGapsMin/Max 决定。
    // 注意：不影响可用空间一致性——窄路墙黑块本就计入黑块总目标(blackTarget)，
    // 窄路不出现时分散黑块会补足同样的数量，故 (墙+管道) 总量不变。
    narrowPathProb: 1,
    narrowPathGaps: 0,    // (兼容)固定活口数；>0 时覆盖下面的范围
    narrowPathGapsMin: 2, // 【统一默认】活口数范围下限（原 1）
    narrowPathGapsMax: 3, // 【55×55基础参数】活口数范围上限（范围内随机；约束1-4）
    narrowPathIce: true,  // 缺口盒加数字冰(临时锁路/临时连接窄路，需推进倒计时)
    narrowPathChain: true, // 缺口处用斜向/三连锁链辅助阻拦
    narrowPathTrap: false, // 推理陷阱(早序盒调到墙下)：测试显示会破坏可解性，默认关闭
    narrowPathTrapFrac: 0.5, // 陷阱交换比例(仅 narrowPathTrap 开启时生效)
    maxRetries: 5,
    // ===== 两轮生产 =====
    candidateCount: 6,     // 候选数 K：每源图初生成几个候选(各过合法性门:结构+可解)
    chokeBranches: 3,      // 【P3】卡点树分支数 B：每变体每轮展开 B 个卡点制造分支
    rounds: 2,             // 【P3】卡点树轮数 N：不合格变体再分支的轮数；单候选叶子≤Bᴺ，1关合格即停
    chokeSwapCount: 12,    // 【卡点A】一次换球最多搬几处(越多卡点越强，可调)
    chainSwapCount: 4,     // 【卡点A·锁链定向】一次最多把几个前期锁链组换成图内部深色(逼组内成员长期滞留)
    timeBudgetMs: 300000,  // 【单关生产时间预算】默认5分钟；到点仍不合格→兜底输出树内已评估过的最接近标准的候选(0=不限时)
    requireHardPass: false, // 【批量比例控制用】true=只在"困难合格"(真实卡点)时早停；简单合格(趋势符合)不算数，继续找/直到超时兜底
    // 【多轮难度标定】(任务 ANT-DIFF-MULTIROUND-PROD-20260901，用户 2026-09-01 批准)
    //   >1 时：候选筛选仍用单轮 computeDifficulty(快)，只在唯一出口 finalizeProduce 对【最终选中关卡】
    //   调 Analysis.recalibrateDifficulty 跑 N 轮玩家路线取最稳一条标定难度，复用已求得的 solve(不重解)。
    //   目的：去掉单轮 seed7 的抽样抖动(实测单轮极差均 17.9)。=1 逐值回到旧的单轮行为。
    //   R=7 为 20 关实测的收敛拐点(代表分对 R=25 参考偏差均 1.1、耗时 ×1.4 单轮)。
    difficultyRounds: 7,
    // ===== 基础填球（趋势分析 + 消除顺序标记）=====
    baseFillByElimOrder: true,   // 确定棋盘骨架后，基础填球按【目标图底→顶趋势=消除顺序】自顶向下顺序填入(先消除的盒放顶部先可达)；关=旧交错随机铺盒
    elimOrderScatterPercent: 5,  // 基础顺序填入【之后】的单色交错扰动比例：随机把富余色少量盒与远处盒【换位】(守恒,只换位置)制造暂存压力；0=纯顺序不打散
    // ===== 目标图消除入口模式（ANT-GEN-BOTTOM-ONLY-20260729）=====
    // false(默认)：四边入口——v95 既有行为，本字段引入前后完全一致。旧方案 JSON 无此字段时也按 false。
    // true ：仅底部入口——目标图上/左/右三边视作封闭，只能从底边开始向内消除。
    //   开启后本关【全链路同一口径】：底部依赖盒切分(baseFillBoxesBottom) → 候选筛选(1遍基础+3遍噪声)
    //   → 卡点分支重求解 → 三步前瞻可达 → 暂存自动释放 → 锁链滞留 → 管道推出后消除
    //   → 最终全知求解 → 玩家模拟 → 审核与难度。
    //   【棋盘取盒方向不改】：棋盘仍按原有暴露/障碍/管道/冰/锁链规则取盒，只有目标图消除入口变了。
    //   生产前会先跑 checkBottomEntryFeasibility 判源图在该规则下是否全图可达，不可达直接不进候选。
    bottomOnly: false,
    // ===== 第三种玩法模式：四方向瞬时连锁消除（需求 08.03，用户 2026-08-03 批准）=====
    // false(默认)：走原有两种模式，行为与本字段引入前完全一致；旧方案 JSON 无此字段时也按 false。
    // true ：四方向瞬时连锁消除。与 bottomOnly 互斥（本模式固定四方向可达，不接受底部单入口）。
    //   开启后本关【全链路同一口径】：四方向盒切分 → 候选筛选(1遍基础+3遍噪声) → 卡点分支重求解
    //   → 三步前瞻 → 暂存自动释放(严格先进先得) → 全知求解 → 玩家模拟 → 审核与难度。
    //   结算差异只在「怎么选像素」：每轮快照当前可达同色全集，按离该订单暂存起点的距离近优先，
    //   消到订单剩余容量为止，目标图整体刷新后再重扫下一轮（详见 simulator.instantChainEliminate）。
    instantChain: false,
    // ===== 生产前置碎色闸门（任务 ANT-GEN-FRAGMENT-GATE-20260824，用户 2026-08-24 批准）=====
    // fragmentMaxRate：目标图碎色率上限。**0 = 关闭**（默认，行为与本参数引入前完全一致）。
    //   >0 时在 produceFixed 生成候选【之前】判定：碎色率超过该值 → 直接跳过该源图，
    //   返回 level:null + lastFailReason:'fragmentGateBlocked'，不消耗时间预算、不造假关。
    // 标定依据（08-24 实测，上线 345 关按碎色率四等分）：
    //   Q1 上界 0.1516 → 好关率 38.5%（各档最高）、严重差关率 1.3%
    //   Q2 上界 0.1879 → 好关率 32.1%、严重差关率 11.5%
    //   Q3 上界 0.2253 → 好关率 23.1%      Q4 上界 0.3336 → 好关率 24.7%
    // ⚠ 取 0.1516 很严格：上线 345 关仅 24.8% 能过，200 新图仅 4.0%（8/200），347 修复批 15.3%。
    //   放宽到 0.1879 时：200 新图 18.5%、347 修复 33.4%。请按产能需要权衡。
    //
    // ⚠⚠ 【2026-08-25 口径变更：小色块 ≤10 → ≤7（用户「放宽给到小于8」）】
    //   上面那套四等分标定是在 smallMax=10 下做的，口径一变即失效。已按新口径重标定
    //   （`_kiro临时/08.25-碎色口径重标定/_重标定small7.js`，同一批 344 关、同一份线上好差关标签）：
    //
    //   分布：中位 0.1892 → 0.1453，平均下降 4.32 个百分点（判碎的像素变少）
    //   新口径四等分：Q1≤0.1147 好关率32.6%/严重差3.5% ← 好关率最高档
    //                 Q2≤0.1450 29.1%/9.3%   Q3≤0.1719 24.4%/11.6%   Q4≤0.2653 22.1%/12.8%
    //   新口径五等分：L1≤0.1054 33.8%/1.5%   L2≤0.1342 32.4%/8.8%   L3≤0.1557 27.9%/11.8%
    //                 L4≤0.1797 20.6%/10.3%  L5 20.8%/13.9%
    //   全样本基础率：好关 27.0% / 差关 31.7%
    //
    //   各阈值在【新口径】下的过闸率与过闸集表现（344 关）：
    //     15.16% → 55.5%（好关 30.4% / 差关 23.6% / 严重差 6.3%）｜旧口径同阈值仅 25.3%
    //     18.00% → 79.1%（好关 28.7% / 差关 27.9% / 严重差 8.1%）｜旧口径 43.0%   ← 当前采用
    //     20.47% → 91.3%（好关 27.7% / 差关 29.6% / 严重差 8.0%）｜旧口径 60.8%
    //   ⚠ 18% 过闸集的好关率 28.7% 已接近基础率 27.0%，说明**新口径下 18% 筛选力很弱**。
    //     要保持"好关率最高档上界"的原始设计强度，新口径对应值是 0.1147。
    //     这属于阈值裁决，未擅自改动——18% 是用户明确定的值。
    //
    // 【当前采用 0.18】用户 2026-08-25 裁决：「给到 18% 作为碎色率上限」。
    //   该值写在 UI 默认值（bin/index.html 的 #gen-frag-max = 18），**本字段仍是 0 = 闸门关闭**，
    //   阈值一律由调用方/UI 给，不在 DEFAULT_CONFIG 里硬开闸门（否则脚本调用会被意外过滤）。
    //   ⚠ 修图工具（关卡图修改工具/js/fragment.js）的碎色率检查用的是【同一个值、同一套口径】，
    //     改这里的口径或那边的默认阈值，两边必须一起改 —— 否则会出现
    //     「工具告诉美术已达标、生产端照样把图卡掉」。同步义务见 关卡图修改工具/bin/来源说明.md。
    fragmentMaxRate: 0,
    // 碎色口径参数——**改任一项都会使上面的阈值失效**，非必要不要动。
    // 【2026-08-25 变更】用户裁决：「把小色块要求放宽给到小于 8」→ fragmentSmallMax 10 → 7
    //   （"小于 8" 即像素数 ≤ 7）。这回到了用户 08-24 的原始定义
    //   「连通大于3小于8的色块定义为小色块……连通大于8的标记为正常色块」。
    //   ⚠ 该变更使 08-24 基于 smallMax=10 标定的阈值失效，已按新口径重新标定，见上方阈值段。
    fragmentIsoMax: 1,        // 孤立块：像素数 ≤ 此值
    fragmentSmallMax: 7,      // 小色块上限（"小于8"即 ≤7）；> 此值为正常块。簇总量 > 此值时整簇改判正常
    fragmentBarrierPx: 3,     // 隔断像素数上限（目标图填满，故与曼哈顿距离等价，差 ±1）
    fragmentBarrierKinds: 1,  // 隔断颜色种类上限；与 Px 取 AND：又杂又厚才算隔开
    // ===== 卡点体系类型化（ANT-GEN-CHOKE-TYPES-20260824，用户 2026-08-24 批准）=====
    // 改动前只有两个卡点分派分支（60% 换球 / 40% 增容），实测 344 关结构指纹仅 24 种、最常见 5 种占 65.7%。
    // 现在把卡点显式类型化，每关按配额抽取【互不重合】的若干类型；BOSS 与普通关分别配额。
    //
    // ⚠ 默认全部为 0 = 一个类型都不抽 → 各处走原有行为，与本功能引入前**完全一致**。
    //   要启用就把想用的类型权重调成 >0，并把下面两个数量设成 >0。
    chokeTypeCountNormal: 0,  // 普通关每关抽几种卡点类型（0=不启用类型化）
    chokeTypeCountBoss: 0,    // BOSS 关每关抽几种（用户要求③：BOSS 与普通关分别设定）
    // 各类型的抽取权重（0 或缺省 = 不参与抽取）。加权无放回抽样 → 同关内类型不重合（用户要求②）。
    chokeTypes: {
      iceCluster: 0,        // 数字冰簇聚集：同样数量的冰改为聚集铺，局部形成长时间锁死区
      chainCluster: 0,      // 锁链簇聚集（新）：允许锁链组之间 8-邻接，多组同时索要暂存空位
      questionCluster: 0,   // 问号聚集（新）：形成"一片看不清"的区域，只影响玩家判断不改可解性
      chainIce: 0,          // 数字冰叠锁链：给锁链成员定向叠冰，空间锁 + 时间锁串联
      pipeChain: 0,         // 管道口叠锁链（新）：锁链锚在管道出口格，锁住管道吐球节奏
      // 【v120】窄路进池（用户 2026-08-27 q1「将窄路不作为默认开启的单独参数，正常接入卡点类型里面」）
      narrowPath: 0,        // 窄路墙+缺口本身。抽中才建窄路；缺口数由 narrowPathGapsMin/Max 决定
      narrowGapIce: 0,      // 窄路口叠数字冰（v120 起真正按抽中生效，不再恒开）
      narrowGapChain: 0,    // 窄路口叠锁链（同上）
      bigBox: 0,            // 超大盒（chokeInflate；v120 起容量用绝对区间 bigBoxCap*，并优先最少像素色）
      rareColorKey: 0,      // 稀有色占关键位（换入窄路口/管道口/锁链端，目标位可配 rareColorTargets）
      swap: 0,              // 换球/藏管道（现有手段，纳入类型体系以便统计与配额）
      inflate: 0            // 增容（v120 起：随机给 N 个盒各加 M 容量）
    },
    // ===== v120 逐类参数化（用户 2026-08-27 q2 逐条口径）=====
    // 默认值由 `_kiro临时/08.28-卡点类型参数化/_实验-默认值标定.js` 实测标定，见文档 §8g。
    // ① 数字冰簇：用【四方向 BFS 连通块】度量，「相邻就是最近」。参数 = 每簇数字冰数（含链式传递）
    iceClusterSizeMin: 4,
    iceClusterSizeMax: 6,
    iceClusterSeeds: 0,       // （兼容保留）团数；0=按簇大小自动推算 ceil(总冰数/簇大小)
    // ② 锁链簇：N 个锁链组聚成一簇（四方向相邻）。同时记录 BFS 平均距离作为度量
    chainClusterGroupsMin: 2,
    chainClusterGroupsMax: 3,
    // ③ 问号簇：直接用「到簇中心的 BFS 距离阈值」
    questionClusterRadius: 2,
    questionClusterSeeds: 0,  // （兼容保留）团数；0=按半径自动推算
    // ④ 数字冰叠锁链：叠 1 端 / 叠 2 端（端 = 组内度 ≤1 的成员）
    chainIceEnds: 1,
    chainIcePerGroup: 1,      // （兼容保留）v120 起由 chainIceEnds 决定，本值仅作上限兜底
    chainIceGroups: null,     // chainIce：最多处理几组（null=一半的组）
    // ⑥ 窄路口叠数字冰：叠 N 个冰（从缺口格起沿可用盒格 BFS 取 N 格）
    narrowGapIceCount: 2,
    // ⑧ 超大盒：容量【绝对区间】，取代原倍率口径；选盒优先「总像素最少的颜色」
    // 默认 80~110 由实验定：90~130 时玩家通关率从 4/4 掉到 2/4（超大盒确实压通关），
    // 120~170 更是一次卡点都没形成；80~110 通关 4/4 且仍能形成卡点。
    bigBoxCapMin: 80,
    bigBoxCapMax: 110,
    bigBoxMulMin: 1.5,        // （兼容保留）仅当 bigBoxCap* 为 null 时回退到倍率口径
    bigBoxMulMax: 2.0,
    // ⑨ 稀有色占关键位：目标位类型，逗号分隔（narrowGap / pipeExit / chainEnd）
    rareColorTargets: 'narrowGap,pipeExit,chainEnd',
    rareColorTopN: 3,         // 取最稀有的前 N 色作为换入源
    rareColorSwapCount: 3,    // 一次最多把几个关键位换成稀有色
    // ⑪ 增容：随机给 N 个盒各加 M 容量
    // 默认 N=1 / M=30 由实验定：同样的总加量下，**集中加在一个盒上**比分散到 2~4 个盒有效得多 ——
    // hasChoke 与合格都是 3/4，而 N=2/M=15 与 N=4/M=10 都只有 1/4，且三者产出与通关同为 4/4。
    inflateBoxCount: 1,
    inflateAmount: 30,
    // ===== 卡点组合出现的进度位置（用户 q2 末句，默认 15%~80%）=====
    // 口径：按填盘序（= 目标图消除序）把棋盘盒格排成一条进度轴，卡点手段只落在该区间内。
    // 与合格门的 [30%,100%] 是两件事：这里是「卡点造在哪」，那里是「压力峰出现在哪」。
    chokePosMin: 0.15,
    chokePosMax: 0.80,
    // （已退役）窄路口两项曾默认恒开，此开关用于改为按类型门控。v120 起按类型门控成为唯一行为，
    // 本值仅保留读取以兼容旧方案；卡点类型化未启用时走旧的 narrowPath/narrowPathProb 口径。
    chokeGateNarrowByType: false,
    // 由批量调度逐关透传：本关是否按 BOSS 规格生产。produce 是单关函数、自身不知批次位置。
    isBossSlot: false,
    // ===== 【v139】数字冰数值规则（老冰下线后，生成器放的冰一律是数字冰）=====
    // 数值 = 该盒的「自然进度位次」+ 延后量。
    //   · 自然进度位次 = 该盒在盒队列里的消除序（_seq，0~总盒数-1）——即"按正常打法它大概第几步被取走"。
    //   · 延后量 = 总盒数 × numIceDelayPct%。取 0 表示"到点就化"（形同虚设）；取太大则关卡会被锁死。
    // 实测（真实产出关，76 盒 / 14 格冰）：+0/+2/+5/+10 盒全部可通关，+15 盒即两个求解器都过不了。
    // 因此默认 10% 偏保守；要更狠就往上调，生成器的求解器闸门会淘汰被锁死的候选。
    numIceDelayPct: 10,
    // 数值硬上限比例：数值一律不超过 floor(总盒数 × 本值)，保证"总能减到 0"（永不变成死墙）。
    // 【v296】默认改为 null（= 走自动上限 ceil(总盒数×iceCapRatio) 夹 [3,12]）。
    //   原来默认 100 → 上限 = 总盒数−1（36 盒 → 35），于是 _seq(0~35) + delay(≈4) 直接产出
    //   25~30 的冰值，实测 bindStat.ice.values = [29,25,30,27]，关卡里几乎每块冰都是 20 多。
    //   想回到"按总盒数百分比"的旧口径，把它设成数字（如 100）即可。
    numIceCapPct: null
  };

  /**
   * 【v139】给某格的数字冰算数值（老冰下线后唯一的放冰口径）。
   *   数值 = clamp(_seq + 延后量, 1, 总盒数-1)；_seq 缺失时按 0 处理（= 最早）。
   *   在【绑定阶段】调用：此时棋盘已铺好、管道的盒也已就位，_seq 仍然保留（清理在绑定之后）。
   * @param {Array} cells  棋盘（含管道）
   * @param {number} rows
   * @param {number} cols
   * @param {number} r
   * @param {number} c
   * @param {object} config
   * @returns {number} 数字冰数值（≥1；保证 < 总盒数，因此一定能减到 0）
   */
  function numIceValueFor(cells, rows, cols, r, c, config) {
    var box = cells[r] && cells[r][c];
    if (!box || box.t !== 'box') return AntSolver.NUMICE_MIN || 1;
    var total = 0;
    for (var rr = 0; rr < rows; rr++) {
      for (var cc = 0; cc < cols; cc++) {
        var x = cells[rr][cc];
        if (!x) continue;
        if (x.t === 'box') total++;
        else if (x.t === 'pipe') total += (x.queue ? x.queue.length : 0);
      }
    }
    if (total <= 1) return 1;
    var pct = (config && config.numIceDelayPct != null) ? config.numIceDelayPct : 10;
    var delay = Math.round(total * Math.max(0, Math.min(60, pct)) / 100);
    var seq = (box._seq != null) ? box._seq : 0;
    // 【v296】上限口径统一：原来默认 capPct=100% → hi = 总车数−1（36 车 → 上限 35），
    //   于是 seq(0~35) + delay(≈4) 直接产出 25~30 的冰值 —— 这就是"冰全是 20 多"的真正来源。
    //   实测（工作日志 220 节）bindStat.ice.values = [29,25,30,27]，全部来自这里（窄路缺口冰）。
    //   改为与 iceValueFor 同一把尺子：上限 = ceil(总车数 × iceCapRatio)，缺省 25%，夹 [3,12]。
    //   仍保留 numIceCapPct 显式覆盖的能力（设了就按它算，但不超过 total−1）。
    var capRatio = (config && config.iceCapRatio != null) ? +config.iceCapRatio : 0.25;
    if (!(capRatio > 0)) capRatio = 0.25;
    var _capAuto = Math.max(3, Math.min(12, Math.ceil(total * capRatio)));
    var hi;
    if (config && config.numIceCapPct != null) {
      hi = Math.floor(total * Math.max(1, Math.min(100, +config.numIceCapPct)) / 100);
      hi = Math.max(1, Math.min(hi, total - 1));
    } else {
      hi = _capAuto;
    }
    // 【v296·关键】冰值 = 把「自然位次 seq」**按比例映射到 [2, hi] 区间**，而不是直接 seq + delay。
    //
    //   为什么必须映射：seq 的范围是 0~总盒数−1（36 盒 → 0~35），而 hi 现在只有 11。
    //   直接 seq + delay 会让几乎所有格子都 ≥ hi → 全部顶到上限 11，冰值又回到"一模一样"。
    //   实测（工作日志 220 节）：改完上限后 bindStat.ice.values = [11,11,11,11] —— 正是这个原因。
    //
    //   映射后：靠前取的盒子冰值小（2~4），靠后取的冰值大（接近 hi），冰值随位置连续变化，
    //   同时保留原语义"这辆车被锁到它大致该被取走的时刻"（位次越后 → 锁得越久）。
    // 【v297·修】改按**时差**算，不再按位次比例。
    //
    //   为什么位次比例不行：实测（工作日志 222 节）同一关里 4 块窄路缺口冰的 _seq 是 5/6/7/8 这种连续值，
    //   映射到 [2,hi] 后全部落在同一档 → 冰值仍然是 [6,6,6,5] / [8,8,8,8]。
    //   **位次相近的格子 → 冰值必然相近**，这是映射本身的性质，改系数救不了。
    //
    //   正确口径（与 `applyIceSchedule` 的同步模式同源）：冰值 = 这辆车"要等多久"
    //     gap = r(色,容量) − 该车被点到的进度
    //   其中 r 来自 demandCurve（目标图剥离序），s 用 _seq/总车数的位次近似。
    //   于是同一关里不同颜色、不同容量的车会得到**不同的 gap** → 不同的冰值。
    var _dcv = config && config._demandCurve;
    var _gapV = -1;
    if (_dcv && _dcv.curve) {
      try {
        var _rNeed = demandAt(_dcv, box.color, box.count);
        var _sProg = total > 1 ? (seq / (total - 1)) : 0;
        _gapV = _rNeed - _sProg;
      } catch (e) { _gapV = -1; }
    }
    var _loBound = AntSolver.NUMICE_MIN || 2;
    var _hiBound = Math.max(_loBound, hi);
    var v;
    if (_gapV >= 0) {
      // 有时差：走与同步模式同一个 iceValueFor（含 iceScaleCoef / iceCapRatio 两个旋钮）
      v = iceValueFor(_gapV, total, config);
      // 原 delay 语义（"按自然位次再往后推一点"）保留一点点，但不再主导
      if (delay > 0) v = Math.min(_hiBound, v + Math.max(0, Math.round(delay / 4)));
    } else {
      // 没有需求曲线时退回位次比例（旧行为）
      var _posSpan = Math.max(1, total - 1);
      var _posRatio = Math.max(0, Math.min(1, seq / _posSpan));
      v = Math.round(_loBound + _posRatio * (_hiBound - _loBound));
    }
    return Math.max(AntSolver.NUMICE_MIN || 1, Math.min(v, _hiBound));
  }

  /**
   * 从目标图生成关卡（主入口）
   * config._deadlineAt(内部用，由 produce() 透传，非 UI 参数)：绝对时间戳(ms)。
   *   每轮"建棋盘+6遍求解"本身不可中断，但重试循环(至多 maxRetries 轮)会在【每轮开始前】检查此
   *   deadline，一旦超时立即停止再开新一轮重试(至少已跑完1轮，不会一次都不跑)——避免单次调用
   *   把 produce() 的总时间预算顶爆到"5倍单轮耗时"那么多。
   */
  /* ── 生产性能埋点(阶段1，只计数不改策略) ────────────────────────────
   * 回答"单关慢在建盘、求解、玩家模拟还是分支数量"，供性能报告与后续提速决策(阶段6)用。
   * 纯累加计数/计时 + 停止原因，不参与任何候选选择、审核、难度或预算判定，行为完全等价。
   * 由 produce() 在每关开始时 resetGenPerf()，结束时把快照挂到返回结果的 perf 字段。
   */
  var GENPERF = newGenPerf();
  function newGenPerf() {
    return {
      generateCalls: 0,   // generateFromBlocks 调用次数(基础候选 + 压力调整重生成)
      boardBuilds: 0,     // 建盘次数(含内部重试)
      pipeRebuilds: 0,    // 管道深度超限重铺次数
      baseCandidates: 0,  // 基础候选数
      chokeVariants: 0,   // 卡点变体数
      regenVariants: 0,   // 走"压力调整重新建盘"的变体数
      evalCalls: 0,       // evaluateGeneration 次数(含玩家模拟)
      boardMs: 0,         // 建盘累计毫秒
      evalMs: 0,          // 生成评价累计毫秒(含玩家模拟)
      totalMs: 0,         // 单关 produce 总毫秒
      prefilterRejects: 0, // 【v317】贪心粗筛淘汰的「太松」候选数
      stopReason: ''      // 停止原因：pass_early_stop / budget_timeout / exhausted / no_candidate
    };
  }
  function resetGenPerf() { GENPERF = newGenPerf(); }
  function getGenPerf() { var o = {}; for (var k in GENPERF) o[k] = GENPERF[k]; return o; }

  /**
   * 【v317·用户裁决】贪心粗筛：只砍「太松」，绝不砍「太难」。
   *   用户原话：「难度要看全知求解器的峰值，贪心是模拟随手选的。如果随手选个 10 步左右
   *   一直暂存 ≤1，那就不用浪费时间了，太简单了」。
   *   所以：
   *     · 只看【前 10 步】的暂存峰值：全程 ≤1 → 这关随手玩都压不住，直接淘汰，省掉 25s 精算；
   *     · 贪心早死 / 解不完 **不作为**难度信号（难度一律以全知峰窗为准），这里绝不因此淘汰。
   *   返回 null = 有希望继续精算；返回 {maxBuf, steps} = 太松。
   */
  function greedyPrefilter(parsed, config, stepsN) {
    try {
      if (config && config.greedyPrefilter === false) return null;
      var K = stepsN || 10;
      var r = AntSolver.Solver.solve(parsed, {
        capturePreviewStats: false, greedyOnly: true, timeBudgetMs: 400,
        bottomOnly: !!(config && config.bottomOnly), instantChain: !!(config && config.instantChain)
      });
      GENPERF.prefilterChecks = (GENPERF.prefilterChecks || 0) + 1;
      var tr = (r && r.stepBufferHistory) || [];
      if (tr.length < K) { GENPERF.prefilterShort = (GENPERF.prefilterShort || 0) + 1; return null; }   // 走不满 10 步 → 没有判断依据
      // 【v322·实测否决 v318 的单条件版】按"前 10 步 ≤1 就丢"跑一批：
      //   unnamed-10-20-189 这张 40×40 图 —— 检查 17 次、淘汰 16 次（94%），
      //   候选 42 秒就穷尽，直接掉进「遍历完兜底」，用户选了 8 分钟也只跑了 42 秒。
      //   原因：中段有压力的关，开局 10 步照样可能是 0~1（用户自己那张图前 10 步全是 0、后期峰 5）。
      //   恢复 v317 的三条件（缺一不判松），并把两个数带出去供日志/排查。
      var mx10 = 0, mxAll = 0;
      for (var j = 0; j < K; j++) if (tr[j] > mx10) mx10 = tr[j];
      for (var i = 0; i < tr.length; i++) if (tr[i] > mxAll) mxAll = tr[i];
      if (!r.completed) return null;                 // 贪心走不完 = 中后期有压力，不判松
      if (mx10 <= 1 && mxAll <= 2) return { maxBuf: mxAll, front10: mx10, steps: tr.length, completed: true };
    } catch (e) { }
    return null;
  }

  function generateFromBlocks(blocks, config) {
    config = Object.assign({}, DEFAULT_CONFIG, config || {});
    // 【v344·修】generateFromBlocks 原来不设 seed（只有 produce/produceFixed 设），
    //   导致任何直接调用它的验证脚本 seed 全是废的、结果不可复现。
    //   加 _seedOnce 开关：验证脚本显式传 true 才重置，避免影响 produce 内部重试的多样性。
    if (config.seed != null && config._seedOnce) seedRng(config.seed);
    GENPERF.generateCalls++;                       // 埋点：generateFromBlocks 调用次数(基础候选 + 压力调整重生成)
    var rows = blocks.length, cols = blocks[0].length;
    var deadlineAt = config._deadlineAt || 0;

    var lastLevel = null, lastResult = null, lastParsed = null, curCfg = config, lastVariant = null;
    for (var retry = 0; retry < config.maxRetries; retry++) {
      if (retry > 0 && deadlineAt && Date.now() >= deadlineAt) break;   // 超时：停止再开新一轮重试(已完成的轮次仍返回)
      // 1) 生成盒序列：默认按【目标图底→顶趋势=消除顺序】切分(baseFillBoxes)，
      //    关闭开关时回退旧的“贪心可达最多色”序(solverGuidedBoxes)。盒的 elimSeq=消除顺序下标。
      //    bottomOnly 时改走底部依赖流分支(baseFillBoxesBottom)——D2：旧流程一并对齐。
      var boxes = pickBoxSplit(blocks, curCfg);
      // 2) 确定棋盘骨架(尺寸+障碍/墙/管道) → 基础填球按消除顺序顺序填入 → 再执行后续铺盒扰动
      GENPERF.boardBuilds++;                       // 埋点：建盘次数(含每次重试)
      var _tb = Date.now();
      var board = null;
      // 【v355·用户裁决】行优先盘走【运行时筛选】：摆几套锁链位置 → 各跑求解+玩家模拟 → 留能过的那套。
      //   锁链对 5 槽盘太敏感，一次成型算不稳（v354 实测 6 种子达标率 4/6）。
      if (curCfg && curCfg.boardLayout === 'rowMajor' && curCfg.rowMajorAutoFilter !== false) {
        var _var = pickRowMajorVariant(blocks, curCfg, boxes);
        if (_var && _var.board) { board = _var.board; lastVariant = _var; }
      }
      if (!board) board = buildBoard(boxes, curCfg);
      GENPERF.boardMs += Date.now() - _tb;
      // 【v301·用户裁决】把"数字冰 + 第0行同色限量"接进**旧流程**（原工程路径）。
      //   旧流程只有随机冰（icePercent），没有时间锁；这里补上：
      //   ① 用 demandCurve 算时差 → applyIceSchedule 按时差锁；
      //   ② diversifyRow0 保证第 0 行不同色扎堆。
      try {
        if (curCfg && (curCfg.iceSchedule || curCfg.row0ColorMax)) {
          if (!curCfg._demandCurve) curCfg._demandCurve = demandCurveOf(blocks);
          if (board && board.cells) {
            applyIceSchedule(board.cells, board.rows, board.cols, curCfg);
            diversifyRow0(board.cells, board.rows, board.cols, curCfg);
            // 【v328】第 0 行免费车配额（暴力但直接：开局菜单里最多留 N 辆"点了就能吃满"的车）
            var _r0f = limitRow0Free(board.cells, board.rows, board.cols, blocks, curCfg);
            if (_r0f) board.row0FreeStat = _r0f;
          }
        }
      } catch (e) { /* 补救失败不影响出关 */ }
      // P1b 兜底：管道每管超过深度上限(容量错位，多因随机尺寸偏小→溢出过多而可达约束下放不下足够管道)。
      //   先重随机尺寸重试(buildBoard 内尺寸随机)；仍超则增大盒容量→减少盒数→减溢出。重新分盒仍守恒。
      //   只重铺盒(不含求解)，代价低；采用兜底后的配置供后续诊断/减负一致。
      //   深度上限原写死 6，现取 config.pipeMaxDepth（默认 6，等价原行为）。
      var pbCfg = curCfg, pbTry = 0;
      while (maxPipeDepth(board) > pipeDepthOf(pbCfg) && pbTry < 5) {
        pbTry++;
        GENPERF.pipeRebuilds++;                    // 埋点：管道深度超限触发的重铺次数
        if (pbTry >= 2) pbCfg = Object.assign({}, pbCfg, {
          boxSizeMin: (pbCfg.boxSizeMin || 40) + 3, boxSizeMax: (pbCfg.boxSizeMax || 56) + 3
        });
        var boxesR = pickBoxSplit(blocks, pbCfg);
        board = buildBoard(boxesR, pbCfg);
      }
      curCfg = pbCfg;
      if (curCfg.semanticObstacles) {
        try { applySemanticObstacles(board, blocks, curCfg); } catch (e) { }
      }

      var level = { blocks: blocks, bufferLimit: curCfg.bufferLimit, board: board };
      var parsed = AntSolver.parseLevel(level);
      var sdc = structuralDeadlockCheck(board);   // 结构性卡死检验(锁链可激活/盒可达)
      // 【v317·用户裁决】贪心粗筛：前 10 步随手玩都压不出暂存 → 太松，40ms 判掉，不花 25s 精算。
      //   注意方向：只淘汰"太容易"，**不**因为贪心解不完而淘汰（难度以全知峰窗为准）。
      // 【v350·用户裁决】exposeCut（暴露顺序模式）**跳过**这道筛：
      //   该模式的设计目标就是让玩家顺着目标图吐料节奏走，前期必然压不出暂存（实测玩家 8/8 通关），
      //   被"太容易"判掉等于永远产不出关。难度压力留给后续加障碍那一版解决。
      var _pre = (curCfg.cutMode === 'exposeCut' || curCfg.skipGreedyPrefilter)
        ? null : greedyPrefilter(parsed, curCfg);
      if (_pre) {
        GENPERF.prefilterRejects = (GENPERF.prefilterRejects || 0) + 1;
        return {
          level: level, valid: false, solveResult: null, difficulty: 0, config: curCfg, retries: retry,
          structural: sdc, prefilterTooEasy: _pre, reason: 'tooEasyGreedy'
        };
      }
      // 基础棋盘首解：6 遍求解(贪心×2→树×2→噪声×2, 任一遍解出即停)获得 pickOrder 与可解性确认。
      // 入口模式随 config 透传（D2：旧流程一并对齐底部模式）。
      var result = AntSolver.Solver.solve(parsed, { capturePreviewStats: true, bottomOnly: !!curCfg.bottomOnly, instantChain: !!curCfg.instantChain });
      lastLevel = level; lastResult = result; lastParsed = parsed;

      // 合格 = 结构无卡死 且 求解器可通关
      try { level.board.routeLockEntry = { sdcOk: !!(sdc && sdc.ok), completed: !!(result && result.completed), reason: (sdc && sdc.reason) || null }; } catch (e) { }
      if (sdc.ok && result.completed) {
        // 【v453】生成时 Route Lock：前10步换 partial + 锁替代，再重解
  function applyGenerationRouteLock(level, config, sr) {
    if (!level || !sr || !sr.pickOrder || !sr.pickOrder.length) return { tries: [{ reason: 'no level/sr' }] };
    var parsed0 = AntSolver.parseLevel(level);
    var cv0 = choiceCurve(parsed0, sr);
    if (!cv0 || !cv0.steps) return { tries: [{ reason: 'no cv' }] };
    var po = sr.pickOrder.slice().sort(function (a, b) { return (a.step || 0) - (b.step || 0); });
    function plain(r, c) {
      var x = level.board.cells[r] && level.board.cells[r][c];
      return x && x.t === 'box' && !x.chain && !x.numice && !x.q;
    }
    var exp = {};
    try {
      var oe = openingExposure(level.blocks, level.board.rows, level.board.cols, false);
      if (oe && oe.detail) for (var oi = 0; oi < oe.detail.length; oi++) exp[oe.detail[oi].color] = oe.detail[oi].px;
    } catch (e) { }
    var deep = [];
    for (var pi = 0; pi < po.length; pi++) {
      var p = po[pi], prog = pi / Math.max(1, po.length - 1);
      if (prog >= 0.40 && prog <= 0.70 && plain(p.r, p.c)) deep.push(p);
    }
    if (!deep.length) return { tries: [{ reason: 'no deep' }] };
    deep.sort(function (a, b) {
      return ((b.count || 0) - (exp[b.color] || 0)) - ((a.count || 0) - (exp[a.color] || 0));
    });
    var best = null, bestScore = (cv0.earlyPeak10 || 0) * 100 - (cv0.earlyFree10 || 0) * 10;
    var tried = 0, tries = [];
    for (var si = 0; si < Math.min(10, cv0.steps.length) && tried < 4; si++) {
      var st = cv0.steps[si];
      if (!(st.full >= 2 && st.free >= 3)) continue;
      if (!st.pick || !plain(st.pick.r, st.pick.c)) continue;
      var alts = (st.moves || []).filter(function (m) {
        return m.full && plain(m.r, m.c) && !(m.r === st.pick.r && m.c === st.pick.c);
      });
      if (!alts.length) continue;
      // 【v455】同一段：所有 full 替代都锁；两种模式：换 pick / 锁 pick 本身
      for (var mode = 0; mode < 2 && tried < 4; mode++) {
        tried++;
        var d = deep[0];
        if (mode === 0 && d.r === st.pick.r && d.c === st.pick.c) continue;
        var lv = JSON.parse(JSON.stringify(level));
        var a = lv.board.cells[st.pick.r][st.pick.c];
        if (mode === 0) {
          var b = lv.board.cells[d.r][d.c];
          if (!a || !b || a.t !== 'box' || b.t !== 'box') continue;
          lv.board.cells[st.pick.r][st.pick.c] = b;
          lv.board.cells[d.r][d.c] = a;
        } else {
          if (!a || a.t !== 'box' || a.chain || a.numice || a.q) continue;
          a.numice = 1;   // 直接锁第一格
        }
        var _altLocked = 0;
        for (var ai = 0; ai < alts.length; ai++) {
          var altCell = lv.board.cells[alts[ai].r][alts[ai].c];
          if (altCell && altCell.t === 'box' && !altCell.chain && !altCell.numice) { altCell.numice = 1; _altLocked++; }
        }
        var p2 = null, sr2 = null, cv2 = null;
        try {
          p2 = AntSolver.parseLevel(lv);
          sr2 = AntSolver.Solver.solve(p2, { capturePreviewStats: true, bottomOnly: !!config.bottomOnly, instantChain: !!config.instantChain });
          if (sr2 && sr2.completed) cv2 = choiceCurve(p2, sr2);
        } catch (e) { }
        if (!cv2) { tries.push({ step: si, mode: mode, pick: [st.pick.r, st.pick.c], deep: [d.r, d.c], alts: alts.length, locked: _altLocked, completed: false, reason: 'unsolved' }); continue; }
        var sc = (cv2.earlyPeak10 || 0) * 100 - (cv2.earlyFree10 || 0) * 10;
        tries.push({ step: si, mode: mode, pick: [st.pick.r, st.pick.c], deep: [d.r, d.c], alts: alts.length, locked: _altLocked, completed: true, free: cv2.earlyFree10, peak: cv2.earlyPeak10, score: sc, beforeScore: bestScore });
        if (sc > bestScore) {
          lv.routeLock = { step: si, mode: mode, pick: [st.pick.r, st.pick.c], deep: [d.r, d.c], alts: alts.length, locked: _altLocked,
            before: { free: cv0.earlyFree10, peak: cv0.earlyPeak10 }, after: { free: cv2.earlyFree10, peak: cv2.earlyPeak10 } };
          best = { level: lv, parsed: p2, sr: sr2, cv: cv2, score: sc, info: lv.routeLock };
          bestScore = sc;
        }
      }
    }
    if (best) best.tries = tries;
    return best || { tries: tries };
  }

  // 【v450】生成时 Early：先解一次，把前10步第一选择换 partial，再解一次；只保留更优
        // 【v453】Route Lock：换 partial + 锁替代，再重解
        var _rlTries = null, _rlInfo = null;
        if (curCfg.semanticRouteLock) {
          try {
            var _rl = applyGenerationRouteLock(level, curCfg, result);
            if (_rl && _rl.tries) { _rlTries = _rl.tries; level.board.routeLockTry = _rl.tries; }
            if (level.board.routeLockEntry) level.board.routeLockEntry.routeRan = true;
            if (_rl && _rl.score > ((choiceCurve(parsed, result).earlyPeak10 || 0) * 100 - (choiceCurve(parsed, result).earlyFree10 || 0) * 10)) {
              level = _rl.level; parsed = _rl.parsed; result = _rl.sr;
              _rlInfo = _rl.info; level.board.routeLock = _rl.info;
            }
          } catch (e) { }
        }
        if (curCfg.semanticEarly) {
          var _seTry = { applied: false, reason: null, attempts: [] };
          try {
            level.board.semanticEarlyTry = _seTry;
            var _bestLv = null, _bestP = null, _bestSr = null, _bestScore = -1e9;
            for (var _ew = 0; _ew < 3; _ew++) {
              var _lvE = applyGenerationEarly(level, curCfg, result, _ew);
              if (!_lvE) { _seTry.attempts.push({ which: _ew, reason: 'no swap' }); continue; }
              var _pE = null, _srE = null;
              try {
                _pE = AntSolver.parseLevel(_lvE);
                _srE = AntSolver.Solver.solve(_pE, { capturePreviewStats: true, bottomOnly: !!curCfg.bottomOnly, instantChain: !!curCfg.instantChain });
              } catch (e2) { _srE = null; }
              if (!_srE || !_srE.completed) { _seTry.attempts.push({ which: _ew, reason: 're-solve failed' }); continue; }
              var _cvE = choiceCurve(_pE, _srE);
              var _ef = _cvE && _cvE.earlyFree10 != null ? _cvE.earlyFree10 : 99;
              var _ep = _cvE && _cvE.earlyPeak10 != null ? _cvE.earlyPeak10 : 0;
              var _sc = _ep * 100 - _ef * 10;
              _seTry.attempts.push({ which: _ew, free: _ef, peak: _ep, score: _sc });
              if (_sc > _bestScore) { _bestScore = _sc; _bestLv = _lvE; _bestP = _pE; _bestSr = _srE; }
            }
            if (_bestLv) {
              var _cv0 = choiceCurve(parsed, result);
              var _ef0 = _cv0 && _cv0.earlyFree10 != null ? _cv0.earlyFree10 : 99;
              var _ep0 = _cv0 && _cv0.earlyPeak10 != null ? _cv0.earlyPeak10 : 0;
              _seTry.before = { free: _ef0, peak: _ep0 };
              _seTry.after = { free: _cv0 && _bestP ? choiceCurve(_bestP, _bestSr).earlyFree10 : null, peak: _cv0 && _bestP ? choiceCurve(_bestP, _bestSr).earlyPeak10 : null };
              if (_bestScore > _ep0 * 100 - _ef0 * 10) {
                level = _bestLv; parsed = _bestP; result = _bestSr;
                _seTry.applied = true; _seTry.reason = 'accepted improved';
              } else _seTry.reason = 'not better';
            } else _seTry.reason = 'no viable variant';
          } catch (e) { _seTry.reason = 'error:' + ((e && e.message) || e); }
        }
        // 【v457】routeLockTry 挂到最终 level（semanticEarly 可能替换过 level）
        if (_rlTries) { try { level.board.routeLockTry = _rlTries; } catch (e) { } }
        if (_rlInfo) { try { level.board.routeLock = _rlInfo; } catch (e) { } }
        // 注：基础阶段不做换球(v86 起)——基础候选到此直接采用；换球只在【卡点B支】(chokeSwap)定向执行，
        //   进入 produce() 的候选树后，未合格候选才会展开卡点分支。
        var generationEval = evaluateGeneration(result, parsed, curCfg);
        var difficulty = computeDifficulty(result, parsed, curCfg, generationEval);
        return {
          level: level, valid: true, solveResult: result, difficulty: difficulty,
          generationEval: generationEval, config: curCfg, retries: retry, structural: sdc
        };
      }
      // 未通关 → 重试减负。优先削【结构/压力】(窄路/黑块 = 真正的不可解元凶)，
      // 【尽量保住冰块/锁链】(轻障碍，一般不是不可解主因；玩家反馈冰块过少)：仅在后段retry才轻削。
      // 注：换球为解后处理，不参与重试削减。
      var late = retry >= 2;
      // 【同比缩放接入点②】原逻辑对 icePercent 逐轮 ×0.9 **累乘**，
      //   15% 经约 30 轮 → 0.6%，再经 Math.floor(boxTarget × pct/100) 就是 0 个冰格 ——
      //   即权重分最低的冰块最先被整项抹除。开启后改为各项按自身归一分等比例让分并带保底。
      if (config.proportionalDifficultyAdjust && late) {
        var prr = scaleDifficultyProportional(curCfg, 0.9, config.proportionalFloorRatio);
        curCfg = Object.assign({}, prr.cfg, {
          narrowPath: curCfg.narrowPath && retry < Math.max(1, Math.floor(config.maxRetries * 0.4))
        });
      } else {
      curCfg = Object.assign({}, curCfg, {
        blackPercent: late ? (curCfg.blackPercent || 0) * 0.85 : curCfg.blackPercent, // 结构：后段才削
        icePercent: late ? (curCfg.icePercent || 0) * 0.9 : curCfg.icePercent,          // 冰：后段轻削
        chainCount: late ? Math.floor((curCfg.chainCount || 0) * 0.85) : curCfg.chainCount, // 链：后段轻削
        // 窄路墙较早撤掉(结构性不可解主因)
        narrowPath: curCfg.narrowPath && retry < Math.max(1, Math.floor(config.maxRetries * 0.4))
      });
      }
    }

    var difficulty2 = computeDifficulty(lastResult, lastParsed, curCfg);
    var sdc2 = lastLevel && lastLevel.board ? structuralDeadlockCheck(lastLevel.board) : { ok: false, reason: '无有效关卡' };
    return { level: lastLevel, valid: false, solveResult: lastResult, difficulty: difficulty2, config: curCfg, retries: config.maxRetries, structural: sdc2 };
  }

  /**
   * 生成随机目标图关卡（无TXT输入时使用）
   */
  function generate(config) {
    config = Object.assign({}, DEFAULT_CONFIG, config || {});
    var size = config.mapSize || 12;
    var colorCount = config.colorCount || 4;
    var blocks = generateTargetMap(size, colorCount, config.pattern || 'blob');
    return generateFromBlocks(blocks, config);
  }

  // ==================== 消除层次分析 ====================

  function analyzeEliminationLayers(blocks, rows, cols) {
    var layers = AntSolver.create2D(rows, cols, -1);
    var eliminated = AntSolver.create2D(rows, cols, false);
    var dirs = [[-1,0],[1,0],[0,-1],[0,1]];

    // 空格初始已消除
    for (var r = 0; r < rows; r++)
      for (var c = 0; c < cols; c++)
        if (blocks[r][c] <= 0) { eliminated[r][c] = true; layers[r][c] = 0; }

    var currentLayer = 1;
    var changed = true;

    while (changed) {
      changed = false;
      var layerCells = [];
      // 从底部向上扫描（与消除方向一致）
      for (var r = rows-1; r >= 0; r--) {
        for (var c = 0; c < cols; c++) {
          if (eliminated[r][c] || blocks[r][c] <= 0) continue;
          var reachable = (r === 0 || r === rows-1 || c === 0 || c === cols-1);
          if (!reachable) {
            for (var d = 0; d < dirs.length; d++) {
              var nr = r + dirs[d][0], nc = c + dirs[d][1];
              if (nr < 0 || nr >= rows || nc < 0 || nc >= cols || eliminated[nr][nc]) { reachable = true; break; }
            }
          }
          if (reachable) layerCells.push({r: r, c: c});
        }
      }
      if (layerCells.length > 0) {
        for (var i = 0; i < layerCells.length; i++) {
          eliminated[layerCells[i].r][layerCells[i].c] = true;
          layers[layerCells[i].r][layerCells[i].c] = currentLayer;
        }
        currentLayer++;
        changed = true;
      }
    }
    return { layers: layers, maxLayer: currentLayer - 1 };
  }

  // ==================== 蚂蚁盒队列生成（容量自洽） ====================

  function generateQueues(blocks, layerInfo, config) {
    // 采用"求解引导式"生成：模拟实际的贪心消除过程，记录真实的蚂蚁盒序列。
    // 这保证了生成的关卡必然可解（按序单队列消费时暂存区始终为空）。
    var allBoxes = solverGuidedBoxes(blocks, config);

    // 轮流分配到队列
    var queues = [];
    for (var q = 0; q < config.queueCount; q++) queues.push([]);
    for (var i = 0; i < allBoxes.length; i++) {
      queues[i % config.queueCount].push({ color: allBoxes[i].color, count: allBoxes[i].count });
    }
    return queues;
  }

  // ==================== 棋盘构建（元素区） ====================
  var MAX_PIPE_DEPTH = 6; // 复用 bin：管道最大深度（默认值；实际取值见 pipeDepthOf）

  // 管道容量口径取值（任务 ANT-GEN-PIPE-DEPTH-FALLBACK-20260825）。
  //   config 缺省或非法时回落到原常量，保证「不传参 = 原行为」。
  function pipeDepthOf(config) {
    var v = config && config.pipeMaxDepth != null ? parseInt(config.pipeMaxDepth, 10) : MAX_PIPE_DEPTH;
    // 【v386·用户裁决】单条管道最多 4 辆车：无论配置写多大，这里硬夹到 4。
    if (!(v > 0)) v = MAX_PIPE_DEPTH;
    if (v > 4) v = 4;
    if (!(v > 0)) v = MAX_PIPE_DEPTH;
    return v;
  }
  // 单管最少装几个盒（决定 P ≤ ⌊D/pipeMinFill⌋）。不得超过深度上限，否则区间必空。
  function pipeMinFillOf(config) {
    var v = config && config.pipeMinFill != null ? parseInt(config.pipeMinFill, 10) : 4;
    if (!(v > 0)) v = 1;
    var d = pipeDepthOf(config);
    return v > d ? d : v;
  }

  /**
   * 把有序盒序列(按消除顺序)铺到 9×(9-19) 棋盘，并放置障碍/管道。
   * 盒子自顶向下按消除顺序铺格 → 顶部解锁顺序天然匹配可解顺序（保证基础可解）。
   * 溢出盒 + 用户指定管道 → 底部管道(出口朝上)按顺序滴放。
   */
  /**
   * 在配置的行列范围内选能容纳 n 个盒的最小棋盘（行列均受控）；放不下则用最大尺寸(溢出走管道)。
   */
  // P1：在行列参数范围内【随机】选一个组合（尺寸参数应与目标图匹配）。
  // 溢出盒由管道守恒吸收(每管容量4~6)；若容量严重错位(装不下/空太多)，由上层盒容量兜底调整。
  // 注：n 保留为入参（供未来"随机但保容量下限"的兜底判断）。
  function chooseBoardDims(n, config) {
    var rMin = clampInt(config.boardRowsMin, AntSolver.BOARD_ROWS, 3, 20);
    var rMax = clampInt(config.boardRowsMax, AntSolver.BOARD_ROWS, rMin, 20);
    var cMin = clampInt(config.boardColsMin, AntSolver.BOARD_COLS_MIN, 3, 30);
    var cMax = clampInt(config.boardColsMax, AntSolver.BOARD_COLS_MAX, cMin, 30);
    var rows = rMin + Math.floor(rnd() * (rMax - rMin + 1));
    var cols = cMin + Math.floor(rnd() * (cMax - cMin + 1));
    // ===== 管道数量下限保证（用户 2026-08-04：管道太少，要确保不低于 4 个）=====
    // 管道数由守恒反推：溢出盒 D = 盒数 n − (格数 − 黑块)，管道数下界 = ⌈D/5⌉（每管容量 4~6）。
    // 因此「管道数 ≥ minPipes」等价于「D ≥ minPipes×5」，即棋盘格数有一个上限：
    //     格数 ≤ (n − minPipes×5) / (1 − 黑块占比)
    // 这正是用户说的「缩小基础棋盘来增加管道」——把它做成可计算的硬约束，而不是靠调参碰。
    // minPipes 默认 0（不约束），原两种模式行为完全不变。
    var minPipes = parseInt(config.minPipes, 10) || 0;
    if (minPipes > 0 && n > 0) {
      var blackFrac = Math.min(0.25, (config.blackPercent || 0) / 100);   // 黑块另有 25% 上限
      var maxCells = Math.floor((n - minPipes * 5) / (1 - blackFrac));
      var feasible = [];
      for (var rr = rMin; rr <= rMax; rr++) {
        for (var cc = cMin; cc <= cMax; cc++) {
          if (rr * cc <= maxCells) feasible.push({ rows: rr, cols: cc });
        }
      }
      if (feasible.length) {
        // 可行组合里随机取，保留原有的尺寸随机性，只是把过大的尺寸剔除
        var pickIdx = Math.floor(rnd() * feasible.length);
        rows = feasible[pickIdx].rows; cols = feasible[pickIdx].cols;
      } else {
        // 参数范围内没有任何尺寸能满足下限（盒数太少或范围下限太大）→ 取范围内最小面积，尽力而为。
        // 这种情况说明「盒容量太大导致盒数不足」，需要调小容量而不是继续缩棋盘，交由上层与验证脚本暴露。
        rows = rMin; cols = cMin;
      }
    }
    return { rows: rows, cols: cols };
  }

  function clampInt(v, def, lo, hi) {
    v = parseInt(v, 10);
    if (isNaN(v)) v = def;
    if (v < lo) v = lo;
    if (v > hi) v = hi;
    return v;
  }

  /** 预留黑块后，检查所有空(未来盒)格是否仍从顶部可达（black/pipe 阻挡）。 */
  function nullCellsReachable(cells, rows, cols) {
    var vis = AntSolver.create2D(rows, cols, false);
    var q = [];
    function passable(cell) { return cell == null; } // 只有空格(未来盒)可通行
    for (var c = 0; c < cols; c++) if (passable(cells[0][c])) { vis[0][c] = true; q.push([0, c]); }
    var dirs = [[-1,0],[1,0],[0,-1],[0,1]];
    for (var h = 0; h < q.length; h++) {
      var r = q[h][0], cc = q[h][1];
      for (var d = 0; d < dirs.length; d++) {
        var nr = r + dirs[d][0], nc = cc + dirs[d][1];
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols || vis[nr][nc]) continue;
        if (passable(cells[nr][nc])) { vis[nr][nc] = true; q.push([nr, nc]); }
      }
    }
    for (var r2 = 0; r2 < rows; r2++) for (var c2 = 0; c2 < cols; c2++) {
      if (cells[r2][c2] == null && !vis[r2][c2]) return false;
    }
    return true;
  }

  /**
   * 【v350·用户裁决】行优先摆盘：车单第 1 辆放 (0,0)、第 2 辆放 (0,1)……
   *
   * 为什么需要：棋盘只有第 0 行是入口，其余靠"邻接已消格"向下传导，
   *   所以【车的行号就是它大致的可点顺序】。配合 exposeCut 把车单排成目标图暴露序，
   *   就得到"越早暴露的颜色越靠上，玩家从上往下点，正好跟着目标图吐料的节奏走"。
   *
   * 实测反例（旧摆位，打散）：17 在目标图第 7 轮才露出，却被摆在 r0 开局就能点；
   *   15 在第 4 轮就露出，却压在 r3。暴露轮次与车行号相关系数只有 0.44 → 玩家 14% 就卡死。
   *
   * 本模式不铺管道/冰/锁链/问号（纯车 + 黑块），先把"顺序"这条主干立住。
   */
  /**
   * 【v356·用户裁决】混色预处理：让行优先盘看起来像正常关卡，而不是"一色一行"。
   *
   * 用户原话："你把这些球，按颜色顺序规规整整的从第1行往下摆，这完全不是一个正常的关卡，
   *           我想要的是这个棋盘上的车去引导玩家实现我想要的路径"
   *
   * 做法：车单顺序不变（仍按路线），但把【后面行】的一部分车提前掺进本行，等量换走本行的车。
   *   效果：每行主色仍占多数（60~70%），但混入少量"下一段才该出"的颜色当诱饵。
   *   玩家点诱饵会发现吃不满、卡槽，从而学会"先别碰它"——这就是靠供给引导，而不是靠排队强制。
   *
   * mixRate：每行被换掉的比例（默认 0.35）；0 = 退回原来的一色一行。
   * donorSpan：从后面第几行以内借车（默认 1，只看紧邻的下一行，避免掺进太远的颜色）。
   */
  function mixRowsOf(boxes, rows, cols, config) {
    var mixRate = (config && config.mixRate != null) ? +config.mixRate : 0.6;
    if (!(mixRate > 0) || rows < 2) return boxes;
    if (mixRate > 0.8) mixRate = 0.8;
    var N = boxes.length;
    var span = Math.max(1, parseInt(config.donorSpan, 10) || 1);
    // deepShare：诱饵取自车单末尾这一段的占比（默认 0.35 → 从后 35% 里挑"深层色"）
    var deepShare = (config && config.deepShare != null) ? +config.deepShare : 0.35;
    if (!(deepShare > 0) || deepShare > 0.8) deepShare = 0.35;
    var out = boxes.slice();
    // 【v357·用户裁决】分类：过渡色 = 车单最前面那几个颜色（公共外壳）；深层色 = 车单末尾一段。
    //   首行只放这两类 —— 过渡色让玩家有得点，深层色是"目标图上还消不掉"的诱饵。
    //   突破口色（路线里真正想引导的那个，位于车单中段）一律不在首行，等过渡色消掉后从下一层露出来。
    var transColors = {}, nTrans = 0;
    for (var ti = 0; ti < out.length && nTrans < 2; ti++) {
      if (!transColors[out[ti].color]) { transColors[out[ti].color] = 1; nTrans++; }
    }
    var deepFrom0 = Math.floor(out.length * (1 - deepShare));
    if (deepFrom0 >= out.length) deepFrom0 = out.length - 1;
    var deepColors = {};
    for (var di = deepFrom0; di < out.length; di++) deepColors[out[di].color] = 1;

    // 【v357·修】行区间必须按【每行格子数 cols】切，不能按 N/rows 平均分。
    //   原来 6×7 盘 27 辆车被算成"每行 4.5 辆"，导致"首行"实际是索引 0~3，
    //   而真正首行是 0~6 —— 索引 6 那个突破口色（17）就漏在首行没被清走。
    for (var r = 0; r < rows - 1; r++) {
      var start = r * cols, end = Math.min((r + 1) * cols, N);
      var len = end - start;
      if (len <= 1) continue;
      var nMix = Math.floor(len * mixRate);
      // 【v356b】第 0 行强制至少混 1 个异色 —— 那是玩家第一眼看到的一行，
      //   全一色会让"这是正常关卡"的第一印象直接崩掉。其余行按 mixRate 来。
      if (r === 0) nMix = Math.max(nMix, 1);
      // 【v357·用户裁决】诱饵只从【车单深处的颜色】里挑，不从紧邻的下一行借。
      //   用户原话："第一行也可能有突破口颜色，也可能有背景的过渡色，
      //              也可能有目标图深层无法消除的颜色"
      //   含义：首行应该是「过渡色 + 深层诱饵」，突破口色要等过渡色消掉后才从下一层露出来
      //         —— 那个"露出"本身就是引导。把突破口提前塞进首行，等于把答案先给了。
      var deepFrom = Math.floor(N * (1 - deepShare));
      if (deepFrom < end) deepFrom = end;
      if (deepFrom >= N) deepFrom = N - 1;
      // 【v357】优先换掉【本行占比最高的颜色】的位置 —— 只靠随机抽的话，
      //   6/7 都是同一个颜色时几乎抽不到同色位置，行看着还是"一色一行"。
      var rowCnt = {}, order2 = [];
      for (var ci2 = start; ci2 < end; ci2++) {
        var _cc = out[ci2].color;
        if (rowCnt[_cc] == null) { rowCnt[_cc] = 0; order2.push(_cc); }
        rowCnt[_cc]++;
      }
      order2.sort(function (a, b) { return rowCnt[b] - rowCnt[a]; });
      var slotPool = [];
      for (var oi = 0; oi < order2.length; oi++) {
        for (var ci3 = start; ci3 < end; ci3++) {
          if (out[ci3].color === order2[oi]) slotPool.push(ci3);
        }
      }
      for (var k = 0; k < nMix; k++) {
        if (deepFrom >= N) break;
        for (var attempt = 0; attempt < 12; attempt++) {
          var i = slotPool.length ? slotPool[(k + Math.floor(rnd() * slotPool.length)) % slotPool.length]
                                  : (start + Math.floor(rnd() * len));
          var j = deepFrom + Math.floor(rnd() * (N - deepFrom));
          if (i >= N || j >= N || i === j) continue;
          if (out[i].color === out[j].color) continue;
          var t = out[i]; out[i] = out[j]; out[j] = t;
          break;
        }
      }
      // 首行特别处理：把既不是过渡色、也不是深层色的（= 突破口 / 中段色）统统换到深层去
    }
    return out;
  }

  // 【v425】生成时构造“代价替代”：40~60% 相邻两格，较大车加冰1，较小车留作替代
  // 【v428】生成时预留小替代：同一颜色的 4 连块重新分配成 1 + 3 个大车
  function reserveSmallAlt(board, config) {
    if (!board || !board.cells) return null;
    var maxCap = parseInt(config && config.boxSizeMax, 10) || 40;
    var seen = {}, comps = [];
    function plain(x) { return x && x.t === 'box' && !x.chain && !x.numice && !x.q; }
    var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (var r = 0; r < board.rows; r++) for (var c = 0; c < board.cols; c++) {
      var st = board.cells[r][c];
      if (!plain(st) || seen[r + ',' + c]) continue;
      var color = st.color, q = [[r, c]], cells = [];
      seen[r + ',' + c] = 1;
      while (q.length) {
        var p = q.pop(); cells.push(p);
        for (var d = 0; d < dirs.length; d++) {
          var nr = p[0] + dirs[d][0], nc = p[1] + dirs[d][1], k = nr + ',' + nc;
          if (nr < 0 || nr >= board.rows || nc < 0 || nc >= board.cols || seen[k]) continue;
          var x = board.cells[nr][nc];
          if (!plain(x) || x.color !== color) continue;
          seen[k] = 1; q.push([nr, nc]);
        }
      }
      if (cells.length >= 4) comps.push({ color: color, cells: cells });
    }
    for (var ci = 0; ci < comps.length; ci++) {
      var cs = comps[ci].cells.slice(0, 4);
      var sum = 0;
      for (var k2 = 0; k2 < cs.length; k2++) sum += (board.cells[cs[k2][0]][cs[k2][1]].count || 0);
      if (sum - 1 > 3 * maxCap) continue;
      var rest = sum - 1, vals = [1];
      for (var vi = 0; vi < 3; vi++) {
        var v = Math.min(maxCap, Math.floor(rest / (3 - vi)));
        vals.push(v); rest -= v;
      }
      if (rest !== 0) continue;
      for (var ai = 0; ai < 4; ai++) board.cells[cs[ai][0]][cs[ai][1]].count = vals[ai];
      board.cells[cs[0][0]][cs[0][1]].numice = 1;
      return { color: comps[ci].color, cells: cs, counts: vals, sum: sum };
    }
    return null;
  }

  function injectCostlyAlt(board, config) {
    if (!board || !board.cells || !board.rows) return null;
    function plain(x) { return x && x.t === 'box' && !x.chain && !x.numice && !x.q; }
    // 1) 先找一辆真正的小车（不要求在压力点旁）
    var small = null;
    for (var sr = 0; sr < board.rows && !small; sr++) {
      for (var sc = 0; sc < board.cols; sc++) {
        var sx = board.cells[sr][sc];
        if (plain(sx) && (sx.count || 0) <= 15) { small = { r: sr, c: sc, cell: sx }; break; }
      }
    }
    if (!small) return null;
    // 2) 找 40~60% 的“大车 + 邻格”，把邻格换成小车
    var rLo = Math.floor(board.rows * 0.40), rHi = Math.ceil(board.rows * 0.60);
    var best = null, bestTrap = -1;
    for (var r = rLo; r <= rHi && r < board.rows; r++) {
      for (var c = 0; c < board.cols - 1; c++) {
        var a = board.cells[r][c], b = board.cells[r][c + 1];
        if (!plain(a) || !plain(b)) continue;
        var trap = (a.count >= b.count) ? a : b;
        var alt = (trap === a) ? b : a;
        var altPos = (trap === a) ? { r: r, c: c + 1 } : { r: r, c: c };
        if ((trap.count || 0) < 30) continue;
        if (altPos.r === small.r && altPos.c === small.c) continue;
        if ((trap.count || 0) > bestTrap) { bestTrap = trap.count; best = { trap: trap, altPos: altPos }; }
      }
    }
    if (!best) return null;
    // 3) 小车 ↔ 邻格大车交换；再给压力车加冰1
    var oldAlt = board.cells[best.altPos.r][best.altPos.c];
    board.cells[best.altPos.r][best.altPos.c] = small.cell;
    board.cells[small.r][small.c] = oldAlt;
    best.trap.numice = 1;
    return { r: best.altPos.r, c: best.altPos.c, trap: best.trap.color, alt: small.cell.color,
             trapCount: best.trap.count, altCount: small.cell.count, movedFrom: [small.r, small.c] };
  }

  function buildRowMajorBoard(boxes, config) {
    var n = boxes.length;
    if (!n) return null;
    // 【v353·撤回】试过把 minR 放开到 3（让 27 辆用 5×6=30 格、只补 3 个黑块），
    //   结果玩家从 8/8 掉到 0/8 —— 5×6 的可操作区域太窄，车挤在一起反而更容易卡死。
    //   保持用 boardRowsMin（默认 6）：27 辆上 6×7，多出来的补黑块，玩家能过。
    var minR = Math.max(3, parseInt(config.boardRowsMin, 10) || 3);
    var maxR = Math.max(minR, parseInt(config.boardRowsMax, 10) || 14);
    // 【v394】溢出优先加行：行优先摆盘也要允许比范围多 1 行，避免为了塞管道把盘做小。
    if (config.boardExpandOnOverflow) maxR += 1;
    var best = null;
    for (var r = minR; r <= maxR; r++) {
      for (var c = r + 1; c <= r + 2; c++) {
        if (r * c < n) continue;
        if (!best || r * c < best.rows * best.cols) best = { rows: r, cols: c };
      }
    }
    if (!best) {
      var s = Math.max(1, Math.ceil(Math.sqrt(n)));
      best = { rows: s, cols: Math.ceil(n / s) };
    }
    var rows = best.rows, cols = best.cols, cells = [];
    for (var rr = 0; rr < rows; rr++) cells.push(new Array(cols));
    // 【v356】混色：把后面行的车提前掺进本行，避免"一色一行"的排队感
    boxes = mixRowsOf(boxes, rows, cols, config);
    var i = 0;
    for (var r2 = 0; r2 < rows; r2++) {
      for (var c2 = 0; c2 < cols; c2++) {
        if (i < n) {
          var b = boxes[i];
          cells[r2][c2] = { t: 'box', color: b.color, count: b.count, chain: 0, q: false, numice: 0 };
          i++;
        } else {
          cells[r2][c2] = { t: 'black' };
        }
      }
    }
    var board = { rows: rows, cols: cols, cells: cells };

    // 【v353·用户裁决】行优先棋盘也铺锁链。
    //
    // 实测（006，上限60/浮动5，buffer 5，路线序）：
    //   不铺链           → 峰3 34档7%  玩家8/8
    //   绑"任意相邻异色"  → 峰3~4      玩家0/8（一组就死）
    //   只绑"容量≤均值"的相邻异色，中段行，非主色+主色配对
    //     → 2 组：峰5 34档22% 玩家8/8  ← 但同一个盘换个绑法就变 0/8，不稳
    //
    // 为什么必须绑小车：锁链是【捆绑】的，两辆必须一起拿、占 2 槽且退不掉。
    //   绑到大车 → 一辆就压住一格，再捆绑 → 2 格直接焊死，5 槽的盘必死。
    //   绑小车 → 拿进来就能吃满、立刻空出，锁链只增加"一次多拿"的节奏压力。
    // 默认【不铺】——实测同一布局换个绑法就在 8/8 与 0/8 之间跳，固定规则摆不稳。
    //   要试的话显式传 rowMajorChainCount（1 或 2），别用全局 chainCount（它是老流程的，默认 3）。
    // 【v354·负结果】默认【不铺】。6 种子实测：
    //   开 1 组 → 达标 4/6、峰均值 4.5、34档 15%
    //   关 0 组 → 达标 5/6、峰均值 4.0、34档 15%
    //   锁链只把峰均值抬了 0.5，却让达标率掉了 1/6 —— 不划算，默认关。
    //   要用显式传 rowMajorChainCount:1。
    var chainN = Math.max(0, parseInt(config.rowMajorChainCount, 10) || 0);
    var placedChains = 0, avgCap = 0;
    if (chainN > 0) {
      chainN = Math.min(chainN, 1);   // 【v354】多方案筛选：2 组直接让求解失败，故硬限 1 组
      var caps = [];
      for (var ar = 0; ar < rows; ar++) for (var ac = 0; ac < cols; ac++) {
        var _cx = cells[ar][ac];
        if (_cx && _cx.t === 'box') caps.push(_cx.count);
      }
      avgCap = caps.length ? (caps.reduce(function (a, b) { return a + b; }, 0) / caps.length) : 0;
      // 【v354】多方案筛选：固定放在 20%~50% 行区间、从上往下取第一处可用位置。
      //   试过用 rnd() 打乱行顺序，结果更差（006 六种子达标 2/6，固定顺序是 3/4）——已回退。
      //   ⚠ 这个位置仍有约 1/4 的种子会翻车（峰3、玩家0/8），根因是锁链位置对 5 槽盘太敏感。
      //   彻底解决要做【运行时筛选】：摆 N 套 → 各跑玩家模拟 → 只留 8/8 且峰≥4 的那套。
      var cLo = Math.floor(rows * 0.20), cHi = Math.ceil(rows * 0.50);
      // 【v355】_chainSeed 让不同方案从不同行开始找（运行时筛选需要产出多套候选）
      var _cs = parseInt(config._chainSeed, 10);
      if (!isNaN(_cs) && cHi >= cLo) {
        var _span = cHi - cLo + 1;
        cLo = cLo + (_cs % _span);
        cHi = cLo + _span - 1;
        if (cHi >= rows) { cHi = rows - 1; cLo = Math.max(0, cHi - _span + 1); }
      }
      var chainId = 0;
      for (var cr = cLo; cr <= cHi && placedChains < chainN; cr++) {
        if (cr >= rows) break;
        var rowCnt = {}, rowCols = [];
        for (var rc = 0; rc < cols; rc++) {
          var _bx = cells[cr][rc];
          if (_bx && _bx.t === 'box') {
            rowCnt[_bx.color] = (rowCnt[_bx.color] || 0) + 1;
            if (rowCols.indexOf(_bx.color) < 0) rowCols.push(_bx.color);
          }
        }
        if (!rowCols.length) continue;
        rowCols.sort(function (a, b) { return rowCnt[b] - rowCnt[a]; });
        var mainColor = rowCols[0];
        for (var cc2 = 0; cc2 < cols && placedChains < chainN; cc2++) {
          var nbx = cells[cr][cc2];
          if (!nbx || nbx.t !== 'box' || nbx.chain || nbx.color === mainColor || nbx.count > avgCap) continue;
          for (var dd = -1; dd <= 1; dd += 2) {
            var nc2 = cc2 + dd;
            if (nc2 < 0 || nc2 >= cols) continue;
            var mby = cells[cr][nc2];
            if (mby && mby.t === 'box' && !mby.chain && mby.color === mainColor && mby.count <= avgCap) {
              chainId++;
              nbx.chain = chainId; mby.chain = chainId; placedChains++;
              break;
            }
          }
        }
      }
    }

    var _costly = null;
    if (config && config.costlyAlt) {
      try { _costly = injectCostlyAlt(board, config); } catch (e) { _costly = null; }
    }
    board.rowMajorStat = { boxes: n, rows: rows, cols: cols, blanks: rows * cols - n,
      chains: placedChains, avgCap: Math.round(avgCap), costlyAlt: _costly };
    return board;
  }

  /**
   * 【v355·用户裁决】行优先盘的【运行时筛选】。
   *
   * 为什么需要：锁链对 5 槽的盘太敏感 —— 同一张盘换一组位置就能在 8/8 与 0/8 之间跳
   *   （v354 实测：12 套摆法里 4 套达标、2 组直接求解失败；换成 6 个种子达标率只有 4/6）。
   *   一次成型算不出稳定解，只能"摆几套、各跑一遍、留能过的"。
   *
   * 成本：每套 = 建盘(0.3s) + 贪心求解(0.1s) + 3 局玩家模拟(~1s)，默认 3 套约 3~4 秒。
   * 判定：玩家 3 局全过 **且** 全知峰 >= minPeak(默认 4) 就提前收工；否则取分数最高的一套。
   */
  function pickRowMajorVariant(blocks, config, boxes) {
    var N = Math.max(1, Math.min(6, parseInt(config.rowMajorPlans, 10) || 3));
    var minPeak = Math.max(0, parseInt(config.rowMajorMinPeak, 10) || 4);
    // 【v355】探针局数默认 8 —— 用 3 局筛过、结果正式跑 8 局时第 8 局翻车（实测 seed77），必须同口径
    var probeRuns = Math.max(1, Math.min(12, parseInt(config.rowMajorProbeRuns, 10) || 8));
    var chainWant = Math.max(0, parseInt(config.rowMajorChainCount, 10));
    if (isNaN(chainWant)) chainWant = 1;
    var best = null;
    for (var i = 0; i < N; i++) {
      // 第 0 套无链（保底），其余带 1 组锁链、从不同行开始
      var chainN = (i === 0) ? 0 : Math.min(1, chainWant);
      var cfg = Object.assign({}, config, { rowMajorChainCount: chainN, _chainSeed: i });
      var board = null;
      try { board = buildRowMajorBoard(boxes, cfg); } catch (e) { board = null; }
      if (!board) continue;
      var level = { blocks: blocks, bufferLimit: config.bufferLimit || 5, board: board };
      var parsed = null, sr = null;
      try {
        parsed = AntSolver.parseLevel(level);
        sr = AntSolver.Solver.solve(parsed, { greedyOnly: true, bottomOnly: !!config.bottomOnly, instantChain: !!config.instantChain });
      } catch (e) { continue; }
      if (!sr || !sr.completed) continue;
      var wins = 0;
      for (var k = 0; k < probeRuns; k++) {
        try {
          var rr = AntSolver.PlayerSim.run(parsed, { seed: 7 + k * 37, useItems: false, reviveCap: 0 });
          if (rr && (rr.won || rr.success)) wins++;
        } catch (e) { }
      }
      var score = wins * 1000 + (sr.maxBuffer || 0);
      if (!best || score > best.score) best = { level: level, board: board, solveResult: sr, score: score, wins: wins, peak: sr.maxBuffer, plan: i, chainN: chainN };
      if (wins >= probeRuns && (sr.maxBuffer || 0) >= minPeak) break;   // 全过且压力够 → 提前收工
    }
    if (best) {
      try {
        best.board.rowMajorStat.plan = best.plan;
        best.board.rowMajorStat.probeWins = best.wins + '/' + probeRuns;
        best.board.rowMajorStat.probePeak = best.peak;
      } catch (e) { }
    }
    return best;
  }

  function buildBoard(boxes, config) {
    // 【v350·用户裁决】行优先摆盘（配合 cutMode='exposeCut'）：车单顺序 = 自上而下。
    if (config && config.boardLayout === 'rowMajor') {
      try { var _rmb = buildRowMajorBoard(boxes, config); if (_rmb) return _rmb; } catch (e) { }
    }
    var n = boxes.length;
    // 【v301·修】旧流程原来用 chooseBoardDims（范围内**纯随机**选行列），
    //   结果常选出与盒数不匹配的大盘 → 填不满 → 事后裁行 → 出现 4×10 这种违反形态约束的盘。
    //   改成 chooseBoardDimsFixed：按"盒数 vs 可放格数"选盘，并强制 列−行 ∈ {1,2}。
    var dims = (config && config.boardUseFixedDims === false)
      ? chooseBoardDims(n, config)
      : chooseBoardDimsFixed(n, config);
    // 【v338·用户裁决】让棋盘"贴着车数"：选盘逻辑受可用率配额约束，28 辆车最小只能挑到
    //   5×7=35 格 → 剩 7 格没车 → 全被补成黑块压在底部（用户："为什么底部一堆黑块"）。
    //   这里在选完之后再收紧一步：只要"格数 − 车数 > 2"，就优先缩列、再缩行，
    //   同时守住 列−行 ≤ 2 与 行/列 ≥ 3。
    try {
      if (!config || config.tightBoard !== false) {
        var _guard = 0;
        while (dims.rows * dims.cols - n > 2 && _guard++ < 6) {
          var _r = dims.rows, _c = dims.cols, _done = false;
          var _ok = function (rr, cc) { var d = cc - rr; return d >= 1 && d <= 2 && rr >= 3 && cc >= 3 && rr * cc >= n; };
          if (_ok(_r, _c - 1)) { dims = { rows: _r, cols: _c - 1 }; _done = true; }
          else if (_ok(_r - 1, _c)) { dims = { rows: _r - 1, cols: _c }; _done = true; }
          if (!_done) break;
        }
      }
    } catch (e) { }
    var rows = dims.rows, cols = dims.cols;
    var cellCap = rows * cols;

    // ===== P1：管道数量由守恒反推 =====
    // 尺寸已在 chooseBoardDims 内随机。溢出盒数 D = 盒总量 − (格数 − 黑块) 由管道守恒吸收：
    // 每管最终容量 4~6 → 管道数 P∈[⌈D/5⌉,⌊D/3⌋]。

    // 空网格
    var cells = [];
    for (var r = 0; r < rows; r++) { var row = []; for (var c = 0; c < cols; c++) row.push(null); cells.push(row); }

    // 黑块（分散）目标数：占格；boxes 铺在其余格，溢出走管道（黑块与管道都减少普通格）
    var blackCount = Math.floor(cellCap * (config.blackPercent || 0) / 100);
    var blackCap = Math.floor(cellCap * 0.25);
    if (blackCount > blackCap) blackCount = blackCap;

    // ===== 窄路卡点：先在中后部行建黑块墙(留单一缺口)，制造"唯一可达"通道 =====
    // 墙体黑块是刻意结构，独立于分散黑块预算；缺口后续会加冰"临时锁路"。
    var narrowGaps = [];
    if (config.narrowPath && narrowPathHits(config)) narrowGaps = reserveNarrowWalls(cells, rows, cols, config);
    // 保护缺口【走廊】：管道/黑块不得占用缺口格及其正上/正下(唯一通道的咽喉)，否则活口开了也会被管道/黑块快速堵死。
    // 墙/管道共用窄路逻辑：管道也是墙(isWallAt 计入)，故管道既不能占走廊，其出口(吐球位)也不能落在走廊。
    var gapProtect = {};
    for (var wgi = 0; wgi < narrowGaps.length; wgi++) {
      var gr0 = narrowGaps[wgi].r, gc0 = narrowGaps[wgi].c;
      gapProtect[gr0 + ',' + gc0] = true;
      if (gr0 - 1 >= 0) gapProtect[(gr0 - 1) + ',' + gc0] = true; // 缺口正上(通道入口)
      if (gr0 + 1 < rows) gapProtect[(gr0 + 1) + ',' + gc0] = true; // 缺口正下(通道出口)
    }
    var wallBlacks = countCellsOfType(cells, 'black');

    // 分散黑块（补足到目标数之上；墙已占的算入总黑块，总黑块封顶 40% 格）
    var extraBlack = Math.max(0, blackCount - wallBlacks);
    var totalBlackCap = Math.floor(cellCap * 0.4);
    if (wallBlacks + extraBlack > totalBlackCap) extraBlack = Math.max(0, totalBlackCap - wallBlacks);

    // 管道数（守恒反推）：可用普通格 = cellCap - 总黑块；溢出盒 D=n-可用格 → 管道吸收(每管4~6)。
    var totalBlack = wallBlacks + extraBlack;
    var freeForBoxes = cellCap - totalBlack;
    var overflow = Math.max(0, n - freeForBoxes);   // D
    var pipeCount = pipeCountByConservation(overflow, config); // 每管最终容量 1+D/P ∈ [pipeMinFill, pipeMaxDepth]
    // 【v229】管道限量：默认最多 2 条（用户反馈：管道太多，可选路径被堵死）
    var _capPipes = parseInt(config.maxPipes, 10) > 0 ? parseInt(config.maxPipes, 10) : 2;
    var maxPipes = Math.max(1, Math.min(_capPipes, Math.floor((rows - 2) * cols / 3)));
    if (pipeCount > maxPipes) pipeCount = maxPipes; // 超上限则 clamp（此时个别管道会略超深度上限，由兜底/P1b 精调）
    if (overflow > 0 && pipeCount < 1) pipeCount = 1; // 有溢出必须至少1个管道兜底，避免丢盒

    // ===== 【v340·实验】通道模式：第 0 行留单一入口，第 1 行封 k 格 =====
    // 用"分散黑块"的预算来放，不改变总黑块数；放完若破坏空格可达则整体回滚。
    if (config.channelMode) {
      var _ec = clampInt(config.channelEntryCol, 0, 0, cols - 1);
      var _budget0 = extraBlack, _budget = extraBlack, _placed = [];
      for (var _c0 = 0; _c0 < cols && _budget > 0; _c0++) {
        if (_c0 === _ec || cells[0][_c0] != null) continue;
        cells[0][_c0] = { t: 'black' }; _placed.push([0, _c0]); _budget--;
      }
      var _k = Math.max(0, parseInt(config.channelK, 10) || 0);
      for (var _ci = 0; _ci < _k && _budget > 0; _ci++) {
        var _cc = (_ec + 1 + _ci) % cols;
        if (_cc === _ec || cells[1][_cc] != null) continue;
        cells[1][_cc] = { t: 'black' }; _placed.push([1, _cc]); _budget--;
      }
      if (!nullCellsReachable(cells, rows, cols)) {
        for (var _pi = 0; _pi < _placed.length; _pi++) cells[_placed[_pi][0]][_placed[_pi][1]] = null;
        _budget = _budget0;
      }
      extraBlack = _budget;
    }

    // 管道：分散在棋盘各处（非第0行、避开墙行），四方向随机(11上/12右/13下/14左)，出口须在盘内且为盒格。
    // 管道视作黑块永久占格（吐完球也不消失）。
    var pipeList = []; // [{r,c,dir}]
    var exitSet = {};  // 出口格 'r,c'
    if (pipeCount > 0) {
      // 管道靠后：候选行 [pStart, rows-2]。pStart = max(pipeRowStart默认3, round(rows×pipeRowBias)) → 偏底部。
      // 不在第0行/末行。小棋盘或候选不足时逐步上移 pStart 兜底(保证能放下目标管道数)。
      var pipeRowStart = clampInt(config.pipeRowStart, 3, 0, 30);
      var pipeBiasFrac = (typeof config.pipeRowBias === 'number') ? config.pipeRowBias : 0.35;
      var pStart = Math.max(pipeRowStart, Math.round(rows * pipeBiasFrac));
      if (pStart > rows - 2) pStart = rows - 2;
      if (pStart < 1) pStart = 1;
      function buildPipeCand(start) {
        var arr = [];
        for (var pr = start; pr < rows - 1; pr++) { for (var pcc = 0; pcc < cols; pcc++) { if (gapProtect[pr + ',' + pcc]) continue; arr.push({ r: pr, c: pcc }); } }
        return arr;
      }
      var pipeCand = buildPipeCand(pStart);
      while (pipeCand.length < pipeCount * 2 && pStart > 1) { pStart--; pipeCand = buildPipeCand(pStart); } // 候选不足则放宽起点
      var pipeSel = pickDispersed(pipeCand, pipeCount * 3, 2); // 多取候选，逐个验证方向/可达/形态
      for (var ps = 0; ps < pipeSel.length && pipeList.length < pipeCount; ps++) {
        var pcell = pipeSel[ps];
        if (cells[pcell.r][pcell.c] != null) continue;
        if (exitSet[pcell.r + ',' + pcell.c]) continue; // 管道格不可占用其他管道的出口
        if (wouldViolateWall(cells, rows, cols, pcell.r, pcell.c)) continue; // 管道也是墙，遵循形态约束
        var dir = choosePipeDir(cells, rows, cols, pcell.r, pcell.c, exitSet); // 出口去重
        if (dir < 0) continue;
        var dv = AntSolver.PIPE_DIRS[dir];
        var er = pcell.r + dv[0], ec = pcell.c + dv[1];
        if (gapProtect[er + ',' + ec]) continue; // 管道出口(吐球位)不得落在窄路走廊 → 避免持续吐球堵死活口
        cells[pcell.r][pcell.c] = { t: 'pipe', dir: dir, queue: [], next: 0 };
        if (!nullCellsReachable(cells, rows, cols)) { cells[pcell.r][pcell.c] = null; continue; }
        pipeList.push({ r: pcell.r, c: pcell.c, dir: dir });
        exitSet[er + ',' + ec] = true;
      }
    }

    // 黑块：分散预留（非第0行、非最后一行、非墙行、非管道格、非管道出口格），保证其余(未来盒)格顶部可达
    // 多余(分散)黑块尽量【远离已有墙/管道】：优先选四邻无墙的孤立格 → 避免贴着窄路墙堆叠、视觉上像刻意卡点。
    if (extraBlack > 0) {
      function wallNbrCount(r, c) {
        var n = 0, dd = [[-1,0],[1,0],[0,-1],[0,1]];
        for (var i = 0; i < 4; i++) if (isWallAt(cells, rows, cols, r + dd[i][0], c + dd[i][1])) n++;
        return n;
      }
      var looseCand = [], tightCand = [];
      for (var br = 1; br < rows - 1; br++) { for (var bc = 0; bc < cols; bc++) {
        if (cells[br][bc] == null && !exitSet[br + ',' + bc] && !gapProtect[br + ',' + bc]) {
          if (wallNbrCount(br, bc) === 0) looseCand.push({ r: br, c: bc }); // 四邻无墙=孤立(优先分散)
          else tightCand.push({ r: br, c: bc });                            // 贴墙(仅在孤立格不够时才用)
        }
      } }
      // 孤立格足够则只用孤立格(最大化分散、远离墙)；不足再补贴墙格
      // 分散系数：越大→越优先只用孤立(四邻无墙)格铺墙(更分散、避免堆成卡点线)。need 随系数降低。
      var wd = (typeof config.wallDisperse === 'number') ? Math.max(0, Math.min(1, config.wallDisperse)) : 0.6;
      var looseNeed = extraBlack * (2 - wd);   // wd=0→×2(原严格) wd=1→×1(尽量只用孤立格)
      var blackCand = (looseCand.length >= looseNeed) ? looseCand : looseCand.concat(tightCand);
      var blackSel = pickDispersed(blackCand, extraBlack * 2, 2);
      var placedBlack = 0;
      for (var bs = 0; bs < blackSel.length && placedBlack < extraBlack; bs++) {
        var bcell = blackSel[bs];
        if (cells[bcell.r][bcell.c] != null) continue;
        if (wouldViolateWall(cells, rows, cols, bcell.r, bcell.c)) continue; // 形态约束(2×2/直线>3)
        cells[bcell.r][bcell.c] = { t: 'black' };
        if (!nullCellsReachable(cells, rows, cols)) { cells[bcell.r][bcell.c] = null; continue; } // 破坏可达则撤销
        placedBlack++;
      }
    }

    // ===== 铺盒到棋盘骨架（此时尺寸/黑块/墙/管道骨架已就绪）=====
    // list：盒序列，_seq = 基础消除顺序(baseFillBoxes 的 elimSeq 优先，否则数组下标)。
    var list = [];
    for (var bi = 0; bi < boxes.length; bi++) list.push({ color: boxes[bi].color, count: boxes[bi].count, _seq: (boxes[bi].elimSeq != null ? boxes[bi].elimSeq : bi), due: boxes[bi].due });

    var singlePct = (typeof config.singleColorExtractPercent === 'number') ? config.singleColorExtractPercent : 5;
    var firstMult = (typeof config.firstRowRangeMultiplier === 'number') ? config.firstRowRangeMultiplier : 1;
    var nextMult = (typeof config.nextRowRangeMultiplier === 'number') ? config.nextRowRangeMultiplier : 1.1;

    function isEmptyPlaceable(r, c) { return cells[r][c] == null; }
    function placeBox(r, c, b) { cells[r][c] = { t: 'box', color: b.color, count: b.count, chain: 0, q: false, numice: 0, _seq: b._seq, _due: b.due }; }

    if (config.baseFillByElimOrder !== false) {
      // ===== 基础填球：按消除顺序(_seq)逐行左→右【单扫】填入；每格只扫一遍 =====
      // elimSeq 小(消除趋势靠前=目标图底部先消)的盒放棋盘顶部/先可达处；蚂蚁从首行取 → 先放先取先消。
      // 遇空格/管道出口→放普通盒；遇【管道本体】→ 填入其队列 1 个(单扫每格1次，故每管首遍恰得1个，必不满)。
      //
      // ===== 局部交错摆放（v114，任务 ANT-GEN-FILL-INTERLEAVE-20260827）=====
      // 问题：盒序 = 像素消除序（趋势最忠实），但同一颜色的连续盒逐行填入就变成「一行同色格」。
      //       实测已产出的底部消除批次：前 3 行最大同色簇中位 4 盒、极端 12 盒、最长横排同色 9 个。
      // 为什么改这一层：**聚集是棋盘相邻性的属性，与队列顺序无关**。改出盒顺序解决不了 ——
      //       盒是单色整批消耗，像素级交错无法打包进盒级投放（实测 boxParallelCount 从 1 到 ∞
      //       各项全持平，调 P 无效），且交错出盒会把严格按序回放的溢出率从 12.5% 推到 35%。
      // 做法：每个可放格从队列头部宽 W 的前瞻窗口里挑「颜色既不同于左邻、也不同于上邻」的盒。
      //       W 即位移上限 → 取盒顺序最多偏离 W 位，趋势不被打乱（实测平均位移 1.13）。
      //       窗口内全冲突则退而取窗口首个 —— 不卡住、不丢盒。
      // 裸盘实验（40 张）：旧路径+W=6 得 前3行最大同色簇 1.00 / 同色对 0 / 通关率 82.5% / 溢出 17.5%，
      //       同时优于「并行 P=5 不交错」（簇 2.00 / 对 2 / 65.0% / 35.0%）。W=3 不够，W=6/9/12 等效 → 取 6。
      // 管道入队不参与交错：管道队列不构成棋盘表面相邻，故那支仍按队列顺序取。
      list.sort(function (a, b) { return a._seq - b._seq; });
      var ilW = (config.fillInterleaveWindow != null) ? config.fillInterleaveWindow : 6;
      // 从 list 的 [fi, fi+W) 窗口里挑一个与左邻/上邻不同色的盒，返回其下标（挑不到返回 fi）。
      // 命中后调用方把它 splice 到 fi 位置再正常前进，从而只做局部换位、不改变整体顺序。
      function pickNonAdjacent(fi, r, c) {
        if (ilW <= 0) return fi;
        var leftCell = (c > 0) ? cells[r][c - 1] : null;
        var upCell = (r > 0) ? cells[r - 1][c] : null;
        var leftColor = (leftCell && leftCell.t === 'box') ? leftCell.color : -1;
        var upColor = (upCell && upCell.t === 'box') ? upCell.color : -1;
        if (leftColor < 0 && upColor < 0) return fi;      // 无约束，直接用队首
        var lim = Math.min(fi + ilW, list.length);
        for (var k = fi; k < lim; k++) {
          if (list[k].color !== leftColor && list[k].color !== upColor) return k;
        }
        return fi;                                        // 窗口内全冲突 → 退回队首，不卡住
      }
      var fi = 0;
      for (var frow = 0; frow < rows && fi < list.length; frow++) {
        for (var fcol = 0; fcol < cols && fi < list.length; fcol++) {
          var fcell = cells[frow][fcol];
          if (fcell == null) {
            var pk = pickNonAdjacent(fi, frow, fcol);
            if (pk !== fi) { var mv = list.splice(pk, 1)[0]; list.splice(fi, 0, mv); }
            placeBox(frow, fcol, list[fi++]);
          }
          else if (fcell.t === 'pipe') { fcell.queue.push({ color: list[fi].color, count: list[fi].count }); fi++; }
        }
      }
      list = list.slice(fi);   // 空位+管道各首遍1个后仍剩的盒 → 第二遍均匀填管道(下方)
      // 注：基础阶段不做任何换球/换位扰动(v86 起)——保持纯粹的消除顺序铺盒；换球只在【卡点B支】(chokeSwap)定向执行。
    } else {
      // ===== 旧：交错随机铺盒（对齐 bin 毛线 generateBaseElements）=====
      // 1) 单色抽取(~singlePct%)：把富余色的少量盒随机散布全盘 → 制造交错/暂存压力
      var colorCnt = {};
      for (var i0 = 0; i0 < list.length; i0++) colorCnt[list[i0].color] = (colorCnt[list[i0].color] || 0) + 1;
      var extract = [];
      for (var colorId in colorCnt) {
        if (colorCnt[colorId] <= 3) continue;
        var take = Math.ceil(colorCnt[colorId] * singlePct / 100);
        var idxs = [];
        for (var li = 0; li < list.length; li++) if (list[li].color === parseInt(colorId, 10)) idxs.push(li);
        for (var t = 0; t < take && idxs.length > 0; t++) {
          var pickI = Math.floor(rnd() * idxs.length);
          var listIndex = idxs[pickI];
          extract.push(list[listIndex]);
          list.splice(listIndex, 1);
          idxs.splice(pickI, 1);
          for (var q = 0; q < idxs.length; q++) if (idxs[q] > listIndex) idxs[q]--;
        }
      }
      if (extract.length > 0) {
        shuffle(extract);
        var allEmpty = [];
        for (var er = 0; er < rows; er++) for (var ec = 0; ec < cols; ec++) if (isEmptyPlaceable(er, ec)) allEmpty.push({ r: er, c: ec });
        shuffle(allEmpty);
        while (extract.length > 0 && allEmpty.length > 0) { var pos = allEmpty.shift(); placeBox(pos.r, pos.c, extract.shift()); }
        while (extract.length > 0) list.push(extract.shift()); // 放不下退回 list
      }

      // 2) 逐行(自顶向下)从 list 前部候选窗口随机取盒放置；窗口随行放大(×mult)
      var prevRemainder = 0;
      for (var elRow = 0; elRow < rows && list.length > 0; elRow++) {
        var emptyPos = [];
        for (var cc = 0; cc < cols; cc++) if (isEmptyPlaceable(elRow, cc)) emptyPos.push({ r: elRow, c: cc });
        if (emptyPos.length === 0) { prevRemainder = 0; continue; }
        var range = elRow === 0 ? Math.ceil(emptyPos.length * firstMult)
                                : Math.ceil(emptyPos.length * nextMult) + prevRemainder;
        var pr = pickFromCandidateRange(list, range, emptyPos.length);
        prevRemainder = pr.remainder;
        shuffle(emptyPos);
        for (var pi = 0; pi < pr.picked.length; pi++) placeBox(emptyPos[pi].r, emptyPos[pi].c, pr.picked[pi]);
      }
    }

    // 3) 溢出盒 → 管道：按 _seq 升序【均匀】分配，每管上限6(首遍已各1)；全满仍剩则均匀超载(管道数不足的兜底)
    if (list.length > 0 && pipeList.length > 0) {
      list.sort(function (a, b) { return a._seq - b._seq; });
      var PIPE_CAP = 6, li2 = 0;
      // 阶段一：在 ≤PIPE_CAP 约束下均匀 round-robin（避免堆到少数管道 → 消除单管畸深）
      var guard2 = list.length + pipeList.length + 2;
      while (li2 < list.length && guard2-- > 0) {
        var anyRoom = false;
        for (var pj = 0; pj < pipeList.length && li2 < list.length; pj++) {
          var pq = cells[pipeList[pj].r][pipeList[pj].c].queue;
          if (pq.length < PIPE_CAP) { pq.push({ color: list[li2].color, count: list[li2].count }); li2++; anyRoom = true; }
        }
        if (!anyRoom) break;
      }
      // 阶段二：所有管道已达上限仍有剩 = 管道实际放置数 < 守恒目标 → 均匀超载，避免单管畸深
      var pj2 = 0;
      while (li2 < list.length) {
        cells[pipeList[pj2].r][pipeList[pj2].c].queue.push({ color: list[li2].color, count: list[li2].count });
        li2++; pj2 = (pj2 + 1) % pipeList.length;
      }
      list = []; // 已全部入管道，清空 → 避免 packFull(3.5) 重复入队导致球数翻倍
    } else if (list.length > 0) {
      // 无管道兜底：填任意空位
      for (var fr = rows - 1; fr >= 0 && list.length > 0; fr--)
        for (var fc = 0; fc < cols && list.length > 0; fc++)
          if (isEmptyPlaceable(fr, fc)) placeBox(fr, fc, list.shift());
    }

    // 3.5) 填满棋盘(packFull)：残余空格 → 先用剩余盒填，仍有空格则转黑块(校验可达)，消除空洞。
    if (config.packFull) {
      for (var qr = 0; qr < rows && list.length > 0; qr++)
        for (var qc = 0; qc < cols && list.length > 0; qc++)
          if (isEmptyPlaceable(qr, qc)) placeBox(qr, qc, list.shift());
      // 仍有盒(管道也满/无) → 尽量塞入任一管道队列，避免丢盒
      if (list.length > 0 && pipeList.length > 0) {
        for (var lk = 0; lk < list.length; lk++)
          cells[pipeList[lk % pipeList.length].r][pipeList[lk % pipeList.length].c].queue.push({ color: list[lk].color, count: list[lk].count });
        list = [];
      }
      // 残余空洞 → 黑块(遵循形态约束+不在第0/末行+不破坏可达)；封顶总黑块≤45%格。
      var blackCapFull = Math.floor(rows * cols * 0.45);
      for (var hr = 1; hr < rows - 1; hr++) for (var hc = 0; hc < cols; hc++) {
        if (cells[hr][hc] == null) {
          if (countCellsOfType(cells, 'black') >= blackCapFull) break;
          if (wouldViolateWall(cells, rows, cols, hr, hc)) continue;   // 形态约束(2×2/直线>3)
          cells[hr][hc] = { t: 'black' };
          if (!isAllBoxesReachable(cells, rows, cols)) cells[hr][hc] = null; // 破坏可达则保留为空(极少)
        }
      }
    }

    // ===== 窄路"推理陷阱"：把部分【早序】盒调到墙下(被 gated)区域 =====
    // 机制：墙下区域仅经缺口可达且缺口加冰锁住 → 早色所需的盒被暂时锁在墙下，
    // 玩家被迫先取墙上方的【晚序】盒(其色此刻多不可消) → 暂存累积 → 必须推理"先腾暂存/推进解冻再开缺口"。
    if (config.narrowPath && config.narrowPathTrap !== false && narrowGaps.length > 0) {
      applyNarrowTrap(cells, rows, cols, narrowGaps, config);
    }

    // 窄路缺口加数字冰：临时锁住唯一通道，玩家须先在墙上方腾挪(推进倒计时)再下探。
    // 在 placeBoardObstacles 之前设置，使问号放置自动避开缺口(保持缺口语义清晰)。
    // 【v139】数值走 numIceValueFor（按该盒自然进度位次 + 延后量），不再写死老冰耐久 3。
    if (config.narrowPath && config.narrowPathIce !== false) {
      for (var ngi = 0; ngi < narrowGaps.length; ngi++) {
        var gcell = cells[narrowGaps[ngi].r][narrowGaps[ngi].c];
        if (gcell && gcell.t === 'box') gcell.numice = numIceValueFor(cells, rows, cols, narrowGaps[ngi].r, narrowGaps[ngi].c, config);
      }
    }

    // 缺口锁链(横竖/三连)：用锁链辅助阻拦喉口。成员只取【墙带及以上】(r<=缺口行)的盒，
    // 避免把锁链成员放到墙下(需先开缺口才能激活 → 死锁)。锁链组号用高位(90+)避免与常规链冲突。
    if (config.narrowPath && config.narrowPathChain !== false && narrowGaps.length > 0) {
      var dirs8 = [[-1,0],[0,-1],[0,1]]; // 正交(上/左/右)，不含斜向、不含正下(避免拉入墙下)
      var chGroup = 90, chained = {};
      for (var cgi = 0; cgi < narrowGaps.length; cgi++) {
        var g = narrowGaps[cgi];
        var gc0 = cells[g.r][g.c];
        if (!gc0 || gc0.t !== 'box' || chained[g.r + ',' + g.c]) continue;
        var members = [{ r: g.r, c: g.c }];
        var size = (rnd() < 0.5) ? 3 : 2;
        var guard = 0;
        while (members.length < size && guard++ < 20) {
          var grew = false;
          for (var mi = 0; mi < members.length && !grew; mi++) {
            var order = shuffle(dirs8.slice());
            for (var d = 0; d < order.length; d++) {
              var nr = members[mi].r + order[d][0], nc = members[mi].c + order[d][1];
              if (nr < 0 || nr > g.r || nc < 0 || nc >= cols) continue;   // 只在墙带及以上
              var ncell = cells[nr][nc];
              if (!ncell || ncell.t !== 'box' || chained[nr + ',' + nc]) continue;
              var dup = false;
              for (var mm = 0; mm < members.length; mm++) if (members[mm].r === nr && members[mm].c === nc) { dup = true; break; }
              if (dup) continue;
              members.push({ r: nr, c: nc }); grew = true; break;
            }
          }
          if (!grew) break;
        }
        if (members.length >= 2 && !chainGroupConflict(cells, rows, cols, members, chGroup) && chainActivatable(cells, rows, cols, members)) { // 不同组不相邻 + 全成员可激活(防结构卡死)
          for (var mk = 0; mk < members.length; mk++) { cells[members[mk].r][members[mk].c].chain = chGroup; chained[members[mk].r + ',' + members[mk].c] = true; }
          chGroup++;
        }
      }
    }

    // ===== 输出前确保棋盘填满：未填满则强制减少最末行、多余球补充为管道 =====
    var ef = ensureBoardFull(cells, rows, cols, pipeList);
    rows = ef.rows; cols = ef.cols; cells = ef.cells;

    // 铺盒阶段的临时 _seq 标记清除（不写入关卡数据）
    for (var sr = 0; sr < rows; sr++) for (var sc = 0; sc < cols; sc++) {
      if (cells[sr][sc] && cells[sr][sc].t === 'box') delete cells[sr][sc]._seq;
    }

    placeBoardObstacles(cells, rows, cols, config);

    // 顶部 1-3 行(索引0/1/2)障碍密度封顶（默认≤20%）：优先清 问号→冰→锁链整组→黑块转空，管道不动
    enforceTopObstacleCap(cells, rows, cols, config);

    // 清除孤立锁链：chain 值仅 1 个成员的盒无互锁语义（求解器 chainGroups 只收≥2组，孤立会致 listMoves 崩）
    //   → 降级为普通盒；同时避免导出到程序端出现"单成员共链"歧义。
    var chainCnt = {};
    for (var ccr = 0; ccr < rows; ccr++) for (var ccc = 0; ccc < cols; ccc++) {
      var cbox = cells[ccr][ccc];
      if (cbox && cbox.t === 'box' && cbox.chain > 0) chainCnt[cbox.chain] = (chainCnt[cbox.chain] || 0) + 1;
    }
    for (var dcr = 0; dcr < rows; dcr++) for (var dcc = 0; dcc < cols; dcc++) {
      var dbox = cells[dcr][dcc];
      if (dbox && dbox.t === 'box' && dbox.chain > 0 && chainCnt[dbox.chain] < 2) dbox.chain = 0;
    }

    // 注：换球已移至 generateFromBlocks 的【解后处理】(applyRegionSwaps)——
    // 需先跑全知求解器得到 pickOrder(每步取的棋盘盒)才能按进度%圈定换球区域。

    var _bd = { rows: rows, cols: cols, cells: cells };
    if (config && config.costlyAlt) {
      try {
        var _ca = reserveSmallAlt(_bd, config);
        if (!_ca) _ca = injectCostlyAlt(_bd, config);
        if (_ca) _bd.costlyAlt = _ca;
      } catch (e) { }
    }
    return _bd;
  }

  /* ==================================================================
   * ===== 纠偏版结构候选流程（R01-R07）=====
   * 本段为【新增】函数，上方旧函数(buildBoard/generateFromBlocks/produce/makeChokeVariant …)
   * 全部原样保留、不删不改，供新旧对照与回退。新版入口：produceFixed / generateFromBlocksFixed。
   *
   * 修正的调用顺序（需求 §二）：
   *   盒序列与盒总量预算 → 棋盘行列 → 窄路墙黑块 → 分散黑块(全部实际落位)
   *   → 按【实际剩余空间】算预算管道并落位 → 冰块预定位置 → 问号预定位置 → 锁链组预定位置
   *   → 不带球的结构候选 → 不依赖颜色的结构检查 → 按消除依赖顺序填球
   *   → 把预定冰/问号/锁链【绑定】到真实盒(不再随机重选) → 独立守恒检查 → 1+3 求解筛选
   * ================================================================== */

  // ---- R02：分散黑块真实落位（在管道之前执行，并返回真实落位统计） ----
  /**
   * @returns {{planned:number, placed:number, shapeRejected:number, reachRejected:number, coords:Array}}
   */
  /**
   * 【v256·用户裁决】"墙全都放在最底层"。
   *   底盘的最底行本来就离入口最远、对路径影响最小；把墙压到那里，中间就不会被切出窄走廊。
   *   从最后一行往上、行内从左到右取空格；第 0 行永不落墙（那是入口行）。
   *   每放一块都做可达性检查，放不下就交给调用方的原有分散逻辑兜底。
   * @returns {{placed:number, coords:Array}}
   */
  function placeBottomWalls(cells, rows, cols, need, gapProtect) {
    var out = { placed: 0, coords: [] };
    if (!(need > 0)) return out;
    for (var r = rows - 1; r >= 1 && out.placed < need; r--) {
      for (var c = 0; c < cols && out.placed < need; c++) {
        if (cells[r][c] != null) continue;
        if (gapProtect && gapProtect[r + ',' + c]) continue;
        cells[r][c] = { t: 'black' };
        if (typeof nullCellsReachable === 'function' && !nullCellsReachable(cells, rows, cols)) {
          cells[r][c] = null; continue;
        }
        out.placed++; out.coords.push({ r: r, c: c });
      }
    }
    return out;
  }

  function placeDispersedBlackReal(cells, rows, cols, extraBlack, gapProtect, config) {
    var stat = { planned: extraBlack, placed: 0, shapeRejected: 0, reachRejected: 0, coords: [] };
    if (extraBlack <= 0) return stat;
    // 【v256】先按用户要求压到最底层
    if (config && config.wallBottomFirst !== false) {
      var bw = placeBottomWalls(cells, rows, cols, extraBlack, gapProtect);
      stat.placed = bw.placed; stat.coords = bw.coords; stat.bottomFirst = bw.placed;
      if (stat.placed >= extraBlack) return stat;
      extraBlack -= bw.placed;
    }
    function wallNbrCount(r, c) {
      var k = 0, dd = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      for (var i = 0; i < 4; i++) if (isWallAt(cells, rows, cols, r + dd[i][0], c + dd[i][1])) k++;
      return k;
    }
    var looseCand = [], tightCand = [];
    for (var br = 1; br < rows - 1; br++) for (var bc = 0; bc < cols; bc++) {
      if (cells[br][bc] == null && !gapProtect[br + ',' + bc]) {
        if (wallNbrCount(br, bc) === 0) looseCand.push({ r: br, c: bc });
        else tightCand.push({ r: br, c: bc });
      }
    }
    var wd = (typeof config.wallDisperse === 'number') ? Math.max(0, Math.min(1, config.wallDisperse)) : 0.6;
    var looseNeed = extraBlack * (2 - wd);
    var cand = (looseCand.length >= looseNeed) ? looseCand : looseCand.concat(tightCand);
    var sel = pickDispersed(cand, extraBlack * 2, 2);
    for (var s = 0; s < sel.length && stat.placed < extraBlack; s++) {
      var p = sel[s];
      if (cells[p.r][p.c] != null) continue;
      if (wouldViolateWall(cells, rows, cols, p.r, p.c)) { stat.shapeRejected++; continue; }
      cells[p.r][p.c] = { t: 'black' };
      if (!nullCellsReachable(cells, rows, cols)) { cells[p.r][p.c] = null; stat.reachRejected++; continue; }
      stat.placed++; stat.coords.push({ r: p.r, c: p.c });
    }
    return stat;
  }

  /** 把多余空格(盒不够填满时)转成黑块，保证结构候选本身就是满盘（避免填球后裁行使预定坐标失效）。 */
  function fillSurplusWithBlack(cells, rows, cols, surplus, gapProtect) {
    var stat = { need: surplus, filled: 0, coords: [] };
    if (surplus <= 0) return stat;
    var cap = Math.floor(rows * cols * 0.45);
    // 【v256】补位墙也先压最底层（用户要求），放不下再走分散逻辑
    var _bw2 = placeBottomWalls(cells, rows, cols, surplus, gapProtect);
    stat.filled = _bw2.placed; stat.coords = _bw2.coords;
    surplus -= _bw2.placed;
    if (surplus <= 0) return stat;
    // 【v255·用户反馈"路径很窄"】补位的墙先挑**四邻没有墙**的格子：
    //   原来所有空格一锅端随机撒，墙容易连成一条，把棋盘切出窄走廊。
    var cand = [], candLoose = [];
    for (var r = 1; r < rows - 1; r++) for (var c = 0; c < cols; c++) {
      if (cells[r][c] != null || gapProtect[r + ',' + c]) continue;
      var nb = 0;
      if (isWallAt(cells, rows, cols, r - 1, c)) nb++;
      if (isWallAt(cells, rows, cols, r + 1, c)) nb++;
      if (isWallAt(cells, rows, cols, r, c - 1)) nb++;
      if (isWallAt(cells, rows, cols, r, c + 1)) nb++;
      if (nb === 0) candLoose.push({ r: r, c: c }); else cand.push({ r: r, c: c });
    }
    var sel = pickDispersed(candLoose, candLoose.length, 2).concat(pickDispersed(cand, cand.length, 2));
    for (var i = 0; i < sel.length && stat.filled < surplus; i++) {
      var p = sel[i];
      if (cells[p.r][p.c] != null) continue;
      if (countCellsOfType(cells, 'black') >= cap) break;
      if (wouldViolateWall(cells, rows, cols, p.r, p.c)) continue;
      cells[p.r][p.c] = { t: 'black' };
      if (!nullCellsReachable(cells, rows, cols)) { cells[p.r][p.c] = null; continue; }
      stat.filled++; stat.coords.push({ r: p.r, c: p.c });
    }
    return stat;
  }

  /**
   * 选棋盘行列（纠偏版）：先随机列，再在行范围内优先选【可用普通格 ≤ 盒总数】的行，
   * 使结构候选天然满盘并留出溢出给管道；无满足项则退回全行范围随机（由多余空格转黑块兜底）。
   */
  /**
   * 形态硬约束（2026-07-31）：棋盘必须【列数 > 行数】且【列-行 ∈ {1,2}】。
   * 不允许行列相等、行多于列、或列比行多 3 格及以上。
   */
  function boardShapeOk(rows, cols, allowSquare) {
    var d = cols - rows;
    if (allowSquare) return d >= 0 && d <= 2;   // 【v216】允许正方形（列=行），其余规则不变
    return d >= 1 && d <= 2;
  }

  /**
   * 按【实际盒数 n】与【目标黑块比例】选棋盘（2026-07-31 重写）。
   *
   * 要解决的问题：原实现在「所有候选棋盘都比盒数需要的容量大」时，会退到全组合随机挑一个，
   * 多出来的空格随后被 fillSurplusWithBlack 全部补成黑块，导致最终黑块远超 blackPercent
   * （实测样例：57 盒选到 9×9 → 黑块 24/81 = 29.6%，而参数只要求 10%）。
   *
   * 现在的口径（ov = n - (cap - blackTarget)，即盒数相对「可放盒容量」的溢出）：
   *   ov >= 0 → 盒能填满棋盘，多出来的盒进管道，【不产生余格黑块】，最终黑块 ≈ blackPercent；
   *   ov <  0 → 棋盘偏大，|ov| 个余格会被补成黑块，最终黑块超标。
   * 因此选择顺序为：
   *   ① 形态合法且 ov 落在 [0, pipeRoom] 的候选（正好填满或小幅溢出进管道）——按 ov 小者优先，
   *      避免把几十个盒全丢进管道（管道单条深度有限，会撞 pipeCapacity 失败）；
   *   ② 形态合法且 ov > pipeRoom 的候选——溢出偏多，按 ov 小者优先；
   *   ③ 形态合法但 ov < 0 的候选——会产生余格黑块，按 |ov| 小者优先（黑块超标最少）；
   *   ④ 上述在【方案给定行列范围内】都不存在时，才允许【向下缩小】到范围外继续找，
   *      缩小候选同样必须满足形态硬约束；
   *   ⑤ 实在没有合法形态可用时，退回原行为（范围内随机），并置 shapeRelaxed 标记，
   *      由调用方与报告如实体现，不静默假装合规。
   *
   * 只改「选哪个棋盘」，不改障碍参数、不改盒容量、不在事后删黑块或裁棋盘。
   */
  /**
   * 可用棋盘空间一致性求解（用户 2026-08-04 定义）。
   *
   * 定义：可用空间 U = (总格 C − 墙B − 管道占位P) / C
   * 目的：同一批像素图能生成不同大小的棋盘，而各尺寸的可用空间保持一致（可上下浮动若干个百分点）。
   *
   * 联立推导（全部是守恒，不靠试错）：
   *   占用配额 K = B + P = round(C × (1 − U))        ← 由目标可用空间直接确定
   *   上盘盒格 = C − K，故溢出盒 D = n − (C − K) = n − C + K
   *   每条管道容量 pipeMinFill~pipeMaxDepth 个盒
   *     → P ∈ [⌈D/pipeMaxDepth⌉, ⌊D/pipeMinFill⌋]，同时受管道数下限 minPipes 约束
   *   黑块 B = K − P，需落在「障碍参数容差」内
   *
   * 降级顺序（用户指定）：优先保持障碍参数 → 不行则突破黑块比例，突破预算 2 次、每次 5 个百分点
   * （最大突破 10 个百分点，用于保护小棋盘：小棋盘必须靠突破黑块下限才能达到一致比例），
   * 硬上限 25% 始终生效。
   *
   * 【管道兜底】(任务 ANT-GEN-PIPE-DEPTH-FALLBACK-20260825，用户 2026-08-25 批准)
   *   上面这套联立里有一条容易被忽略的硬约束：minPipes 条管道要求 D ≥ minPipes × pipeMinFill。
   *   08-25 实测：方案_v104 的 minPipes=4 + pipeMinFill=4 需要 D≥16，而该批源图只产出 D=2~8，
   *   于是【每一个尺寸都无解】→ 53 张过闸源图 0 产出。
   *   因此按 minPipes 求不出解时，再用「保底 pipeFallbackCount 条管道、每管目标 pipeFallbackDepth 个盒」
   *   解一轮；命中则带 pipeFallback 标记返回，不静默。pipeFallbackCount=0 关闭兜底（回到原行为）。
   *   兜底路径同样受守恒硬约束 D ≤ P × pipeMaxDepth 限制，装不下仍返回 ok:false。
   *
   * 两轮都无解 → 返回 ok:false，由调用方淘汰该尺寸
   * （再往下就只能切分盒容量改变盒数，那属于参数层决策，不在本函数内偷偷做）。
   */
  function solveSpaceQuota(n, rows, cols, config) {
    var target = parseFloat(config.usableSpaceTarget);
    if (!(target > 0 && target < 1)) return null;          // 未开启 → 走原逻辑
    var C = rows * cols;
    var minPipes = Math.max(1, parseInt(config.minPipes, 10) || 1);
    var maxDepth = pipeDepthOf(config);
    var minFill = pipeMinFillOf(config);
    var center = (config.blackPercent || 0) / 100;
    var baseTolPp = (config.usableSpaceBlackTolPp != null) ? config.usableSpaceBlackTolPp : 5;
    var stepPp = (config.usableSpaceBreachStepPp != null) ? config.usableSpaceBreachStepPp : 5;
    var budget = (config.usableSpaceBreachBudget != null) ? config.usableSpaceBreachBudget : 2;
    var K = Math.round(C * (1 - target));
    var D = n - C + K;                                     // 溢出盒（守恒结果，可能 ≤0）

    // 一轮求解：给定「管道数下限 pMinReq」与「每管最少装 fill 个盒」，找可行 (P,B)。
    //   口径统一为 D ≥ P × fill（保守读法，与 P ≤ ⌊D/fill⌋ 同一件事）。
    //   不再有「放行更浅管道」的松弛——用户 2026-08-25 已给出绝对下限，见下面的阶梯。
    function trySolve(pMinReq, fill) {
      if (D <= 0) return null;            // 盒都装得下 → 不需要管道，由 P=0 分支处理
      for (var lvl = 0; lvl <= budget; lvl++) {
        var tol = (baseTolPp + stepPp * lvl) / 100;
        var bMin = Math.max(0, Math.ceil(C * (center - tol)));
        var bMax = Math.min(Math.floor(C * (center + tol)), Math.floor(C * 0.25));
        var pLo = Math.max(pMinReq, Math.ceil(D / maxDepth));
        var pHi = Math.floor(D / fill);
        for (var P = pLo; P <= pHi; P++) {
          var B = K - P;
          if (B < 0) continue;
          if (B >= bMin && B <= bMax) {
            return {
              ok: true, blackTarget: B, pipeWant: P, quota: K,
              overflow: Math.max(0, D), breachLevel: lvl,
              usable: (C - B - P) / C, blackPct: C > 0 ? B / C : 0,
              minFillUsed: fill
            };
          }
        }
      }
      return null;
    }

    // ── 无管道解（P=0）：把管道要占的格全让给盒 ──
    //   用户 2026-08-25：「如果低于这个下限就直接去除管道」。
    //   守恒推导：P=0 时上盘盒格 = C − B，要装下全部 n 个盒需 B ≤ C − n，即 B = K − D 恰好够
    //   （代回 D_new = n − (C − K + D) = 0，一个盒都不会掉）。
    //   代价是墙少了 D 个 → 可用空间比目标高 D/C；超过可用空间容差则不能用，如实返回无解。
    function trySolveNoPipe() {
      var uTolPp = (config.usableSpaceTolPp != null) ? config.usableSpaceTolPp : 5;
      // 墙数上界有两条：
      //   ① 全部盒必须上得了盘 → C − B ≥ n → B ≤ C − n；
      //   ② 黑块比例容差与 25% 硬上限 → B ≤ bMax（随突破级别放宽）。
      // 取尽量接近配额 K 的 B（偏差最小），但不得越过这两条上界。
      //   注意不能把 B 固定成 K−D：D≤0 时 K 可能本身就超过黑块 25% 硬上限
      //   （原先那 P 条管道占的是"非墙"的占位额度），固定 B=K 会让所有 D≤0 的尺寸全判无解。
      var Bcap = Math.min(K, C - n);
      if (Bcap < 0) return null;                        // 连墙全拆都装不下 → 该尺寸无解
      for (var lvl = 0; lvl <= budget; lvl++) {
        var tol = (baseTolPp + stepPp * lvl) / 100;
        var bMin = Math.max(0, Math.ceil(C * (center - tol)));
        var bMax = Math.min(Math.floor(C * (center + tol)), Math.floor(C * 0.25));
        var B = Math.min(Bcap, bMax);
        if (B < bMin) continue;                         // 墙太少、低于比例下限 → 放宽一级再试
        var devPp = Math.abs((C - B) / C - target) * 100;
        if (devPp > uTolPp) continue;                   // 可用空间偏离超容差 → 放宽一级再试
        return {
          ok: true, blackTarget: B, pipeWant: 0, quota: K,
          overflow: 0, breachLevel: lvl,
          usable: (C - B) / C, blackPct: C > 0 ? B / C : 0,
          minFillUsed: 0,
          pipeDropped: true, pipeDroppedDevPp: +devPp.toFixed(2),
          pipeDroppedBoxCells: C - B, pipeDroppedBoxNeed: n
        };
      }
      return null;
    }

    // ── 管道阶梯（用户 2026-08-25 两次裁决合并）──
    //   ① 主轮：minPipes 条 / 每管 ≥ pipeMinFill(默认4)
    //   ② 兜底：pipeFallbackCount 条(默认2) / 每管 ≥ pipeFallbackDepth(默认3)
    //   ③ 绝对下限：pipeFloorCount 条(默认2) / 每管 ≥ pipeFloorDepth(默认2)
    //   ④ 连绝对下限都到不了 → 【直接去除管道】(P=0)，管道格全让给盒
    //   D ≤ 0（棋盘本来就装得下所有盒）直接走 ④：硬塞管道只会得到装不满 2 层的空管道，
    //   按用户口径就该去掉。这一条改变了 v104 的行为（v104 会给 minPipes 条空管道）。
    var fbCount = (config.pipeFallbackCount != null) ? parseInt(config.pipeFallbackCount, 10) : 2;
    var fbDepth = (config.pipeFallbackDepth != null) ? parseInt(config.pipeFallbackDepth, 10) : 3;
    var flCount = (config.pipeFloorCount != null) ? parseInt(config.pipeFloorCount, 10) : 2;
    var flDepth = (config.pipeFloorDepth != null) ? parseInt(config.pipeFloorDepth, 10) : 2;
    if (!(fbDepth > 0)) fbDepth = 1;
    if (fbDepth > maxDepth) fbDepth = maxDepth;
    if (!(flDepth > 0)) flDepth = 1;
    if (flDepth > maxDepth) flDepth = maxDepth;

    // 【完整回退开关】两级降级都关掉（pipeFallbackCount=0 且 pipeFloorCount=0）时，
    //   连"去除管道"也不做，逐值回到 v104 及以前的行为——供复现旧批次用。
    //   旧行为的 D≤0 分支是「盒都装得下 → 管道取下限 minPipes 条」（会出现装不满的空管道）。
    var laddering = fbCount > 0 || flCount > 0;
    if (!laddering) {
      if (D <= 0) {
        for (var lv0 = 0; lv0 <= budget; lv0++) {
          var tol0 = (baseTolPp + stepPp * lv0) / 100;
          var bMin0 = Math.max(0, Math.ceil(C * (center - tol0)));
          var bMax0 = Math.min(Math.floor(C * (center + tol0)), Math.floor(C * 0.25));
          var B0 = K - minPipes;
          if (B0 >= 0 && B0 >= bMin0 && B0 <= bMax0) {
            return {
              ok: true, blackTarget: B0, pipeWant: minPipes, quota: K,
              overflow: 0, breachLevel: lv0,
              usable: (C - B0 - minPipes) / C, blackPct: C > 0 ? B0 / C : 0,
              minFillUsed: minFill
            };
          }
        }
      } else {
        var rL = trySolve(minPipes, minFill);
        if (rL) return rL;
      }
      return {
        ok: false, quota: K, overflow: D,
        reason: '两级管道降级均已关闭(pipeFallbackCount=0 且 pipeFloorCount=0，旧行为口径)；' +
          '守恒下限：' + minPipes + ' 条管道需溢出盒 D ≥ ' + (minPipes * minFill) + '，当前 D=' + D
      };
    }

    var r = trySolve(minPipes, minFill);
    if (r) return r;

    if (fbCount > 0 && fbCount <= minPipes) {
      var rf = trySolve(fbCount, fbDepth);
      if (rf) {
        rf.pipeFallback = true;
        rf.pipeFallbackFrom = minPipes;
        rf.pipeFallbackTo = fbCount;
        rf.pipeFallbackTier = 'fallback';
        return rf;
      }
    }
    if (flCount > 0) {
      var rl = trySolve(flCount, flDepth);
      if (rl) {
        rl.pipeFallback = true;
        rl.pipeFallbackFrom = minPipes;
        rl.pipeFallbackTo = flCount;
        rl.pipeFallbackTier = 'floor';      // 已用到绝对下限（默认 2 条 × 2 层）
        return rl;
      }
    }
    var rn = trySolveNoPipe();
    if (rn) return rn;

    return {
      ok: false, quota: K, overflow: D,
      reason: '管道阶梯全轮无解：主轮(' + minPipes + '条/每管≥' + minFill + ')' +
        (fbCount > 0 ? ' → 兜底(' + fbCount + '条/≥' + fbDepth + ')' : '') +
        (flCount > 0 ? ' → 绝对下限(' + flCount + '条/≥' + flDepth + ')' : '') +
        ' → 去除管道(P=0) 均不可行。' +
        '守恒下限：P 条管道需溢出盒 D ≥ P×每管最少；当前 D=' + D + '，配额 K=' + K +
        '；P=0 需墙降到 ' + (K - Math.max(0, D)) + ' 且可用空间偏差 ≤ ' +
        (config.usableSpaceTolPp != null ? config.usableSpaceTolPp : 5) + 'pp'
    };
  }

  function chooseBoardDimsFixed(n, config) {
    var rMin = clampInt(config.boardRowsMin, AntSolver.BOARD_ROWS, 3, 20);
    var rMax = clampInt(config.boardRowsMax, AntSolver.BOARD_ROWS, rMin, 20);
    var cMin = clampInt(config.boardColsMin, AntSolver.BOARD_COLS_MIN, 3, 30);
    var cMax = clampInt(config.boardColsMax, AntSolver.BOARD_COLS_MAX, cMin, 30);
    var bp = config.blackPercent || 0;
    // 允许进管道的溢出上限：管道条数未定时按经验给一个温和的窗口，
    // 目的只是「别把几十个盒全推进管道」，真正的管道容量仍由后续 pipeCapacity 检查把关。
    var pipeRoom = (config && config.boardFirst) ? 0 : Math.max(3, Math.round(n * 0.25));
    // 管道数下限 → 溢出盒下限（按每管容量区间的中值反推；0 = 不约束，原行为）
    //   原为写死的 minPipes*5，5 是 (4+6)/2；深度参数化后改为按实际区间取中值，
    //   默认 pipeMinFill=4 / pipeMaxDepth=6 时结果仍是 5，与参数引入前等价。
    var minPipes = parseInt(config.minPipes, 10) || 0;
    var minOv = (config && config.boardFirst) ? 0 : (minPipes > 0 ? minPipes * Math.ceil((pipeMinFillOf(config) + pipeDepthOf(config)) / 2) : 0);
    // ===== 可用空间一致性优先（用户 2026-08-04）=====
    // 开启目标可用空间后，尺寸的取舍标准就变成「该尺寸能否解出满足目标比例的(管道,黑块)组合」，
    // 而不再是原来的「溢出多少」。在所有有解的尺寸里【随机取一个】——这正是用户要的
    // 「同一批像素图生成出不同大小的棋盘」；无解的尺寸直接排除，不做勉强适配。
    if (parseFloat(config.usableSpaceTarget) > 0) {
      // ===== 墙过多缩棋盘（任务 ANT-GEN-WALL-SHRINK-20260831，用户 2026-08-31 批准 q1「统一」）=====
      // 症状（实测 方案_v119四方向）：范围内合法形态只有 8×9/8×10/9×10，都比像素图切出的盒数大，
      //   于是 solveSpaceQuota 在这些大盘上【去掉管道】(pipeWant=0/pipeDropped)、把 (1−usableTarget)
      //   的占用配额几乎全塞给墙（实测墙占比均值 13.9%、最高 26%，远超 blackPercentMax）。
      // 修法（用户「统一」= 不做字面的单维交替减，避免撞 boardShapeOk 的 cols−rows∈{1,2}）：
      //   ① 先在方案范围内找【能保住管道】(pipeWant>0 且未 pipeDropped) 的尺寸，有就用（保尺寸多样性）；
      //   ② 范围内全都要丢管道时，才【逐行向下缩小】(rr 从 rMin−1 起，每级只取 cols=rr+1/rr+2 的合法形态)，
      //      缩到某一级出现能保住管道的尺寸就停（最小缩小量 → 不同盒数的图缩到不同大小，天然保留多样性）；
      //   ③ 连最小盘都保不住管道 → 回落到「范围内可行尺寸随机」（即原行为，墙偏多，但如实标记 pipeDropped）。
      // 只改「选哪个尺寸」，solveSpaceQuota 的配额联立公式、结构层落位一律不动。
      var UST = parseFloat(config.usableSpaceTarget);
      var shrinkFloor = Math.max(6, rMin - 3);   // 向下缩到的行数下限，避免缩成过小的怪盘
      function feasAt(fr, fc) {
        if (!boardShapeOk(fr, fc, !!config.boardAllowSquare)) return null;
        var q = solveSpaceQuota(n, fr, fc, config);
        return (q && q.ok) ? { rows: fr, cols: fc, q: q } : null;
      }
      function keepsPipe(d) { return d.q.pipeWant > 0 && !d.q.pipeDropped; }
      // 【v316·用户裁决】minPipes=0 时不再强制"必须保住管道"：原来哪怕盘面装得下全部车，
      //   也一定要挑一个会溢出、能塞管道的尺寸（用户：「往一辆管道里塞车」）。
      var _allowNoPipe = !(parseInt(config.minPipes, 10) > 0);
      // 「干净」= 保住管道 且【未触发墙超限突破】(breachLevel 0，墙落在 blackPercent±基础容差内)。
      // 用户 2026-08-31 明确「不会执行墙超限兜底」→ 缩小的目标是缩到不再突破为止，而不只是缩到有管道。
      function isClean(d) { return (_allowNoPipe || keepsPipe(d)) && (d.q.breachLevel || 0) === 0; }
      function emitUsable(dpick, shrinkUsed, feasCount) {
        var fq = dpick.q, fcap = dpick.rows * dpick.cols;
        return {
          rows: dpick.rows, cols: dpick.cols,
          fitted: true, pipeBiased: fq.pipeWant >= 3,
          spaceQuota: fq,                       // 供结构候选层按配额落位黑块与管道
          boardPick: {
            tier: 'usableSpace', cap: fcap, boxCount: n,
            blackTarget: fq.blackTarget, surplusToBlack: 0,
            finalBlack: fq.blackTarget, finalBlackPct: Math.round(fq.blackPct * 1000) / 10,
            shrinkUsed: shrinkUsed, expanded: dpick.expanded || null, shapeRelaxed: false,
            shapeDiff: dpick.cols - dpick.rows,
            rangeGiven: { rowsMin: rMin, rowsMax: rMax, colsMin: cMin, colsMax: cMax },
            // 可用空间自适应的诊断信息（供报告与验证如实展示）
            usableTarget: UST,
            usableActual: Math.round(fq.usable * 1000) / 10,
            quota: fq.quota, pipeWant: fq.pipeWant, overflow: fq.overflow,
            blackBreachLevel: fq.breachLevel,     // 0=未突破，1/2=用掉的突破预算次数
            pipeDroppedPick: !keepsPipe(dpick),   // 本次采用的尺寸是否仍是「去管道」解（③ 兜底才为 true）
            feasibleDimCount: feasCount
          }
        };
      }
      function pickRandom(list) { return list[Math.floor(rnd() * list.length)]; }

      // 收集所有可行尺寸：方案范围内（缩小距离 0）+ 逐行向下缩小（缩小距离 = rMin−sr）。
      // 每个尺寸带 shrinkDist，供「最小缩小量」择优——不同盒数的图会缩到不同大小，天然保留多样性。
      var allDims = [];
      for (var fr = rMin; fr <= rMax; fr++) {
        for (var fc = cMin; fc <= cMax; fc++) {
          var d0 = feasAt(fr, fc);
          if (d0) { d0.shrinkDist = 0; allDims.push(d0); }
        }
      }
      // 【v388·用户裁决】溢出优先加行/列：先在当前范围外各试 +1 行 / +1 列，
      //   能装下就优先用，避免"为了塞管道把盘做小"。只在 config.boardExpandOnOverflow 时开。
      if (config.boardExpandOnOverflow) {
        var _exCols = [], _exRows = [];
        for (var xc = cMin; xc <= Math.min(cMax + 1, 30); xc++) _exCols.push(xc);
        for (var xr = rMin; xr <= Math.min(rMax + 1, 20); xr++) _exRows.push(xr);
        for (var xi = 0; xi < _exCols.length; xi++) {
          var xd = feasAt(rMax + 1, _exCols[xi]);
          if (xd) { xd.shrinkDist = 0; xd.expanded = 'row'; allDims.push(xd); }
        }
        for (var yi = 0; yi < _exRows.length; yi++) {
          var yd = feasAt(_exRows[yi], cMax + 1);
          if (yd) { yd.shrinkDist = 0; yd.expanded = 'col'; allDims.push(yd); }
        }
      }
      // 【v205】棋盘硬范围：开了 boardHardRange 就不许"向下缩小"出范围，
      //   也不许借缩小路径把棋盘做小（缩小会让周长/车数比例变差、暴露更多）。
      if (!config.boardHardRange) {
        for (var sr = rMin - 1; sr >= shrinkFloor; sr--) {
          for (var dcol = 1; dcol <= 2; dcol++) {
            var sc = sr + dcol;
            if (sc < 3) continue;
            var ds = feasAt(sr, sc);
            if (ds) { ds.shrinkDist = rMin - sr; allDims.push(ds); }
          }
        }
      }
      if (allDims.length) {
        var _ov0 = function (d) { return (d.q && d.q.overflow || 0); };
        // 【v393】先 board 后 pipe 的硬顺序：先找 overflow≤0 的尺寸，不塞管道。
        // 范围本身能装下就先用；范围装不下才用 +1 行/列扩展盘；都没有才允许带管道。
        var _fitIn = allDims.filter(function (d) { return !d.expanded && _ov0(d) <= 0 && (d.q.breachLevel || 0) === 0; });
        if (_fitIn.length) return emitUsable(pickRandom(_fitIn), false, allDims.length);
        var _fitExp = allDims.filter(function (d) { return d.expanded && _ov0(d) <= 0 && (d.q.breachLevel || 0) === 0; });
        if (_fitExp.length) return emitUsable(pickRandom(_fitExp), false, allDims.length);
        // ① 优先「干净」尺寸（保管道 + 不突破墙上限），并取【缩小量最小】的那一级 → 只缩到刚好不突破，
        //    同一级内随机（保留尺寸多样性）。这直接实现用户「缩到不触发墙超限兜底为止」。
        var clean = allDims.filter(isClean);
        if (clean.length) {
          var minSh = Math.min.apply(null, clean.map(function (d) { return d.shrinkDist; }));
          var pool = clean.filter(function (d) { return d.shrinkDist === minSh; });
          // 【v316·用户裁决】同一档里优先「装得下」的尺寸：原来的 pickRandom 会随机挑一个，
          //   31 辆车的图可能挑到 4×6=24 格 → 7 辆被塞进管道（用户：「往一辆管道里塞车」）。
          //   现在只要存在 overflow≤0 的尺寸就只在其中随机；否则取溢出最少的那些。
          var _ov = function (d) { return (d.q && d.q.overflow || 0); };
          var fit = pool.filter(function (d) { return _ov(d) <= 0; });
          if (fit.length) pool = fit;
          else {
            var minOv2 = Math.min.apply(null, pool.map(_ov));
            pool = pool.filter(function (d) { return _ov(d) === minOv2; });
          }
          // 【v338·用户裁决】同样是"装得下"的尺寸，要挑【最贴合的】，不能随机——
          //   33 辆车配 6×8=48 格时，随机挑到 6×8 就会剩 15 个空格，
          //   最后全被补成黑块压在底部（用户："为什么底部一堆黑块"）。
          var _absOv = function (d) { return Math.abs(_ov(d)); };
          var _bestAbs = Math.min.apply(null, pool.map(_absOv));
          pool = pool.filter(function (d) { return _absOv(d) === _bestAbs; });
          return emitUsable(pickRandom(pool), minSh > 0, allDims.length);
        }
        // ② 没有完全不突破的 → 退而求其次：在能保住管道的尺寸里，取突破级别最低、其次缩小量最小者。
        var keep = allDims.filter(keepsPipe);
        if (keep.length) {
          keep.sort(function (a, b) {
            return (a.q.breachLevel || 0) - (b.q.breachLevel || 0) || a.shrinkDist - b.shrinkDist;
          });
          var bestBreach = keep[0].q.breachLevel || 0, bestSh = keep[0].shrinkDist;
          var pool2 = keep.filter(function (d) { return (d.q.breachLevel || 0) === bestBreach && d.shrinkDist === bestSh; });
          return emitUsable(pickRandom(pool2), bestSh > 0, allDims.length);
        }
        // ③ 全都要丢管道 → 回落范围内可行尺寸随机（原行为，墙偏多，如实标记 pipeDroppedPick）
        var inR = allDims.filter(function (d) { return d.shrinkDist === 0; });
        return emitUsable(pickRandom(inR.length ? inR : allDims), false, allDims.length);
      }
      // 一个可行尺寸都没有 → 落回原逻辑，并由结构候选层与验证脚本如实暴露（不静默假装达标）
    }

    function evalPair(rr, cc) {
      var cap = rr * cc;
      var bt = Math.min(Math.floor(cap * bp / 100), Math.floor(cap * 0.25));
      var ov = n - (cap - bt);
      var surplus = ov < 0 ? -ov : 0;
      return {
        rows: rr, cols: cc, cap: cap, blackTarget: bt, ov: ov, surplus: surplus,
        finalBlack: bt + surplus,
        finalBlackPct: cap > 0 ? (bt + surplus) / cap * 100 : 0
      };
    }

    // ---- 收集候选：先方案范围内，再（必要时）向下缩小 ----
    var inRange = [], shrunk = [], anyInRange = [];
    var rr, cc, e;
    for (rr = rMin; rr <= rMax; rr++) {
      for (cc = cMin; cc <= cMax; cc++) {
        e = evalPair(rr, cc);
        anyInRange.push(e);
        if (boardShapeOk(rr, cc, !!config.boardAllowSquare)) inRange.push(e);
      }
    }
    // 【v394】溢出优先加行/列：fallback（未开 usableSpaceTarget）也要把扩展尺寸纳入候选。
    if (config.boardExpandOnOverflow) {
      var _xc = Math.min(cMax + 1, 30), _xr = Math.min(rMax + 1, 20);
      for (var xc2 = cMin; xc2 <= _xc; xc2++) {
        var xe = evalPair(rMax + 1, xc2);
        anyInRange.push(xe);
        if (boardShapeOk(rMax + 1, xc2, !!config.boardAllowSquare)) inRange.push(xe);
      }
      for (var xr2 = rMin; xr2 <= _xr; xr2++) {
        var ye = evalPair(xr2, cMax + 1);
        anyInRange.push(ye);
        if (boardShapeOk(xr2, cMax + 1, !!config.boardAllowSquare)) inRange.push(ye);
      }
    }
    // 向下缩小候选：行从 rMin-1 一直缩到 3，列只取 行+1 / 行+2（天然满足形态约束）
    // 【v316·用户裁决】开了棋盘硬范围（boardHardRange）就不许缩到范围外 ——
    //   原来这条路径不看该开关，22 辆的图被缩成 3×8 的怪盘。
    for (rr = rMin - 1; config.boardHardRange ? false : rr >= 3; rr--) {
      for (var d = 1; d <= 2; d++) {
        cc = rr + d;
        if (cc < 3) continue;
        shrunk.push(evalPair(rr, cc));
      }
    }

    // ---- 分档挑选 ----
    function byOvAsc(a, b) { return a.ov - b.ov; }
    function bySurplusAsc(a, b) { return a.surplus - b.surplus || a.ov - b.ov; }
    function pickFrom(list) {
      // ===== 管道数量下限（用户 2026-08-04：管道太少，确保不低于 4 个）=====
      // 管道数由守恒反推：溢出盒 ov 对应管道数 P∈[⌈ov/5⌉,⌊ov/3⌋]，故「P ≥ minPipes」等价于「ov ≥ minPipes×5」。
      // 原逻辑总是在溢出窗口内挑 ov 最小的尺寸（byOvAsc 取首个），这正是管道偏少的原因——
      // 它刻意避免溢出。开启下限后改为：先在「溢出足够撑起 minPipes 条管道」的候选里挑 ov 最小的，
      // 即【刚好够、不过量】，这样既满足下限、又不会把大量盒推进管道破坏手感。
      // 找不到可行尺寸时不硬来，退回原逻辑，由调用方与验证脚本如实暴露（不静默假装达标）。
      if (minOv > 0) {
        var enough = list.filter(function (x) { return x.ov >= minOv; }).sort(byOvAsc);
        if (enough.length) return { e: enough[0], tier: 'minPipes' };
      }
      // 【v394】boardFirst：只要盘能装下（ov≤0），哪怕多 1~2 格，也优先于“溢出进管道”。
      if (config && config.boardFirst) {
        var fitBoard = list.filter(function (x) { return x.ov <= 0; }).sort(bySurplusAsc);
        if (fitBoard.length) return { e: fitBoard[0], tier: 'fitBoard' };
      }
      var good = list.filter(function (x) { return x.ov >= 0 && x.ov <= pipeRoom; }).sort(byOvAsc);
      if (good.length) return { e: good[0], tier: 'fitPipe' };
      var over = list.filter(function (x) { return x.ov > pipeRoom; }).sort(byOvAsc);
      if (over.length) return { e: over[0], tier: 'overflow' };
      var under = list.filter(function (x) { return x.ov < 0; }).sort(bySurplusAsc);
      if (under.length) return { e: under[0], tier: 'surplus' };
      return null;
    }

    var chosen = null, shrinkUsed = false, shapeRelaxed = false;

    // ①②③：方案范围内的合法形态
    var r1 = pickFrom(inRange);
    // 只有「范围内最好的结果仍会产生余格黑块」时，才尝试向下缩小
    if (r1 && r1.tier !== 'surplus') {
      chosen = r1;
    } else {
      var r2 = pickFrom(shrunk);
      if (r2 && r2.tier !== 'surplus') { chosen = r2; shrinkUsed = true; }
      else if (r1) { chosen = r1; }
      else if (r2) { chosen = r2; shrinkUsed = true; }
    }

    // ⑤ 没有任何合法形态可用 → 退回原行为并如实标记
    if (!chosen) {
      var fallback = anyInRange[Math.floor(rnd() * anyInRange.length)];
      chosen = { e: fallback, tier: 'shapeRelaxed' };
      shapeRelaxed = true;
    }

    var pick = chosen.e;
    return {
      rows: pick.rows, cols: pick.cols,
      // 兼容原有返回字段语义
      fitted: pick.ov >= 0,
      pipeBiased: pick.ov >= 3,
      // 新增诊断字段：供生产报告如实展示「目标黑块 / 实际黑块 / 实际比例 / 是否缩小过棋盘」
      boardPick: {
        tier: chosen.tier, cap: pick.cap, boxCount: n,
        blackTarget: pick.blackTarget, surplusToBlack: pick.surplus,
        finalBlack: pick.finalBlack, finalBlackPct: Math.round(pick.finalBlackPct * 10) / 10,
        shrinkUsed: shrinkUsed, shapeRelaxed: shapeRelaxed,
        shapeDiff: pick.cols - pick.rows,
        rangeGiven: { rowsMin: rMin, rowsMax: rMax, colsMin: cMin, colsMax: cMax }
      }
    };
  }

  // ---- R01：结构阶段预定 iceSlots / questionSlots / chainGroups ----
  /**
   * 在【不带球】的结构候选上规划障碍预定位置。所有位置都指向 null 格(未来盒格)，
   * 不指向黑块/管道本体/盘外，且互斥规则(问号不与锁链叠加)在规划期即满足。
   * 注：此阶段 cells 内没有 box，chainActivatable() 会把所有非本组格当作"已移除"从而恒为 true，
   *     属方法学陷阱，故此处【不调用】它；锁链可激活性统一在绑定后由 structuralDeadlockCheck 把关。
   */
  // ==================== 卡点体系多样化（ANT-GEN-CHOKE-TYPES-20260824） ====================
  // 背景：改动前 applyOneChoke 只有两个分派分支（60% chokeSwap / 40% chokeInflate），
  //   窄路/冰/锁链/问号/管道都是建盘期固定比例铺设、不是卡点分支。实测 344 关结构指纹仅 24 种、
  //   最常见 5 种占 65.7%，问号 329/344 关恰好 4 个，冰块 100% 出现且集中 9~10 个 —— 高度同质。
  // 本轮把「卡点」显式类型化：每关按配额抽取【互不重合】的若干类型，BOSS 与普通关分别配额。
  // 所有类型默认关闭或维持原行为，不改变现有批次可复现性。

  /**
   * 稀有色识别（用户 2026-08-24 q4）。
   * 「稀有」= 该色在目标图上的像素总量占比小。稀有色被卡住时可替代方案最少，
   * 因此把稀有色放到关键位（窄路口/锁链端/管道口）比放常见色更能形成真卡点。
   * 与既有 gatewayColorRank(网关色) / interiorColorRank(埋深) 是**三个不同维度**：
   *   稀有=量少、网关=靠外先可达、埋深=被围在内部。
   * @returns {Array} [{color, pixels, ratio, rank}]，按像素占比升序（越前越稀有）
   */
  function rareColorRank(blocks) {
    if (!blocks || !blocks.length) return [];
    var cnt = {}, total = 0, r, c;
    for (r = 0; r < blocks.length; r++) for (c = 0; c < blocks[r].length; c++) {
      var v = blocks[r][c];
      if (v > 0) { cnt[v] = (cnt[v] || 0) + 1; total++; }
    }
    var out = [];
    for (var k in cnt) out.push({ color: parseInt(k, 10), pixels: cnt[k], ratio: total ? cnt[k] / total : 0 });
    out.sort(function (a, b) { return a.ratio - b.ratio; });
    for (var i = 0; i < out.length; i++) { out[i].rank = i + 1; out[i].ratio = +out[i].ratio.toFixed(5); }
    return out;
  }

  /**
   * 聚集选点：pickDispersed 的对立面。
   * pickDispersed 用"最大化最近距离"把点摊开；本函数先取少量种子（彼此分散），
   * 再在每个种子邻域内就近扩张，从而形成若干团簇。
   * 用于冰块簇/问号簇——同样的数量，聚集后会在局部形成长时间锁死区，压力形态与分散完全不同。
   * @param {Array} cands 候选格 [{r,c}]
   * @param {number} count 需要几个
   * @param {number} seeds 分成几团（<=0 时按 sqrt 自适应）
   */
  function pickClustered(cands, count, seeds) {
    if (count <= 0 || !cands || !cands.length) return [];
    count = Math.min(count, cands.length);
    if (!(seeds > 0)) seeds = Math.max(1, Math.round(Math.sqrt(count) / 1.5));
    seeds = Math.min(seeds, count);
    var seedPts = pickDispersed(cands, seeds, 2);
    if (!seedPts.length) return pickDispersed(cands, count, 1);
    var used = {}, picked = [];
    for (var s = 0; s < seedPts.length; s++) {
      var kk = seedPts[s].r + ',' + seedPts[s].c;
      if (used[kk]) continue;
      used[kk] = 1; picked.push(seedPts[s]);
    }
    // 按「到最近种子的切比雪夫距离」升序补齐 → 天然贴着种子成团
    var rest = [];
    for (var i = 0; i < cands.length; i++) {
      var p = cands[i], key = p.r + ',' + p.c;
      if (used[key]) continue;
      var best = 1e9;
      for (var j = 0; j < seedPts.length; j++) {
        var d = Math.max(Math.abs(p.r - seedPts[j].r), Math.abs(p.c - seedPts[j].c));
        if (d < best) best = d;
      }
      rest.push({ p: p, d: best, jitter: rnd() });
    }
    rest.sort(function (a, b) { return (a.d - b.d) || (a.jitter - b.jitter); });
    for (var m = 0; m < rest.length && picked.length < count; m++) {
      var q = rest[m].p, k2 = q.r + ',' + q.c;
      if (used[k2]) continue;
      used[k2] = 1; picked.push(q);
    }
    return picked;
  }

  /**
   * 卡点类型清单。每项：key（配置名）、cn（中文名）、stage（作用阶段）。
   *   structure = 建盘/障碍规划期生效（planObstacleSlotsFixed）
   *   post      = 填球后的卡点变体期生效（applyOneChoke 分支）
   */
  var CHOKE_TYPE_LIST = [
    // 【v120】narrowPath 进池：窄路不再是「默认开启的独立参数」，而是和其他类型一样靠期望概率抽取。
    //   用户 q1：「所以我的卡点类型池就是为了设置期望和概率，随机从池子内输入对应卡点类型组合，
    //   从而让关卡棋盘结构出现丰富的变化」。
    { key: 'narrowPath', cn: '窄路墙缺口', stage: 'structure' },
    { key: 'iceCluster', cn: '数字冰簇聚集', stage: 'structure' },
    { key: 'chainCluster', cn: '锁链簇聚集', stage: 'structure' },
    { key: 'questionCluster', cn: '问号聚集', stage: 'structure' },
    { key: 'chainIce', cn: '数字冰叠锁链', stage: 'structure' },
    { key: 'pipeChain', cn: '管道口叠锁链', stage: 'structure' },
    { key: 'narrowGapIce', cn: '窄路口叠数字冰', stage: 'structure' },
    { key: 'narrowGapChain', cn: '窄路口叠锁链', stage: 'structure' },
    { key: 'bigBox', cn: '超大盒', stage: 'post' },
    { key: 'rareColorKey', cn: '稀有色占关键位', stage: 'post' },
    { key: 'swap', cn: '换球/藏管道', stage: 'post' },
    { key: 'inflate', cn: '增容', stage: 'post' }
  ];

  /**
   * 【v120】卡点类型化是否已启用。
   * 判据：普通/BOSS 任一有检查次数（v115 概率机制）或旧的固定数量，且池里至少一个权重 > 0。
   * 用途：窄路的决定权在「类型池」与「旧的 narrowPath/narrowPathProb」之间二选一 ——
   *   启用类型化 → 窄路按抽中与否决定（用户 q1）；未启用 → 逐值走旧口径，旧方案与旧批次可复现。
   */
  function chokeTypingActive(config) {
    if (!config) return false;
    var anyWeight = false, w = config.chokeTypes || {};
    for (var k in w) if (Object.prototype.hasOwnProperty.call(w, k) && typeof w[k] === 'number' && w[k] > 0) { anyWeight = true; break; }
    if (!anyWeight) return false;
    return (config.chokeTypeRollsNormal > 0) || (config.chokeTypeRollsBoss > 0) ||
           (config.chokeTypeCountNormal > 0) || (config.chokeTypeCountBoss > 0);
  }

  /**
   * 【v120】本关是否需要窄路结构。
   * 抽中 `narrowGapIce` / `narrowGapChain` 但没抽中 `narrowPath` 时**自动补建窄路** ——
   * 否则这两个名额又会空转（v103~v119 就是这么白占了名额，不能换个形式重犯）。
   * @returns {object} { need, reason }
   */
  function narrowNeeded(config, chokePlan) {
    var CK = (chokePlan && chokePlan.has) || {};
    if (chokeTypingActive(config)) {
      if (CK.narrowPath) return { need: true, reason: 'chokeType:narrowPath' };
      if (CK.narrowGapIce) return { need: true, reason: 'implied:narrowGapIce' };
      if (CK.narrowGapChain) return { need: true, reason: 'implied:narrowGapChain' };
      return { need: false, reason: 'chokeType:notDrawn' };
    }
    // 未启用类型化 → 旧口径（开关 + 概率）
    if (config.narrowPath && narrowPathHits(config)) return { need: true, reason: 'legacy:narrowPathProb' };
    return { need: false, reason: config.narrowPath ? 'legacy:probMiss' : 'legacy:off' };
  }

  /**
   * 【v120】按「进度位置」裁剪候选格池（用户 q2 末句：卡点组合出现的进度位置，默认 15%~80%）。
   *
   * 口径：`nullCells` 本就是**行主序**（首行→尾行、左→右）收集的未来盒格，而填盘正是按这个顺序
   * 灌入目标图消除序的盒队列，所以「在 nullCells 里的下标 / 总数」就是这一格的消除进度。
   * v114 的填盘局部交错最多让盒位移 W(默认6) 位，对 15%~80% 这样的宽带影响可忽略。
   *
   * 只用于**卡点类型手段**的落位，不影响基础障碍铺设 —— 基础障碍要铺满全盘，
   * 若一起收窄会连带改变整体障碍分布（那是另一件事，用户没要求）。
   */
  function clipByProgress(pool, config, allCellsInOrder) {
    var lo = (config && config.chokePosMin != null) ? parseFloat(config.chokePosMin) : 0.15;
    var hi = (config && config.chokePosMax != null) ? parseFloat(config.chokePosMax) : 0.80;
    if (!(lo >= 0)) lo = 0; if (!(hi <= 1)) hi = 1;
    if (hi <= lo) return pool.slice();
    var order = allCellsInOrder || pool;
    var n = order.length;
    if (!n) return pool.slice();
    var i0 = Math.floor(n * lo), i1 = Math.ceil(n * hi);
    var band = {};
    for (var i = i0; i < i1 && i < n; i++) band[order[i].r + ',' + order[i].c] = 1;
    var out = pool.filter(function (p) { return band[p.r + ',' + p.c]; });
    return out.length ? out : pool.slice();   // 带内无候选时退回全池，不因此产不出关
  }

  /**
   * 【v120】冰块簇：按【四方向 BFS 连通块】生长（用户 q2-1「用bfs距离，最近就是相邻。
   * 冰块蔟参数为：四方向聚集数量（包含依赖传递，例如一个冰块链式传递四方向也算聚集）」）。
   *
   * 与旧 `pickClustered` 的区别：旧实现按「到最近种子的切比雪夫距离」升序补齐，团是**松散**的、
   * 可能斜着连、也可能不连通；本实现每个团都是**严格四连通**的一块，「聚集数量」即该块的格数。
   *
   * @param {Array} cands 可用格（子集）
   * @param {number} count 总需求格数
   * @param {number} sizeMin/sizeMax 每簇格数区间
   * @returns {Array} 选中的格；附带 `_clusters` 供记录（每簇的成员与大小）
   */
  function pickClusteredBFS(cands, count, sizeMin, sizeMax) {
    var out = [], clusters = [];
    if (count <= 0 || !cands || !cands.length) { out._clusters = clusters; return out; }
    if (!(sizeMin > 0)) sizeMin = 1;
    if (!(sizeMax >= sizeMin)) sizeMax = sizeMin;
    var free = {}, i;
    for (i = 0; i < cands.length; i++) free[cands[i].r + ',' + cands[i].c] = cands[i];
    var order = shuffle(cands.slice());
    var d4 = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    var taken = {};
    for (i = 0; i < order.length && out.length < count; i++) {
      var seed = order[i], sk = seed.r + ',' + seed.c;
      if (taken[sk]) continue;
      var want = sizeMin + ((rnd() * (sizeMax - sizeMin + 1)) | 0);
      if (want > count - out.length) want = count - out.length;
      // 从 seed 做四方向 BFS，只走仍在候选池且未被占用的格
      var q = [seed], mem = [], seen = {};
      seen[sk] = 1;
      while (q.length && mem.length < want) {
        var cur = q.shift();
        var ck = cur.r + ',' + cur.c;
        if (taken[ck]) continue;
        mem.push(cur); taken[ck] = 1;
        var nb = shuffle(d4.slice());
        for (var d = 0; d < nb.length; d++) {
          var nk = (cur.r + nb[d][0]) + ',' + (cur.c + nb[d][1]);
          if (seen[nk] || taken[nk] || !free[nk]) continue;
          seen[nk] = 1; q.push(free[nk]);
        }
      }
      if (!mem.length) continue;
      for (var m = 0; m < mem.length; m++) out.push(mem[m]);
      clusters.push({ size: mem.length, seed: { r: seed.r, c: seed.c }, members: mem });
    }
    out._clusters = clusters;
    return out;
  }

  /**
   * 【v120】问号簇：直接用「到簇中心的 BFS 距离阈值」（用户 q2-3）。
   * 选一个中心，把候选池里 BFS 距离 ≤ radius 的格全部收进该簇（受剩余需求量限制），
   * 不够则再开一个中心。半径越小越紧。
   */
  function pickClusteredRadius(cands, count, radius) {
    var out = [], clusters = [];
    if (count <= 0 || !cands || !cands.length) { out._clusters = clusters; return out; }
    if (!(radius > 0)) radius = 1;
    var free = {}, i;
    for (i = 0; i < cands.length; i++) free[cands[i].r + ',' + cands[i].c] = cands[i];
    var order = shuffle(cands.slice());
    var d4 = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    var taken = {};
    for (i = 0; i < order.length && out.length < count; i++) {
      var ctr = order[i], ck0 = ctr.r + ',' + ctr.c;
      if (taken[ck0]) continue;
      var q = [{ p: ctr, d: 0 }], seen = {}, mem = [];
      seen[ck0] = 1;
      while (q.length && out.length + mem.length < count) {
        var cur = q.shift();
        if (!taken[cur.p.r + ',' + cur.p.c]) { mem.push(cur.p); }
        if (cur.d >= radius) continue;
        for (var d = 0; d < 4; d++) {
          var nr = cur.p.r + d4[d][0], nc = cur.p.c + d4[d][1], nk = nr + ',' + nc;
          if (seen[nk] || taken[nk] || !free[nk]) continue;
          seen[nk] = 1; q.push({ p: free[nk], d: cur.d + 1 });
        }
      }
      if (!mem.length) continue;
      for (var m = 0; m < mem.length; m++) { out.push(mem[m]); taken[mem[m].r + ',' + mem[m].c] = 1; }
      clusters.push({ radius: radius, size: mem.length, center: { r: ctr.r, c: ctr.c }, members: mem });
    }
    out._clusters = clusters;
    return out;
  }

  /** 【v120】一组点集的「四方向 BFS 平均两两距离」度量（锁链簇用；只作记录，不参与判定）。 */
  function avgManhattan(points) {
    if (!points || points.length < 2) return 0;
    var sum = 0, cnt = 0;
    for (var i = 0; i < points.length; i++) for (var j = i + 1; j < points.length; j++) {
      sum += Math.abs(points[i].r - points[j].r) + Math.abs(points[i].c - points[j].c); cnt++;
    }
    return cnt ? +(sum / cnt).toFixed(2) : 0;
  }

  /**
   * 按配额抽取本关使用的卡点类型（用户 2026-08-24 参数化三项要求）。
   *   ① 数量可配：chokeTypeCountNormal / chokeTypeCountBoss
   *   ② 类型不可重合：无放回抽样，同一关不会重复抽到同一类型
   *   ③ BOSS 与普通关分别配额：由 isBoss 选用哪个数量
   * chokeTypes[key] = 权重（0 或缺省 = 该类型不参与抽取）。
   * 全部权重为 0 时返回空数组 → 各处走原有行为，与本功能引入前完全一致。
   * @returns {object} { types:[key...], cn:[中文名...], count, isBoss, pool:候选类型数 }
   */
  function pickChokeTypes(config, isBoss) {
    config = config || {};
    var weights = config.chokeTypes || {};
    var pool = [];
    for (var i = 0; i < CHOKE_TYPE_LIST.length; i++) {
      var t = CHOKE_TYPE_LIST[i], w = weights[t.key];
      if (typeof w === 'number' && w > 0) pool.push({ key: t.key, cn: t.cn, w: w });
    }
    var poolSize = pool.length;
    // ===== v115：数量由「检查次数 × 概率」决定，替代固定 N =====
    // 任务 ANT-GEN-PARAM-RANGE-CHOKE-PROB-20260827。用户裁决：
    //   「替代，因为旧的机制无法用稳定的期望算出会出多少这样卡点类型，同时也无法制造波动」
    //   「预算是指检查次数预算耗尽」
    // 机制：掷 rolls 次，每次以 P 判定是否出现；出现则从【已勾选且未被抽中】的池里加权随机取一个
    //       （沿用任务 W 的「同关内类型不重合」约束）。池耗尽后剩余次数不再产生新类型。
    // 旧参数 chokeTypeCountNormal/Boss 已停用（仍读取仅为兼容旧方案：rolls 未设时退回它，
    //       此时 P 视为 1 以复现"固定抽 N 种"的旧行为）。
    var rolls = isBoss
      ? (config.chokeTypeRollsBoss != null ? config.chokeTypeRollsBoss : null)
      : (config.chokeTypeRollsNormal != null ? config.chokeTypeRollsNormal : null);
    var prob = (config.chokeTypeProb != null) ? config.chokeTypeProb : 0.5;
    var legacyMode = false;
    if (!rolls) {
      // 兼容：未设 rolls 时退回旧的固定数量口径（P=1 等价于必出）
      var legacyN = isBoss
        ? (config.chokeTypeCountBoss != null ? config.chokeTypeCountBoss : 0)
        : (config.chokeTypeCountNormal != null ? config.chokeTypeCountNormal : 0);
      rolls = Math.max(0, legacyN);
      prob = 1;
      legacyMode = rolls > 0;
    }
    if (prob < 0) prob = 0; else if (prob > 1) prob = 1;
    var chosen = [];
    var hits = 0;
    for (var roll = 0; roll < rolls; roll++) {
      if (!pool.length) break;                       // 池耗尽：剩余检查次数不再产生新类型
      if (rnd() >= prob) continue;           // 本次未出现
      hits++;
      var sum = 0, j;
      for (j = 0; j < pool.length; j++) sum += pool[j].w;
      if (sum <= 0) break;
      var x = rnd() * sum, hit = pool.length - 1;
      for (j = 0; j < pool.length; j++) { x -= pool[j].w; if (x <= 0) { hit = j; break; } }
      chosen.push(pool[hit]);
      pool.splice(hit, 1);
    }
    // 数学期望：每次检查独立以 P 命中，但池只有 poolSize 个且不重复 →
    // 命中次数 ~ B(rolls, P)，实际类型数 = min(命中次数, poolSize)。
    // E[min(X, m)] = Σ_{k=0..m-1} k·P(X=k) + m·P(X≥m)，下面按此精确式算（rolls 很小，直接枚举）。
    var expected = 0;
    if (rolls > 0 && poolSize > 0) {
      var logFact = function (n) { var s = 0; for (var i2 = 2; i2 <= n; i2++) s += Math.log(i2); return s; };
      var cum = 0;
      for (var kk = 0; kk < poolSize && kk <= rolls; kk++) {
        var logC = logFact(rolls) - logFact(kk) - logFact(rolls - kk);
        var pk = Math.exp(logC + (prob > 0 ? kk * Math.log(prob) : (kk === 0 ? 0 : -Infinity)) +
          (prob < 1 ? (rolls - kk) * Math.log(1 - prob) : (rolls - kk === 0 ? 0 : -Infinity)));
        if (!isFinite(pk) || isNaN(pk)) pk = 0;
        expected += kk * pk; cum += pk;
      }
      expected += Math.min(poolSize, rolls) * Math.max(0, 1 - cum);
    }
    var keys = [], cns = [], map = {};
    for (var k = 0; k < chosen.length; k++) { keys.push(chosen[k].key); cns.push(chosen[k].cn); map[chosen[k].key] = true; }
    return {
      types: keys, cn: cns, has: map, count: keys.length, isBoss: !!isBoss,
      pool: poolSize,
      // v115 可观测字段：便于把「设定期望」与「批量实测均值」对照
      rolls: rolls, prob: prob, hits: hits,
      expected: +expected.toFixed(4),
      legacyMode: legacyMode
    };
  }

  function planObstacleSlotsFixed(cells, rows, cols, config, narrowGaps, chokePlan, pipeExits) {
    var CK = (chokePlan && chokePlan.has) || {};
    var nullCells = [];
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) if (cells[r][c] == null) nullCells.push({ r: r, c: c });
    var boxTarget = nullCells.length;
    var iceKey = {}, qKey = {}, chainKey = {};
    var iceSlots = [], questionSlots = [], chainGroups = [];
    // 【v120】卡点手段的落地位置清单：每个实际生效的卡点单元一条，供报告与模拟界面显示「什么卡点、在哪」。
    //   现有 chokeStat 只有计数与布尔标记，回答不了「位置」——用户要求报告与模拟界面显示卡点类型信息与位置。
    var chokeMarks = [];
    function mark(type, cn, r, c, detail) { chokeMarks.push({ type: type, cn: cn, r: r, c: c, detail: detail || null }); }
    // 进度带（默认 15%~80%）内的候选格：只给卡点类型手段用，基础障碍仍铺满全盘
    var bandCells = clipByProgress(nullCells, config, nullCells);
    // 【v120】窄路本身也是一个卡点类型了，把它的缺口位置记进 chokeMarks
    if (narrowGaps && narrowGaps.length && (CK.narrowPath || !chokeTypingActive(config))) {
      for (var ngm = 0; ngm < narrowGaps.length; ngm++) {
        mark('narrowPath', '窄路墙缺口', narrowGaps[ngm].r, narrowGaps[ngm].c, { gaps: narrowGaps.length });
      }
    }

    // ① 数字冰预定位置（全棋盘可出现，含第0行）
    // 【v187·实验】定向冰：结构层不放随机冰，改到"盒落位 + 债务节拍"之后按配额补（topUpIce）。
    //   config.iceTargeted === true 才生效；默认关，口径与 v186 逐值一致。
    var iceCount = config.iceTargeted ? 0 : Math.floor(boxTarget * (config.icePercent || 0) / 100);
    var iceClusterStat = null;
    if (iceCount > 0) {
      // 卡点类型 iceCluster：同样数量的数字冰改为【聚集】铺设，在局部形成长时间锁死区。
      //   v120 起改用【四方向 BFS 连通块】生长，簇大小由 iceClusterSize* 直接控制（用户 q2-1）；
      //   且只在进度带内落位。未选中该类型时仍走原来的 pickDispersed（主动分散，最小间距 2），行为不变。
      var iceSel;
      if (CK.iceCluster) {
        var icMin = config.iceClusterSizeMin != null ? config.iceClusterSizeMin : 4;
        var icMax = config.iceClusterSizeMax != null ? config.iceClusterSizeMax : 6;
        iceSel = pickClusteredBFS(bandCells, iceCount, icMin, icMax);
        iceClusterStat = { clusters: (iceSel._clusters || []).length, sizeMin: icMin, sizeMax: icMax,
          sizes: (iceSel._clusters || []).map(function (x) { return x.size; }) };
        (iceSel._clusters || []).forEach(function (cl) {
          mark('iceCluster', '数字冰簇聚集', cl.seed.r, cl.seed.c, { size: cl.size });
        });
      } else {
        iceSel = pickDispersed(nullCells, iceCount, 2);
      }
      // 【v252·用户裁决】第 0 行允许有冰，但不要"一堆"：最多 row0IceMax 块（默认 1）。
      //   超出部分换成非第 0 行的格子（保持总数不变，只是把位置挪走）。
      var _r0max = (config.row0IceMax != null) ? Math.max(0, parseInt(config.row0IceMax, 10) || 0) : 1;
      var _r0cnt = 0, _used = {};
      for (var _ii = 0; _ii < iceSel.length; _ii++) _used[iceSel[_ii].r + ',' + iceSel[_ii].c] = 1;
      for (var _ij = 0; _ij < iceSel.length; _ij++) {
        if (iceSel[_ij].r !== 0) continue;
        if (_r0cnt < _r0max) { _r0cnt++; continue; }
        var _pool2 = nullCells.filter(function (pp) { return pp.r !== 0 && !_used[pp.r + ',' + pp.c]; });
        if (!_pool2.length) continue;
        var _rep = _pool2[Math.floor(rnd() * _pool2.length)];
        delete _used[iceSel[_ij].r + ',' + iceSel[_ij].c];
        _used[_rep.r + ',' + _rep.c] = 1;
        iceSel[_ij] = _rep;
      }
      for (var i = 0; i < iceSel.length; i++) {
        var k = iceSel[i].r + ',' + iceSel[i].c;
        if (iceKey[k]) continue;
        iceKey[k] = 1; iceSlots.push({ r: iceSel[i].r, c: iceSel[i].c, src: CK.iceCluster ? 'iceCluster' : 'base' });
      }
    }
    // 窄路缺口冰(临时锁路)：必须落在缺口格
    // 【v120】卡点类型 narrowGapIce 现在**真正按抽中生效**（用户 q1 把窄路整套接入类型池）。
    //   v103~v119 的问题：`chokeGateNarrowByType` 默认 false 使门控条件恒真 → 勾选与不勾选毫无差别，
    //   但该类型仍会被抽中、占掉一个「卡点类型数」名额、计入 chokeCount、写进报告，纯属空占。
    //   现在：启用类型化时以「是否抽中」为准；未启用类型化时才回落旧的 narrowPathIce 总开关。
    //   参数 narrowGapIceCount：叠 N 个冰（用户 q2-6），从缺口格起沿可用盒格四方向 BFS 取 N 格。
    var typingOn = chokeTypingActive(config);
    var wantGapIce = typingOn ? !!CK.narrowGapIce : (config.narrowPath && config.narrowPathIce !== false);
    var gapIceStat = null;
    if (wantGapIce && narrowGaps && narrowGaps.length) {
      var gapIceN = config.narrowGapIceCount != null ? Math.max(1, parseInt(config.narrowGapIceCount, 10)) : 2;
      var gapIceAdded = 0;
      var d4g = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      for (var g0 = 0; g0 < narrowGaps.length; g0++) {
        var gp0 = narrowGaps[g0];
        // 从缺口格出发 BFS，取最多 gapIceN 个「未来盒格且未加冰」的格
        var gq = [gp0], gseen = {}, gTook = 0;
        gseen[gp0.r + ',' + gp0.c] = 1;
        while (gq.length && gTook < gapIceN) {
          var gc = gq.shift();
          var gk = gc.r + ',' + gc.c;
          if (cells[gc.r] && cells[gc.r][gc.c] == null && !iceKey[gk]) {
            iceKey[gk] = 1;
            iceSlots.push({ r: gc.r, c: gc.c, src: 'narrowGap' });
            gTook++; gapIceAdded++;
            if (gTook === 1) mark('narrowGapIce', '窄路口叠数字冰', gc.r, gc.c, { count: gapIceN });
          }
          for (var gd = 0; gd < 4; gd++) {
            var gnr = gc.r + d4g[gd][0], gnc = gc.c + d4g[gd][1], gnk = gnr + ',' + gnc;
            if (gnr < 0 || gnr >= rows || gnc < 0 || gnc >= cols || gseen[gnk]) continue;
            if (cells[gnr][gnc] != null) continue;      // 只沿未来盒格扩散
            gseen[gnk] = 1; gq.push({ r: gnr, c: gnc });
          }
        }
      }
      gapIceStat = { perGap: gapIceN, added: gapIceAdded, gaps: narrowGaps.length };
    }

    // ② 问号预定位置（不在第0行；可与冰叠加；不与锁链叠加——锁链在其后规划时会避开）
    var qClusterStat = null;
    var qCount = Math.floor(boxTarget * (config.questionPercent || 0) / 100);
    if (qCount % 2 === 1) qCount--;
    if (qCount >= 2) {
      var qPool = nullCells.filter(function (p) { return p.r !== 0; });
      // 卡点类型 questionCluster：问号改为聚集，形成"一片都看不清"的区域（只影响玩家判断，不改可解性）
      //   v120 起用【到簇中心的 BFS 距离阈值】收团（用户 q2-3），并限制在进度带内。
      var qSel;
      if (CK.questionCluster) {
        var qRad = config.questionClusterRadius != null ? Math.max(1, parseInt(config.questionClusterRadius, 10)) : 2;
        var qBand = clipByProgress(qPool, config, nullCells);
        qSel = pickClusteredRadius(qBand, qCount, qRad);
        qClusterStat = { clusters: (qSel._clusters || []).length, radius: qRad,
          sizes: (qSel._clusters || []).map(function (x) { return x.size; }) };
        (qSel._clusters || []).forEach(function (cl) {
          mark('questionCluster', '问号聚集', cl.center.r, cl.center.c, { radius: qRad, size: cl.size });
        });
      } else {
        qSel = pickDispersed(qPool, qCount, 2);
      }
      if (qSel.length % 2 === 1) qSel.pop();
      for (var qi = 0; qi < qSel.length; qi++) {
        var qk = qSel[qi].r + ',' + qSel[qi].c;
        if (qKey[qk]) continue;
        qKey[qk] = 1; questionSlots.push({ r: qSel[qi].r, c: qSel[qi].c });
      }
      if (questionSlots.length % 2 === 1) { var drop = questionSlots.pop(); delete qKey[drop.r + ',' + drop.c]; }
    }

    // ③ 锁链组预定位置（2/3 连，正交相邻；不同组不 8-邻接；避开问号预定格）
    var dirs4 = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    var dirs8 = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]];
    function freeForChain(r, c) {
      if (r < 0 || r >= rows || c < 0 || c >= cols) return false;
      if (cells[r][c] != null) return false;                 // 必须是未来盒格
      // 【v309·用户裁决】锁链不是"绝对不能放最后一行"，要看局面（障碍放置另行讨论）。
      //   这里只保留一个开关：config.chainNoBottomRow（默认 off = 允许）
      if (config.chainNoBottomRow && r >= rows - 1) return false;
      var k = r + ',' + c;
      return !chainKey[k] && !qKey[k];                        // 不与问号/其他锁链叠加
    }
    function plannedConflict(members, group) {
      var mset = {};
      for (var m = 0; m < members.length; m++) mset[members[m].r + ',' + members[m].c] = 1;
      for (var i2 = 0; i2 < members.length; i2++) for (var d = 0; d < 8; d++) {
        var nr = members[i2].r + dirs8[d][0], nc = members[i2].c + dirs8[d][1];
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        if (mset[nr + ',' + nc]) continue;
        var og = chainKey[nr + ',' + nc];
        // 卡点类型 chainCluster：允许不同锁链组彼此 8-邻接，从而形成"锁链簇"——
        //   多组同时索要暂存空位，压力形态与分散的独立组完全不同。
        //   未选中该类型时保持原约束（组间禁止 8-邻接）。
        if (og && og !== group) { if (!CK.chainCluster) return true; }
      }
      return false;
    }
    /**
     * 结构阶段的锁链可激活性判定（与填球后 chainActivatable 拓扑等价）。
     * 关键点：直接调用 chainActivatable() 在本阶段会恒返回 true——因为本组成员此刻仍是 null 格，
     * 被 isEmptyLike 当成"空格可通行"，成员必然显得已暴露。这里显式把【本组预定成员】视作障碍、
     * 其余未来盒格视作"最终会被移除"(可通行)、黑块/管道视作墙，即完全复刻绑定后的最大激活态，
     * 从而在规划期就淘汰不可激活的组，而不是等到绑定阶段整个候选作废。
     */
    function plannedChainActivatable(members) {
      var mset = {};
      for (var m = 0; m < members.length; m++) mset[members[m].r + ',' + members[m].c] = 1;
      function passable(r, c) {
        if (mset[r + ',' + c]) return false;            // 本组成员=障碍
        var ce = cells[r][c];
        if (ce == null) return true;                     // 未来盒格：最终会被取走 → 可通行
        if (ce.t === 'black' || ce.t === 'pipe') return false;
        return true;
      }
      var vis = AntSolver.create2D(rows, cols, false), q = [];
      for (var c0 = 0; c0 < cols; c0++) if (passable(0, c0)) { vis[0][c0] = true; q.push([0, c0]); }
      for (var h = 0; h < q.length; h++) {
        var r1 = q[h][0], c1 = q[h][1];
        for (var d = 0; d < 4; d++) {
          var nr = r1 + dirs4[d][0], nc = c1 + dirs4[d][1];
          if (nr < 0 || nr >= rows || nc < 0 || nc >= cols || vis[nr][nc]) continue;
          if (passable(nr, nc)) { vis[nr][nc] = true; q.push([nr, nc]); }
        }
      }
      for (var mi2 = 0; mi2 < members.length; mi2++) {
        var mr = members[mi2].r, mc = members[mi2].c;
        if (mr === 0) continue;                          // 第0行默认可激活
        var exposed = false;
        for (var dd = 0; dd < 4; dd++) {
          var er = mr + dirs4[dd][0], ec = mc + dirs4[dd][1];
          if (er < 0 || er >= rows || ec < 0 || ec >= cols) continue;
          if (vis[er][ec]) { exposed = true; break; }
        }
        if (!exposed) return false;
      }
      return true;
    }
    /**
     * 【锁链档位组合】任务 ANT-DIFFICULTY-SYSTEM-V2-20260901，用户 2026-09-02 授权。
     * `wantSize` 非 null 时**必须精确长到该长度**才算成功（见 growGroup 末尾），
     * 否则 3 连会静默退化成 2 连、档位又不可控。null = 原抛硬币行为。
     */
    function growGroup(seed, minRow, maxRow, group, wantSize) {
      var members = [{ r: seed.r, c: seed.c }];
      var size = (wantSize != null) ? wantSize : ((rnd() < 0.5) ? 3 : 2), guard = 0;
      while (members.length < size && guard++ < 30) {
        var grew = false;
        for (var mi = 0; mi < members.length && !grew; mi++) {
          var order = shuffle(dirs4.slice());
          for (var d = 0; d < order.length; d++) {
            var nr = members[mi].r + order[d][0], nc = members[mi].c + order[d][1];
            if (nr < minRow || nr > maxRow) continue;
            if (!freeForChain(nr, nc)) continue;
            var dup = false;
            for (var mm = 0; mm < members.length; mm++) if (members[mm].r === nr && members[mm].c === nc) { dup = true; break; }
            if (dup) continue;
            members.push({ r: nr, c: nc }); grew = true; break;
          }
        }
        if (!grew) break;
      }
      // 档位模式：长度必须精确等于 wantSize；否则视为失败（不接受退化长度）
      if (wantSize != null ? (members.length !== wantSize) : (members.length < 2)) return null;
      if (plannedConflict(members, group)) return null;
      if (!plannedChainActivatable(members)) return null;   // 规划期即排除不可激活的组
      return members;
    }
    var group = 1;
    var chainClusterStat = null;

    // ===== 锁链档位队列（同 DEFAULT_CONFIG 的 chainTierPool / chain2Count / chain3Count）=====
    // 三个入口优先级：chainTierPool（每关随机抽一档）> chain2Count+chain3Count（显式定值）> null（原抛硬币）。
    // 只在**规划成功**时消耗队列，失败不消耗 —— 否则一次落位失败就永久丢掉一组，实际档位低于设定。
    var chainWant = (function () {
      var pool = config.chainTierPool;
      if (pool && pool.length) {
        var pk = pool[Math.floor(rnd() * pool.length)];
        var a = (pk && pk.g2 != null) ? pk.g2 : (pk ? pk[0] : 0);
        var b = (pk && pk.g3 != null) ? pk.g3 : (pk ? pk[1] : 0);
        return { g2: Math.max(0, a | 0), g3: Math.max(0, b | 0), src: 'tierPool' };
      }
      if (config.chain2Count != null && config.chain3Count != null) {
        return { g2: Math.max(0, config.chain2Count | 0), g3: Math.max(0, config.chain3Count | 0), src: 'explicit' };
      }
      return null;
    })();
    var chainSizeQueue = null;
    if (chainWant) {
      chainSizeQueue = [];
      for (var cq3 = 0; cq3 < chainWant.g3; cq3++) chainSizeQueue.push(3);
      for (var cq2 = 0; cq2 < chainWant.g2; cq2++) chainSizeQueue.push(2);
      chainSizeQueue = shuffle(chainSizeQueue);
      config._chainTierWant = { g2: chainWant.g2, g3: chainWant.g3, src: chainWant.src };
    }

    function planBatch(count, minRow, tag) {
      var placed = 0;
      if (count <= 0) return;
      var pool = nullCells.filter(function (p) { return p.r >= minRow && freeForChain(p.r, p.c); });
      var cand = pickDispersed(pool, count * 4 + 6, 2);
      for (var ci = 0; ci < cand.length && placed < count; ci++) {
        if (chainSizeQueue && !chainSizeQueue.length) break;      // 队列空 → 不再规划
        if (!freeForChain(cand[ci].r, cand[ci].c)) continue;
        var wantSize = chainSizeQueue ? chainSizeQueue[0] : null;  // peek，成功才 shift
        var members = growGroup(cand[ci], minRow, rows - 1, group, wantSize);
        if (!members) continue;
        for (var mk = 0; mk < members.length; mk++) chainKey[members[mk].r + ',' + members[mk].c] = group;
        chainGroups.push({ group: group, size: members.length, type: members.length === 3 ? '三连' : '二连', src: tag, members: members });
        group++; placed++;
        if (chainSizeQueue) chainSizeQueue.shift();
      }
    }
    /**
     * 【v120】锁链簇：把 N 个锁链组**聚成一簇**（用户 q2-2「N 个锁链聚集（同冰块蔟）」）。
     * v103~v119 的 chainCluster 只是「放开组间 8-邻接约束」，聚不聚、聚几组完全不可控。
     * 现在显式实现：选一个簇锚点 → 长出第 1 组 → 后续各组的种子从「已放成员的四方向邻格」里挑，
     * 直到该簇凑满 N 组；再开下一簇。同时记录簇内成员的 BFS 平均距离作为度量（用户给的第二个口径）。
     * 只在进度带内选锚点。
     */
    /**
     * 【v120】严格版可激活性：把**所有已规划的锁链格**（不只本组）都视作障碍。
     * 为什么需要它：`plannedChainActivatable` 只把「本组成员」当障碍，其余锁链格算可通行 ——
     * 组之间分散时这个近似没问题，但锁链簇是**故意让多组紧贴**，一组的成员很可能被邻组成员围住。
     * 于是规划期放行、填球后真正的 `chainActivatable` 却不过，整个候选被淘汰，
     * 最终触发 v103 的「聚集类风险回退」把 chainCluster 摘掉 —— 实测 5/5 全被摘，等于该类型永远不生效。
     * 用严格判据在规划期就换个锚点重试，才能真正把簇摆出来。
     */
    function plannedChainActivatableStrict(members) {
      var obst = {}, kk;
      for (kk in chainKey) if (Object.prototype.hasOwnProperty.call(chainKey, kk)) obst[kk] = 1;
      for (var m = 0; m < members.length; m++) obst[members[m].r + ',' + members[m].c] = 1;
      function passable(r, c) {
        if (obst[r + ',' + c]) return false;
        var ce = cells[r][c];
        if (ce == null) return true;                       // 未来盒格：最终会被取走 → 可通行
        if (ce.t === 'black' || ce.t === 'pipe') return false;
        return true;
      }
      var vis = AntSolver.create2D(rows, cols, false), q = [];
      for (var c0 = 0; c0 < cols; c0++) if (passable(0, c0)) { vis[0][c0] = true; q.push([0, c0]); }
      for (var h = 0; h < q.length; h++) {
        for (var d = 0; d < 4; d++) {
          var nr = q[h][0] + dirs4[d][0], nc = q[h][1] + dirs4[d][1];
          if (nr < 0 || nr >= rows || nc < 0 || nc >= cols || vis[nr][nc]) continue;
          if (passable(nr, nc)) { vis[nr][nc] = true; q.push([nr, nc]); }
        }
      }
      for (var mi = 0; mi < members.length; mi++) {
        var mr = members[mi].r, mc = members[mi].c;
        if (mr === 0) continue;
        var exposed = false;
        for (var dd = 0; dd < 4; dd++) {
          var er = mr + dirs4[dd][0], ec = mc + dirs4[dd][1];
          if (er < 0 || er >= rows || ec < 0 || ec >= cols) continue;
          if (vis[er][ec]) { exposed = true; break; }
        }
        if (!exposed) return false;
      }
      return true;
    }
    function planChainClusters(total, minRow) {
      var gMin = config.chainClusterGroupsMin != null ? Math.max(2, parseInt(config.chainClusterGroupsMin, 10)) : 2;
      var gMax = config.chainClusterGroupsMax != null ? Math.max(gMin, parseInt(config.chainClusterGroupsMax, 10)) : 3;
      var placed = 0, clusters = [];
      var pool = bandCells.filter(function (p) { return p.r >= minRow && freeForChain(p.r, p.c); });
      var anchors = shuffle(pool.slice());
      var d4c = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      for (var ai = 0; ai < anchors.length && placed < total; ai++) {
        if (!freeForChain(anchors[ai].r, anchors[ai].c)) continue;
        var want = gMin + ((rnd() * (gMax - gMin + 1)) | 0);
        if (want > total - placed) want = total - placed;
        var clusterMembers = [], groupsInCluster = 0, frontier = [anchors[ai]], guard = 0;
        while (groupsInCluster < want && frontier.length && guard++ < 40) {
          var seed = frontier.shift();
          if (!freeForChain(seed.r, seed.c)) continue;
          var mem = growGroup(seed, minRow, rows - 1, group);
          if (!mem) continue;
          // 严格判据：连同已规划的其他锁链一起看，这组还能不能全员暴露。
          // 不过就换下一个种子，而不是把不可解的簇留到填球后被整候选淘汰。
          if (!plannedChainActivatableStrict(mem)) continue;
          for (var mk2 = 0; mk2 < mem.length; mk2++) {
            chainKey[mem[mk2].r + ',' + mem[mk2].c] = group;
            clusterMembers.push(mem[mk2]);
            // 该组成员的四方向邻格作为下一组的候选种子 → 组与组四方向相邻，形成真正的簇
            for (var dc = 0; dc < 4; dc++) {
              var fr = mem[mk2].r + d4c[dc][0], fc = mem[mk2].c + d4c[dc][1];
              if (fr < minRow || fr >= rows || fc < 0 || fc >= cols) continue;
              if (freeForChain(fr, fc)) frontier.push({ r: fr, c: fc });
            }
          }
          chainGroups.push({ group: group, size: mem.length, type: mem.length === 3 ? '三连' : '二连',
            src: 'chainCluster', members: mem, clusterId: clusters.length + 1 });
          group++; placed++; groupsInCluster++;
        }
        if (groupsInCluster >= 2) {
          clusters.push({ groups: groupsInCluster, avgDist: avgManhattan(clusterMembers),
            anchor: { r: anchors[ai].r, c: anchors[ai].c } });
          mark('chainCluster', '锁链簇聚集', anchors[ai].r, anchors[ai].c,
            { groups: groupsInCluster, avgDist: avgManhattan(clusterMembers) });
        }
      }
      chainClusterStat = { clusters: clusters.length, groupsMin: gMin, groupsMax: gMax,
        placedGroups: placed, detail: clusters };
      return placed;
    }
    // 档位模式下总组数由档位给出（g2+g3），不再读 chainCount —— 两者同时给会行为不明确。
    var totalChains = chainWant ? (chainWant.g2 + chainWant.g3) : Math.max(0, config.chainCount || 0);
    if (totalChains > 0) {
      var ratio = (typeof config.chainInitialRatio === 'number') ? config.chainInitialRatio : 0.5;
      var n1 = Math.round(totalChains * ratio);
      if (CK.chainCluster && !chainWant) {
        // 【v120】抽中锁链簇：先按「N 组一簇」放掉一部分配额，剩余的仍按原来的分散铺法补齐，
        //   这样锁链总数仍等于 chainCount（不因聚集而变多变少），只是**摆位**变了。
        // ⚠ 档位模式下跳过簇规划：簇规划自己决定每组长度，会绕过档位队列。
        //   锁链簇与档位的组合属批次03「落位×档位」交叉实验，待落位实现后再打通。
        var clustered = planChainClusters(n1, 0);
        if (clustered < n1) planBatch(n1 - clustered, 0, 'batch1');
        planBatch(totalChains - n1, Math.floor(rows * 0.5), 'batch2');
      } else {
        planBatch(n1, 0, 'batch1');
        planBatch(totalChains - n1, Math.floor(rows * 0.5), 'batch2');
        // 档位模式：前两批受「分散度 + 可激活性 + 组间不相邻」约束可能放不满，
        // 再补一轮全盘，避免实际档位低于设定（那会让受控实验失真）。补轮不降低任何合法性标准。
        if (chainSizeQueue && chainSizeQueue.length) planBatch(chainSizeQueue.length, 0, 'batch3-fill');
      }
      if (chainWant) {
        var pg2 = 0, pg3 = 0;
        for (var pgi = 0; pgi < chainGroups.length; pgi++) {
          if (chainGroups[pgi].size === 2) pg2++; else if (chainGroups[pgi].size === 3) pg3++;
        }
        // 规划期的设定 vs 实际。注意绑定期（fillStructureFixed）与顶部障碍封顶还可能再摘组，
        // 因此**最终关卡的档位仍需从棋盘现场重数**，这里只记规划期结果。
        config._chainTierPlanned = { g2: pg2, g3: pg3, shortfall: chainSizeQueue.length };
      }
    }
    // 窄路缺口锁链：成员只取【墙带及以上】(r<=缺口行)，组号高位 90+
    // 【v120】卡点类型 narrowGapChain 同 narrowGapIce，现在真正按抽中生效（用户 q1）。
    //   用户 q2-7：「窄路口：随机叠加锁链即可」→ 无额外参数，沿用既有的随机 2/3 连生长。
    var wantGapChain = typingOn ? !!CK.narrowGapChain : (config.narrowPath && config.narrowPathChain !== false);
    if (wantGapChain && narrowGaps && narrowGaps.length) {
      var ng = 90;
      for (var gi2 = 0; gi2 < narrowGaps.length; gi2++) {
        var gp = narrowGaps[gi2];
        if (!freeForChain(gp.r, gp.c)) continue;
        var mem = null, size2 = (rnd() < 0.5) ? 3 : 2, tries = 0;
        var acc = [{ r: gp.r, c: gp.c }];
        while (acc.length < size2 && tries++ < 20) {
          var grew2 = false;
          for (var ai = 0; ai < acc.length && !grew2; ai++) {
            var ord = shuffle([[-1, 0], [0, -1], [0, 1]]);
            for (var d2 = 0; d2 < ord.length; d2++) {
              var nr2 = acc[ai].r + ord[d2][0], nc2 = acc[ai].c + ord[d2][1];
              if (nr2 < 0 || nr2 > gp.r) continue;               // 只在墙带及以上
              if (!freeForChain(nr2, nc2)) continue;
              var dup2 = false;
              for (var m2 = 0; m2 < acc.length; m2++) if (acc[m2].r === nr2 && acc[m2].c === nc2) { dup2 = true; break; }
              if (dup2) continue;
              acc.push({ r: nr2, c: nc2 }); grew2 = true; break;
            }
          }
          if (!grew2) break;
        }
        if (acc.length >= 2 && !plannedConflict(acc, ng) && plannedChainActivatable(acc)) mem = acc;
        if (!mem) continue;
        for (var mkn = 0; mkn < mem.length; mkn++) chainKey[mem[mkn].r + ',' + mem[mkn].c] = ng;
        chainGroups.push({ group: ng, size: mem.length, type: mem.length === 3 ? '三连' : '二连', src: 'narrowGap', members: mem });
        mark('narrowGapChain', '窄路口叠锁链', gp.r, gp.c, { size: mem.length });
        ng++;
      }
    }

    // ④ 卡点类型 pipeChain：把锁链组锚在【管道出口格】上（用户 2026-08-24 q5）。
    //   管道口的盒本来"一吐出来就暴露"，是最容易取的位置；叠上锁链后它必须等组内伙伴一起激活，
    //   于是管道的吐球节奏被锁住 —— 与既有任何手段都不同（换球改色、增容改量，都不改取盒时序）。
    //   出口格由调用方经 pipeExits 传入（planObstacleSlotsFixed 自身看不到 exitSet）。
    var pipeChainStat = { attempted: false, placed: 0 };
    if (CK.pipeChain && pipeExits && pipeExits.length) {
      pipeChainStat.attempted = true;
      var pg = 80;   // 组号高位段：80~89 专用于管道口锁链，便于产物里区分来源
      for (var pe = 0; pe < pipeExits.length && pg < 90; pe++) {
        var ex = pipeExits[pe];
        if (!freeForChain(ex.r, ex.c)) continue;
        var pacc = [{ r: ex.r, c: ex.c }], psize = (rnd() < 0.5) ? 3 : 2, ptry = 0;
        while (pacc.length < psize && ptry++ < 20) {
          var pgrew = false;
          for (var pi2 = 0; pi2 < pacc.length && !pgrew; pi2++) {
            var pord = shuffle(dirs4.slice());
            for (var pd = 0; pd < pord.length; pd++) {
              var pnr = pacc[pi2].r + pord[pd][0], pnc = pacc[pi2].c + pord[pd][1];
              if (!freeForChain(pnr, pnc)) continue;
              var pdup = false;
              for (var pm = 0; pm < pacc.length; pm++) if (pacc[pm].r === pnr && pacc[pm].c === pnc) { pdup = true; break; }
              if (pdup) continue;
              pacc.push({ r: pnr, c: pnc }); pgrew = true; break;
            }
          }
          if (!pgrew) break;
        }
        if (pacc.length < 2) continue;
        if (plannedConflict(pacc, pg)) continue;
        if (!plannedChainActivatable(pacc)) continue;     // 规划期即排除不可激活的组，避免整候选作废
        for (var pk = 0; pk < pacc.length; pk++) chainKey[pacc[pk].r + ',' + pacc[pk].c] = pg;
        chainGroups.push({ group: pg, size: pacc.length, type: pacc.length === 3 ? '三连' : '二连', src: 'pipeExit', members: pacc });
        // 用户 q2-5：「管道口：随机指定管道口即可」→ 无参数；pipeExits 顺序已由上游打乱，此处顺序取即随机
        mark('pipeChain', '管道口叠锁链', ex.r, ex.c, { size: pacc.length });
        pg++; pipeChainStat.placed++;
      }
    }

    // ⑤ 卡点类型 chainIce：给锁链成员定向叠冰（用户 2026-08-24 q3）。
    //   锁链要求【组内全员已激活且冰已解】才能取；叠冰后整组解锁被推迟 durability 步，
    //   期间已激活的伙伴只能干等 —— 把"空间锁"（锁链）和"时间锁"（冰）串起来。
    //   只叠在部分成员上（默认每组 1 个），叠满会让组几乎不可解。
    var chainIceStat = { attempted: false, added: 0 };
    if (CK.chainIce && chainGroups.length) {
      chainIceStat.attempted = true;
      // 【v120】用户 q2-4：「冰叠锁链：叠加1端，叠加2端」→ 参数 chainIceEnds ∈ {1,2}，
      //   「端」= 组内**度 ≤ 1** 的成员（二连两端都是端；三连直线取两个端点，L 形取拐角外的两格）。
      //   叠在端点而不是随机成员：端点是整组最后才可能被解开的位置，压力最大且形态可预期。
      var ends = config.chainIceEnds != null ? Math.max(1, Math.min(2, parseInt(config.chainIceEnds, 10))) : 1;
      var perGroupCap = config.chainIcePerGroup != null ? Math.max(1, config.chainIcePerGroup) : 2;
      var perGroup = Math.min(ends, perGroupCap);
      var groupQuota = config.chainIceGroups != null ? config.chainIceGroups : Math.ceil(chainGroups.length / 2);
      var gOrder = shuffle(chainGroups.slice());
      for (var gi3 = 0; gi3 < gOrder.length && gi3 < groupQuota; gi3++) {
        var mem3 = gOrder[gi3].members || [], added = 0;
        // 算组内度：与同组其他成员四方向相邻的个数
        var degList = mem3.map(function (m, idx) {
          var deg = 0;
          for (var o = 0; o < mem3.length; o++) {
            if (o === idx) continue;
            if (Math.abs(mem3[o].r - m.r) + Math.abs(mem3[o].c - m.c) === 1) deg++;
          }
          return { p: m, deg: deg };
        });
        degList.sort(function (a, b) { return a.deg - b.deg; });     // 度小者优先 = 端点优先
        for (var mi3 = 0; mi3 < degList.length && added < perGroup; mi3++) {
          var ik = degList[mi3].p.r + ',' + degList[mi3].p.c;
          if (iceKey[ik]) continue;                        // 已有冰则跳过，不重复计数
          iceKey[ik] = 1;
          iceSlots.push({ r: degList[mi3].p.r, c: degList[mi3].p.c, src: 'chainIce' });
          added++; chainIceStat.added++;
          if (added === 1) mark('chainIce', '数字冰叠锁链', degList[mi3].p.r, degList[mi3].p.c,
            { ends: ends, group: gOrder[gi3].group });
        }
      }
      chainIceStat.ends = ends;
    }

    return {
      boxTarget: boxTarget, iceSlots: iceSlots, questionSlots: questionSlots, chainGroups: chainGroups,
      // 【v120】chokeMarks：每个生效的卡点手段一条 {type,cn,r,c,detail}，供报告与模拟界面显示「什么卡点、在哪」。
      chokeMarks: chokeMarks,
      chokeStat: {
        pipeChain: pipeChainStat, chainIce: chainIceStat,
        iceClustered: !!CK.iceCluster, questionClustered: !!CK.questionCluster, chainClustered: !!CK.chainCluster,
        // v120 逐类参数的实际落地情况
        iceCluster: iceClusterStat, questionCluster: qClusterStat, chainCluster: chainClusterStat,
        narrowGapIce: gapIceStat,
        chokePos: { min: config.chokePosMin != null ? config.chokePosMin : 0.15,
                    max: config.chokePosMax != null ? config.chokePosMax : 0.80,
                    bandCells: bandCells.length, allCells: nullCells.length }
      }
    };
  }

  /**
   * R01+R02：构建【不带球】的结构候选。
   * 顺序：行列 → 窄路墙 → 分散黑块(真实落位) → 用实际剩余空间算管道并落位 → 障碍预定位置。
   * @returns {object} ok=false 时带 reason，调用方淘汰该候选
   */
  function buildStructureCandidateFixed(n, config, chokePlan) {
    var tStruct = Date.now();
    var dims = chooseBoardDimsFixed(n, config);
    var rows = dims.rows, cols = dims.cols, cellCap = rows * cols;
    var cells = [];
    for (var r = 0; r < rows; r++) { var row = []; for (var c = 0; c < cols; c++) row.push(null); cells.push(row); }

    // ① 窄路墙黑块
    // 【v120】窄路的出现与否改由**卡点类型池**决定（用户 q1：「将窄路不作为默认开启的单独参数，
    //   正常接入卡点类型里面……出现概率就同其他卡点类型一样用期望概率抽取」）。
    //   `narrowNeeded` 里：启用类型化 → 看是否抽中 narrowPath（抽中 narrowGapIce/Chain 也隐含需要窄路，
    //   否则那两个名额会空转）；未启用类型化 → 逐值回落旧的 narrowPath 开关 + narrowPathProb 概率。
    var narrowGaps = [];
    // 分两步记录，便于区分「没被抽中」与「抽中了但墙建不出来」——
    // 后者是真实存在的情况：reserveNarrowWalls 在棋盘过小/过窄时会直接返回空，
    // 而本模式为增加管道把棋盘缩小了，必须能看出窄路到底有没有落地。
    var narrowDecision = narrowNeeded(config, chokePlan);
    var narrowHit = narrowDecision.need;
    if (narrowHit) narrowGaps = reserveNarrowWalls(cells, rows, cols, config);
    var narrowStat = {
      enabled: !!config.narrowPath, prob: (config.narrowPathProb != null ? parseFloat(config.narrowPathProb) : 1),
      hit: narrowHit, gaps: narrowGaps.length, applied: narrowGaps.length > 0,
      // v120：谁决定了这一关有没有窄路，事后必须能看出来（类型抽中 / 被两个叠加类型隐含 / 旧概率口径）
      source: narrowDecision.reason, byChokeType: chokeTypingActive(config),
      gapsMin: config.narrowPathGapsMin != null ? config.narrowPathGapsMin : null,
      gapsMax: config.narrowPathGapsMax != null ? config.narrowPathGapsMax : null
    };
    var gapProtect = {};
    for (var wi = 0; wi < narrowGaps.length; wi++) {
      var gr = narrowGaps[wi].r, gc = narrowGaps[wi].c;
      gapProtect[gr + ',' + gc] = true;
      if (gr - 1 >= 0) gapProtect[(gr - 1) + ',' + gc] = true;
      if (gr + 1 < rows) gapProtect[(gr + 1) + ',' + gc] = true;
    }
    var wallBlacks = countCellsOfType(cells, 'black');

    // ② 分散黑块【全部实际落位】
    // 开启可用空间目标时，黑块数取配额求解结果（与管道数联立，见 solveSpaceQuota），
    // 不再单独按 blackPercent 推——否则黑块与管道各自为政，(墙+管道) 之和就对不上目标配额。
    var spaceQuota = dims.spaceQuota || null;
    var blackTarget = spaceQuota
      ? spaceQuota.blackTarget
      : Math.floor(cellCap * (config.blackPercent || 0) / 100);
    // 【v167】"墙当上限"：用户 2026-10-16「黑块的比例最多是 4%」——
    //   把要放的墙**压到上限**（默认 4%），压掉的部分**留空位**（不再补成墙；阻挡改由数字冰/锁链承担）。
    if (config.blackAsCapOnly) {
      var capPct0 = (config.blackPercentCapPct != null) ? config.blackPercentCapPct : 4;
      var capN0 = Math.floor(cellCap * capPct0 / 100);
      if (blackTarget > capN0) blackTarget = capN0;
    }
    var blackCap = Math.floor(cellCap * 0.25);
    if (blackTarget > blackCap) blackTarget = blackCap;
    var extraBlack = Math.max(0, blackTarget - wallBlacks);
    var totalBlackCap = Math.floor(cellCap * 0.4);
    if (wallBlacks + extraBlack > totalBlackCap) extraBlack = Math.max(0, totalBlackCap - wallBlacks);
    var blackStat = placeDispersedBlackReal(cells, rows, cols, extraBlack, gapProtect, config);
    blackStat.wallBlacks = wallBlacks;
    blackStat.plannedTotal = wallBlacks + extraBlack;
    blackStat.actualTotal = countCellsOfType(cells, 'black');
    blackStat.missing = blackStat.plannedTotal - blackStat.actualTotal;
    blackStat.surplusFilled = 0;

    // ③ 盒不够填满 → 多余空格转黑块，保证结构候选满盘（不留待填球后裁行）
    var nullNow = 0;
    for (var r2 = 0; r2 < rows; r2++) for (var c2 = 0; c2 < cols; c2++) if (cells[r2][c2] == null) nullNow++;
    var surplusStat = { need: 0, filled: 0, coords: [] };
    if (nullNow > n) {
      var surplusWant = nullNow - n;
      if (config.blackAsCapOnly) {   // 【v167】只补到墙的上限，剩下的**留空位**
        var capPct1 = (config.blackPercentCapPct != null) ? config.blackPercentCapPct : 4;
        var room1 = Math.floor(cellCap * capPct1 / 100) - countCellsOfType(cells, 'black');
        surplusWant = Math.max(0, Math.min(surplusWant, room1));
      }
      surplusStat = fillSurplusWithBlack(cells, rows, cols, surplusWant, gapProtect);
      blackStat.surplusFilled = surplusStat.filled;
      blackStat.actualTotal = countCellsOfType(cells, 'black');
      nullNow = 0;
      for (var r3 = 0; r3 < rows; r3++) for (var c3 = 0; c3 < cols; c3++) if (cells[r3][c3] == null) nullNow++;
      if (nullNow > n) {
        if (!config.blackAsCapOnly) {
          return { ok: false, reason: 'structSurplus', detail: '空格' + nullNow + ' > 盒数' + n + '，多余空格无法全部转黑块', structureBuildMs: Date.now() - tStruct, blackStat: blackStat };
        }
        // 【v167】墙当上限模式下，多出来的空格**合法保留为空位**（不淘汰候选）
        blackStat.emptyLeft = nullNow - n;
      }
    }

    // ④ 管道：基于【实际黑块落位后】的剩余普通格重新计算预算
    var freeForBoxes = nullNow;                                     // 实际普通格容量(实测，非公式推导)
    var overflow = Math.max(0, n - freeForBoxes);                    // D：必须由管道吸收的盒
    // 开启可用空间目标时，管道条数同样取配额解（与黑块联立），而不是只按溢出量反推；
    // 这样 (墙 + 管道) 之和才等于目标配额，可用空间才能在各尺寸间保持一致。
    var pipeWant = spaceQuota ? spaceQuota.pipeWant : pipeCountByConservation(overflow, config);
    var _capPipes2 = parseInt(config.maxPipes, 10) > 0 ? parseInt(config.maxPipes, 10) : 2;
    var maxPipes = Math.max(1, Math.min(_capPipes2, Math.floor((rows - 2) * cols / 3)));
    if (pipeWant > maxPipes) pipeWant = maxPipes;
    if (overflow > 0 && pipeWant < 1) pipeWant = 1;
    var pipeList = [], exitSet = {};
    if (pipeWant > 0) {
      var pipeRowStart = clampInt(config.pipeRowStart, 3, 0, 30);
      var pipeBiasFrac = (typeof config.pipeRowBias === 'number') ? config.pipeRowBias : 0.35;
      var pStart = Math.max(pipeRowStart, Math.round(rows * pipeBiasFrac));
      if (pStart > rows - 2) pStart = rows - 2;
      if (pStart < 1) pStart = 1;
      var buildCand = function (start) {
        var arr = [];
        for (var pr = start; pr < rows - 1; pr++) for (var pc = 0; pc < cols; pc++) {
          if (gapProtect[pr + ',' + pc]) continue;
          if (cells[pr][pc] != null) continue;
          arr.push({ r: pr, c: pc });
        }
        return arr;
      };
      var cand = buildCand(pStart);
      while (cand.length < pipeWant * 2 && pStart > 1) { pStart--; cand = buildCand(pStart); }
      var sel = pickDispersed(cand, pipeWant * 3, 2);
      for (var ps = 0; ps < sel.length && pipeList.length < pipeWant; ps++) {
        var pc0 = sel[ps];
        if (cells[pc0.r][pc0.c] != null) continue;
        if (exitSet[pc0.r + ',' + pc0.c]) continue;
        if (wouldViolateWall(cells, rows, cols, pc0.r, pc0.c)) continue;
        var dir = choosePipeDir(cells, rows, cols, pc0.r, pc0.c, exitSet);
        if (dir < 0) continue;
        var dv = AntSolver.PIPE_DIRS[dir];
        var er = pc0.r + dv[0], ec = pc0.c + dv[1];
        if (gapProtect[er + ',' + ec]) continue;
        cells[pc0.r][pc0.c] = { t: 'pipe', dir: dir, queue: [], next: 0 };
        if (!nullCellsReachable(cells, rows, cols)) { cells[pc0.r][pc0.c] = null; continue; }
        pipeList.push({ r: pc0.r, c: pc0.c, dir: dir });
        exitSet[er + ',' + ec] = true;
      }
    }
    // 管道占格后普通格减少 → 重算实际溢出，并校验管道容量能否守恒吸收
    var boardBoxCells = 0;
    for (var r4 = 0; r4 < rows; r4++) for (var c4 = 0; c4 < cols; c4++) if (cells[r4][c4] == null) boardBoxCells++;
    var overflowReal = n - boardBoxCells;
    var pipeMaxDepth = pipeDepthOf(config);

    // ===== 管道绝对下限：不足则【直接去除管道】=====
    // 用户 2026-08-25：「突破下限管道数，最低为 2 个管道 2 层深度。如果低于这个下限就直接去除管道」。
    //   配额层已按阶梯给出 pipeWant，但落位环节仍可能放不满（走廊保护/出口唯一/可达性）。
    //   落位结果若达不到「floorCount 条 且 每管能装到 floorDepth 层」，就把已落位的管道全部撤掉、
    //   格子退回普通盒格 —— 留下 1 条或装不满 2 层的管道既不构成卡点、又白占格子。
    //   守恒前提：撤掉 P 条管道会让普通格 +P、溢出 −P；只有撤完后溢出 ≤ 0 才可以撤，
    //   否则撤了就会丢盒，此时保留管道并由后续 pipeCapacity / usablePipeShort 如实判定。
    //   撤管道只会移除障碍，不可能破坏「空格顶部可达」与墙体形态约束（2×2 / 直线 3 连），故无需重查。
    var floorCount = (config.pipeFloorCount != null) ? parseInt(config.pipeFloorCount, 10) : 2;
    var floorDepth = (config.pipeFloorDepth != null) ? parseInt(config.pipeFloorDepth, 10) : 2;
    if (!(floorCount > 0)) floorCount = 0;
    if (!(floorDepth > 0)) floorDepth = 1;
    if (floorDepth > pipeMaxDepth) floorDepth = pipeMaxDepth;
    var pipeDroppedStat = null;
    if (pipeList.length > 0 && floorCount > 0) {
      var belowFloorCount = pipeList.length < floorCount;
      var belowFloorDepth = overflowReal < pipeList.length * floorDepth;
      if (belowFloorCount || belowFloorDepth) {
        if (overflowReal - pipeList.length <= 0) {
          pipeDroppedStat = {
            dropped: pipeList.length,
            reason: belowFloorCount
              ? '落位 ' + pipeList.length + ' 条 < 绝对下限 ' + floorCount + ' 条'
              : '溢出 ' + overflowReal + ' 摊不到 ' + pipeList.length + ' 条×' + floorDepth + ' 层',
            floorCount: floorCount, floorDepth: floorDepth,
            overflowBefore: overflowReal
          };
          for (var dp = 0; dp < pipeList.length; dp++) cells[pipeList[dp].r][pipeList[dp].c] = null;
          pipeList = [];
          exitSet = {};
          boardBoxCells = 0;
          for (var r4b = 0; r4b < rows; r4b++) for (var c4b = 0; c4b < cols; c4b++) if (cells[r4b][c4b] == null) boardBoxCells++;
          overflowReal = n - boardBoxCells;
          pipeDroppedStat.overflowAfter = overflowReal;
        }
      }
    }
    var pipeStat = {
      want: pipeWant, placed: pipeList.length, overflowPlanned: overflow, overflowActual: overflowReal,
      capacityPerPipe: pipeMaxDepth, coords: pipeList.slice(),
      floorCount: floorCount, floorDepth: floorDepth
    };
    // 管道被撤（低于绝对下限）：如实记录，不静默——否则"这关为什么一条管道都没有"无从追溯
    if (pipeDroppedStat) {
      pipeStat.pipeDropped = true;
      pipeStat.pipeDroppedInfo = pipeDroppedStat;
    }
    // 配额层就判定不需要管道（P=0，含 D≤0 与去除管道解）也要标出来
    if (spaceQuota && spaceQuota.pipeDropped) pipeStat.quotaPipeDropped = true;
    if (overflowReal < 0) {
      return { ok: false, reason: 'structHoles', detail: '普通格' + boardBoxCells + ' > 盒数' + n, structureBuildMs: Date.now() - tStruct, blackStat: blackStat, pipeStat: pipeStat };
    }
    if (overflowReal > 0 && pipeList.length === 0) {
      return { ok: false, reason: 'pipeCapacity', detail: '溢出' + overflowReal + ' 但无管道落位' + (pipeDroppedStat ? '（管道已按绝对下限撤除：' + pipeDroppedStat.reason + '）' : ''), structureBuildMs: Date.now() - tStruct, blackStat: blackStat, pipeStat: pipeStat };
    }
    if (overflowReal > pipeList.length * pipeMaxDepth) {
      return { ok: false, reason: 'pipeCapacity', detail: '溢出' + overflowReal + ' > 管道容量' + (pipeList.length * pipeMaxDepth) + '(' + pipeList.length + '条×深度' + pipeMaxDepth + ')', structureBuildMs: Date.now() - tStruct, blackStat: blackStat, pipeStat: pipeStat };
    }
    var structureBuildMs = Date.now() - tStruct;

    // ⑤ 障碍预定位置（结构阶段，尚无球）
    var tSlot = Date.now();
    // 管道出口格清单（供卡点类型 pipeChain 把锁链锚在管道口）
    var pipeExitList = [];
    for (var ek in exitSet) { var ep = ek.split(','); pipeExitList.push({ r: parseInt(ep[0], 10), c: parseInt(ep[1], 10) }); }
    var slots = planObstacleSlotsFixed(cells, rows, cols, config, narrowGaps, chokePlan, pipeExitList);
    var obstacleSlotMs = Date.now() - tSlot;

    // ⑥ 不依赖颜色的结构检查：空(未来盒)格全部顶部可达 + 管道出口唯一合法
    if (!nullCellsReachable(cells, rows, cols)) {
      return { ok: false, reason: 'structReach', detail: '有未来盒格从顶部不可达', structureBuildMs: structureBuildMs, obstacleSlotMs: obstacleSlotMs, blackStat: blackStat, pipeStat: pipeStat };
    }
    var exitOwner = {};
    for (var pr2 = 0; pr2 < rows; pr2++) for (var pc2 = 0; pc2 < cols; pc2++) {
      var pcell = cells[pr2][pc2];
      if (!pcell || pcell.t !== 'pipe') continue;
      var dv2 = AntSolver.PIPE_DIRS[pcell.dir] || [1, 0];
      var er2 = pr2 + dv2[0], ec2 = pc2 + dv2[1];
      if (er2 < 0 || er2 >= rows || ec2 < 0 || ec2 >= cols) {
        return { ok: false, reason: 'structPipeExit', detail: '管道(' + pr2 + ',' + pc2 + ')出口越界', structureBuildMs: structureBuildMs, obstacleSlotMs: obstacleSlotMs, blackStat: blackStat, pipeStat: pipeStat };
      }
      var ek = er2 + ',' + ec2;
      if (exitOwner[ek]) {
        return { ok: false, reason: 'structPipeExit', detail: '管道共用出口(' + ek + ')', structureBuildMs: structureBuildMs, obstacleSlotMs: obstacleSlotMs, blackStat: blackStat, pipeStat: pipeStat };
      }
      exitOwner[ek] = pr2 + ',' + pc2;
    }

    // ===== 可用空间一致性 / 管道下限：结构层闸门（用户 2026-08-04）=====
    // 配额是算准的，但落位环节会偏离：窄路墙黑块数不受配额控制（可能挤占黑块份额），
    // 管道也可能因走廊保护与落位规则放不满想要的条数。实测偏差最多到 5.4pp、管道最少只落 3 条。
    // 因此在结构候选出口按【实际落位结果】复核一次，不达标就淘汰该候选，
    // 交由多候选筛选去收敛——这与现有「生成候选 + 筛选淘汰」的架构一致，不在事后偷偷补删格子。
    if (spaceQuota) {
      var realBlack = countCellsOfType(cells, 'black');
      var realPipe = pipeList.length;
      var realUsable = (cellCap - realBlack - realPipe) / cellCap;
      var uTarget = parseFloat(config.usableSpaceTarget);
      var uTolPp = (config.usableSpaceTolPp != null) ? config.usableSpaceTolPp : 5;
      var devPp = Math.abs(realUsable - uTarget) * 100;
      var needPipes = Math.max(1, parseInt(config.minPipes, 10) || 1);
      // 【管道阶梯】任务 ANT-GEN-PIPE-DEPTH-FALLBACK-20260825，用户 2026-08-25 两次裁决：
      //   ①「如果其他参数影响导致管道不够，则保底 2 个管道、深度 3」
      //   ②「突破下限管道数，最低为 2 个管道 2 层深度。如果低于这个下限就直接去除管道」
      //   配额层已按阶梯给出 pipeWant，但落位环节受走廊保护/出口唯一/可达性限制放不满（实测最少落 0 条）。
      //   本闸门按【实际落位】复核，判定顺序与阶梯一致：
      //     达到 minPipes → 正常；退到 fbCount → 标 fallback；退到 floorCount → 标 floor；
      //     低于 floorCount → 上游已把管道整体撤除(P=0)，此处放行不再判 minPipes；
      //     既没撤成、又不到 floorCount → 淘汰。
      var fbCount = (config.pipeFallbackCount != null) ? parseInt(config.pipeFallbackCount, 10) : 2;
      var fbDepth = (config.pipeFallbackDepth != null) ? parseInt(config.pipeFallbackDepth, 10) : 3;
      if (!(fbDepth > 0)) fbDepth = 1;
      if (fbDepth > pipeMaxDepth) fbDepth = pipeMaxDepth;
      // P=0 是【有意为之】的合法结果（配额层判定不需要管道，或落位不达绝对下限已整体撤除）：
      //   此时不再拿 minPipes 卡它——溢出盒已经全部上盘（上面的 pipeCapacity 检查保证了这点）。
      var intentionalZero = realPipe === 0 &&
        (pipeDroppedStat != null || (spaceQuota && spaceQuota.pipeDropped) || overflowReal === 0);
      if (intentionalZero) {
        pipeStat.noPipeAccepted = true;
        pipeStat.noPipeReason = pipeDroppedStat ? pipeDroppedStat.reason
          : ((spaceQuota && spaceQuota.pipeDropped) ? '配额层判定无需管道（溢出已全部上盘）' : '溢出为 0，无需管道');
      } else if (realPipe < needPipes) {
        // 分级判定：先看能否算「兜底档」，再看能否算「绝对下限档」
        var capacityOK = overflowReal <= realPipe * pipeMaxDepth;   // 守恒硬约束：装不下就不能放行
        var tier = null;
        if (fbCount > 0 && realPipe >= fbCount && overflowReal >= realPipe * fbDepth && capacityOK) tier = 'fallback';
        else if (floorCount > 0 && realPipe >= floorCount && overflowReal >= realPipe * floorDepth && capacityOK) tier = 'floor';
        if (!tier) {
          return {
            ok: false, reason: 'usablePipeShort',
            detail: '管道只落位 ' + realPipe + ' 条 < 下限 ' + needPipes + '（配额想要 ' + pipeWant + ' 条）' +
              '；兜底档(' + fbCount + '条/每管≥' + fbDepth + ')与绝对下限档(' + floorCount + '条/每管≥' + floorDepth +
              ')均不满足，且撤除管道会丢盒（溢出 ' + overflowReal + ' > 可腾出 ' + realPipe + ' 格）' +
              (capacityOK ? '' : '；管道容量 ' + (realPipe * pipeMaxDepth) + ' < 溢出 ' + overflowReal),
            structureBuildMs: structureBuildMs, obstacleSlotMs: obstacleSlotMs, blackStat: blackStat, pipeStat: pipeStat
          };
        }
        pipeStat.fallback = true;
        pipeStat.fallbackTier = tier;              // 'fallback' = 保底档 / 'floor' = 已用到绝对下限
        pipeStat.fallbackFrom = needPipes;
        pipeStat.fallbackMinCount = tier === 'floor' ? floorCount : fbCount;
        pipeStat.fallbackTargetDepth = tier === 'floor' ? floorDepth : fbDepth;
      }
      if (devPp > uTolPp) {
        return {
          ok: false, reason: 'usableSpaceDeviation',
          detail: '可用空间 ' + (realUsable * 100).toFixed(1) + '% 偏离目标 ' + (uTarget * 100).toFixed(0) +
            '% 达 ' + devPp.toFixed(1) + 'pp（容差 ' + uTolPp + 'pp）；实际墙' + realBlack + ' 管道' + realPipe + ' 配额' + spaceQuota.quota,
          structureBuildMs: structureBuildMs, obstacleSlotMs: obstacleSlotMs, blackStat: blackStat, pipeStat: pipeStat
        };
      }
      spaceQuota.realBlack = realBlack; spaceQuota.realPipe = realPipe; spaceQuota.realUsable = realUsable;
    }
    return {
      ok: true, rows: rows, cols: cols, cells: cells, pipeList: pipeList,
      spaceQuota: spaceQuota, narrowStat: narrowStat,
      narrowGaps: narrowGaps, gapProtect: gapProtect,
      boardBoxCells: boardBoxCells, overflow: overflowReal,
      blackStat: blackStat, pipeStat: pipeStat, surplusStat: surplusStat,
      iceSlots: slots.iceSlots, questionSlots: slots.questionSlots, chainGroups: slots.chainGroups,
      chokeStat: slots.chokeStat || null,   // 卡点类型落地统计需一路传到结果，否则统计不到多样性
      chokeMarks: slots.chokeMarks || null, // 【v120】卡点手段的落地位置清单（报告与模拟界面要显示「什么卡点、在哪」）
      dimsFitted: dims.fitted,
      structureBuildMs: structureBuildMs, obstacleSlotMs: obstacleSlotMs
    };
  }

  // ---- R03：独立守恒基线与实况扫描（来源互不相同，禁止自证） ----
  /**
   * 填球【前】的独立基线：只来自原始盒序列 boxes 与目标图 blocks，与被检查的棋盘无任何数据关系。
   */
  function buildConservationBaseline(boxes, blocks) {
    var expectedBoxCount = boxes.length;
    var colorBoxCount = {}, colorCountSum = {}, totalCountSum = 0;
    for (var i = 0; i < boxes.length; i++) {
      var b = boxes[i];
      colorBoxCount[b.color] = (colorBoxCount[b.color] || 0) + 1;
      colorCountSum[b.color] = (colorCountSum[b.color] || 0) + b.count;
      totalCountSum += b.count;
    }
    var targetColorPixels = {}, targetTotalPixels = 0;
    for (var r = 0; r < blocks.length; r++) {
      var row = blocks[r];
      for (var c = 0; c < row.length; c++) {
        var v = row[c];
        if (v > 0) { targetColorPixels[v] = (targetColorPixels[v] || 0) + 1; targetTotalPixels++; }
      }
    }
    // 基线自身健康度：盒序列的分色总量必须等于目标图分色像素（若不等说明分盒环节即已损坏）
    var baselineIssues = [];
    for (var col in targetColorPixels) {
      if ((colorCountSum[col] || 0) !== targetColorPixels[col])
        baselineIssues.push('盒序列色' + col + '总量' + (colorCountSum[col] || 0) + '≠目标图像素' + targetColorPixels[col]);
    }
    for (var col2 in colorCountSum) {
      if (!targetColorPixels[col2]) baselineIssues.push('盒序列出现目标图不存在的色' + col2);
    }
    if (totalCountSum !== targetTotalPixels) baselineIssues.push('盒总量' + totalCountSum + '≠目标图非空像素' + targetTotalPixels);
    return {
      expectedBoxCount: expectedBoxCount, colorBoxCount: colorBoxCount, colorCountSum: colorCountSum,
      totalCountSum: totalCountSum, targetColorPixels: targetColorPixels, targetTotalPixels: targetTotalPixels,
      baselineIssues: baselineIssues
    };
  }

  /** 独立扫描棋盘实况：棋盘盒与管道盒【分开计数】，不产生任何"总数=分量之和"的派生字段。 */
  function scanBoardActual(board) {
    var rows = board.rows, cols = board.cols, cells = board.cells;
    var boardBoxCount = 0, pipeBoxCount = 0, pipeCount = 0, maxPipeQueue = 0;
    var colorBoxCount = {}, colorCountSum = {};
    function acc(color, count) {
      colorBoxCount[color] = (colorBoxCount[color] || 0) + 1;
      colorCountSum[color] = (colorCountSum[color] || 0) + count;
    }
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
      var cell = cells[r][c];
      if (!cell) continue;
      if (cell.t === 'box') { boardBoxCount++; acc(cell.color, cell.count || 0); }
      else if (cell.t === 'pipe') {
        pipeCount++;
        var q = cell.queue || [];
        if (q.length > maxPipeQueue) maxPipeQueue = q.length;
        for (var i = 0; i < q.length; i++) { pipeBoxCount++; acc(q[i].color, q[i].count || 0); }
      }
    }
    return {
      boardBoxCount: boardBoxCount, pipeBoxCount: pipeBoxCount, pipeCount: pipeCount,
      maxPipeQueue: maxPipeQueue, colorBoxCount: colorBoxCount, colorCountSum: colorCountSum
    };
  }

  /**
   * R03：多点独立守恒比对。
   * 左侧全部来自 baseline(原始盒序列 + 目标图)，右侧全部来自 scanBoardActual(棋盘实测)，
   * 两侧数据来源完全独立，不存在"用 A=B+C 再验证 A=B+C"的恒等式。
   * pendingCount：填球尚未完成阶段仍在待放队列里的盒数(独立计数)，参与总量核对。
   */
  function verifyConservation(baseline, actual, stage, pendingCount) {
    var pending = pendingCount || 0;
    var reasons = [];
    var boxSum = actual.boardBoxCount + actual.pipeBoxCount + pending;
    if (boxSum !== baseline.expectedBoxCount)
      reasons.push('盒数不一致：棋盘' + actual.boardBoxCount + '+管道' + actual.pipeBoxCount + (pending ? '+待放' + pending : '') + '=' + boxSum + '，预期' + baseline.expectedBoxCount);
    if (pending === 0) {
      for (var col in baseline.colorBoxCount) {
        var ab = actual.colorBoxCount[col] || 0;
        if (ab !== baseline.colorBoxCount[col])
          reasons.push('色' + col + '盒数不一致：实际' + ab + '，预期' + baseline.colorBoxCount[col]);
      }
      for (var col2 in actual.colorBoxCount) {
        if (baseline.colorBoxCount[col2] == null)
          reasons.push('出现预期外颜色' + col2 + '(实际盒数' + actual.colorBoxCount[col2] + ')');
      }
      var totalSum = 0;
      for (var col3 in baseline.targetColorPixels) {
        var as = actual.colorCountSum[col3] || 0;
        if (as !== baseline.targetColorPixels[col3])
          reasons.push('色' + col3 + 'count总和不一致：实际' + as + '，目标图像素' + baseline.targetColorPixels[col3]);
      }
      for (var col4 in actual.colorCountSum) totalSum += actual.colorCountSum[col4];
      if (totalSum !== baseline.targetTotalPixels)
        reasons.push('全部count总和不一致：实际' + totalSum + '，目标图非空像素' + baseline.targetTotalPixels);
    }
    return { ok: reasons.length === 0, stage: stage, reasons: reasons };
  }

  // ---- R01：填球 + 只绑定预定障碍（不再随机重选） ----
  /**
   * @returns {object} { ok, reason, board, bindStat, conservation:[...] }
   */
  function fillStructureFixed(struct, boxes, baseline, config, timing, blocksForDep) {
    var tFill = Date.now();
    var cells = struct.cells, rows = struct.rows, cols = struct.cols, pipeList = struct.pipeList;
    var conservation = [];

    var list = [];
    for (var bi = 0; bi < boxes.length; bi++)
      list.push({
        color: boxes[bi].color, count: boxes[bi].count,
        // 【v298】把切法给出的依赖层带进车单，供 depFill 使用（layerCut 才有这个字段）
        layer: (boxes[bi].layer != null) ? boxes[bi].layer : null,
        _seq: (boxes[bi].elimSeq != null ? boxes[bi].elimSeq : bi)
      });
    list.sort(function (a, b) { return a._seq - b._seq; });
    // 【v239】再按【需求进度】重排：早熟的放浅位、晚熟的放深位。
    //   同需求进度时保留切序（消除序列），保证打法还是"由外向内"。
    var _dc = config && config._demandCurve;
    if (_dc) {
      for (var dmi = 0; dmi < list.length; dmi++) list[dmi]._dm = demandAt(_dc, list[dmi].color, list[dmi].count);
      list.sort(function (a, b) { return (a._dm - b._dm) || (a._seq - b._seq); });
      // 【v265·用户目标】需求滞后 L：把整列车单循环左移 L 位再铺。
      //   效果 = 每辆车都比"它该出现的时刻"早 L 步 → 前沿上常驻 L 辆吃不饱的车 → 持续债务。
      //   注意：v2 那次"平移无效"的结论是在 _demandCurve 恒为 null（v253 前）时测的，
      //   当时根本没按需求排序，平移当然没意义。这一轮排序是真的，值得重做。
      var _lag = Math.max(0, Math.min(10, parseInt(config.fillLag, 10) || 0));
      if (_lag > 0 && list.length > _lag + 2) {
        var _rot = list.splice(0, _lag);
        list = list.concat(_rot);
        timing.fillLag = _lag;
      }
    }

    // 单扫填球：空格→普通盒；管道本体→入队 1 个
    //
    // ===== 局部交错摆放（v114，任务 ANT-GEN-FILL-INTERLEAVE-20260827）=====
    // 【这里是正式流程的填盒点】v95 起 produceFixed（纠偏版）走 fillStructureFixed；
    // buildBoard 里那段同样逻辑只服务旧流程 —— **两处都要改**，否则正式产出不受影响。
    // 实测教训：只改 buildBoard 时真实棋盘前 3 行最大同色簇 5.0 → 5.5、几乎无变化，
    // 正是因为 12 关全部走 produceFixed，压根没经过那段代码。
    //
    // 口径：每个可放格从队列头部宽 W 的前瞻窗口里挑「颜色既不同于左邻、也不同于上邻」的盒；
    // 窗口内全冲突则退回队首（不卡住、不丢盒）。W 即位移上限 → 取盒顺序最多偏离 W 位，趋势不被打乱。
    // 管道入队不参与交错：管道队列不构成棋盘表面相邻。
    var ilW2 = (config.fillInterleaveWindow != null) ? config.fillInterleaveWindow : 6;
    function pickNonAdj2(at, r, c) {
      if (ilW2 <= 0) return at;
      var lc = (c > 0) ? cells[r][c - 1] : null;
      var uc = (r > 0) ? cells[r - 1][c] : null;
      var lcol = (lc && lc.t === 'box') ? lc.color : -1;
      var ucol = (uc && uc.t === 'box') ? uc.color : -1;
      if (lcol < 0 && ucol < 0) return at;
      var lim = Math.min(at + ilW2, list.length);
      for (var k = at; k < lim; k++) {
        if (list[k].color !== lcol && list[k].color !== ucol) return k;
      }
      return at;
    }
    var fi = 0;
    if (config.fillOrder === 'exposure') {
      // 【v222】按"暴露距离"铺球：从边界往里 BFS，距离小的格子先放（第 k 辆车≈第 k 步出现）。
      //   管道格不参与填盒（溢出交给后面的 pipeQueue 阶段统一入队）。
      var pass = [], dist = [];
      for (var pr = 0; pr < rows; pr++) {
        pass.push([]); dist.push([]);
        for (var pc = 0; pc < cols; pc++) {
          var cc = cells[pr][pc];
          pass[pr].push(cc == null || cc.t === 'pipe');
          dist[pr].push(-1);
        }
      }
      var dq = [];
      // 【v287·修模型不一致】铺盘用的"暴露距离"原来是**四边全当入口**（距离 0），
      //   但实机的激活模型是：**只有第 0 行初始激活**，其余靠"取走相邻格"逐格激活
      //   （simulator.js: activated 只初始化第 0 行）。两者不一致 → 早熟色被撒到左右/底边，
      //   而在实机里它们根本点不到，导致"开局能吃的车"与摆位意图完全对不上。
      //   现在改成只从第 0 行出发 BFS，距离 ≈ 行号。
      var _topOnly = (config.fillSeedsTopOnly !== false);
      for (var br = 0; br < rows; br++) for (var bc = 0; bc < cols; bc++) {
        if (!pass[br][bc]) continue;
        if (br === 0) { dist[br][bc] = 0; dq.push([br, bc]); }
        else if (!_topOnly && (br === rows - 1 || bc === 0 || bc === cols - 1)) { dist[br][bc] = 0; dq.push([br, bc]); }
      }
      for (var hd = 0; hd < dq.length; hd++) {
        var qr = dq[hd][0], qc = dq[hd][1];
        var nb = [[qr-1,qc],[qr+1,qc],[qr,qc-1],[qr,qc+1]];
        for (var ni = 0; ni < 4; ni++) {
          var nr2 = nb[ni][0], nc2 = nb[ni][1];
          if (nr2 < 0 || nr2 >= rows || nc2 < 0 || nc2 >= cols) continue;
          if (!pass[nr2][nc2] || dist[nr2][nc2] >= 0) continue;
          dist[nr2][nc2] = dist[qr][qc] + 1; dq.push([nr2, nc2]);
        }
      }
      var order = [];
      for (var or2 = 0; or2 < rows; or2++) for (var oc2 = 0; oc2 < cols; oc2++) {
        if (cells[or2][oc2] != null) continue;
        order.push([or2, oc2, dist[or2][oc2] < 0 ? 999 : dist[or2][oc2]]);
      }
      order.sort(function (a, b) { return a[2] - b[2] || a[0] - b[0] || a[1] - b[1]; });

      // ===== 【seqFill·序列铺盘】把"格子铺放顺序"从 BFS 距离换成**沿前沿推进的单链遍历** =====
      // 为什么需要它：
      //   BFS 距离只在前期近似等于"玩家第几步能点到"。中段前沿会同时展开一大片，
      //   玩家能点到的有六七辆，而车单是按"第 i 辆在第 i 步上场"排的 → 序列失效。
      //   实测（工作日志第 217 节）：现行切法下 r 中位 0.20、上限 0.60，
      //   20~80% 的后半段在数学上不可能有债 —— 就是被这个脱钩锁死的。
      //
      // 做法：从第 0 行出发做一次"蛇形 + 邻接优先"的确定性遍历：
      //   保证 seq 上相邻的两个格子在棋盘上也相邻 → 取走第 k 格就激活第 k+1 格，
      //   于是"车单顺序 = 实际取用顺序"在几何上成立（近似，允许玩家在前沿小范围换序）。
      //   玩家仍可自由选择（不改变规则），只是**可选集合**被收窄到计划的那几辆。
      if (config.seqFill) {
        var _seqVis = [], _seqOut = [];
        for (var _vi = 0; _vi < rows; _vi++) { _seqVis.push([]); for (var _vj = 0; _vj < cols; _vj++) _seqVis[_vi].push(false); }
        function _seqFree(rr, cc) {
          if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) return false;
          if (_seqVis[rr][cc]) return false;
          var x = cells[rr][cc];
          return x == null;                       // 只排空格（管道/墙不参与填盒）
        }
        // 起点：第 0 行最左的空格；之后每一步在"当前格的 4 邻"里挑，
        //   优先同行（蛇形推进），其次向下一行；都没有就退回"离已铺序列最近的格子"。
        var _startC = -1, _startR = 0;
        for (var _sc0 = 0; _sc0 < cols; _sc0++) if (_seqFree(0, _sc0)) { _startC = _sc0; break; }
        // 【兜底】第 0 行可能被管道/障碍占满（实测 6×7 上会这样）→ 改从全盘第一个空格起步。
        //   起点不是第 0 行时，序列的前几格要等玩家挖下去才激活，顺序性会差一些，
        //   但比"整个 seqFill 静默失效、退回 BFS"好：至少顺序仍然是单链的。
        if (_startC < 0) {
          var _fb = null;
          for (var _fr1 = 0; _fr1 < rows && !_fb; _fr1++) for (var _fc1 = 0; _fc1 < cols; _fc1++) {
            if (_seqFree(_fr1, _fc1)) { _fb = [_fr1, _fc1]; break; }
          }
          if (_fb) { _startR = _fb[0]; _startC = _fb[1]; }
        }
        timing.seqFillStart = { r: _startR, c: _startC };
        if (_startC >= 0) {
          _seqVis[_startR][_startC] = true; _seqOut.push([_startR, _startC]);
          var _curR = _startR, _curC = _startC, _dir = 1;   // 蛇形方向
          var _guardSeq = rows * cols * 4;
          while (_seqOut.length < rows * cols && _guardSeq-- > 0) {
            var _next = null;
            // ① 同行下一格（蛇形）
            var _nc0 = _curC + _dir;
            if (_seqFree(_curR, _nc0)) _next = [_curR, _nc0];
            // ② 同行走到头 → 下一行，方向反转
            if (!_next) {
              var _nr0 = _curR + 1;
              if (_nr0 < rows) {
                _dir = -_dir;
                var _cand0 = (_dir > 0) ? 0 : cols - 1;
                // 从该行往中间找第一个空格，优先靠近当前列
                var _best0 = -1, _bd0 = 1e9;
                for (var _cc0 = 0; _cc0 < cols; _cc0++) {
                  if (!_seqFree(_nr0, _cc0)) continue;
                  var _d0 = Math.abs(_cc0 - _curC);
                  if (_d0 < _bd0) { _bd0 = _d0; _best0 = _cc0; }
                }
                if (_best0 >= 0) _next = [_nr0, _best0];
              }
            }
            // ③ 兜底：全场找"与已铺序列曼哈顿距离最近"的空格（保持连通扫描，不跳飞）
            if (!_next) {
              var _b1 = null, _bd1 = 1e9;
              for (var _fr0 = 0; _fr0 < rows; _fr0++) for (var _fc0 = 0; _fc0 < cols; _fc0++) {
                if (!_seqFree(_fr0, _fc0)) continue;
                var _d1 = Math.abs(_fr0 - _curR) + Math.abs(_fc0 - _curC);
                if (_d1 < _bd1) { _bd1 = _d1; _b1 = [_fr0, _fc0]; }
              }
              if (!_b1) break;
              _next = _b1;
            }
            _seqVis[_next[0]][_next[1]] = true;
            _seqOut.push(_next);
            _curR = _next[0]; _curC = _next[1];
          }
          // 用序列序替换 BFS 距离序（保留 dist 在 [2] 位，仅为兼容下游排序字段）
          if (_seqOut.length === order.length) {
            order = _seqOut.map(function (x, i) { return [x[0], x[1], i]; });
            timing.seqFill = { n: order.length };
          } else {
            // 空格数与序列长度不一致（有不可达空位）→ 保守：把序列铺到的放前面，其余按原 BFS 补后
            var _used = {};
            for (var _ui = 0; _ui < _seqOut.length; _ui++) _used[_seqOut[_ui][0] + ',' + _seqOut[_ui][1]] = 1;
            var _merged = _seqOut.map(function (x, i) { return [x[0], x[1], i]; });
            for (var _oi0 = 0; _oi0 < order.length; _oi0++) {
              var _k0 = order[_oi0][0] + ',' + order[_oi0][1];
              if (!_used[_k0]) _merged.push([order[_oi0][0], order[_oi0][1], _merged.length]);
            }
            order = _merged;
            timing.seqFill = { n: _seqOut.length, merged: _merged.length };
          }
        }
      }
      // 【v260·用户裁决】闸门借车：把"需求最晚"的几辆车换到"扇出最大"的浅层格子上。
      //   理由：全知求解器不会主动拿吃不饱的车，只有它挡在通往一大片车的唯一通路上时才会被迫拿。
      //   所以"晚熟色 + 高扇出 + 浅层"三者同时成立，才会出现又高又持久的全知压力。
      //   扇出 = 拿掉这格后，有多少辆车从不可点变成可点。
      try {
        var _gb = Math.max(0, Math.min(6, parseInt(config.gateBorrow, 10) || 0));
        timing.gateDbg = { gb: _gb, dc: !!_dc, n: list.length };
        if (_gb > 0 && _dc && list.length > _gb + 2) {
          function fanoutAt(r0, c0) {
            var R2 = [], vis = [];
            for (var rr = 0; rr < rows; rr++) { R2.push([]); vis.push([]); for (var cc2 = 0; cc2 < cols; cc2++) { R2[rr].push(false); vis[rr].push(false); } }
            var q2 = [];
            for (var c2 = 0; c2 < cols; c2++) {
              var x2 = cells[0][c2];
              if (x2 == null || (r0 === 0 && c2 === c0)) { R2[0][c2] = true; q2.push([0, c2]); }
            }
            for (var h2 = 0; h2 < q2.length; h2++) {
              var pr2 = q2[h2][0], pc2 = q2[h2][1];
              var d4 = [[-1,0],[1,0],[0,-1],[0,1]];
              for (var d2 = 0; d2 < 4; d2++) {
                var nr3 = pr2 + d4[d2][0], nc3 = pc2 + d4[d2][1];
                if (nr3 < 0 || nr3 >= rows || nc3 < 0 || nc3 >= cols || R2[nr3][nc3]) continue;
                if (cells[nr3][nc3] == null || (nr3 === r0 && nc3 === c0)) { R2[nr3][nc3] = true; q2.push([nr3, nc3]); }
              }
            }
            // 铺盘阶段车还没放进去，所以"扇出"要按【可达空位数】数，不能数盒
            var reachN = 0;
            for (var r3 = 0; r3 < rows; r3++) for (var c3 = 0; c3 < cols; c3++) if (R2[r3][c3]) reachN++;
            return reachN;
          }
          var base0 = fanoutAt(-1, -1);
          var gates = [];
          for (var gi = 0; gi < order.length && gi < list.length; gi++) {
            if (order[gi][2] < 1 || order[gi][2] > 3) continue;      // 只看深度 1~3，不碰第 0 行
            var fo = fanoutAt(order[gi][0], order[gi][1]) - base0 - 1;   // 减掉被拿掉那一格自己
            if (fo > 0) gates.push({ idx: gi, fan: fo });
          }
          gates.sort(function (a, b) { return b.fan - a.fan; });
          timing.gateDbg.base = base0; timing.gateDbg.gates = gates.length; timing.gateDbg.top = gates.slice(0,3).map(function(g){return g.fan;});
          var borrow = Math.min(_gb, gates.length);
          for (var bi = 0; bi < borrow && (list.length - 1 - bi) > gates[bi].idx; bi++) {
            var gi2 = gates[bi].idx, tail = list.length - 1 - bi;
            var tmp = list[gi2]; list[gi2] = list[tail]; list[tail] = tmp;
          }
          if (borrow > 0) timing.gateBorrow = { k: borrow, fans: gates.slice(0, borrow).map(function (g) { return g.fan; }) };
        }
      } catch (e) { /* 借车失败不影响铺盘 */ }
      // ===== 【v275·用户设计】联动铺盘：不是"按需求序一辆辆摆"，而是每摆一格都问一句
      //   "这辆车进入暂存区时，目标区离能给它喂满还有多远？"
      //   口径：给第 i 格（大约第 i 步被点到）挑一辆车，使
      //        wait = 该车被装满所需的目标进度 − 该格被点到的进度
      //   尽量接近 coupledLag（默认 2 步）。
      //     wait ≈ 0  → 一点就满、目标立刻前移 → 造不出压力（这就是"外层颜色全放第一排"的毛病）
      //     wait ≫ 0  → 等到天荒地老 → 玩家只能弃车，属于不可玩
      //   同时保留"不可与左/上邻同色"的硬约束（同色成片会被埋）。
      // ===== 【v282·用户方案】把"外层颜色"的车放到内层，把内层（晚熟色）的车提到外层。
      //   直觉：开局能点的只有最前几格；如果那几格放的是"目标区还没露出来的颜色"的车，
      //   玩家点了也装不满 → 债务；而早熟色的车藏在深处，等玩家挖到它们时目标区刚好露出来。
      //   为了让关卡还能启动，最前面留 earlyKeep 辆"早熟车"当火种。
      //   参数：sandwich（开关）、earlyKeep（火种数，默认2）、lateShallow（提到外层的晚熟车数，默认4）
      // ===== 【v288·用户批准】按层铺盘 =====
      //   棋盘是偏序（玩家可从前沿任选），所以不能用"第 i 格 = 第 i 步"的线性假设。
      //   改用**层号**：玩家在第 L 层作业时，整体进度 ≈ L/行数（对顺序不敏感）。
      //   规则：第 L 层的车，释放时刻 r 应落在 (L + layerLag)/行数 附近
      //        layerLag 用"行"作单位，0.5 行 ≈ 3~4 步（正好是一笔健康债务的长度）。
      //   实现：把车按 r 排序、格子按 (层 + lag) 排序，按序对上（分位数匹配）。
      // ===== 【v294·用户裁决】不用 BFS，改"逐行铺"；每行先放少量免费车，其余放**晚熟色** =====
      //   用户原话：「开局点不到没关系，先在暂存区放着也行，第一第二行直接消除的车太多，前期无法造成压力」。
      //   所以：行的顺序按 (行,列) 走，不再是暴露距离；每行前 freePerRow 格给"能吃的"，
      //   剩下的格子放"要等一会儿才熟"的车 —— 玩家点了只能进暂存，压力从第一行就开始。
      var rowMajorAssign = null;
      if (config.rowMajorMix) {
        var _fpr = Math.max(0, parseInt(config.freePerRow, 10) || 2);
        var _lo = (config.lateBandLo != null) ? +config.lateBandLo : 0.45;
        var _hi2 = (config.lateBandHi != null) ? +config.lateBandHi : 0.85;
        var _cellsR = [];
        for (var _ri = 0; _ri < order.length; _ri++) _cellsR.push(order[_ri]);
        // order 已按 (dist,row,col)；这里强制按 (row,col) 重排
        _cellsR.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
        var _N2 = Math.min(_cellsR.length, list.length);
        var _pool2 = list.slice(0, _N2);
        var _cnt2 = _pool2.length;
        var _early2 = [], _late2 = [];
        for (var _ei = 0; _ei < _cnt2; _ei++) {
          var q = _cnt2 > 1 ? (_ei / (_cnt2 - 1)) : 0;
          if (q < 0.35) _early2.push(_pool2[_ei]);
          else if (q >= _lo && q <= _hi2) _late2.push(_pool2[_ei]);
          else _late2.push(_pool2[_ei]);   // 带外的也归到"非免费"桶，避免浪费
        }
        var _assign2 = [], _ei2 = 0, _li2 = 0, _used2 = {};
        var _mixRows = (config.mixRows != null) ? Math.max(1, parseInt(config.mixRows, 10)) : 99;
        for (var _ci2 = 0; _ci2 < _N2; _ci2++) {
          var _row2 = _cellsR[_ci2][0], _col2 = _cellsR[_ci2][1];
          // 只对前 mixRows 行做"晚熟色前排"，更深的行为保持需求序（避免全局过压）
          if (_row2 >= _mixRows) {
            if (_li2 < _late2.length) _assign2.push(_late2[_li2++]);
            else if (_ei2 < _early2.length) _assign2.push(_early2[_ei2++]);
            continue;
          }
          var _isFreeSlot = (_col2 < _fpr);
          var _pick2 = null;
          if (_isFreeSlot && _ei2 < _early2.length) _pick2 = _early2[_ei2++];
          else if (_li2 < _late2.length) _pick2 = _late2[_li2++];
          else if (_ei2 < _early2.length) _pick2 = _early2[_ei2++];
          if (_pick2) _assign2.push(_pick2);
        }
        rowMajorAssign = _assign2;
        timing.rowMajorMix = { n: _assign2.length, freePerRow: _fpr, band: [_lo, _hi2] };
      }
      var layerAssign = null;
      if (config.layerFill) {
        var _lagR = (config.layerLag != null) ? +config.layerLag : 0.5;
        var _rOf = function (car) {
          var v = -1;
          try { v = demandAt(_dc, car.color, car.count); } catch (e) { v = -1; }
          return v;
        };
        var _cellsL = [];
        for (var _li = 0; _li < order.length; _li++) {
          var _rr = order[_li][0];
          _cellsL.push({ r: order[_li][0], c: order[_li][1], key: _rr + _lagR, i: _li });
        }
        _cellsL.sort(function (a, b) { return a.key - b.key || a.r - b.r || a.c - b.c; });
        var _carsL = list.slice(0, Math.min(_cellsL.length, list.length)).map(function (car) {
          return { car: car, r: _rOf(car) };
        });
        _carsL.sort(function (a, b) { return a.r - b.r; });
        layerAssign = _carsL.map(function (x) { return x.car; });
        timing.layerFill = { n: layerAssign.length, lag: _lagR };
      }
      var sandwichAssign = null;
      if (config.sandwich && list.length > 6) {
        var _ek = Math.max(1, parseInt(config.earlyKeep, 10) || 2);
        var _ls = Math.max(1, parseInt(config.lateShallow, 10) || 4);
        var _n2 = Math.min(order.length, list.length);
        if (_ek + _ls < _n2) {
          var _head = list.slice(0, _ek);                 // 火种：最早熟的几辆
          // 提到外层的不能是"最晚熟"的（实测全灭：开局一辆都装不满，关卡直接死）
          //   取需求序 45%~75% 那一段：还没露出来、但离得不远 → 点了要等两三步，正好是债务
          var _t0 = Math.floor(list.length * 0.45);
          var _tail = list.slice(_t0, Math.min(_t0 + _ls, list.length));
          var _usedIdx = {};
          for (var _q3 = 0; _q3 < _ek; _q3++) _usedIdx[_q3] = 1;
          for (var _q4 = _t0; _q4 < Math.min(_t0 + _ls, list.length); _q4++) _usedIdx[_q4] = 1;
          var _mid = [];
          for (var _q5 = 0; _q5 < list.length; _q5++) if (!_usedIdx[_q5]) _mid.push(list[_q5]);
          sandwichAssign = _head.concat(_tail, _mid);
          timing.sandwich = { earlyKeep: _ek, lateShallow: _ls, n: _n2 };
        }
      }
      var coupledAssign = null;
      if (config.coupledFill && _dc && _dc.curve && list.length) {
        try {
          var _LAG = (config.coupledLag != null) ? +config.coupledLag : 2.0;
          var _W = (config.coupledWindow != null) ? Math.max(2, parseInt(config.coupledWindow, 10)) : 8;
          var _nc = Math.min(order.length, list.length);
          var pool = list.slice(0, _nc), assign = [];
          for (var oi2 = 0; oi2 < _nc; oi2++) {
            var prog = _nc > 1 ? (oi2 / (_nc - 1)) : 0;
            var tr0 = order[oi2][0], tc0 = order[oi2][1];
            var lcO = (tc0 > 0) ? cells[tr0][tc0 - 1] : null;
            var ucO = (tr0 > 0) ? cells[tr0 - 1][tc0] : null;
            var bad0 = {}, bad1 = {};
            if (lcO && lcO.t === 'box') bad0[lcO.color] = 1;
            if (ucO && ucO.t === 'box') bad1[ucO.color] = 1;
            var bestK = -1, bestScore = 1e9;
            // v279：候选窗口放到整个剩余车池，避免前 8 辆都是免费车时判据失效
            for (var k2 = 0; k2 < pool.length; k2++) {
              var cd = pool[k2];
              if (bad0[cd.color] || bad1[cd.color]) continue;      // 硬约束：不贴同色
              var need = 1;
              try { need = demandAt(_dc, cd.color, cd.count); } catch (e2) { need = -1; }
              if (!(need >= 0)) continue;
              var wait = need - prog;
              // 目标：wait ≈ LAG；立刻能满（wait<=0）重罚，太远（wait>0.5）也罚
              var score = Math.abs(wait - _LAG);
              if (wait <= 0.02) score += 3;
              if (wait > 0.5) score += (wait - 0.5) * 10;
              if (score < bestScore) { bestScore = score; bestK = k2; }
            }
            if (bestK < 0) bestK = 0;                              // 全被硬约束挡掉 → 退回队首
            assign.push(pool.splice(bestK, 1)[0]);
          }
          // 剩下的车按原顺序接在后面（格子多于车时不会走到这里）
          for (var rz = 0; rz < pool.length; rz++) assign.push(pool[rz]);
          coupledAssign = assign;
          timing.coupledFill = { n: _nc, lag: _LAG, window: _W };
        } catch (e3) { coupledAssign = null; }
      }
      // 【seqFill】序列铺盘时，车单必须**严格按当用时刻 r 升序**落到序列格上：
      //   免费车（r=0）先上场，之后 r 递增 → 玩家越往后走，手上的车越晚才能装满 = 债。
      //   同时关掉颜色交错与第 0 行同色限量：它们会打乱序列，而 seqFill 的卖点正是"顺序可控"。
      if (config.seqFill && _dc) {
        for (var _sqi = 0; _sqi < list.length; _sqi++) {
          var _sqv = -1;
          try { _sqv = demandAt(_dc, list[_sqi].color, list[_sqi].count); } catch (e) { _sqv = -1; }
          list[_sqi]._sqr = (_sqv >= 0) ? _sqv : 1.0;
        }
        // 同 r 时把**容量大的免费车**排前面（先消耗供给），再按原切序稳定排序
        list.sort(function (a, b) {
          var d = a._sqr - b._sqr;
          if (Math.abs(d) > 1e-9) return d;
          if (a._sqr <= 1e-9) return (b.count - a.count) || (a._seq - b._seq);
          return a._seq - b._seq;
        });
        timing.seqFillList = { n: list.length, rMin: list[0] ? +list[0]._sqr.toFixed(2) : null, rMax: list[list.length - 1] ? +list[list.length - 1]._sqr.toFixed(2) : null };
      }
      // ===== 【v297·用户设计B】依赖层铺盘（`depFill`，默认关） =====
      // 用户 2026-10-20：「把依赖层用在铺盘上——第 L 层的格子只放 L_min ≤ L 的车，
      //   用它来控制空间阻隔」。
      //
      // 与 BFS 暴露距离的区别：
      //   · BFS 距离是**纯几何**（离第 0 行几格），不知道"谁包着谁"；
      //   · 这里的层是**依赖层**：色块要先把外面几层清掉才碰得到（`veinLayers` 的 level）。
      //   于是"这辆车要的东西在第几层能露出来"与"它被放在第几层"可以对齐，
      //   而不是靠"放得靠上 = 先被取"这种几何假设。
      //
      // 实现分两步：
      //   ① 给棋盘每个空格算**挖掘层** cellLayer：从第 0 行 BFS（与实机激活一致：只有第 0 行初始可点）；
      //   ② 把车按 L_min（= 该颜色的最浅依赖层）分档，第 cellLayer 层的格子优先放
      //      L_min 最接近 cellLayer 的车，且强制 L_min ≤ cellLayer + depFillTol
      //      （tol 允许"深一点的车放到浅一层的格子"，否则浅层格子会空着）。
      //
      // 关键收益：深层车被安置在**必须挖很久才能碰到**的位置，
      //   玩家在中段无法随手挑到它们，也挑不到"一点就满"的浅层车 —— 供给被空间结构约束住。
      if (config.depFill) {
        try {
          var _info = null;
          try { _info = veinLayers({ rows: rows, cols: cols, blocks: blocksForDep || config._blocks }, {}); } catch (e) { _info = null; }
          if (_info && _info.colorMinLevel) {
            // ① 棋盘挖掘层：从第 0 行 BFS，只沿空格扩散（管道/墙算阻断）
            var _cLayer = [];
            for (var _cl = 0; _cl < rows; _cl++) { _cLayer.push(new Array(cols).fill(-1)); }
            var _q = [], _bfs = [[0, 0]];
            // 起点：第 0 行所有空格
            for (var _c0 = 0; _c0 < cols; _c0++) {
              var _x0 = cells[0][_c0];
              if (_x0 == null) { _cLayer[0][_c0] = 0; _q.push([0, _c0]); }
            }
            for (var _h = 0; _h < _q.length; _h++) {
              var _qr = _q[_h][0], _qc = _q[_h][1];
              var _nb = [[_qr - 1, _qc], [_qr + 1, _qc], [_qr, _qc - 1], [_qr, _qc + 1]];
              for (var _ni = 0; _ni < 4; _ni++) {
                var _nr = _nb[_ni][0], _nc = _nb[_ni][1];
                if (_nr < 0 || _nr >= rows || _nc < 0 || _nc >= cols) continue;
                if (_cLayer[_nr][_nc] >= 0) continue;
                if (cells[_nr][_nc] != null) continue;        // 已被占用（管道/墙/已放车）
                _cLayer[_nr][_nc] = _cLayer[_qr][_qc] + 1;
                _q.push([_nr, _nc]);
              }
            }
            var _maxCL = 0;
            for (var _r3 = 0; _r3 < rows; _r3++) for (var _c3 = 0; _c3 < cols; _c3++) if (_cLayer[_r3][_c3] > _maxCL) _maxCL = _cLayer[_r3][_c3];

            // ② 给每辆车算 L_min，并把**车单按 L_min 升序重排**
            //
            // 【v298·修正】一辆车的层 = **它自己像素来源的层**，不是"该颜色的最浅层"。
            //   为什么：色 32 在层 0 有 327px（贴边）、在层 2 也有 78px（被包住）。
            //   这两批车应该落到不同位置，但用 colorMinLevel 都算成 0 →
            //   实测 carLmin=0 / carLmax=0，所有车挤在同一档，空间阻隔根本没建立。
            //   来源：
            //     · `layerCut` 切出来的车自带 `layer` 字段（真实来源层）→ 直接用；
            //     · 其他切法没有层信息 → 退回 colorMinLevel（保守口径，效果有限但不会更差）。
            for (var _p2 = 0; _p2 < list.length; _p2++) {
              if (list[_p2].layer != null) {
                list[_p2]._Lmin = list[_p2].layer;                    // 首选：车自己的来源层
              } else {
                var _cm = _info.colorMinLevel[list[_p2].color];
                list[_p2]._Lmin = (_cm != null) ? _cm : 0;            // 退路：该色最浅层
              }
            }
            var _hasOwnLayer = 0;
            for (var _hc = 0; _hc < list.length; _hc++) if (list[_hc].layer != null) _hasOwnLayer++;
            list.sort(function (a, b) {
              var d = a._Lmin - b._Lmin;
              if (d !== 0) return d;
              return (b.count - a.count) || (a._seq - b._seq);   // 同层先放大车（占位稳）
            });

            // ③ 把**格子序**换成「按挖掘层升序、同层按行列」
            //    注意：这里只换顺序，不增删格子 → order.length 不变，fi / list 的不变量完全不动。
            var _cellOrder = [];
            for (var _r4 = 0; _r4 < rows; _r4++) for (var _c4 = 0; _c4 < cols; _c4++) {
              if (cells[_r4][_c4] != null) continue;      // 只排空格（与 order 同口径）
              var _Lc = _cLayer[_r4][_c4];
              _cellOrder.push([_r4, _c4, _Lc < 0 ? 999 : _Lc]);
            }
            _cellOrder.sort(function (a, b) { return a[2] - b[2] || a[0] - b[0] || a[1] - b[1]; });
            // 用新顺序替换 order（长度不变；多出来的旧项不会再被用到）
            for (var _oi2 = 0; _oi2 < _cellOrder.length && _oi2 < order.length; _oi2++) {
              order[_oi2] = [_cellOrder[_oi2][0], _cellOrder[_oi2][1], _cellOrder[_oi2][2]];
            }
            timing.depFill = {
              cells: _cellOrder.length, maxCellLayer: _maxCL,
              carLmin: list.length ? list[0]._Lmin : null,
              carLmax: list.length ? list[list.length - 1]._Lmin : null
            };
          }
        } catch (e) { if (typeof timing !== "undefined") timing.depFillErr = String(e && e.message || e); }
      }
      var exW = (config.fillInterleaveWindow != null) ? config.fillInterleaveWindow : 6;
      if (config.seqFill || config.depFill) exW = 0;   // 序列/依赖层铺盘都不做颜色交错（会破坏顺序）
      for (var oi = 0; oi < order.length && fi < list.length; oi++) {
        var tr2 = order[oi][0], tc2 = order[oi][1];
        // 【v280·用户反馈】不要 160 这种超大车。改法：容量上限压到正常区间（capCeil 84），
        //   同时**限制第 0 行同色车的辆数**——开局可点的只有最前面这几格，
        //   同色车少摆几辆，开局能装满的数量自然就下来了，不靠"把车做大"。
        // 【seqFill】序列铺盘不做第 0 行同色限量：它靠"免费车先上场、r 递增"控制开局，
        //   再按颜色换位会把 r 顺序打乱（v290 那种"第一行全同色"的副作用也由 r 排序本身避免）。
        if (config.row0ColorMax && oi < cols && !config.seqFill) {
          var _c0m = Math.max(1, parseInt(config.row0ColorMax, 10) || 2);
          var _seen0 = {};
          for (var _c4 = 0; _c4 < cols; _c4++) {
            var _e4 = cells[0][_c4];
            if (_e4 && _e4.t === 'box') _seen0[_e4.color] = (_seen0[_e4.color] || 0) + 1;
          }
          // 【v290】原来只往后找 12 辆，而前 12 辆往往同色（大色块切出来的）→ 找不到别的颜色就放弃，
          //   第 0 行照样清一色。改成搜**整个队列**。
          var _lim3 = list.length, _bk3 = -1;
          for (var _k5 = fi; _k5 < _lim3; _k5++) {
            if ((_seen0[list[_k5].color] || 0) < _c0m) { _bk3 = _k5; break; }
          }
          if (_bk3 > fi) {
            var _t5 = list[fi]; list[fi] = list[_bk3]; list[_bk3] = _t5;
          }
        }
        // 联动模式下这一格的车已经由 coupledAssign 指定，不再走交错（否则会破坏依赖关系）
        if (rowMajorAssign && oi < rowMajorAssign.length && cells[tr2][tc2] == null) {
          var _rc2 = rowMajorAssign[oi];
          cells[tr2][tc2] = { t: 'box', color: _rc2.color, count: _rc2.count, _seq: fi, _dm: _rc2._dm };
          fi++;
          continue;
        }
        if (layerAssign && oi < layerAssign.length && cells[tr2][tc2] == null) {
          // 按层铺盘：这一格的车已由"层 + 时差"匹配决定
          var _lc = layerAssign[oi];
          cells[tr2][tc2] = { t: 'box', color: _lc.color, count: _lc.count, _seq: fi, _dm: _lc._dm };
          fi++;
          continue;
        }
        if (sandwichAssign && oi < sandwichAssign.length) {
          var _sc = sandwichAssign[oi];
          if (cells[tr2][tc2] == null) {
            cells[tr2][tc2] = { t: 'box', color: _sc.color, count: _sc.count, _seq: fi, _dm: _sc._dm };
            fi++;
            continue;
          }
        }
        if (coupledAssign && oi < coupledAssign.length) {
          var _car = coupledAssign[oi];
          var _b0 = cells[tr2][tc2];
          if (_b0 == null) {
            cells[tr2][tc2] = { t: 'box', color: _car.color, count: _car.count, _seq: fi, _dm: _car._dm };
            fi++;
            continue;
          }
        }
        // 在暴露序里也做颜色交错：窗口内挑一个与"已放的四邻"都不同色的车，避免同色成片（被埋）
        var pickIdx = fi;
        if (exW > 0) {
          var bad = {};
          var nbs = [[tr2-1,tc2],[tr2+1,tc2],[tr2,tc2-1],[tr2,tc2+1]];
          for (var nb2 = 0; nb2 < 4; nb2++) {
            var xr = nbs[nb2][0], xc = nbs[nb2][1];
            if (xr < 0 || xr >= rows || xc < 0 || xc >= cols) continue;
            var xc2 = cells[xr][xc];
            if (xc2 && xc2.t === 'box') bad[xc2.color] = 1;
          }
          for (var wk = fi; wk < Math.min(fi + exW, list.length); wk++) {
            if (!bad[list[wk].color]) { pickIdx = wk; break; }
          }
        }
        if (pickIdx !== fi) { var mvx = list.splice(pickIdx, 1)[0]; list.splice(fi, 0, mvx); }
        // 【v239】_seq 记【摆位序】而不是原切序：冰的数值 = _seq + 延迟 就是在算"大概第几步走到它"，
        //   摆位改了以后必须跟着改，否则冰值又对不上位置（这正是实测"冰锁 23 步的车摆在深度1"的来源）。
        cells[tr2][tc2] = { t: 'box', color: list[fi].color, count: list[fi].count, chain: 0, q: false, numice: 0, _seq: fi };
        fi++;
      }
    } else {
    for (var fr = 0; fr < rows && fi < list.length; fr++) {
      for (var fc = 0; fc < cols && fi < list.length; fc++) {
        var cell = cells[fr][fc];
        if (cell == null) {
          var pk2 = pickNonAdj2(fi, fr, fc);
          if (pk2 !== fi) { var mv2 = list.splice(pk2, 1)[0]; list.splice(fi, 0, mv2); }
          cells[fr][fc] = { t: 'box', color: list[fi].color, count: list[fi].count, chain: 0, q: false, numice: 0, _seq: list[fi]._seq };
          fi++;
        } else if (cell.t === 'pipe') {
          cell.queue.push({ color: list[fi].color, count: list[fi].count }); fi++;
        }
      }
    }
    }
    // 【v260】铺完之后做闸门借车（此时盒子才是障碍，扇出才有意义）
    var _gbStat = null;
    try { _gbStat = gateBorrowAfterFill(cells, rows, cols, config); } catch (e) { _gbStat = null; }
    if (_gbStat) timing.gateBorrow = _gbStat;
    // 【v262】容量序列：同色浅车调大、深车调小（守恒），制造"开局吃不饱"的长债
    try {
      var _csStat = shapeCapacitySequence(cells, rows, cols, config);
      if (_csStat) timing.capSeq = _csStat;
    } catch (e) { }   // bindStat 此时还没声明，先挂 timing
    var rest = list.slice(fi);
    timing.fillMs = Date.now() - tFill;
    // 检查点1：填球完成（rest 为独立待放计数）
    var board0 = { rows: rows, cols: cols, cells: cells };
    var cv1 = verifyConservation(baseline, scanBoardActual(board0), 'fill', rest.length);
    conservation.push(cv1);
    if (!cv1.ok) return { ok: false, reason: 'conservation', stage: 'fill', conservation: conservation };

    // 溢出盒 → 管道均匀入队（每管 ≤ pipeMaxDepth，可调参数，默认 6 = 原常量）
    var qMaxDepth = pipeDepthOf(config);
    var tPipe = Date.now();
    if (rest.length > 0) {
      if (pipeList.length === 0) return { ok: false, reason: 'pipeCapacity', stage: 'pipeQueue', detail: '仍剩' + rest.length + '盒但无管道', conservation: conservation };
      var ri = 0, guard = rest.length + pipeList.length + 2;
      while (ri < rest.length && guard-- > 0) {
        var anyRoom = false;
        for (var pj = 0; pj < pipeList.length && ri < rest.length; pj++) {
          var pq = cells[pipeList[pj].r][pipeList[pj].c].queue;
          if (pq.length < qMaxDepth) { pq.push({ color: rest[ri].color, count: rest[ri].count }); ri++; anyRoom = true; }
        }
        if (!anyRoom) break;
      }
      if (ri < rest.length) return { ok: false, reason: 'pipeCapacity', stage: 'pipeQueue', detail: '管道全满(每管' + qMaxDepth + ')仍剩' + (rest.length - ri) + '盒', conservation: conservation };
    }
    // 检查点2：管道入队完成
    var cv2 = verifyConservation(baseline, scanBoardActual(board0), 'pipeQueue', 0);
    conservation.push(cv2);
    if (!cv2.ok) return { ok: false, reason: 'conservation', stage: 'pipeQueue', conservation: conservation };
    // 管道深度合法性
    if (maxPipeDepth(board0) > qMaxDepth)
      return { ok: false, reason: 'pipeDepth', stage: 'pipeQueue', detail: '最深管道' + maxPipeDepth(board0) + ' > 上限' + qMaxDepth, conservation: conservation };

    // 结构候选已满盘 → ensureBoardFull 应为空操作；一旦裁行则预定坐标失效 → 淘汰候选
    var ef = ensureBoardFull(cells, rows, cols, pipeList);
    if (ef.rows !== rows) return { ok: false, reason: 'rowTrim', stage: 'boardFull', detail: '裁行 ' + rows + '→' + ef.rows + '，预定障碍坐标失效', conservation: conservation };
    cells = ef.cells; rows = ef.rows; cols = ef.cols;
    var board = { rows: rows, cols: cols, cells: cells };
    // 检查点3：补满/裁行完成
    var cv3 = verifyConservation(baseline, scanBoardActual(board), 'boardFull', 0);
    conservation.push(cv3);
    if (!cv3.ok) return { ok: false, reason: 'conservation', stage: 'boardFull', conservation: conservation };
    timing.pipeCheckMs = Date.now() - tPipe;

    // ===== 只绑定预定障碍（禁止再次随机选择位置）=====
    var tBind = Date.now();
    var bindStat = {
      ice: { planned: struct.iceSlots.length, bound: 0, failed: 0, reasons: [], values: [] },   // key 仍叫 ice（历史报告兼容）；实际是数字冰
      question: { planned: struct.questionSlots.length, bound: 0, failed: 0, reasons: [] },
      chain: { planned: struct.chainGroups.length, bound: 0, failed: 0, reasons: [], groups: [] }
    };
    function boxAt(r, c) {
      if (r < 0 || r >= rows || c < 0 || c >= cols) return null;
      var x = cells[r][c];
      return (x && x.t === 'box') ? x : null;
    }
    // 数字冰（【v139】老冰下线：所有放冰点都写 numice；数值按该盒自然进度位次现算）
    // 【v299】`iceByReadyTime` 打开时，规划期的冰**全部跳过** —— 改为铺完车后由
    //   `applyIceSchedule` 按当用时刻 r 分档选（那样才知道每格放的是哪辆车）。
    //   规划期放冰的毛病：只知道"哪里有缺口"，不知道"将来放哪辆车"，
    //   所以冻到的常是同色同容量的车（r 相同 → 冰值相同），且位置必然贴着缺口（集中在前几行）。
    var _skipPlannedIce = !!(config && config.iceByReadyTime);
    if (_skipPlannedIce) {
      bindStat.ice.skippedByReadyTime = struct.iceSlots.length;
      // 下面有"绑定数必须等于计划数"的硬校验，跳过时必须把计划数一并归零，
      // 否则 planned>0 / bound=0 → 整批候选判 bind 淘汰（实测 8/15 全死在这）。
      bindStat.ice.planned = 0;
      bindStat.ice.values = [];
    }
    for (var ii = 0; ii < (_skipPlannedIce ? 0 : struct.iceSlots.length); ii++) {
      var sIce = struct.iceSlots[ii], bIce = boxAt(sIce.r, sIce.c);
      if (!bIce) { bindStat.ice.failed++; bindStat.ice.reasons.push('(' + sIce.r + ',' + sIce.c + ')无真实盒'); continue; }
      bIce.numice = numIceValueFor(cells, rows, cols, sIce.r, sIce.c, config);
      bindStat.ice.bound++;
      if (bindStat.ice.values) bindStat.ice.values.push(bIce.numice);
    }
    // 【v297·用户裁决 A】按 gap 分档把冰"散开"，避免同一批冰值一模一样。
    //
    // 问题（工作日志 222 节实测）：窄路缺口冰集中在同一片区域，落到的往往是**同色、容量相近**的车，
    //   于是 r 完全相同（实测四块冰 r 全是 0.204）→ 冰值算出来 [5,5,6,5]，看着"还是同一个数"。
    //   根因在选择哪几块格子上，不在数值公式 —— 公式是对的，是输入本身没差异。
    //
    // 做法：绑完冰之后做一轮重分配。凡是冰值与他人重复的车，把它挪到"gap 落在未占用档位"的
    //   空闲盒格上（不动链/问号/已有冰），再按新位置重算 numice。
    //   于是同一关的几块冰分别锁在"等得久/等得中等/等得短"的车上 —— 这才是"时差锁"的语义。
    try {
      var _spreadCfg = config && config.iceSpreadByGap !== false;
      if (_spreadCfg && bindStat.ice.bound > 1 && config && config._demandCurve) {
        var _dcS = config._demandCurve;
        var _totS = 0;
        for (var _r9 = 0; _r9 < rows; _r9++) for (var _c9 = 0; _c9 < cols; _c9++) {
          var _x9 = cells[_r9][_c9];
          if (_x9 && _x9.t === 'box') _totS++;
          else if (_x9 && _x9.t === 'pipe') _totS += (_x9.queue ? _x9.queue.length : 0);
        }
        function _gapOfCell(cell) {
          var need = 1;
          try { need = demandAt(_dcS, cell.color, cell.count); } catch (e) { need = 1; }
          var sq = (cell._seq != null) ? cell._seq : 0;
          var sp = _totS > 1 ? (sq / (_totS - 1)) : 0;
          return need - sp;
        }
        // 收集当前所有冰格
        var _icedAll = [];
        for (var _r8 = 0; _r8 < rows; _r8++) for (var _c8 = 0; _c8 < cols; _c8++) {
          var _x8 = cells[_r8][_c8];
          if (_x8 && _x8.t === 'box' && _x8.numice > 0) _icedAll.push({ r: _r8, c: _c8, cell: _x8, gap: _gapOfCell(_x8) });
        }
        // 【v297·修】按 gap 的**实际极差**归一化分档，不能从 0 开始切。
        //   实测（工作日志 222 节）：这张图上 gap 分布是 min −0.75 / 中位 −0.23 / max 0.10 ——
        //   **几乎全是负数**（车按摆位序到达时，颜色早就够用了 → 没有时差可锁）。
        //   原来写 max(0,gap)/0.15，负值全落进 0 号档 → 45 辆车挤在 1 个桶里，重分配永远挪不动。
        //   改成以实际 min/max 归一化，档数固定 4，保证同一关里能分出"等得久/中/短"三档。
        var _gMin = Infinity, _gMax = -Infinity;
        for (var _gm = 0; _gm < _icedAll.length; _gm++) {
          if (_icedAll[_gm].gap < _gMin) _gMin = _icedAll[_gm].gap;
          if (_icedAll[_gm].gap > _gMax) _gMax = _icedAll[_gm].gap;
        }
        // 极差太小说明这批冰的时差本来就一样，分档没有意义 → 仍按 4 档归一化，
        // 但下游会因"目标档位已被占用"而保持原位（挪不动是正确结果，不该硬挪）。
        var _gSpan = Math.max(1e-6, _gMax - _gMin);
        var _NB = 4;
        var _bucketOf = function (g) { return Math.min(_NB - 1, Math.floor((g - _gMin) / _gSpan * _NB)); };
        var _usedBucket = {};
        for (var _i8 = 0; _i8 < _icedAll.length; _i8++) _usedBucket[_bucketOf(_icedAll[_i8].gap)] = 1;
        // 候选空闲格（可放冰、且 gap 落在一个还没被占用的档）
        var _free = [];
        for (var _r7 = 0; _r7 < rows; _r7++) for (var _c7 = 0; _c7 < cols; _c7++) {
          var _x7 = cells[_r7][_c7];
          if (!_x7 || _x7.t !== 'box') continue;
          if (_x7.numice > 0 || _x7.chain > 0 || _x7.q) continue;
          var _g7 = _gapOfCell(_x7);
          if (_usedBucket[_bucketOf(_g7)]) continue;   // 已有同档的冰 → 不要再放，否则值又重复
          _free.push({ r: _r7, c: _c7, cell: _x7, gap: _g7 });
        }
        // 每个重复档位只保留"gap 最大"的那块，其余挪走
        var _byBucket = {};
        for (var _i7 = 0; _i7 < _icedAll.length; _i7++) {
          var _b7 = _bucketOf(_icedAll[_i7].gap);
          (_byBucket[_b7] = _byBucket[_b7] || []).push(_icedAll[_i7]);
        }
        var _moved = 0;
        for (var _bk in _byBucket) {
          var _grp7 = _byBucket[_bk];
          if (_grp7.length < 2) continue;
          _grp7.sort(function (a, b) { return b.gap - a.gap; });   // gap 大的保留原位
          for (var _qi = 1; _qi < _grp7.length && _free.length; _qi++) {
            var _src = _grp7[_qi];
            // 挑一个 gap 离它最远的目标（保证冰值拉开）
            var _bestI = -1, _bestD = -1;
            for (var _fi9 = 0; _fi9 < _free.length; _fi9++) {
              var _d9 = Math.abs(_free[_fi9].gap - _src.gap);
              if (_d9 > _bestD) { _bestD = _d9; _bestI = _fi9; }
            }
            if (_bestI < 0) break;
            var _dst = _free.splice(_bestI, 1)[0];
            _usedBucket[_bucketOf(_dst.gap)] = 1;
            _src.cell.numice = 0;
            _dst.cell.numice = numIceValueFor(cells, rows, cols, _dst.r, _dst.c, config);
            _moved++;
          }
        }
        bindStat.iceSpread = { iced: _icedAll.length, moved: _moved,
          buckets: Object.keys(_byBucket).length };
      }
    } catch (e) { bindStat.iceSpread = { error: String(e && e.message || e) }; }

    // 锁链（整组绑定，成员不足/不可激活/叠加冲突 → 该组失败）
    for (var gi = 0; gi < struct.chainGroups.length; gi++) {
      var grp = struct.chainGroups[gi], mem = grp.members, boxesOfGrp = [], missing = 0;
      for (var mi = 0; mi < mem.length; mi++) {
        var mb = boxAt(mem[mi].r, mem[mi].c);
        if (!mb) { missing++; continue; }
        boxesOfGrp.push({ box: mb, r: mem[mi].r, c: mem[mi].c });
      }
      if (missing > 0 || boxesOfGrp.length < 2) {
        bindStat.chain.failed++; bindStat.chain.reasons.push('组' + grp.group + '成员不足(缺' + missing + ')'); continue;
      }
      var occupied = false;
      for (var oi = 0; oi < boxesOfGrp.length; oi++) if (boxesOfGrp[oi].box.chain > 0 || boxesOfGrp[oi].box.q) { occupied = true; break; }
      if (occupied) { bindStat.chain.failed++; bindStat.chain.reasons.push('组' + grp.group + '成员已被其他障碍占用'); continue; }
      // 【v120 修复一个自 v103 就存在的真缺陷】这道「组间不得相邻」的检查原先**无条件**执行，
      // 完全没看本关是否抽中 `chainCluster`。规划期 `plannedConflict` 是按 CK.chainCluster 放开了 8-邻接的，
      // 于是簇被规划出来、到绑定期又被这里一律否掉 → 整个候选淘汰 → v103 的风险回退把 chainCluster 摘掉。
      // 实测：单开 chainCluster 时 5/5 全被摘（`chokeFallback.dropped=["chainCluster"]`），
      // 也就是说**这个卡点类型从引入起就从未真正生效过**。这里让绑定期与规划期用同一口径。
      var allowChainAdj = !!(config && config._chokePlan && config._chokePlan.has && config._chokePlan.has.chainCluster);
      if (!allowChainAdj && chainGroupConflict(cells, rows, cols, mem, grp.group)) {
        bindStat.chain.failed++; bindStat.chain.reasons.push('组' + grp.group + '与其他锁链组相邻'); continue;
      }
      for (var si = 0; si < boxesOfGrp.length; si++) boxesOfGrp[si].box.chain = grp.group;
      if (!chainActivatable(cells, rows, cols, mem)) {
        for (var ui = 0; ui < boxesOfGrp.length; ui++) boxesOfGrp[ui].box.chain = 0;
        bindStat.chain.failed++; bindStat.chain.reasons.push('组' + grp.group + '无法全部激活'); continue;
      }
      bindStat.chain.bound++;
      bindStat.chain.groups.push({ group: grp.group, type: grp.type, size: boxesOfGrp.length, src: grp.src, members: mem.slice() });
    }
    // 问号（不与锁链叠加）
    for (var qi2 = 0; qi2 < struct.questionSlots.length; qi2++) {
      var sQ = struct.questionSlots[qi2], bQ = boxAt(sQ.r, sQ.c);
      if (!bQ) { bindStat.question.failed++; bindStat.question.reasons.push('(' + sQ.r + ',' + sQ.c + ')无真实盒'); continue; }
      if (bQ.chain > 0) { bindStat.question.failed++; bindStat.question.reasons.push('(' + sQ.r + ',' + sQ.c + ')与锁链叠加'); continue; }
      bQ.q = true; bindStat.question.bound++;
    }
    timing.obstacleBindMs = Date.now() - tBind;
    // 任一预定项未能按计划绑定 → 淘汰整个结构候选（需求 §4.2）
    if (bindStat.ice.failed || bindStat.question.failed || bindStat.chain.failed ||
        bindStat.ice.bound !== bindStat.ice.planned ||
        bindStat.question.bound !== bindStat.question.planned ||
        bindStat.chain.bound !== bindStat.chain.planned) {
      return { ok: false, reason: 'bind', stage: 'obstacleBind', bindStat: bindStat, conservation: conservation };
    }

    // 顶部行障碍密度上限：纯减法后处理(只移除，不新增/不重选位置)
    var beforeTop = { ice: 0, q: 0, chain: 0, black: 0 };
    for (var tr = 0; tr < Math.min(2, rows); tr++) for (var tc = 0; tc < cols; tc++) {
      var tcell = cells[tr][tc];
      if (!tcell) continue;
      if (tcell.t === 'black') beforeTop.black++;
      else if (tcell.t === 'box') { if (tcell.numice > 0) beforeTop.ice++; if (tcell.q) beforeTop.q++; if (tcell.chain > 0) beforeTop.chain++; }
    }
    // 【v253】冰排程：冻住"开局免费车"，把取车顺序逼回需求序（在顶部封顶之前做，
    //   这样封顶仍会把前 2 行的过量障碍削掉，不会让排程把开局锁死）
    try { bindStat.iceSchedule = applyIceSchedule(cells, rows, cols, config); } catch (e) { bindStat.iceSchedule = null; }
    // 【v290】第 0 行同色限量的事后保证（在冰/链绑定之后做，避免动到被锁的格）
    // 【v291】卡点补救（前辈的 chokeSwap / chokeInflate，简化版）：只在本候选未合格时由上层调用
    try { bindStat.repairSwap = repairGatewaySwap(cells, rows, cols, blocks, config); } catch (e) { bindStat.repairSwap = null; }
    try { bindStat.repairInflate = repairInflate(cells, rows, cols, config); } catch (e) { bindStat.repairInflate = null; }
    try { bindStat.row0Diversify = diversifyRow0(cells, rows, cols, config); } catch (e) { bindStat.row0Diversify = null; }
    // 【v277】锁链按"大色块 × 小色块"配对（铺完之后才做，因为要看真实的颜色/容量）
    try { bindStat.chainByDemand = pairChainsByDemand(cells, rows, cols, config); } catch (e) { bindStat.chainByDemand = null; }
    enforceTopObstacleCap(cells, rows, cols, config);
    var afterTop = { ice: 0, q: 0, chain: 0, black: 0 };
    for (var tr2 = 0; tr2 < Math.min(2, rows); tr2++) for (var tc2 = 0; tc2 < cols; tc2++) {
      var t2 = cells[tr2][tc2];
      if (!t2) continue;
      if (t2.t === 'black') afterTop.black++;
      else if (t2.t === 'box') { if (t2.numice > 0) afterTop.ice++; if (t2.q) afterTop.q++; if (t2.chain > 0) afterTop.chain++; }
    }
    bindStat.topCapRemoved = {
      ice: beforeTop.ice - afterTop.ice, question: beforeTop.q - afterTop.q,
      chainMembers: beforeTop.chain - afterTop.chain, black: beforeTop.black - afterTop.black
    };

    // 孤立锁链清理（顶部整组清除后可能残留单成员）
    var chainCnt = {};
    for (var cr = 0; cr < rows; cr++) for (var cc = 0; cc < cols; cc++) {
      var cb = cells[cr][cc];
      if (cb && cb.t === 'box' && cb.chain > 0) chainCnt[cb.chain] = (chainCnt[cb.chain] || 0) + 1;
    }
    for (var dr = 0; dr < rows; dr++) for (var dc = 0; dc < cols; dc++) {
      var db = cells[dr][dc];
      if (db && db.t === 'box' && db.chain > 0 && chainCnt[db.chain] < 2) db.chain = 0;
    }
    // 清除铺盒临时标记
    for (var sr = 0; sr < rows; sr++) for (var sc = 0; sc < cols; sc++) {
      if (cells[sr][sc] && cells[sr][sc].t === 'box') delete cells[sr][sc]._seq;
    }

    // 检查点4：障碍绑定完成
    var cv4 = verifyConservation(baseline, scanBoardActual(board), 'obstacleBind', 0);
    conservation.push(cv4);
    if (!cv4.ok) return { ok: false, reason: 'conservation', stage: 'obstacleBind', conservation: conservation, bindStat: bindStat };

    return { ok: true, board: board, bindStat: bindStat, conservation: conservation };
  }

  // ---- R04/R06：1 遍基础贪心 + 最多 3 遍噪声贪心，成功即停 ----
  var SCREEN_PASSES_FIXED = [
    { key: 'base', tag: 'base', mode: 'greedy', noise: 0, seed: 1, timingKey: 'baseSolveMs' },
    { key: 'noise1', tag: 'n1', mode: 'greedy', noise: 0.6, seed: 53, timingKey: 'noise1Ms' },
    { key: 'noise2', tag: 'n2', mode: 'greedy', noise: 1.0, seed: 211, timingKey: 'noise2Ms' },
    { key: 'noise3', tag: 'n3', mode: 'greedy', noise: 1.5, seed: 401, timingKey: 'noise3Ms' }
  ];
  /**
   * @param {boolean} [bottomOnly=false] 目标图消除入口模式，作为 runSolver 第 5 实参下传。
   *   必须与本关最终全知求解、玩家模拟、审核所用的值一致——否则会出现
   *   "候选按四边入口判可解、最终按底部入口审核"的口径分裂（原需求 §2.2 明令禁止）。
   */
  function screenCandidateFixed(parsed, timing, bottomOnly, instantChain) {
    bottomOnly = !!bottomOnly;
    // 候选筛选必须与最终审核同一消除口径，否则出现「按原口径判可解、按新口径审核」的分裂（需求 §七.2）
    instantChain = !!instantChain;
    if (instantChain) bottomOnly = false;
    var best = null, logs = [];
    for (var i = 0; i < SCREEN_PASSES_FIXED.length; i++) {
      var p = SCREEN_PASSES_FIXED[i], t0 = Date.now();
      var r = AntSolver.Solver.runSolver(parsed, p.noise, p.seed, false, bottomOnly, { mode: p.mode, capturePreviewStats: true, instantChain: instantChain });
      var ms = Date.now() - t0;
      timing[p.timingKey] = ms;
      r.retryRound = p.tag; r.time = ms;
      logs.push({
        pass: p.key, mode: p.mode, noise: p.noise, seed: p.seed, ms: ms,
        completed: !!r.completed, progress: r.progress, steps: r.steps,
        maxBuffer: r.maxBuffer, completedBoxes: r.completedBoxes, totalBoxes: r.totalBoxes
      });
      if (!best || r.eliminatedPixels > best.eliminatedPixels) best = r;
      if (r.completed) {
        return { ok: true, result: r, passKey: p.key, mode: p.mode, noise: p.noise, seed: p.seed, ms: ms, passIndex: i + 1, logs: logs };
      }
    }
    return { ok: false, result: best, passIndex: SCREEN_PASSES_FIXED.length, logs: logs };
  }

  // ---- R07：基准解显式字段 ----
  /** 管道推出顺序：出口格被取走即触发该管道吐球，按 pickOrder 命中出口的先后成序。 */
  function derivePipeReleaseOrder(board, pickOrder) {
    var exitMap = {}, out = [];
    for (var r = 0; r < board.rows; r++) for (var c = 0; c < board.cols; c++) {
      var cell = board.cells[r][c];
      if (!cell || cell.t !== 'pipe') continue;
      var dv = AntSolver.PIPE_DIRS[cell.dir] || [1, 0];
      exitMap[(r + dv[0]) + ',' + (c + dv[1])] = { r: r, c: c, dir: cell.dir, queueLen: (cell.queue || []).length, released: 0 };
    }
    for (var i = 0; i < (pickOrder || []).length; i++) {
      var p = pickOrder[i];
      if (!p || p.r == null) continue;
      var hit = exitMap[p.r + ',' + p.c];
      if (!hit) continue;
      hit.released++;
      out.push({
        order: out.length + 1, step: p.step != null ? p.step : i + 1,
        pipe: { r: hit.r, c: hit.c }, dir: hit.dir, exit: { r: p.r, c: p.c },
        releaseIndex: hit.released, queueLen: hit.queueLen
      });
    }
    return out;
  }
  /** 区域解锁顺序：以【棋盘行】为区域最小单位，按该行首次被取盒的步骤成序。 */
  function deriveRegionUnlockOrder(pickOrder) {
    var seen = {}, out = [];
    for (var i = 0; i < (pickOrder || []).length; i++) {
      var p = pickOrder[i];
      if (!p || p.r == null) continue;
      if (seen[p.r]) continue;
      seen[p.r] = 1;
      out.push({ order: out.length + 1, region: 'row' + p.r, row: p.r, firstStep: p.step != null ? p.step : i + 1, firstPick: { r: p.r, c: p.c } });
    }
    return out;
  }
  /** 数字冰/问号推进与锁链进入-滞留-释放：以求解前棋盘快照识别障碍格，再对 pickOrder 归因。 */
  function deriveObstacleProgress(board, pickOrder) {
    var iceSet = {}, qSet = {}, chainOf = {}, chainSize = {};
    for (var r = 0; r < board.rows; r++) for (var c = 0; c < board.cols; c++) {
      var cell = board.cells[r][c];
      if (!cell || cell.t !== 'box') continue;
      var k = r + ',' + c;
      if (cell.numice > 0) iceSet[k] = cell.numice;   // 【v139】改为数字冰数值
      if (cell.q) qSet[k] = 1;
      if (cell.chain > 0) { chainOf[k] = cell.chain; chainSize[cell.chain] = (chainSize[cell.chain] || 0) + 1; }
    }
    var icePicks = [], questionPicks = [], chainMap = {};
    for (var i = 0; i < (pickOrder || []).length; i++) {
      var p = pickOrder[i];
      if (!p || p.r == null) continue;
      var key = p.r + ',' + p.c, step = p.step != null ? p.step : i + 1;
      if (iceSet[key]) icePicks.push({ step: step, r: p.r, c: p.c, numice: iceSet[key] });
      if (qSet[key]) questionPicks.push({ step: step, r: p.r, c: p.c });
      var g = chainOf[key];
      if (g) {
        // 口径说明：锁链组是【一次取整组同时离场】(simulator.applyPick 对 chain 组整体移除)，
        // 因此 pickOrder 里通常只出现【触发格】一条记录。不能用"全部成员都出现在 pickOrder"
        // 判定释放，否则 2/3 连组几乎永远被判成"未释放"（会得到严重失真的统计）。
        var s = chainMap[g] || (chainMap[g] = { group: g, size: chainSize[g], pickedCells: 0, triggerStep: step, cells: [] });
        s.pickedCells++; s.cells.push({ r: p.r, c: p.c, step: step });
        if (step < s.triggerStep) s.triggerStep = step;
      }
    }
    var chainStats = [];
    for (var gk in chainSize) {
      var m = chainMap[gk];
      chainStats.push(m
        ? {
            group: +gk, size: chainSize[gk],
            triggerStep: m.triggerStep,          // 整组被取（进入暂存）的步
            pickedCells: m.pickedCells,          // pickOrder 中命中的本组格数，正常为 1（整组同步离场）
            released: true,                      // 触发格已被取 → 整组已离场
            residenceSteps: null,                // 整组同一步离场；暂存内滞留需另采样，pickOrder 无法体现
            residenceNote: '整组同一步离场，暂存滞留不由 pickOrder 体现'
          }
        : {
            group: +gk, size: chainSize[gk],
            triggerStep: null, pickedCells: 0, released: false,
            residenceSteps: null, residenceNote: '本组在该解中始终未被取走'
          });
    }
    chainStats.sort(function (a, b) { return (a.triggerStep == null ? 1e9 : a.triggerStep) - (b.triggerStep == null ? 1e9 : b.triggerStep); });
    return {
      icePlanned: Object.keys(iceSet).length, icePicks: icePicks,
      questionPlanned: Object.keys(qSet).length, questionPicks: questionPicks,
      chainGroups: chainStats,
      chainFailed: chainStats.filter(function (x) { return !x.released; }).length
    };
  }
  /** 首轮基准解（卡点制造唯一依据）：pickOrder + 暂存变化 + 颜色首次可取 + 管道推出 + 区域解锁 + 障碍推进 + 遍次信息。 */
  function baselineSolutionFixed(board, parsed, result, screen) {
    var pickOrder = result.pickOrder || [];
    var colorFirstStep = {}, colorFirstOrder = [];
    for (var i = 0; i < pickOrder.length; i++) {
      var p = pickOrder[i];
      if (p.color == null || colorFirstStep[p.color] != null) continue;
      var st = p.step != null ? p.step : i + 1;
      colorFirstStep[p.color] = st;
      colorFirstOrder.push({ order: colorFirstOrder.length + 1, color: p.color, firstStep: st, at: { r: p.r, c: p.c } });
    }
    var obs = deriveObstacleProgress(board, pickOrder);
    return {
      pickOrder: pickOrder,
      bufferHistory: result.stepBufferHistory || [],
      maxBuffer: result.maxBuffer, avgBuffer: result.avgBuffer,
      pressureSamples: result.pressureSamples || [],
      colorFirstStep: colorFirstStep,
      colorFirstOrder: colorFirstOrder,
      pipeReleaseOrder: derivePipeReleaseOrder(board, pickOrder),
      regionUnlockOrder: deriveRegionUnlockOrder(pickOrder),
      iceProgress: { planned: obs.icePlanned, picks: obs.icePicks },
      questionProgress: { planned: obs.questionPlanned, picks: obs.questionPicks },
      chainProgress: { groups: obs.chainGroups, failed: obs.chainFailed },
      firstSuccess: {
        pass: screen.passKey, passIndex: screen.passIndex, mode: screen.mode,
        noise: screen.noise, seed: screen.seed, ms: screen.ms
      },
      screenLogs: screen.logs
    };
  }

  // ---- R05：完整候选成本计时 ----
  function newCandidateTiming() {
    return {
      boxBuildMs: 0, structureBuildMs: 0, obstacleSlotMs: 0, fillMs: 0, obstacleBindMs: 0,
      pipeCheckMs: 0, structuralCheckMs: 0, parseMs: 0, conservationCheckMs: 0,
      baseSolveMs: 0, noise1Ms: 0, noise2Ms: 0, noise3Ms: 0,
      candidatePrepareMs: 0, candidateBaseAttemptMs: 0, candidateTotalMs: 0
    };
  }

  /**
   * 单次候选尝试：结构候选 → 结构检查 → 填球 → 障碍绑定 → 守恒 → 1+3 求解筛选。
   * @returns {object} { ok, reason, timing, ... }
   */
  /**
   * 【v153】债务节拍 → 道具落位（config.beatProps 驱动）
   *
   * 背景（用户 2026-10-15/16 定下的模型）：压力来自"取了一辆颜色还没露脸的车 → 全额进暂存"。
   *   节拍 = 「在进度 p 附近，让玩家面对这样一辆债车」。落位职责是把这辆债车的**可见性与时机**固定下来：
   *     · ice(k)：给债车挂数字冰 = k → 它要等玩家再取 k 个球才进菜单（延迟到指定时点）
   *     · chain  ：把债车与**相邻**的另一色车绑成一组（与实机一致：锁链是相邻两辆）→ 取债车必须同时背两笔债
   *     · 管道   ：由结构层的配额决定（本函数不碰管道，避免与守恒/配额打架）
   *   只改 cells 上的 numice / chain 两个字段，**不改盒数与容量** → 守恒不受影响；
   *   改完由调用方继续跑结构性卡死检验与求解，破坏可解性的候选照旧淘汰。
   */
  /**
   * 【v159】开局加压（用户 2026-10-16 批准）。
   *
   * 背景（实测）：最新几关 0~30% 段的"暂存 3~4"占比是 0%，前期完全没有预算压力；
   *   原因是现有手段（债务节拍 35/60/80、卡点变体）全在中后段发力，没有任何工具给开局造压力。
   *
   * 用户批准的两招（另两招：节拍第一笔提前已改在自动档；(d) 开局管道口本轮未做）：
   *   (b) 开局半满车：把开局段（盒序最前的 30%）的车扩容到"该色开局露头量 × 倍数"，
   *       容量从同色后段车搬过来 —— 守恒不变，但开局这辆车一口吃不满了，玩家要么垫着要么等；
   *   (c) 开局锁链：从开局段挑两辆不同色的车绑一组链 —— 一次占两个暂存槽。
   *
   * 前提（用户强调）：加压力的同时必须有解。本函数只动"容量分配"与"链"，不动盒数、不动总量；
   *   守恒不变（容量只在同色内搬运）；可解性由下游同一套"全知求解 + 审核 + 玩家模拟"把关，
   *   做不到的候选照旧被淘汰 —— 即"先出压力，再由门保证有解"。
   * 管道赌博约束（用户：必须赌管道时暂存须 ≤3）属 R6，本轮未做（玩家模拟仍透视管道）。
   *
   * config.earlyPressure === false 可整段关掉（回退逐值回到 v158）；earlyInflateMul 调扩容倍数。
   */
  function earlyPressure(board, blocks, config) {
    var rows = board.rows, cols = board.cols, cells = board.cells;
    var minCap = Math.max(2, config.boxSizeMin || 2), maxCap = Math.max(minCap, config.boxSizeMax || 52);
    var all = [];
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
      var x = cells[r][c];
      if (x && x.t === 'box') all.push({ r: r, c: c, cell: x, seq: (x._seq != null ? x._seq : (r * cols + c)) });
    }
    if (all.length < 6) return null;
    all.sort(function (a, b) { return a.seq - b.seq; });
    var nEarly = Math.max(3, Math.round(all.length * 0.15));   // 【v159】真正的"开局车"：最靠前的 15%（至少 3 辆）
    var early = all.slice(0, nEarly);

    // 目标图各色的"开局露头量"（未消除状态下的可达像素数）→ 扩容目标 = 露头量 × 倍数
    var R = blocks.length, C = blocks[0].length, zeroElim = [];
    for (var r2 = 0; r2 < R; r2++) { var rowA = []; for (var c2 = 0; c2 < C; c2++) rowA.push(false); zeroElim.push(rowA); }
    var blob = null;
    try { blob = exposedBlobByColor(zeroElim, blocks, R, C); } catch (e) { blob = null; }
    var out = { inflate: [], chain: null, ice: iced === undefined ? [] : iced };

    // (b) 开局半满车：扩容（最多动 3 辆，避免把整个开局都变成巨盒）
    var mul = (config.earlyInflateMul != null) ? config.earlyInflateMul : 1.5;
    for (var i = 0; i < early.length && out.inflate.length < 2; i++) {
      var e0 = early[i], cell = e0.cell;
      if (cell.q || cell.chain) continue;
      var E = blob ? (blob[cell.color] || 0) : 0;
      // 【v159】目标容量 = 接近上限（默认 boxSizeMax 的 85%）；若该色开局露头量更大，
      //   则取"露头量 × 倍数"，两者取大 —— 唯一目的：让开局这辆车一口吃不饱（要么垫、要么等露头）。
      var t1 = Math.round(maxCap * (config.earlyInflateScale != null ? config.earlyInflateScale : 0.85));
      var t2 = E > 0 ? Math.round(E * mul) : 0;
      var target = Math.min(maxCap, Math.max(minCap, Math.max(t1, t2)));
      if (target <= cell.count) continue;                 // 这份容量本来就够装 → 无需加压
      var donors = [];
      for (var j = 0; j < all.length; j++) {
        var d = all[j];
        if (d.cell === cell || d.cell.color !== cell.color) continue;
        if (d.cell.chain || d.cell.q) continue;
        if (d.seq <= e0.seq) continue;                    // 只从更晚出场的同色车搬容量
        donors.push(d.cell);
      }
      donors.sort(function (a, b) { return b.count - a.count; });
      var moved = 0;
      for (var k = 0; k < donors.length && cell.count < target; k++) {
        var take = Math.min(donors[k].count - minCap, target - cell.count);
        if (take > 0) { donors[k].count -= take; cell.count += take; moved += take; }
      }
      if (moved > 0) out.inflate.push({ r: e0.r, c: e0.c, color: cell.color, to: cell.count, movedFromDeck: moved });
    }

    // (b2) 【v159】开局数字冰：把开局"本来就能装满"的车锁住几手。
    //   为什么必须有这一条：实测把开局车扩容（半满车）**不会**产生压力 —— 玩家/求解器会直接绕开它，
    //   先去拿那些能装满的。只有把"免费车位"锁掉（数字冰 = 再取走 N 个盒才解冻），玩家才被迫
    //   先吃半满的车垫着，前期暂存才升得起来。这是本轮真正起作用的那一招。
    var iced = [];
    // ⚠ 实测结论（2026-10-16）：开局数字冰**默认关**。它确实能逼出前期暂存，但代价是
    //   无满解步数 3→11、独木桥 0→10 —— 与用户"无满解要少、独木桥≤1"的要求直接冲突。
    //   要开：config.earlyIce = true（实验用）。真正该走的路线是"让模拟玩家会贪心垫半满车"（第三条线），见日志。
    if (config.earlyIce === true) {
      var iceSteps = (config.earlyIceSteps != null) ? config.earlyIceSteps : 8;
      for (var i2 = 0; i2 < early.length && iced.length < 2; i2++) {
        var ic = early[i2].cell;
        if (ic.q || ic.chain || ic.numice > 0) continue;
        var E2 = blob ? (blob[ic.color] || 0) : 0;
        if (E2 < ic.count) continue;                    // 只锁"开局就能装满"的那种：锁掉免费的才逼得出压力
        ic.numice = Math.max(2, iceSteps);
        iced.push({ r: early[i2].r, c: early[i2].c, color: ic.color, steps: ic.numice });
      }
    }

    // (c) 开局锁链：开局段两辆不同色的车绑一组（一次占两个暂存槽）
    if (config.earlyChain !== false) {
      var maxGid = 0;
      for (var r3 = 0; r3 < rows; r3++) for (var c3 = 0; c3 < cols; c3++) { var y = cells[r3][c3]; if (y && y.chain > maxGid) maxGid = y.chain; }
      // 【v161】开局链必须**相邻**（用户 2026-10-16：不能跨过中间的车）：
      //   改成"从靠前的车出发，找它 4-邻接的另一辆"，而不是随便挑两辆靠前的。
      var pick2 = [];
      var D4c = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      for (var m = 0; m < early.length && pick2.length < 2; m++) {
        var f = early[m], fc = f.cell;
        if (fc.q || fc.chain) continue;
        // 候选伙伴：4-邻接、是盒、未上链、非问号、且**不同色**（同色绑一起没有"双占用"的意义）
        var nb = shuffle(D4c.slice());
        for (var nd = 0; nd < nb.length; nd++) {
          var nr = f.r + nb[nd][0], nc = f.c + nb[nd][1];
          if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
          var ncell = cells[nr][nc];
          if (!ncell || ncell.t !== 'box' || ncell.chain || ncell.q) continue;
          if (ncell.color === fc.color) continue;
          pick2.push({ r: f.r, c: f.c, cell: fc });
          pick2.push({ r: nr, c: nc, cell: ncell });
          break;
        }
      }
      if (pick2.length === 2) {
        var gid = maxGid + 1;
        pick2[0].cell.chain = gid; pick2[1].cell.chain = gid;
        out.chain = { gid: gid, cells: [[pick2[0].r, pick2[0].c], [pick2[1].r, pick2[1].c]],
                      colors: [pick2[0].cell.color, pick2[1].cell.color] };
      }
    }
    out.ice = iced;
    if (!out.inflate.length && !out.chain && !out.ice.length) return null;
    out.applied = out.inflate.length + (out.chain ? 1 : 0) + out.ice.length;
    out.earlyCells = nEarly;
    return out;
  }

  /**
   * 【v161】锁链相邻性硬保证（用户 2026-10-16：「现在锁链锁的那些车必须是相邻的，不能跨过中间的车」）。
   *
   * 现状核查（实测扫过全部产出）：结构阶段预定的链组本来就是**正交相邻**的 2/3 连，
   *   最近 19 关产出里 0 个不连通；但**没有一道统一兜底**——后处理（区域换色 / 扩容 / 换球）
   *   与 v159 新加的开局链都可能把成员挪开或不查相邻性（开局链当时只是"碰巧"相邻）。
   *   所以这里在**候选定稿前**统一修：逐组取 4-邻接的最大连通子集，落单成员取消链；子集 <2 则整组取消。
   *
   * 只改 chain 字段（0/组号），不动盒、不动容量、不动颜色 → 守恒与可解性不受影响。
   */
  function enforceChainAdjacency(board) {
    var rows = board.rows, cols = board.cols, cells = board.cells;
    var groups = {}, gid;
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
      var x = cells[r][c];
      if (x && x.t === 'box' && x.chain > 0) { gid = 'g' + x.chain; (groups[gid] = groups[gid] || []).push({ r: r, c: c }); }
    }
    var D4 = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    var fixed = 0, cleared = 0, groupsIn = 0, groupsOut = 0, detail = [];
    for (var g in groups) {
      var mem = groups[g];
      groupsIn++;
      var set = {}, i;
      for (i = 0; i < mem.length; i++) set[mem[i].r + ',' + mem[i].c] = mem[i];
      // 从每个成员出发做 4-邻接 BFS，取最大的连通子集
      var best = [];
      for (i = 0; i < mem.length; i++) {
        var startKey = mem[i].r + ',' + mem[i].c;
        if (set[startKey] === undefined) continue;
        var seen = {}, q = [mem[i]], comp = [];
        seen[startKey] = 1;
        while (q.length) {
          var cur = q.pop();
          comp.push(cur);
          for (var d = 0; d < 4; d++) {
            var k = (cur.r + D4[d][0]) + ',' + (cur.c + D4[d][1]);
            if (set[k] !== undefined && !seen[k]) { seen[k] = 1; q.push(set[k]); }
          }
        }
        if (comp.length > best.length) best = comp;
        for (var kk in seen) delete set[kk];   // 该连通块已访问过，别重复计算
      }
      if (best.length === mem.length) { groupsOut++; continue; }   // 已连通 → 不动
      // 不连通：保留最大连通子集，其余取消
      var keep = {};
      for (i = 0; i < best.length; i++) keep[best[i].r + ',' + best[i].c] = 1;
      var before = mem.length;
      for (i = 0; i < mem.length; i++) {
        if (!keep[mem[i].r + ',' + mem[i].c]) {
          var cell = cells[mem[i].r][mem[i].c];
          if (cell && cell.chain > 0) { cell.chain = 0; cleared++; }
        }
      }
      if (best.length >= 2) {
        groupsOut++; fixed++;
        detail.push('组' + g.slice(1) + '：' + before + ' 格 → 保留相邻的 ' + best.length + ' 格，清掉 ' + (before - best.length) + ' 格');
      } else {
        // 剩下的 <2 格没有互锁语义 → 整组取消（避免求解器收到孤立成员）
        for (i = 0; i < best.length; i++) {
          var c2 = cells[best[i].r][best[i].c];
          if (c2 && c2.chain > 0) { c2.chain = 0; cleared++; }
        }
        detail.push('组' + g.slice(1) + '：全部不连通 → 整组取消（' + before + ' 格）');
      }
    }
    if (!fixed && !cleared) return null;                 // 没动过 → 不挂字段（保持"未改动时本体一致"）
    return { groupsIn: groupsIn, groupsOut: groupsOut, repaired: fixed, clearedCells: cleared, detail: detail };
  }

  /**
   * 【v162】定向"抉择投放"（用户 2026-10-16 选的方案②：「利用不同的功能块，让玩家多一些抉择」）。
   *
   * 想法：卡点应该让玩家**做判断**（多个选择里只有一个"划算"），而不是把选择**挤掉**（墙/冰把可点数压到 1）。
   *   所以这里在**中后段（盒序 40%~80%，对应 30~80% 进度带）**主动投放"半满陷阱"：
   *   把某辆车的容量扩到接近上限（一口吃不满）→ 玩家如果贪它，就得先占一个暂存位，
   *   而旁边还有"能装满/能救车"的正确选项 → 形成"预算判断点"（v2 的 r9 指标）。
   *
   * 手段选择（用户 #2 的原话）：
   *   · **数字冰**：时间锁 —— 引导玩家先走别的路再回来（可随进度破开，打开新路径）；
   *   · **锁链**：空间锁 —— 逼一次占两个暂存位（"要救 A 必须先带 B"）；
   *   · **扩容（半满车）**：把"取它值不值"变成判断（本函数做的事）；
   *   · **墙**：唯一"永久且无信息"的工具 —— 因此本函数**不加墙**，只在已有结构上做选择层的压力。
   *
   * 守恒：容量只在同色车之间搬（总量不变）；不动盒数、不动颜色 → 可解性由下游同一套求解/审核把关。
   * config.choiceTrap === false 可关掉。
   */
  function choiceTrap(board, blocks, config) {
    var rows = board.rows, cols = board.cols, cells = board.cells;
    var minCap = Math.max(2, config.boxSizeMin || 2), maxCap = Math.max(minCap, config.boxSizeMax || 52);
    var all = [];
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
      var x = cells[r][c];
      if (x && x.t === 'box') all.push({ r: r, c: c, cell: x, seq: (x._seq != null ? x._seq : (r * cols + c)) });
    }
    if (all.length < 8) return null;
    all.sort(function (a, b) { return a.seq - b.seq; });
    var lo = Math.floor(all.length * 0.40), hi = Math.max(lo + 1, Math.floor(all.length * 0.80));
    var mid = all.slice(lo, hi);                       // 中后段的车 = 玩家的"中盘判断区"
    if (!mid.length) return null;
    // 目标容量：接近上限（一口吃不满），但别超过上限
    var targetCap = Math.max(minCap, Math.round(maxCap * (config.choiceTrapScale != null ? config.choiceTrapScale : 0.85)));
    var out = { traps: [] };
    for (var i = 0; i < mid.length && out.traps.length < 2; i++) {
      var e0 = mid[i], cell = e0.cell;
      if (cell.q || cell.chain || cell.numice > 0) continue;      // 已经在别的功能块上 → 不叠
      if (cell.count >= targetCap) continue;                       // 本来就够大 → 不需要
      if (cell.count >= maxCap) continue;
      var donors = [];
      for (var j = 0; j < all.length; j++) {
        var d = all[j];
        if (d.cell === cell || d.cell.color !== cell.color) continue;
        if (d.cell.chain || d.cell.q) continue;
        if (d.seq <= e0.seq) continue;                             // 只从更晚的同色车搬
        donors.push(d.cell);
      }
      donors.sort(function (a, b) { return b.count - a.count; });
      var moved = 0;
      for (var k = 0; k < donors.length && cell.count < targetCap; k++) {
        var take = Math.min(donors[k].count - minCap, targetCap - cell.count);
        if (take > 0) { donors[k].count -= take; cell.count += take; moved += take; }
      }
      if (moved > 0) out.traps.push({ r: e0.r, c: e0.c, color: cell.color, to: cell.count, moved: moved, at: Math.round(e0.seq / all.length * 100) + '%' });
    }
    if (!out.traps.length) return null;
    out.applied = out.traps.length;
    return out;
  }

  /**
   * 【v163】定向"抉择投放"（用户 #2 的正确放法：利用功能块让玩家多一些抉择）。
   *
   * 与 v162（负结果，按盒序乱放）的区别：**先求解、看清每一步有几个"能填满"的选项**，再下手：
   *   ① 沿父候选的通关路线逐步统计"能填满一辆车的选项数"；
   *   ② 只挑**进度 30~80% 且该步有 ≥2 个能填满选项**的位置（= 玩家此刻有余地、正在挑）；
   *   ③ 在该步把多余的"能填满"的车**扩容成一口吃不满**（容量从同色别的车搬 → 守恒不变），
   *      **只留 1 个能填满** → 从"随便选都对"变成"只有一个对"= 预算判断点（v2 的 r9）；
   *   ④ 一关最多动 2 辆；不动盒数/颜色/障碍，**不加墙**。
   *
   * 为什么不用自己再判优劣：本函数只在 `makeChokeVariantFixed` 里被调用，而那里**改完会重新求解 + 重新审核**，
   *   并且父候选与变体一起进 `candBetter` 比较（同档先比 v2 达标、再比 v2 分）——
   *   **达不到"预算判断点变多、独木桥/无满解不变差"的变体自然选不上**，等于自带筛选。
   *
   * config.choiceTrapDirected === false 可关。
   */
  function choiceTrapDirected(level, parent, config, blocks) {
    var S = AntSolver.Simulator;
    var pickOrder = (parent && parent.solveResult && parent.solveResult.pickOrder) || null;
    if (!S || !S.enter || !S.listMoves || !S.applyPick || !pickOrder || !pickOrder.length) return null;
    var board = level.board, cells = board.cells;
    var minCap = Math.max(2, config.boxSizeMin || 2), maxCap = Math.max(minCap, config.boxSizeMax || 52);
    var targetCap = Math.max(minCap, Math.round(maxCap * (config.choiceTrapScale != null ? config.choiceTrapScale : 0.85)));
    var st;
    try { st = S.enter(AntSolver.parseLevel({ blocks: level.blocks, bufferLimit: level.bufferLimit, board: board }), { useSlotStart: true }); }
    catch (e) { return null; }
    var found = [];
    try {
      for (var i = 0; i < pickOrder.length; i++) {
        var p = pickOrder[i];
        if (!p || p.r == null) continue;
        var moves = S.listMoves(st);
        var prog = st.totalBoxes ? (st.completedBoxes / st.totalBoxes) : 0;
        var fill = [];
        for (var j = 0; j < moves.length; j++) {
          var m = moves[j];
          if (!m.blocked && m.canConsume) fill.push(m);      // "能填满一辆车"的选项
        }
        if (fill.length >= 2 && prog >= 0.30 && prog <= 0.80) found.push({ prog: prog, fill: fill });
        S.applyPick(st, p.r, p.c);
        if (st.gameOver) break;
      }
    } catch (e) { /* 回放中断：用已采到的部分 */ }
    return choiceTrapApply(board, found, minCap, maxCap, targetCap);
  }

  /** 在选中的那一步"只留 1 个能填满的选项"，其余扩容成半满陷阱（容量同色内搬运，守恒不变）。 */
  function choiceTrapApply(board, found, minCap, maxCap, targetCap) {
    if (!found || !found.length) return null;
    var cells = board.cells;
    // 优先取进度居中（30~80% 的中间），一次只做一处，最多动 2 辆
    found.sort(function (a, b) { return Math.abs(a.prog - 0.55) - Math.abs(b.prog - 0.55); });
    for (var fi = 0; fi < found.length; fi++) {
      var fill = found[fi].fill, applied = 0, changes = [];
      for (var k = 0; k < fill.length; k++) {
        if (applied >= 2) break;
        if (k >= fill.length - 1) break;                 // 至少留 1 个"能填满"的正确选项
        var cell = cells[fill[k].r] && cells[fill[k].r][fill[k].c];
        if (!cell || cell.t !== 'box') continue;
        if (cell.q || cell.chain || cell.numice > 0) continue;   // 已挂别的功能块 → 不叠
        if (cell.count >= targetCap) continue;
        var donors = [];
        for (var r = 0; r < board.rows; r++) for (var c = 0; c < board.cols; c++) {
          var d = cells[r][c];
          if (!d || d.t !== 'box' || d === cell || d.color !== cell.color) continue;
          if (d.chain || d.q || d.count <= minCap) continue;
          donors.push(d);
        }
        donors.sort(function (a, b) { return b.count - a.count; });
        var want = targetCap - cell.count, moved = 0;
        for (var q = 0; q < donors.length && moved < want; q++) {
          var take = Math.min(donors[q].count - minCap, want - moved);
          if (take > 0) { donors[q].count -= take; cell.count += take; moved += take; }
        }
        if (moved > 0) { changes.push({ r: fill[k].r, c: fill[k].c, color: cell.color, to: cell.count, moved: moved }); applied++; }
      }
      if (applied > 0) return { applied: applied, at: Math.round(found[fi].prog * 100) + '%', fillBefore: fill.length, changes: changes };
    }
    return null;
  }

  /**
   * 【v165】修剪无用墙（用户 #1：墙的存在必须有意义 = 它要改变玩家的可点选择数）。
   *
   * 判据（便宜、不需要求解）：把某块墙临时当成"空位"，重算**开局露头集合**——
   *   · 如果因此有**新的盒子被激活**（可点）→ 这块墙在**堵路**（挡住了空腔往里的通路）→ **保留**；
   *   · 如果什么盒子都没多出来 → 它只是占格、对"谁什么时候能点"毫无影响 → **改成空位**。
   *
   * 为什么改成"空位"而不是删掉格子：棋盘格数 = 盒 + 墙 + 管道 + 空位，改成空位**不动盒数、
   *   不动每辆车的容量、不动棋盘尺寸**（守恒完全不变），只是少一块阻挡、盘面更开阔。
   *
   * ⚠ 本轮判据只看**开局**露头（不求解，成本 O(格数)/块）。已知局限：中后段才起作用、开局看不出来的墙
   *   会被一并改成空位——这是"多做减法"的保守方向（宁可少一块阻挡，也不留一块没意义的墙）。
   *   config.pruneWalls === false 可关；跟随 v2 开关（关 v2 时不生效，保证回退契约）。
   */
  function wallPruneActivation(board, skip) {
    var rows = board.rows, cols = board.cols, cells = board.cells;
    function walkable(r, c) {
      if (skip && skip[0] === r && skip[1] === c) return true;   // 这块墙"假装是空位"
      var x = cells[r][c];
      if (!x) return true;
      return x.t === 'empty';
    }
    var reach = [], q = [], r, c;
    for (r = 0; r < rows; r++) { var rowA = []; for (c = 0; c < cols; c++) rowA.push(false); reach.push(rowA); }
    for (c = 0; c < cols; c++) if (walkable(0, c)) { reach[0][c] = true; q.push([0, c]); }
    var D4 = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    while (q.length) {
      var cur = q.pop();
      for (var d = 0; d < 4; d++) {
        var nr = cur[0] + D4[d][0], nc = cur[1] + D4[d][1];
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        if (reach[nr][nc]) continue;
        if (!walkable(nr, nc)) continue;
        reach[nr][nc] = true; q.push([nr, nc]);
      }
    }
    var set = {};
    for (r = 0; r < rows; r++) for (c = 0; c < cols; c++) {
      var x2 = cells[r][c];
      if (!x2 || x2.t !== 'box') continue;
      var ok = (r === 0);
      for (var e = 0; e < 4 && !ok; e++) {
        var ar = r + D4[e][0], ac = c + D4[e][1];
        if (ar < 0 || ar >= rows || ac < 0 || ac >= cols) continue;
        if (reach[ar][ac]) ok = true;
      }
      if (ok) set[r + ',' + c] = 1;
    }
    return set;
  }

  function pruneUselessWalls(board, config) {
    var rows = board.rows, cols = board.cols, cells = board.cells;
    var walls = [];
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
      var x = cells[r][c];
      if (x && x.t === 'black') walls.push([r, c]);
    }
    if (!walls.length) return null;
    var base = wallPruneActivation(board, null);
    var kept = [], pruned = [];
    for (var i = 0; i < walls.length; i++) {
      var rc = walls[i];
      var cand = wallPruneActivation(board, rc);
      var adds = 0;
      for (var k in cand) if (!base[k]) adds++;
      if (adds > 0) kept.push(rc);                 // 堵路 → 留
      else { cells[rc[0]][rc[1]] = { t: 'empty' }; pruned.push(rc); }   // 纯占格 → 变空位
    }
    if (!pruned.length) return null;               // 没剪过 → 不挂字段（保持"不动则本体一致"）
    return { wallsBefore: walls.length, wallsKept: kept.length, pruned: pruned.length, prunedAt: pruned };
  }

  /**
   * 【v170】"冰当墙用"：定向把免费选项锁到中段（用户 2026-10-16：
   *   「数字冰就能够起到墙的作用，而且还更加灵活，因为会在某个时间点打开，从而引起其他盒子的路径的变化」；
   *    并明确「不要固定死冰/墙/链的数量——这些都是做难度时可以选择的变量」）。
   *
   * 目标不是"放几块冰"，而是**把中后期峰窗顶到压力门**（`config.midLatePeakMin`，默认 3.5）：
   *   ① 沿父候选通关路线，找**中后段（30~85%）里压力不足**（暂存 < 目标-0.5）的步；
   *   ② 在这些步上，把"**本来能填满**"的车挂数字冰（N = 6~12 手后解冻）→ 把免费选项锁到中段，
   *      逼玩家先垫暂存 → 峰窗上升；
   *   ③ **一次只加一处**（同一处最多 2 辆）；数量由外层搜索决定：变体反复加压，达不到门的被
   *      `candBetter` 直接淘汰（改完由 makeChokeVariantFixed 重新求解 + 重新审核）。
   *
   * 语义务必与实机一致：`numice = 剩余球数`（再取走 N 个盒就解冻）；未解冻前该车不可点（isNumIceLocked）。
   * config.iceAsWall === false 可关。
   */
  function pressureBoostIce(level, parent, config, blocks) {
    var S = AntSolver.Simulator;
    var pickOrder = (parent && parent.solveResult && parent.solveResult.pickOrder) || null;
    if (!S || !S.enter || !S.listMoves || !pickOrder || !pickOrder.length) return null;
    var board = level.board, cells = board.cells, limit = level.bufferLimit || 5;
    var st;
    try { st = S.enter(AntSolver.parseLevel({ blocks: level.blocks, bufferLimit: limit, board: board }), { useSlotStart: true }); }
    catch (e) { return null; }
    var target = (config.midLatePeakMin != null) ? config.midLatePeakMin : (CHOKE_V2_GATES.midLatePeakMin || 3.5);
    var wantBuf = Math.max(2, Math.round(target - 0.5));      // 想把中途暂存顶到的高度
    var cands = [];
    try {
      for (var i = 0; i < pickOrder.length; i++) {
        var p = pickOrder[i];
        if (!p || p.r == null) continue;
        var moves = S.listMoves(st);
        var prog = st.totalBoxes ? (st.completedBoxes / st.totalBoxes) : 0;
        var buf = st.buffer.length, fill = [], pad = [];
        for (var j = 0; j < moves.length; j++) {
          var m = moves[j];
          if (m.blocked) continue;
          if (m.canConsume) fill.push(m); else pad.push(m);   // pad = 能点但一口填不满（"只能垫"）
        }
        if (prog >= 0.30 && prog <= 0.85 && buf < wantBuf && fill.length >= 1) {
          cands.push({ prog: prog, buf: buf, fill: fill, pad: pad, step: i });
        }
        S.applyPick(st, p.r, p.c);
        if (st.gameOver) break;
      }
    } catch (e) { /* 回放中断：用已采到的部分 */ }
    if (!cands.length) return null;
    // 优先救"最缺压力"的那一步（暂存最低；同分取进度靠中）
    cands.sort(function (a, b) { return (a.buf - b.buf) || (Math.abs(a.prog - 0.55) - Math.abs(b.prog - 0.55)); });
    // 【v171 修正】只在**这一步"能填满"的车全部锁掉、且仍留至少一辆"只能垫"的可点车**时才落地 ——
    //   否则玩家/求解器会绕开被锁的车（v170 首轮实测：锁 1~2 辆 → 峰窗一点不动）。
    for (var ci = 0; ci < cands.length; ci++) {
      var t = cands[ci], added = [];
      if (!t.pad.length) continue;                                 // 锁完就没得点 = 死局 → 换下一步
      for (var k = 0; k < t.fill.length; k++) {
        var rc = t.fill[k], cell = cells[rc.r] && cells[rc.r][rc.c];
        if (!cell || cell.t !== 'box') continue;
        if (cell.numice > 0 || cell.chain || cell.q) { added.push({ r: rc.r, c: rc.c, skipped: '已挂其它功能块' }); continue; }
        var n = (config.iceAsWallSteps != null) ? config.iceAsWallSteps : (6 + (t.step % 7));
        cell.numice = Math.max(2, n);
        added.push({ r: rc.r, c: rc.c, color: cell.color, steps: cell.numice, at: Math.round(t.prog * 100) + '%' });
      }
      var real = added.filter(function (x) { return !x.skipped; });
      if (real.length) return { applied: real.length, probedSteps: cands.length, wantBuf: wantBuf,
                                padLeft: t.pad.length, at: Math.round(t.prog * 100) + '%', marks: real };
    }
    return null;
  }

  /**
   * 【v172】切球层加压（用户 2026-10-16 批准的方向）：**中段成片变成"一口吃不满"**。
   *
   * 为什么不是前面那几招：v162（按盒序扩容）/ v163（单点陷阱）/ v170-v171（定向锁冰）都只能改**一两辆**，
   *   而峰窗是"**持续多步的高占用**"——改一辆会被局部化解（垫进去→下一步就消掉）。
   *   本招改成**成片**：在 40~80% 区间里，把"**本来能填满**"的车**连同容量一起抬到超过该色此刻的露头量**
   *   （`count > blob[color]`）→ 玩家在中段**无论选哪辆都吃不饱**，被迫连续垫槽 → 暂存持续高 → 峰窗才可能上来。
   *
   * 守恒：容量只在该色内部搬运（从同色别的车扣），总量不变；不动盒数、不动颜色、不动障碍。
   * 只改结构（不改实机协议字段）；改完由 makeChokeVariantFixed **重新求解 + 重新审核**，达不到门的变体自然被淘汰。
   * config.capSqueeze === false 可关；capSqueezeMax 控制"一次最多改几辆"（默认 4）。
   */
  function midgameCapacitySqueeze(level, parent, config, blocks) {
    var S = AntSolver.Simulator;
    var pickOrder = (parent && parent.solveResult && parent.solveResult.pickOrder) || null;
    if (!S || !S.enter || !S.listMoves || !S.applyPick || !pickOrder || !pickOrder.length) return null;
    var board = level.board, cells = board.cells, limit = level.bufferLimit || 5;
    var minCap = Math.max(2, config.boxSizeMin || 2);
    var maxCap = Math.max(minCap + 1, config.boxSizeMax || 52);
    var st;
    try { st = S.enter(AntSolver.parseLevel({ blocks: level.blocks, bufferLimit: limit, board: board }), { useSlotStart: true }); }
    catch (e) { return null; }
    var target = (config.midLatePeakMin != null) ? config.midLatePeakMin : 3.5;
    var wantBuf = Math.max(3, Math.round(target - 0.5));
    var maxN = (config.capSqueezeMax != null) ? config.capSqueezeMax : 4;
    var mul = (config.capSqueezeMul != null) ? config.capSqueezeMul : 1.25;
    var changed = [], dbg = { steps: pickOrder.length, candSteps: 0, blobFail: 0, tried: 0, noDonor: 0 };
    try {
      for (var i = 0; i < pickOrder.length && changed.length < maxN; i++) {
        var p = pickOrder[i];
        if (!p || p.r == null) continue;
        var prog = st.totalBoxes ? (st.completedBoxes / st.totalBoxes) : 0;
        var buf = st.buffer.length;
        if (prog >= 0.40 && prog <= 0.80 && buf < wantBuf) {
          dbg.candSteps++;
          var blob = null;
          try { blob = exposedBlobByColor(st.eliminated, st.blocks, st.rows, st.cols); } catch (e2) { blob = null; }
          if (!blob) dbg.blobFail++;
          if (blob) {
            var moves = S.listMoves(st);
            for (var j = 0; j < moves.length && changed.length < maxN; j++) {
              var m = moves[j];
              if (m.blocked || !m.canConsume) continue;
              var cell = cells[m.r] && cells[m.r][m.c];
              if (!cell || cell.t !== 'box') continue;
              if (cell.numice > 0 || cell.chain || cell.q) continue;
              var E = blob[cell.color] || 0;
              if (E <= 0) continue;
              var want = Math.min(Math.round(E * mul) + 1, maxCap);
              dbg.tried++;
              if (want <= cell.count) continue;                 // 已经吃不饱 → 不用动
              var donors = [];
              for (var r = 0; r < board.rows; r++) for (var c = 0; c < board.cols; c++) {
                var d = cells[r][c];
                if (!d || d.t !== 'box' || d === cell || d.color !== cell.color) continue;
                if (d.chain || d.q || d.numice > 0 || d.count <= minCap) continue;
                donors.push(d);
              }
              donors.sort(function (a, b) { return b.count - a.count; });
              var moved = 0, need = want - cell.count;
              for (var q = 0; q < donors.length && moved < need; q++) {
                var take = Math.min(donors[q].count - minCap, need - moved);
                if (take > 0) { donors[q].count -= take; cell.count += take; moved += take; }
              }
              if (moved > 0) changed.push({ r: m.r, c: m.c, color: cell.color, to: cell.count, wasExposed: E, moved: moved, at: Math.round(prog * 100) + '%', buf: buf });
              else dbg.noDonor++;
            }
          }
        }
        S.applyPick(st, p.r, p.c);
        if (st.gameOver) break;
      }
    } catch (e) { /* 回放中断：用已采到的部分 */ }
    if (!changed.length) return config.capSqueezeDebug ? { applied: 0, wantBuf: wantBuf, dbg: dbg } : null;
    return { applied: changed.length, wantBuf: wantBuf, dbg: dbg, marks: changed };
  }

  /**
   * 【v188·实验】找出"债色 c 的开壳色"：c 的像素 4-邻里有谁、且那些邻居的贪心轮次更早。
   *   返回按邻接次数降序的颜色数组（最多 4 个）。纯静态，只读 blocks + eliminationOrder。
   *   用途：定向冰要挂在"会提前打开 c"的车上，而不是 c 自己车上（v187 的教训）。
   */
  function shellColorsOf(blocks, color, cache) {
    if (cache && cache[color]) return cache[color];
    var rows = blocks.length, cols = blocks[0].length;
    var eo;
    try { eo = AntSolver.eliminationOrder(blocks, rows, cols, false); } catch (e) { eo = null; }
    var rd = eo ? eo.round : null;
    var cnt = {};
    var D4 = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
      if (blocks[r][c] !== color) continue;
      var myRound = rd ? (rd[r][c] || 0) : 0;
      for (var d = 0; d < 4; d++) {
        var nr = r + D4[d][0], nc = c + D4[d][1];
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        var v = blocks[nr][nc];
        if (v <= 0 || v === color) continue;
        if (rd && myRound && (rd[nr][nc] || 0) >= myRound) continue;   // 邻居不比我早 → 不是开壳
        cnt[v] = (cnt[v] || 0) + 1;
      }
    }
    var out = Object.keys(cnt).map(Number).sort(function (a, b) { return cnt[b] - cnt[a]; });
    if (cache) cache[color] = out;
    return out;
  }

  function applyBeatProps(board, config, blocks) {
    var props = (config && config.beatProps) || null;
    if (!props || !props.length) return null;
    var rows = board.rows, cols = board.cols, marks = [], applied = 0;
    var late = {};
    for (var q = 0; q < props.length; q++) if (props[q].debtColor) late[props[q].debtColor] = 1;
    function boxesOf(color) {
      var out = [];
      for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
        var x = board.cells[r][c];
        if (x && x.t === 'box' && x.color === color) out.push({ r: r, c: c, cell: x });
      }
      out.sort(function (a, b) { return a.r - b.r || a.c - b.c; });   // 行号小 = 早进菜单
      return out;
    }
    function maxChainId() {
      var mx = 0;
      for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
        var x = board.cells[r][c];
        if (x && x.chain > mx) mx = x.chain;
      }
      return mx;
    }
    var nextGid = maxChainId() + 1;
    for (var i = 0; i < props.length; i++) {
      var p = props[i], mine = boxesOf(p.debtColor);
      if (!mine.length) { marks.push({ kind: p.kind, ok: false, why: '棋盘上没有 ' + p.debtColor + ' 号色的盒子' }); continue; }
      var debt = mine[i % Math.min(mine.length, 2)];       // 节拍分散到不同辆车
      if (p.kind === 'ice') {
        // 【v188·实验】iceTarget === 'cure'：冰挂到"开壳车"（会提前打开债色的那些车）上，而不是债车。
        //   理由（v187 实测）：冰挂债车 → 车点不动 → 债根本不形成；要拖慢的是"解药"。
        var targetCell = null, targetColor = p.debtColor, why = '';
        if (config.iceTarget === 'cure' && blocks) {
          var shells = shellColorsOf(blocks, p.debtColor, {});
          for (var si = 0; si < shells.length && !targetCell; si++) {
            var sb = boxesOf(shells[si]);
            for (var sj = 0; sj < sb.length; sj++) {
              if (sb[sj].cell.numice > 0) continue;
              if (sb[sj].cell.chain) continue;
              targetCell = sb[sj]; targetColor = shells[si]; break;
            }
          }
          if (!targetCell) { marks.push({ kind: 'ice', ok: false, why: '债色 ' + p.debtColor + ' 没找到可挂冰的开壳车' }); continue; }
          why = 'cure of ' + p.debtColor;
        } else {
          targetCell = debt;
        }
        if (targetCell.cell.numice > 0) { marks.push({ kind: 'ice', ok: false, why: '该格已有冰' }); continue; }
        targetCell.cell.numice = Math.max(2, parseInt(p.steps, 10) || 6);
        marks.push({ kind: 'ice', ok: true, at: [targetCell.r, targetCell.c], color: targetColor, steps: targetCell.cell.numice, why: why });
        applied++;
        continue;
      }
      if (p.kind === 'chain') {
        if (debt.cell.chain) { marks.push({ kind: 'chain', ok: false, why: '债车已在链里' }); continue; }
        var D4 = [[-1, 0], [1, 0], [0, -1], [0, 1]], partner = null;
        for (var d = 0; d < 4 && !partner; d++) {
          var nr = debt.r + D4[d][0], nc = debt.c + D4[d][1];
          if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
          var nb = board.cells[nr][nc];
          if (!nb || nb.t !== 'box' || nb.chain || late[nb.color]) continue;   // 优先"早露脸色"的邻居；不绑另一个债色
          partner = { r: nr, c: nc, cell: nb };
        }
        if (!partner) { marks.push({ kind: 'chain', ok: false, why: '债车四邻没有可绑的早色车' }); continue; }
        debt.cell.chain = nextGid; partner.cell.chain = nextGid; nextGid++;
        marks.push({ kind: 'chain', ok: true, cells: [[debt.r, debt.c], [partner.r, partner.c]],
                     colors: [p.debtColor, partner.cell.color] });
        applied++;
        continue;
      }
      marks.push({ kind: p.kind, ok: false, why: '未实现的节拍道具种类' });
    }
    return { applied: applied, marks: marks, want: props.length };
  }

  /**
   * 【v189·实验】"别掐死"修复：如果稳健模拟里出现**被埋色**，就把它"开壳色"的车上的障碍拆掉，
   *   让那些车更早到位（= 把选择还给玩家）。改动前先做快照，修完更差就整体回滚。
   *   config.strangleRepair === true 才生效；默认关。
   *   成本：触发时 2 次稳健模拟（~0.1~0.2s）。
   */
  /**
   * 【v198】设计器·摆位：把"埋得最深的颜色"的车，换到第 0 行（恒可取）——
   *   玩家开局就能点它，而它的像素还被别的颜色盖着 → 这笔债是**设计出来的**，不是撒出来的。
   * 依据：原始工程 `interiorColorRank`（埋深排名，ratio 越小越深）。
   * 只换**普通盒**（无锁链、无数字冰），双方都在 box 格上；donor 选"在场数量最多"的浅色，
   *   这样它被挪到深处也只是少一辆早车，不会把某个颜色掐死。
   * config.designDebt === true 才生效；默认关。
   */
  /** 【v204】开局"可点集合"（模拟器口径）：第一帧能被点到的所有盒。 */
  function initialPickableCells(board, blocks, config) {
    try {
      var parsed = AntSolver.parseLevel({ blocks: blocks, bufferLimit: (config && config.bufferLimit) || 5, board: board });
      var st = AntSolver.Simulator.enter(parsed, { useSlotStart: true });
      var mv = AntSolver.Simulator.listMoves(st);
      var out = {};
      for (var i = 0; i < mv.length; i++) {
        var m = mv[i];
        if (m && m.antBox) out[m.r + ',' + m.c] = m.antBox.color;
      }
      return out;
    } catch (e) { return null; }
  }

  /**
   * 【v211·实验】阀门规划器：用数字冰控制"开局供给"。
   *   目标：把可点环上的「浅层车」压到 K 辆以内，逼玩家垫 → 债才会发生。
   *   做法：环上浅层车多于 K 时，给多出来的车挂数字冰（numice=3，取 3 个盒后解冻）。
   *   只动 numice，不动盒/容量；已有锁链/问号/冰的格子跳过。
   *   需要"每色的最浅层" —— 用色块依赖层（贴边块=0）算。
   */
  /**
   * 【v212·实验】定向锁链：把"开局同时可点、且都吃不满（深埋色）"的相邻两辆车绑成一组。
   *   机制：取一辆 → 整组进暂存 → 暂存瞬间涨 2 格 → 设计好的债。
   *   只绑普通盒（无冰/无问号/无链），且两格必须 4 相邻；找不到就什么都不做。
   *   config.chainPlan === true 才生效；默认关。
   */
  function planChains(board, blocks, config) {
    if (!config || !config.chainPlan) return null;
    var R = blocks.length, C = blocks[0].length;
    var cells = board.cells, rows = board.rows, cols = board.cols;
    // 每色最浅层（与 planValves 同口径）
    var comp = [], comps = [];
    for (var r = 0; r < R; r++) comp.push(new Array(C).fill(-1));
    for (var r2 = 0; r2 < R; r2++) for (var c2 = 0; c2 < C; c2++) {
      var v = blocks[r2][c2];
      if (v <= 0 || comp[r2][c2] >= 0) continue;
      var id = comps.length, st = [[r2, c2]], px = [];
      comp[r2][c2] = id;
      while (st.length) {
        var cur = st.pop(); px.push(cur);
        for (var d = 0; d < 4; d++) {
          var nb = [[cur[0]-1,cur[1]],[cur[0]+1,cur[1]],[cur[0],cur[1]-1],[cur[0],cur[1]+1]][d];
          if (nb[0] < 0 || nb[0] >= R || nb[1] < 0 || nb[1] >= C) continue;
          if (comp[nb[0]][nb[1]] >= 0 || blocks[nb[0]][nb[1]] !== v) continue;
          comp[nb[0]][nb[1]] = id; st.push([nb[0], nb[1]]);
        }
      }
      comps.push({ color: v, px: px, layer: -1 });
    }
    var adj = []; for (var i = 0; i < comps.length; i++) adj.push({});
    for (var r3 = 0; r3 < R; r3++) for (var c3 = 0; c3 < C; c3++) {
      var a = comp[r3][c3]; if (a < 0) continue;
      if (r3 + 1 < R) { var b1 = comp[r3+1][c3]; if (b1 >= 0 && b1 !== a) { adj[a][b1] = 1; adj[b1][a] = 1; } }
      if (c3 + 1 < C) { var b2 = comp[r3][c3+1]; if (b2 >= 0 && b2 !== a) { adj[a][b2] = 1; adj[b2][a] = 1; } }
    }
    var q = [];
    comps.forEach(function (cp, ci) {
      if (cp.px.some(function (p) { return p[0] === 0 || p[0] === R-1 || p[1] === 0 || p[1] === C-1; })) { cp.layer = 0; q.push(ci); }
    });
    for (var h = 0; h < q.length; h++) { var qi = q[h]; for (var k in adj[qi]) { var j = +k; if (comps[j].layer < 0) { comps[j].layer = comps[qi].layer + 1; q.push(j); } } }
    var colorLayer = {};
    comps.forEach(function (cp) { if (colorLayer[cp.color] === undefined || cp.layer < colorLayer[cp.color]) colorLayer[cp.color] = cp.layer; });

    var pick = initialPickableCells(board, blocks, config);
    if (!pick) return { ok: false, why: 'no-pick' };
    function plain(x) { return x && x.t === 'box' && !(x.chain > 0) && !(x.q) && !(x.numice > 0); }
    var deep = {};
    for (var pk in pick) {
      var pr = +pk.split(',')[0], pc = +pk.split(',')[1];
      var cell = cells[pr] && cells[pr][pc];
      if (!plain(cell)) continue;
      var L = colorLayer[cell.color];
      if (L === undefined || L < 3) continue;          // 只挑深埋色（吃了也填不满）
      deep[pr + ',' + pc] = { r: pr, c: pc, color: cell.color, layer: L };
    }
    var keys = Object.keys(deep);
    var used = {}, groups = [];
    var nextGid = 1;
    for (var r4 = 0; r4 < rows; r4++) for (var c4 = 0; c4 < cols; c4++) { var x4 = cells[r4][c4]; if (x4 && x4.chain > nextGid) nextGid = x4.chain; }
    nextGid += 1;
    for (var ki = 0; ki < keys.length; ki++) {
      var k1 = keys[ki]; if (used[k1]) continue;
      var p1 = deep[k1];
      var best = null;
      for (var d2 = 0; d2 < 4; d2++) {
        var nr = p1.r + [-1,1,0,0][d2], nc = p1.c + [0,0,-1,1][d2];
        var k2 = nr + ',' + nc;
        if (!deep[k2] || used[k2]) continue;
        best = deep[k2]; break;
      }
      if (!best) continue;
      used[k1] = used[best.r + ',' + best.c] = 1;
      var c1 = cells[p1.r][p1.c], c2 = cells[best.r][best.c];
      c1.chain = nextGid; c2.chain = nextGid;
      groups.push({ gid: nextGid, members: [{ r: p1.r, c: p1.c, color: p1.color, layer: p1.layer }, { r: best.r, c: best.c, color: best.color, layer: best.layer }] });
      nextGid++;
      if (groups.length >= (parseInt(config.chainGroupsMax, 10) || 2)) break;   // 默认最多两组
    }
    return { ok: groups.length > 0, deepCandidates: keys.length, groups: groups };
  }

  function planValves(board, blocks, config) {
    if (!config || !config.valvePlan) return null;
    var R = blocks.length, C = blocks[0].length;
    var cells = board.cells, rows = board.rows, cols = board.cols;
    // 每色最浅层（按色块 BFS，与合球同口径）
    var comp = [], comps = [];
    for (var r = 0; r < R; r++) { comp.push(new Array(C).fill(-1)); }
    for (var r2 = 0; r2 < R; r2++) for (var c2 = 0; c2 < C; c2++) {
      var v = blocks[r2][c2];
      if (v <= 0 || comp[r2][c2] >= 0) continue;
      var id = comps.length, st = [[r2, c2]], px = [];
      comp[r2][c2] = id;
      while (st.length) {
        var cur = st.pop(); px.push(cur);
        for (var d = 0; d < 4; d++) {
          var nb = [[cur[0]-1,cur[1]],[cur[0]+1,cur[1]],[cur[0],cur[1]-1],[cur[0],cur[1]+1]][d];
          var nr = nb[0], nc = nb[1];
          if (nr < 0 || nr >= R || nc < 0 || nc >= C) continue;
          if (comp[nr][nc] >= 0 || blocks[nr][nc] !== v) continue;
          comp[nr][nc] = id; st.push([nr, nc]);
        }
      }
      comps.push({ color: v, px: px, layer: -1 });
    }
    var adj = []; for (var i = 0; i < comps.length; i++) adj.push({});
    for (var r3 = 0; r3 < R; r3++) for (var c3 = 0; c3 < C; c3++) {
      var a = comp[r3][c3]; if (a < 0) continue;
      [[r3+1,c3],[r3,c3+1]].forEach(function (nb) {
        if (nb[0] >= R || nb[1] >= C) return;
        var b = comp[nb[0]][nb[1]];
        if (b < 0 || b === a) return;
        adj[a][b] = 1; adj[b][a] = 1;
      });
    }
    var q = [];
    comps.forEach(function (cp, ci) {
      var edge = cp.px.some(function (p) { return p[0] === 0 || p[0] === R-1 || p[1] === 0 || p[1] === C-1; });
      if (edge) { cp.layer = 0; q.push(ci); }
    });
    for (var h = 0; h < q.length; h++) {
      var qi = q[h];
      for (var k in adj[qi]) { var j = +k; if (comps[j].layer < 0) { comps[j].layer = comps[qi].layer + 1; q.push(j); } }
    }
    var colorLayer = {};
    comps.forEach(function (cp) { if (colorLayer[cp.color] === undefined || cp.layer < colorLayer[cp.color]) colorLayer[cp.color] = cp.layer; });

    // 可点环
    var pick = initialPickableCells(board, blocks, config);
    if (!pick) return { ok: false, why: 'no-pick' };
    function plain(x) { return x && x.t === 'box' && !(x.chain > 0) && !(x.q) && !(x.numice > 0); }
    var shallow = [], deep = [];
    for (var pk in pick) {
      var pr = +pk.split(',')[0], pc = +pk.split(',')[1];
      var cell = cells[pr] && cells[pr][pc];
      if (!plain(cell)) continue;
      var L = colorLayer[cell.color];
      if (L === undefined) continue;
      (L <= 1 ? shallow : deep).push({ r: pr, c: pc, color: cell.color, layer: L });
    }
    // 【v233】valveMode:'cut' → 冰继承"黑块位置"：找第二圈里的隔断点（邻接≥2个外层格），冻住它
    if (config.valveMode === 'cut') {
      var dR = rows, dC = cols, dist2 = [];
      for (var i3 = 0; i3 < dR; i3++) { dist2.push([]); for (var j3 = 0; j3 < dC; j3++) dist2[i3].push(-1); }
      var q2 = [];
      for (var r4 = 0; r4 < dR; r4++) for (var c4 = 0; c4 < dC; c4++) {
        var x4 = cells[r4][c4];
        if (!x4 || x4.t === 'black') continue;
        if (r4 === 0 || r4 === dR - 1 || c4 === 0 || c4 === dC - 1) { dist2[r4][c4] = 0; q2.push([r4, c4]); }
      }
      for (var h4 = 0; h4 < q2.length; h4++) {
        var a4 = q2[h4][0], b4 = q2[h4][1];
        var nb4 = [[a4-1,b4],[a4+1,b4],[a4,b4-1],[a4,b4+1]];
        for (var k4 = 0; k4 < 4; k4++) {
          var nr4 = nb4[k4][0], nc4 = nb4[k4][1];
          if (nr4 < 0 || nr4 >= dR || nc4 < 0 || nc4 >= dC) continue;
          var y4 = cells[nr4][nc4];
          if (!y4 || y4.t === 'black' || dist2[nr4][nc4] >= 0) continue;
          dist2[nr4][nc4] = dist2[a4][b4] + 1; q2.push([nr4, nc4]);
        }
      }
      var cands = [];
      for (var r5 = 0; r5 < dR; r5++) for (var c5 = 0; c5 < dC; c5++) {
        if (dist2[r5][c5] !== 1) continue;
        var c5cell = cells[r5][c5];
        if (!c5cell || c5cell.t !== 'box' || c5cell.numice > 0 || c5cell.chain > 0) continue;
        var nOpen = 0, nb5 = [[r5-1,c5],[r5+1,c5],[r5,c5-1],[r5,c5+1]];
        for (var m5 = 0; m5 < 4; m5++) {
          var rr5 = nb5[m5][0], cc5 = nb5[m5][1];
          if (rr5 < 0 || rr5 >= dR || cc5 < 0 || cc5 >= dC) continue;
          if (dist2[rr5][cc5] === 0) nOpen++;
        }
        if (nOpen >= 2) cands.push({ r: r5, c: c5, deg: nOpen });
      }
      cands.sort(function (a, b) { return b.deg - a.deg || a.r - b.r || a.c - b.c; });
      var wantCut = Math.max(1, Math.min(6, parseInt(config.valveCutCount, 10) || 3));
      var stepsC = Math.max(3, Math.min(12, parseInt(config.valveIceSteps, 10) || 8));
      var frozenC = [];
      for (var ci5 = 0; ci5 < cands.length && frozenC.length < wantCut; ci5++) {
        var cc5 = cells[cands[ci5].r][cands[ci5].c];
        if (!cc5 || cc5.t !== 'box') continue;
        cc5.numice = stepsC;
        frozenC.push({ r: cands[ci5].r, c: cands[ci5].c, color: cc5.color, numice: stepsC, deg: cands[ci5].deg });
      }
      return { ok: true, mode: 'cut', frozen: frozenC };
    }
    // 【v232】valveMode:'ring' → 用数字冰代替黑块：冻住环上若干辆（不分颜色），当作"临时墙"
    if (config.valveMode === 'ring') {
      var wantRing = Math.max(1, Math.min(12, parseInt(config.valveRingCount, 10) || 3));
      var stepsR = Math.max(3, Math.min(12, parseInt(config.valveIceSteps, 10) || 6));
      var frozenR = [];
      for (var ri2 = 0; ri2 < shallow.length && frozenR.length < wantRing; ri2++) {
        var sR = shallow[ri2];
        var cR = cells[sR.r] && cells[sR.r][sR.c];
        if (!cR || cR.numice > 0) continue;
        cR.numice = stepsR;
        frozenR.push({ r: sR.r, c: sR.c, color: sR.color, numice: stepsR });
      }
      return { ok: true, mode: 'ring', frozen: frozenR };
    }
    // 【v229】valveMode:'largest' → 只锁"总像素最多的 1~2 个颜色"在环上的车，numice 8~12
    if (config.valveMode === 'largest') {
      var colorPx = {};
      comps.forEach(function (cp) { colorPx[cp.color] = (colorPx[cp.color] || 0) + cp.px.length; });
      var topColors = Object.keys(colorPx).map(Number).sort(function (a, b) { return colorPx[b] - colorPx[a]; }).slice(0, 2);
      var steps = Math.max(6, Math.min(14, parseInt(config.valveIceSteps, 10) || 10));
      var frozenBig = [];
      for (var bi2 = 0; bi2 < shallow.length && frozenBig.length < 2; bi2++) {
        var sh2 = shallow[bi2];
        if (topColors.indexOf(sh2.color) < 0) continue;
        var cell2 = cells[sh2.r][sh2.c];
        if (!cell2 || cell2.numice > 0) continue;
        cell2.numice = steps;
        frozenBig.push({ r: sh2.r, c: sh2.c, color: sh2.color, layer: sh2.layer, numice: steps });
      }
      return { ok: true, mode: 'largest', topColors: topColors, frozen: frozenBig };
    }
    var keep = Math.max(0, parseInt(config.valveRingShallow, 10) || 2);
    var frozen = [];
    // 浅层车多出来的部分挂冰（按"层高的先冻"更稳：层 0 的留作供给）
    // 保留层最低的（第一辆）作为供给，其余按层从高到低冻
    shallow.sort(function (a, b) { return b.layer - a.layer || a.color - b.color; });
    while (shallow.length > keep) {
      var s0 = shallow.shift();
      var cc = cells[s0.r][s0.c];
      if (!cc) continue;
      cc.numice = Math.max(2, Math.min(8, parseInt(config.valveIceSteps, 10) || 3));
      frozen.push({ r: s0.r, c: s0.c, color: s0.color, layer: s0.layer, numice: cc.numice });
    }
    return { ok: true, ringShallowBefore: shallow.length + frozen.length, ringShallowAfter: shallow.length,
             ringDeep: deep.length, frozen: frozen, keep: keep };
  }

  function designDebtPlacement(board, blocks, config) {
    if (!config || !config.designDebt) return null;
    var rank = interiorColorRank(blocks, config.bottomOnly);
    if (!rank || !rank.length) return { ok: false, why: 'no-rank' };
    var ratioByColor = {};
    for (var i = 0; i < rank.length; i++) ratioByColor[rank[i].color] = rank[i].ratio;
    var cells = board.cells, rows = board.rows, cols = board.cols;
    // ⚠ 实测：interiorColorRank 在"满幅图"（没有背景 0 的边框）上会全部退化成 ratio=0，
    //   排名失效（before 恒为 0 → 设计器不动手）。改用 **消除轮次**（eliminationOrder.round）：
    //   轮次 1~2 = 早出（玩家开局就能吃到），≥3 = 深埋。
    var minRound = {};
    try {
      var eo = AntSolver.eliminationOrder(blocks, blocks.length, blocks[0].length, !!config.bottomOnly);
      if (eo && eo.round) {
        for (var er = 0; er < blocks.length; er++) for (var ec = 0; ec < blocks[0].length; ec++) {
          var ecol = blocks[er][ec]; if (ecol <= 0) continue;
          var ev = eo.round[er][ec];
          if (minRound[ecol] === undefined || ev < minRound[ecol]) minRound[ecol] = ev;
        }
      }
    } catch (e) { minRound = null; }
    function depthOf(color) { return (minRound && minRound[color] !== undefined) ? minRound[color] : 99; }
    function isExposed(color) {   // 有轮次表就用轮次，没有就退回原始 ratio
      if (minRound) return depthOf(color) <= 2;
      return (ratioByColor[color] || 0) > 0;
    }
    function isDeep(color) { return minRound ? depthOf(color) >= 3 : (ratioByColor[color] || 0) === 0; }
    var perColor = {};
    for (var r0 = 0; r0 < rows; r0++) for (var c0 = 0; c0 < cols; c0++) {
      var b0 = cells[r0][c0];
      if (b0 && b0.t === 'box') perColor[b0.color] = (perColor[b0.color] || 0) + 1;
    }
    function plain(x) { return x && x.t === 'box' && !(x.chain > 0) && !(x.numice > 0); }
    // 【v204】可点集合 = 模拟器第一帧的合法取盒（不是只看第 0 行）。
    //   小棋盘上边界格占比高，只看第 0 行会严重低估供给，导致"怎么挪都没用"。
    var pickMap = initialPickableCells(board, blocks, config);
    var pickable = {};
    var before = 0;
    if (pickMap) {
      for (var pk in pickMap) {
        var pr = +pk.split(',')[0], pc = +pk.split(',')[1];
        pickable[pk] = true;
        var yp = cells[pr] && cells[pr][pc];
        if (plain(yp) && isExposed(yp.color)) before++;
      }
    } else {   // 兜底：退回第 0 行
      for (var c1 = 0; c1 < cols; c1++) { var y1 = cells[0][c1]; if (plain(y1) && isExposed(y1.color)) { before++; pickable['0,' + c1] = true; } }
    }
    var target = Math.max(0, (config.designSupplyTarget != null ? parseInt(config.designSupplyTarget, 10)
      : (config.designRow0Target != null ? parseInt(config.designRow0Target, 10) : 3)) || 0);
    var maxMoves = Math.max(1, Math.min(6, parseInt(config.designDebtCount, 10) || 4));
    var moved = [], cur = before;
    for (var m = 0; m < maxMoves && cur > target; m++) {
      // ① donor：第 0 行里"暴露色、且该色在场上还有 ≥3 辆"的车（挪走一辆不会掐死这个色）
      var donor = null, bestCnt = -1;
      for (var pk2 in pickable) {
        var r2 = +pk2.split(',')[0], c2 = +pk2.split(',')[1];
        var y2 = cells[r2] && cells[r2][c2];
        if (!plain(y2) || !isExposed(y2.color)) continue;
        var cnt2 = perColor[y2.color] || 0;
        if (cnt2 >= 3 && cnt2 > bestCnt) { donor = { r: r2, c: c2 }; bestCnt = cnt2; }
      }
      if (!donor) break;
      // ② source：**不可点 + 深埋**的车（换上来也只能看不能吃 → 只占位不供给）
      var src = null;
      for (var r3 = rows - 1; r3 >= 0 && !src; r3--) {
        for (var c3 = 0; c3 < cols && !src; c3++) {
          if (pickable[r3 + ',' + c3]) continue;
          var y3 = cells[r3][c3];
          if (plain(y3) && isDeep(y3.color)) src = { r: r3, c: c3 };
        }
      }
      if (!src) break;
      var tmp = cells[src.r][src.c];
      cells[src.r][src.c] = cells[donor.r][donor.c];
      cells[donor.r][donor.c] = tmp;
      moved.push({ donorColor: cells[src.r][src.c].color, donorTo: [src.r, src.c], deepColor: cells[donor.r][donor.c].color, deepTo: [0, donor.c] });
      cur--;
    }
    // ③ 增容（原版 chokeInflate 的解前版）：把深埋色的**最大一辆车**容量放大，
    //   让它更久占住暂存位（压力更细，不需要再挪早车）。总量守恒：多出来的从同色其它车扣。
    var inflated = null;
    var k = parseFloat(config.designInflate);
    if (k > 1 && minRound) {
      var deepColors = {};
      for (var dc in minRound) if (minRound[dc] >= 3) deepColors[dc] = true;
      // 找深埋色里"车最多"的那色，取它最大的一辆
      var cands = {}, bestColor = null, bestN = 0;
      for (var r4 = 0; r4 < rows; r4++) for (var c4 = 0; c4 < cols; c4++) {
        var y4 = cells[r4][c4];
        if (!plain(y4) || !deepColors[y4.color]) continue;
        if (!cands[y4.color]) cands[y4.color] = [];
        cands[y4.color].push({ r: r4, c: c4, count: y4.count });
      }
      for (var cc2 in cands) { if (cands[cc2].length > bestN) { bestN = cands[cc2].length; bestColor = cc2; } }
      if (bestColor && cands[bestColor].length >= 2) {
        var list = cands[bestColor].slice().sort(function (a, b) { return b.count - a.count; });
        var big = list[0], targetCount = Math.round(big.count * k);
        var need = targetCount - big.count;
        if (need > 0) {
          var others = list.slice(1), given = 0;
          for (var oi = 0; oi < others.length && need > 0; oi++) {
            var take = Math.min(need, Math.max(0, others[oi].count - 1));
            if (take > 0) {
              cells[others[oi].r][others[oi].c].count -= take;
              need -= take; given += take;
            }
          }
          if (given > 0) {
            var bb = cells[big.r][big.c];
            bb.count += given;
            inflated = { color: +bestColor, at: [big.r, big.c], from: big.count, to: bb.count, given: given, k: k };
          }
        }
      }
    }
    // 【v214】按角色排环：保证环上至少有 designDeepRing 辆"深层车"（债点）。
    //   缺就把内圈的一辆深层车换到环上（换走一辆冗余的浅层车）。
    var deepTarget = Math.max(0, (config.designDeepRing != null ? parseInt(config.designDeepRing, 10) : 0) || 0);
    var deepOnRing = 0;
    for (var dpk in pickable) {
      var dpr = +dpk.split(',')[0], dpc = +dpk.split(',')[1];
      var dpc2 = cells[dpr] && cells[dpr][dpc];
      if (plain(dpc2) && isDeep(dpc2.color)) deepOnRing++;
    }
    var boosted = [];
    for (var bi = 0; bi < deepTarget - deepOnRing; bi++) {
      // 内圈的深层车
      var srcD = null;
      for (var br = 0; br < rows && !srcD; br++) for (var bc = 0; bc < cols && !srcD; bc++) {
        if (pickable[br + ',' + bc]) continue;
        var bcell = cells[br][bc];
        if (plain(bcell) && isDeep(bcell.color)) srcD = { r: br, c: bc };
      }
      // 环上冗余的浅层车
      var dstS = null, bestCnt3 = -1;
      for (var pk3 in pickable) {
        var r3b = +pk3.split(',')[0], c3b = +pk3.split(',')[1];
        var s3 = cells[r3b] && cells[r3b][c3b];
        if (!plain(s3) || !isExposed(s3.color)) continue;
        var cnt3 = perColor[s3.color] || 0;
        if (cnt3 >= 3 && cnt3 > bestCnt3) { dstS = { r: r3b, c: c3b }; bestCnt3 = cnt3; }
      }
      if (!srcD || !dstS) break;
      var tmp2 = cells[srcD.r][srcD.c];
      cells[srcD.r][srcD.c] = cells[dstS.r][dstS.c];
      cells[dstS.r][dstS.c] = tmp2;
      deepOnRing++;
      boosted.push({ deepColor: cells[dstS.r][dstS.c].color, to: [dstS.r, dstS.c], shallowColor: cells[srcD.r][srcD.c].color });
      delete pickable[srcD.r + ',' + srcD.c];
      pickable[dstS.r + ',' + dstS.c] = 1;
    }
    return { ok: (moved.length > 0 || !!inflated || boosted.length > 0), before: before, after: cur, target: target,
             moved: moved, inflated: inflated, deepRing: deepOnRing, boosted: boosted, deepTarget: deepTarget };
  }

  function repairStrangle(board, blocks, config) {
    if (!config || !config.strangleRepair) return null;
    function parsedOf() { return AntSolver.parseLevel({ blocks: blocks, bufferLimit: config.bufferLimit, board: board }); }
    var b0;
    try { b0 = buriedCountOf(parsedOf()); } catch (e) { return null; }
    if (!b0 || !b0.details || !b0.details.length) return { buried0: 0, removed: 0 };
    var snap = AntSolver.deepClone(board.cells);
    var removed = 0, marks = [], cache = {};
    var MAXR = (config.strangleRepairMax != null) ? Math.max(1, parseInt(config.strangleRepairMax, 10)) : 3;
    for (var di = 0; di < b0.details.length && removed < MAXR; di++) {
      var c = b0.details[di].color;
      var shells = shellColorsOf(blocks, c, cache);
      for (var si = 0; si < shells.length && removed < MAXR; si++) {
        var d = shells[si], did = false;
        // 先拆冰（最便宜、可逆）
        for (var r = 0; r < board.rows && !did; r++) for (var cc = 0; cc < board.cols && !did; cc++) {
          var x = board.cells[r][cc];
          if (!x || x.t !== 'box' || x.color !== d) continue;
          if (x.numice > 0) { marks.push({ kind: 'numice', at: [r, cc], color: d, of: c, was: x.numice }); x.numice = 0; removed++; did = true; }
        }
        if (did) continue;
        // 再拆链（整组一起拆，否则留下半组）
        for (var r2 = 0; r2 < board.rows && !did; r2++) for (var c2 = 0; c2 < board.cols && !did; c2++) {
          var y = board.cells[r2][c2];
          if (!y || y.t !== 'box' || y.color !== d || !y.chain) continue;
          var gid = y.chain, cnt = 0;
          for (var rr = 0; rr < board.rows; rr++) for (var ccc = 0; ccc < board.cols; ccc++) {
            var z = board.cells[rr][ccc];
            if (z && z.t === 'box' && z.chain === gid) { z.chain = 0; cnt++; }
          }
          marks.push({ kind: 'chain', color: d, of: c, size: cnt });
          removed++; did = true;
        }
      }
    }
    if (!removed) return { buried0: b0.details.length, removed: 0 };
    var b1 = null;
    try { b1 = buriedCountOf(parsedOf()); } catch (e) { b1 = null; }
    var after = b1 ? b1.buried : null;
    if (after != null && after > b0.buried) {          // 修完更差 → 回滚
      board.cells = snap;
      return { buried0: b0.buried, removed: 0, reverted: true, worseTo: after };
    }
    return { buried0: b0.buried, removed: removed, after: after, marks: marks };
  }

  /**
   * 【v187·实验】定向冰的"补足"：结构层没放随机冰（iceTargeted），这里在【盒已落位、债务节拍已挂】之后
   *   按冰配额补足剩余数量，优先不碰已经挂了冰的格子（= 债务节拍那几辆债车）。
   *   只挂 numice，不动盒与容量；config.iceTargeted !== true 时直接返回 null。
   */
  function topUpIce(board, config) {
    if (!config || !config.iceTargeted) return null;
    var rows = board.rows, cols = board.cols;
    var total = 0, iced = 0, pool = [];
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
      var x = board.cells[r][c];
      if (!x) continue;
      if (x.t === 'pipe') { total += (x.queue ? x.queue.length : 0); continue; }
      if (x.t !== 'box') continue;
      total++;
      if (x.numice > 0) iced++;
      else pool.push({ r: r, c: c });
    }
    var want = Math.floor(total * (config.icePercent || 0) / 100);
    var need = Math.max(0, want - iced);
    if (!need || !pool.length) return { want: want, icedBefore: iced, added: 0 };
    var sel = pickDispersed(pool, need, 2);
    var added = 0;
    for (var i = 0; i < sel.length && added < need; i++) {
      var cell = board.cells[sel[i].r][sel[i].c];
      if (!cell || cell.t !== 'box' || cell.numice > 0) continue;
      cell.numice = numIceValueFor(board.cells, rows, cols, sel[i].r, sel[i].c, config);
      added++;
    }
    return { want: want, icedBefore: iced, added: added };
  }

  /**
   * 【v192·实验】收尾调压一次：goodV3 量出峰窗越界时，按比例调冰重建一关，取更接近带的那一个。
   *   >4.8 → 冰 ×0.7；<3.2 → 冰 ×1.3；各最多一次（retry 的 config.pressureLoop=false，不递归）。
   *   判据：离带距离小者胜；距离相近时看六条谁过得更多。
   */
  function pressureLoopOnce(cand) {
    var gv = cand.goodV3;
    var p0 = gv && gv.midLateMax;
    if (p0 == null) return null;
    function dist(x) { return x == null ? 1e9 : (x < 3.2 ? (3.2 - x) : (x > 4.8 ? (x - 4.8) : 0)); }
    if (dist(p0) === 0) return { meta: { skipped: true, why: 'in-band', p1: p0 } };
    var cfg0 = cand.config || {};
    // 方案里可能只给了区间（icePercent 为 null）→ 用区间中值当基准
    var ice0;
    if (cfg0.icePercent != null && !isNaN(+cfg0.icePercent)) ice0 = +cfg0.icePercent;
    else if (cfg0.icePercentMin != null && cfg0.icePercentMax != null) ice0 = (+cfg0.icePercentMin + +cfg0.icePercentMax) / 2;
    else ice0 = 10;
    ice0 = Math.round(ice0);
    var steps = Math.max(1, Math.min(3, parseInt(cfg0.pressureLoopSteps, 10) || 2));
    var best = cand, bestP = p0, bestD = dist(p0), bestF = (gv.fails || []).length;
    var iceCur = ice0, log = [], pLast = p0;      // 方向看"上一次试出来的峰窗"，而不是最优的那个
    for (var i = 0; i < steps; i++) {
      var down = (pLast > 4.8);
      var ni = Math.round(iceCur * (down ? 0.85 : 1.15));
      ni = Math.max(0, Math.min(40, ni));
      if (ni === iceCur) break;
      // 只保留用户参数（_deadlineAt 等内部字段透传会让重建一开场就超时）
      var retry = {};
      for (var k in cfg0) { if (k.charAt(0) !== '_') retry[k] = cfg0[k]; }
      retry.icePercent = ni; retry.icePercentMin = ni; retry.icePercentMax = ni;
      retry.icePercentMin2 = undefined;
      retry.pressureLoop = false;
      try { retry.mapSize = cand.level.blocks.length; } catch (e) {}
      var res = null;
      try { res = produce(cand.level.blocks, retry); } catch (e) { res = null; }
      if (!res || !res.level || !res.goodV3) { log.push({ ice: ni, ok: false }); iceCur = ni; continue; }
      var p2 = res.goodV3.midLateMax, d2 = dist(p2), f2 = (res.goodV3.fails || []).length;
      log.push({ ice: ni, p2: p2, d: +d2.toFixed(2) });
      pLast = p2;
      // 【口径】先比"六条过几条"（越多越好），再比离带距离，最后比稳健通关率。
      //   只看离带距离会选到"峰窗进带、但被埋/稳打落后"的关（seed 104 实测）。
      var fBest = (best.goodV3 && best.goodV3.fails) ? best.goodV3.fails.length : 99;
      var better = false;
      if (f2 !== fBest) better = (f2 < fBest);
      else if (Math.abs(d2 - bestD) > 0.05) better = (d2 < bestD);
      else better = ((res.goodV3.steadyWonPct || 0) > ((best.goodV3 && best.goodV3.steadyWonPct) || 0));
      if (better) { best = res; bestP = p2; bestD = d2; bestF = f2; }
      if (d2 === 0) break;
      iceCur = ni;
    }
    return {
      meta: { tried: true, iceFrom: ice0, steps: log, p1: p0, pBest: bestP,
              dBand: +bestD.toFixed(2), picked: (best === cand) ? 'orig' : 'retry' },
      cand: (best === cand) ? null : best
    };
  }

  function buildOneCandidateAttempt(blocks, config, opts) {
    opts = opts || {};
    // 【v174】散点策略跟随卡点判据 v2 开关：关掉 v2 → 完全回到旧的"最大化最小距离"（口径不变/可回退）。
    DISPERSED_MAXMIN = (config && config.chokeV2 === false);
    var timing = newCandidateTiming();
    var tAll = Date.now();

    // ① 盒序列与盒总量预算
    var tBox = Date.now();
    var boxes = pickBoxSplit(blocks, config);   // bottomOnly 时走底部依赖流分支
    timing.boxBuildMs = Date.now() - tBox;
    var n = boxes.length;

    // 独立守恒基线（来源：原始盒序列 + 目标图，与棋盘无关）
    var tCons = Date.now();
    var baseline = buildConservationBaseline(boxes, blocks);
    timing.conservationCheckMs += Date.now() - tCons;
    if (baseline.baselineIssues.length) {
      timing.candidatePrepareMs = Date.now() - tAll; timing.candidateTotalMs = timing.candidatePrepareMs;
      return { ok: false, reason: 'baseline', detail: baseline.baselineIssues.join('；'), timing: timing, boxCount: n };
    }

    // ② 结构候选（黑块全部落位 → 实际剩余空间算管道 → 障碍预定位置）
    //   卡点类型计划由 produceFixed 在【每关开始时抽一次】并经 config._chokePlan 透传下来。
    //   为什么不在这里抽：本函数会被 maxRetries 重试多次，每次重抽会让一关跨重试用到超过配额的类型，
    //   违背用户要求①「每关出现对应数量」。缺省时（被独立调用）才就地抽一次作兜底。
    var chokePlan = config._chokePlan || pickChokeTypes(config, !!config.isBossSlot);
    var struct = buildStructureCandidateFixed(n, config, chokePlan);
    timing.structureBuildMs = struct.structureBuildMs || 0;
    timing.obstacleSlotMs = struct.obstacleSlotMs || 0;
    if (!struct.ok) {
      timing.candidatePrepareMs = Date.now() - tAll; timing.candidateTotalMs = timing.candidatePrepareMs;
      return { ok: false, reason: struct.reason || 'struct', detail: struct.detail || '', timing: timing, boxCount: n, blackStat: struct.blackStat, pipeStat: struct.pipeStat };
    }

    // ③ 填球 + 只绑定预定障碍 + 分阶段守恒
    var fill = fillStructureFixed(struct, boxes, baseline, config, timing, blocks);
    if (!fill.ok) {
      timing.candidatePrepareMs = Date.now() - tAll; timing.candidateTotalMs = timing.candidatePrepareMs;
      return {
        ok: false, reason: fill.reason, stage: fill.stage, detail: fill.detail || '',
        conservation: fill.conservation, bindStat: fill.bindStat, timing: timing, boxCount: n,
        blackStat: struct.blackStat, pipeStat: struct.pipeStat
      };
    }
    var board = fill.board;
    // 诊断信息随 board 带出：窄路是否真的落地、可用空间配额解。
    // 只供生产报告与验证观测，不参与任何生成决策，也不进官方关卡格式（toGameFormat 只取协议字段）。
    board.narrowStat = struct.narrowStat || null;
    board.spaceQuota = struct.spaceQuota || null;
    // 管道落位与兜底状态（ANT-GEN-PIPE-DEPTH-FALLBACK-20260825）：want/placed/capacityPerPipe
    // 以及 fallback* 标记。兜底是行为变更，必须可观测——否则"管道为什么只有 2 条"无从追溯。
    board.pipeStat = struct.pipeStat || null;

    // ③b 【v153】债务节拍落位：把"债车"的可见性/时机用冰或链固定下来（只挂 numice/chain，不动盒与容量）
    try {
      // 只在真的落了位时才挂诊断字段 —— 不落位时保持关卡本体与改动前【逐字节一致】（v149 口径不变测试就吃这个）
      var beatStat = applyBeatProps(board, config, blocks);
      if (beatStat) board.beatStat = beatStat;
    } catch (e) { board.beatStat = { applied: 0, error: String(e && e.message || e) }; }

    // ③c 【v159】开局加压：给开局段的车"扩容成半满车" + 绑一组开局锁链（用户 2026-10-16 批准，
    //   见 earlyPressure 上方说明）。config.earlyPressure === false 可关掉（回退逐值回到 v158 行为）。
    // 跟随卡点判据 v2 的开关：config.chokeV2 === false ⇒ 整段不生效（保证"关掉 v2 = 逐值回到 v158"，
    //   v149 口径不变测试就是靠这条守住回退契约）。config.earlyPressure === false 也可单独关。
    if (config.earlyPressure !== false && config.chokeV2 !== false) {
      try {
        var epStat = earlyPressure(board, blocks, config);
        if (epStat) board.earlyPressureStat = epStat;   // 只在真落地时挂诊断字段（不落地时保持本体一致）
      } catch (e) { board.earlyPressureStat = { applied: 0, error: String(e && e.message || e) }; }
    }

    // ③b2 【v187·实验】定向冰补足：结构层没撒的冰，在盒与债车都定下来之后按配额补
    try {
      var iceTop = topUpIce(board, config);
      if (iceTop) board.iceTopStat = iceTop;
    } catch (e) { board.iceTopStat = { error: String(e && e.message || e) }; }

    // ③c2 【v162】定向"抉择投放"：中后段投放半满陷阱（让玩家做预算判断，而不是把选择挤掉）
    //   ⚠ 实测结论（2026-10-16）：按"盒序中后段"投放**没有效果甚至更差** ——
    //     同种子 A/B：预算判断点 平均 4.25 → 3.25，窄选择占比 56.8% → 54.0%（独木桥不变）。
    //     原因：扩容会**消灭**一个"能装满"的选项，如果把该步本来只有 1~2 个满解选项的情况打掉，
    //     就变成"无满解"（硬垫）而不是"只剩一个对的选择"。正确的放法需要**先求解**、
    //     只在"该步有 ≥2 个能装满的选项"处投放，才能把"多选项"变成"预算判断点"。
    //   → 因此本招**默认关闭**，等改成"按 pickOrder 定向 + ≥2 满解约束"（在变体阶段、有再评价）再开。
    //   config.choiceTrap === true 可开（实验用）。
    if (config.choiceTrap === true && config.chokeV2 !== false) {
      try {
        var ctStat = choiceTrap(board, blocks, config);
        if (ctStat) board.choiceTrapStat = ctStat;   // 只在真落地时挂诊断字段
      } catch (e) { board.choiceTrapStat = { applied: 0, error: String(e && e.message || e) }; }
    }

    // ③c3 【v165】修剪无用墙：只保留"堵住了某个盒子露头"的墙，其余改成空位（守恒不变）
    // ⚠ 2026-10-16 首轮实测（v165_wall_prune_check.js，各 4 关）：判据"只看开局露头"有**致命缺陷**——
    //   当盘面**没有空位**（格 = 盒 + 墙）时，开局可达空腔为空 → 所有墙都被判成"没影响" → **全被剪光**（6.5 → 0 块）。
    //   后果：平均可点 4.65 → 6.20、窄选择 22.5% → 8.75%（好），但**预算判断点 8.5 → 3.0（卡点大幅变弱）**。
    //   → 因此**默认关闭**；正确做法是把判据换成"沿求解路线的多点快照"（每块墙一次回放，约 0.3~1s/关）。
    //   config.pruneWalls === true 可开（实验用）。
    if (config.pruneWalls === true && config.chokeV2 !== false) {
      try {
        var wpStat = pruneUselessWalls(board, config);
        if (wpStat) board.wallPruneStat = wpStat;
      } catch (e) { board.wallPruneStat = { error: String(e && e.message || e) }; }
    }

    // ③d 【v161】锁链相邻性兜底：同组的两/三辆车必须 4-邻接连通（用户：「不能跨过中间的车」）。
    //   放在结构阶段末尾（求解/审计之前）——清链会改变局面，必须在评价之前做完，否则审计结论是脏的。
    try {
      var laStat = enforceChainAdjacency(board);
      if (laStat) board.linkAdjStat = laStat;   // 只真修过才挂字段（未改动时不挂，保持"不动则本体一致"）
    } catch (e) { board.linkAdjStat = { error: String(e && e.message || e) }; }

    // ④ 结构性卡死检验（带球后的完整检查）
    var tSdc = Date.now();
    var sdc = structuralDeadlockCheck(board);
    timing.structuralCheckMs = Date.now() - tSdc;
    if (!sdc.ok) {
      timing.candidatePrepareMs = Date.now() - tAll; timing.candidateTotalMs = timing.candidatePrepareMs;
      return {
        ok: false, reason: 'structuralCheck', detail: sdc.reason, timing: timing, boxCount: n,
        blackStat: struct.blackStat, pipeStat: struct.pipeStat, bindStat: fill.bindStat, conservation: fill.conservation
      };
    }

    // ⑤ 解析
    // ③b2 【v198·实验】设计器·摆位：把埋得最深的车换到第 0 行，制造"设计好的债"（默认关）
    try {
      var dStat = designDebtPlacement(board, blocks, config);
      if (dStat) board.designStat = dStat;
    } catch (e) { board.designStat = { ok: false, error: String((e && e.message) || e) }; }

    // ③b2a 【v212·实验】定向锁链：把"可点且深埋"的相邻两辆车绑成一组（默认关）
    try {
      var cStat = planChains(board, blocks, config);
      if (cStat) board.chainStat2 = cStat;
    } catch (e) { board.chainStat2 = { ok: false, error: String((e && e.message) || e) }; }

    // ③b2b 【v211·实验】阀门规划：用数字冰把开局供给压到 K 辆以内
    try {
      var vStat = planValves(board, blocks, config);
      if (vStat) board.valveStat = vStat;
    } catch (e) { board.valveStat = { ok: false, error: String((e && e.message) || e) }; }

    // ③b3 【v189·实验】"别掐死"修复：被埋色 → 拆掉开壳车上的障碍，让选择回来（默认关）
    try {
      var strStat = repairStrangle(board, blocks, config);
      if (strStat) board.strangleStat = strStat;
    } catch (e) { board.strangleStat = { error: String(e && e.message || e) }; }

    var level = { blocks: blocks, bufferLimit: config.bufferLimit, board: board };
    var tParse = Date.now();
    var parsed = AntSolver.parseLevel(level);
    timing.parseMs = Date.now() - tParse;
    timing.candidatePrepareMs = Date.now() - tAll;

    // ===== 【v298·用户裁决A】可达性下限闸门 =====
    // 在跑求解器之前先问一句："按最保守的打法（只取能立刻装满的车），这关挖得开吗？"
    //   挖不开 → 结构上会埋死玩家，直接淘汰，不必再花时间求解。
    // 背景（工作日志 223 节）：depFill 把深层车按依赖层埋进深格后，形状对了（覆盖 83%）
    //   但稳健通关 0% —— 玩家挖到某层就卡住。全知求解器能过不代表玩家能（它不挑吃不饱的车）。
    // 开关：`accessGate`（默认跟随 depFill 打开；设为 false 可关）。成本约 1~3ms/候选。
    var _accessGate = (config.accessGate != null) ? !!config.accessGate : !!config.depFill;
    if (_accessGate) {
      var _acc = conservativeSolvable(level, {});
      timing.accessGate = { ok: _acc.ok, steps: _acc.steps, reason: _acc.reason, picked: _acc.picked, left: _acc.left };
      if (!_acc.ok) {
        return {
          ok: false, reason: 'access', stage: 'access',
          detail: '可达性下限未过：保守打法第 ' + _acc.steps + ' 步卡住（' + (_acc.reason || '') +
                  '），目标区还剩 ' + _acc.left + ' 像素挖不到',
          timing: timing, boxCount: n,
          blackStat: struct.blackStat, pipeStat: struct.pipeStat, bindStat: fill.bindStat,
          conservation: fill.conservation
        };
      }
    }

    // ⑥ 1 遍基础贪心 + 最多 3 遍噪声，成功即停
    var boardSnapshot = { rows: board.rows, cols: board.cols, cells: AntSolver.deepClone(board.cells) };
    var screen = screenCandidateFixed(parsed, timing, config.bottomOnly, config.instantChain);
    timing.candidateBaseAttemptMs = timing.candidatePrepareMs + timing.baseSolveMs;
    timing.candidateTotalMs = Date.now() - tAll;

    if (!screen.ok) {
      var failRec = {
        reason: 'screen', inputId: opts.inputId || null, candidateId: opts.candidateId || null,
        seedInfo: SCREEN_PASSES_FIXED.map(function (p) { return { pass: p.key, noise: p.noise, seed: p.seed }; }),
        board: boardSnapshot, bufferLimit: config.bufferLimit,
        screenLogs: screen.logs,
        bestProgress: screen.result ? screen.result.progress : 0,
        bestMaxBuffer: screen.result ? screen.result.maxBuffer : 0,
        obstacleSummary: {
          ice: fill.bindStat.ice, question: fill.bindStat.question, chain: fill.bindStat.chain,
          black: struct.blackStat, pipe: struct.pipeStat
        },
        timing: timing
      };
      if (typeof opts.onScreenFail === 'function') { try { opts.onScreenFail(failRec); } catch (e) {} }
      return { ok: false, reason: 'screen', timing: timing, boxCount: n, screen: screen, failedCandidate: failRec, blackStat: struct.blackStat, pipeStat: struct.pipeStat, bindStat: fill.bindStat, conservation: fill.conservation };
    }

    // ⑦ 首轮基准解（卡点制造唯一依据）
    var baselineSolution = baselineSolutionFixed(boardSnapshot, parsed, screen.result, screen);
    // 检查点：最终输出前
    var tCons2 = Date.now();
    var cvOut = verifyConservation(baseline, scanBoardActual(board), 'output', 0);
    timing.conservationCheckMs += Date.now() - tCons2;
    fill.conservation.push(cvOut);
    if (!cvOut.ok) {
      return { ok: false, reason: 'conservation', stage: 'output', conservation: fill.conservation, timing: timing, boxCount: n };
    }

    return {
      ok: true, level: level, parsed: parsed, board: board, solveResult: screen.result,
      structural: sdc, screen: screen, baselineSolution: baselineSolution,
      conservationBaseline: baseline, conservation: fill.conservation,
      blackStat: struct.blackStat, pipeStat: struct.pipeStat, bindStat: fill.bindStat,
      obstacleSlots: { ice: struct.iceSlots, question: struct.questionSlots, chain: struct.chainGroups },
      // 卡点类型计划与实际落地统计（只进生产侧记录，不入关卡本体）
      chokePlan: chokePlan, chokeStat: struct.chokeStat || null,
      chokeMarks: struct.chokeMarks || null,                       // v120 卡点位置清单
      timing: timing, boxCount: n
    };
  }

  function newFlowStats() {
    return {
      attempts: 0, success: 0,
      fail: { baseline: 0, struct: 0, structSurplus: 0, structHoles: 0, structReach: 0, structPipeExit: 0, pipeCapacity: 0, pipeDepth: 0, rowTrim: 0, bind: 0, conservation: 0, structuralCheck: 0, access: 0, screen: 0 },
      passHits: { base: 0, noise1: 0, noise2: 0, noise3: 0 },
      timings: [], failedCandidates: [], conservationFailures: [], bindFailures: []
    };
  }
  function mergeFlowStats(dst, src) {
    if (!src) return dst;
    dst.attempts += src.attempts; dst.success += src.success;
    for (var k in src.fail) dst.fail[k] = (dst.fail[k] || 0) + src.fail[k];
    for (var p in src.passHits) dst.passHits[p] += src.passHits[p];
    dst.timings = dst.timings.concat(src.timings);
    dst.failedCandidates = dst.failedCandidates.concat(src.failedCandidates);
    dst.conservationFailures = dst.conservationFailures.concat(src.conservationFailures);
    dst.bindFailures = dst.bindFailures.concat(src.bindFailures);
    return dst;
  }
  function recordAttempt(stats, res) {
    stats.attempts++;
    stats.timings.push(res.timing);
    if (res.ok) {
      stats.success++;
      var pk = res.screen.passKey;
      if (stats.passHits[pk] != null) stats.passHits[pk]++;
      return;
    }
    var key = res.reason || 'struct';
    stats.fail[key] = (stats.fail[key] || 0) + 1;
    if (key === 'conservation') stats.conservationFailures.push({ stage: res.stage, reasons: (res.conservation || []).filter(function (x) { return !x.ok; }) });
    if (key === 'bind') stats.bindFailures.push(res.bindStat);
    if (res.failedCandidate) stats.failedCandidates.push(res.failedCandidate);
  }

  /**
   * 纠偏版单候选入口（对应旧 generateFromBlocks）：4 遍全败即【淘汰整个候选】重建，
   * 不在同一失败结构上无限换填球路线，也不在 4 遍失败后直接进入卡点制造。
   */
  function generateFromBlocksFixed(blocks, config, opts) {
    config = Object.assign({}, DEFAULT_CONFIG, config || {});
    opts = opts || {};
    GENPERF.generateCalls++;
    var deadlineAt = config._deadlineAt || 0;
    var maxRetries = Math.max(1, config.maxRetries || 5);
    var stats = newFlowStats();
    var last = null;
    // 【聚集类卡点的可解性回退】ANT-GEN-CHOKE-TYPES-20260824。
    //   聚集会显著提高结构失败率——实测 chainCluster（允许锁链组间 8-邻接）单开时产出率从 3/3 掉到 1/3，
    //   且 0.5s 内就失败，说明挂在结构阶段（组间贴死导致 plannedChainActivatable / structuralDeadlockCheck 不过）。
    //   因此：首次尝试用完整计划；一旦失败，后续重试【按风险从高到低逐个摘掉】聚集类型，
    //   最终退回无聚集的原行为，保证不会因为开了聚集就产不出关。
    //   摘掉的类型如实记进 chokeFallback，不静默吞掉。
    var RISK_ORDER = ['chainCluster', 'pipeChain', 'iceCluster', 'questionCluster', 'chainIce'];
    var basePlan = config._chokePlan || pickChokeTypes(config, !!config.isBossSlot);
    var chokeFallback = { dropped: [], attempts: [] };
    for (var attempt = 0; attempt < maxRetries; attempt++) {
      if (attempt > 0 && deadlineAt && Date.now() >= deadlineAt) break;
      // 第 attempt 次尝试：摘掉风险序列里前 attempt 个仍在计划中的聚集类型
      var attemptPlan = basePlan;
      if (attempt > 0 && basePlan && basePlan.types && basePlan.types.length) {
        var dropSet = {}, dropped = 0;
        for (var ri = 0; ri < RISK_ORDER.length && dropped < attempt; ri++) {
          if (basePlan.has[RISK_ORDER[ri]]) { dropSet[RISK_ORDER[ri]] = 1; dropped++; }
        }
        if (dropped > 0) {
          var keptK = [], keptCN = [], keptHas = {};
          for (var ti = 0; ti < basePlan.types.length; ti++) {
            if (dropSet[basePlan.types[ti]]) continue;
            keptK.push(basePlan.types[ti]); keptCN.push(basePlan.cn[ti]); keptHas[basePlan.types[ti]] = true;
          }
          // v115：重建 plan 时必须把可观测字段一并带下来（rolls/prob/hits/expected/legacyMode）。
          // 漏带会让「摘过聚集类型」的关卡拿不到 expected —— 与 v105 当时 makeChokeVariantFixed
          // 丢 pipeStat 是同一类问题：重建对象时只复制了决策字段、漏了观测字段。
          // count 用摘除后的实际数量；expected 保持【本关设定的期望】不变（它描述配置，不描述结果），
          // 这样「设定期望 vs 实抽数量」的对照才有意义。
          attemptPlan = {
            types: keptK, cn: keptCN, has: keptHas, count: keptK.length,
            isBoss: basePlan.isBoss, pool: basePlan.pool,
            rolls: basePlan.rolls, prob: basePlan.prob, hits: basePlan.hits,
            expected: basePlan.expected, legacyMode: basePlan.legacyMode
          };
          chokeFallback.dropped = Object.keys(dropSet);
        }
      }
      chokeFallback.attempts.push({ attempt: attempt + 1, types: attemptPlan.types.slice() });
      config = Object.assign({}, config, { _chokePlan: attemptPlan });
      GENPERF.boardBuilds++;
      var tb = Date.now();
      var res = buildOneCandidateAttempt(blocks, config, {
        inputId: opts.inputId || null,
        candidateId: (opts.candidateId || 'cand') + '-a' + (attempt + 1),
        onScreenFail: opts.onScreenFail
      });
      GENPERF.boardMs += Date.now() - tb;
      recordAttempt(stats, res);
      last = res;
      if (!res.ok) {
        // 【v241】结构重试：pipeCapacity 的真实含义是"车比格多"。
        //   实测（40×40 / 6×7·7×7·6×8，seed 402/403/405/406/407）：切出 43~51 盒，
        //   溢出 3~5 盒，而管道容量只有 2（1 条 × 深度 2）→ 直接判死。
        //   处理：下一轮把容量放大 12%（车数随之少约 12%），只放大一次；
        //   正常出关的候选不会走到这里，路径零影响。
        if (res.reason === 'pipeCapacity' && !config._structScale) {
          var _sMin0 = parseInt(config.boxSizeMin, 10) || 30;
          var _sMax0 = parseInt(config.boxSizeMax, 10) || 40;
          config = Object.assign({}, config, {
            boxSizeMin: Math.round(_sMin0 * 1.12),
            boxSizeMax: Math.round(_sMax0 * 1.12),
            _structScale: 1.12
          });
        }
        continue;
      }
      var ge = evaluateGeneration(res.solveResult, res.parsed, config);
      var diff = computeDifficulty(res.solveResult, res.parsed, config, ge);
      return {
        level: res.level, valid: true, solveResult: res.solveResult, difficulty: diff,
        generationEval: ge, config: config, retries: attempt, structural: res.structural,
        structScale: config._structScale || null,   // 【v241】1.12 = 走的是"容量放大 12% 重试"这条路径
        flow: 'new_fixed', flowStats: stats, candidateTiming: res.timing,
        baselineSolution: res.baselineSolution, conservation: res.conservation,
        blackStat: res.blackStat, pipeStat: res.pipeStat, bindStat: res.bindStat,
        obstacleSlots: res.obstacleSlots,
        // 卡点类型计划与落地统计（只进生产侧记录，不入关卡本体）
        chokePlan: res.chokePlan || null, chokeStat: res.chokeStat || null,
        chokeMarks: res.chokeMarks || null,                        // v120 卡点位置清单
        // 回退记录：哪些聚集类型因结构失败被摘掉（如实记录，便于统计"想开但开不起来"的类型）
        chokeFallback: chokeFallback.dropped.length ? chokeFallback : null
      };
    }
    return {
      level: null, valid: false, solveResult: last ? (last.screen ? last.screen.result : null) : null,
      difficulty: null, config: config, retries: maxRetries,
      structural: { ok: false, reason: last ? ('候选淘汰：' + last.reason + (last.detail ? '(' + last.detail + ')' : '')) : '无有效候选' },
      flow: 'new_fixed', flowStats: stats, candidateTiming: last ? last.timing : null,
      lastFailReason: last ? last.reason : null
    };
  }

  /**
   * 纠偏版卡点变体：只在首轮基准解成功后进入；round≥2 的重生成分支走纠偏版(不回退旧实现)。
   * 卡点完成后以【卡点前棋盘实况】为独立基线再做一次守恒比对——卡点手段只换色/量与容量，
   * 总盒数与分色总量必须不变，若变化必为缺陷。
   */
  /** 【v151】取（或按需算）某个候选的"选择余地"曲线，供增减压与报告用。 */
  function ensureCurve(c) {
    if (!c || !c.level || !c.solveResult) return null;
    if (c._choiceCurve === undefined) {
      try { c._choiceCurve = choiceCurve(AntSolver.parseLevel(c.level), c.solveResult); }
      catch (e) { c._choiceCurve = null; }
    }
    return c._choiceCurve;
  }
  function makeChokeVariantFixed(parent, blocks, config, round, flowStats) {
    if (round >= 2 && parent.audit && rnd() < 0.3) {
      var pa = applyPressureAdjust(config, parent.audit, parent.level.bufferLimit, ensureCurve(parent));
      GENPERF.regenVariants++;
      // 【v116 修正】这一支不是"改盒"，是**从头重建棋盘**的新候选，因此必须和 produceFixed 的候选循环
      // 一样先按区间采样一次。原先直接把 pa.cfg 交下去，后果有两条：
      //   ① 区间在这条路径上被完全忽略 —— buildStructureCandidateFixed 读的是单值 icePercent 等，
      //      用户设的上下限对这些关不生效（q1 要求「生产器在候选的时候随机组合参数」在此不成立）；
      //   ② 返回值没有 sampledConfig，落库时该关的采样值是 null（实测确有关卡命中此路径）。
      // 区间未启用时 sampleRangedConfig 逐字段退回单值，故默认行为与 v115 及以前完全一致。
      var regenCfg = sampleRangedConfig(Object.assign({}, pa.cfg, { maxRetries: 2, candidateCount: 1 }));
      var regen = generateFromBlocksFixed(blocks, regenCfg);
      if (flowStats && regen.flowStats) mergeFlowStats(flowStats, regen.flowStats);
      if (!regen.valid) return null;
      var regenTagged = tagAudit(regen);
      regenTagged.sampledConfig = regenCfg._sampled || null;
      // 标出来源：这关的棋盘是压力调整后重建的，不是父候选改盒得来的。
      // 不标的话它在结果里看着像"基础候选"（无 chokeRound），排查时会误判走了哪条路径。
      regenTagged.regenerated = true;
      return regenTagged;
    }
    var pb = parent.level.board;
    var preChoke = scanBoardActual(pb);   // 卡点前实况 = 本次比对的独立基线
    var level = { blocks: parent.level.blocks, bufferLimit: parent.level.bufferLimit, board: { rows: pb.rows, cols: pb.cols, cells: AntSolver.deepClone(pb.cells) } };
    // 诊断数据透传（沿用 obstacleSlots 的既有口径，用户 2026-08-03 已批准该模式）：
    //   卡点制造只改盒的 color/count，管道坐标、条数、深度上限一律不动，
    //   故父候选的 pipeStat/narrowStat/spaceQuota 对卡点后棋盘依然成立。
    //   不带下来的后果：约 36%~50% 的关最终 board 来自卡点变体，这些关的「管道落了几条、
    //   是否走了兜底」会全部丢失（§12.8 记录的 narrowStat 不可观测就是同一成因）。
    //   本轮新增的管道兜底是行为变更，必须可追溯，因此一并透传。只作观测，不参与任何生成决策。
    level.board.pipeStat = pb.pipeStat || null;
    level.board.narrowStat = pb.narrowStat || null;
    level.board.spaceQuota = pb.spaceQuota || null;
    var startFrac = (config.swapRegionMin != null ? config.swapRegionMin : 50) / 100;
    var basePick = (parent.baselineSolution && parent.baselineSolution.pickOrder) || (parent.solveResult && parent.solveResult.pickOrder) || [];
    if (!basePick.length) return null;                       // 无基准解不允许随机换球
    var targets = lateRouteBoxes(level.board, basePick, startFrac);
    if (!targets.length) return null;
    if (!applyOneChoke(level.board, targets, config, basePick, level.blocks)) return null;
    if (round >= 2) applyOneChoke(level.board, targets, config, basePick, level.blocks);
    // 检查点5：卡点制造完成（基线=卡点前实况，被检查对象=卡点后实况，来源独立）
    var postChoke = scanBoardActual(level.board);
    var chokeReasons = [];
    if (postChoke.boardBoxCount !== preChoke.boardBoxCount) chokeReasons.push('棋盘盒数 ' + preChoke.boardBoxCount + '→' + postChoke.boardBoxCount);
    if (postChoke.pipeBoxCount !== preChoke.pipeBoxCount) chokeReasons.push('管道盒数 ' + preChoke.pipeBoxCount + '→' + postChoke.pipeBoxCount);
    for (var col in preChoke.colorCountSum) {
      if ((postChoke.colorCountSum[col] || 0) !== preChoke.colorCountSum[col])
        chokeReasons.push('色' + col + 'count总和 ' + preChoke.colorCountSum[col] + '→' + (postChoke.colorCountSum[col] || 0));
    }
    for (var col2 in postChoke.colorCountSum) {
      if (preChoke.colorCountSum[col2] == null) chokeReasons.push('卡点后出现新颜色' + col2);
    }
    if (chokeReasons.length) {
      if (flowStats) { flowStats.fail.conservation++; flowStats.conservationFailures.push({ stage: 'choke', reasons: [{ ok: false, stage: 'choke', reasons: chokeReasons }] }); }
      return null;
    }
    if (!structuralDeadlockCheck(level.board).ok) return null;
    var parsed = AntSolver.parseLevel(level);
    // 卡点分支重求解必须与候选筛选/最终审核同一入口模式与消除口径，
    // 否则卡点是按一种规则制造的、审核却按另一种判。
    // 【v172】切球层加压：中段成片变成"一口吃不满"（唯一的"能持续抬高占用"的手段，见函数头说明）
    // ⚠ 2026-10-16 首轮实测：**没生效**（两臂都是"成片改 0 辆"、峰窗 3.0 → 3.0）——
    //   触发条件/诊断字段至少在变体路径上没有落地，需要先定位"为什么 0 辆"。定位清楚前默认关。
    //   config.capSqueeze === true 可开（实验）。
    if (config.capSqueeze === true && config.chokeV2 !== false) {
      try {
        var sq = midgameCapacitySqueeze(level, parent, config, blocks);
        if (sq) level.board.capSqueezeStat = sq;
      } catch (e) { level.board.capSqueezeStat = { error: String(e && e.message || e) }; }
    }

    // 【v170】"冰当墙用"：压力不足就定向挂冰（数量不预设——由外层反复加压直到达标决定）
    // ⚠ 2026-10-16 首轮实测（v170_icewall_check.js，各 4 关）：**只锁住 1~2 辆"能填满"的车无法提高峰窗**
    //   （中后期峰窗 2.17 → 2.17，冰 9.67 → 11.0 块）。原因与 v162 同源：**只要还有别的免费选项，
    //   玩家/求解器就绕开被锁的那辆**。正确做法：该步"能填满"的车要**全部锁住**，并**至少留一辆
    //   '能点但填不满'的车**（否则变成死局）→ 逼玩家先垫 → 才出压力。在改成这个之前默认关。
    //   config.iceAsWall === true 可开（实验）。
    if (config.iceAsWall === true && config.chokeV2 !== false) {
      try {
        var pb2 = pressureBoostIce(level, parent, config, blocks);
        if (pb2) level.board.iceAsWallStat = pb2;
      } catch (e) { level.board.iceAsWallStat = { error: String(e && e.message || e) }; }
    }

    // 【v163】定向抉择投放：在"这一步有 ≥2 个能填满的选项"处，把多余的改成半满陷阱（只留 1 个对的）。
    //   放在最终 solve 之前 → 改完立刻重新求解 + 重新审核；达不到效果的变体在 candBetter 里自然选不上。
    // ⚠ 2026-10-16 复查：开启本招后，`v157` 那条"生产时挂上的 v2 指标 == 事后在最终关卡上重算"的断言
    //   会失败（实测一组：挂上 r9=5,5 vs 重算 4,3）。单独探针（v163_invariant_probe.js）显示不变式
    //   本身没被系统性破坏（开关两种状态都自洽）→ 应为**特定关卡上的口径敏感性**（本招改变了选中的候选，
    //   撞上本来就存在的分叉）。在查清之前**默认关闭**，避免把"指标不可信"带进生产。
    //   config.choiceTrapDirected === true 可开（实验用）。
    if (config.choiceTrapDirected === true && config.chokeV2 !== false) {
      try {
        var ctd = choiceTrapDirected(level, parent, config, blocks);
        if (ctd) level.board.choiceTrapStat = ctd;
      } catch (e) { level.board.choiceTrapStat = { applied: 0, error: String(e && e.message || e) }; }
    }

    var r = AntSolver.Solver.solve(parsed, { capturePreviewStats: true, bottomOnly: !!config.bottomOnly, instantChain: !!config.instantChain });
    if (!r.completed) return null;
    var ge = evaluateGeneration(r, parsed, config);
    return {
      level: level, valid: true, solveResult: r, generationEval: ge, audit: ge.omni.audit,
      difficulty: computeDifficulty(r, parsed, config, ge), config: config,
      flow: 'new_fixed', chokeRound: round,
      baselineSolution: parent.baselineSolution,
      conservation: [{ ok: true, stage: 'choke', reasons: [] }],
      // 【2026-08-03 只透传诊断数据，不参与生成】把父候选的障碍预定位置（含数字冰的 base/narrowGap 来源标记）
      // 原样带下来。依据：卡点制造只 clone 父棋盘后交换/搬移盒的 color 与 count（chokeSwap/chokeInflate
      // 只写 .color/.count，对 .numice/.q/.chain 仅作过滤条件读取、从不写入），障碍位置与属性完全不变，
      // 因此父候选的这份预定位置对卡点后的棋盘依然成立。
      // 不带出来的后果：下游（关卡图修改工具的障碍参数核对）无法区分「按比例设定的数字冰」与
      // 「窄路缺口自带的数字冰」，数字冰一项只能标为不做判定。
      // 授权：Codex 复审 2026.08.03 §P2 建议 + 用户 2026-08-03 明确批准（只保留上游已有信息，
      // 不重算数字冰、不改数字冰位置、不改卡点制造、不改求解器）。
      obstacleSlots: parent.obstacleSlots || null,
      blackStat: parent.blackStat || null, pipeStat: parent.pipeStat || null, bindStat: parent.bindStat || null,
      // 【2026-08-24 同理透传卡点类型计划】卡点变体只 clone 父棋盘后改盒的 color/count，
      // 不动 numice/chain/q 的位置与属性，故父候选的结构类卡点（冰簇/链簇/问号簇/冰叠链/管道口叠链）依然成立。
      // 不带出来的后果：约 36%~50% 的最终 board 来自变体（与 narrowStat 丢失是同一原因），
      // 那些关就统计不到用了哪些卡点类型，多样性无法度量——这正是本轮要解决的问题，不能自己再制造一个盲区。
      chokePlan: parent.chokePlan || null, chokeStat: parent.chokeStat || null,
      // v120：卡点变体只改盒的 color/count，障碍位置不动，故父候选的卡点位置清单依然成立
      chokeMarks: parent.chokeMarks || null,
      // 【v115 同理透传本候选的区间采样值】卡点变体不重建棋盘结构（只 clone 后改盒的 color/count），
      // 用的还是父候选那一组采样参数。不带出来的后果：最终 board 有 36%~50% 来自变体，
      // 那些关的逐关记录就查不到「这关到底用了区间里的哪组值」，参数波动无从追溯。
      sampledConfig: parent.sampledConfig || null
    };
  }

  /**
   * 纠偏版生产总入口（对应旧 produce）。K 候选 × B 分支 × N 轮，合格即停，超时兜底。
   * 与旧版差异仅在候选生成与筛选路径；合格门、审核、难度、兜底口径完全复用同一套函数。
   */
  // ==================== 【v153】单关进度钩子（供界面显示"这一关跑到哪了"）====================
  //   为什么用【模块级钩子】而不是 config 字段：config 要经 postMessage 结构化克隆，函数传不过去。
  //   worker 与主线程各自注册一次；produceFixed 里在每个候选/变体结束后上报（节流 400ms）。
  var PROGRESS_HOOK = null, PROGRESS_T0 = 0, PROGRESS_LAST = 0;
  function setProgressHook(fn) { PROGRESS_HOOK = (typeof fn === 'function') ? fn : null; }
  function reportProgress(o) {
    if (!PROGRESS_HOOK) return;
    var now = Date.now();
    if (now - PROGRESS_LAST < 400) return;
    PROGRESS_LAST = now;
    try { PROGRESS_HOOK(Object.assign({ elapsedMs: PROGRESS_T0 ? (now - PROGRESS_T0) : 0 }, o)); } catch (e) {}
  }

  function produceFixed(blocks, config, opts) {
    seedRng(config && config.seed);
    config = Object.assign({}, DEFAULT_CONFIG, config || {});
    // 【v239】需求日程按图算一次（与候选无关），供 fillStructureFixed 按需求序铺盘。
    if (!config._demandCurve) { try { config._demandCurve = demandCurveOf(blocks); } catch (e) { config._demandCurve = null; } }
    opts = opts || {};
    var K = Math.max(1, config.candidateCount || 1);
    var B = Math.max(1, config.chokeBranches || 3);
    var N = Math.max(0, config.rounds != null ? config.rounds : 2);
    var budget = config.timeBudgetMs != null ? config.timeBudgetMs : 300000;
    var requireHard = !!config.requireHardPass;
    setCurveScore(!!config.curveScore);   // 【v151】曲线评分开关（默认关；见 CURVE_SCORE_ON 注释）
    // 【v157】卡点判据 v2（R1~R9）：达标才算"可以早停"。因为实测 v2 通过率很低（好关标尺下现批次 0~13%），
    //   若一直搜到 v2 达标会把每关时间预算烧满 → 这里给"多搜几个候选"设上限（默认 1 个），
    //   到点就用已评估候选里 v2 最好的那个收尾（candBetter 里的 v2 键负责挑）。config.chokeV2 === false 可整段关掉。
    var v2On = !(config.chokeV2 === false);
    var v2Patience = (config.chokeV2Patience != null) ? config.chokeV2Patience : 1;
    var v2Extra = 0, v2Stop = false;
    var t0 = Date.now(), timedOut = false;
    PROGRESS_T0 = t0; PROGRESS_LAST = 0;      // 【v153】进度计时基准（每个 produce 重置）
    // 【仅底部入口】生产前门：源图在底部规则下若有永久不可达像素，直接判"结构不适配"，
    //   不进入候选生成，也不消耗时间预算——避免把源图问题误报成生成器超时(原需求 §四)。
    // 瞬时连锁模式固定四方向，不存在「只与顶/左/右背景连通的空腔永远打不通」这个底部专有风险，
    // 因此不跑底部专用前门；同时强制关掉 bottomOnly，避免两个开关同时为真导致口径混乱。
    if (config.instantChain && config.bottomOnly) config = Object.assign({}, config, { bottomOnly: false });
    if (config.bottomOnly && !config.instantChain) {
      var feas = checkBottomEntryFeasibility(blocks);
      if (!feas.ok) {
        return {
          level: null, valid: false, flow: 'new_fixed',
          entryMode: 'bottomOnly',
          bottomEntryFeasibility: feas,
          timedOut: false, elapsedMs: Date.now() - t0, candidates: 0, treeEvaluated: 0,
          structural: { ok: false, reason: 'bottomEntryInfeasible：' + feas.detail },
          lastFailReason: 'bottomEntryInfeasible'
        };
      }
    }
    // 【碎色前置闸门】任务 ANT-GEN-FRAGMENT-GATE-20260824，用户 2026-08-24 批准。
    //   与上面的底部入口前门同一位置、同一模式：在生成候选【之前】判定源图是否适合生产，
    //   被卡的图直接返回、【不消耗时间预算】、不产出任何关卡结构（绝不造假关）。
    //   fragmentMaxRate<=0 时整段跳过，行为与本参数引入前完全一致。
    var fragGate = checkFragmentGate(blocks, config);
    // 【v153】碎色闸门**默认降级为提醒**（用户 2026-10-16：「怎么还有这个，我该怎么处理」）。
    //   依据：碎色是"背债车"的压力素材，不是缺陷 —— 我们实测过小鹿图碎色 26%（超过旧上限 22%）而你认可它是好关；
    //   旧行为会把这整张图跳过（合格 0 / 不合格 0 / 跳过 1），用户拿到的是"什么都没产出"。
    //   现在：超上限只记一条警告 + 照常生产；要恢复硬拦请显式设 config.fragmentGateHard = true。
    if (!fragGate.ok && config.fragmentGateHard === true) {
      return {
        level: null, valid: false, flow: 'new_fixed',
        entryMode: (config.instantChain ? 'fourSideInstantChain' : (config.bottomOnly ? 'bottomOnly' : 'fourSide')),
        fragmentGate: fragGate,
        timedOut: false, elapsedMs: Date.now() - t0, candidates: 0, treeEvaluated: 0,
        structural: { ok: false, reason: 'fragmentGateBlocked：' + fragGate.detail },
        lastFailReason: 'fragmentGateBlocked'
      };
    }
    // 【v145/v149】开工前把互相打架的参数调相容：管道下限撑不起车数就降下来（两种模式都做），
    //   棋盘范围默认由车数反推（仅自适应模式）。
    config = applyAutoBoardRange(blocks, config);
    // 【v137】棋盘范围 × 车数 预检（用户 2026-10-14 批准）。
    //   与上面两个前门同一位置、同一返回结构：命中「必然淘汰」时直接判结构不适配、不进候选、不烧时间预算，
    //   并把原因与建议写进 structural.reason（→ 逐关记录的「错误」字段，页面日志同一条）。
    //   boardFitGuard 三态：'block'(默认，确实必然淘汰就拦) / 'warn'(只在日志提醒，照常跑) / 'off'(不检查)。
    var boardFitGuard = config.boardFitGuard || 'block';
    var boardFit = (boardFitGuard === 'off') ? null : preflightBoardFit(blocks, config);
    if (boardFit && !boardFit.ok && boardFitGuard === 'block') {
      // 【v145】不再因为"你填的范围装不下"就整关淘汰 —— 改按自适应反推的范围兜底。
      //   用户原话：「这个很扯淡。为什么不能让他的这个棋盘的范围自适应我的车子的数量呢？」
      //   手填范围从此只是【偏好】：装得下就用手填的，装不下就自动换成能装下的，并在结果里如实标注。
      //   原来的硬淘汰只在【连反推的范围都不可行】时保留（正常不会发生）。
      // 【v206】硬范围：用户明确要求"盘只能在这几行几列里"，就不再自动改范围；
      //   装不下就如实报错（以前会用反推范围兜底，于是填 6~8 却出了 10 列）。
      if (config.boardHardRange) {
        return {
          level: null, valid: false, flow: 'new_fixed',
          entryMode: (config.instantChain ? 'fourSideInstantChain' : (config.bottomOnly ? 'bottomOnly' : 'fourSide')),
          boardFit: boardFit, timedOut: false, elapsedMs: Date.now() - t0, candidates: 0, treeEvaluated: 0,
          structural: { ok: false, reason: boardFit.detail + '（棋盘范围是硬限制：请调大行列，或关掉硬范围）' },
          lastFailReason: 'boardRangeMismatch'
        };
      }
      var badFit = boardFit;
      var altRange = suggestBoardRange(badFit.carsMed || badFit.cars, config);
      if (altRange) {
        var altCfg = withBoardRange(config, altRange);
        var altFit = preflightBoardFit(blocks, altCfg);
        if (!altFit || altFit.ok) {
          var fallback = {
            from: { rowsMin: config.boardRowsMin, rowsMax: config.boardRowsMax, colsMin: config.boardColsMin, colsMax: config.boardColsMax },
            to: { rowsMin: altRange.rowsMin, rowsMax: altRange.rowsMax, colsMin: altRange.colsMin, colsMax: altRange.colsMax },
            cars: badFit.cars, carsMed: badFit.carsMed, need: altRange.need
          };
          config = Object.assign({}, altCfg, { _boardAutoFallback: fallback });
          boardFit = altFit;
          boardFit.autoFallback = fallback;
        }
      }
      if (boardFit && !boardFit.ok) {
        return {
          level: null, valid: false, flow: 'new_fixed',
          entryMode: (config.instantChain ? 'fourSideInstantChain' : (config.bottomOnly ? 'bottomOnly' : 'fourSide')),
          boardFit: boardFit,
          timedOut: false, elapsedMs: Date.now() - t0, candidates: 0, treeEvaluated: 0,
          structural: { ok: false, reason: boardFit.detail },
          lastFailReason: 'boardRangeMismatch'
        };
      }
    }
    // 【卡点类型计划】每关抽一次，经 config._chokePlan 透传给候选层与卡点变体层。
    //   在这里抽而不在候选层抽的理由：候选层会被 maxRetries 重试、K 个候选各跑一遍，
    //   逐次重抽会让同一关累计用到远超配额的类型，违背用户要求①（每关按数量）与②（不重合）。
    var levelChokePlan = pickChokeTypes(config, !!config.isBossSlot);
    config = Object.assign({}, config, { _chokePlan: levelChokePlan });
    resetGenPerf();
    if (AntSolver.Solver && AntSolver.Solver.resetPerf) AntSolver.Solver.resetPerf();
    if (AntSolver.PlayerSim && AntSolver.PlayerSim.resetPerf) AntSolver.PlayerSim.resetPerf();
    var deadlineAt = budget > 0 ? t0 + budget : 0;
    if (deadlineAt) config = Object.assign({}, config, { _deadlineAt: deadlineAt });
    function timeUp() { if (budget > 0 && (Date.now() - t0) >= budget) { timedOut = true; return true; } return false; }
    var flowStats = newFlowStats();
    var best = null, evaluated = 0;
    function consider(c) { if (c) { evaluated++; if (candBetter(c, best, config)) best = c; } return c; }
    function done(c) {
      if (c) { c.timedOut = timedOut; c.elapsedMs = Date.now() - t0; }
      GENPERF.totalMs = Date.now() - t0;
      if (!GENPERF.stopReason) {
        GENPERF.stopReason = timedOut ? 'budget_timeout' : (c ? (candPass(c, requireHard, config) ? 'pass_early_stop' : 'exhausted') : 'no_candidate');
      }
      var out = finalizeProduce(c, K, evaluated);
      if (out && fragGate && fragGate.ok === false) out.fragmentWarn = fragGate.detail;   // 【v153】如实带出"碎色超上限但已放行"
      if (!out) {
        // 【v137】失败也要带出「为什么全灭」：候选淘汰计数 + 棋盘预检结论（原先只剩「候选全灭：」四个字）。
        var diag = diagnoseNoCandidate(flowStats, boardFit);
        return {
          level: null, valid: false, flow: 'new_fixed', flowStats: flowStats,
          timedOut: timedOut, elapsedMs: Date.now() - t0, candidates: K, treeEvaluated: evaluated,
          // 失败也要带出本关抽了哪些卡点类型——否则「开了类型后产不出关」时无从判断是哪种类型导致，
          // 会变成又一个观测盲区。
          chokePlan: levelChokePlan,
          lastFailReason: diag ? diag.reason : 'noCandidate',
          structural: diag ? { ok: false, reason: diag.detail, failCounts: flowStats.fail } : null,
          boardFit: boardFit || null,
          perf: getGenPerf()
        };
      }
      out.flow = 'new_fixed';
      if (!out.chokePlan) out.chokePlan = levelChokePlan;   // 变体分支未透传时兜底补上
      if (boardFit) out.boardFit = boardFit;                // 成功也带上预检（供页面提示 warn，不改结果）
      out.flowStats = flowStats;
      out.perf = getGenPerf();
      out.perf.solver = (AntSolver.Solver && AntSolver.Solver.getPerf) ? AntSolver.Solver.getPerf() : null;
      out.perf.playerSim = (AntSolver.PlayerSim && AntSolver.PlayerSim.getPerf) ? AntSolver.PlayerSim.getPerf() : null;
      out.perf.evaluatedPositions = evaluated;
      out.perf.config = { candidateCount: K, chokeBranches: B, rounds: N, timeBudgetMs: budget, requireHardPass: requireHard };
      return out;
    }
    for (var k = 0; k < K; k++) {
      if (timeUp()) break;
      if (v2Stop) break;                       // 【v157】v2 已多搜够数 → 收手
      GENPERF.baseCandidates++;
      // 【v115】每个候选独立采样一组区间参数 —— 用户裁决「不同的候选都可以随机选取参数限制范围内」，
      // 目的是解决「当前批次关卡都是同样的参数，输出的关卡结构会同质化」。
      // 未设区间时 sampleRangedConfig 逐字段退回单值，故默认行为与 v114 逐值一致。
      var kCfg = sampleRangedConfig(config);
      var base = tagAudit(generateFromBlocksFixed(blocks, kCfg, {
        inputId: opts.inputId || null, candidateId: 'K' + (k + 1), onScreenFail: opts.onScreenFail
      }));
      reportProgress({ phase: 'candidate', k: k + 1, K: K, round: 0, N: N, evaluated: evaluated,
                       tier: (base && base.valid) ? candTier(base) : null });
      if (base) base.sampledConfig = kCfg._sampled || null;   // 采样值随候选带出，供落库追溯
      mergeFlowStats(flowStats, base.flowStats);
      if (!base.valid) continue;
      consider(base);
      if (candPass(base, requireHard, config) && meetsEarlyStopQuality(base, config)) return done(base);
      // 【v157】旧门过了但 v2 没达标 → 不算"可以停"，再给它 v2Patience 个候选的机会
      if (v2On && candPassLegacy(base, requireHard) && ++v2Extra > v2Patience) v2Stop = true;
      if (v2Stop) break;
      var layer = [base];
      for (var round = 1; round <= N && layer.length; round++) {
        if (timeUp()) break;
        if (v2Stop) break;
        var next = [];
        for (var li = 0; li < layer.length; li++) {
          if (timeUp()) break;
          if (v2Stop) break;
          for (var b = 0; b < B; b++) {
            if (timeUp()) break;
            if (v2Stop) break;
            GENPERF.chokeVariants++;
            var child = makeChokeVariantFixed(layer[li], blocks, config, round, flowStats);
            if (!child) continue;
            consider(child);
            reportProgress({ phase: 'variant', k: k + 1, K: K, round: round, N: N, evaluated: evaluated, tier: candTier(child) });
            if (candPass(child, requireHard, config)) return done(child);
            if (v2On && candPassLegacy(child, requireHard) && ++v2Extra > v2Patience) v2Stop = true;
            next.push(child);
          }
        }
        layer = next;
      }
      if (timeUp()) break;
    }
    return done(best);
  }

  function auditFor(solveResult, parsed, bufferLimit, config) {
    if (!AntSolver.Analysis || !AntSolver.Analysis.chokepointAudit) return null;
    var opts = {};
    // 【v159】卡点判据 v2 开启时提前期门：允许前期中压（3~4）、仍禁爆压/触顶（触顶由 safeEdge 管）。
    //   配套 earlyPressure（开局半满车 + 开局锁链）与自动档"第一笔节拍提前到 15%"——
    //   否则新造出来的前期压力会被旧的前期门（≥3.2 即判不合格）当场判死。
    //   config.chokeV2 === false 时不传 earlyCap → 逐值回到旧行为（与 v158 一致）。
    if (!(config && config.chokeV2 === false)) opts.earlyCap = (bufferLimit || 5) - 0.8;
    // 【v295·用户裁决】卡点判定改「覆盖率」：20%~80% 里暂存≥3 的占比 ≥ coverMin(%) 才算有卡点。
    //   用户原话：「现在要求 20%-80% 的过程中有 70% 突破暂存≥3（也许 70 太多，加一个滑轮）」。
    //   coverMin = 0 时退回旧的尖峰判据（逐值不变），方便对照。
    if (config) {
      if (config.chokeCoverMin != null) opts.coverMin = +config.chokeCoverMin;
      if (config.chokeCoverLo != null) opts.coverLo = +config.chokeCoverLo;
      if (config.chokeCoverHi != null) opts.coverHi = +config.chokeCoverHi;
      if (config.chokeCoverBuf != null) opts.coverBuf = +config.chokeCoverBuf;
    }
    return AntSolver.Analysis.chokepointAudit((solveResult && solveResult.pressureSamples) || [], parsed.totalBoxes, bufferLimit, opts);
  }
  // 审核评分(越大越好)：中后期卡点封顶奖励 − 前期越界惩罚 + 合格大奖；用于爬山接受判定
  // 【v118 修正常量来源】原先这里**重复写死** `bufferLimit − 1.5 / − 2.5`，而不是读审核返回值。
  //   用户 2026-08-27 把卡点线改成 L−1.8 后，写死的 −1.5 会让打分器**比合格门更严**：
  //   奖励按 L−1.5 封顶、前期惩罚仍按 L−2.5 起算，于是新门槛下本该合格的候选会被系统性压下去，
  //   本轮的放宽在候选选择环节被抵消。改为读 a.high / a.mid（chokepointAudit 已返回），
  //   顺带消掉「同一阈值在两个文件各写一遍」这个漂移根源。**评分公式与系数一个没动。**
  //   a.midMax 自 v118 起恒为 0（中期段移除），故那一项自然退化为无操作。
  function auditScoreOf(a, bufferLimit) {
    if (!a) return -1e9;
    var high = (a.high != null) ? a.high : (bufferLimit - 1.8);
    var mid = (a.mid != null) ? a.mid : (bufferLimit - 2.5);
    var s = Math.min(a.lateMax, high);
    s -= Math.max(0, a.earlyMax - mid) * 3;
    s -= Math.max(0, (a.midMax || 0) - high) * 3;
    // 暂存峰值触达上限=死亡边界(真人必死)：重罚，引导爬山把压力顶高但【留 ≥1 空位余量】
    if ((a.peakBuf || 0) >= bufferLimit) s -= 50;
    if (a.pass) s += 100;
    return s;
  }

  function averageSampleBuffer(samples) {
    if (!samples || !samples.length) return 0;
    var sum = 0;
    for (var i = 0; i < samples.length; i++) sum += samples[i].buf || 0;
    return +(sum / samples.length).toFixed(2);
  }

  /**
   * 生成专用统一诊断：对【完整棋盘】运行严格全知版和严格玩家版，合并暂存、封锁与结构来源。
   * 完整棋盘已经包含尺寸、冰/链/问号、换球、管道、分散黑块和窄路墙，因此这些结构的真实影响
   * 统一反映在两侧 pressureSamples / lockRatio 中；不修改 Analysis.difficulty 的既有权重。
   */
  // ==================== 【v157】卡点判据 v2（用户 R1~R9，接进生成算法） ====================
  // 需求（用户 2026-10-16 口述定稿，见 01_交接文档/工作日志_20261012.md 第二十五节）：
  //   · 独木桥：场上**只有 1 个方块能点**（其余被数字冰锁/链锁/不可达挡住）→ 一关最多 1 处，**按步计**，末段豁免；
  //   · 预算判断点（R9）：可点 ≥2，但"取了立刻能消掉（不占暂存）"的选项恰 1 个、其余是"取了会占暂存位"的陷阱项
  //     —— 这是用户要刻意做的核心体验（"这种游戏本质上就是对预算的判断"）；
  //   · 无满解步数：一个都消不掉、必须硬垫的步数 → 要少；
  //   · 暂存 ≥4 的高压尽量留在 70% 之后（用户：「出现这种情况最好是 70% 以后」）。
  //   两条线（全知线 / 玩家线）都测，判据**取最差**（用户 2026-10-16 定：「取最差吧」）。
  //
  // 【本版接法 = 路径 A（用户 2026-10-16 批准「先写进生成算法里，我亲自体验几关」）】：
  //   ① 候选比较键（candBetter）里，同档先比 v2 达标与否、再比 v2 分 → **同等条件下优先选 v2 好的那个候选**；
  //   ② 早停条件升级为「旧合格门 **且** v2 达标」；为避免烧满时间预算，最多再多搜 v2Patience 个候选就收手。
  //   ⚠ **不作为硬门**：v2 不达标的关照样产出（否则按实测通过率 0~13% 会几乎产不出关），
  //     只是"在评估过的候选里挑 v2 最好的那个"。阈值（GATES）目前从单一好关反推，属暂定，等用户试玩反馈校准。
  var CHOKE_V2_TAIL_PCT = 0.90, CHOKE_V2_TAIL_BOXES = 3;
  // 【v159】新增第 5 条：前期限压覆盖率 ≥20%（用户 2026-10-16：实测最新几关 0~30% 段的
  //   "暂存 3~4"占比是 0%，前期完全没有预算压力）。含义见日志第二十五节 §12。
  // 【v169】新增"中后期压力"硬门（用户 2026-10-16：「把这种压力作为硬性规定。在生成的时候，
  //   只挑选那些中后期压力有超过 3、4 的关卡」）：
  //   midLatePeakMin = 中后期（30~80% 进度）**暂存峰窗**的下限（峰窗 = 5% 滑窗内的暂存均值最大值）。
  var CHOKE_V2_GATES = { bridgeMax: 1, r9Min: 12, noGoodMax: 3, hiBefore70PctMax: 10, early34MinPct: 20, midLatePeakMin: 3.5 };   // 【v169】"中后期压力硬门"（用户要 3~4 → 取 3.5；两条线取最差）

  /** 沿一条既定路线（pickOrder）逐步回放，量出这条线上的 v2 指标（与页面「关卡体检」同口径）。 */
  function chokeV2MeasureLine(parsed, order) {
    var S = AntSolver.Simulator;
    if (!S || !S.enter || !S.listMoves || !S.applyPick || !parsed || !order || !order.length) return null;
    var st;
    try { st = S.enter(parsed, { useSlotStart: true }); } catch (e) { return null; }
    var n = 0, bridges = 0, bridgeAt = [], run = 0, maxRun = 0, soft = 0, r9 = 0, r9At = [];
    var minPick = 99, buf34 = 0, buf4 = 0, hiBefore70 = 0, stepsBefore70 = 0, noGood = 0;
    var earlySteps = 0, early34 = 0;   // 【v159】0~30% 段：步数 与 其中暂存落在 3~4 的步数
    try {
      for (var i = 0; i < order.length; i++) {
        var p = order[i];
        if (!p || p.r == null) continue;
        var moves = S.listMoves(st);
        var pickable = moves.length, safe = 0, good = 0, traps = 0;
        for (var j = 0; j < moves.length; j++) {
          var m = moves[j];
          if (m.blocked) continue;
          safe++;
          if (m.canConsume) good++; else traps++;
        }
        var prog = st.totalBoxes ? (st.completedBoxes / st.totalBoxes) : 0;
        var leftBoxes = 0;
        for (var r = 0; r < st.boardRows; r++) for (var c = 0; c < st.boardCols; c++) {
          var cc = st.cells[r][c]; if (cc && cc.t === 'box') leftBoxes++;
        }
        var tail = (prog >= CHOKE_V2_TAIL_PCT) || (leftBoxes <= CHOKE_V2_TAIL_BOXES);
        var buf = st.buffer.length, pc = Math.round(prog * 100);
        n++;
        if (buf >= 3 && buf <= 4) buf34++;
        if (buf >= 4) buf4++;
        if (prog < 0.70) { stepsBefore70++; if (buf >= 4) hiBefore70++; }
        if (prog < 0.30) { earlySteps++; if (buf >= 3 && buf <= 4) early34++; }   // 【v159】前期限压
        if (pickable < minPick) minPick = pickable;
        if (pickable === 1) {
          if (!tail) { bridges++; bridgeAt.push(pc); }
          run++; if (run > maxRun) maxRun = run;
        } else run = 0;
        if (pickable >= 2 && safe === 1) soft++;
        if (pickable >= 2 && good === 1 && traps >= 1) { r9++; r9At.push(pc); }
        if (good === 0) noGood++;
        S.applyPick(st, p.r, p.c);   // 锁链组整组拿走时会返回 false，忽略
        if (st.gameOver) break;
      }
    } catch (e) { /* 回放中断：用已采到的部分，不伪造 */ }
    if (!n) return null;
    return {
      steps: n, bridges: bridges, bridgeAt: bridgeAt, maxRun: maxRun, soft: soft,
      r9: r9, r9At: r9At, minPick: minPick === 99 ? 0 : minPick,
      buf34Pct: Math.round(buf34 / n * 100), buf4Pct: Math.round(buf4 / n * 100),
      hiBefore70Pct: stepsBefore70 ? Math.round(hiBefore70 / stepsBefore70 * 100) : 0,
      noGood: noGood,
      earlySteps: earlySteps, early34: early34,
      early34Pct: earlySteps ? Math.round(early34 / earlySteps * 100) : 0
    };
  }

  // ==================== 【v176】第三条线「贪心玩家」（Greedy Line） ====================
  // 由来（工作日志第 26/27 节）：前两条线都**透视管道、且永远走最优**，所以"半满车 / 数字冰锁 / 趁钱
  //   吃不满 / 赌管道"这些手段在它们那儿量不出来——今天五种加压手段实测全部推不动中后期峰窗，
  //   根因就是"用量尺量错了对象"。贪心线是唯一会**垫槽**与**赌管道**的线，用它才能看见这些手段。
  //
  // 策略（= 真人式，与 /private/tmp/numice_gen/greedy_line_probe.js 逐条一致）：
  //   ① 能消就消，优先消"暂存区里已有同色"的那辆（= 救车）；
  //   ② 否则在能消的里面挑"该色场上露头最多"的（= 最能清场）；
  //   ③ 一个都消不掉 → **先垫**（优先垫暂存区同色的车，否则垫容量最小的 = 最容易凑满的那辆）；
  //   ④ 没得挑时**照拿管道口的车**（= 真人赌管道）。
  //
  // 产出三样东西：
  //   · pickOrder  → 交给 chokeV2MeasureLine 量选择层指标（独木桥 / 预算判断点 / 无满解步…）；
  //   · samples    → 交给 chokepointAudit 量中后期峰窗；
  //   · 真人特征计数：垫槽次数、赌管道口次数、赌管道时的暂存峰值/满槽步数 → 承载用户 R6 约束
  //     （「管道内的车不能算作正常车辆…必须赌管道时暂存最好 ≤3」）。
  //
  // ⚠ **已知口径陷阱：不要把它的峰窗直接并进"取最差"的压力指标里。**
  //   贪心线经常中途就死，压力样本只覆盖到死点 → 峰窗是被**低估**（不是高估）。
  //   实测（2026-10-16，四关）：小鹿 全知4.0 / 玩家4.0 / **贪心3.0**；实机第3关 4.0/4.0/**4.0**；
  //   批次61 3.5/3.5/**4.0**；批次62 3.5/3.0/**3.0**。
  //   若把它并进 min()：用户亲口认可的小鹿会被判"中后期峰窗仅 3.0"不合格（假阴性）。
  //   所以本函数默认只做 **R6 管道约束 + 报告/可视化**；要不要拿它改压力门，等用户拍板（日志第 30 节）。
  /**
   * 【v177】"玩一遍"的可复用模拟器（一次完整对局）。v176 的贪心线就是它的一个特例。
   *
   *   opts.policy：玩家的"性格"
   *     · 'steady' 稳健（= v176 贪心线）：能消就消，优先救暂存区里的车；实在消不掉才垫，垫最容易凑满的
   *     · 'bold'   冒险：能消的里面优先拿"管道口的车"（赌里面是好色）；只能垫时也优先赌管道
   *     · 'random' 乱点：在所有能点的里均匀随机（真人开场不看牌瞎点的情形）
   *   opts.rnd：0~1 随机源。**传 `rnd = () => 0` 时逐值等于 v176 的贪心线**（同分取第一个）——
   *     这条保证是 `v176` 那套实测数字（垫槽 3/5/8/9、赌管道 10/16/6/10、峰窗 3/4/4/3）仍然可复现。
   *
   * 为什么要"性格"：真人的差异不在规则，而在**几个选项看着都行时挑了哪一个**。
   *   "玩 N 遍"必须有这个随机源，否则跑 100 遍也只是同一局重复 100 次。
   */
  function simulatePlay(parsed, opts) {
    opts = opts || {};
    var S = AntSolver.Simulator;
    if (!S || !S.enter || !S.listMoves || !S.applyPick || !parsed) return null;
    var policy = opts.policy || 'steady';
    var rnd = opts.rnd || function () { return 0; };
    var st;
    try { st = S.enter(parsed, { useSlotStart: true }); } catch (e) { return null; }
    var order = [], samples = [], lastDone = st.completedBoxes || 0;
    var guard = 0, maxSteps = (opts && opts.maxSteps) || 1500;
    var pads = 0, pipeBets = 0, pipeBetBufMax = 0, pipeBetWhileFull = 0;
    var limit = parsed.bufferLimit || 5;
    function isPipeMouth(r, c) {
      var dr = [-1, 1, 0, 0], dc = [0, 0, -1, 1];
      for (var i = 0; i < 4; i++) {
        var nr = r + dr[i], nc = c + dc[i];
        if (nr < 0 || nr >= st.boardRows || nc < 0 || nc >= st.boardCols) continue;
        var cc = st.cells[nr] && st.cells[nr][nc];
        if (cc && cc.t === 'pipe') return true;
      }
      return false;
    }
    /** 从候选里挑：score 越大越优先；**同分随机**（rnd 恒 0 → 取候选顺序里的第一个）。 */
    function pickAmong(arr, score) {
      var ties = [], bestV = -Infinity, t;
      for (t = 0; t < arr.length; t++) {
        var v = score ? score(arr[t]) : 0;
        if (v > bestV + 1e-9) { bestV = v; ties = [arr[t]]; }
        else if (Math.abs(v - bestV) <= 1e-9) ties.push(arr[t]);
      }
      if (!ties.length) return null;
      var k = Math.floor(rnd() * ties.length);
      if (k >= ties.length) k = ties.length - 1;
      if (k < 0) k = 0;
      return ties[k];
    }
    try {
      while (!st.gameOver && guard++ < maxSteps) {
        var moves = S.listMoves(st), open = [], i;
        for (i = 0; i < moves.length; i++) if (!moves[i].blocked) open.push(moves[i]);
        if (!open.length) break;
        var bufColors = {};
        for (i = 0; i < st.buffer.length; i++) bufColors[st.buffer[i].color] = 1;
        var can = [], pad = [];
        for (i = 0; i < open.length; i++) (open[i].canConsume ? can : pad).push(open[i]);
        var cnt = {};
        for (i = 0; i < open.length; i++) { var cc2 = open[i].antBox.color; cnt[cc2] = (cnt[cc2] || 0) + 1; }
        var cntScore = function (m) { return cnt[m.antBox.color] || 0; };          // 该色场上露头越多越优先
        var smallFirst = function (m) { return -(m.antBox.count || 0); };           // 容量越小越容易凑满
        var isPm = function (m) { return isPipeMouth(m.r, m.c); };
        var rescue = [], pick = null;
        for (i = 0; i < can.length; i++) if (bufColors[can[i].antBox.color]) rescue.push(can[i]);
        if (policy === 'random') {
          pick = pickAmong(open, null);                                            // 乱点：随便挑一个
        } else if (policy === 'bold') {
          if (rescue.length) pick = pickAmong(rescue, null);                        // ① 救车
          if (!pick) {                                                             // ② 有能消的：先赌管道口
            var pmCan = can.filter(isPm);
            if (pmCan.length) pick = pickAmong(pmCan, cntScore);
          }
          if (!pick && can.length) pick = pickAmong(can, cntScore);                 // ③ 最能清场
          if (!pick) {                                                             // ④ 只能垫：先赌管道口
            var pmPad = pad.filter(isPm);
            var same = pad.filter(function (m) { return bufColors[m.antBox.color]; });
            pick = (pmPad.length ? pickAmong(pmPad, smallFirst) : null)
                || (same.length ? pickAmong(same, smallFirst) : null)
                || pickAmong(pad, smallFirst);
          }
        } else {                                                                   // 'steady' = v176 贪心线
          if (rescue.length) pick = pickAmong(rescue, null);                        // ① 救车
          if (!pick && can.length) pick = pickAmong(can, cntScore);                 // ② 最能清场
          if (!pick) {                                                             // ③ 先垫
            var same2 = pad.filter(function (m) { return bufColors[m.antBox.color]; });
            pick = (same2.length ? pickAmong(same2, smallFirst) : null) || pickAmong(pad, smallFirst);
          }
        }
        if (!pick) break;
        if (!pick.canConsume) pads++;                                             // 垫槽：拿的是"一口填不满"的车
        // ④ 赌管道：拿的是"管道口的车"（里面是什么看不见）= 真人行为。两种情形都记：
        //    垫出来的（一个都消不掉、只好赌）与顺手消的；并单独记"已经在满槽边缘（空位≤1）还得赌"的步数
        //    —— 后者就是用户 R6 要约束的情形（「必须赌管道时暂存最好 ≤3」）。
        var cell = st.cells[pick.r] && st.cells[pick.r][pick.c];
        if (cell && cell.t === 'box' && isPipeMouth(pick.r, pick.c)) {
          pipeBets++;
          if (st.buffer.length > pipeBetBufMax) pipeBetBufMax = st.buffer.length;
          if (st.buffer.length >= limit - 1) pipeBetWhileFull++;
        }
        order.push({ r: pick.r, c: pick.c });
        S.applyPick(st, pick.r, pick.c);
        if (st.completedBoxes !== lastDone) { lastDone = st.completedBoxes; samples.push({ done: lastDone, buf: st.buffer.length }); }
        if (st.gameWon) break;
      }
    } catch (e) { /* 回放中断：用已采到的部分，不伪造 */ }
    if (!order.length) return null;
    var total = parsed.totalBoxes || 0;
    // 【v177 修正】胜负**不能只看 `st.gameWon`**：求解器走的 `Simulator.applyPick` 不调 checkWinLose
    //   （只有手点入口 pickBox 会），所以"像素全消完"这一局 gameWon 仍是 false。
    //   实测小鹿：40/40 盒、1105/1105 像素、暂存 0，却 gameWon=false —— 上一版因此把"通关"误报成"收尾卡死"。
    //   正确口径 = 像素全消（与 PlayerSim 第 632 行同一判据）。
    var cleared = !!(st.eliminatedPixels != null && st.totalPixels != null && st.totalPixels > 0
                     && st.eliminatedPixels >= st.totalPixels);
    // 【v180】"卡死账"：没通关时，逐条暂存里的车算三笔账 ——
    //   needLeft  = 这辆车还差几个像素；boardLeft = 盘上这个颜色还剩几个；
    //   reachable = 其中**现在够得着**的几个（贴边或贴着已消格）。
    //   死因读法：boardLeft < needLeft → **车切得比图里剩的还胖**（切球/容量问题，不是玩家问题）；
    //             boardLeft ≥ needLeft 但 reachable = 0 → 颜色被包住（路线/结构问题）。
    var stuck = null;
    if (!cleared && st.buffer && st.buffer.length) {
      var leftByColor = {}, reachByColor = {};
      // ⚠ 这里必须用 `st.rows / st.cols`（**目标图**的尺寸，40×40），
      //   不是 `st.boardRows / st.boardCols`（**棋盘**尺寸，6×8）。v180 首版扫错了矩阵，
      //   只看了左上角 48 格 → 才会出现"盘上剩 0 但车还差 24"这种假异常（日志第 34.4 节）。
      for (var rr = 0; rr < st.rows; rr++) {
        for (var cc3 = 0; cc3 < st.cols; cc3++) {
          if (st.eliminated[rr][cc3]) continue;
          var col3 = st.blocks[rr][cc3];
          if (col3 <= 0) continue;
          leftByColor[col3] = (leftByColor[col3] || 0) + 1;
          if (rr === 0 || cc3 === 0 || rr === st.rows - 1 || cc3 === st.cols - 1 ||
              st.eliminated[rr - 1][cc3] || st.eliminated[rr + 1][cc3] || st.eliminated[rr][cc3 - 1] || st.eliminated[rr][cc3 + 1]) {
            reachByColor[col3] = (reachByColor[col3] || 0) + 1;
          }
        }
      }
      stuck = st.buffer.map(function (b) {
        var needLeft = (b.remaining != null) ? b.remaining : Math.max(0, (b.need || 0) - (b.progress || 0));
        return {
          color: b.color, needLeft: needLeft,
          boardLeft: leftByColor[b.color] || 0,
          reachable: reachByColor[b.color] || 0
        };
      }).sort(function (a, b2) { return b2.needLeft - a.needLeft; });
    }
    return {
      pickOrder: order, samples: samples, won: (!!st.gameWon || cleared), cleared: cleared,
      gameOver: !!st.gameOver,
      steps: order.length, completedBoxes: st.completedBoxes || 0,
      coveragePct: total ? Math.round((st.completedBoxes || 0) / total * 100) : 0,
      pads: pads, pipeBets: pipeBets, pipeBetBufMax: pipeBetBufMax, pipeBetWhileFull: pipeBetWhileFull,
      policy: policy, stuck: stuck
    };
  }

  /** 兼容 v176：贪心线 = "稳健玩家"跑一局、同分取第一个（确定性）。 */
  function chokeV2GreedyLine(parsed, opts) {
    var o = Object.assign({}, opts || {});
    o.policy = 'steady';
    o.rnd = function () { return 0; };
    return simulatePlay(parsed, o);
  }

  /**
   * 【v177】"同一关玩 N 遍"（用户 2026-10-17 / 前辈口述的"幽灵员工玩 100 遍"）。
   *
   * 产出**区间**而不是一个点：同一关换玩家性格 × 换随机种子跑 N 次，统计
   *   通关率 / 中后期峰窗（最小·最大·均值·中位）/ 暂存峰值 / 垫槽 / 赌管道 / 结束位置分布。
   * 读数方式：
   *   · 峰窗区间窄（如 3.5~4.0，均 3.7）→ 这关**稳定**，压力是设计出来的；
   *   · 峰窗区间宽（如 2.0~4.5）→ 这关**看运气**，说明压力来自"抽样"而不是结构；
   *   · 结束位置集中在「收尾」→ 预算判断型（玩家把好用的车用早了）；
   *     集中在「中段」→ 路线/包裹型（路被堵死）。
   * 默认 16 遍（单关 ~0.5~1.1s）；确定性：同 seed 同结果。
   */
  function chokeV2PlayBatch(parsed, opts) {
    opts = opts || {};
    var per = Math.max(1, Math.min(opts.perPolicy != null ? opts.perPolicy : (opts.n ? Math.ceil(opts.n / 3) : 6), 40));
    var policies = opts.policies || ['steady', 'bold', 'random'];
    var seed = (opts.seed != null ? opts.seed : 20261017) >>> 0;
    var s = seed || 1;
    function rnd() { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }
    var A = AntSolver.Analysis;
    var total = parsed.totalBoxes || 0, lim = parsed.bufferLimit || 5;
    var runs = [], pi, i;
    for (pi = 0; pi < policies.length; pi++) {
      for (i = 0; i < per; i++) {
        var g = null;
        try { g = simulatePlay(parsed, { policy: policies[pi], rnd: rnd }); } catch (e) { g = null; }
        if (!g) continue;
        var a = null;
        try { a = (A && A.chokepointAudit) ? A.chokepointAudit(g.samples || [], total, lim) : null; } catch (e) { a = null; }
        runs.push({
          policy: policies[pi], won: !!g.won, coveragePct: g.coveragePct, steps: g.steps,
          pads: g.pads, pipeBets: g.pipeBets, pipeBetWhileFull: g.pipeBetWhileFull,
          peakBuf: a ? a.peakBuf : 0,
          // 卡点区根本没有样本的局（早死 / 样本没落进窗口）→ 记 null，不当 0 混进 min/mean（否则"波动"里全是假的 0）。
          //   `lateAt` 是审核函数在窗口里真正扫到位置才会填的字段，比"覆盖≥30%"更准。
          lateMax: (a && a.lateAt != null) ? a.lateMax : null,
          stuck: g.won ? null : (g.stuck || null)          // 【v180】卡死账
        });
      }
    }
    if (!runs.length) return null;
    function stat(key, arr) {
      var src = arr || runs, v = [], k;
      for (k = 0; k < src.length; k++) if (src[k][key] != null) v.push(src[k][key]);
      if (!v.length) return { min: null, max: null, mean: null, p50: null };
      v.sort(function (a2, b2) { return a2 - b2; });
      var sum = 0;
      for (k = 0; k < v.length; k++) sum += v[k];
      return { min: v[0], max: v[v.length - 1], mean: +(sum / v.length).toFixed(2), p50: v[Math.floor(v.length / 2)] };
    }
    // 【v177.1】按玩家类型分开统计：**稳健玩家通关率**才是"这关能不能过"的主指标；
    //   各类型之间的差（spreadPct）说明"这关是不是吃策略"——差值大 = 稳健玩家被坑、乱走反而能过。
    var byPolicy = [];
    for (pi = 0; pi < policies.length; pi++) {
      var pr = runs.filter(function (r) { return r.policy === policies[pi]; });
      if (!pr.length) continue;
      var w = 0, covSum = 0, padSum = 0, k;
      for (k = 0; k < pr.length; k++) { if (pr[k].won) w++; covSum += pr[k].coveragePct; padSum += pr[k].pads; }
      byPolicy.push({
        policy: policies[pi], n: pr.length, won: w,
        wonRatePct: Math.round(w / pr.length * 100),
        coveragePct: Math.round(covSum / pr.length),
        padsMean: +(padSum / pr.length).toFixed(2),
        lateMax: stat('lateMax', pr)
      });
    }
    var finish = { win: 0, tail: 0, mid: 0, front: 0 };
    for (i = 0; i < runs.length; i++) {
      var r = runs[i];
      if (r.won) finish.win++;
      else if (r.coveragePct >= 95) finish.tail++;
      else if (r.coveragePct >= 30) finish.mid++;
      else finish.front++;
    }
    var rates = byPolicy.map(function (b) { return b.wonRatePct; });
    var steady = byPolicy.length ? byPolicy[0] : null;
    // 【v180】代表样本的"卡死账"：取第一条稳健玩家没通关的局（最能说明"稳健怎么会输"）
    var stuck = null;
    for (i = 0; i < runs.length; i++) {
      if (runs[i].policy === 'steady' && !runs[i].won && runs[i].stuck) { stuck = runs[i].stuck; break; }
    }
    return {
      n: runs.length, perPolicy: per, seed: seed, policies: policies, byPolicy: byPolicy,
      steadyWonPct: steady ? steady.wonRatePct : null,          // 主指标：稳健玩家通关率
      bestWonPct: rates.length ? Math.max.apply(null, rates) : null,
      worstWonPct: rates.length ? Math.min.apply(null, rates) : null,
      spreadPct: rates.length ? Math.max.apply(null, rates) - Math.min.apply(null, rates) : null,
      wonRatePct: Math.round(finish.win / runs.length * 100),
      lateMax: stat('lateMax'), peakBuf: stat('peakBuf'),
      pads: stat('pads'), pipeBets: stat('pipeBets'),
      finish: finish, stuck: stuck, runs: runs
    };
  }

  // ==================== 【v180】矿脉层表 + 债务 Δ（"拆图"的第一块） ====================
  /**
   * 矿脉 = 目标图里**4-连通、同色**的一片像素。它是"拆图/合球"的最小单位：
   *   切球 = 把若干矿脉分给同一辆车；摆车顺序 = 决定哪条矿脉先被啃。
   *
   * `veinLayers` 只算**静态结构**（与玩家无关）：
   *   level 0 = 现在就够得着的矿脉（贴边 or 贴着外部连通的空白）；
   *   level k = 必须先把 ≤k-1 层啃掉才能碰到的矿脉（洋葱第几层）。
   * 这就是用户要的那张"谁包着谁"的表——它只由图决定，换切法、换顺序都不会变。
   */
  function veinLayers(parsed, opts) {
    var rows = parsed.rows, cols = parsed.cols, blocks = parsed.blocks;
    if (!blocks || !rows || !cols) return null;
    var bottomOnly = !!(opts && opts.bottomOnly);
    var seed;
    try { seed = AntSolver.outsideReachSeed(blocks, rows, cols, bottomOnly); } catch (e) { return null; }
    var id = new Int32Array(rows * cols).fill(-1);
    var veins = [], r, c, d;
    var DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    // 1) 标矿脉（4-连通同色）
    for (r = 0; r < rows; r++) {
      for (c = 0; c < cols; c++) {
        var col = blocks[r][c];
        if (col <= 0 || id[r * cols + c] >= 0) continue;
        var vid = veins.length;
        var vein = { id: vid, color: col, pixels: 0, cells: [], level: -1, touches: false };
        var q = [[r, c]];
        id[r * cols + c] = vid;
        for (var h = 0; h < q.length; h++) {
          var cr = q[h][0], cc = q[h][1];
          vein.pixels++; vein.cells.push(cr * cols + cc);
          if (cr === 0 || cc === 0 || cr === rows - 1 || cc === cols - 1) vein.touches = true;
          if (!vein.touches && seed[cr - 1] && (seed[cr - 1][cc] || seed[cr + 1][cc] || seed[cr][cc - 1] || seed[cr][cc + 1])) vein.touches = true;
          for (d = 0; d < 4; d++) {
            var nr = cr + DIRS[d][0], nc = cc + DIRS[d][1];
            if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
            if (blocks[nr][nc] !== col || id[nr * cols + nc] >= 0) continue;
            id[nr * cols + nc] = vid; q.push([nr, nc]);
          }
        }
        veins.push(vein);
      }
    }
    // 2) 矿脉之间的相邻关系
    var adj = veins.map(function () { return {}; });
    for (r = 0; r < rows; r++) {
      for (c = 0; c < cols; c++) {
        var a = id[r * cols + c];
        if (a < 0) continue;
        for (d = 0; d < 4; d++) {
          var nr2 = r + DIRS[d][0], nc2 = c + DIRS[d][1];
          if (nr2 < 0 || nr2 >= rows || nc2 < 0 || nc2 >= cols) continue;
          var b = id[nr2 * cols + nc2];
          if (b >= 0 && b !== a) { adj[a][b] = 1; adj[b][a] = 1; }
        }
      }
    }
    // 3) 洋葱分层（BFS）
    var frontier = [];
    for (var i = 0; i < veins.length; i++) if (veins[i].touches) { veins[i].level = 0; frontier.push(i); }
    var lv = 0;
    while (frontier.length) {
      var next = [];
      for (i = 0; i < frontier.length; i++) {
        for (var k in adj[frontier[i]]) {
          var j = +k;
          if (veins[j].level >= 0) continue;
          veins[j].level = lv + 1; next.push(j);
        }
      }
      frontier = next; lv++;
    }
    var unreached = 0, byLevel = {}, pxByLevel = {};
    for (i = 0; i < veins.length; i++) {
      if (veins[i].level < 0) { veins[i].level = 99; unreached++; }
      byLevel[veins[i].level] = (byLevel[veins[i].level] || 0) + 1;
      pxByLevel[veins[i].level] = (pxByLevel[veins[i].level] || 0) + veins[i].pixels;
    }
    var maxLevel = 0;
    for (i = 0; i < veins.length; i++) if (veins[i].level < 99 && veins[i].level > maxLevel) maxLevel = veins[i].level;
    // 每个颜色的最浅层（该色的"入口"在第几层）
    var colorMinLevel = {};
    for (i = 0; i < veins.length; i++) {
      var cc2 = veins[i].color;
      if (colorMinLevel[cc2] == null || veins[i].level < colorMinLevel[cc2]) colorMinLevel[cc2] = veins[i].level;
    }
    return {
      veins: veins, count: veins.length, maxLevel: maxLevel, unreached: unreached,
      byLevel: byLevel, pxByLevel: pxByLevel, colorMinLevel: colorMinLevel, id: id, rows: rows, cols: cols
    };
  }

  /**
   * 沿一条既定路线回放，记下**每条矿脉第一次被碰到的第几手**（1 起）。
   * 判据与模拟器一致：该矿脉有任一像素"贴边 or 贴着已消除格"就算打开。
   */
  function veinFirstTouch(parsed, layerInfo, order) {
    var S = AntSolver.Simulator;
    var veins = layerInfo.veins;
    if (!S || !S.enter || !S.applyPick || !order || !order.length) return null;
    var st;
    try { st = S.enter(parsed, { useSlotStart: true }); } catch (e) { return null; }
    var open = new Array(veins.length).fill(0);     // 0 = 还没打开
    var cols = layerInfo.cols, rows = layerInfo.rows;
    function isOpen(cellIdx) {
      var r = (cellIdx / cols) | 0, c = cellIdx % cols;
      if (r === 0 || c === 0 || r === rows - 1 || c === cols - 1) return true;
      var e = st.eliminated;
      return !!(e[r - 1][c] || e[r + 1][c] || e[r][c - 1] || e[r][c + 1]);
    }
    function scan(step) {
      for (var i = 0; i < veins.length; i++) {
        if (open[i]) continue;
        for (var j = 0; j < veins[i].cells.length; j++) {
          if (isOpen(veins[i].cells[j])) { open[i] = step; break; }
        }
      }
    }
    scan(0);   // 开局就能碰到的
    for (var s = 0; s < order.length; s++) {
      try { S.applyPick(st, order[s].r, order[s].c); } catch (e) { break; }
      scan(s + 1);
      if (st.gameOver) break;
    }
    var out = {};
    for (var k = 0; k < veins.length; k++) out[veins[k].id] = open[k];
    return out;
  }

  /**
   * 【v180】债务 Δ：同一关、同一条矿脉，**最优路线第几手碰到** vs **这条路线第几手才碰到**。
   *   Δ = 实际 − 最优 ≥ 0。Δ 大的那几条矿脉，就是这条路线"欠下的债"——也是卡点的来源。
   * 单位统一为"手"（pick），所以可以横比；层数（L）另算，用来说明"谁包着谁"。
   */
  function veinDebt(parsed, opts) {
    opts = opts || {};
    var info = veinLayers(parsed, { bottomOnly: !!opts.bottomOnly });
    if (!info) return null;
    var omni = opts.omniOrder || null, run = opts.runOrder || null;
    var tOpt = omni ? veinFirstTouch(parsed, info, omni) : null;
    var tRun = run ? veinFirstTouch(parsed, info, run) : null;
    var list = [], i;
    for (i = 0; i < info.veins.length; i++) {
      var v = info.veins[i];
      var o = tOpt ? tOpt[v.id] : null, u = tRun ? tRun[v.id] : null;
      if (!o || !u) continue;                       // 有一边没碰到（没打开）→ 不进债务表
      var d = u - o;
      if (d <= 0) continue;
      list.push({ id: v.id, color: v.color, level: v.level, pixels: v.pixels, optStep: o, runStep: u, delta: d });
    }
    list.sort(function (a, b) { return (b.delta - a.delta) || (b.pixels - a.pixels); });
    var total = 0;
    for (i = 0; i < list.length; i++) total += list[i].delta;
    return {
      count: info.count, maxLevel: info.maxLevel, unreached: info.unreached,
      byLevel: info.byLevel, pxByLevel: info.pxByLevel, colorMinLevel: info.colorMinLevel,
      debt: list, topDebt: list.slice(0, 3), totalDebt: total,
      debtsCount: list.length
    };
  }

  /**
   * 【v179】**机制归因**（用户 2026-10-17 选 2：把"稳健被坑"的关拆到机制上）。
   *
   * 做法 = **消融实验**（ablation），不是拍脑袋分类：
   *   拿掉一种功能块（墙 / 管道 / 数字冰 / 锁链 / 问号）→ 重跑同一批稳健玩家 →
   *   看"通关率回升多少"。回升越多，这个东西越是这关的凶手。
   *
   * 为什么只做这五类：它们都是**棋盘格子上的可移除字段**，消融后关卡仍然合法、可观测量；
   *   而"切球 / 容量"属于关卡本体，拿掉就不是同一关了（留给矿脉债务 Δ 那一层去解释）。
   *   ⚠ 拿掉管道会把它队列里的车一起拿走（totalBoxes 变小）——报告里已标注，读的时候要记得。
   *
   * opts.per：每种变体跑几局（默认 6，与 `chokeV2PlayBatch` 同口径：只跑**稳健**玩家，
   *   因为"稳健被坑"才是我们要解释的现象）。
   */
  function chokeV2Attribute(parsed, opts) {
    opts = opts || {};
    var per = Math.max(1, Math.min(opts.per != null ? opts.per : 6, 20));
    var seed = (opts.seed != null ? opts.seed : 20261017) >>> 0;
    var A = AntSolver.Analysis;
    // ⚠ 管道**不能**这样消融：拿掉 pipe 格子会把队列里的车一起带走 → 关卡变得不可解
    //   （实测小鹿/第3关：拿掉管道后通关率 100% → 0%）。管道的"隐藏"对模拟器本来就不存在
    //   （求解器/玩家都能看见队列首位），所以它只作为**结构信息**统计，不进消融表。
    var KINDS = [
      { k: 'black', cn: '墙' }, { k: 'numice', cn: '数字冰' },
      { k: 'chain', cn: '锁链' }, { k: 'q', cn: '问号' },
      { k: 'all', cn: '全部（墙+冰+链+问号）' }
    ];
    var raw = { blocks: parsed.blocks, bufferLimit: parsed.bufferLimit, board: parsed.board };
    function runOn(lv, s0) {
      var s = s0 || seed || 1, won = 0, lateSum = 0, lateN = 0, covSum = 0, k;
      function rnd() { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }
      for (k = 0; k < per; k++) {
        var g = null;
        try { g = simulatePlay(lv, { policy: 'steady', rnd: rnd }); } catch (e) { g = null; }
        if (!g) continue;
        if (g.won) won++;
        covSum += g.coveragePct;
        var a = null;
        try { a = (A && A.chokepointAudit) ? A.chokepointAudit(g.samples || [], lv.totalBoxes || 0, lv.bufferLimit || 5) : null; } catch (e) { a = null; }
        if (a && a.lateAt != null) { lateSum += a.lateMax; lateN++; }
      }
      return {
        wonPct: Math.round(won / per * 100),
        lateMaxMean: lateN ? +(lateSum / lateN).toFixed(2) : null,
        coveragePct: Math.round(covSum / per)
      };
    }
    var base = runOn(parsed);
    var items = [];
    for (var i = 0; i < KINDS.length; i++) {
      var kind = KINDS[i].k, cn = KINDS[i].cn, removed = 0;
      var clone;
      try { clone = JSON.parse(JSON.stringify(raw)); } catch (e) { continue; }
      var cells = (clone.board && clone.board.cells) || [];
      for (var r = 0; r < cells.length; r++) {
        var row = cells[r] || [];
        for (var c = 0; c < row.length; c++) {
          var cell = row[c];
          if (!cell) continue;
          if (kind === 'all') {
            if (cell.t === 'black') { row[c] = { t: 'empty' }; removed++; }
            else if (cell.numice > 0) { cell.numice = 0; removed++; }
            else if (cell.chain > 0) { cell.chain = 0; removed++; }
            else if (cell.q) { cell.q = false; removed++; }
          }
          else if (kind === 'black' && cell.t === 'black') { row[c] = { t: 'empty' }; removed++; }
          else if (kind === 'pipe' && cell.t === 'pipe') { row[c] = { t: 'empty' }; removed++; }
          else if (kind === 'numice' && cell.numice > 0) { cell.numice = 0; removed++; }
          else if (kind === 'chain' && cell.chain > 0) { cell.chain = 0; removed++; }
          else if (kind === 'q' && cell.q) { cell.q = false; removed++; }
        }
      }
      if (!removed) continue;
      var lv2 = null;
      try { lv2 = AntSolver.parseLevel(clone); } catch (e) { lv2 = null; }
      if (!lv2 || !lv2.board || !lv2.board.cells.length) continue;
      var res = runOn(lv2);
      items.push({
        kind: kind, cn: cn, removed: removed,
        wonPct: res.wonPct, deltaWon: res.wonPct - base.wonPct,
        lateMaxMean: res.lateMaxMean,
        deltaPeak: (res.lateMaxMean != null && base.lateMaxMean != null) ? +(res.lateMaxMean - base.lateMaxMean).toFixed(2) : null,
        coveragePct: res.coveragePct
      });
    }
    items.sort(function (a, b) { return (b.deltaWon - a.deltaWon) || ((a.deltaPeak || 0) - (b.deltaPeak || 0)); });
    return {
      per: per, baseline: base, items: items,
      main: items.length ? items[0] : null,       // 主因 = 拿掉它通关率回升最多的那个
      totalMechanisms: items.reduce(function (n, x) { return n + x.removed; }, 0)
    };
  }

  /**
   * 【v182】**"被埋"计数** —— 61 号关那种死法的结构化度量。
   *
   * 定义：跑**一局**稳健玩家，终局没通关时，统计有几辆车是
   *   ① 还差 > 0（没完工），且 ② 盘上该色剩的量 ≥ 它要的量（量是够的），但 ③ 可达 = 0（够不着）。
   * 三条同时成立 = 这辆车被别的颜色**埋**住了。
   *
   * 实测（v181 卡死账）：小鹿 0、实机第3关 0、批次62 0~1、**批次61 = 4**。
   * 用途：生成时当**结构闸门**——被埋 ≥3 的候选就是"稳健玩家必死"那一类，直接不要。
   * 代价：一局稳健模拟（约 20~60ms），比 18 局波动便宜得多，可以进候选循环。
   */
  function buriedCountOf(parsed, opts) {
    var g = null;
    try { g = simulatePlay(parsed, { policy: 'steady', rnd: (opts && opts.rnd) || function () { return 0; } }); } catch (e) { return null; }
    if (!g) return null;
    // 峰窗先算（通关的局也要，后面排序要用）
    var lm = null;
    try {
      if (AntSolver.Analysis && AntSolver.Analysis.chokepointAudit) {
        var a0 = AntSolver.Analysis.chokepointAudit(g.samples || [], parsed.totalBoxes || 0, parsed.bufferLimit || 5);
        if (a0 && a0.lateAt != null) lm = a0.lateMax;
      }
    } catch (e) { lm = null; }
    if (g.won) return { buried: 0, stuck: 0, details: [], coveragePct: g.coveragePct, lateMax: lm, won: true };
    var list = g.stuck || [], buried = 0, details = [];
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      if (s.needLeft > 0 && s.boardLeft >= s.needLeft && s.reachable === 0) {
        buried++; details.push({ color: s.color, needLeft: s.needLeft, boardLeft: s.boardLeft });
      }
    }
    // 【v183】顺手把这一局的**卡点区峰窗**带出来：生成时用它优先"稳健玩家也会被顶住"的候选。
    //   这是不花额外开销的：这一局本来就要跑（为"被埋"计数）。
    return { buried: buried, stuck: list.length, details: details, coveragePct: g.coveragePct, lateMax: lm, won: !!g.won };
  }

  /** 一关的 v2 指标：全知线 + 玩家线（+ 贪心线）各量一遍，再"取最差"合成一组判据值。 */
  function chokeV2Of(parsed, solveResult, playerResult, greedyOn) {
    var mo = (solveResult && solveResult.pickOrder) ? chokeV2MeasureLine(parsed, solveResult.pickOrder) : null;
    var mp = (playerResult && playerResult.pickOrder) ? chokeV2MeasureLine(parsed, playerResult.pickOrder) : null;
    // 【v176】贪心线：**默认不跑**（`greedyOn === true` 才跑）。
    //   原因有两条：① 候选循环里每关already要跑一次 PlayerSim，再挂一条完整模拟会直接拖慢生产（用户正嫌慢）；
    //   ② 它的峰窗有"中途死亡→低估"的口径陷阱（见上文），不适合直接进"取最差"。
    //   所以正式接法是**在生产完成后 + 关卡体检时各算一次**（app.js 的 greedyLineReport），
    //   候选循环里的 v2 指标与 v175 完全一致 → 本轮生成结果不变，用户手上正在试的几关不受影响。
    var gr = null, mg = null, ga = null;
    if (greedyOn === true) {
      try { gr = chokeV2GreedyLine(parsed); } catch (e) { gr = null; }
      if (gr && gr.pickOrder && gr.pickOrder.length) {
        try { mg = chokeV2MeasureLine(parsed, gr.pickOrder); } catch (e) { mg = null; }
        try {
          ga = (AntSolver.Analysis && AntSolver.Analysis.chokepointAudit)
            ? AntSolver.Analysis.chokepointAudit(gr.samples || [], parsed.totalBoxes || 0, parsed.bufferLimit || 5) : null;
        } catch (e) { ga = null; }
      }
    }
    if (!mo && !mp) return null;
    var worst = {
      bridges: Math.max(mo ? mo.bridges : -1, mp ? mp.bridges : -1),
      maxRun: Math.max(mo ? mo.maxRun : -1, mp ? mp.maxRun : -1),
      noGood: Math.max(mo ? mo.noGood : -1, mp ? mp.noGood : -1),
      hiBefore70Pct: Math.max(mo ? mo.hiBefore70Pct : -1, mp ? mp.hiBefore70Pct : -1),
      early34Pct: Math.min(mo ? mo.early34Pct : 999, mp ? mp.early34Pct : 999),   // 【v159】下限指标 → 取小（与"取最差"同义）
      r9: Math.min(mo ? mo.r9 : 1e9, mp ? mp.r9 : 1e9),
      minPick: Math.min(mo ? mo.minPick : 99, mp ? mp.minPick : 99)
    };
    if (worst.early34Pct >= 999) worst.early34Pct = 0;
    if (worst.r9 >= 1e9) worst.r9 = 0;
    if (worst.minPick >= 99) worst.minPick = 0;
    // 【v176】贪心线的"真人特征"：只带出数字，**不参与任何判定**（不加重罚、不进 min/max）。
    worst.greedyPads = gr ? gr.pads : null;                 // 垫槽次数（一个都消不掉、必须先占一位）
    worst.greedyPipeBets = gr ? gr.pipeBets : null;         // 赌管道口次数
    worst.pipeBetBufMax = gr ? gr.pipeBetBufMax : null;     // 赌管道时的暂存高度
    worst.pipeBetWhileFull = gr ? gr.pipeBetWhileFull : null;   // R6：已在满槽边缘（空位≤1）还得赌管道的步数
    worst.greedyWon = gr ? gr.won : null;
    worst.greedyCoveragePct = gr ? gr.coveragePct : null;
    // 【v169】中后期压力（30~80% 暂存峰窗）：直接用审核函数的同一口径算两条线，取较小者 = 取最差。
    try {
      var _lim = parsed.bufferLimit || 5, _tot = parsed.totalBoxes || 0;
      var ao = (solveResult && solveResult.pressureSamples && AntSolver.Analysis && AntSolver.Analysis.chokepointAudit)
        ? AntSolver.Analysis.chokepointAudit(solveResult.pressureSamples, _tot, _lim) : null;
      var ap = (playerResult && playerResult.pressureSamples && AntSolver.Analysis && AntSolver.Analysis.chokepointAudit)
        ? AntSolver.Analysis.chokepointAudit(playerResult.pressureSamples, _tot, _lim) : null;
      // 【v169 口径纠正】用户说的"中后期压力"= **30~100% 卡点区**的暂存峰窗（与现有审核同口径，`lateMax`）。
      //   实测这三关：小鹿 4.0/4.0、实机第3关 4.0/3.5、批次62 3.5/3.0；用 30~80% 窗口则只有 4/3/2.5 太严。
      worst.midLatePeakOmni = ao ? ao.lateMax : null;
      worst.midLatePeakPlayer = ap ? ap.lateMax : null;
      var cands = [];
      if (ao) cands.push(ao.lateMax);
      if (ap) cands.push(ap.lateMax);
      worst.midLatePeak = cands.length ? Math.min.apply(null, cands) : null;   // 取最差
    } catch (e) { worst.midLatePeak = null; }
    // 【v176】贪心线的峰窗：只报数、**不并进 worst.midLatePeak**（口径陷阱见函数注释：小鹿 3.0 是死点低估）
    worst.midLatePeakGreedy = ga ? ga.lateMax : null;
    // 只带出轻量摘要（不带 pickOrder / samples，避免候选记录变重）
    var greedyRun = gr ? {
      won: gr.won, steps: gr.steps, coveragePct: gr.coveragePct,
      pads: gr.pads, pipeBets: gr.pipeBets, pipeBetBufMax: gr.pipeBetBufMax, pipeBetWhileFull: gr.pipeBetWhileFull,
      midLatePeak: ga ? ga.lateMax : null, peakBuf: ga ? ga.peakBuf : null
    } : null;
    return { omni: mo, player: mp, greedy: mg, greedyRun: greedyRun, worst: worst, gates: CHOKE_V2_GATES };
  }

  /** 违反项（空数组 = 通过参考门）。 */
  function chokeV2Violations(w) {
    var v = [];
    if (!w) return ['无指标'];
    if (w.bridges > CHOKE_V2_GATES.bridgeMax) v.push('独木桥×' + w.bridges + '处');
    if (w.r9 < CHOKE_V2_GATES.r9Min) v.push('预算判断点仅' + w.r9 + '处');
    if (w.noGood > CHOKE_V2_GATES.noGoodMax) v.push('无满解' + w.noGood + '步');
    if (w.hiBefore70Pct > CHOKE_V2_GATES.hiBefore70PctMax) v.push('70%前≥4占' + w.hiBefore70Pct + '%');
    if (w.early34Pct < CHOKE_V2_GATES.early34MinPct) v.push('前期限压仅' + w.early34Pct + '%');
    // 【v169】中后期压力硬门：两条线里较差的那条也要达到峰窗下限
    if (w.midLatePeak != null && w.midLatePeak < CHOKE_V2_GATES.midLatePeakMin) {
      v.push('中后期峰窗仅' + w.midLatePeak + '（< ' + CHOKE_V2_GATES.midLatePeakMin + '）');
    }
    return v;
  }
  function chokeV2Pass(w) { return chokeV2Violations(w).length === 0; }

  /** 候选的 v2 指标（带缓存：同一候选只量一次）。 */
  function chokeV2OfCand(c) {
    if (!c || !c.level || !c.solveResult) return null;
    if (c._chokeV2 === undefined) {
      var v2 = null;
      // 兜底路径只量全知线（玩家线一般已由 evaluateGeneration 量好并挂在 generationEval.auditV2 上）
      try { v2 = chokeV2Of(AntSolver.parseLevel(c.level), c.solveResult, null); } catch (e) { v2 = null; }
      c._chokeV2 = v2;
    }
    return c._chokeV2;
  }
  function chokeV2Ok(c) {
    var v2 = (c && c.generationEval && c.generationEval.auditV2) ? c.generationEval.auditV2 : chokeV2OfCand(c);
    return !!(v2 && chokeV2Pass(v2.worst));
  }
  /** v2 分（越大越好）：只用来在**同一档**候选之间排序，不参与合格判定。 */
  function chokeV2Score(c) {
    var v2 = (c && c.generationEval && c.generationEval.auditV2) ? c.generationEval.auditV2 : chokeV2OfCand(c);
    if (!v2) return -1e6;
    var w = v2.worst, s = 0;
    s += (w.bridges <= CHOKE_V2_GATES.bridgeMax) ? 12 : (-9 * w.bridges);          // 独木桥：达标奖励，超一处重罚
    s += Math.min(w.r9, 24) * 2;                                                   // 预算判断点：多多益善（封顶 24 处）
    s += (w.noGood <= CHOKE_V2_GATES.noGoodMax) ? 10 : (-3 * w.noGood);             // 必须硬垫的步数
    s -= Math.max(0, w.hiBefore70Pct - CHOKE_V2_GATES.hiBefore70PctMax) * 0.4;      // 高压跑到 70% 之前
    s += Math.min(w.early34Pct || 0, 40) * 0.6;                                     // 【v159】前期限压覆盖率：越高越好（封顶 40%）
    s += Math.min(w.midLatePeak || 0, 4.5) * 8;                                     // 【v169】中后期峰窗：越高越好（硬门之外的择优键）
    return s;
  }

  function evaluateGeneration(solveResult, parsed, config) {
    GENPERF.evalCalls++;                           // 埋点：生成评价次数(内含玩家模拟)
    var _te = Date.now();
    try { return _evaluateGenerationInner(solveResult, parsed, config); }
    finally { GENPERF.evalMs += Date.now() - _te; }
  }
  function _evaluateGenerationInner(solveResult, parsed, config) {
    var totalBoxes = parsed.totalBoxes || 0, limit = parsed.bufferLimit || 5;
    var omniSamples = (solveResult && solveResult.pressureSamples) || [];
    var omniAudit = auditFor(solveResult, parsed, limit, config);
    var omniPreview = AntSolver.Analysis && AntSolver.Analysis.dynamicPreviewMetrics
      ? AntSolver.Analysis.dynamicPreviewMetrics(omniSamples, totalBoxes) : null;
    var playerResult = null;
    try {
      // 玩家模拟与全知求解必须同一入口模式与消除口径，否则"全知一套、玩家另一套"，审核与难度结论不可用。
      if (AntSolver.PlayerSim) playerResult = AntSolver.PlayerSim.run(parsed, { seed: 7, useItems: false, capturePreviewStats: true, bottomOnly: !!(config && config.bottomOnly), instantChain: !!(config && config.instantChain) });
    } catch (e) { playerResult = null; }
    var playerSamples = playerResult ? (playerResult.pressureSamples || []) : [];
    var playerAudit = AntSolver.Analysis && AntSolver.Analysis.chokepointAudit
      ? AntSolver.Analysis.chokepointAudit(playerSamples, totalBoxes, limit) : null;
    var playerPreview = AntSolver.Analysis && AntSolver.Analysis.dynamicPreviewMetrics
      ? AntSolver.Analysis.dynamicPreviewMetrics(playerSamples, totalBoxes) : null;
    var omniAvg = averageSampleBuffer(omniSamples), playerAvg = averageSampleBuffer(playerSamples);
    // 【v157】卡点判据 v2（R1~R9）：沿全知线与玩家线各量一遍，判据取最差。纯指标计算，
    //   不改变本函数任何既有输出；下游用它做候选排序与"达标才早停"，不做硬门。
    var chokeV2 = null;
    try { chokeV2 = chokeV2Of(parsed, solveResult, playerResult); } catch (e) { chokeV2 = null; }
    // 【v182】"被埋"计数：稳健玩家一局的终局里有几辆车"量够但够不着"（61 号关那种死法）
    var buried = null;
    if (!(config && config.buriedGate === false)) {
      try { buried = buriedCountOf(parsed); } catch (e) { buried = null; }
    }
    var obstacles = AntSolver.Analysis && AntSolver.Analysis.obstacleStats ? AntSolver.Analysis.obstacleStats(parsed) : {};
    var evaluation = {
      auditV2: chokeV2,   // 【v157】卡点判据 v2：{omni, player, worst, gates}
      buried: buried,     // 【v182】{buried, stuck, details, coveragePct} 或 null（闸门关闭）
      omni: {
        won: !!(solveResult && solveResult.completed), avgBuffer: omniAvg,
        peak: solveResult ? (solveResult.maxBuffer || 0) : 0,
        audit: omniAudit, preview: omniPreview, pressureSamples: omniSamples
      },
      player: {
        // avgBuffer 仍是【完成事件轴】均值（pressureSamples 口径），保留原语义——
        // 它与 pressureOffset、卡点审核同源，改动会牵动合格门。
        won: !!(playerResult && playerResult.won), avgBuffer: playerAvg,
        peak: playerResult ? (playerResult.bufferPeak || 0) : 0,
        audit: playerAudit, preview: playerPreview, pressureSamples: playerSamples,
        progress: playerResult ? playerResult.progress : 0,
        misjudge: playerResult ? playerResult.misjudge : 0,
        revives: playerResult ? (playerResult.revivesUsed || 0) : 0,
        reviveCap: playerResult ? (playerResult.reviveCap != null ? playerResult.reviveCap : 2) : 2,
        // ---- v4 难度评分口径（需求 §3/§4/§5）：操作 tick 轴，独立于上面的完成事件轴 ----
        avgBufferTick: playerResult ? (playerResult.playerAvgBuffer || 0) : 0,   // f1 源
        avgResidence: playerResult ? (playerResult.avgResidence || 0) : 0,        // f2 源
        effectiveTicks: playerResult ? (playerResult.effectiveTicks || 0) : 0,
        residenceCount: playerResult ? (playerResult.residenceCount || 0) : 0,
        stalledAtEnd: playerResult ? (playerResult.stalledAtEnd || 0) : 0,
        tickTrajectory: playerResult ? (playerResult.tickTrajectory || []) : [],
        reviveEvents: playerResult ? (playerResult.reviveEvents || []) : [],
        elimMode: playerResult ? (playerResult.elimMode || 'fourSide') : 'fourSide'
      },
      pressureOffset: +(Math.max(0, playerAvg - omniAvg)).toFixed(2),
      sources: {
        board: { rows: parsed.board.rows, cols: parsed.board.cols, area: parsed.board.rows * parsed.board.cols },
        obstacles: obstacles,
        walls: { blackPercent: config.blackPercent || 0, narrowPath: !!config.narrowPath, gapMin: config.narrowPathGapsMin || 0, gapMax: config.narrowPathGapsMax || 0 }
      }
    };
    // 合格 = 全知可解 + 玩家版≤2复活通关(player.won 已含 reviveCap=2) + 压力曲线可用 + 全知未触死亡边界。
    // 注：玩家峰值可触暂存上限(有复活道具兜底)，不再作为不合格条件。
    //
    // v104 合格门语义重置（ANT-GEN-AUDIT-RESET-20260824）：
    //   压力曲线可用 = audit.usable = curveOK(有实际卡点) || flatTrend(趋势过平但不过压)。
    //   与旧写法 (pass || easyPass) **逐关等价**（347 关求解数据实测 347/347 一致），故产能不变。
    //   档次字样改为「合格 / 简单关·趋势过平 / 不合格」——难易分档不再由审核给，交给难度分。
    var curveUsable = omniAudit ? (omniAudit.usable != null ? omniAudit.usable : (omniAudit.pass || omniAudit.easyPass)) : false;
    // 【v295·用户裁决】hardOnly：只认「真·有卡点」(curveOK/pass)，不认 flatTrend（趋势过平）。
    //   用户原话：「暂时不要简单合格了，现在只生成难的关卡，理解后再生成简单的」。
    //   关掉 hardOnly 即逐值回到旧行为。
    if (config && config.hardOnly) curveUsable = !!(omniAudit && omniAudit.pass);
    evaluation.pass = !!(evaluation.omni.won && evaluation.player.won && curveUsable &&
      evaluation.omni.peak < limit);
    evaluation.tier = omniAudit ? (omniAudit.tier || '不合格') : '不合格';
    // 是否占「简单关名额」：趋势过平的关卡仍可用，但归入简单关配额（用户 2026-08-24 纠正）
    evaluation.easyQuota = !!(omniAudit && (omniAudit.easyQuota != null ? omniAudit.easyQuota : omniAudit.easyPass));
    evaluation.hasEffectiveChoke = !!(omniAudit && omniAudit.pass);
    evaluation.score = generationScore(evaluation, limit);
    // 【v334】生成轨迹：每次评估一条（界面「生成过程」面板用）。只读，不参与任何判定。
    if (config && config._trace) {
      try {
        var _bd = parsed && parsed.board, _cars = 0, _hid = 0;
        if (_bd && _bd.cells) for (var _tr = 0; _tr < _bd.cells.length; _tr++) for (var _tc = 0; _tc < _bd.cells[_tr].length; _tc++) {
          var _tx = _bd.cells[_tr][_tc]; if (!_tx) continue;
          if (_tx.t === 'box') _cars++; else if (_tx.t === 'pipe') _hid += (_tx.queue || []).length;
        }
        // 覆盖率就地算（evaluation 里没有 persist；口径与 goodV3 一致：30~80% 区间 buf≥3 的占比）
        var _cov = null, _ps = (solveResult && solveResult.pressureSamples) || [], _tb = parsed.totalBoxes || 0;
        if (_ps.length && _tb) {
          var _t2 = 0, _g3 = 0;
          for (var _pi2 = 0; _pi2 < _ps.length; _pi2++) {
            var _pr2 = _ps[_pi2].done / _tb;
            if (_pr2 < 0.30 || _pr2 > 0.80) continue;
            _t2++; if (_ps[_pi2].buf >= 3) _g3++;
          }
          if (_t2) _cov = Math.round(_g3 / _t2 * 100);
        }
        var _pz = evaluation.persist || {};
        config._trace.push({
          t: 'eval', round: config._traceRound || 0,
          tier: evaluation.tier || '-',
          rows: _bd ? _bd.rows : null, cols: _bd ? _bd.cols : null,
          cars: _cars, hidden: _hid,
          capMin: config.boxSizeMin, capMax: config.boxSizeMax,
          cov: (_pz.band3Pct != null ? _pz.band3Pct : _cov),
          peak: evaluation.omni ? evaluation.omni.peak : null,
          player: _pz.playerPassPct == null ? null : _pz.playerPassPct,
          pass: !!evaluation.pass
        });
      } catch (e) { }
    }
    return evaluation;
  }

  /**
   * 生产选择分：原暂存审核仍是主项，动态封锁只奖励“后期形成、前期不过早”的结构；
   * 玩家失败或任一侧触达暂存上限会被重罚。该分数仅用于候选/强化排序，不写入难度权重。
   */
  function generationScore(evaluation, bufferLimit) {
    if (!evaluation) return -1e9;
    var op = evaluation.omni.preview || {}, pp = evaluation.player.preview || {};
    var score = auditScoreOf(evaluation.omni.audit, bufferLimit);
    score += (op.lateAvgLockRatio || 0) * 18 - (op.earlyAvgLockRatio || 0) * 12;
    score += (pp.lateAvgLockRatio || 0) * 22 - (pp.earlyAvgLockRatio || 0) * 16;
    score += Math.min(2, evaluation.pressureOffset || 0) * 4;
    // 玩家门：≤reviveCap(默认2)次复活通关即合格；合格里【复活次数越少越优】(0>1>2)，"最优一次就过"。
    if (evaluation.player.won) {
      var cap = evaluation.player.reviveCap != null ? evaluation.player.reviveCap : 2;
      var used = evaluation.player.revives || 0;
      score += 20 + Math.max(0, cap - used) * 10;   // 0次=+40 1次=+30 2次=+20
    } else {
      score -= 200;
    }
    if ((evaluation.omni.peak || 0) >= bufferLimit) score -= 80;
    if ((evaluation.player.peak || 0) >= bufferLimit) score -= 80;
    if (evaluation.pass) score += 120;
    return +score.toFixed(3);
  }
  // 后期[startFrac,1]被取的【无障碍普通盒】坐标(去重)——扰动目标集中在后期段制造卡点
  function lateRouteBoxes(board, pickOrder, startFrac) {
    var out = [], seen = {}, total = (pickOrder || []).length;
    for (var i = Math.floor(total * startFrac); i < total; i++) {
      var p = pickOrder[i]; if (!p || p.r == null) continue;
      var key = p.r + ',' + p.c; if (seen[key]) continue;
      var cell = board.cells[p.r] && board.cells[p.r][p.c];
      if (cell && cell.t === 'box' && !cell.numice && !cell.chain && !cell.q) { seen[key] = 1; out.push({ r: p.r, c: p.c }); }
    }
    return out;
  }
  // 增减压(第二轮修复)：据审核诊断调障碍基础参数——前/中期过压→减压(降障碍)，后期欠压(无高压卡点)→增压(升障碍)。
  //   每级 5%(锁链±1对)，调用方 clamp 累进至 ±3 级(总波动 30%)。返回 {cfg:调整后副本, dir:方向(-1减/0不动/+1增)}。
  /**
   * 【难度缩放 · 两段式】用户 2026-09-02 两次细化后的最终口径：
   *
   *   第一段「同比让分」：可用空间与各类障碍**一起**按各自那一项的权重分同比降低，
   *     最多降到**地板组合**：1 对锁链、2 个管道、3 个冰块、2 个问号。
   *     —— 用户：「首先是同步一起降低分数…最多同比降低到接近最低值」
   *
   *   第二段「顺序剥离」：到了地板还需要继续降难度时，才按**权重从大到小**逐项剥离：
   *     锁链 → 管道 → 问号 → 冰块
   *     —— 用户：「在这个最低值的组合情况下如果还需要降低难度则按照以下顺序」
   *     冰块排最后，正是因为它权重最低（2.0 分）、实测是弱杠杆，所以要最后才动它；
   *     这与改动前「谁便宜先抹谁」的行为恰好相反（旧逻辑冰块 24 轮就被抹除）。
   *
   *   「不是不碰端点」：端点允许到，但必须先走完同比阶段、且按权重顺序，
   *     而不是一开始就把某个便宜的参数单独推到端点。
   *
   * 参数值本身用**自身归一分**换算（各项标定见 AnalysisV2.CAL_V2），
   * 地板值则按**绝对个数**判定（用户给的是个数、不是百分比），故需要盒格数换算。
   *
   * @param {object} config 当前配置
   * @param {number} factor 归一分缩放系数（<1 减难度、>1 增难度）
   * @param {number} floorRatio 【已停用】上一版用它夹逼归一分，与「个数地板组合」冲突且会
   *                   导致冰块永远到不了 3 格地板、第二阶段进不去（实测已复现）。保留形参仅为兼容调用点。
   * @param {number} [boxCells] 盒格数，用于把「个数地板」换算成百分比。缺省按 60 估（9×8 盘常见值）
   * @returns {{cfg:object, 明细:object}}
   */
  /**
   * 【冰块格数档位阶梯】用户 2026-09-02：
   *   「给冰块本身覆盖按照自身档位由低分-高分的格数覆盖逻辑，而不是完全遵循分数的比例来做。」
   *
   * 为什么冰块要单列一套档位、不跟分数比例走：
   *   冰块归一分用的是 gamma=3.5 的强度偏移曲线（低冰区几乎不给分，见 analysis-v2.js 内注释）。
   *   按分数比例反解时，低区间会**动不了** —— 实测连续 4 次 factor=1.3，
   *   问号 2%→7.4%、管道 2→7，而冰块只从 6.0% 爬到 6.4%（归一分 0.06 × 1.3 仍是 0.08，反解几乎不变）。
   *   所以冰块改成在**格数空间**上走离散档位：档位由低分到高分依次排列，调整时按档位增减，
   *   保证每次都真的移动；而每档对应的归一分仍由同一条 gamma 曲线给出，评分口径不变。
   *
   * 阶梯范围：下限 = 地板格数（用户定的 3 格）；上限 = 标定区间上限对应的格数（ice.hi × 盒格数）。
   *
   * @param {number} boxCells 盒格数
   * @param {object} calIce AnalysisV2.CAL_V2.ice
   * @returns {Array<{档:number,格数:number,占比:number,归一分:number}>} 按格数升序（= 归一分升序）
   */
  function iceCellTiers(boxCells, calIce) {
    var g = (calIce.gamma != null) ? calIce.gamma : 1;
    var loCells = 3;                                        // 地板：3 个冰块（用户给定）
    var hiCells = Math.max(loCells, Math.floor(boxCells * calIce.hi));
    var out = [];
    for (var n = loCells; n <= hiCells; n++) {
      var pct = Math.ceil(n / boxCells * 1000) / 10;        // 向上取一位小数，保证 floor() 回得来 n 格
      var x = Math.max(0, Math.min(1, (pct / 100 - calIce.lo) / (calIce.hi - calIce.lo)));
      out.push({ 档: out.length, 格数: n, 占比: pct, 归一分: +(Math.pow(x, g) * 100).toFixed(3) });
    }
    return out;
  }
  /** 由当前占比反查所处档位（取实际落地格数对应的档）。 */
  function iceTierOf(tiers, pct, boxCells) {
    var cells = Math.floor(boxCells * (pct || 0) / 100);
    for (var i = tiers.length - 1; i >= 0; i--) if (tiers[i].格数 <= cells) return i;
    return 0;
  }

  function scaleDifficultyProportional(config, factor, floorRatio, boxCells) {
    var V2 = AntSolver.AnalysisV2;
    if (!V2 || !V2.CAL_V2) return { cfg: config, 明细: { 跳过: 'AnalysisV2 未加载，不猜标定值' } };
    var CAL = V2.CAL_V2;
    var fr = (floorRatio != null) ? floorRatio : 0.25;
    var BC = (boxCells != null && boxCells > 0) ? boxCells : 60;
    var adj = Object.assign({}, config);
    var det = { 系数: factor, 保底比例: fr, 盒格数: BC, 阶段: null, 项: {}, 剥离: null };

    // ── 地板组合（用户给定，绝对个数）──
    var FLOOR = { 锁链组: 1, 管道数: 2, 冰块格: 3, 问号格: 2 };
    det.地板组合 = FLOOR;
    // 个数 → 百分比必须**向上**取到一位小数：落位处是 Math.floor(BC × pct/100)，
    //   向下取会少一格（实测：2 个问号 = 3.333%，取 3.3% 时 floor(60×0.033)=1 格，跌破地板）。
    function ceil1(x) { return Math.ceil(x * 10) / 10; }
    var icePctFloor = ceil1(FLOOR.冰块格 / BC * 100);
    var qPctFloor = ceil1(FLOOR.问号格 / BC * 100);

    function c01(x) { return Math.max(0, Math.min(1, x)); }
    function iceN(pct) { var c = CAL.ice, g = (c.gamma != null) ? c.gamma : 1; return Math.pow(c01((pct / 100 - c.lo) / (c.hi - c.lo)), g) * 100; }
    function iceInv(n) { var c = CAL.ice, g = (c.gamma != null) ? c.gamma : 1; return (c.lo + Math.pow(c01(n / 100), 1 / g) * (c.hi - c.lo)) * 100; }
    function qN(pct) { var c = CAL.question; return c01((pct / 100 - c.lo) / (c.hi - c.lo)) * 100; }
    function qInv(n) { var c = CAL.question; return (c.lo + c01(n / 100) * (c.hi - c.lo)) * 100; }

    /** 是否四项都已触及地板（个数口径）。 */
    function atFloor(c) {
      var iceCells = Math.floor(BC * (c.icePercent || 0) / 100);
      var qCells = Math.floor(BC * (c.questionPercent || 0) / 100);
      return (c.chainCount || 0) <= FLOOR.锁链组
        && (c.minPipes || 0) <= FLOOR.管道数
        && iceCells <= FLOOR.冰块格
        && qCells <= FLOOR.问号格;
    }

    var stripped = Array.isArray(config._strippedOrder) ? config._strippedOrder.slice() : [];

    if (factor >= 1 || !atFloor(adj)) {
      // ══ 第一段：同比让分（各项按自身归一分等比例，止于地板）══
      det.阶段 = '同比让分';
      function rec(name, pb, nb, na, pa, floored) {
        det.项[name] = { 参数前: pb, 参数后: pa, 归一分前: +nb.toFixed(2), 归一分后: +na.toFixed(2), 触地板: !!floored };
      }
      // ⚠ 同比阶段**不再**用 floorRatio 夹逼归一分：用户的口径里唯一的地板是
      //   「1 对锁链 / 2 个管道 / 3 个冰块 / 2 个问号」这个**个数**组合。
      //   上一版用 floorRatio=0.25 夹归一分，会把冰块卡在约 11%（γ=3.5 曲线所致）
      //   永远到不了 3 格地板，于是第二阶段的顺序剥离永远进不去。实测已复现，故移除。
      // ── ① 冰块：走**自身格数档位阶梯**，不用分数比例反解（用户 2026-09-02 裁定）──
      if (typeof adj.icePercent === 'number') {
        var tiers = iceCellTiers(BC, CAL.ice);
        var t0 = iceTierOf(tiers, adj.icePercent, BC);
        // 在**档位空间**里按同一系数缩放，再保证「一定移动一档」——
        //   分数空间会因 gamma 曲线在低区间失效，档位空间不会。
        var t1 = Math.round(t0 * factor);
        if (factor < 1 && t1 >= t0) t1 = t0 - 1;
        if (factor > 1 && t1 <= t0) t1 = t0 + 1;
        t1 = Math.max(0, Math.min(tiers.length - 1, t1));
        var ib = adj.icePercent, in0 = iceN(ib);
        adj.icePercent = tiers[t1].占比;
        det.项['冰块占比%'] = {
          参数前: ib, 参数后: adj.icePercent,
          档前: t0, 档后: t1, 格数前: tiers[t0].格数, 格数后: tiers[t1].格数,
          归一分前: +in0.toFixed(2), 归一分后: tiers[t1].归一分,
          档位总数: tiers.length, 触地板: t1 === 0,
          口径: '格数档位阶梯（不按分数比例反解）'
        };
      }
      if (typeof adj.questionPercent === 'number') {
        var qb = adj.questionPercent, qn0 = qN(qb);
        var qn1 = Math.min(100, qn0 * factor);
        var qvRaw = qInv(qn1);
        adj.questionPercent = Math.round(Math.max(qPctFloor, qvRaw) * 10) / 10;
        rec('问号占比%', qb, qn0, qN(adj.questionPercent), adj.questionPercent, qvRaw < qPctFloor);
      }
      if (typeof adj.chainCount === 'number') {
        var maxG = (CAL.chain && CAL.chain.maxGroups != null) ? CAL.chain.maxGroups : 5;
        var cb = adj.chainCount, cn0 = c01(cb / maxG) * 100;
        var cn1 = Math.min(100, cn0 * factor);
        var cv = Math.round(cn1 / 100 * maxG);
        adj.chainCount = cb > 0 ? Math.max(FLOOR.锁链组, cv) : 0;
        rec('锁链组数', cb, cn0, c01(adj.chainCount / maxG) * 100, adj.chainCount, cv < FLOOR.锁链组);
      }
      if (typeof adj.minPipes === 'number' && adj.minPipes > 0) {
        var pb = adj.minPipes;
        var pv = Math.round(pb * factor);
        adj.minPipes = Math.max(FLOOR.管道数, pv);
        det.项['管道数'] = { 参数前: pb, 参数后: adj.minPipes, 说明: '无独立权重项，随结构同系数缩放', 触地板: pv < FLOOR.管道数 };
      }
      if (CAL.usableSpace && typeof adj.usableSpaceTarget === 'number') {
        var cu = CAL.usableSpace, ub = adj.usableSpaceTarget;
        var un0 = c01((cu.hi - ub) / (cu.hi - cu.lo)) * 100;
        var un1 = Math.min(100, un0 * factor);
        var uv = cu.hi - un1 / 100 * (cu.hi - cu.lo);
        adj.usableSpaceTarget = Math.min(cu.hi, Math.max(cu.lo, Math.round(uv * 1000) / 1000));
        rec('可用空间目标', ub, un0, c01((cu.hi - adj.usableSpaceTarget) / (cu.hi - cu.lo)) * 100, adj.usableSpaceTarget, false);
      }
      if (typeof adj.blackPercent === 'number' && adj.blackPercent > 0) {
        var bb = adj.blackPercent;
        adj.blackPercent = Math.max(1, Math.round(bb * factor * 10) / 10);
        det.项['黑块占比%'] = { 参数前: bb, 参数后: adj.blackPercent, 说明: '不在六项权重内，随结构同系数缩放，保底 1%' };
      }
      det.已到地板 = atFloor(adj);
    } else {
      // ══ 第二段：顺序剥离（已在地板、仍要继续降）══
      //   顺序 = 权重从大到小：锁链(9.5%) → 管道 → 问号(3.5%) → 冰块(2.0%)
      det.阶段 = '顺序剥离';
      var ORDER = ['锁链', '管道', '问号', '冰块'];
      var next = null;
      for (var i = 0; i < ORDER.length; i++) {
        if (stripped.indexOf(ORDER[i]) < 0) { next = ORDER[i]; break; }
      }
      if (next === null) {
        det.剥离 = { 说明: '四项已全部剥离完，无可再降', 剥离顺序: ORDER, 已剥离: stripped.slice() };
      } else {
        if (next === '锁链') { det.剥离 = { 项: '锁链', 前: adj.chainCount, 后: 0 }; adj.chainCount = 0; }
        else if (next === '管道') { det.剥离 = { 项: '管道', 前: adj.minPipes, 后: 0 }; adj.minPipes = 0; }
        else if (next === '问号') { det.剥离 = { 项: '问号', 前: adj.questionPercent, 后: 0 }; adj.questionPercent = 0; }
        else { det.剥离 = { 项: '冰块', 前: adj.icePercent, 后: 0 }; adj.icePercent = 0; }
        stripped.push(next);
        det.剥离.剥离顺序 = ORDER;
        det.剥离.已剥离 = stripped.slice();
      }
      adj._strippedOrder = stripped;
    }
    return { cfg: adj, 明细: det };
  }

  /**
   * 【v151】"选择余地"曲线也进增减压决策，而且**优先级高于压力曲线**。
   *
   *   理由（用户 2026-10-15）：「不用纠结黑块集不集中，只要不会造成『黑块的存在，让玩家几乎没有选择、
   *   只是按照我们既定的路线走』就行」。也就是说 —— **把曲线压平的不是"难度"，是"没有选择"**。
   *   所以：曲线被压平（≤1 的步数占比高 / 中位选项数太低 / 开局就没得选）时，
   *   一律走【减压】且步幅更大（×0.7、锁链 −2），不管压力曲线那边是不是在喊"欠压要增压"。
   *   代价是：靠堆障碍来造卡点这条路被压住了 —— 这是刻意的，用户要的是"有选择里的卡点"。
   */
  function curveFlattened(curve) {
    if (!curve || !curve.n || curve.n < 8) return false;      // 步数太少不表态
    // 【v441】W≤1/中位1 不再算“压平”；只有可选中位<2 / 被迫步高才减压
    if (curve.selectMedian != null && curve.selectMedian < 2) return true;
    if (curve.forcedPct != null && curve.forcedPct > 25) return true;
    return (curve.opening <= 1);
  }
  function applyPressureAdjust(config, audit, bufferLimit, curve) {
    if (!audit) {
      if (CURVE_SCORE_ON && curveFlattened(curve)) {
        var adjOnly = Object.assign({}, config);
        ['icePercent', 'questionPercent', 'blackPercent'].forEach(function (k) {
          if (typeof adjOnly[k] === 'number') adjOnly[k] = Math.max(0, Math.round(adjOnly[k] * 0.7));
        });
        if (typeof adjOnly.chainCount === 'number') adjOnly.chainCount = Math.max(0, adjOnly.chainCount - 2);
        adjOnly._curveFlat = true;
        return { cfg: adjOnly, dir: -1 };
      }
      return { cfg: config, dir: 0 };
    }
    // 【v118 修正常量来源】同 auditScoreOf：原先写死 −1.5/−2.5，卡点线改成 L−1.8 后会与合格门不一致。
    //   改为读审核返回的 high/mid。`audit.midMax` 自 v118 起恒为 0（中期段移除），
    //   故「中期过压」那一支自然失效，与「只要求前期不出现卡点」的新口径一致。
    //   ⚠ 已知副作用：前期区间由 [0,20%] 扩到 [0,30%]，earlyMax 取值范围变大 →
    //     这里的「前期过压 → 减压」会更容易触发。本函数是生成期启发式、不参与合格判定，
    //     系数与方向逻辑本轮未调，如实记录待观察。
    var high = (audit.high != null) ? audit.high : (bufferLimit - 1.8);
    var mid = (audit.mid != null) ? audit.mid : (bufferLimit - 2.5);
    var dir = 0;
    if ((audit.earlyMax || 0) >= mid || (audit.midMax || 0) >= high) dir = -1;   // 前期过压 → 减压
    else if ((audit.lateMax || 0) < high) dir = 1;                               // 中后期欠压(无卡点) → 增压
    // 【v151】曲线被压平 → 强制减压（优先级高于上面两条：没有选择不是难度）
    var flat = CURVE_SCORE_ON && curveFlattened(curve);   // 【v151】同上：开关关着就不动生产
    if (flat) dir = -1;
    if (dir === 0) return { cfg: config, dir: 0 };
    if (flat) {
      var ret = (config.proportionalDifficultyAdjust)
        ? (function () { var pr = scaleDifficultyProportional(config, 0.7, config.proportionalFloorRatio); pr.cfg._proportionalAdjust = pr.明细; pr.cfg._curveFlat = true; return { cfg: pr.cfg, dir: -1 }; })()
        : null;
      if (ret) return ret;
    }
    // 【同比缩放接入点①】开启后走等比例让分，不再「挑最便宜的参数往端点推」。
    //   原逻辑对 chainCount 是绝对 ±1（1 组一次归零），对百分比是 ×1.05/×0.95。
    if (config.proportionalDifficultyAdjust) {
      var pr = scaleDifficultyProportional(config, 1 + dir * 0.15, config.proportionalFloorRatio);
      pr.cfg._proportionalAdjust = pr.明细;
      return { cfg: pr.cfg, dir: dir };
    }
    var f = 1 + dir * (flat ? 0.30 : 0.05), adj = Object.assign({}, config);
    ['icePercent', 'questionPercent', 'blackPercent'].forEach(function (k) {
      if (typeof adj[k] === 'number') adj[k] = Math.max(0, Math.round(adj[k] * f));
    });
    if (typeof adj.chainCount === 'number') adj.chainCount = Math.max(0, adj.chainCount + dir * (flat ? 2 : 1));
    if (flat) adj._curveFlat = true;
    if (typeof adj.swapRatio === 'number') adj.swapRatio = Math.max(0, Math.min(1, adj.swapRatio + dir * 0.05));
    return { cfg: adj, dir: dir };
  }


  /**
   * 生产主入口（P3 BxN 卡点树，取代老版爬山强化 `strengthenLevel`，已退役删除）：K 候选，每候选初生成(合法性门)
   * → 未合格则展开 B 分支 × N 轮 卡点制造树(换球/增容 + round≥2 增减压重生成)
   * → 任一变体审核合格即停输出；全程无合格则兜底输出最接近合格者。返回同 generateFromBlocks 形状 + {audit,candidates,treeEvaluated}。
   * 时间预算(config.timeBudgetMs，默认5分钟，0=不限时)：到点仍未合格 → 立即停止搜索，兜底输出树内已评估过的
   *   【最接近合格】候选(按 candScore 排序，同旧兜底逻辑)，并标记 timedOut=true。
   * 严格卡点门(config.requireHardPass，默认false)：true 时【简单合格(趋势符合，无实际卡点)】不算数、不早停，
   *   继续搜索直到拿到【困难合格(真实卡点)】或超时兜底——供批量生产按比例分配"简单/困难"关卡用。
   */
  function produce(blocks, config) {
    seedRng(config && config.seed);
    config = Object.assign({}, DEFAULT_CONFIG, config || {});
    // 【v334】生成轨迹：每次评估一条，供界面"生成过程"面板回放
    if (config.trace !== false) { if (!config._trace) config._trace = []; }
    var K = Math.max(1, config.candidateCount || 1);
    var B = Math.max(1, config.chokeBranches || 3);
    var N = Math.max(0, config.rounds != null ? config.rounds : 2);
    var budget = config.timeBudgetMs != null ? config.timeBudgetMs : 300000;   // 默认5分钟；0/负=不限时
    var requireHard = !!config.requireHardPass;
    var t0 = Date.now(), timedOut = false;
    // 【仅底部入口】生产前门（同 produceFixed；D2：旧流程一并对齐）。
    if (config.bottomOnly) {
      var feasOld = checkBottomEntryFeasibility(blocks);
      if (!feasOld.ok) {
        return {
          level: null, valid: false, flow: 'old',
          entryMode: 'bottomOnly',
          bottomEntryFeasibility: feasOld,
          timedOut: false, elapsedMs: Date.now() - t0, candidates: 0, treeEvaluated: 0,
          structural: { ok: false, reason: 'bottomEntryInfeasible：' + feasOld.detail },
          lastFailReason: 'bottomEntryInfeasible'
        };
      }
    }
    // 性能埋点(阶段1)：每关开始清零本关计数器（生成器/求解器/玩家模拟三处），收尾在 done() 里取快照。
    resetGenPerf();
    if (AntSolver.Solver && AntSolver.Solver.resetPerf) AntSolver.Solver.resetPerf();
    if (AntSolver.PlayerSim && AntSolver.PlayerSim.resetPerf) AntSolver.PlayerSim.resetPerf();
    var deadlineAt = budget > 0 ? t0 + budget : 0;
    if (deadlineAt) config = Object.assign({}, config, { _deadlineAt: deadlineAt });   // 透传给 generateFromBlocks 的内部重试循环，防止单次调用把总预算顶爆
    function timeUp() { if (budget > 0 && (Date.now() - t0) >= budget) { timedOut = true; return true; } return false; }
    var best = null, evaluated = 0;
    // 注：best===null 时也要能被首个候选替换掉——即便该候选分数是 -1e9(如完全不可解)，也比"什么都没有"强，
    //   否则超时/全程无候选可解时会兜底成 null(等价于交付空关卡)，而不是"最接近标准的那个"。
    // 兜底选择严格按【三档优先级】(candBetter 内 tierOf 分档，档内再用 candScore 排序)：
    //   ①困难合格(真实卡点) > ②简单合格(趋势符合) > ③安全兜底(至少双方可通关，不触死亡边界=最差也要像"简单关")。
    function consider(c) { if (c) { evaluated++; if (candBetter(c, best, config)) best = c; } return c; }
    // done()：收尾时补齐性能埋点快照(停止原因 + 总耗时 + 求解/玩家模拟计数)，挂到结果的 perf 字段。
    //   纯记录，不影响 finalizeProduce 的档次判定与兜底选择。
    function done(c) {
      if (c) { c.timedOut = timedOut; c.elapsedMs = Date.now() - t0; }
      GENPERF.totalMs = Date.now() - t0;
      if (!GENPERF.stopReason) {
        GENPERF.stopReason = timedOut ? 'budget_timeout' : (c ? (candPass(c, requireHard, config) ? 'pass_early_stop' : 'exhausted') : 'no_candidate');
      }
      var out = finalizeProduce(c, K, evaluated);
      if (out) {
        out.perf = getGenPerf();
        out.perf.solver = (AntSolver.Solver && AntSolver.Solver.getPerf) ? AntSolver.Solver.getPerf() : null;
        out.perf.playerSim = (AntSolver.PlayerSim && AntSolver.PlayerSim.getPerf) ? AntSolver.PlayerSim.getPerf() : null;
        out.perf.evaluatedPositions = evaluated;
        out.perf.config = { candidateCount: K, chokeBranches: B, rounds: N, timeBudgetMs: budget, requireHardPass: requireHard };
      }
      return out;
    }
    // K 个候选，各初生成(合法性门)；未合格则展开 B 分支 × N 轮 卡点制造树；任一变体合格即停；超时随时兜底退出。
    var v2Extra = 0, v2Stop = false;   // 【v157】卡点判据 v2 的"多搜几个候选"计数（与 produceFixed 同口径）
    for (var k = 0; k < K; k++) {
      if (timeUp()) break;
      if (v2Stop) break;
      GENPERF.baseCandidates++;                    // 埋点：基础候选数
      var base = tagAudit(generateFromBlocks(blocks, config));
      consider(base);
      // 【v157】早停同样要求卡点判据 v2 达标；多搜 v2Patience 个候选为上限（与 produceFixed 同口径）
      if (candPass(base, requireHard, config) && meetsEarlyStopQuality(base, config)) return done(base);   // 【v257】初生成即合格且到带中段才收工
      if (!(config.chokeV2 === false) && candPassLegacy(base, requireHard) &&
          ++v2Extra > ((config.chokeV2Patience != null) ? config.chokeV2Patience : 1)) v2Stop = true;
      if (v2Stop) break;
      if (!base.valid) continue;                                        // 不可解候选不展开树
      var layer = [base];
      for (var round = 1; round <= N && layer.length; round++) {
        if (timeUp()) break;
        var next = [];
        for (var li = 0; li < layer.length; li++) {
          if (timeUp()) break;
          for (var b = 0; b < B; b++) {
            if (timeUp()) break;
            GENPERF.chokeVariants++;               // 埋点：卡点变体数
            var child = makeChokeVariant(layer[li], blocks, config, round);
            if (!child) continue;
            consider(child);
            if (candPass(child, requireHard, config)) return done(child);   // 合格即停（旧门 + v2）
            if (!(config.chokeV2 === false) && candPassLegacy(child, requireHard) &&
                ++v2Extra > ((config.chokeV2Patience != null) ? config.chokeV2Patience : 1)) { v2Stop = true; break; }
            next.push(child);
          }
        }
        layer = next;
      }
      if (timeUp()) break;
    }
    return done(best);   // 全程无合格/超时 → 兜底输出最接近合格者
  }

  // ---- P3 卡点树辅助 ----
  /**
   * 【v151】「选择余地」曲线 —— 把用户说的"没灵气"变成一条可算的曲线。
   *
   * 用户 2026-10-15 原话：「不用纠结黑块集不集中，只要不会造成『黑块（障碍）的存在，
   * 让玩家几乎没有说什么选择，只是按照我们既定的路线走』就行……黑块换成管道也是同样的意思，
   * 都会堵路；换成数字冰和锁链也会挡路，但意义不一样（数字冰引导玩家先去走别的路线再回来，
   * 锁链可以在暂存区能接受的情况下选择，从而打开路线）。」
   *
   * 所以判据不盯"哪个障碍多不多"，只盯**它导致的结果**：
   *
   *   每步「能吃满的选项数」 = 当前非阻塞可选盒里，该颜色一口气能吃掉 ≥ 该盒容量 的个数。
   *     · ≥3  → 玩家有得选（可以自己规划）
   *     · ≤1  → 只能按既定路线走（"没有灵气"）
   *   黑块 / 数字冰 / 锁链 / 问号 / 管道 都只是让这条数掉下去的工具，工具本身不考核。
   *
   * 目标形状：**前中期宽松（≥3）、关键处（30~80%）允许 1~3 个被迫点、末段可以收紧**。
   * 反例：极难档实测把曲线从 20% 起一路压平在 1~2 —— 那不是"更难"，是"没有选择"。
   */
  var CURVE_DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  /** 每个颜色"此刻一口气能吃掉多少像素" = 所有【含至少一个已露头像素】的同色 4-连通块之和。一次 O(N) 扫描。 */
  function exposedBlobByColor(eliminated, blocks, rows, cols) {
    var vis = {}, out = {}, q = [];
    for (var r0 = 0; r0 < rows; r0++) for (var c0 = 0; c0 < cols; c0++) {
      if (eliminated[r0][c0]) continue;
      var col = blocks[r0][c0]; if (col <= 0) continue;
      var id0 = r0 * cols + c0; if (vis[id0]) continue;
      var reach = (r0 === 0 || r0 === rows - 1 || c0 === 0 || c0 === cols - 1);
      if (!reach) for (var d = 0; d < 4; d++) {
        var nr = r0 + CURVE_DIRS[d][0], nc = c0 + CURVE_DIRS[d][1];
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) { reach = true; break; }
        if (eliminated[nr][nc]) { reach = true; break; }
      }
      if (!reach) continue;
      var n = 0; q.length = 0; q.push(id0); vis[id0] = 1;
      while (q.length) {
        var id = q.pop(); n++;
        var r = (id / cols) | 0, c = id % cols;
        for (var d2 = 0; d2 < 4; d2++) {
          var nr2 = r + CURVE_DIRS[d2][0], nc2 = c + CURVE_DIRS[d2][1];
          if (nr2 < 0 || nr2 >= rows || nc2 < 0 || nc2 >= cols) continue;
          var id2 = nr2 * cols + nc2;
          if (vis[id2] || eliminated[nr2][nc2] || blocks[nr2][nc2] !== col) continue;
          vis[id2] = 1; q.push(id2);
        }
      }
      out[col] = (out[col] || 0) + n;
    }
    return out;
  }

  /**
   * 【v153】源图体检：开局「暴露」了几种颜色、各多少像素。
   *
   * 为什么这个数是第一判据：玩家每一步的可选项 = 【棋盘顶行的车】(第0行恒可取) ∩ 【目标图上当前暴露的颜色】
   *   —— 一辆车只有在它自己颜色的暴露像素 ≥ 该车容量时才能被吃满（模拟器 canConsumeReach 的同一口径）。
   * v153 实测（2026-10-15，全部逐条记在 01_交接文档/工作日志_20261012.md 第十七节）：
   *   · 蚂蚁关卡_1791949636679.txt（596 像素 / 5 色）：开局只暴露 **1 色**（24 号色，140 像素）
   *     → 开局"能吃满"的选项恒为 1~2，且【改障碍、改棋盘、改容差、改车容量全都改不动】。
   *   · 004_55像素_004_12种（1786 像素 / 12 色）：开局暴露 **8 色** → 开局选项 6，用户评价"有灵气"。
   * 也就是说：**这一项是源图属性，不是参数问题** —— 剪影被单一颜色包住的图，开局只能沿唯一路线剥。
   *
   * @returns {object|null} { exposedColors, totalColors, exposedPixels, top:{color,px}, detail:[{color,px}] }
   */
  function openingExposure(blocks, rows, cols, bottomOnly) {
    if (!blocks || !blocks.length || !blocks[0]) return null;
    var R = rows || blocks.length, C = cols || blocks[0].length;
    if (!(R > 0 && C > 0)) return null;
    var elim, blob;
    try { elim = AntSolver.outsideReachSeed(blocks, R, C, !!bottomOnly); } catch (e) { return null; }
    if (!elim) return null;
    try { blob = exposedBlobByColor(elim, blocks, R, C); } catch (e) { return null; }
    var list = [], total = 0, k;
    for (k in blob) { if (!blob[k]) continue; list.push({ color: +k, px: blob[k] }); total += blob[k]; }
    list.sort(function (a, b) { return b.px - a.px; });
    var seen = {}, nColor = 0;
    for (var r0 = 0; r0 < R; r0++) for (var c0 = 0; c0 < C; c0++) {
      var v = blocks[r0][c0];
      if (v > 0 && !seen[v]) { seen[v] = 1; nColor++; }
    }
    return {
      exposedColors: list.length, totalColors: nColor,
      exposedPixels: total, top: list[0] || null, detail: list
    };
  }

  /**
   * 【v153】开局没得选时的如实说明（只在暴露颜色 ≤ 2 时产出文案，否则返回 null）。
   * 口径故意写"这是源图造成的、调参改不了"，免得用户又去调障碍参数（v151/v152 已经试过一整轮）。
   */
  function exposureWarnText(exp) {
    if (!exp || exp.exposedColors > 2) return null;
    var top = exp.top;
    return '这张图【开局只有 ' + exp.exposedColors + ' 种颜色可吃】'
      + (top ? ('（最多的是 ' + top.color + ' 号色，' + top.px + ' 像素）') : '')
      + '，整图共 ' + exp.totalColors + ' 色。'
      + '开局那几辆顶行车里往往只有一两辆的颜色已经露出来 → 前段几乎只能按唯一路线走。'
      + '这是【目标图剪影】造成的（整张剪影被单一颜色勾边包住，其余颜色在剥掉外圈前一个像素都不暴露），'
      + '调障碍比例/棋盘大小/可用空间容差都改不了（v153 逐条实测过）。'
      + '想让开局就出现分支：让轮廓上出现多种颜色（例如把外框拆成几段不同色），'
      + '或改用轮廓本来就杂的源图（实测那种图开局能暴露 8~9 色）。';
  }

  /** 曲线火花线（0~8 档）。 */
  var CURVE_SPARK = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
  // 【v151】曲线评分默认【关】：它只改"同档候选谁胜出"，而实测在用户那张图 + 极难档下
  //   候选池整体都是扁的，挑不出好曲线 —— 没证明改善之前不动生产口径（保持逐字节可复现）。
  //   曲线【统计与火花线】始终计算并落进日志/逐关记录（纯可见性，零风险）。
  //   打开方式：方案/配置里设 curveScore:true（界面在「难度」段有勾选框）。
  var CURVE_SCORE_ON = false;
  function setCurveScore(on) { CURVE_SCORE_ON = !!on; }
  function isCurveScore() { return CURVE_SCORE_ON; }
  function curveSpark(steps) {
    var out = '';
    for (var i = 0; i < steps.length; i++) {
      var v = steps[i].full; if (v > 7) v = 7;
      out += CURVE_SPARK[v < 0 ? 0 : v];
    }
    return out;
  }

  /**
   * 沿【求解路线】回放一遍，逐步统计"能吃满的选项数"。
   * @returns {object|null} { steps, opening, medFull, forcedN, forcedMid, forcedAt, lowPct, low2Pct, spark }
   */
  function choiceCurve(parsed, solveResult) {
    if (!parsed || !solveResult || !solveResult.pickOrder || !solveResult.pickOrder.length) return null;
    var S = AntSolver.Simulator;
    if (!S || !S.enter || !S.listMoves) return null;
    var st;
    // 【v238】改用 createState 建独立状态：S.enter 会把全局模拟器的 state 换成这次回放，
    //   生产里每关算一次曲线就会打断用户正在界面上玩的局面。createState 口径相同（含激活/管道初始化），
    //   但不碰全局态。拿不到 createState 时退回旧路径。
    try {
      st = (S.createState ? S.createState(parsed, { useSlotStart: true }) : S.enter(parsed, { useSlotStart: true }));
    } catch (e) { return null; }
    var rows = st.rows, cols = st.cols, limit = parsed.bufferLimit || 5;
    var order = solveResult.pickOrder.slice().sort(function (a, b) { return (a.step || 0) - (b.step || 0); });
    var steps = [];
    try {
      for (var i = 0; i < order.length; i++) {
        var p = order[i];
        if (p.chainIndex > 0) continue;          // 锁链组的非触发成员：整组已随触发盒一起离场
        var blob = exposedBlobByColor(st.eliminated, st.blocks, rows, cols);
        var mv = S.listMoves(st), full = 0;
        for (var j = 0; j < mv.length; j++) {
          if (mv[j].blocked) continue;
          var cell = st.cells[mv[j].r] && st.cells[mv[j].r][mv[j].c];
          if (!cell) continue;
          if ((blob[cell.color] || 0) >= cell.count) full++;
        }
        var prog = st.totalBoxes ? (st.completedBoxes / st.totalBoxes) : 0;
        // 【v380·P6】压力点检测要坐标/候选：把这一手的盒与“当前可点且能吃满”的候选一起记下
        var _mvs = [];
        for (var _mj = 0; _mj < mv.length; _mj++) {
          if (mv[_mj].blocked) continue;
          var _mc = st.cells[mv[_mj].r] && st.cells[mv[_mj].r][mv[_mj].c];
          if (!_mc) continue;
          _mvs.push({ r: mv[_mj].r, c: mv[_mj].c, color: _mc.color, count: _mc.count, full: ((blob[_mc.color] || 0) >= _mc.count) ? 1 : 0 });
        }
        steps.push({ prog: +prog.toFixed(4), full: full, free: limit - st.buffer.length,
          pick: { r: p.r, c: p.c, color: p.color, count: p.count }, moves: _mvs });
        if (!S.applyPick(st, p.r, p.c)) break;
        if (st.gameOver) break;
      }
    } catch (e) { /* 回放失败：返回已采到的部分 */ }
    if (!steps.length) return null;
    var n = steps.length, low = 0, low2 = 0, frees = [];
    var forced = [];
    for (var k = 0; k < n; k++) {
      if (steps[k].full <= 1) low++;
      if (steps[k].full <= 2) low2++;
      if (steps[k].full <= 1 && steps[k].free <= 2) forced.push(steps[k].prog);
    }
    var sortedFull = steps.map(function (x) { return x.full; }).sort(function (a, b) { return a - b; });
    var mid = sortedFull[Math.floor(sortedFull.length / 2)];
    var forcedMid = forced.filter(function (p2) { return p2 >= 0.30 && p2 <= 0.80; }).length;
    var _pn = 0, _of = 0, _op = 0;
    var _freeSteps = 0, _pressSteps = 0, _freeRun = 0, _freeRunMax = 0;
    var _lastPress = -1, _gapMax = 0, _afterFree = 0, _afterDen = 0;
    for (var _pk2 = 0; _pk2 < steps.length; _pk2++) {
      var _s2 = steps[_pk2];
      var _isFree = (_s2.full >= 2 && _s2.free >= 3);
      var _isPress = (_s2.full >= 2 && _s2.free <= 1);
      if (_s2.prog >= 0.35 && _s2.prog <= 0.70 && _s2.free <= 1 && _s2.full >= 2) _pn++;
      if (_pk2 < 12) {
        if (_isFree) _of++;
        if (_isPress) _op++;
      }
      if (_isFree) { _freeSteps++; _freeRun++; if (_freeRun > _freeRunMax) _freeRunMax = _freeRun; }
      else _freeRun = 0;
      if (_isPress) {
        _pressSteps++;
        if (_lastPress >= 0) { var _gap = _pk2 - _lastPress - 1; if (_gap > _gapMax) _gapMax = _gap; }
        _lastPress = _pk2;
      }
    }
    if (_lastPress >= 0) { var _tail = n - 1 - _lastPress; if (_tail > _gapMax) _gapMax = _tail; }
    // 压力后 3 步内又回到免费步的比例
    for (var _pi2 = 0; _pi2 < n; _pi2++) {
      var _sp = steps[_pi2];
      if (!(_sp.full >= 2 && _sp.free <= 1)) continue;
      for (var _q2 = 1; _q2 <= 3; _q2++) {
        var _sn = steps[_pi2 + _q2];
        if (!_sn) break;
        _afterDen++;
        if (_sn.full >= 2 && _sn.free >= 3) _afterFree++;
      }
    }
    var _freePct = n ? Math.round(_freeSteps / n * 100) : 0;
    var _pressPct = n ? Math.round(_pressSteps / n * 100) : 0;
    var _afterPct = _afterDen ? Math.round(_afterFree / _afterDen * 100) : 0;
    // 【v409】白给车“位置”指标：低缓冲白给 vs 高缓冲减压
    var _freeLow = 0, _freeHigh = 0, _minFree = limit;
    for (var _ti2 = 0; _ti2 < n; _ti2++) {
      var _st2 = steps[_ti2];
      if (_st2.free < _minFree) _minFree = _st2.free;
      if (_st2.full < 2) continue;
      if (_st2.free >= 4) _freeLow++;    // 缓冲 ≤1
      if (_st2.free <= 2) _freeHigh++;   // 缓冲 ≥3
    }
    var _freeLowPct = n ? Math.round(_freeLow / n * 100) : 0;
    var _misPct = (_freeLow + _freeHigh) ? Math.round(_freeLow / (_freeLow + _freeHigh) * 100) : 0;
    var _press3Pct = 0;
    for (var _pi3 = 0; _pi3 < n; _pi3++) if (steps[_pi3].free <= 2) _press3Pct++;
    _press3Pct = n ? Math.round(_press3Pct / n * 100) : 0;
    var _peak = Math.max(0, limit - _minFree);
    // 【v429】决策宽度：可选中位 / 吃满中位 / 被迫步 / 有 partial 的步
    var _sels = [], _fulls = [], _forced = 0, _partialSteps = 0;
    for (var _di = 0; _di < n; _di++) {
      var _ds = steps[_di];
      var _sel = (_ds.moves && _ds.moves.length) ? _ds.moves.length : 0;
      var _ful = _ds.full || 0;
      _sels.push(_sel); _fulls.push(_ful);
      if (_sel <= 1) _forced++;
      if (_sel - _ful >= 1) _partialSteps++;
    }
    function _median(arr) {
      if (!arr.length) return 0;
      var a = arr.slice().sort(function (x, y) { return x - y; });
      return a[Math.floor(a.length / 2)];
    }
    var _selMed = _median(_sels), _fullMed2 = _median(_fulls);
    var _forcedPct = n ? Math.round(_forced / n * 100) : 0;
    var _partialStepPct = n ? Math.round(_partialSteps / n * 100) : 0;
    // 【v432】前 10 步压力：前期太顺是用户体感“简单”的主因
    var _eN = Math.min(10, n), _eFree = 0, _ePress = 0, _ePeak = 0;
    for (var _ei = 0; _ei < _eN; _ei++) {
      var _es = steps[_ei];
      if (_es.full >= 2 && _es.free >= 3) _eFree++;
      if (_es.free <= 2) _ePress++;
      var _eb = limit - _es.free;
      if (_eb > _ePeak) _ePeak = _eb;
    }
    return {
      steps: steps, n: n, pressureN: _pn, openingFree12: _of, openingPressure12: _op,
      freePct: _freePct, pressurePct: _pressPct, freeRunMax: _freeRunMax,
      pressureGapMax: _gapMax, freeAfterPressurePct: _afterPct, fullMedian: mid,
      freeLowPct: _freeLowPct, misplacedFreePct: _misPct, pressurePct3: _press3Pct, pressurePeak: _peak,
      selectMedian: _selMed, fullMedian2: _fullMed2, forcedPct: _forcedPct, partialStepPct: _partialStepPct,
      earlyFree10: _eFree, earlyPressure10: _ePress, earlyPeak10: _ePeak, opening: steps[0].full, medFull: mid,
      forcedN: forced.length, forcedMid: forcedMid,
      forcedAt: forced.map(function (p3) { return Math.round(p3 * 100); }),
      lowPct: Math.round(low / n * 100), low2Pct: Math.round(low2 / n * 100),
      spark: curveSpark(steps)
    };
  }

  /**
   * 曲线打分（叠在既有 candScore 上，只影响"同档候选谁胜出"，不改合格门）。
   *   ① 平时要有得选：中位能吃满的选项数越高越好（封顶 6，避免刷分）
   *   ② 不能全程被迫：full≤1 的步数占比越高扣得越狠
   *   ③ 被迫点位置：落在 30~80% 的 1~3 个加分；一个都没有中性；超过 3 个扣分
   *   ④ 开局就要有得选：开局能吃满 <3 直接扣
   */
  function choiceCurveScore(cur) {
    if (!cur) return 0;
    var s = 0;
    s += Math.min(cur.medFull, 6) * 3;
    s -= cur.lowPct * 0.6;
    if (cur.forcedMid >= 1 && cur.forcedMid <= 3) s += 10;
    else if (cur.forcedMid > 3) s -= 6;
    s += (cur.opening >= 3) ? 6 : -6;
    return s;
  }

  /**
   * 【v371·P1】T/R/U 只读代理（不参与任何生成/合格决策）。
   *   输入：goodV3Of 里已经跑过的 10 局玩家结果（_dbgRuns）、choiceCurve、总盒数。
   *   T 陷阱密度 = 输给“最优通关局”的分歧步数 ÷ choiceCurve 里 full>=2 的决策点数；
   *   R 后悔率   = 最优进度 − 10 局平均进度（百分点）；
   *   U 废牌率   = 10 局都没碰过的盒 ÷ 总盒数。
   *   这是 v0 代理：用策略间分歧近似“岔路”，P3 做真反事实（从同一状态换一手继续跑）。
   */
  function qualityRollup(runs, fill, totalBoxes) {
    if (!runs || !runs.length) return null;
    var picked = {}, union = 0, best = null, sumProg = 0, progN = 0;
    for (var i = 0; i < runs.length; i++) {
      var r = runs[i]; if (!r) continue;
      var pn = (r.progress != null) ? +r.progress : 0;
      sumProg += pn; progN++;
      if (!best || (!!r.won && !best.won) || (!!r.won === !!best.won && pn > (best.progress || 0))) best = r;
      var po = r.pickOrder || [];
      for (var j = 0; j < po.length; j++) {
        var k = po[j].r + ',' + po[j].c;
        if (!picked[k]) { picked[k] = 1; union++; }
      }
    }
    if (!progN) return null;
    var bestProg = best ? (best.progress || 0) : 0;
    var R = Math.max(0, Math.round(bestProg - sumProg / progN));
    var U = (totalBoxes > 0) ? Math.max(0, Math.min(100, Math.round((1 - union / totalBoxes) * 100))) : null;
    var dec = (fill && fill.steps) ? fill.steps.filter(function (s) { return s && s.full >= 2; }).length : 0;
    var traps = {}, trapList = [];
    if (best && best.won) {
      var bp = best.pickOrder || [];
      for (var ri = 0; ri < runs.length; ri++) {
        var rr = runs[ri]; if (!rr || rr.won) continue;
        var rp = rr.pickOrder || [], n = Math.min(bp.length, rp.length);
        for (var k2 = 0; k2 < n; k2++) {
          if (bp[k2].r !== rp[k2].r || bp[k2].c !== rp[k2].c) {
            var sk = (bp[k2].step != null) ? bp[k2].step : k2;
            if (!traps[sk]) {
              traps[sk] = 1;
              if (trapList.length < 20) trapList.push({ step: sk, color: bp[k2].color });
            }
            break;
          }
        }
      }
    }
    var hasWinner = !!(best && best.won);
    var trapN = 0; for (var tk in traps) trapN++;
    // dec=0：整条最优路线没有 >=2 个可吃满的步 → 没有岔路，T=0；
    // 有决策点但没有通关局 → 无法归因，T=null。
    if (dec <= 0 || !hasWinner) { trapN = 0; trapList = []; }
    var T = (dec <= 0) ? 0 : (hasWinner ? Math.max(0, Math.min(100, Math.round(trapN / dec * 100))) : null);
    return { T: T, R: R, U: U, trapCount: trapN, decisions: dec, traps: trapList, runs: progN, bestProgress: bestProg, hasWinner: hasWinner };
  }

  function candScore(c) {
    var base = (c && c.generationEval) ? c.generationEval.score : (c && c.audit ? auditScoreOf(c.audit, c.level.bufferLimit) : -1e9);
    // 【v151】叠一层"选择余地"分：同档候选里优先选"平时有得选、关键处被迫"的那种。
    if (c && c.level && c.solveResult && c._curveScore == null) {
      try {
        var cur = choiceCurve(AntSolver.parseLevel(c.level), c.solveResult);
        c._choiceCurve = cur;
        c._curveScore = cur ? choiceCurveScore(cur) : 0;
      } catch (e) { c._curveScore = 0; }
    }
    return base + (CURVE_SCORE_ON ? (c && c._curveScore || 0) : 0);
  }
  // 兜底/候选优先级分档(0=最差…3=最好)：只依据【审核压力曲线 tier + 双方是否可通关】，不掺难度分(难度分是独立的第二套指标，见 §生产审核评分体系.md)。
  //   3=困难合格(真实卡点) / 2=简单合格(趋势符合) / 1=安全兜底(全知+玩家均可通关、未触死亡边界，但压力曲线未达标——至少是能玩的关) / 0=其余(不可解/玩家打不通/触死亡边界)。
  // 3/2 档【同时要求】双方可通关(与 evaluateGeneration.pass 的门槛口径一致)——压力曲线再漂亮，玩家实际打不通就不算"合格"，只能降到 1 档兜底。
  /**
   * 【v184】好关判据 v3（收尾标记）：对所有变体/救援都做完的【最终 level】评六条。
   *   只标记、不参与搜索、不重跑：不合格也照常落库，只记 goodV3（config.goodV3 === false 可关）。
   *   成本 = 18 局玩家模拟（0.3~1.2s/关）。
   *   六条与 03_工具/好关评分/评分.js 同一口径：可解 / 稳健通关≥50% / 被埋=0 / 前期峰窗≤2 /
   *   中后期峰窗 3.2~4.8 / 策略差≤34。
   */
  function goodV3Of(cand) {
    var lv;
    try { lv = AntSolver.parseLevel(cand.level); } catch (e) { return null; }
    var sr = cand.solveResult || {}, a = cand.audit || {};
    var b = (cand.generationEval && cand.generationEval.buried) || {};
    var play = null;
    try { play = chokeV2PlayBatch(lv, { n: 18 }); } catch (e) { play = null; }
    var buried = (b.buried != null) ? b.buried : null;
    var steady = play ? play.steadyWonPct : null;
    var spread = play ? play.spreadPct : null;
    // 【v238】选择余地曲线：沿求解路线逐步统计"每步能吃满几辆"（= 压力的直接来源）。
    //   实测 31 关：合格关「吃满≤1 的步」占 44~81%、每步能吃满 0.9~1.7 辆；
    //   简单关 46%/1.9；太松的不合格关 2~21%/2.7~7.1。这里只记录，不改合格门。
    // 【v259】全知线的"压力持久度"：峰窗只说明最高点，说明不了"扛了多久"。
    //   ge3Pct = 暂存≥3 的步数占比；longest = 最长连续≥3 的步数。
    //   用户 2026-10-19：「想让全知求解器的压力高一点、且持久一点」——先把这个量记下来才谈得上调。
    var _persist = null;
    try {
      // 【v263】全知线的"卡点覆盖"：把压力样本按 5% 进度分桶，统计均值 ≥ 卡点线(3.2) 的桶数/
      //   最长连续桶数。峰窗只说明"最高那一桶"，说明不了"有多少段真的到了卡点线"。
      //   用户 2026-10-19 看图后："全知求解器的卡点不够" —— 说的就是 plateau 只有 3.0（差 0.2）。
      var _pw = (function () {
        var ps = sr.pressureSamples || [], tb = sr.totalBoxes || 0;
        if (!ps.length || !tb) return null;
        var NB = 20, sums = [], cnts = [];
        for (var bi = 0; bi < NB; bi++) { sums.push(0); cnts.push(0); }
        for (var pi = 0; pi < ps.length; pi++) {
          var pr = ps[pi].done / tb; if (pr > 1) pr = 1;
          var b = Math.min(NB - 1, Math.floor(pr * NB));
          sums[b] += ps[pi].buf; cnts[b]++;
        }
        var line = 3.2, win = 0, span = 0, cur = 0;
        for (var bj = 0; bj < NB; bj++) {
          var mean = cnts[bj] ? (sums[bj] / cnts[bj]) : 0;
          if (mean >= line) { win++; cur++; if (cur > span) span = cur; } else cur = 0;
        }
        return { win: win, span: span, buckets: NB };
      })();
      var _h = sr.stepBufferHistory || [];
      if (_h.length) {
        var _pk = 0, _ge = 0, _run = 0, _best = 0;
        for (var _hi = 0; _hi < _h.length; _hi++) {
          if (_h[_hi] > _pk) _pk = _h[_hi];
          if (_h[_hi] >= 3) { _ge++; _run++; if (_run > _best) _best = _run; } else { _run = 0; }
        }
        // 【v264·用户目标】30~80% 区间里"基本上都 ≥3、最高 4"。
        //   直接按这个口径量：band3Pct = 该区间内 buf≥3 的步占比；bandPeak = 该区间峰值。
        var _bTot = 0, _bGe = 0, _bPk = 0, _bGe4 = 0, _bGe5 = 0;   // 【v321】顺带量"中段有没有 4/5 的尖峰"
        try {
          var _ps2 = sr.pressureSamples || [], _tb2 = sr.totalBoxes || 0;
          for (var _bj = 0; _bj < _ps2.length; _bj++) {
            var _pr = _tb2 ? (_ps2[_bj].done / _tb2) : 0;
            if (_pr < 0.30 || _pr > 0.80) continue;
            _bTot++;
            if (_ps2[_bj].buf >= 3) _bGe++;
            if (_ps2[_bj].buf >= 4) _bGe4++;          // 【v321】用户要的是"平台 3 里偶尔冒 4/5"
            if (_ps2[_bj].buf >= 5) _bGe5++;
            if (_ps2[_bj].buf > _bPk) _bPk = _ps2[_bj].buf;
          }
        } catch (e) { }
        _persist = { peak: _pk, ge3Pct: Math.round(_ge / _h.length * 100), longest: _best, steps: _h.length,
                     band3Pct: _bTot ? Math.round(_bGe / _bTot * 100) : null, bandPeak: _bPk,
                     band4Pct: _bTot ? Math.round(_bGe4 / _bTot * 100) : null,   // 【v321】中段 ≥4 的采样占比
                     band5Pct: _bTot ? Math.round(_bGe5 / _bTot * 100) : null,
                     chokeWin: (_pw ? _pw.win : null), chokeSpan: (_pw ? _pw.span : null) };
      }
    } catch (e) { _persist = null; }
    var _fill = null;
    try {
      var _cv = choiceCurve(lv, sr);
      if (_cv) _fill = { medFull: _cv.medFull, lowPct: _cv.lowPct, low2Pct: _cv.low2Pct,
                         opening: _cv.opening, forcedMid: _cv.forcedMid, n: _cv.n, spark: _cv.spark, steps: _cv.steps, pressureN: _cv.pressureN, openingFree12: _cv.openingFree12, openingPressure12: _cv.openingPressure12,
                         freePct: _cv.freePct, pressurePct: _cv.pressurePct, freeRunMax: _cv.freeRunMax,
                         pressureGapMax: _cv.pressureGapMax, freeAfterPressurePct: _cv.freeAfterPressurePct, fullMedian: _cv.fullMedian,
                         freeLowPct: _cv.freeLowPct, misplacedFreePct: _cv.misplacedFreePct, pressurePct3: _cv.pressurePct3, pressurePeak: _cv.pressurePeak,
                         selectMedian: _cv.selectMedian, fullMedian2: _cv.fullMedian2, forcedPct: _cv.forcedPct, partialStepPct: _cv.partialStepPct,
                         earlyFree10: _cv.earlyFree10, earlyPressure10: _cv.earlyPressure10, earlyPeak10: _cv.earlyPeak10 };
    } catch (e) { _fill = null; }
    // 【v190】口径修正：spread 大不一定不公平——"稳健 100% / 乱点 33%" 很正常。
    //   真正要抓的是"稳打不如别的打法"：steadyGap = 最好打法 − 稳健。
    var bestWon = play ? play.bestWonPct : null;
    var steadyGap = (steady != null && bestWon != null) ? (bestWon - steady) : null;
    var early = (a.earlyMax != null) ? a.earlyMax : null;
    // 【口径】峰窗用【18 局中位】，不用审核那条单线（见工作日志 31.3「压力报区间、不报单点」）；
    //   量不到 18 局时才退回 audit.midLateMax。两者都记下来，方便对账。
    var midLateAudit = (a.midLateMax != null) ? a.midLateMax : null;
    var midLate = (play && play.lateMax && play.lateMax.p50 != null) ? play.lateMax.p50 : midLateAudit;
    var fails = [];
    if (!sr.completed) fails.push('可解');
    // 【v214·用户裁决】验收模式 'solvable'：只要求"全知求解器能通关"，压力/稳健/公平一概不管。
    // 【v224】目标口径：可解 + 峰窗∈[3,4] + 稳健∈[30,80]（用户定义的"困难关"）
    if (cand.config && cand.config.acceptMode === 'target') {
      var _pMin = (cand.config.targetPeakMin != null) ? +cand.config.targetPeakMin : 3;
      var _pMax = (cand.config.targetPeakMax != null) ? +cand.config.targetPeakMax : 4;
      var _sMin = (cand.config.targetSteadyMin != null) ? +cand.config.targetSteadyMin : 30;
      var _sMax = (cand.config.targetSteadyMax != null) ? +cand.config.targetSteadyMax : 80;
      var _tf = [];
      var _qf = [];   // 【v366】质量线未过项（与旧 goodV3 的难度/稳健分开记）
      if (!sr.completed) _tf.push('可解');
      if (midLate == null || midLate < _pMin || midLate > _pMax) _tf.push('峰窗不在' + _pMin + '~' + _pMax);
      if (steady == null || steady < _sMin || steady > _sMax) _tf.push('稳健不在' + _sMin + '~' + _sMax);
      // 【v273·用户选 A】合格还要"中段压得住"：30~80% 区间暂存 ≥3 的覆盖率至少 targetBand3Min%
      var _b3Min = (cand.config && cand.config.targetBand3Min != null) ? +cand.config.targetBand3Min : 0;
      if (_b3Min > 0) {
        var _b3 = (_persist && _persist.band3Pct != null) ? _persist.band3Pct : null;
        if (_b3 == null || _b3 < _b3Min) _tf.push('30-80覆盖<' + _b3Min + '%');
      }
      // 【v321·用户裁决】光"覆盖率达标"不够：曲线会变成一条 3 的平台线（用户贴的图就是这个）。
      //   再加一条：中段 30~80% 里必须有一定比例的采样点冲到 ≥4（尖峰），否则说明玩家每一步都有
      //   "不加票"的选择 → 压力是平的。0 = 不要求（默认关闭，开了才有这一条）。
      var _b4Min = (cand.config && cand.config.targetBand4Min != null) ? +cand.config.targetBand4Min : 0;
      if (_b4Min > 0) {
        var _b4 = (_persist && _persist.band4Pct != null) ? _persist.band4Pct : null;
        if (_b4 == null || _b4 < _b4Min) _tf.push('30-80≥4<' + _b4Min + '%');
      }
      // 【v324·用户裁决】容错门槛：单条全知线能解 ≠ 玩家能玩。
      //   用户这关 16/16 局死于"三锁链要 3 槽、只剩 2 槽"，但审计只写"险胜(用尽复活)"就放行了。
      //   做法：扫 5 种"手痒程度"（pickThreshold 0.3~0.9）× 2 个种子 = 10 局，都不给复活，
      //   只在其它条全过时才跑（贵，~0.9 秒），所以不会拖慢淘汰型候选。
      // 【v365】改为**总是跑**：报告要显示“首通/主要死法”，不能因为旧峰窗失败就不量。
      //   成本 ~0.9s/关（只对最终这一关，不是每个候选），换来四玩家里的“首通”永远有数。
      var _ppMin = (cand.config && cand.config.targetPlayerPassMin != null) ? +cand.config.targetPlayerPassMin : 0;
      if (AntSolver.PlayerSim) {
        var _thr = [0.3, 0.45, 0.6, 0.75, 0.9], _R = 0, _W = 0, _dbgRuns = [];
        for (var _ti = 0; _ti < _thr.length; _ti++) {
          for (var _si = 0; _si < 2; _si++) {
            try {
              var _rr2 = AntSolver.PlayerSim.run(lv, {
                pickThreshold: _thr[_ti], seed: 101 + _si * 37, useItems: false, reviveCap: 0,
                bottomOnly: !!(cand.config && cand.config.bottomOnly), instantChain: !!(cand.config && cand.config.instantChain),
                capturePreviewStats: false
              });
              _R++; if (_rr2 && _rr2.won) _W++;
              _dbgRuns.push(_rr2);
            } catch (e) { }
          }
        }
        var _ppRate = _R ? (_W / _R) : null;   // 【v371】没有一次跑成功 = 未测，绝不能伪装成 100%
        if (_persist && _ppRate != null) _persist.playerPassPct = Math.round(_ppRate * 100);
        if (_persist) { _persist.playerRuns = _R; _persist.playerWins = _W; }
        // 【v373·P2】学会后（≤3 次重试，带“死色记忆”）：首通失败后，下一局给上局死色降权。
        //   只写 persist.learned*，不参与 _tf/_qf；用来量“死过一次后能不能过”。
        try {
          var _lt = 0, _lw = 0, _la = 0;
          for (var _li = 0; _li < _thr.length; _li++) {
            for (var _lsi = 0; _lsi < 2; _lsi++) {
              var _base = _dbgRuns[_li * 2 + _lsi];
              _lt++;
              if (_base && _base.won) { _lw++; _la++; continue; }
              var _avoid = null;
              var _bl = _base && (_base.lastBlocked || _base.lastRefuse);
              if (_bl && _bl.color != null) _avoid = _bl.color;
              var _tries = _base ? 1 : 0, _won = false;
              for (var _at = 1; _at <= 2; _at++) {
                _tries++;
                var _thr2 = _thr[_li] + (_at === 1 ? 0.15 : -0.15);
                if (_thr2 < 0.1) _thr2 = 0.1;
                if (_thr2 > 0.95) _thr2 = 0.95;
                try {
                  var _lr = AntSolver.PlayerSim.run(lv, {
                    pickThreshold: _thr2, seed: 101 + _lsi * 37 + _at * 97, useItems: false, reviveCap: 0,
                    bottomOnly: !!(cand.config && cand.config.bottomOnly), instantChain: !!(cand.config && cand.config.instantChain),
                    capturePreviewStats: false, avoidColor: _avoid
                  });
                  if (_lr && _lr.won) { _won = true; break; }
                  var _lb2 = _lr && (_lr.lastBlocked || _lr.lastRefuse);
                  if (_lb2 && _lb2.color != null) _avoid = _lb2.color;
                } catch (e) { }
              }
              _la += _tries;
              if (_won) _lw++;
            }
          }
          if (_persist) {
            _persist.learnedPassPct = _lt ? Math.round(_lw / _lt * 100) : null;
            _persist.learnedRuns = _lt; _persist.learnedWins = _lw; _persist.learnedAttempts = _la;
          }
        } catch (e) { }
        if (_R && _ppRate != null && _ppRate < _ppMin) _tf.push('玩家通关率' + Math.round(_ppRate * 100) + '%<' + Math.round(_ppMin * 100) + '%');
        // 【v336·用户裁决】死因归因：把没通关的那几局分类（链/冰/管道/形状/断供），
        //   落进 persist.deathCauses，并支持"要求主死因是某一类"（targetDeathCause，默认不限）。
        var _dc = { '链': 0, '冰': 0, '管道': 0, '形状': 0, '断供': 0, '其它': 0 };
        for (var _di = 0; _di < _dbgRuns.length; _di++) {
          var _dr = _dbgRuns[_di];
          if (!_dr || _dr.won) continue;
          var _ds = _dr.deathSnapshot || {};
          var _cause = '其它';
          if (_ds.chainMax && _ds.free != null && _ds.chainMax > _ds.free) _cause = '链';
          else if (_ds.left && _ds.left.ice > 0) _cause = '冰';
          else if (_ds.left && _ds.left.pipe > 0) _cause = '管道';
          else if (_ds.free === 0) _cause = '形状';
          else _cause = '断供';
          _dc[_cause] = (_dc[_cause] || 0) + 1;
        }
        var _dTop = '其它', _dTopN = 0, _dTot = 0;
        for (var _dk in _dc) { _dTot += _dc[_dk]; if (_dc[_dk] > _dTopN) { _dTopN = _dc[_dk]; _dTop = _dk; } }
        if (_persist) {
          _persist.deathCauses = _dc;
          _persist.deathTop = _dTot ? _dTop : null;
          _persist.deathTopPct = _dTot ? Math.round(_dTopN / _dTot * 100) : null;
        }
        var _wantCause = (cand.config && cand.config.targetDeathCause) || null;
        var _wantMin = (cand.config && cand.config.targetDeathCauseMin != null) ? +cand.config.targetDeathCauseMin : 60;
        if (_wantCause && _dTot > 0) {
          var _share = Math.round((_dc[_wantCause] || 0) / _dTot * 100);
          if (_share < _wantMin) _tf.push('主死因不是' + _wantCause + '（' + _share + '%<' + _wantMin + '%）');
        }
      }
      // 【v374·P2】有限信息前瞻：3 局采样，前 6 个决策点做“候选 + 再贪心一手”回放。
      //   只写 persist.lookahead*，不参与合格；回放代价高，所以只 3 局、只前 6 个决策点。
      try {
        var _laRuns = 3, _laWins = 0, _laProg = 0;
        for (var _lai = 0; _lai < _laRuns; _lai++) {
          var _lar = AntSolver.PlayerSim.run(lv, {
            pickThreshold: 0.6, seed: 401 + _lai * 97, useItems: false, reviveCap: 0,
            bottomOnly: !!(cand.config && cand.config.bottomOnly), instantChain: !!(cand.config && cand.config.instantChain),
            capturePreviewStats: false, lookahead2: true, lookaheadLimit: 6
          });
          if (_lar && _lar.won) _laWins++;
          _laProg += (_lar && _lar.progress != null) ? _lar.progress : 0;
        }
        if (_persist) {
          _persist.lookaheadPassPct = Math.round(_laWins / _laRuns * 100);
          _persist.lookaheadRuns = _laRuns; _persist.lookaheadWins = _laWins;
          _persist.lookaheadProgress = Math.round(_laProg / _laRuns);
        }
      } catch (e) { }
      // 【v371·P1】T/R/U 只读：用刚才这 10 局玩家结果现算；没有玩家结果则写 null。
      //   只写 _persist.quality，不参与 _tf/_qf，不改任何生成决策。
      if (_persist) {
        try { _persist.quality = qualityRollup(_dbgRuns, _fill, lv.totalBoxes); } catch (e) { _persist.quality = null; }
      }
      // 【v366·用户裁决】质量线：首通 >80%、W 中位 <2、W≤1 占 >35%、隐藏信息死亡 >20%
      //   任一不过 → 记进 _tf（goal 模式/早停会继续搜），同时单独记一份 _qf 给报告。
      var _ppMax = (cand.config && cand.config.targetPlayerPassMax != null) ? +cand.config.targetPlayerPassMax : 80;
      var _ppPct = (_persist && _persist.playerPassPct != null) ? _persist.playerPassPct : null;
      if (_ppMax > 0 && _ppPct != null && _ppPct > _ppMax) {
        var _q1 = '首通' + _ppPct + '%>' + _ppMax + '%';
        _qf.push(_q1); _tf.push(_q1 + '（偏松）');
      }
      var _jMax = (cand.config && cand.config.targetHiddenDeathMax != null) ? +cand.config.targetHiddenDeathMax : 20;
      if (_jMax > 0 && _persist && _persist.deathCauses) {
        var _dsum = 0, _dh = 0;
        for (var _ck in _persist.deathCauses) {
          _dsum += _persist.deathCauses[_ck];
          if (_ck === '管道' || _ck === '问号') _dh += _persist.deathCauses[_ck];
        }
        if (_dsum > 0) {
          var _jp = Math.round(_dh / _dsum * 100);
          if (_jp > _jMax) { var _q4 = '隐藏信息死亡' + _jp + '%>' + _jMax + '%'; _qf.push(_q4); _tf.push(_q4); }
        }
      }
    return { pass: _tf.length === 0, fails: _tf, qualityFails: _qf, solved: !!sr.completed,
               steadyWonPct: steady, midLateMax: midLate, midLateAudit: midLateAudit,
               buried: buried, fillCurve: _fill, persist: _persist, targetScore: (function () {
                 var pv = (midLate == null || midLate < _pMin || midLate > _pMax) ? 1 : 0;
                 var sv = (steady == null || steady < _sMin || steady > _sMax) ? 1 : 0;
                 var pd = (midLate == null) ? 9 : Math.abs(midLate - (_pMin + _pMax) / 2);
                 var sd = (steady == null) ? 9 : Math.abs(steady - (_sMin + _sMax) / 2) / 20;
                 return (pv + sv) * 10 + pd + sd;    // 先比"违反几条"，再比距离
               })() };
    }
    var _loose = !!(cand.config && cand.config.acceptMode === 'solvable');
    if (_loose) {
      return { pass: !!sr.completed, fails: sr.completed ? [] : ['可解'],
               solved: !!sr.completed, steadyWonPct: steady, midLateMax: midLate,
               midLateAudit: midLateAudit, buried: buried, noGood: null, loose: true };
    }
    if (steady == null || steady < 50) fails.push('稳健通关<50%');
    if (buried == null || buried !== 0) fails.push('被埋>0');
    if (early == null || early > 2.0) fails.push('前期峰窗>2');
    if (midLate == null || midLate < 3.2 || midLate > 4.8) fails.push('峰窗不在3.2~4.8');
    if (steadyGap == null || steadyGap > 17) fails.push('稳打落后>17');
    // 【v200·用户裁决 B】验收回到原版真实口径：`curveOK`（有卡点 + 前期不出卡点 + 不触死亡边界），
    //   已在上面「峰窗 3.2~4.8 / 前期≤2 / 可解」三条里完整体现，**不再把"硬垫≤3"当硬门**。
    //   硬垫（noGood）保留为**排序/参考指标**（原版就是拿它当 choke v2 的打分键，不是验收线）。
    var _v2 = null, _noGood = null;
    try {
      _v2 = (cand.generationEval && cand.generationEval.auditV2) ? cand.generationEval.auditV2 : chokeV2OfCand(cand);
      _noGood = (_v2 && _v2.worst) ? _v2.worst.noGood : null;
    } catch (e) { _noGood = null; }
    return {
      pass: fails.length === 0, fails: fails,
      steadyWonPct: steady, spreadPct: spread, bestWonPct: bestWon, steadyGap: steadyGap, buried: buried,
      noGood: _noGood, fillCurve: _fill, persist: _persist,
      earlyMax: early, midLateMax: midLate, midLateAudit: midLateAudit,
      peakMin: play ? play.lateMax.min : null,
      peakMax: play ? play.lateMax.max : null,
      peakMean: play ? play.lateMax.mean : null
    };
  }
  function candTier(c) {
    if (!c || !c.valid) return 0;
    var ge = c.generationEval, a = c.audit;
    var deliverable = !!(ge && ge.omni && ge.omni.won && ge.player && ge.player.won && ge.omni.peak < c.level.bufferLimit);
    if (deliverable && a && a.pass) return 3;
    // 【v295·用户裁决】暂时不要简单合格：「现在只生成难的关卡，理解后再生成简单的」。
    //   hardOnly 打开时，flatTrend（简单关·趋势过平）**不再算合格**，也不再享受 tier 2 的排序优待
    //   —— 它直接掉到 tier 1（安全兜底），只在"实在产不出难关"时作为兜底交付，并标 fallback。
    //   关掉 hardOnly 即逐值回到旧行为（简单关仍占简单关名额）。
    var _hardOnly = !!(c.config && c.config.hardOnly);
    if (!_hardOnly && deliverable && a && a.easyPass) return 2;
    var safe = deliverable && (!a || a.safeEdge !== false);
    return safe ? 1 : 0;
  }
  // 候选 b 是否比当前 best a 更优：先比档次(tierOf)，同档再比 candScore(审核+封锁+玩家表现细分)。
  /**
   * 【v153】取「30~80% 区间里的卡点数」（用户 2026-10-16：「只要有卡就行了，
   *   你要保证在 30%-80% 的区域有卡点」）——同档候选的**首选比较键**。
   *   口径与日志里的「被迫点(中段 n)」一致：那一步"能吃满的选项 ≤1 且暂存空位 ≤2"。
   */
  function midChokeOf(c) {
    if (!c) return 0;
    if (c._choiceCurve === undefined) {
      try { c._choiceCurve = (c.level && c.solveResult) ? choiceCurve(AntSolver.parseLevel(c.level), c.solveResult) : null; }
      catch (e) { c._choiceCurve = null; }
    }
    return (c._choiceCurve && c._choiceCurve.forcedMid) ? c._choiceCurve.forcedMid : 0;
  }
  /** 【v182】候选的"被埋辆数"（缓存；未测量时记 0，避免把没量过的候选误判成坏）。 */
  function buriedOfCand(c) {
    var b = c && c.generationEval && c.generationEval.buried;
    return (b && b.buried != null) ? b.buried : 0;
  }
  /** 【v183】候选的"稳健线峰窗"（同一局模拟顺带量出来的）；没量到返回 null。 */
  function pressOfCand(c) {
    var b = c && c.generationEval && c.generationEval.buried;
    return (b && b.lateMax != null) ? b.lateMax : null;
  }
  // 【v379】首通 headroom 档：30~80 最优，20~30/80~90 次之，0~20/90~100 最差。
  //   先于 candTier 比较——否则“首通 100 的困难合格”会一直压住“首通 50 的简单合格”，
  //   P3 陷阱后处理永远没有 headroom。
  function headroomRank(c) {
    var p = (c && c.goodV3 && c.goodV3.persist && c.goodV3.persist.playerPassPct != null)
      ? c.goodV3.persist.playerPassPct : null;
    if (p == null) return 2;
    // 【v460】qGate 要首通≤50；旧 30~80 会把 60~80 的“偏松关”排在 20% 前
    if (p <= 50) return 0;
    if (p <= 65) return 1;
    return 2;
  }

  function candBetter(b, a, cfg) {
    if (a == null) return true;
    var _hrb = headroomRank(b), _hra = headroomRank(a);
    if (_hrb !== _hra) return _hrb < _hra;
    var _pnb = (b && b.goodV3 && b.goodV3.fillCurve && b.goodV3.fillCurve.pressureN) ? b.goodV3.fillCurve.pressureN : 0;
    var _pna = (a && a.goodV3 && a.goodV3.fillCurve && a.goodV3.fillCurve.pressureN) ? a.goodV3.fillCurve.pressureN : 0;
    if ((_pnb > 0) !== (_pna > 0)) return _pnb > 0;
    var tb = candTier(b), ta = candTier(a);
    if (tb !== ta) return tb > ta;
    // 【v182】结构闸门优先：被埋 ≥3 辆的候选（= 稳健玩家必死那种结构）排在后面
    var bb = buriedOfCand(b), ba = buriedOfCand(a);
    if ((bb >= 3) !== (ba >= 3)) return ba >= 3;
    // 【v157】同档第一优先键：卡点判据 v2（用户 R1~R9）
    //   达标 > 未达标；都达标/都不达标时再比 v2 分（独木桥少、预算判断点多、硬垫步数少、高压不早爆）。
    // 【v307·用户裁决】兜底也要"挑覆盖率最高的那个"：
    //   原来 candBetter 完全没有考虑 30~80% 覆盖率（band3Pct），兜底时挑的是"峰窗更高"的，
    //   跟用户设的覆盖率门槛无关。这里加一档：差距 ≥5 个百分点就按覆盖率高的胜。
    var _b3b = (b && b.goodV3 && b.goodV3.persist && b.goodV3.persist.band3Pct != null) ? b.goodV3.persist.band3Pct : -1;
    var _b3a = (a && a.goodV3 && a.goodV3.persist && a.goodV3.persist.band3Pct != null) ? a.goodV3.persist.band3Pct : -1;
    if (Math.abs(_b3b - _b3a) >= 5) return _b3b > _b3a;
    // 【v378】首通分布：优先 30~80% 的候选（差 ≥10pp 才认），让 P3 后处理有 headroom
    var _ppb = (b && b.goodV3 && b.goodV3.persist && b.goodV3.persist.playerPassPct != null) ? b.goodV3.persist.playerPassPct : null;
    var _ppa = (a && a.goodV3 && a.goodV3.persist && a.goodV3.persist.playerPassPct != null) ? a.goodV3.persist.playerPassPct : null;
    if (_ppb != null && _ppa != null) {
      var _inB = (_ppb >= 30 && _ppb <= 80), _inA = (_ppa >= 30 && _ppa <= 80);
      if (_inB !== _inA) return _inB;
      var _db = Math.abs(_ppb - 55), _da = Math.abs(_ppa - 55);
      if (Math.abs(_db - _da) >= 10) return _db < _da;
    }
    var vb = chokeV2Ok(b), va = chokeV2Ok(a);
    if (vb !== va) return vb > va;
    // 【v191·实验】峰窗进带优先：先看"在不在 3.2~4.8 带里"，再看离 4.0 多远。
    //   现行 v183 键是"谁高选谁"，会把峰窗往 5 推——这正是 104/105/110/116 过压的原因。
    if (cfg && cfg.pressBand) {
      var qb2 = pressOfCand(b), qa2 = pressOfCand(a);
      if (qb2 != null && qa2 != null) {
        var inB = (qb2 >= 3.2 && qb2 <= 4.8), inA2 = (qa2 >= 3.2 && qa2 <= 4.8);
        if (inB !== inA2) return inB;
        var db2 = Math.abs(qb2 - 4.0), da2 = Math.abs(qa2 - 4.0);
        if (Math.abs(db2 - da2) >= 0.3) return db2 < da2;
      }
    }
    // 【v183】压力优先键：两条候选都过了上面两关时，优先"稳健玩家也会被顶住"的那个
    //   （用已算好的那一局稳健模拟的卡点区峰窗；差 ≥0.5 才认，避免抖动）。
    var pbP = pressOfCand(b), paP = pressOfCand(a);
    if (pbP != null && paP != null && Math.abs(pbP - paP) >= 0.5) return pbP > paP;
    var sb = chokeV2Score(b), sa = chokeV2Score(a);
    if (sb !== sa) return sb > sa;
    // 旧键保留（v151/v153）：30~80% 里有没有真卡点（有 > 无），再看曲线分/审核分
    var mb = (midChokeOf(b) > 0) ? 1 : 0, ma = (midChokeOf(a) > 0) ? 1 : 0;
    if (mb !== ma) return mb > ma;
    return candScore(b) > candScore(a);
  }
  // requireHard=true 时只认【困难合格】(真实卡点，omniAudit.pass)；简单合格(趋势符合)不算早停条件，继续搜索。
  function candPassLegacy(c, requireHard) {
    if (!c || !c.generationEval || !c.generationEval.pass) return false;
    if (requireHard) return !!(c.audit && c.audit.pass);
    return true;
  }
  /**
   * 【v157】早停条件 = 旧合格门 **且** 卡点判据 v2 达标（用户 R1~R9）。
   *   · 可关掉：config.chokeV2 === false 时逐值回到旧行为（只认旧门）。
   *   · v2 指标缺失（老关卡/异常）时**不拦**——宁可按旧门早停，也不因为量不出指标就把这一关无限搜下去。
   */
  /**
   * 【v257·用户反馈"压力曲线不够"】早停的质量门槛。
   *   原来的早停条件是 goodV3.pass，而 pass 的下界刚好是目标带下界 3.2 ——
   *   峰窗 3.2 的关和 3.9 的关一样"合格"，搜索就停在第一个勉强及格的候选上，
   *   实测最新批次一关只试了 **1 个基础候选、1.75 秒**就收工。
   *   这里要求"真的到带中段"才允许早停：峰窗 ≥ earlyStopPeak（默认 3.5）、稳健 ≤ earlyStopSteady（默认 70）。
   *   不达标就继续搜，最后仍取已评估里最好的那个（不会因此变差）。
   */
  function meetsEarlyStopQuality(cand, config) {
    // 【v376】跑满时间：禁用一切“提前收工”，由 portfolioK 决定轮次
    if (config && config.fullTime) return false;
    var g = cand && cand.goodV3;
    if (!g || !g.pass) return false;
    var p = g.midLateMax;
    var pMin = (config && config.earlyStopPeak != null) ? +config.earlyStopPeak : 3.5;
    var sMax = (config && config.earlyStopSteady != null) ? +config.earlyStopSteady : 70;
    if (p == null || p < pMin) return false;
    if (g.steadyWonPct != null && g.steadyWonPct > sMax) return false;
    // 【v262】还要"持久"：只高不行，得扛得久。两个门槛都可配。
    var geMin = (config && config.earlyStopGe3 != null) ? +config.earlyStopGe3 : 0;
    var lgMin = (config && config.earlyStopLongest != null) ? +config.earlyStopLongest : 0;
    var ps = g.persist;
    if (geMin > 0 || lgMin > 0) {
      if (!ps) return false;
      if (geMin > 0 && (ps.ge3Pct || 0) < geMin) return false;
      if (lgMin > 0 && (ps.longest || 0) < lgMin) return false;
    }
    // 【v264】用户目标：30~80% 区间基本都在 ≥3，且最高不超过 4
    var bMin = (config && config.earlyStopBand3 != null) ? +config.earlyStopBand3 : 0;
    var bpMax = (config && config.earlyStopBandPeak != null) ? +config.earlyStopBandPeak : 0;
    if (bMin > 0 || bpMax > 0) {
      var pp = g.persist;
      if (!pp) return false;
      if (bMin > 0 && (pp.band3Pct == null || pp.band3Pct < bMin)) return false;
      if (bpMax > 0 && (pp.bandPeak || 0) > bpMax) return false;
    }
    // 【v263】全知线至少要有 N 个 5% 窗到达卡点线（默认 2），否则继续搜
    var cwMin = (config && config.earlyStopChokeWin != null) ? +config.earlyStopChokeWin : 0;
    if (cwMin > 0) {
      if (!g.persist || (g.persist.chokeWin || 0) < cwMin) return false;
    }
    return true;
  }

  function candPass(c, requireHard, config) {
    if (!candPassLegacy(c, requireHard)) return false;
    if (config && config.chokeV2 === false) return true;
    var v2 = c.generationEval && c.generationEval.auditV2;
    if (!v2) return true;
    return chokeV2Pass(v2.worst);
  }
  function tagAudit(c) { if (c && !c.audit && c.generationEval) c.audit = c.generationEval.omni.audit; return c; }
  // 通用：取 pickOrder 进度落在 [lo,hi) 的【普通盒】坐标(去重)
  function routeBoxesInRange(board, pickOrder, lo, hi) {
    var out = [], seen = {}, total = (pickOrder || []).length;
    for (var i = 0; i < total; i++) {
      var p = pickOrder[i]; if (!p || p.r == null) continue;
      var prog = total ? i / total : 0; if (prog < lo || prog >= hi) continue;
      var key = p.r + ',' + p.c; if (seen[key]) continue;
      var cell = board.cells[p.r] && board.cells[p.r][p.c];
      if (cell && cell.t === 'box') { seen[key] = 1; out.push({ r: p.r, c: p.c }); }
    }
    return out;
  }
  // ==== 卡点手段(实测精简为 2 种，见 生产器重构日志 P8/P10) ====
  // 目标图【网关色】排名：消掉某色的当前可达区后，新解锁的其他色像素越多=该色越关键(越该被延迟/搬走)。
  //   返回按"新解锁像素数"降序的 [{color, unlock}]。用于指定"能解锁目标图依赖的球"，而非随机撞。
  // 缓存按【入口模式】分开：同一张 blocks 在四边/仅底部两种口径下网关排名不同，
  //   若只以 blocks 作键，先跑过的模式会把结果串给另一模式（一批只用一种模式时不显形，混用时静默出错）。
  var _gatewayCache = (typeof WeakMap !== 'undefined') ? new WeakMap() : null;
  var _gatewayCacheBottom = (typeof WeakMap !== 'undefined') ? new WeakMap() : null;
  function gatewayColorRank(blocks, bottomOnly) {
    if (!blocks || !blocks.length || !blocks[0]) return [];
    bottomOnly = !!bottomOnly;
    var cache = bottomOnly ? _gatewayCacheBottom : _gatewayCache;
    if (cache && cache.has(blocks)) return cache.get(blocks);
    // 维度取【目标图本身】(blocks 是 55×55 目标图，非小棋盘)——此前误传棋盘维度只扫到图左上角，网关识别失效。
    var rows = blocks.length, cols = blocks[0].length;
    var DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    var base = AntSolver.outsideReachSeed(blocks, rows, cols, bottomOnly);
    function reachOther(elim, exclude) {
      var vis = new Uint8Array(rows * cols), st = [], cnt = 0;
      // edgeOpen 是本函数自有的可达判定，必须与入口模式一致：
      //   默认四边任一边界即开口；bottomOnly 只有底边(r=rows-1)开口，上/左/右视作墙。
      //   两种模式都保留"邻接已消除格即开口"。
      function edgeOpen(r, c) { if (bottomOnly) { if (r === rows - 1) return true; } else if (r === 0 || r === rows - 1 || c === 0 || c === cols - 1) return true; if (r > 0 && elim[r - 1][c]) return true; if (r < rows - 1 && elim[r + 1][c]) return true; if (c > 0 && elim[r][c - 1]) return true; if (c < cols - 1 && elim[r][c + 1]) return true; return false; }
      for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
        var id = r * cols + c; if (vis[id] || elim[r][c]) continue; var col = blocks[r][c]; if (col <= 0 || col === exclude) continue; if (!edgeOpen(r, c)) continue; vis[id] = 1; st.push(id);
        while (st.length) { var cur = st.pop(); cnt++; var cr = (cur / cols) | 0, cc = cur % cols; for (var d = 0; d < 4; d++) { var nr = cr + DIRS[d][0], nc = cc + DIRS[d][1]; if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue; var nid = nr * cols + nc; if (vis[nid] || elim[nr][nc] || blocks[nr][nc] !== col) continue; vis[nid] = 1; st.push(nid); } }
      }
      return cnt;
    }
    var colorSet = {}; for (var r0 = 0; r0 < rows; r0++) for (var c0 = 0; c0 < cols; c0++) { var cv = blocks[r0][c0]; if (cv > 0) colorSet[cv] = 1; }
    var rank = [];
    for (var cs in colorSet) {
      var col = +cs, before = reachOther(base, col);
      var elim = []; for (var r1 = 0; r1 < rows; r1++) elim.push(base[r1].slice());
      AntSolver.Simulator.floodFillEliminate(elim, blocks, rows, cols, col, Infinity, null, null, bottomOnly);
      rank.push({ color: col, unlock: reachOther(elim, col) - before });
    }
    rank.sort(function (a, b) { return b.unlock - a.unlock; });
    if (cache) cache.set(blocks, rank);
    return rank;
  }
  // 目标图【内部深度】排名：某色像素当前(仅靠外部连通)就能直接贴到的比例(exposed/total)越低=越深埋在内部，
  //   要等别的颜色先清开才可能摸到。用于把【早期锁链组】定向换成"图内部深色"——该组会因为这个深色成员迟迟
  //   摸不到而一直卡在暂存里，天然形成长期滞留(配合 solver-strategy.js 的锁链滞留周期奖励，求解器会优先设法
  //   促进/绕开它，产生更真实的后期压力)。返回按 ratio 升序(最内部优先) [{color,total,exposed,ratio}]。
  // 缓存同样按【入口模式】分开（理由见 gatewayColorRank 上方注释）。
  var _interiorCache = (typeof WeakMap !== 'undefined') ? new WeakMap() : null;
  var _interiorCacheBottom = (typeof WeakMap !== 'undefined') ? new WeakMap() : null;
  function interiorColorRank(blocks, bottomOnly) {
    if (!blocks || !blocks.length || !blocks[0]) return [];
    bottomOnly = !!bottomOnly;
    var cache = bottomOnly ? _interiorCacheBottom : _interiorCache;
    if (cache && cache.has(blocks)) return cache.get(blocks);
    var rows = blocks.length, cols = blocks[0].length;
    var DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    // 入口模式只体现在这颗种子上：bottomOnly 时初始外部空格只从底边连通区播种，
    //   于是"贴着上/左/右背景"的色块不再被算作已暴露，深埋比例自然按底部玩法重算。
    var base = AntSolver.outsideReachSeed(blocks, rows, cols, bottomOnly);
    var totalMap = {}, exposedMap = {};
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
      var col = blocks[r][c]; if (col <= 0) continue;
      totalMap[col] = (totalMap[col] || 0) + 1;
      // 注：此处只看"邻接初始外部空格"，不把图边界本身算开口——这是本启发既有的宽松口径
      //   （它只用于卡点换球的目标挑选排序，不是可解性判定），两种模式沿用同一形状不做改动。
      var open = false;
      for (var d = 0; d < 4; d++) { var nr = r + DIRS[d][0], nc = c + DIRS[d][1]; if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue; if (base[nr][nc]) { open = true; break; } }
      if (open) exposedMap[col] = (exposedMap[col] || 0) + 1;
    }
    var rank = [];
    for (var k in totalMap) { var tt = totalMap[k], ex = exposedMap[k] || 0; rank.push({ color: +k, total: tt, exposed: ex, ratio: ex / tt }); }
    rank.sort(function (a, b) { return a.ratio - b.ratio; });   // 升序：ratio 越小越深埋
    if (cache) cache.set(blocks, rank);
    return rank;
  }
  // 锁链定向换球：把【前期段】锁链组(取一个代表成员即可，组内其余成员保持原样)的颜色量，
  //   与【当前持有图内部深色】的某个无障碍普通盒互换(色+量守恒)。换后该锁链组要等图内部深色区域
  //   被其他消除动作打开才摸得到 → 组内其他成员早消完也没用，整组长期滞留暂存，是"结构性"的卡点
  //   (不像换球/增容那样只是位置远/容量大，是真的要等依赖顺序满足)。一次最多处理 chainSwapCount 组。
  function chokeChainColorSwap(board, pickOrder, config, blocks, usedT) {
    if (!blocks) return 0;
    var cells = board.cells, rows = board.rows, cols = board.cols;
    var startFrac = (config.swapRegionMin != null ? config.swapRegionMin : 50) / 100;
    var early = routeBoxesInRange(board, pickOrder, 0, startFrac);
    // 前期段里的锁链组：按 chain 分组号去重，每组取一个代表成员
    var groupRep = {}, order = [];
    for (var i = 0; i < early.length; i++) {
      var p = early[i], cell = cells[p.r] && cells[p.r][p.c];
      if (!cell || cell.t !== 'box' || !(cell.chain > 0)) continue;
      if (groupRep[cell.chain]) continue;
      groupRep[cell.chain] = { r: p.r, c: p.c, box: cell }; order.push(cell.chain);
    }
    if (!order.length) return 0;
    var interior = interiorColorRank(blocks, config && config.bottomOnly);
    if (!interior.length) return 0;
    // 深色候选池：按内部深度升序取前若干种颜色，收集当前持有这些颜色的无障碍普通盒
    var deepColors = {}; for (var g = 0; g < Math.min(5, interior.length); g++) deepColors[interior[g].color] = interior[g].ratio;
    var pool = [];
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
      var e = cells[r][c];
      if (e && e.t === 'box' && e.chain === 0 && !e.q && deepColors.hasOwnProperty(e.color)) pool.push({ r: r, c: c, box: e, ratio: deepColors[e.color] });
    }
    if (!pool.length) return 0;
    pool.sort(function (a, b) { return a.ratio - b.ratio; });   // 越深埋优先作为换入目标
    var quota = config.chainSwapCount != null ? config.chainSwapCount : 4;
    var did = 0;
    for (var k = 0; k < order.length && did < quota; k++) {
      var rep = groupRep[order[k]];
      var target = null;
      for (var pi = 0; pi < pool.length; pi++) {
        var tk = pool[pi].r + ',' + pool[pi].c;
        if (usedT[tk] || pool[pi].box === rep.box || pool[pi].box.color === rep.box.color) continue;
        target = pool[pi]; break;
      }
      if (!target) continue;
      var tb = target.box, tc = rep.box.color, tn = rep.box.count;
      rep.box.color = tb.color; rep.box.count = tb.count;
      tb.color = tc; tb.count = tn;
      usedT[target.r + ',' + target.c] = 1;
      did++;
    }
    return did;
  }
  // 卡点A · 换球/搬盒(定向·大跨度·多次)：把【能解锁目标图依赖的关键色盒】搬到离原位最远处(后期棋盘格或管道最深层)；
  //   并优先对【前期锁链组】做定向深色换入(chokeChainColorSwap，见上)——两种手段共享同一个"已用落点"去重集合。
  //   跨度=换后棋盘位置与原位曼哈顿距离；藏管道则 = 到管道距离 + 队列深度。守恒(仅换色量)。一次做多处(最多3)。
  //   (吸收原 D 锁链换球、E 关键色分散/藏管道)。
  /**
   * 稀有色落位（卡点类型 rareColorKey，用户 2026-08-24 q1）。
   *
   * 原理：「稀有」= 该色像素总量占比小（rareColorRank）。稀有色被卡住时可替代方案最少——
   *   常见色到处都有、堵一处无所谓；稀有色只有那么几片，一旦它的盒卡在关键位，
   *   玩家就只能等那个位置打开，没有别的路可走。
   *
   * 关键位（三类，按优先级）：
   *   ① 窄路缺口盒（narrowGap 组的锁链成员 / 缺口数字冰位）—— 必经之路
   *   ② 锁链端（任意锁链组成员）—— 要等整组齐活
   *   ③ 管道口（管道出口格的盒）—— 吐球节奏被它决定
   *
   * 做法：把关键位现有盒的颜色/容量 与 当前持有稀有色的普通盒 **对换**（色与量成对交换，总量守恒）。
   *   只换 color/count，不动 numice/chain/q/管道结构 —— 与 chokeSwap/chokeInflate 同一约束。
   *
   * @returns {number} 实际完成的对换次数
   */
  function chokeRareColorKeyPlace(board, config, blocks, usedT) {
    if (!blocks || !board) return 0;
    var plan = config && config._chokePlan;
    if (!(plan && plan.has && plan.has.rareColorKey)) return 0;   // 未抽中该类型 → 不执行
    var cells = board.cells, rows = board.rows, cols = board.cols;
    var rare = rareColorRank(blocks);
    if (rare.length < 2) return 0;
    // 取最稀有的前若干色（默认 3，可配）
    var topN = config.rareColorTopN != null ? config.rareColorTopN : 3;
    var rareSet = {};
    for (var i = 0; i < Math.min(topN, rare.length); i++) rareSet[rare[i].color] = rare[i].rank;

    // —— 收集关键位（三类，带优先级）——
    var keySlots = [];
    function isPlain(c) { return c && c.t === 'box'; }
    // ① 窄路缺口盒 / ② 锁链端：锁链组号 90+ 为窄路缺口来源，80~89 为管道口来源（见 planObstacleSlotsFixed）
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
      var cell = cells[r][c];
    // 【v120 用户 q2-9】目标位类型可配：`rareColorTargets`（逗号分隔，取 narrowGap / pipeExit / chainEnd）。
    //   默认三者全开 = 与 v104~v119 行为一致；只填其中一项即可把稀有色专门顶到那类位置上。
    var tgtRaw = (config.rareColorTargets != null ? String(config.rareColorTargets) : 'narrowGap,pipeExit,chainEnd');
    var wantTgt = {};
    tgtRaw.split(',').forEach(function (s) { s = s.trim(); if (s) wantTgt[s] = 1; });
    if (!wantTgt.narrowGap && !wantTgt.pipeExit && !wantTgt.chainEnd) { wantTgt = { narrowGap: 1, pipeExit: 1, chainEnd: 1 }; }
      if (!isPlain(cell)) continue;
      if (cell.chain > 0) {
        // 锁链组号高位段：90+ 来自窄路缺口、80~89 来自管道口、其余是普通锁链端
        var kind = cell.chain >= 90 ? 'narrowGap' : (cell.chain >= 80 ? 'pipeExit' : 'chainEnd');
        if (!wantTgt[kind]) continue;
        var pri = kind === 'narrowGap' ? 1 : (kind === 'pipeExit' ? 2 : 3);   // 窄路缺口 > 管道口 > 普通锁链
        keySlots.push({ r: r, c: c, box: cell, pri: pri, kind: kind });
      }
    }
    // ③ 管道出口格的盒
    if (wantTgt.pipeExit) {
      for (var pr = 0; pr < rows; pr++) for (var pc = 0; pc < cols; pc++) {
        var pcell = cells[pr][pc];
        if (!pcell || pcell.t !== 'pipe') continue;
        var dv = AntSolver.PIPE_DIRS[pcell.dir] || [1, 0];
        var er = pr + dv[0], ec = pc + dv[1];
        if (er < 0 || er >= rows || ec < 0 || ec >= cols) continue;
        var ecell = cells[er][ec];
        if (isPlain(ecell)) keySlots.push({ r: er, c: ec, box: ecell, pri: 2, kind: 'pipeExit' });
      }
    }
    if (!keySlots.length) return 0;
    keySlots.sort(function (a, b) { return a.pri - b.pri; });

    // —— 当前持有稀有色的普通盒（无障碍，可安全换出）——
    var donors = [];
    for (var r2 = 0; r2 < rows; r2++) for (var c2 = 0; c2 < cols; c2++) {
      var d = cells[r2][c2];
      // 【落位⑥ 与稀有色位置组合】共位开启时允许稀有色换到锁链格上；缺省仍避开锁链。
      if (d && d.t === 'box' && (chainComboOn(config, 'rareColor') || d.chain === 0) && !d.q && rareSet[d.color]) {
        donors.push({ r: r2, c: c2, box: d, rank: rareSet[d.color] });
      }
    }
    if (!donors.length) return 0;
    donors.sort(function (a, b) { return a.rank - b.rank; });   // 越稀有越优先换入

    var quota = config.rareColorSwapCount != null ? config.rareColorSwapCount : 3;
    var did = 0, di = 0;
    for (var ki = 0; ki < keySlots.length && did < quota && di < donors.length; ki++) {
      var slot = keySlots[ki], tk = slot.r + ',' + slot.c;
      if (usedT && usedT[tk]) continue;                      // 该位已被别的换球手段占用
      if (rareSet[slot.box.color]) continue;                 // 已经是稀有色，无需换
      var donor = null;
      while (di < donors.length) {
        var cand = donors[di++];
        if (cand.r === slot.r && cand.c === slot.c) continue;
        var dk = cand.r + ',' + cand.c;
        if (usedT && usedT[dk]) continue;
        donor = cand; break;
      }
      if (!donor) break;
      // 成对交换 color+count → 分色总量与总盒数均守恒
      var sc = slot.box.color, sn = slot.box.count;
      slot.box.color = donor.box.color; slot.box.count = donor.box.count;
      donor.box.color = sc; donor.box.count = sn;
      if (usedT) { usedT[tk] = 1; usedT[donor.r + ',' + donor.c] = 1; }
      did++;
    }
    return did;
  }

  function chokeSwap(board, pickOrder, config, lateTargets, blocks) {
    var cells = board.cells, rows = board.rows, cols = board.cols;
    var startFrac = (config.swapRegionMin != null ? config.swapRegionMin : 50) / 100;
    var early = routeBoxesInRange(board, pickOrder, 0, startFrac);
    var late = (lateTargets && lateTargets.length) ? lateTargets : routeBoxesInRange(board, pickOrder, startFrac, 1.01);
    // 【落位④ 与换球位置组合】共位开启时允许换球落在锁链格上；缺省仍避开锁链。
    var comboSwap = chainComboOn(config, 'swap');
    function plainAt(p) {
      var c = cells[p.r] && cells[p.r][p.c];
      if (!c || c.t !== 'box' || c.q) return null;
      if (!comboSwap && c.chain !== 0) return null;
      return c;
    }
    function span(r1, c1, r2, c2) { return Math.abs(r1 - r2) + Math.abs(c1 - c2); }
    var usedT = {};
    // 0) 锁链定向换球(优先)：前期锁链组代表成员 ↔ 图内部深色现持有盒
    var chainSwapped = chokeChainColorSwap(board, pickOrder, config, blocks, usedT);
    // 0b) 稀有色落位（用户 2026-08-24 q1：「实现稀有色落位，在初次换球时执行」）。
    //   放在这里=首次换球阶段，与锁链定向换球并列，先于网关色/后期段扰动。
    //   仅当抽中卡点类型 rareColorKey 时生效；未抽中则完全不执行，行为与本功能引入前一致。
    var rareSwapped = chokeRareColorKeyPlace(board, config, blocks, usedT);
    // 1) 网关色 → 关键盒(优先前期段属网关色的无障碍盒；不足则全盘找；再不足退回前期大盒 keystone)
    var rank = blocks ? gatewayColorRank(blocks, config && config.bottomOnly) : [];
    var keyColor = {}; for (var g = 0; g < Math.min(4, rank.length); g++) if (rank[g].unlock > 0) keyColor[rank[g].color] = 1;
    var keyBoxes = [], seenKey = {};
    function pushKey(r, c, b) { var k = r + ',' + c; if (seenKey[k]) return; seenKey[k] = 1; keyBoxes.push({ r: r, c: c, box: b }); }
    // 1) 前期段网关色盒(最优先)
    for (var i = 0; i < early.length; i++) { var b = plainAt(early[i]); if (b && keyColor[b.color]) pushKey(early[i].r, early[i].c, b); }
    // 2) 全盘网关色盒
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) { var e = cells[r][c]; if (e && e.t === 'box' && e.chain === 0 && !e.q && keyColor[e.color]) pushKey(r, c, e); }
    // 3) 补足：其余前期无障碍盒(按 count 降序)，使换球池足够多以支撑更大换球量
    var es = []; for (var i2 = 0; i2 < early.length; i2++) { var b2 = plainAt(early[i2]); if (b2 && !seenKey[early[i2].r + ',' + early[i2].c]) es.push({ r: early[i2].r, c: early[i2].c, box: b2 }); }
    es.sort(function (a, b) { return b.box.count - a.box.count; });
    for (var e3 = 0; e3 < es.length; e3++) pushKey(es[e3].r, es[e3].c, es[e3].box);
    if (!keyBoxes.length) return false;
    // 2) 落点候选(取最大跨度)：后期无障碍盒 / 管道最深层
    var latePos = []; for (var j = 0; j < late.length; j++) { var lb = plainAt(late[j]); if (lb) latePos.push({ r: late[j].r, c: late[j].c, box: lb }); }
    var pipes = []; for (var r3 = 0; r3 < rows; r3++) for (var c3 = 0; c3 < cols; c3++) { var pc = cells[r3][c3]; if (pc && pc.t === 'pipe' && pc.queue) pipes.push({ r: r3, c: c3, pipe: pc }); }
    var did = 0;   // 累计换球数量(不含 chainSwapped，最终以 did+chainSwapped>0 判定是否生效)
    var maxSwaps = config.chokeSwapCount || 12;   // 换球数量(可调，越多卡点越强)
    for (var k = 0; k < Math.min(keyBoxes.length, maxSwaps); k++) {
      var key = keyBoxes[k], best = -1, act = null;
      for (var li = 0; li < latePos.length; li++) { var tk = latePos[li].r + ',' + latePos[li].c; if (usedT[tk] || latePos[li].box === key.box) continue; var d = span(key.r, key.c, latePos[li].r, latePos[li].c); if (d > best) { best = d; act = { t: 'box', o: latePos[li] }; } }
      for (var pi = 0; pi < pipes.length; pi++) { if (!pipes[pi].pipe.queue.length) continue; var d2 = span(key.r, key.c, pipes[pi].r, pipes[pi].c) + pipes[pi].pipe.queue.length; if (d2 > best) { best = d2; act = { t: 'pipe', o: pipes[pi] }; } }
      if (!act) continue;
      if (act.t === 'box') { var tb = act.o.box, tc = key.box.color, tn = key.box.count; key.box.color = tb.color; key.box.count = tb.count; tb.color = tc; tb.count = tn; usedT[act.o.r + ',' + act.o.c] = 1; did++; }
      else { var q = act.o.pipe.queue[act.o.pipe.queue.length - 1], a1 = key.box.color, a2 = key.box.count; key.box.color = q.color; key.box.count = q.count; q.color = a1; q.count = a2; did++; }   // 与最深队列项互换=藏最深
    }
    return (did + chainSwapped) > 0;
  }
  // 卡点B · 增加容量：把某色容量向一个【后期盒(sink)】集中(抬到 ~1.5~2× boxSizeMax)，同色他盒(donor)降到 min。
  //   守恒(该色总量不变)；大盒取时难一次消完 → 滞留暂存 → 抬后期压力。
  /**
   * 超大盒（卡点类型 `bigBox`）。
   * 【v120 用户 q2-8】容量改用**绝对区间** `bigBoxCapMin/Max`（原为 `× boxSizeMax` 的倍率），
   * 且**选盒优先「总像素最少的颜色」** —— 稀有色本来就难凑，把它做成超大盒才真正卡人；
   * 原实现是在候选里随机挑 sink，常常挑到大宗色，做成超大盒也不难。
   * 倍率参数保留为回退口径：`bigBoxCap*` 显式置 null 时仍按倍率算，供复现旧批次。
   * @param {object} blocks 目标图（用于按总像素排色；缺省则退回随机挑）
   */
  function chokeInflate(board, targets, config, blocks) {
    var cells = board.cells, rows = board.rows, cols = board.cols, min = config.boxSizeMin || 2, max = config.boxSizeMax || 52;
    var target;
    if (config.bigBoxCapMin != null && config.bigBoxCapMax != null) {
      var cLo = parseInt(config.bigBoxCapMin, 10), cHi = parseInt(config.bigBoxCapMax, 10);
      if (cHi < cLo) cHi = cLo;
      target = cLo + ((rnd() * (cHi - cLo + 1)) | 0);
    } else {
      var lo = config.bigBoxMulMin != null ? config.bigBoxMulMin : 1.5;
      var hi = config.bigBoxMulMax != null ? config.bigBoxMulMax : 2.0;
      if (hi < lo) hi = lo;
      target = Math.round(max * (lo + rnd() * (hi - lo)));
    }
    var sinks = [];
    // 【落位⑤ 与大容量球位置组合】共位开启时允许（并优先）选锁链格；缺省仍避开锁链。
    var comboBig = chainComboOn(config, 'bigBox');
    for (var i = 0; i < targets.length; i++) {
      var t = targets[i], c0 = cells[t.r] && cells[t.r][t.c];
      if (!c0 || c0.t !== 'box' || c0.q) continue;
      if (!comboBig && c0.chain !== 0) continue;      // 缺省口径：避开锁链
      sinks.push(c0);
    }
    if (comboBig) sinks = preferChainCells(sinks);     // 锁链格排前面，优先被选为巨盒
    if (!sinks.length) return false;
    // 【v120】优先选「总像素最少的颜色」的盒作为 sink
    var sink = null;
    if (blocks) {
      var rank = rareColorRank(blocks);       // 已按总像素升序（最稀有在前）
      var order = {};
      for (var ri = 0; ri < rank.length; ri++) order[rank[ri].color] = ri;
      var best = 1e9;
      for (var si = 0; si < sinks.length; si++) {
        var o = order[sinks[si].color];
        if (o == null) o = 999;
        if (o < best) { best = o; sink = sinks[si]; }
      }
    }
    if (!sink) sink = sinks[(rnd() * sinks.length) | 0];
    var donors = [];
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) { var e = cells[r][c]; if (e && e.t === 'box' && e !== sink && e.color === sink.color && e.chain === 0) donors.push(e); }
    if (!donors.length) return false;
    var moved = false;
    for (var j = 0; j < donors.length && sink.count < target; j++) { var d = donors[j], take = Math.min(d.count - min, target - sink.count); if (take > 0) { d.count -= take; sink.count += take; moved = true; } }
    if (moved) { board._chokeBigBox = { target: target, color: sink.color, count: sink.count }; }
    return moved;
  }

  /**
   * 增容（卡点类型 `inflate`）。
   * 【v120 用户 q2-11】「随机增加 N 盒的 M 容量」→ 参数 `inflateBoxCount`(N) / `inflateAmount`(M)。
   * 与 `bigBox` 的区别：bigBox 是把**一个**盒堆到很大（并从同色盒抽走），
   * 本项是给**N 个**盒各加 M 容量（同色守恒同样从同色盒抽），形态是「多处小幅加压」而不是「单点巨盒」。
   */
  function chokeInflateSpread(board, targets, config) {
    var cells = board.cells, rows = board.rows, cols = board.cols, min = config.boxSizeMin || 2;
    var N = config.inflateBoxCount != null ? Math.max(1, parseInt(config.inflateBoxCount, 10)) : 2;
    var M = config.inflateAmount != null ? Math.max(1, parseInt(config.inflateAmount, 10)) : 15;
    var pool = [];
    for (var i = 0; i < targets.length; i++) {
      var t = targets[i], c0 = cells[t.r] && cells[t.r][t.c];
      if (c0 && c0.t === 'box' && c0.chain === 0 && !c0.q) pool.push(c0);
    }
    if (!pool.length) return false;
    pool = shuffle(pool);
    var movedAny = false, done = 0;
    for (var p = 0; p < pool.length && done < N; p++) {
      var sink = pool[p], donors = [];
      for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
        var e = cells[r][c];
        if (e && e.t === 'box' && e !== sink && e.color === sink.color && e.chain === 0) donors.push(e);
      }
      if (!donors.length) continue;
      var want = sink.count + M, moved = false;
      for (var j = 0; j < donors.length && sink.count < want; j++) {
        var d = donors[j], take = Math.min(d.count - min, want - sink.count);
        if (take > 0) { d.count -= take; sink.count += take; moved = true; }
      }
      if (moved) { movedAny = true; done++; }
    }
    if (movedAny) board._chokeInflate = { boxes: done, amount: M };
    return movedAny;
  }

  /**
   * 【锁链落位组合】本关是否要求某手段与锁链**同格**（用户 2026-09-02 的落位 ④⑤⑥）。
   * 缺省 null → 一律 false，三个手段照旧用 `chain === 0` 避开锁链，行为逐值不变。
   */
  function chainComboOn(config, kind) {
    return !!(config && config.chainComboWith === kind);
  }
  /** 把候选池按「是否锁链格」排序：锁链格优先。共位开启时用它选目标。 */
  function preferChainCells(list, getCell) {
    var onChain = [], off = [];
    for (var i = 0; i < list.length; i++) {
      var c = getCell ? getCell(list[i]) : list[i];
      if (c && c.chain > 0) onChain.push(list[i]); else off.push(list[i]);
    }
    return onChain.concat(off);
  }

  // 卡点分派：按本关抽中的类型决定用哪个手段；未启用类型化时沿用原来的 60/40 随机分派。
  // 【v120】`bigBox` 与 `inflate` 现在是两个不同手段（前者单点巨盒、后者 N 盒各加 M），
  //   而 v103~v119 里 `inflate` 只是 `bigBox` 的别名 —— 两个类型抽中后行为完全一样，池里等于有重复项。
  function applyOneChoke(board, targets, config, pickOrder, blocks) {
    var CK = (config && config._chokePlan && config._chokePlan.has) || {};
    if (chokeTypingActive(config)) {
      var opts = [];
      if (CK.swap) opts.push('swap');
      if (CK.bigBox) opts.push('bigBox');
      if (CK.inflate) opts.push('inflate');
      if (opts.length) {
        var pick = opts[(rnd() * opts.length) | 0];
        if (pick === 'swap') return chokeSwap(board, pickOrder, config, targets, blocks);
        if (pick === 'bigBox') return chokeInflate(board, targets, config, blocks);
        return chokeInflateSpread(board, targets, config);
      }
      // 抽中的全是结构类（narrowPath/簇/叠加等）→ post 阶段不额外制造，避免"没抽中却照做"
      return false;
    }
    if (rnd() < 0.6) return chokeSwap(board, pickOrder, config, targets, blocks);
    return chokeInflate(board, targets, config, blocks);
  }
  // 从父变体派生一个卡点变体：round≥2 少数分支用【增减压重生成】(据父审核诊断调障碍参数)；
  //   其余为【卡点制造】(clone 父 board + 后期段扰动)；重解+结构校验通过才返回，破坏可解则丢弃(null)。
  function makeChokeVariant(parent, blocks, config, round) {
    if (round >= 2 && parent.audit && rnd() < 0.3) {
      var pa = applyPressureAdjust(config, parent.audit, parent.level.bufferLimit, ensureCurve(parent));
      GENPERF.regenVariants++;                     // 埋点：走"压力调整重新建盘"的变体数
      var regen = generateFromBlocks(blocks, Object.assign({}, pa.cfg, { maxRetries: 2, candidateCount: 1 }));
      return regen.valid ? tagAudit(regen) : null;
    }
    var pb = parent.level.board;
    var level = { blocks: parent.level.blocks, bufferLimit: parent.level.bufferLimit, board: { rows: pb.rows, cols: pb.cols, cells: AntSolver.deepClone(pb.cells) } };
    var startFrac = (config.swapRegionMin != null ? config.swapRegionMin : 50) / 100;
    var targets = lateRouteBoxes(level.board, (parent.solveResult && parent.solveResult.pickOrder) || [], startFrac);
    if (!targets.length) return null;
    var pickOrder = (parent.solveResult && parent.solveResult.pickOrder) || [];
    if (!applyOneChoke(level.board, targets, config, pickOrder, level.blocks)) return null;
    if (round >= 2) applyOneChoke(level.board, targets, config, pickOrder, level.blocks);   // 后续轮更强：再叠一次卡点
    if (!structuralDeadlockCheck(level.board).ok) return null;
    var parsed = AntSolver.parseLevel(level);
    // 旧流程同样对齐入口模式与消除口径（用户 2026-07-29 决定 D2：旧流程一并改，不做拒绝）。
    var r = AntSolver.Solver.solve(parsed, { capturePreviewStats: true, bottomOnly: !!config.bottomOnly, instantChain: !!config.instantChain });
    if (!r.completed) return null;                                  // 破坏可解 → 丢弃该分支
    var ge = evaluateGeneration(r, parsed, config);
    return { level: level, valid: true, solveResult: r, generationEval: ge, audit: ge.omni.audit, difficulty: computeDifficulty(r, parsed, config, ge), config: config };
  }
  // 收尾：设 audit.pass/playerWon/generationScore + 玩家失败/触上限原因 + 兜底标记，返回 produce 形状
  //
  // 【兜底标记】(v86 新增，需求见 codex助理 v84审查文档 §5)：区分"正常合格输出"与"兜底交付的关卡"，
  //   避免兜底关卡被误当合格关处理。判定只看候选的【三档档次】(candTier，与排序逻辑同一套口径)：
  //   档3/2(困难合格/简单合格) → fallback=false，正常输出。
  //   档1/0(安全兜底/其余)     → fallback=true，并按当时是否超时分 fallbackType：
  //     'timeout'   ：produce() 的单关时间预算(timeBudgetMs)到点、搜索被迫中止时选中的（cand.timedOut=true）。
  //     'exhausted' ：预算内已把候选数×分支×轮数全部遍历完，仍未找到合格候选，只能选最接近的一个。
  //   fallbackTier = candTier(cand) 的原始档次值(0或1)；fallbackReason = 供人读的一句话说明。
  /**
   * 死亡边界救援兜底（用户 2026-08-04 指定）。
   *
   * 触发条件：最终候选的【玩家版暂存峰值触达上限】——现行审核把这种关判为死亡边界、直接不合格。
   * 救援动作：不重新生成整关（保留已通过筛选的关卡结构），只在原关卡上做一轮【障碍缩减】：
   *   第 1 轮 拆 1 格数字冰 + 解除 1 组锁链；第 2 轮 拆 2 格数字冰 + 解除 1 组锁链。
   *   （拆数字冰 = 把该盒 numice 数值置 0；解除锁链 = 把该组所有成员的 chain 组号置 0，优先拆成员最少的组，代价最小。）
   * 采用条件：救援后必须【全知仍通关 + 玩家仍通关 + 峰值降到上限以下】三者同时成立，否则放弃该轮。
   *   两轮都救不回来就保留原关卡、按原结论走（不掩盖不合格）。
   *
   * 默认关闭（deathEdgeRescue: false），只有显式开启才生效，
   * 因此原四方向与底部消除两种模式的产出不受影响。
   */
  function rescueDeathEdge(cand) {
    var cfg = cand && cand.config, lv = cand && cand.level, ge = cand && cand.generationEval;
    if (!cfg || !cfg.deathEdgeRescue) return null;
    if (!lv || !ge || !ge.player) return null;
    var limit = lv.bufferLimit;
    if (!(ge.player.peak >= limit)) return null;          // 没触死亡边界 → 不需要救援
    var iceCut = (cfg.deathEdgeRescueIceCut != null) ? cfg.deathEdgeRescueIceCut : 2;
    var chainCut = (cfg.deathEdgeRescueChainCut != null) ? cfg.deathEdgeRescueChainCut : 1;
    var log = [];
    for (var attempt = 1; attempt <= 2; attempt++) {
      var nIce = (attempt === 1) ? Math.min(1, iceCut) : iceCut;   // 第1轮拆1个，第2轮拆到上限(默认2)
      var trial = JSON.parse(JSON.stringify(lv));
      var cells = trial.board.cells, rows = trial.board.rows, cols = trial.board.cols;
      // ① 拆数字冰：数值大的先拆（对可达性阻塞最重）
      var iced = [];
      for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
        var cl = cells[r] && cells[r][c];
        if (cl && cl.t === 'box' && cl.numice > 0) iced.push({ r: r, c: c, ice: cl.numice });   // 数值高的先拆
      }
      iced.sort(function (a, b) { return b.ice - a.ice; });
      var cutIce = 0;
      for (var i = 0; i < iced.length && cutIce < nIce; i++) { cells[iced[i].r][iced[i].c].numice = 0; cutIce++; }
      // ② 解除锁链组：成员最少的组优先（拆掉它对关卡结构改动最小）
      var groups = {};
      for (var r2 = 0; r2 < rows; r2++) for (var c2 = 0; c2 < cols; c2++) {
        var cl2 = cells[r2] && cells[r2][c2];
        if (cl2 && cl2.t === 'box' && cl2.chain > 0) (groups[cl2.chain] = groups[cl2.chain] || []).push({ r: r2, c: c2 });
      }
      var gKeys = Object.keys(groups).sort(function (a, b) { return groups[a].length - groups[b].length; });
      var cutChain = 0;
      for (var gi = 0; gi < gKeys.length && cutChain < chainCut; gi++) {
        groups[gKeys[gi]].forEach(function (p) { cells[p.r][p.c].chain = 0; });
        cutChain++;
      }
      if (cutIce === 0 && cutChain === 0) { log.push('第' + attempt + '轮：无数字冰也无锁链可拆，放弃'); break; }
      // ③ 重跑全知 + 评估（必须与本关同一模式口径）
      var parsed2 = AntSolver.parseLevel(trial);
      var r2res = AntSolver.Solver.solve(parsed2, {
        capturePreviewStats: true, bottomOnly: !!cfg.bottomOnly, instantChain: !!cfg.instantChain
      });
      if (!r2res.completed) { log.push('第' + attempt + '轮(拆数字冰' + cutIce + '+链' + cutChain + ')：全知不再通关，放弃'); continue; }
      var ge2 = evaluateGeneration(r2res, parsed2, cfg);
      var newPeak = ge2.player ? ge2.player.peak : 999;
      var newWon = !!(ge2.player && ge2.player.won);
      if (newPeak < limit && newWon) {
        log.push('第' + attempt + '轮(拆数字冰' + cutIce + '+链' + cutChain + ')：救援成功，峰值 ' + ge.player.peak + '→' + newPeak);
        var before = { peak: ge.player.peak, playerWon: !!ge.player.won, tier: cand.audit && cand.audit.tier };
        cand.level = trial;
        cand.solveResult = r2res;
        cand.generationEval = ge2;
        cand.audit = ge2.omni.audit;
        cand.difficulty = computeDifficulty(r2res, parsed2, cfg, ge2);
        cand.rescue = { applied: true, attempt: attempt, iceCut: cutIce, chainCut: cutChain, before: before, afterPeak: newPeak, log: log };
        return cand.rescue;
      }
      log.push('第' + attempt + '轮(拆数字冰' + cutIce + '+链' + cutChain + ')：峰值 ' + newPeak + '、玩家通关' + (newWon ? '是' : '否') + '，未达成救援条件');
    }
    cand.rescue = { applied: false, log: log };
    return cand.rescue;
  }

  /**
   * 【v240·用户裁决】第 0 行【不】禁功能块 —— "有功能块反而能提高难度"。
   *   这里只保留一条底线：整行都被冰/链锁死时（第 0 步没有任何合法操作 = 必死候选），
   *   解冻冰最少的那一辆，让开局有得点。其余情况一律不动：
   *   第 0 行的冰/链现在是被允许的难度来源，不再被摘掉。
   */
  /**
   * 【v252】第 0 行的冰最多留 N 块（默认 1）。
   *   结构层的冰候选已经按 row0IceMax 限过一次，但**阀门（valvePlan 'largest'）是在铺盘之后**
   *   又给浅层车补冰的 —— 它不受那个限制，实测会再多 1 块。这里在最终出口统一封顶。
   */
  function capRow0Ice(level, maxN) {
    var board = level && level.board;
    if (!board || !board.cells || !board.cells.length) return 0;
    var max = (maxN != null) ? Math.max(0, parseInt(maxN, 10) || 0) : 1;
    var cells = board.cells, cols = board.cols, got = [], removed = 0;
    for (var c = 0; c < cols; c++) {
      var x = cells[0][c];
      if (x && x.t === 'box' && x.numice > 0) got.push({ c: c, cell: x });
    }
    if (got.length <= max) return 0;
    // 保留冰值最小的（最容易被解开的那几块），把其余摘掉
    got.sort(function (a, b) { return (a.cell.numice || 0) - (b.cell.numice || 0); });
    for (var i = max; i < got.length; i++) { got[i].cell.numice = 0; removed++; }
    return removed;
  }

  /**
   * 【v253·用户裁决】冰不是随机撒的减速带，是**控制取车顺序的闸门**。
   *   原理：一辆车开局就能装满 → 玩家一定先拿它（最省事）。把它冻住若干步，
   *   玩家就被迫去拿"填不满"的车 → 背债 → 这才是压力。
   *   而冻一辆"本来就要等到 80% 才可吃"的车毫无意义（玩家根本不会碰），这就是随机撒的浪费。
   *
   *   选车规则（基于已铺好的棋盘 + 目标日程）：
   *     ① 只冻"开局就够吃"的车：该色开局暴露量 ≥ 该车容量（demandCurve.startExposed）
   *     ② 按摆位序（v239 后 = 需求序）从早到晚取前 N 辆（默认 3）
   *     ③ 冰值 = 该车摆位序 + delay + 1 → 它要等"玩家走到它之后再过两步"才化，
   *        既不是开局免费车，也不会一直冻着变废格
   */
  /**
   * 【v296】冰值（numice）计算：**相对步长**，上限跟关卡长度走。
   *
   * 为什么改：原来 sync / multi 两条路都是 `clamp(..., 2, 12)`，而一关只有 30~45 步。
   *   实测（工作日志 220 节）这张 36 车、55 车的图上：
   *     同步模式 gap×总车数 只要 gap ≥ 0.33 就超过 12 → 几乎所有车都被截成 12；
   *     多点模式 (F−1)+2 在 25%~65% 各点算出来是 24/30/35/35/36 → 也全被截成 12。
   *   结果冰的数字在关卡里**千篇一律是 12**，等于"统一锁死 1/3 流程"的难度值，
   *   与用户第 206 节定的语义（"冰是时差，不是难度值"）相反。
   *
   * 新口径：
   *   cap  = ceil(总车数 × capRatio)，夹在 [3, 12]  ← 36 车 → 9；55 车 → 12（封顶）
   *   v    = round(gap × 总车数 × coef)，夹在 [2, cap]
   * 于是冰值随时差连续变化，不再挤成一排上限值。
   *
   * @param {number} gap     时差（0~1），= 该车当用时刻 − 被点到的进度
   * @param {number} total   总车数（= 全局倒计时步数的量纲）
   * @param {object} config  取 iceScaleCoef / iceCapRatio
   */
  function iceValueFor(gap, total, config) {
    var n = Math.max(1, parseInt(total, 10) || 1);
    var coef = (config && config.iceScaleCoef != null) ? +config.iceScaleCoef : 0.6;
    if (!(coef > 0)) coef = 0.6;
    var capRatio = (config && config.iceCapRatio != null) ? +config.iceCapRatio : 0.25;
    if (!(capRatio > 0)) capRatio = 0.25;
    var cap = Math.max(3, Math.min(12, Math.ceil(n * capRatio)));
    var v = Math.round((gap > 0 ? gap : 0) * n * coef);
    return Math.max(2, Math.min(cap, v));
  }

  function applyIceSchedule(cells, rows, cols, config) {
    var dc = config && config._demandCurve;
    if (!config || !config.iceSchedule || !dc || !dc.startExposed) return { count:0, debug:'missing', hasCfg:!!(config&&config.iceSchedule), hasDc:!!dc, hasSE:!!(dc&&dc.startExposed) };
    var N = Math.max(1, Math.min(8, parseInt(config.iceScheduleCount, 10) || 3));
    var delay = Math.max(0, Math.min(10, parseInt(config.iceScheduleDelay, 10) || 2));
    // 【v276·用户设计】冰不是随便落格，也不是只冻开局 ——
    //   它要"针对目标区在某个时刻的现状，改掉玩家的路线"：
    //   在那个时刻，玩家手里有几辆"一点就满"的免费车（按需求曲线已经能装满），
    //   冰把它们冻住 → 玩家只能去拿"吃不饱"的车 → 路线被掰弯 → 那一段出现债务。
    var bandLo = (config.iceBandLo != null) ? +config.iceBandLo : 0.35;
    var bandHi = (config.iceBandHi != null) ? +config.iceBandHi : 0.70;
    var bandMode = (config.iceBandMode !== false);
    var cars = [];
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
      var b = cells[r][c];
      if (!b || b.t !== 'box' || b.numice > 0) continue;
      cars.push({ r: r, c: c, color: b.color, count: b.count, seq: (b._seq != null ? b._seq : (r * cols + c)) });
    }
    if (!cars.length) return { count:0, debug:'noCar' };
    cars.sort(function (a, b) { return a.seq - b.seq; });
    var total = cars.length;
    function progOf(i) { return total > 1 ? (i / (total - 1)) : 0; }
    function isFree(car, prog) {
      var need = 1;
      try { need = demandAt(dc, car.color, car.count); } catch (e) { need = -1; }
      if (!(need >= 0)) return false;
      return need <= prog + 0.02;          // 到这个进度时，该色已经够它装满 → 免费车
    }
    var frozen = [];
    // ===== 【v285·用户澄清】数字冰的语义 = "这辆车在这 N 个球内不可用"（全局倒计时）。
    //   所以正确用法不是"固定冻几块、数字填几"，而是**对准时差**：
    //   一辆车在第 s 步就能点，但它的颜色要到第 r 步才露够 → 中间这段它既不能吃、又占着玩家的选择。
    //   冰就是把这段"**窗口期**"盖住：numice = (r − s) × 总车数，让它刚好在颜色够用时化开。
    //   这既锁住了"过早的白拿"，又不会把车锁死到永远——数字是**时间差**，不是难度值。
    // ===== 【v289·用户批准】冰锁"开局免费车" =====
    //   算术结论（日志 209）：这张图至少有 9 辆车 r≤0（点了就满），摆位救不了。
    //   冰是唯一不改容量就能推迟它们的手段：把最早能点到的 K 辆免费车锁住，
    //   玩家开局就没有"白拿"的选项，只能去拿吃不饱的车 → 债务从这里开始。
    //   数字 = 免费车总数 + 目标强制步数 − 1（把"白拿窗口"整段盖住），夹在 2~12。
    // ===== 【v299·用户裁决】按「当用时刻 r」分档选冰（不受行数限制）=====
    //
    // 用户两次反馈：「数字冰大都是一样的数字」「冰块也主要集中在前几行」。
    // 根因不在公式，而在**选哪几块格子**：
    //   · 规划期（planObstacleSlotsFixed）就从窄路缺口 BFS 取格 —— 那时棋盘还是空的，
    //     只知道"哪里有缺口"，不知道"那块格子将来放哪辆车"；而缺口本身就在前几行
    //     → 冰必然集中在前几行，且冻到的往往是同色同容量的车（r 相同 → 冰值相同）。
    //
    // 本模式改在**铺完车之后**选（applyIceSchedule 就是在 fill 之后跑的）：
    //   ① 对棋盘上每辆车算 r（该色攒够它容量时的进度）；
    //   ② 按 r 分档（默认 3 档），每档挑 1~N 辆；
    //   ③ 冰值 = round(r × 总车数) + iceForceSteps —— **先卡在它变有用的那一刻，再多压几步**。
    //   这样：不同档的车 r 不同 → 冰值天然不同；车在哪一行都可以被选中 → 不再集中在前几行。
    //
    // 语义（来自 simulator.advanceNumIce）：数字冰是**全局球数倒计时**，每取走 1 个球减 1。
    //   所以 numice = 该车变有用的步数 + 强制等待步数，多压的步数由 iceForceSteps 控制。
    if (config.iceByReadyTime) {
      var _rt = [];
      for (var _rr2 = 0; _rr2 < rows; _rr2++) for (var _rc2 = 0; _rc2 < cols; _rc2++) {
        var _rb = cells[_rr2][_rc2];
        if (!_rb || _rb.t !== 'box' || _rb.numice > 0 || _rb.chain > 0 || _rb.q) continue;
        var _need2 = 1;
        try { _need2 = demandAt(dc, _rb.color, _rb.count); } catch (e) { _need2 = 1; }
        _rt.push({ r: _rr2, c: _rc2, cell: _rb, ready: _need2 });
      }
      if (_rt.length) {
        var _nB = Math.max(2, Math.min(4, parseInt(config.iceReadyBuckets, 10) || 3));
        var _perB = Math.max(1, parseInt(config.iceReadyPerBucket, 10) || 1);
        var _force2 = Math.max(0, parseInt(config.iceForceSteps, 10) || 2);
        // 【v299·修】分母必须是**全关总盒数**（含管道里的盒），不是"候选车数"。
        //   数字冰按"每取走 1 个球减 1"倒计时，而一关的步数量纲就是总盒数。
        //   用候选数会让 r=0.596 的车算出比 r=0.414 更小的冰值（实测就是 6 vs 12，倒挂）。
        var _total2 = 0;
        for (var _tr = 0; _tr < rows; _tr++) for (var _tc = 0; _tc < cols; _tc++) {
          var _tx = cells[_tr][_tc];
          if (!_tx) continue;
          if (_tx.t === 'box') _total2++;
          else if (_tx.t === 'pipe') _total2 += (_tx.queue ? _tx.queue.length : 0);
        }
        if (_total2 <= 0) _total2 = _rt.length;
        // 【v299·修】只考虑"确实要等"的车：ready 太小的（开局就够用）冻它没意义，
        //   而且会把冰值压在 forceSteps 上，又变成同一个数。
        //   同时按颜色去重：同色同容量的车 r 必然相同 → 冰值必然相同，
        //   所以同一关里**每种颜色最多冻一辆**（想冻两辆就调 iceReadyPerBucket，但会牺牲差异）。
        var _cand2 = _rt.filter(function (x) { return x.ready > 0.08; });
        _cand2.sort(function (a, b) { return a.ready - b.ready; });
        var _picked2 = [], _usedPos = {}, _usedColor = {};
        for (var _bi = 0; _bi < _nB && _cand2.length; _bi++) {
          // 第 _bi 档：在剩余候选里按分位取（0.2 / 0.5 / 0.8 ...）
          var frac = (_nB === 1) ? 0.4 : (0.15 + 0.7 * (_bi / Math.max(1, _nB - 1)));
          var idx = Math.min(_cand2.length - 1, Math.round(frac * (_cand2.length - 1)));
          var chosen = null;
          // 从该分位往外找第一个没被用过的位置
          for (var scan = 0; scan < _cand2.length; scan++) {
            var ii = idx + scan;
            if (ii >= _cand2.length) ii = idx - scan;
            if (ii < 0 || ii >= _cand2.length) continue;
            var kk = _cand2[ii].r + ',' + _cand2[ii].c;
            if (_usedPos[kk]) continue;
            if (_usedColor[_cand2[ii].cell.color]) continue;   // 同色只冻一辆（否则冰值必然重复）
            chosen = _cand2[ii]; _usedPos[kk] = 1; _usedColor[chosen.cell.color] = 1; break;
          }
          if (!chosen) continue;
          var capMax2 = Math.max(3, Math.min(18, Math.ceil(_total2 * ((config.iceCapRatio != null ? +config.iceCapRatio : 0.25) * 2))));
          // 【v301·修】原来没夹上限，r 大的车会算出 14~18 的冰值（实测 14/18/18），
          //   而"这块冰最多锁多久"应该和其它路径同一把尺子：夹在 [2, 12]。
          var val2 = Math.max(2, Math.min(12, Math.round(chosen.ready * _total2) + _force2));
          val2 = Math.max(2, Math.min(capMax2, val2));
          chosen.cell.numice = val2;
          _picked2.push({ r: chosen.r, c: chosen.c, color: chosen.cell.color, count: chosen.cell.count,
                          ready: +chosen.ready.toFixed(3), numice: val2, why: 'readyTime' });
          if (_picked2.length >= N) break;
          // 同档可以多辆
          for (var rep = 1; rep < _perB && _picked2.length < N && _cand2.length; rep++) {
            var ii2 = idx + rep;
            if (ii2 >= _cand2.length) break;
            var kk2 = _cand2[ii2].r + ',' + _cand2[ii2].c;
            if (_usedPos[kk2]) continue;
            if (_usedColor[_cand2[ii2].cell.color]) continue;
            _usedPos[kk2] = 1; _usedColor[_cand2[ii2].cell.color] = 1;
            var ch2 = _cand2[ii2];
            var v3 = Math.max(2, Math.min(capMax2, Math.round(ch2.ready * _total2) + _force2));
            ch2.cell.numice = v3;
            _picked2.push({ r: ch2.r, c: ch2.c, color: ch2.cell.color, count: ch2.cell.count,
                            ready: +ch2.ready.toFixed(3), numice: v3, why: 'readyTime' });
          }
        }
        if (_picked2.length) {
          return { frozen: _picked2, count: _picked2.length, mode: 'readyTime',
                   buckets: _nB, coef: _force2 };
        }
      }
    }
    if (config.iceFreeFirst) {
      var _freeList = [];
      for (var _fi = 0; _fi < total; _fi++) {
        var _carF = cars[_fi];
        var _rF = -1;
        try { _rF = demandAt(dc, _carF.color, _carF.count); } catch (e) { _rF = -1; }
        if (!(_rF >= 0) || _rF > 0.02) continue;          // 只取"开局就能装满"的
        _freeList.push({ car: _carF, r: _rF, seq: _carF.seq });
      }
      if (_freeList.length) {
        _freeList.sort(function (a, b) { return a.seq - b.seq; });   // 摆放序 ≈ 被点到的先后
        var _LF = Math.max(1, parseInt(config.iceForceSteps, 10) || 2);
        var _vF = Math.max(2, Math.min(12, _freeList.length + _LF - 1));
        // 关键保护：第 0 行必须**留至少 1 辆没被冻的免费车**，否则开局无车可吃 → screen 全灭
        //   （实测锁 6 辆时 2/3 的 seed 直接死）。所以可锁数 = 第 0 行免费车数 − 1。
        var _row0Free = 0;
        for (var _qz = 0; _qz < _freeList.length; _qz++) if (_freeList[_qz].car.r === 0) _row0Free++;
        var _keep = Math.max(1, parseInt(config.iceKeepFreeRow0, 10) || 1);
        var _capK = Math.max(0, Math.min(_row0Free - _keep, _freeList.length));
        var _KF = Math.min(parseInt(config.iceScheduleCount, 10) || 4, _capK);
        if (_KF <= 0) { /* 第 0 行免费车太少，不锁，交给后面的时差模式 */ }
        for (var _ki = 0; _ki < _KF; _ki++) {
          var _tF = _freeList[_ki].car, _cF = cells[_tF.r][_tF.c];
          if (!_cF || _cF.numice > 0) continue;
          _cF.numice = _vF;
          frozen.push({ r: _tF.r, c: _tF.c, color: _tF.color, count: _tF.count, seq: _tF.seq,
                        numice: _vF, why: 'freeFirst' });
        }
        if (frozen.length) return { frozen: frozen, count: frozen.length, mode: 'freeFirst', freeCars: _freeList.length, numice: _vF };
      }
    }
    if (config.iceSync !== false) {
      var _sync = [];
      for (var _si = 0; _si < total; _si++) {
        var _car = cars[_si];
        var _s2 = progOf(_si);
        var _r2 = -1;
        try { _r2 = demandAt(dc, _car.color, _car.count); } catch (e) { _r2 = -1; }
        if (!(_r2 >= 0)) continue;
        var _gap = _r2 - _s2;
        if (_gap < 0.04) continue;                     // 点了就能满 → 不需要冰
        // 【v296】相对步长：v = round(gap × 总车数 × coef)，上限 = ceil(总车数 × 0.25) 夹 [3,12]
        //   原来写死 clamp(2,12)，gap ≥ 0.33 就被截成 12 → 所有冰一样大（见 iceValueFor 注释）
        var _n2 = iceValueFor(_gap, total, config);
        if (_n2 < 2) continue;
        _sync.push({ i: _si, gap: _gap, numice: _n2 });
      }
      _sync.sort(function (a, b) { return b.gap - a.gap; });   // 时差最大的先冻
      for (var _k4 = 0; _k4 < _sync.length && frozen.length < N; _k4++) {
        var _t4 = cars[_sync[_k4].i], _cell4 = cells[_t4.r][_t4.c];
        if (!_cell4 || _cell4.numice > 0) continue;
        _cell4.numice = _sync[_k4].numice;
        frozen.push({ r: _t4.r, c: _t4.c, color: _t4.color, count: _t4.count, seq: _t4.seq,
                      numice: _sync[_k4].numice, gap: +_sync[_k4].gap.toFixed(2), why: 'sync' });
      }
      if (frozen.length) return { frozen: frozen, count: frozen.length, mode: 'sync' };
    }
    // 【v281·用户批准】冰太少（实测一关只有 2 块，而前沿同时有 7 格可点）。
    //   改成**沿进度带多点投放**：默认在 35% / 50% / 65% 各冻 1 辆"那时能吃的免费车"，
    //   合计 3 块；加上开局回退最多 4 块。每块都对准"那一刻本可以白拿的车"。
    var _pts = config.iceBandPoints || [0.35, 0.50, 0.65];
    var _per = Math.max(1, parseInt(config.icePerPoint, 10) || 1);
    var _used = {};
    var _multi = (config.iceBandMode !== false && config.iceMultiPoint !== false);
    if (_multi) {
      for (var _pi2 = 0; _pi2 < _pts.length && frozen.length < N; _pi2++) {
        var _p = _pts[_pi2], _got = 0;
        var _cands2 = [];
        for (var _i2 = 0; _i2 < total; _i2++) {
          var _pr2 = progOf(_i2);
          if (Math.abs(_pr2 - _p) > 0.10) continue;
          var _key = cars[_i2].r + ',' + cars[_i2].c;
          if (_used[_key]) continue;
          if (!isFree(cars[_i2], _p)) continue;
          _cands2.push({ i: _i2, cap: cars[_i2].count, d: Math.abs(_pr2 - _p) });
        }
        // 【v285·用户说法】冰上的数字不是固定值，它的意义是"**这段路被锁多久**"。
        //   数字冰是全局倒计时：每取走 1 个球减 1。所以正确的数 = 那时还有几辆别的车能吃 + 想要的强制步数。
        //     冻 1 辆、那时有 F 辆能吃 → 玩家先把其余 F-1 辆吃掉（F-1 步），
        //     若数字更大，就能再多压 L 步 → **数字 = (F-1) + L**。
        //   这样同一张图在不同进度点会自动得到不同的数字，而不是一律 8。
        var _freeAtP = 0;
        for (var _fi2 = 0; _fi2 < total; _fi2++) {
          if (isFree(cars[_fi2], _p)) _freeAtP++;
        }
        var _L2 = Math.max(1, parseInt(config.iceForceSteps, 10) || 2);
        // 【v296】多点模式同样改成相对步长：
        //   原来 = (F−1)+L，F 是"该时刻还能装满的车数"。36 车的图上 F=23~35 → 24~36 → 全被截成 12。
        //   现在把它换算成"时差"再走同一个 iceValueFor：
        //     gap ≈ F/总车数 = 那一刻还剩多大比例的供给能吃满 → 与 sync 模式同量纲，可直接比较。
        var _gap2 = total > 0 ? (_freeAtP / total) : 0;
        var _val2 = iceValueFor(_gap2, total, config);
        if (_val2 < _L2) _val2 = Math.min(_L2, Math.max(3, Math.min(12, Math.ceil(total * 0.25))));
        _cands2.sort(function (a, b) { return b.cap - a.cap || a.d - b.d; });
        for (var _k2 = 0; _k2 < _cands2.length && _got < _per && frozen.length < N; _k2++) {
          var _t2 = cars[_cands2[_k2].i], _cell2 = cells[_t2.r][_t2.c];
          if (!_cell2 || _cell2.numice > 0) continue;
          var _v2 = _val2;
          _cell2.numice = _v2;
          _used[_t2.r + ',' + _t2.c] = 1;
          frozen.push({ r: _t2.r, c: _t2.c, color: _t2.color, count: _t2.count, seq: _t2.seq, numice: _v2, at: _p, why: 'multi' });
          _got++;
        }
      }
      if (frozen.length >= N) return { frozen: frozen, count: frozen.length, band: [_pts[0], _pts[_pts.length - 1]], mode: 'multi' };
    }
    var probe = [];
    if (bandMode) {
      // 带内：按"第几步被点到"落在 [bandLo, bandHi]，且那时是免费车 → 冻它
      for (var i = 0; i < total && frozen.length < N; i++) {
        var p = progOf(i);
        if (p < bandLo || p > bandHi) continue;
        if (!isFree(cars[i], p)) continue;
        probe.push({ i: i, p: +p.toFixed(2) });
      }
      // 相邻的免费车容易连成一片，隔一个取一个，让冻结更分散
      var picked = [];
      for (var k = 0; k < probe.length && picked.length < N; k++) {
        if (k > 0 && probe[k].i - probe[k - 1].i <= 1 && picked.length) continue;
        picked.push(probe[k]);
      }
      for (var q = 0; q < picked.length && frozen.length < N; q++) {
        var t0 = cars[picked[q].i], cell0 = cells[t0.r][t0.c];
        if (!cell0 || cell0.numice > 0) continue;
        var v0 = Math.max(2, Math.min(12, delay + 1));
        cell0.numice = v0;
        frozen.push({ r: t0.r, c: t0.c, color: t0.color, count: t0.count, seq: t0.seq, numice: v0, at: picked[q].p, why: 'band' });
      }
    }
    // 带内凑不够 → 退回"开局免费车"（老逻辑），但至少保证有冰
    if (frozen.length < N) {
      for (var j = 0; j < total && frozen.length < N; j++) {
        var se = dc.startExposed[cars[j].color];
        if (se == null || se < cars[j].count) continue;
        var cell = cells[cars[j].r][cars[j].c];
        if (!cell || cell.numice > 0) continue;
        var v = Math.max(2, Math.min(12, delay + 1));
        cell.numice = v;
        frozen.push({ r: cars[j].r, c: cars[j].c, color: cars[j].color, count: cars[j].count, seq: cars[j].seq, numice: v, at: 0, why: 'start' });
      }
    }
    return { frozen: frozen, count: frozen.length, band: [bandLo, bandHi] };
  }


  /**
   * 【v260·修正版】闸门借车必须在**铺完盘之后**做。
   *   铺盘前棋盘是空的，任何格子都不"挡路"，扇出恒为 0（上一版就卡在这）。
   *   铺完之后，盒子本身是障碍：拿掉某一格能让多少辆车从"不可点"变"可点"，才是真的扇出。
   *   做法：算出每格的扇出 → 取扇出最大的前 K 个（深度≥1，不碰第 0 行）
   *        → 把"需求最晚"的 K 辆车的数据换到这些格子上（颜色/容量交换，位置不变）。
   *   这样全知线要往深处走，就必须先拿这几辆晚熟车 → 长债。
   */
  /**
   * 【v262·用户裁决】容量序列：不动摆位，只把"颜色"这一维的容量重排。
   *   目标：链路上第 1~3 辆车的容量 > 该色当前露出的量 → 它必须等下一层才吃得满 → 长债。
   *   手法（守恒）：同一颜色内部，把"最浅那辆"和"最深那辆"的容量对调一部分 ——
   *     浅车变大、深车变小，该色总像素不变，守恒检查照过。
   *   保护：
   *     · 浅车新容量不超过该色总像素（否则永远吃不饱）；
   *     · 深车剩余容量 ≥ 8（别切出废车）；
   *     · 每色只动一次，最多动 capSeqBoost 个色。
   *   这条路**不碰路径形状**，与"墙放最底行"不冲突。
   */
  function shapeCapacitySequence(cells, rows, cols, config) {
    var K = Math.max(0, Math.min(6, parseInt(config && config.capSeqBoost, 10) || 0));
    if (K <= 0) return null;
    var dc = config._demandCurve;
    if (!dc || !dc.curve) return null;
    var colorTotal = {};
    for (var ck in dc.curve) {
      var arr = dc.curve[ck];
      if (arr && arr.length) colorTotal[+ck] = arr[arr.length - 1][0];
    }
    var byColor = {};
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
      var b = cells[r][c];
      if (!b || b.t !== 'box') continue;
      (byColor[b.color] = byColor[b.color] || []).push({ r: r, c: c, cell: b, depth: r });
    }
    var done = [];
    var colors = Object.keys(byColor).map(Number);
    // 先挑"车数最多"的颜色（供应最充裕，重排余地大）
    colors.sort(function (a, b) { return byColor[b].length - byColor[a].length; });
    for (var ci = 0; ci < colors.length && done.length < K; ci++) {
      var col = colors[ci], cars = byColor[col];
      if (!cars || cars.length < 2) continue;
      var tot = colorTotal[col] || 0;
      if (tot <= 0) continue;
      cars.sort(function (a, b) { return a.depth - b.depth || a.c - b.c; });
      var sh = cars[0], dp = cars[cars.length - 1];
      if (sh.cell.count >= tot * 0.6) continue;             // 已经够大，不用再压
      var pair = sh.cell.count + dp.cell.count;
      var want = Math.min(tot, Math.round(sh.cell.count * 1.6), 64);
      var rest = pair - want;
      if (rest < 8) continue;                               // 深车会变废车
      var before = { sh: sh.cell.count, dp: dp.cell.count };
      sh.cell.count = want; dp.cell.count = rest;
      done.push({ color: col, shallow: [sh.r, sh.c], deep: [dp.r, dp.c], from: before, to: { sh: want, dp: rest } });
    }
    return done.length ? { k: done.length, items: done } : null;
  }

  /**
   * 【v277·用户设计】锁链按"色块大小配对"：一头锁大色块（随手可吃）、一头锁小色块（得等）。
   *   原理：链把两格绑成一组，必须先消掉先出现的那格；如果另一格的颜色要很久才够，
   *   玩家就被钉在"等它"上 —— 链路本身成了债务发生器，而不是单纯挡路。
   *   判据：相邻两格的 demandAt(颜色,容量) 差距 ≥ 0.35，且一格 ≤0.35（大块）、一格 ≥0.55（小块）；
   *        两格都要在 25%~85% 进度带内（避免开局/收尾），不与冰/问号/已有链重叠。
   */
  function pairChainsByDemand(cells, rows, cols, config) {
    var K = Math.max(0, Math.min(6, parseInt(config && config.chainByDemand, 10) || 0));
    if (K <= 0) return null;
    var dc = config._demandCurve;
    if (!dc || !dc.curve) return null;
    var lo = (config.chainBandLo != null) ? +config.chainBandLo : 0.25;
    var hi = (config.chainBandHi != null) ? +config.chainBandHi : 0.85;
    var boxes = [];
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
      var b = cells[r][c];
      if (!b || b.t !== 'box') continue;
      if (b.chain > 0 || b.question) continue;
      var need = -1;
      try { need = demandAt(dc, b.color, b.count); } catch (e) { need = -1; }
      if (!(need >= 0)) continue;
      var seq = (b._seq != null) ? b._seq : (r * cols + c);
      boxes.push({ r: r, c: c, cell: b, need: need, seq: seq });
    }
    if (boxes.length < 4) return null;
    var total = boxes.length;
    var byKey = {};
    for (var i = 0; i < boxes.length; i++) byKey[boxes[i].r + ',' + boxes[i].c] = boxes[i];
    function progOf(x) { return total > 1 ? (x.seq / total) : 0; }
    var cands = [];
    for (var j = 0; j < boxes.length; j++) {
      var a = boxes[j];
      var pa = progOf(a);
      if (pa < lo || pa > hi) continue;
      var nbs = [[a.r, a.c + 1], [a.r + 1, a.c]];
      for (var d = 0; d < 2; d++) {
        var nb = byKey[nbs[d][0] + ',' + nbs[d][1]];
        if (!nb) continue;
        var pb = progOf(nb);
        if (pb < lo || pb > hi) continue;
        var gap = Math.abs(a.need - nb.need);
        if (gap < 0.25) continue;
        var low = Math.min(a.need, nb.need), high = Math.max(a.need, nb.need);
        if (!(low <= 0.45 && high >= 0.55)) continue;
        cands.push({ a: a, b: nb, gap: gap, low: low, high: high });
      }
    }
    // 【v278·用户批准】自然配对凑不够时**主动凑对**：
    //   选一对进度带内的相邻格 → 把场上"最低需求"和"最高需求"的两辆车换进去 → 上链。
    //   这样每关都能稳定配出 K 组，不再靠"相邻两格恰好一大一小"的运气。
    // v278 实测：主动凑对会打乱 capTie 的暴露与需求对应，覆盖率 63%→32%，默认关
    var _compose = !!(config && config.chainCompose);
    if (_compose && cands.length < K) {
      var freeCells = boxes.filter(function (x) {
        var cc = cells[x.r][x.c];
        return cc && !cc.chain && !cc.question && !(cc.numice > 0) && progOf(x) >= lo && progOf(x) <= hi;
      });
      if (freeCells.length >= 2) {
        var byNeed = boxes.slice().sort(function (a, b) { return a.need - b.need; });
        var poolLow = byNeed.filter(function (x) { var cc = cells[x.r][x.c]; return cc && !(cc.numice > 0); });
        var poolHigh = byNeed.slice().reverse().filter(function (x) { var cc = cells[x.r][x.c]; return cc && !(cc.numice > 0); });
        var usedSwap = {};
        var composed = [];
        for (var fa = 0; fa < freeCells.length && composed.length < (K - cands.length); fa++) {
          var A = freeCells[fa];
          if (usedSwap[A.r + ',' + A.c]) continue;
          var nbs2 = [[A.r, A.c + 1], [A.r + 1, A.c], [A.r, A.c - 1], [A.r - 1, A.c]];
          var B = null;
          for (var d2 = 0; d2 < 4 && !B; d2++) {
            var cand2 = byKey[nbs2[d2][0] + ',' + nbs2[d2][1]];
            if (!cand2) continue;
            var cc2 = cells[cand2.r][cand2.c];
            if (!cc2 || cc2.chain || cc2.question || cc2.numice > 0) continue;
            var p2 = progOf(cand2);
            if (p2 < lo || p2 > hi) continue;
            B = cand2;
          }
          if (!B) continue;
          // 找两个可交换的"极端车"（不能就是这两格本身，也不能已用过）
          var lowCar = null, highCar = null;
          for (var li = 0; li < poolLow.length; li++) {
            var L = poolLow[li], kL = L.r + ',' + L.c;
            if (usedSwap[kL] || kL === (A.r + ',' + A.c) || kL === (B.r + ',' + B.c)) continue;
            lowCar = L; break;
          }
          for (var hi2 = 0; hi2 < poolHigh.length; hi2++) {
            var H = poolHigh[hi2], kH = H.r + ',' + H.c;
            if (usedSwap[kH] || kH === (A.r + ',' + A.c) || kH === (B.r + ',' + B.c)) continue;
            if (lowCar && kH === (lowCar.r + ',' + lowCar.c)) continue;
            highCar = H; break;
          }
          if (!lowCar || !highCar) continue;
          if (highCar.need - lowCar.need < 0.2) continue;      // 差距不够，凑了也没意义
          // 交换数据：lowCar ↔ A 格、highCar ↔ B 格（整组换，守恒不变）
          function swapData(p1, p2) {
            var c1 = cells[p1.r][p1.c], c2 = cells[p2.r][p2.c];
            var tc = c1.color, tn = c1.count, td = c1._dm;
            c1.color = c2.color; c1.count = c2.count; c1._dm = c2._dm;
            c2.color = tc; c2.count = tn; c2._dm = td;
          }
          swapData(A, lowCar); swapData(B, highCar);
          var mem2 = [{ r: A.r, c: A.c }, { r: B.r, c: B.c }];
          if (typeof chainActivatable === 'function' && !chainActivatable(cells, rows, cols, mem2)) {
            swapData(A, lowCar); swapData(B, highCar);        // 回滚
            continue;
          }
          var g2 = 1000 + composed.length;
          cells[A.r][A.c].chain = g2; cells[B.r][B.c].chain = g2;
          usedSwap[lowCar.r + ',' + lowCar.c] = 1; usedSwap[highCar.r + ',' + highCar.c] = 1;
          composed.push({ group: g2, a: [A.r, A.c], b: [B.r, B.c], low: +lowCar.need.toFixed(2), high: +highCar.need.toFixed(2),
                          from: [[lowCar.r, lowCar.c], [highCar.r, highCar.c]] });
        }
        if (composed.length) {
          return { groups: composed.length, composed: composed, why: 'composed', cands: cands.length };
        }
      }
      return { groups: 0, why: 'noPair', boxes: boxes.length };
    }
    cands.sort(function (x, y) { return y.gap - x.gap; });
    var used = {}, groups = [];
    var gid = (config._chainGroupSeed || 1);
    for (var q = 0; q < cands.length && groups.length < K; q++) {
      var cd2 = cands[q];
      var k1 = cd2.a.r + ',' + cd2.a.c, k2 = cd2.b.r + ',' + cd2.b.c;
      if (used[k1] || used[k2]) continue;
      var members = [{ r: cd2.a.r, c: cd2.a.c }, { r: cd2.b.r, c: cd2.b.c }];
      if (typeof chainActivatable === 'function' && !chainActivatable(cells, rows, cols, members)) continue;
      used[k1] = 1; used[k2] = 1;
      var g = gid++;
      cells[cd2.a.r][cd2.a.c].chain = g;
      cells[cd2.b.r][cd2.b.c].chain = g;
      groups.push({ group: g, low: +cd2.low.toFixed(2), high: +cd2.high.toFixed(2), gap: +cd2.gap.toFixed(2),
                    members: members });
    }
    return { groups: groups.length, items: groups, cands: cands.length };
  }

  /**
   * 【v290·用户反馈】"第一行全是一样的"。
   *   铺盘是按需求序放车，而大色块会切出很多同色的车排在最前 → 第 0 行清一色。
   *   放置时的同色限量（row0ColorMax）在"整个队列前 12 辆都同色"时无能为力，
   *   所以这里加一道**事后保证**：第 0 行同一颜色不得超过 maxPer 辆，
   *   超了就把该格与深层某个"第 0 行还没出现过的颜色"的格子**整组对调**（颜色+容量一起换，守恒不变）。
   *   不动被冰冻/被锁链绑住的格子。
   */
  /**
   * 【v291·继承前辈「卡点补救」】网关色搬盒（chokeSwap 的简化版）。
   *   前辈原文：把"网关色"（消掉它能解锁最多其他颜色像素的颜色）的盒子搬到离原位最远处，
   *   后期棋盘格或管道最深层。这里搬到最后一行，与那里的车整组对调（颜色+容量一起换，守恒不变）。
   *   效果：这一色必须等玩家挖到深处才拿得到 → 依赖时机被推迟。
   */
  function repairGatewaySwap(cells, rows, cols, blocks, config) {
    var n = Math.max(0, Math.min(12, parseInt(config && config.repairSwap, 10) || 0));
    if (n <= 0) return null;
    var rank = [];
    try { rank = gatewayColorRank(blocks, config && config.bottomOnly) || []; } catch (e) { rank = []; }
    var played = [], used = {};
    for (var k = 0; k < rank.length && played.length < n; k++) {
      var col = rank[k].color;
      // 找这一色**最浅**的盒（最容易拿到的那辆）和场上**最深**的空位
      var shallow = null;
      for (var r = 0; r < rows; r++) {
        for (var c = 0; c < cols; c++) {
          var b = cells[r][c];
          if (!b || b.t !== 'box' || b.color !== col) continue;
          if (b.numice > 0 || b.chain > 0) continue;
          if (!shallow || r < shallow.r) shallow = { r: r, c: c };
        }
        if (shallow && r > shallow.r + 3) break;
      }
      if (!shallow) continue;
      var deep = null;
      for (var r2 = rows - 1; r2 >= 0 && !deep; r2--) {
        for (var c2 = cols - 1; c2 >= 0; c2--) {
          var b2 = cells[r2][c2];
          if (!b2 || b2.t !== 'box' || b2.color === col) continue;
          if (b2.numice > 0 || b2.chain > 0) continue;
          if (r2 - shallow.r < 2) continue;
          deep = { r: r2, c: c2, color: b2.color };
          break;
        }
      }
      if (!deep) continue;
      var key = shallow.r + ',' + shallow.c;
      if (used[key]) continue;
      used[key] = 1;
      var a = cells[shallow.r][shallow.c], b3 = cells[deep.r][deep.c];
      var tc = a.color, tn = a.count, td = a._dm;
      a.color = b3.color; a.count = b3.count; a._dm = b3._dm;
      b3.color = tc; b3.count = tn; b3._dm = td;
      played.push({ color: col, unlock: rank[k].unlock, shallow: [shallow.r, shallow.c], deep: [deep.r, deep.c] });
    }
    return played.length ? { swaps: played.length, items: played } : null;
  }

  /**
   * 【v291·继承前辈】增容（chokeInflate 的简化版）：
   *   把某色的容量**集中**到一个深盒上（抬到 1.6 倍），同色浅盒相应减小，总量守恒。
   *   效果：深盒长期占住暂存位，而浅盒变得"一点就满" → 逼玩家把槽位压在深盒上。
   */
  function repairInflate(cells, rows, cols, config) {
    var n = Math.max(0, Math.min(8, parseInt(config && config.repairInflate, 10) || 0));
    if (n <= 0) return null;
    var byColor = {};
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
      var b = cells[r][c];
      if (!b || b.t !== 'box' || b.numice > 0 || b.chain > 0) continue;
      (byColor[b.color] = byColor[b.color] || []).push({ r: r, c: c, cell: b });
    }
    var done = [];
    var colors = Object.keys(byColor).map(Number);
    for (var i = 0; i < colors.length && done.length < n; i++) {
      var list = byColor[colors[i]];
      if (list.length < 2) continue;
      list.sort(function (a, b) { return a.r - b.r; });
      var sh = list[0], dp = list[list.length - 1];
      if (dp.r - sh.r < 2) continue;
      if (dp.cell.count >= sh.cell.count * 1.5) continue;
      var pair = sh.cell.count + dp.cell.count;
      var want = Math.min(Math.round(sh.cell.count * 2.2), Math.round(pair * 0.75));
      var rest = pair - want;
      if (rest < 6 || want <= dp.cell.count) continue;
      var before = { shallow: sh.cell.count, deep: dp.cell.count };
      sh.cell.count -= (want - dp.cell.count);
      dp.cell.count = want;
      done.push({ color: colors[i], shallow: [sh.r, sh.c], deep: [dp.r, dp.c], from: before,
                  to: { shallow: sh.cell.count, deep: dp.cell.count } });
    }
    return done.length ? { count: done.length, items: done } : null;
  }

  /**
   * 【v328·用户裁决】第 0 行"免费车配额"。
   *
   * 背景（用户指出的根因，已核对代码确认）：
   *   · 棋盘的可点范围是【只有第 0 行】——computeReach 只从第 0 行播种（管道开口另算）；
   *   · 目标图的可消范围是【图像四边】——flood fill 从边界进来；
   *   · 切球从图像外圈开始（peel），最先切出来的正是外圈那两个大色；
   *   · 铺盘按切球顺序，第一行先放 → 第 0 行全是那两个大色的车；
   *   · 那两个色开局可达 98 / 52 像素，容量 60 → 每辆都"点了就能吃满"＝免费车。
   *   于是开局 7 个位置全是退路，暂存永远压不起来，覆盖率卡在 22%。
   *
   * 做法（暴力但直接）：第 0 行最多留 N 辆免费车（默认 2），其余换成"现在还吃不下"的车
   *   （该色当场可达像素 < 这辆车的容量）。只交换 color/count，不动冰/链/问号等格子属性；
   *   守恒不变；换完照常求解，解不开就由重试循环处理。
   *
   * @returns {null|object} 统计：{before, after, swaps}
   */
  function limitRow0Free(cells, rows, cols, blocks, config) {
    try {
      var cap = parseInt(config && config.row0FreeMax, 10);
      if (!(cap >= 0)) cap = 2;
      var iceK = parseInt(config && config.row0FreeIce, 10) || 0;   // 剩下的免费车冻几步（0=不冻）
      if (!blocks || !blocks.length) return null;
      var R = blocks.length, C = blocks[0].length, ring = {};
      var addPx = function (r, c) { var v = blocks[r][c]; if (v > 0) ring[v] = (ring[v] || 0) + 1; };
      for (var c0 = 0; c0 < C; c0++) { addPx(0, c0); addPx(R - 1, c0); }
      for (var r0 = 0; r0 < R; r0++) { addPx(r0, 0); addPx(r0, C - 1); }
      function isFree(b) { return b && b.t === 'box' && (b.count || 0) <= (ring[b.color] || 0); }
      var before = 0;
      for (var ci = 0; ci < cols; ci++) if (isFree(cells[0][ci])) before++;

      // ① 换车：把"最深的颜色"（外圈最少的那几色）换到第 0 行，替掉最右边的大色车。
      //   用户原话：「那些深层的颜色的车 B 放到棋盘上层替换掉大色块 A1」。
      //   供体不再要求"当场吃不下"（上一版就是卡在这条上：这张图所有车都能当场吃满），
      //   只要求 ① 颜色在外圈露出得最少 ② 不在第 0 行超配额 ③ 不带冰/链。
      var swaps = 0, guard = 0;
      while (guard++ < 60) {
        var freeCells = [], cntRow = {};
        for (var c1 = 0; c1 < cols; c1++) {
          var b1 = cells[0][c1];
          if (b1 && b1.t === 'box') cntRow[b1.color] = (cntRow[b1.color] || 0) + 1;
          if (isFree(b1)) freeCells.push(c1);
        }
        if (freeCells.length <= cap) break;
        var gate = freeCells[freeCells.length - 1];          // 从右往左换，保留左边退路
        var g = cells[0][gate];
        if (!g || g.numice > 0 || g.chain > 0) { freeCells.pop(); if (!freeCells.length) break; gate = freeCells[freeCells.length - 1]; g = cells[0][gate]; }
        if (!g || g.numice > 0 || g.chain > 0) break;
        // 供体：r>=2、不带冰/链、颜色外圈露出最少、该色在第 0 行还没出现
        var donor = null, dScore = Infinity;
        for (var r2 = 2; r2 < rows; r2++) {
          for (var c2 = 0; c2 < cols; c2++) {
            var b2 = cells[r2][c2];
            if (!b2 || b2.t !== 'box') continue;
            if (b2.numice > 0 || b2.chain > 0) continue;
            if (cntRow[b2.color]) continue;                  // 第 0 行已有该色 → 不引入重复
            if (b2.color === g.color) continue;
            var sc = (ring[b2.color] || 0);                  // 越小 = 越深
            if (sc < dScore) { dScore = sc; donor = { r: r2, c: c2 }; }
          }
        }
        if (!donor) break;
        var d = cells[donor.r][donor.c];
        var tc = g.color, tn = g.count;
        g.color = d.color; g.count = d.count;
        d.color = tc; d.count = tn;
        swaps++;
      }

      // ② 剩下的免费车 → 数字化冰冻住（用户：「再用数字冰加到其他大色块 A2 上」）
      var iced = 0;
      if (iceK > 0) {
        for (var c3 = 0; c3 < cols; c3++) {
          var b3 = cells[0][c3];
          if (!isFree(b3) || b3.numice > 0 || b3.chain > 0) continue;
          var alive = 0;
          for (var c4 = 0; c4 < cols; c4++) {
            var b4 = cells[0][c4];
            if (b4 && b4.t === 'box' && !(b4.numice > 0) && !(b4.chain > 0)) alive++;
          }
          if (alive <= 1) break;                             // 至少留一格能点
          b3.numice = iceK; iced++;
        }
      }
      var after = 0;
      for (var c5 = 0; c5 < cols; c5++) if (isFree(cells[0][c5]) && !(cells[0][c5].numice > 0)) after++;
      return { before: before, after: after, swaps: swaps, iced: iced };
    } catch (e) { return null; }
  }

  function diversifyRow0(cells, rows, cols, config) {
    var maxPer = Math.max(1, parseInt(config && config.row0ColorMax, 10) || 2);
    if (!(maxPer > 0)) return null;
    var spot = null, swaps = [];
    for (var guard = 0; guard < 40; guard++) {
      var cnt = {}, worst = null, worstN = 0;
      for (var c0 = 0; c0 < cols; c0++) {
        var b0 = cells[0][c0];
        if (!b0 || b0.t !== 'box') continue;
        cnt[b0.color] = (cnt[b0.color] || 0) + 1;
        if (cnt[b0.color] > worstN) { worstN = cnt[b0.color]; worst = c0; }
      }
      if (!worstN || worstN <= maxPer) break;
      var overCol = cells[0][worst].color;
      // 找一个深层格子：颜色在第 0 行还没满额、且没被冰/链占用
      var donor = null;
      for (var r2 = 2; r2 < rows && !donor; r2++) {
        for (var c2 = 0; c2 < cols; c2++) {
          var b2 = cells[r2][c2];
          if (!b2 || b2.t !== 'box') continue;
          if (b2.numice > 0 || b2.chain > 0) continue;
          if (b2.color === overCol) continue;
          if ((cnt[b2.color] || 0) >= maxPer) continue;
          donor = { r: r2, c: c2 };
          break;
        }
      }
      if (!donor) break;
      var gate2 = cells[0][worst], don2 = cells[donor.r][donor.c];
      if (gate2.numice > 0 || gate2.chain > 0) break;
      var tc = gate2.color, tn = gate2.count;
      gate2.color = don2.color; gate2.count = don2.count;
      don2.color = tc; don2.count = tn;
      swaps.push({ row0: [0, worst], from: [donor.r, donor.c], overCol: overCol });
    }
    return swaps.length ? { swaps: swaps.length, items: swaps, maxPer: maxPer } : null;
  }

  function gateBorrowAfterFill(cells, rows, cols, config) {
    var K = Math.max(0, Math.min(6, parseInt(config && config.gateBorrow, 10) || 0));
    if (K <= 0) return null;
    var dc = config._demandCurve;
    if (!dc || !dc.curve) return { k: 0, why: 'noDemandCurve' };
    // 扇出 = 拿掉这格后，**可点**的盒数增加多少（不是"可达"）。
    //   棋盘铺满时所有格子本来就可达，只有"可点"才会因为开路而增加。
    function pickableCount(r0, c0) {
      var R2 = [];
      for (var r = 0; r < rows; r++) { R2.push([]); for (var c = 0; c < cols; c++) R2[r].push(false); }
      var q = [];
      for (var c0s = 0; c0s < cols; c0s++) {
        var x0 = cells[0][c0s];
        if (x0 == null || (r0 === 0 && c0s === c0)) { R2[0][c0s] = true; q.push([0, c0s]); }
      }
      var d4 = [[-1,0],[1,0],[0,-1],[0,1]];
      for (var h = 0; h < q.length; h++) {
        var pr = q[h][0], pc = q[h][1];
        for (var d = 0; d < 4; d++) {
          var nr = pr + d4[d][0], nc = pc + d4[d][1];
          if (nr < 0 || nr >= rows || nc < 0 || nc >= cols || R2[nr][nc]) continue;
          var cel = cells[nr][nc];
          if (cel == null || (nr === r0 && nc === c0)) { R2[nr][nc] = true; q.push([nr, nc]); }
        }
      }
      var n = 0;
      for (var rr = 0; rr < rows; rr++) for (var cc = 0; cc < cols; cc++) {
        var b = cells[rr][cc];
        if (!b || b.t !== 'box') continue;
        if (rr === r0 && cc === c0) continue;              // 被拿掉的那个不算
        if (rr === 0) { n++; continue; }
        var up = (rr > 0) && R2[rr-1][cc], dn = (rr < rows-1) && R2[rr+1][cc];
        var lf = (cc > 0) && R2[rr][cc-1], rt = (cc < cols-1) && R2[rr][cc+1];
        if (up || dn || lf || rt) n++;
      }
      return n;
    }
    var base = pickableCount(-1, -1);
    var cands = [];
    // 闸门只可能是【当前可点】的盒子：第 0 行 + 贴着可达区的。内层的盒子拿掉也开不出路。
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
      var b2 = cells[r][c];
      if (!b2 || b2.t !== 'box') continue;
      var before = (r === 0) ? 1 : 0;                       // 它自己原本是否可点
      var fo = pickableCount(r, c) - base + before;
      if (fo > 0) cands.push({ r: r, c: c, fan: fo, cell: b2 });
    }
    if (!cands.length) return { k: 0, why: 'noGate', base: base };
    cands.sort(function (a, b) { return b.fan - a.fan; });
    var all = [];
    for (var r3 = 0; r3 < rows; r3++) for (var c3 = 0; c3 < cols; c3++) {
      var b3 = cells[r3][c3];
      if (!b3 || b3.t !== 'box') continue;
      all.push({ r: r3, c: c3, cell: b3, dm: demandAt(dc, b3.color, b3.count) });
    }
    all.sort(function (a, b) { return b.dm - a.dm; });
    var used = {}, swaps = [];
    for (var i = 0; i < cands.length && swaps.length < K; i++) {
      var gate = cands[i], key = gate.r + ',' + gate.c;
      if (used[key]) continue;
      var donor = null;
      for (var j = 0; j < all.length; j++) {
        var dk = all[j].r + ',' + all[j].c;
        if (used[dk] || dk === key) continue;
        if (all[j].dm < 0.55) break;                       // 只借真晚熟的
        donor = all[j]; break;
      }
      if (!donor) break;
      used[key] = 1; used[donor.r + ',' + donor.c] = 1;
      var tc = gate.cell.color, tn = gate.cell.count;
      gate.cell.color = donor.cell.color; gate.cell.count = donor.cell.count;
      donor.cell.color = tc; donor.cell.count = tn;
      swaps.push({ gate: [gate.r, gate.c], fan: gate.fan, from: [donor.r, donor.c] });
    }
    return { k: swaps.length, swaps: swaps, base: base };
  }


  function ensureRow0Opening(level) {
    var board = level && level.board;
    if (!board || !board.cells || !board.cells.length) return null;
    var rows = board.rows, cols = board.cols, cells = board.cells;
    var plain = 0, locked = [];
    for (var c0 = 0; c0 < cols; c0++) {
      var x = cells[0][c0];
      if (!x || x.t !== 'box') continue;
      if (x.numice > 0 || x.chain > 0) locked.push({ c: c0, cell: x });
      else plain++;
    }
    if (plain > 0 || !locked.length) return null;          // 还有能动的 → 不动它
    // 整行锁死（冰 + 链）：挑冰最少的一辆解冻，否则第 0 步就没有任何合法操作 → 必死候选。
    locked.sort(function (a, b) { return (a.cell.numice || 0) - (b.cell.numice || 0); });
    var pick = locked[0].cell, at = locked[0].c;
    var was = { numice: pick.numice || 0, chain: pick.chain || 0 };
    pick.numice = 0; pick.chain = 0;
    // 清孤立锁链（摘掉一端后，另一端的组就只剩 1 个成员了）
    var cnt = {};
    for (var r = 0; r < rows; r++) for (var cc = 0; cc < cols; cc++) {
      var b = cells[r][cc];
      if (b && b.t === 'box' && b.chain > 0) cnt[b.chain] = (cnt[b.chain] || 0) + 1;
    }
    for (var r2 = 0; r2 < rows; r2++) for (var c2 = 0; c2 < cols; c2++) {
      var b2 = cells[r2][c2];
      if (b2 && b2.t === 'box' && b2.chain > 0 && cnt[b2.chain] < 2) b2.chain = 0;
    }
    return { at: [0, at], was: was };
  }

  function finalizeProduce(cand, K, evaluated) {
    if (!cand) return cand;
    // 【v151】最终这一关的"选择余地"曲线（candScore 里已算过就复用）
    try {
      if (!cand._choiceCurve && cand.level && cand.solveResult) cand._choiceCurve = choiceCurve(AntSolver.parseLevel(cand.level), cand.solveResult);
      cand.choiceCurve = cand._choiceCurve || null;
    } catch (e) { cand.choiceCurve = null; }
    cand.candidates = K;
    cand.treeEvaluated = evaluated;
    // 死亡边界救援必须在算档次与改写 audit.pass 之前——救援会替换 level/solveResult/audit，
    // 之后的分档与结论都应基于救援后的关卡。默认关闭，原两种模式不受影响。
    try { rescueDeathEdge(cand); } catch (e) { if (cand) cand.rescue = { applied: false, error: String(e && e.message || e) }; }
    // 必须在改写 audit.pass 之前算档次——candTier() 读的是【原始】audit.pass(是否真困难合格)，
    // finalizeProduce 稍后会把 audit.pass 覆写成"整体合格"，届时语义已变，不能再用来分档。
    var tier = candTier(cand);
    cand.fallback = tier < 2;
    if (cand.fallback) {
      cand.fallbackTier = tier;
      cand.fallbackType = cand.timedOut ? 'timeout' : 'exhausted';
      cand.fallbackReason = tier === 1
        ? (cand.fallbackType === 'timeout' ? '超时兜底：已选安全候选(可通关但未形成合格卡点)' : '遍历完兜底：候选树穷尽仍无合格候选，已选安全候选(可通关但未形成合格卡点)')
        : (cand.fallbackType === 'timeout' ? '超时兜底：候选树内最接近标准的候选，仍不合格' : '遍历完兜底：候选树穷尽仍无合格候选，已选最接近标准的候选，仍不合格');
    } else {
      cand.fallbackTier = null; cand.fallbackType = null; cand.fallbackReason = null;
    }
    if (cand.audit && cand.generationEval) {
      // 注意：此处 audit.pass 被改写为【整体合格】(困难合格 或 简单合格，且双方可通关)，不再等于"困难合格"本身。
      //   要区分困难/简单合格，认 audit.tier(在 chokepointAudit 里已定好，此处不改写)：'困难合格'|'简单合格'|'不合格'。
      cand.audit.pass = !!cand.generationEval.pass;
      cand.audit.playerWon = !!cand.generationEval.player.won;
      cand.audit.playerRevives = cand.generationEval.player.revives || 0;
      cand.audit.playerReviveCap = cand.generationEval.player.reviveCap != null ? cand.generationEval.player.reviveCap : 2;
      cand.audit.generationScore = cand.generationEval.score;
      if (!cand.generationEval.player.won && cand.audit.reasons.indexOf('玩家版未通关(真人打不通)') < 0)
        cand.audit.reasons.push('玩家版未通关(真人打不通)');
      else if (cand.generationEval.player.won && cand.audit.playerRevives >= cand.audit.playerReviveCap && cand.audit.reasons.indexOf('玩家版险胜(用尽复活)') < 0)
        cand.audit.reasons.push('玩家版险胜(用尽复活)');
      if (cand.generationEval.player.peak >= cand.level.bufferLimit && cand.audit.reasons.indexOf('玩家版暂存触达上限(死亡边界)') < 0)
        cand.audit.reasons.push('玩家版暂存触达上限(死亡边界)');
      if (cand.timedOut && cand.audit.reasons.indexOf('超时兜底(已选树内最接近合格候选)') < 0)
        cand.audit.reasons.push('超时兜底(已选树内最接近合格候选)');
      if (cand.fallback && cand.audit.reasons.indexOf(cand.fallbackReason) < 0)
        cand.audit.reasons.push(cand.fallbackReason);
    }

    // ===== 多轮难度标定（任务 ANT-DIFF-MULTIROUND-PROD-20260901，用户 2026-09-01 批准）=====
    // 候选筛选阶段的 computeDifficulty 是单轮(快)；此处对【最终选中的这一关】用 recalibrateDifficulty
    // 跑 difficultyRounds 轮玩家路线、取最稳的一条重新标定，去掉单轮 seed7 的抽样抖动。
    //   · 复用已求得的 solveResult 作 omni，不重解；只多跑 R 次玩家模拟（solve 是确定性入口）。
    //   · 只改「难度分这一个数」，不影响 audit.pass / 合格判定（难度不决定合格）。
    //   · difficultyRounds ≤ 1 逐值回到旧单轮行为；救援等已在上方完成，此处基于最终 level/solveResult。
    var _dRounds = (cand && cand.config && parseInt(cand.config.difficultyRounds, 10)) || 1;
    if (_dRounds > 1 && AntSolver.Analysis && typeof AntSolver.Analysis.recalibrateDifficulty === 'function' && cand && cand.level && cand.solveResult) {
      try {
        // 【必须无条件重解析 cand.level，不得走任何缓存的 parsed】
        //   rescueDeathEdge 成功时会替换 cand.level / cand.solveResult / cand.audit，但【不】同步
        //   任何缓存的 parsed。此处若优先取缓存 parsed，就会出现「PlayerSim 与 f3 跑救援前的旧关卡、
        //   omni 却来自救援后的新关卡」的混合口径难度分。
        //   现状核实(2026-09-01)：generateFromBlocksFixed 返回的候选对象逐字段列举、并不含 parsed，
        //   故原写法 `cand.parsed || parseLevel(...)` 实际恒走后者、缺陷未显现（已用 v120 方案
        //   deathEdgeRescue=true 真跑 3 个救援成功关确认 cand.parsed 恒为 undefined）。
        //   但那是「靠上游恰好不挂字段」维持的正确性 —— 一旦将来任何路径给候选挂上 parsed，
        //   缺陷立即变成真的且静默。故去掉短路，让同源性由本行自身保证。
        var _finLv = AntSolver.parseLevel(cand.level);
        var _rc = AntSolver.Analysis.recalibrateDifficulty(_finLv, {
          runs: _dRounds, omni: cand.solveResult,
          bottomOnly: !!(cand.config.bottomOnly), instantChain: !!(cand.config.instantChain)
        });
        if (_rc && _rc.difficulty) {
          cand.difficultySingle = cand.difficulty;               // 保留单轮值供对照
          cand.difficulty = _rc.difficulty;
          cand.difficulty.calibration = {
            mode: 'multiRound', rounds: _dRounds, rankable: !!_rc.rankable,
            scoreMedian: _rc.stability ? _rc.stability.scoreMedian : null,
            scoreRange: _rc.stability ? _rc.stability.scoreRange : null,
            winRate: _rc.stability ? _rc.stability.winRate : null,
            distinctRoutes: _rc.stability ? _rc.stability.distinctRoutes : null,
            degenerate: _rc.stability ? _rc.stability.degenerate : null,
            chosenPickThreshold: _rc.chosen ? _rc.chosen.pickThreshold : null,
            singleScore: cand.difficultySingle ? cand.difficultySingle.score : null
          };
        }
      } catch (e) { cand.difficultyCalibError = String(e && e.message || e); }
    }

    // 【v184】好关判据 v3 收尾标记：只记录，不影响选择与合格判定
    if (cand && cand.level && cand.solveResult && (!cand.config || cand.config.goodV3 !== false)) {
      try {
        var _gv3 = goodV3Of(cand);
        if (_gv3) {
          cand.goodV3 = _gv3;
          if (cand.generationEval) cand.generationEval.goodV3 = _gv3;
        }
      } catch (e) { cand.goodV3Error = String((e && e.message) || e); }
    }

    // 【v192·实验】收尾调压一次：峰窗越界时按比例调冰重建，取更接近带的那一个
    if (cand && cand.goodV3 && cand.level && cand.config && cand.config.pressureLoop) {
      try {
        var _pl = pressureLoopOnce(cand);
        if (_pl) {
          cand.pressureLoop = _pl.meta;
          if (_pl.cand) { _pl.cand.pressureLoop = _pl.meta; cand = _pl.cand; }
        }
      } catch (e) { cand.pressureLoop = { error: String((e && e.message) || e) }; }
    }

    // 【v240】第 0 行不硬禁功能块，只在"整行锁死"时解冻一辆保开局（见 ensureRow0Opening 注释）
    try {
      var _iceCut = capRow0Ice(cand && cand.level, cand && cand.config ? cand.config.row0IceMax : 1);
      if (_iceCut > 0) cand.row0IceCapped = _iceCut;
    } catch (e) { cand.row0IceCapError = String((e && e.message) || e); }
    try {
      var _open = ensureRow0Opening(cand && cand.level);
      if (_open) cand.row0OpeningFix = _open;
    } catch (e) { cand.row0OpeningError = String((e && e.message) || e); }

    return cand;
  }

  /**
   * 窄路推理陷阱：将墙下(gated)区域的盒与墙上方的【早序】盒交换一部分，
   * 使墙下持有早色所需盒(被缺口冰锁住) → 制造"锁住关键盒"的推理压力。
   * frac 控制交换比例(0~1)；只交换 box 格，保序可解由外层求解器校验/重试兜底。
   */
  function applyNarrowTrap(cells, rows, cols, narrowGaps, config) {
    var frac = (typeof config.narrowPathTrapFrac === 'number') ? config.narrowPathTrapFrac : 0.5;
    if (frac <= 0) return;
    // 最深墙行(取所有墙行最大 r)以下为 gated 区
    var wallR = 0;
    for (var i = 0; i < narrowGaps.length; i++) wallR = Math.max(wallR, narrowGaps[i].r);
    var gated = [], above = [];
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
      var cell = cells[r][c];
      if (!cell || cell.t !== 'box') continue;
      if (r > wallR) gated.push({ r: r, c: c }); else above.push({ r: r, c: c });
    }
    if (!gated.length || !above.length) return;
    // 墙上方按 _seq 升序(最早序在前)；gated 按 _seq 降序(最晚序在前)
    above.sort(function(a, b) { return (cells[a.r][a.c]._seq || 0) - (cells[b.r][b.c]._seq || 0); });
    gated.sort(function(a, b) { return (cells[b.r][b.c]._seq || 0) - (cells[a.r][a.c]._seq || 0); });
    var k = Math.min(above.length, gated.length, Math.max(1, Math.round(gated.length * frac)));
    for (var j = 0; j < k; j++) {
      var ga = gated[j], ab = above[j];
      if (cells[ga.r][ga.c]._seq <= cells[ab.r][ab.c]._seq) break; // 已无更早序可换入 → 停止
      var tmp = cells[ga.r][ga.c];
      cells[ga.r][ga.c] = cells[ab.r][ab.c];
      cells[ab.r][ab.c] = tmp;
    }
  }

  /** 统计棋盘上某类型 cell 的数量。 */
  function countCellsOfType(cells, type) {
    var n = 0;
    for (var r = 0; r < cells.length; r++)
      for (var c = 0; c < cells[r].length; c++)
        if (cells[r][c] && cells[r][c].t === type) n++;
    return n;
  }

  // ==================== 墙体形态约束（black/pipe 通用） ====================
  // 规则：① 不得组成 2×2 墙块(矩形)；② 任意直线最多 3 面墙相连；③ 棋盘边缘也视作墙、同样遵循以上规则。
  /** (r,c) 是否为"墙"（black/pipe）；越界视作墙(边缘=墙)。 */
  function isWallAt(cells, rows, cols, r, c) {
    if (r < 0 || r >= rows || c < 0 || c >= cols) return true; // 边缘视作墙
    var cell = cells[r][c];
    return !!(cell && (cell.t === 'black' || cell.t === 'pipe'));
  }
  /** 若在 (r,c) 放墙是否违反形态约束(2×2墙块 / 直线>3连；边缘计为墙)。 */
  function wouldViolateWall(cells, rows, cols, r, c) {
    function W(rr, cc) { if (rr === r && cc === c) return true; return isWallAt(cells, rows, cols, rr, cc); }
    // ① 2×2 墙块：四个含(r,c)的窗口
    var starts = [[r - 1, c - 1], [r - 1, c], [r, c - 1], [r, c]];
    for (var i = 0; i < starts.length; i++) {
      var tr = starts[i][0], tc = starts[i][1];
      if (W(tr, tc) && W(tr, tc + 1) && W(tr + 1, tc) && W(tr + 1, tc + 1)) return true;
    }
    // ② 水平直线连(触边缘则各 +1 计一段墙)
    var left = 0, cc = c - 1; while (cc >= 0 && W(r, cc)) { left++; cc--; }
    var right = 0; cc = c + 1; while (cc < cols && W(r, cc)) { right++; cc++; }
    var hlen = left + right + 1;
    if (c - left === 0) hlen++;
    if (c + right === cols - 1) hlen++;
    if (hlen > 3) return true;
    // ② 垂直直线连
    var up = 0, rr = r - 1; while (rr >= 0 && W(rr, c)) { up++; rr--; }
    var down = 0; rr = r + 1; while (rr < rows && W(rr, c)) { down++; rr++; }
    var vlen = up + down + 1;
    if (r - up === 0) vlen++;
    if (r + down === rows - 1) vlen++;
    if (vlen > 3) return true;
    return false;
  }

  /** 一组锁链候选成员是否与【其他锁链组】8-向相邻（两对不同锁链不能相邻）。 */
  function chainGroupConflict(cells, rows, cols, members, group) {
    var dirs8 = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];
    var mset = {};
    for (var i = 0; i < members.length; i++) mset[members[i].r + ',' + members[i].c] = true;
    for (var m = 0; m < members.length; m++) {
      for (var d = 0; d < 8; d++) {
        var nr = members[m].r + dirs8[d][0], nc = members[m].c + dirs8[d][1];
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        if (mset[nr + ',' + nc]) continue;             // 本组成员相邻允许
        var cell = cells[nr][nc];
        if (cell && cell.t === 'box' && cell.chain > 0 && cell.chain !== group) return true; // 邻到别组
      }
    }
    return false;
  }

  /**
   * 窄路卡点：在棋盘中后部选行，用黑块铺满整行（仅留【单一缺口】列）→ 缺口下方区域只能经缺口暴露。
   * 即"唯一可达不可绕路"的窄路。要求：
   *  - 墙行 ∈ [0.4,0.7]×rows，非第0行/末行（黑块不可在末行）；墙行之间不相邻。
   *  - 缺口列当前为空(未来盒格)，且其下方至少有一个空格(有盒可被 gated)。
   *  - 建墙后所有空(未来盒)格仍从顶部经空格可达(经缺口)；否则撤销该墙。
   * 在空网格(尚未铺盒)上操作；黑块占格 → 盒铺在其余格，溢出走管道。
   * @returns {Array} 缺口格 [{r,c},...]
   */
  function reserveNarrowWalls(cells, rows, cols, config) {
    if (cols < 4 || rows < 5) return []; // 太小/太窄无法形成有意义的窄路
    // 活口数：范围 [min,max] 内随机（向后兼容旧 narrowPathGaps>0 固定值）
    var gapWant;
    if (config.narrowPathGaps > 0) {
      gapWant = clampInt(config.narrowPathGaps, 1, 1, 6);
    } else {
      var gmin = clampInt(config.narrowPathGapsMin, 1, 1, 6);
      var gmax = clampInt(config.narrowPathGapsMax, 2, gmin, 6);
      gapWant = gmin + Math.floor(rnd() * (gmax - gmin + 1));
    }

    // 尝试多次构造"不规律锯齿(斜向)+边缘锚定+连通楼梯"墙，直到形成合法窄路。
    for (var attempt = 0; attempt < 8; attempt++) {
      // 1) 基准行(中后部) + 逐列随机游走(步长≤1，约40%概率移动) → 平缓斜向/锯齿折线（不规律但墙体不厚）
      var baseR = Math.max(2, Math.min(rows - 3, Math.round(rows * (0.48 + rnd() * 0.2))));
      var f = [baseR];
      for (var c = 1; c < cols; c++) {
        var step = [-1, 0, 0, 0, 1][Math.floor(rnd() * 5)];
        var rr = f[c - 1] + step;
        if (rr < 1) rr = 1; if (rr > rows - 2) rr = rows - 2;
        f.push(rr);
      }
      // 2) 缺口列：内部列(非最边缘)随机取 gapWant 个，尽量拉开
      var inner = [];
      for (var ic = 1; ic < cols - 1; ic++) inner.push(ic);
      shuffle(inner);
      var gapCols = {};
      var chosen = [];
      for (var gi = 0; gi < inner.length && chosen.length < gapWant; gi++) {
        var ok = true;
        for (var cj = 0; cj < chosen.length; cj++) if (Math.abs(chosen[cj] - inner[gi]) <= 1) ok = false;
        if (ok) { chosen.push(inner[gi]); gapCols[inner[gi]] = true; }
      }
      if (chosen.length === 0) continue;

      // 3) 建连通楼梯墙：逐列在 f[c] 放黑；相邻列高度差用竖直连接补齐(两两连接)；缺口列断开。
      //    墙锚定左右边缘(边缘也是墙) → 除缺口外前后被完整分隔。
      var placed = [];
      var prevR = null;
      for (var cc = 0; cc < cols; cc++) {
        if (gapCols[cc]) { prevR = null; continue; }
        var a, b;
        if (prevR === null) { a = f[cc]; b = f[cc]; }
        else { a = Math.min(prevR, f[cc]); b = Math.max(prevR, f[cc]); }
        for (var rr2 = a; rr2 <= b; rr2++) {
          if (rr2 < 1 || rr2 > rows - 2) continue;      // 墙不在第0/末行
          if (cells[rr2][cc] != null) continue;
          if (wouldViolateWall(cells, rows, cols, rr2, cc)) continue; // 违反形态约束(2×2/直线>3)则跳过
          cells[rr2][cc] = { t: 'black' }; placed.push([rr2, cc]);
        }
        prevR = f[cc];
      }
      if (placed.length === 0) continue;

      // 4) 校验：所有空(未来盒)格仍从顶部经空格可达(必经缺口)。否则整墙撤销重试。
      if (!nullCellsReachable(cells, rows, cols)) {
        for (var p = 0; p < placed.length; p++) cells[placed[p][0]][placed[p][1]] = null;
        continue;
      }
      // 5) 缺口格 = 各缺口列在墙带高度(f)的盒格 → 后续加冰"临时锁路/临时连接窄路"
      var gaps = [];
      for (var k = 0; k < chosen.length; k++) {
        var gcCol = chosen[k];
        var gr = f[gcCol];
        if (gr < 0) gr = baseR;
        gaps.push({ r: gr, c: gcCol });
      }
      return gaps;
    }
    return [];
  }

  /**
   * 从 list 前 rangeSize 个候选中随机取 count 个（对齐 bin _pickFromCandidateRange）。
   * 返回 { picked, remainder }（remainder=窗口内未取走的剩余，供下一行累加）。
   */
  function pickFromCandidateRange(list, rangeSize, count) {
    var actualRange = Math.min(rangeSize, list.length);
    var actualCount = Math.min(count, actualRange);
    var picked = [];
    for (var i = 0; i < actualCount; i++) {
      var idx = Math.floor(rnd() * actualRange);
      picked.push(list[idx]);
      list.splice(idx, 1);
      actualRange--;
    }
    return { picked: picked, remainder: Math.max(0, actualRange) };
  }

  /**
   * 为管道(r,c)随机选一个方向(11上/12右/13下/14左)，要求出口格在盘内且当前为空(未来盒格)。
   * 返回方向或 -1（无合法方向）。
   */
  function choosePipeDir(cells, rows, cols, r, c, exitSet) {
    var dirs = [11, 12, 13, 14];
    shuffle(dirs);
    for (var i = 0; i < dirs.length; i++) {
      var dv = AntSolver.PIPE_DIRS[dirs[i]];
      var er = r + dv[0], ec = c + dv[1];
      if (er < 0 || er >= rows || ec < 0 || ec >= cols) continue;
      if (er === 0) continue;               // 出口不落在第0行（第二行管道不可朝上）
      if (cells[er][ec] != null) continue;  // 出口须为空(未来盒格)
      if (exitSet && exitSet[er + ',' + ec]) continue; // 出口不可与其他管道共用同一格
      return dirs[i];
    }
    return -1;
  }

  /**
   * P1 守恒反推管道数：溢出盒 D 由 P 个管道吸收，每管最终容量 = 1 + D/P 需落在
   * [pipeMinFill, pipeMaxDepth]，故 P ∈ [⌈D/(maxDepth−1)⌉, ⌊D/(minFill−1)⌋]；
   * 取区间中部（目标每管容量约为两端均值）并夹到区间；D 极小时兜底单管（容量可低于 minFill）。
   * 口径：第一遍逐格单扫每管先进 1 个盒，第二遍把剩余 D 个盒均匀补入 → 每管 1+D/P。
   *
   * 深度参数化（ANT-GEN-PIPE-DEPTH-FALLBACK-20260825）：默认 minFill=4 / maxDepth=6 时
   * 区间为 [⌈D/5⌉, ⌊D/3⌋]、目标 ≈⌈D/4⌉，**与参数引入前逐值等价**。
   * 该函数只在 usableSpaceTarget 关闭时生效（开启时管道数由 solveSpaceQuota 联立给出）。
   */
  function pipeCountByConservation(D, config) {
    if (D <= 0) return 0;
    var maxDepth = pipeDepthOf(config), minFill = pipeMinFillOf(config);
    var hiDiv = Math.max(1, maxDepth - 1);   // 每管最多再补 maxDepth−1 个（首扫已占 1 格）
    var loDiv = Math.max(1, minFill - 1);    // 每管至少再补 minFill−1 个
    var pMin = Math.ceil(D / hiDiv), pMax = Math.floor(D / loDiv);
    if (pMax < pMin) pMax = pMin;            // D 极小：区间为空 → 兜底单管
    var p = Math.round(D / Math.max(1, Math.round((hiDiv + loDiv) / 2)));  // 目标每管容量取区间中部
    if (p < pMin) p = pMin;
    if (p > pMax) p = pMax;
    if (p < 1) p = 1;
    return p;
  }

  // 棋盘上管道队列的最大深度（P1b 兜底判据：超过 pipeMaxDepth 即容量错位，需重随机尺寸/增盒容量减盒）
  function maxPipeDepth(board) {
    var mx = 0;
    if (!board || !board.cells) return 0;
    for (var r = 0; r < board.cells.length; r++) {
      var row = board.cells[r];
      for (var c = 0; c < row.length; c++) {
        var cell = row[c];
        if (cell && cell.t === 'pipe' && cell.queue && cell.queue.length > mx) mx = cell.queue.length;
      }
    }
    return mx;
  }

  /**
   * 规划管道数量（历史函数：P1 起 buildBoard 改用 pipeCountByConservation；保留供参考/回退）。
   * 让 overflow 个溢出球以【每管 ballMin~ballMax 球】分布，
   * 数量尽量落入目标 [pMin,pMax]。返回管道数（round-robin 分配即得每管 3~6 球）。
   * - 目标数比可行范围多(需每管<ballMin) → 取可行上限(hi)
   * - 目标数比可行范围少(需每管>ballMax) → 取可行下限(lo)，即"降低6球管道、增开3-4球管道对齐数量"由 hi 侧实现
   */
  function planPipeCount(overflow, pMin, pMax, ballMin, ballMax) {
    if (overflow <= 0) return 0;
    var lo = Math.ceil(overflow / ballMax);          // 最少管道(每管装满 ballMax)
    var hi = Math.max(1, Math.floor(overflow / ballMin)); // 最多管道(每管 ballMin)
    if (hi < lo) hi = lo;                             // overflow<ballMin 边界
    var dMin = pMin > 0 ? pMin : lo;
    var dMax = pMax > 0 ? pMax : hi;
    var iLo = Math.max(lo, dMin), iHi = Math.min(hi, dMax);
    var count;
    if (iLo <= iHi) count = Math.round((iLo + iHi) / 2); // 交集内取中
    else if (dMax < lo) count = lo;                      // 想要更少但会超 ballMax → 用可行下限(保 ≤ballMax)
    else count = hi;                                     // 想要更多但会低于 ballMin → 用可行上限(尽量多管、少球)
    return Math.max(1, count);
  }

  /** 满盘版选管道方向：出口须为【盒格】(游戏内被消除后吐球)、非第0行、盘内。 */
  function choosePipeDirFull(cells, rows, cols, r, c, exitSet) {
    var dirs = [11, 12, 13, 14]; shuffle(dirs);
    for (var i = 0; i < dirs.length; i++) {
      var dv = AntSolver.PIPE_DIRS[dirs[i]];
      var er = r + dv[0], ec = c + dv[1];
      if (er < 0 || er >= rows || ec < 0 || ec >= cols) continue;
      if (er === 0) continue;
      if (exitSet && exitSet[er + ',' + ec]) continue; // 出口不可与其他管道共用
      var ecl = cells[er][ec];
      if (!ecl || ecl.t !== 'box') continue;
      return dirs[i];
    }
    return -1;
  }

  /** 满盘时新建一个管道：把某内部普通盒格转为管道(其盒进队列)，遵循墙形态约束+不破坏可达+出口不与现有管道共用。 */
  function createPipeOnFull(cells, rows, cols, pipeList) {
    // 现有管道出口集合(出口不可共用)
    var exitSet = {};
    for (var pj = 0; pj < pipeList.length; pj++) {
      var pp = pipeList[pj], dvp = AntSolver.PIPE_DIRS[pp.dir];
      if (dvp) exitSet[(pp.r + dvp[0]) + ',' + (pp.c + dvp[1])] = true;
    }
    var cand = [];
    for (var r = 1; r < rows - 1; r++) for (var c = 0; c < cols; c++) {
      var ce = cells[r][c];
      if (ce && ce.t === 'box' && !(ce.numice > 0) && !(ce.chain > 0) && !ce.q && !exitSet[r + ',' + c]) cand.push({ r: r, c: c }); // 跳过障碍/缺口盒/他管出口
    }
    shuffle(cand);
    for (var i = 0; i < cand.length; i++) {
      var r = cand[i].r, c = cand[i].c;
      if (wouldViolateWall(cells, rows, cols, r, c)) continue;      // 管道也是墙，遵循形态约束
      var dir = choosePipeDirFull(cells, rows, cols, r, c, exitSet);
      if (dir < 0) continue;
      var box = cells[r][c];
      cells[r][c] = { t: 'pipe', dir: dir, queue: [{ color: box.color, count: box.count }], next: 0 };
      if (!isAllBoxesReachable(cells, rows, cols)) { cells[r][c] = box; continue; } // 破坏可达则撤销
      var p = { r: r, c: c, dir: dir }; pipeList.push(p); return p;
    }
    return null;
  }

  /**
   * 输出前确保棋盘被填满：若存在空洞(null)，则【强制减少最末行】——末行的球转入管道队列，
   * 并用管道队列的球回填中部残洞；如无管道则新建。循环至无空洞或触底(保留≥3行)。
   * @returns {{rows:number, cols:number, cells:Array}}
   */
  function ensureBoardFull(cells, rows, cols, pipeList) {
    function hasNull() { for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) if (cells[r][c] == null) return true; return false; }
    var guard = rows + 2;
    // 【v331·用户裁决】形态约束 列−行 ≤ 2：裁行不能把盘裁成长条。
    //   实测 7×9 被裁成 5×9（差 4）、6×8 被裁成 4×7（差 3），用户："太长方形了"。
    //   所以只允许裁到"差 ≤ 2"为止；裁不动了就把剩下的洞补成黑块（下面的 v331 补洞）。
    var _maxTrim = Math.max(0, rows - (cols - 2));
    var _trimmed = 0;
    // 【v338】裁行会让"格数 < 车数"→ 多出来的车被塞进管道。宁可留 1~2 个空格补黑块，也不裁。
    var _carsN = 0;
    for (var _cr = 0; _cr < rows; _cr++) for (var _cc2 = 0; _cc2 < cols; _cc2++) if (cells[_cr][_cc2] && cells[_cr][_cc2].t === 'box') _carsN++;
    while (hasNull() && rows > 3 && guard-- > 0 && _trimmed < _maxTrim && (rows - 1) * cols >= _carsN) {
      // 1) 收集并移除最末行（末行按规则无黑/管道，仅盒或空）
      var last = rows - 1, surplus = [];
      for (var c = 0; c < cols; c++) { var ce = cells[last][c]; if (ce && ce.t === 'box') surplus.push({ color: ce.color, count: ce.count }); }
      cells.splice(last, 1); rows--; _trimmed++;
      for (var pi = pipeList.length - 1; pi >= 0; pi--) if (pipeList[pi].r >= rows) pipeList.splice(pi, 1); // 理论上管道不在末行
      // 2) 多余球补充为管道队列（无管道则新建）
      if (surplus.length) {
        if (pipeList.length === 0) createPipeOnFull(cells, rows, cols, pipeList);
        if (pipeList.length > 0) {
          for (var s = 0; s < surplus.length; s++) { var p = pipeList[s % pipeList.length]; cells[p.r][p.c].queue.push(surplus[s]); }
        }
      }
      // 3) 中部残洞：从管道队列取球回填为盒（球无墙规则限制），尽量不额外裁行
      for (var r3 = 0; r3 < rows; r3++) for (var c3 = 0; c3 < cols; c3++) {
        if (cells[r3][c3] != null) continue;
        var got = null;
        for (var pk = 0; pk < pipeList.length; pk++) { var pc = cells[pipeList[pk].r][pipeList[pk].c]; if (pc.queue && pc.queue.length) { got = pc.queue.pop(); break; } }
        if (got) cells[r3][c3] = { t: 'box', color: got.color, count: got.count, chain: 0, q: false, numice: 0 };
      }
    }
    // 【v331·用户裁决】裁行到形态上限后仍有空洞 → 直接把洞补成黑块（不再继续裁成长条）。
    //   黑块是纯墙、不产生票，对守恒无影响；后面 buildBoard 的黑块比例统计会自然把它算进去。
    try {
      for (var _fr = 0; _fr < rows; _fr++) for (var _fc = 0; _fc < cols; _fc++) {
        if (cells[_fr][_fc] == null) cells[_fr][_fc] = { t: 'black' };
      }
    } catch (e) { }
    return { rows: rows, cols: cols, cells: cells };
  }

  /**
   * 在 [0,cols) 上均匀取 n 列（历史遗留，管道现用分散放置）。
   */
  function spreadCols(cols, n) {
    if (n <= 0) return [];
    if (n === 1) return [Math.floor(cols / 2)];
    var res = [];
    for (var i = 0; i < n; i++) res.push(Math.round(i * (cols - 1) / (n - 1)));
    // 去重
    var seen = {}, out = [];
    for (var j = 0; j < res.length; j++) { if (!seen[res[j]]) { seen[res[j]] = 1; out.push(res[j]); } }
    // 不足则补空位
    for (var c = 0; out.length < n && c < cols; c++) if (!seen[c]) { seen[c] = 1; out.push(c); }
    return out.slice(0, n);
  }

  /**
   * 求解引导式蚂蚁盒生成
   * 
   * 模拟真实的蚂蚁消除：从边界向内，每次选一种颜色，用flood-fill消除一个盒容量的量。
   * 记录每次实际消除的 (颜色, 数量)，形成保证可解的盒序列。
   * 
   * 策略：每步选择"当前可达像素数最多"的颜色，按【盒容量策略】取一个容量消除。
   * 守恒原则：每种颜色的总像素 = 该色所有盒 count 之和（flood-fill 消到无剩为止，天然守恒）。
   * 容量策略 boxSizeMode：
   *   'random'(默认) 每盒在 [boxMin,boxMax] 内随机 → 制造容量大小差距(利于管道/卡点预期)
   *   'max'          每盒取 boxMax(旧行为，盒接近满容量)
   *   'min'          每盒取 boxMin(盒偏小、盒数多)
   * 后续可在此扩展"按卡点/管道预期"的定向策略。
   */
  /**
   * 盒容量采样器（三个铺盒函数共用一份，避免同一策略在三处各写一遍导致口径分裂）。
   *
   * mode 取值：
   *   'random'(默认) 区间内均匀随机——原行为，不动
   *   'max' / 'min'  取上界 / 下界——原行为，不动
   *   'polar'        【新增】两极化采样：以 boxSizePolarBias 的概率落进区间两端的窄带，
   *                  否则全区间均匀。用于「同色盒之间的容量差距要大、且差值大的占比要高」
   *                  （用户 2026-08-04 对四方向瞬时连锁生产逻辑的要求）。
   *
   * 为什么均匀随机不够：均匀分布在 [a,b] 上任取两值，差值期望只有 (b-a)/3。
   *   35~80 区间下期望差 15，中间值占多数，"大差距"是少数派。
   *   两极化把概率质量推到两端后，随机两盒的差值期望显著上升，且大差值成为多数。
   *
   * 参数：boxSizePolarBias 两端命中概率(默认 0.7)；boxSizePolarBandRatio 窄带宽度占区间比例(默认 0.25)。
   */
  /**
   * 本关是否建窄路墙（用户 2026-08-04：窄路必定出现，改为按概率 p 出现）。
   * narrowPathProb 缺省或 ≥1 时恒为 true，即与该参数引入前完全一致；≤0 时恒不出现。
   * 两个铺盒流程（旧 buildBoard 与新 buildStructureCandidateFixed）共用本判定，避免口径分裂。
   */
  function narrowPathHits(config) {
    var p = (config && config.narrowPathProb != null) ? parseFloat(config.narrowPathProb) : 1;
    if (!(p >= 0)) p = 1;                 // 非法值按默认必定出现处理
    if (p >= 1) return true;
    if (p <= 0) return false;
    return rnd() < p;
  }

  /**
   * 【v115】按区间采样一组参数，返回叠加后的新 config（不改入参）。
   * 任务 `ANT-GEN-PARAM-RANGE-CHOKE-PROB-20260827`，用户裁决「不同的候选都可以随机选取参数限制范围内」。
   *
   * 调用时机：produceFixed 的候选循环每轮一次 → 同一关的 K 个候选各拿一组不同参数，
   * 解决「当前批次关卡都是同样的参数，输出的关卡结构会同质化」。
   *
   * 兼容口径：某项的 Min/Max 只要有一个为 null，就退回读同名单值参数（`icePercent` 等），
   * 即「只给单值 → 视为 min=max」。因此旧方案文件（`方案文件夹/*.json`）逐值不失效。
   *
   * 采样值一并写进 `_sampled`，供逐关记录落库与事后追溯（否则批次里参数波动了却无从查证）。
   *
   * 【注意】后段自动削减（黑 ×0.85 / 冰 ×0.9 / 链 ×0.85，见 buildStructureCandidateFixed）
   * 保留且作用在采样值之上（用户裁决「保留」），故实际值可能低于设定下限 —— 这是已知且预期的。
   */
  function sampleRangedConfig(config) {
    // 【v208·修】原来这里叫 rnd(lo,hi,isInt)，函数体里又调用 rnd() ——
    //   局部函数遮蔽了模块级随机源，变成了**自己调自己**：min<max 时返回 NaN。
    //   后果：所有"区间参数"（冰/链/问号/黑块/管道…）被采样成 NaN → 实际全是 0，
    //   关卡里几乎看不到数字冰、锁链只有一组。改名 rndRange，随机数走模块级 rnd()。
    function rndRange(lo, hi, isInt) {
      if (lo > hi) { var t = lo; lo = hi; hi = t; }
      if (lo === hi) return lo;
      var v = lo + rnd() * (hi - lo);
      return isInt ? Math.round(v) : v;
    }
    // single: 单值参数名；lo/hi: 区间参数名；isInt: 是否取整
    function pick(single, lo, hi, isInt) {
      var a = config[lo], b = config[hi];
      if (a == null || b == null) return config[single];   // 未设区间 → 用单值（旧方案兼容）
      return rndRange(a, b, isInt);
    }
    var s = {
      icePercent: pick('icePercent', 'icePercentMin', 'icePercentMax', true),
      blackPercent: pick('blackPercent', 'blackPercentMin', 'blackPercentMax', true),
      chainCount: pick('chainCount', 'chainCountMin', 'chainCountMax', true),
      questionPercent: pick('questionPercent', 'questionPercentMin', 'questionPercentMax', true),
      minPipes: pick('minPipes', 'minPipesMin', 'minPipesMax', true),
      pipeMaxDepth: pick('pipeMaxDepth', 'pipeMaxDepthMin', 'pipeMaxDepthMax', true),
      // 可用空间目标是比例（0~1），不取整
      usableSpaceTarget: pick('usableSpaceTarget', 'usableSpaceTargetMin', 'usableSpaceTargetMax', false)
    };
    var out = Object.assign({}, config, s);
    out._sampled = s;
    return out;
  }

  function makeCapPicker(config) {
    var boxMin = config.boxSizeMin || 40;
    var boxMax = config.boxSizeMax || 56;
    if (boxMax < boxMin) { var t = boxMin; boxMin = boxMax; boxMax = t; }
    var mode = config.boxSizeMode || 'random';
    var span = boxMax - boxMin;
    var bias = (config.boxSizePolarBias != null) ? config.boxSizePolarBias : 0.7;
    var bandRatio = (config.boxSizePolarBandRatio != null) ? config.boxSizePolarBandRatio : 0.25;
    var band = Math.max(0, Math.round(span * bandRatio));
    function uniform(lo, hi) { return lo + Math.floor(rnd() * (hi - lo + 1)); }
    return function pickCap() {
      if (mode === 'max') return boxMax;
      if (mode === 'min') return boxMin;
      if (mode === 'polar' && span > 0) {
        if (rnd() < bias) {
          return (rnd() < 0.5) ? uniform(boxMin, boxMin + band)   // 低端窄带
            : uniform(boxMax - band, boxMax);                              // 高端窄带
        }
        return uniform(boxMin, boxMax);                                    // 其余仍全区间均匀
      }
      return uniform(boxMin, boxMax);                                      // random(默认)：区间内均匀随机
    };
  }

  function solverGuidedBoxes(blocks, config) {
    var rows = blocks.length, cols = blocks[0].length;
    var boxMin = config.boxSizeMin || 40;
    var boxMax = config.boxSizeMax || 56;
    if (boxMax < boxMin) { var t = boxMin; boxMin = boxMax; boxMax = t; }
    var pickCap = makeCapPicker(config);   // 三处铺盒共用同一采样器（含 polar 两极化）

    var Sim = AntSolver.Simulator;
    var bottomOnly = !!config.bottomOnly;
    // 初始 eliminated：仅与外部连通的空格（对齐引擎 computeReach）；bottomOnly 时只从底边连通区播种
    var eliminated = AntSolver.outsideReachSeed(blocks, rows, cols, bottomOnly);

    var boxes = [];
    var guard = rows * cols + 100; // 安全上限

    while (guard-- > 0) {
      var cap = pickCap();
      // 统计每种颜色当前可达的像素数（用flood-fill模拟；上限用 boxMax 以正确比较各色规模）
      var colorReach = countReachableByColor(eliminated, blocks, rows, cols, boxMax, bottomOnly);
      var colors = Object.keys(colorReach);
      if (colors.length === 0) break; // 全部消除完毕

      // 选可达数最多的颜色
      var bestColor = null, bestReach = 0;
      for (var i = 0; i < colors.length; i++) {
        if (colorReach[colors[i]] > bestReach) {
          bestReach = colorReach[colors[i]];
          bestColor = parseInt(colors[i]);
        }
      }
      if (bestColor === null) break;

      // 消除一个盒容量的量（本盒随机容量 cap，守恒由循环持续消除保证）
      var consumed = Sim.floodFillEliminate(eliminated, blocks, rows, cols, bestColor, cap, null, null, bottomOnly);
      if (consumed <= 0) break; // 无法继续（不应发生）

      boxes.push({ color: bestColor, count: consumed });
    }

    // 合并每种颜色尾部过小的盒子（自洽规则：最后一盒不满则与前一盒求和均分）
    boxes = mergeSmallTailBoxes(boxes, boxMin, boxMax);

    return boxes;
  }

  /**
   * 趋势/消除顺序盒序列（生产端接入 utils 的趋势分析）。
   *
   * 以 AntSolver.bottomTrendPixels 得到【目标图底→顶、行内左→右】的趋势像素流——它表达视觉/依赖
   * 消除趋势(先消底部、颜色可交错)，正是消除顺序视图的同一口径。像素按趋势流到达时装入该色当前开箱，
   * 达到本盒容量即封箱；每盒容量按 boxSizeMode 独立采样，保留“区间内随机”造成的大小差距(守恒由持续分箱保证)。
   * 盒最终按 trendStart(消除趋势先后)排序，其数组下标即【基础消除顺序 elimSeq】，供 buildBoard 顺序填入。
   *
   * 返回的盒序列真实可解性仍由外层 Solver.solve 判定/重试；此处只负责“趋势=消除顺序”的盒切分与排序。
   */
  /**
   * 【v148】像素"到图外的测地深度"：0 = 直接贴盘外；数越大越靠芯。
   *   用 0-1 BFS：穿过空格(0) 不花代价、穿过实心像素花 1 —— 也就是"要剥掉几层实心才够得着它"。
   *   这正是"消解波纹"的几何形状（不区分颜色；颜色由装箱那一步负责）。
   */
  function pixelDepthMap(blocks, rows, cols) {
    var INF = 1e9, dist = [];
    for (var r = 0; r < rows; r++) { var row = []; for (var c = 0; c < cols; c++) row.push(INF); dist.push(row); }
    var dq = [], head = 0;                       // 0-1 BFS 用双端队列（数组 + 头指针，够用且不依赖第三方）
    function pushFront(x) { dq.unshift(x); }
    function pushBack(x) { dq.push(x); }
    for (var r2 = 0; r2 < rows; r2++) for (var c2 = 0; c2 < cols; c2++) {
      if (!(r2 === 0 || r2 === rows - 1 || c2 === 0 || c2 === cols - 1)) continue;
      var w = (blocks[r2][c2] > 0) ? 1 : 0;       // 贴边的实心像素深度 1（要剥它自己），空格 0
      if (w < dist[r2][c2]) { dist[r2][c2] = w; if (w === 0) pushFront([r2, c2]); else pushBack([r2, c2]); }
    }
    var DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    while (head < dq.length) {
      var cur = dq[head++], cr = cur[0], cc = cur[1], cd = dist[cr][cc];
      if (cd > dist[cr][cc]) continue;
      for (var k = 0; k < 4; k++) {
        var nr = cr + DIRS[k][0], nc = cc + DIRS[k][1];
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        var w2 = (blocks[nr][nc] > 0) ? 1 : 0, nd = cd + w2;
        if (nd < dist[nr][nc]) {
          dist[nr][nc] = nd;
          if (w2 === 0) pushFront([nr, nc]); else pushBack([nr, nc]);
        }
      }
    }
    return dist;
  }

  /**
   * 【v148】切盒跨度：把"像素流"的先后在【趋势序】与【等深线序】之间插值。
   *   · span = 0 → 原样返回 bottomTrendPixels（**零值短路，口径逐字节不变**）
   *   · span > 0 → 两条序各自归一成名次 [0,1]，按 key = span·深度名次 + (1−span)·趋势名次 升序重排
   * 只改"像素先装谁"，装箱规则（同色累积到本盒容量即封箱）一格不动。
   */
  function cutSpanPixels(blocks, rows, cols, config) {
    var pixels = AntSolver.bottomTrendPixels(blocks, rows, cols);
    var span = parseFloat(config && config.boxCutSpan);
    if (!(span > 0) || pixels.length < 2) return pixels;
    span = Math.min(1, span);
    var depth = pixelDepthMap(blocks, rows, cols);
    // 【v148 探针】另一支排序：按【列】分组、列内按"到图外的深度"从外到内 ——
    //   一辆车 = 同一列里同色的一段，从盘边一路贯到深处 → 深度跨度最大（与"等深线序"正好相反）。
    //   用来检验"跨度大 → 压力大"这条理论是否只在一边成立。
    if (config && config.boxCutOrder === 'column') {
      var outC = pixels.slice();
      outC.sort(function (a, b) {
        return (a.c - b.c) || (depth[a.r][a.c] - depth[b.r][b.c]) || (a.trend - b.trend);
      });
      return outC;
    }
    var n = pixels.length;
    // 深度名次：按深度值排序后的名次（同深度保持稳定的趋势序）
    var byDepth = pixels.slice().sort(function (a, b) {
      var da = depth[a.r][a.c], db = depth[b.r][b.c];
      return (da - db) || (a.trend - b.trend);
    });
    var depthRank = {};
    for (var i = 0; i < n; i++) depthRank[byDepth[i].r + ',' + byDepth[i].c] = i / (n - 1 || 1);
    var out = pixels.slice();
    var score = {};
    for (var j = 0; j < n; j++) {
      var p = pixels[j];
      var tRank = (p.trend != null ? p.trend : j) / (n - 1 || 1);
      score[p.r + ',' + p.c] = span * depthRank[p.r + ',' + p.c] + (1 - span) * tRank;
    }
    out.sort(function (a, b) { return score[a.r + ',' + a.c] - score[b.r + ',' + b.c]; });
    return out;
  }

  /**
   * 【v221】剥离顺序的像素队列：外层优先 + 由下到上 + 由左到右。
   *   规则：只有"暴露"的像素可被取（贴边界，或贴着已被取走的像素）；
   *         候选里优先取【行号最大】（底部）、再【列号最小】（左侧）。
   *   这就是"模拟游玩"的取像素顺序，不是纯几何扫描。
   */
  function peelPixels(blocks, config) {
    var R = blocks.length, C = blocks[0].length;
    var taken = [], inQ = [], q = [];
    for (var r = 0; r < R; r++) { taken.push(new Array(C).fill(false)); inQ.push(new Array(C).fill(false)); }
    function exposed(r, c) {
      if (r === 0 || r === R - 1 || c === 0 || c === C - 1) return true;
      return taken[r-1][c] || taken[r+1][c] || taken[r][c-1] || taken[r][c+1];
    }
    function push(r, c) {
      if (r < 0 || r >= R || c < 0 || c >= C) return;
      if (blocks[r][c] <= 0 || taken[r][c] || inQ[r][c]) return;
      if (!exposed(r, c)) return;
      inQ[r][c] = true; q.push([r, c]);
    }
    // 初始边界：四方向入口 → 四条边都贴边，都可取
    for (var c0 = 0; c0 < C; c0++) { push(0, c0); push(R - 1, c0); }
    for (var r0 = 0; r0 < R; r0++) { push(r0, 0); push(r0, C - 1); }
    var out = [];
    while (q.length) {
      // 选：行号最大（底）、行相同取列最小（左）
      var bi = 0;
      for (var i = 1; i < q.length; i++) {
        var a = q[i], b = q[bi];
        if (a[0] > b[0] || (a[0] === b[0] && a[1] < b[1])) bi = i;
      }
      var sel = q.splice(bi, 1)[0], sr = sel[0], sc = sel[1];
      inQ[sr][sc] = false;
      taken[sr][sc] = true;
      out.push({ color: blocks[sr][sc], trend: out.length });
      push(sr-1, sc); push(sr+1, sc); push(sr, sc-1); push(sr, sc+1);
    }
    return out;
  }

  function baseFillBoxes(blocks, config) {
    var rows = blocks.length, cols = blocks[0].length;
    var boxMin = config.boxSizeMin || 40, boxMax = config.boxSizeMax || 56;
    if (boxMax < boxMin) { var t = boxMin; boxMin = boxMax; boxMax = t; }
    var pickCap = makeCapPicker(config);   // 三处铺盒共用同一采样器（含 polar 两极化）

    var pixels;
    if (config.cutPixelOrder === 'peel') {
      pixels = peelPixels(blocks, config);                   // 【v221】外层优先 + 底→上 + 左→右
    } else {
      pixels = cutSpanPixels(blocks, rows, cols, config);    // 【v148】趋势序 ↔ 等深线序
    }
    var boxes = [], active = {}, perColor = {}, capOf = {};
    // 【v308·用户裁决】容量按**颜色**定一次，不再每盒独立随机。
    //   原来 pickCap() 每盒重掷 → 白色（最多的颜色）被切成 35/22/58/41 一堆中等车，
    //   而用户要的是"最多的颜色 → 大车 → 车少 → 盘也小"。
    //   新规则：该色总量 ≥ 上限 → 直接用上限；否则整车一次装完（= 该色总量）。
    var colorTotal = {};
    for (var _ci = 0; _ci < pixels.length; _ci++) colorTotal[pixels[_ci].color] = (colorTotal[pixels[_ci].color] || 0) + 1;
    for (var i = 0; i < pixels.length; i++) {
      var p = pixels[i], box = active[p.color];
      if (!box) {
        box = { color: p.color, count: 0, trendStart: p.trend };
        active[p.color] = box; boxes.push(box);
        (perColor[p.color] = perColor[p.color] || []).push(box);
        if (capOf[p.color] == null) {
          var _T = colorTotal[p.color] || 0;
          capOf[p.color] = (_T >= boxMax) ? boxMax : Math.max(1, _T);
        }
      }
      box.count++;
      if (box.count >= capOf[p.color]) active[p.color] = null; // 封箱
    }
    // 同色尾盒不足下限：与前一同色盒合并平分(自洽)，两盒趋势位置不动 → 棋盘趋势排序稳定
    for (var color in perColor) {
      var group = perColor[color];
      if (group.length < 2) continue;
      var tail = group[group.length - 1], prev = group[group.length - 2];
      if (tail.count >= boxMin) continue;
      var total = prev.count + tail.count;
      // 【v313·用户裁决】平分后两半仍低于下限（如 55 = 50+5 → 28/27 < 30）时，
      //   只要整块不超过 max(上限×1.1, 下限×1.9)，就合成一辆整块 —— 宁可一辆 55，也不要两辆 27。
      if (Math.floor(total / 2) < boxMin && total <= Math.max(boxMax * 1.1, boxMin * 1.9)) { prev.count = total; tail.__drop = true; continue; }
      prev.count = Math.ceil(total / 2); tail.count = Math.floor(total / 2);
    }
    if (boxes.some(function (b) { return b.__drop; })) boxes = boxes.filter(function (b) { return !b.__drop; });
    boxes.sort(function (a, b) { return a.trendStart - b.trendStart; });
    for (var bi = 0; bi < boxes.length; bi++) { boxes[bi].elimSeq = bi; delete boxes[bi].trendStart; }
    return boxes;
  }

  /**
   * 【仅底部入口模式】的盒切分（ANT-GEN-BOTTOM-ONLY-20260729，用户决定 D3）。
   *
   * 与默认 baseFillBoxes 的唯一区别是【像素流来源】：
   *   - 默认(四边入口)：AntSolver.bottomTrendPixels —— 底→顶、行内左→右的【纯几何】趋势扫描，
   *     不含可达/依赖概念（四边都是开口，几何顺序已足够近似真实消除趋势）。
   *   - 底部入口：AntSolver.eliminationOrder(blocks, rows, cols, true).order —— 从【只有底边开口】的
   *     外部连通空格起，每轮选当前可达像素最多的颜色、一次消完其全部当前可达像素，逐轮向内推进。
   *     这就是用户 D3 要的"消除仍由底往上、仍包含依赖，只是可达区域开局少了三个方向"：
   *     几何扫描会把"贴着顶边/左右边、但底部模式下要等下方清开才摸得到"的像素排在前面，
   *     依赖流不会——它严格按真实可达闭包推进。
   *
   * 装箱规则与 baseFillBoxes 完全一致（同色累积到本盒容量即封箱、每盒独立采样容量制造大小差距、
   * 同色尾盒不足下限则与前一同色盒合并平分、最后按首次出现次序定 elimSeq）。
   * 【维护提示】本函数与 baseFillBoxes 的装箱规则是同一套；改其中一处时必须同步另一处。
   * 之所以不抽公共函数：用户明确本模式是"区别于当前生成器的分支"，且 baseFillBoxes 内 pickCap 依赖
   * Math.random 无法做逐字节回归，保持四边默认链路一行不动的风险最低。
   *
   * 前提：调用方应已通过 checkBottomEntryFeasibility 确认全图可达。若仍有永久不可达像素，
   * eliminationOrder 会在无可消时停止，此处产出的盒总量将【小于】目标图像素总数 —— 守恒基线
   * (buildConservationBaseline) 会因此判定失败并淘汰该候选，不会静默产出缺量关卡。
   */
  function baseFillBoxesBottom(blocks, config) {
    // v110：默认走【多色并行吐球】。boxParallelCount=0 时回退到下方的旧单色批量路径。
    var P = (config.boxParallelCount != null) ? config.boxParallelCount
      : ((config.bufferLimit != null) ? config.bufferLimit : 5);
    if (P > 0) return baseFillBoxesBottomParallel(blocks, config, P);

    var rows = blocks.length, cols = blocks[0].length;
    var boxMin = config.boxSizeMin || 40, boxMax = config.boxSizeMax || 56;
    if (boxMax < boxMin) { var t = boxMin; boxMin = boxMax; boxMax = t; }
    var pickCap = makeCapPicker(config);   // 三处铺盒共用同一采样器（含 polar 两极化）

    // 底部依赖流：order 已按真实消除先后排好，seq(1..N) 即全局消除序号，用作 trendStart 口径。
    var elim = AntSolver.eliminationOrder(blocks, rows, cols, true);
    var pixels = elim.order || [];
    var boxes = [], active = {}, perColor = {}, capOf = {};
    for (var i = 0; i < pixels.length; i++) {
      var p = pixels[i], box = active[p.color];
      if (!box) {
        box = { color: p.color, count: 0, trendStart: p.seq };
        active[p.color] = box; boxes.push(box);
        (perColor[p.color] = perColor[p.color] || []).push(box);
        capOf[p.color] = pickCap();               // 每盒独立容量→制造大小差距
      }
      box.count++;
      if (box.count >= capOf[p.color]) active[p.color] = null; // 封箱
    }
    // 同色尾盒不足下限：与前一同色盒合并平分(自洽)，两盒依赖位置不动 → 棋盘顺序稳定
    for (var color in perColor) {
      var group = perColor[color];
      if (group.length < 2) continue;
      var tail = group[group.length - 1], prev = group[group.length - 2];
      if (tail.count >= boxMin) continue;
      var total = prev.count + tail.count;
      // 【v313·用户裁决】平分后两半仍低于下限（如 55 = 50+5 → 28/27 < 30）时，
      //   只要整块不超过 max(上限×1.1, 下限×1.9)，就合成一辆整块 —— 宁可一辆 55，也不要两辆 27。
      if (Math.floor(total / 2) < boxMin && total <= Math.max(boxMax * 1.1, boxMin * 1.9)) { prev.count = total; tail.__drop = true; continue; }
      prev.count = Math.ceil(total / 2); tail.count = Math.floor(total / 2);
    }
    if (boxes.some(function (b) { return b.__drop; })) boxes = boxes.filter(function (b) { return !b.__drop; });
    boxes.sort(function (a, b) { return a.trendStart - b.trendStart; });
    for (var bi = 0; bi < boxes.length; bi++) { boxes[bi].elimSeq = bi; delete boxes[bi].trendStart; }
    return boxes;
  }

  /**
   * 【仅底部入口】多色并行吐球盒切分（v110，任务 `ANT-GEN-BOTTOM-PARALLEL-V3-20260826`）。
   *
   * ── 为什么要换掉旧路径 ──
   * 旧路径的像素流来自 `AntSolver.eliminationOrder(…, true)`，那是**按轮次批量**消除：
   * 每轮挑「当前可达像素最多」的【一个】颜色，一次 flood fill 消掉它全部可达像素。
   * 于是 order 是一段段单色长串（一段可达数百像素），装箱时同色连续累积成多个盒，
   * 且盒按【首个像素 seq】排序 → 同一段产出的盒在队列里连续 → 逐行左→右铺进棋盘就是一整排同色。
   * 实测（`输出文件/底部消除` 287 关合格关卡）：前 3 行最大同色簇中位 4 盒、极端 12 盒，
   * 最长横排同色 9 个，前 3 行只有 6 种颜色，水平同色对占比 87.9%。
   *
   * ── 本函数怎么做（用户 2026-08-26 口径）──
   *   1) 起点取底边最中心；每个颜色内部优先取「距起点最近」的可达像素 → 向左右和上方扩散
   *   2) 维持 P 个活跃槽位，每槽绑一个颜色和一个正在装的盒（容量由 makeCapPicker 独立采样）
   *   3) 每 tick 轮询各槽，每槽各积累 1 个像素；消除即揭露邻居，供所有颜色后续取用
   *   4) 某槽装满本盒 → 立刻挤出成队列里一个完整盒 → 该槽补新颜色，始终保持 P 路在扫
   *   5) 收尾：活跃槽 + 挂起槽的余量挤出；同色尾盒不足下限沿用「与前一同色盒合并平分」
   * 队列顺序即消除趋势顺序，`elimSeq` = 挤出下标。填棋盘规则与障碍/换球等后续逻辑均不变。
   *
   * ── 两个必须这样写的细节（都是实测踩出来的）──
   * ① **可达口径必须与 `simulator.js` 的 `reachable()` 一致**：`bottomOnly` 下【底行恒可达】，
   *    其余格靠「四邻中有已消除格」。部分图纸满图无背景（如 55×55 全彩 3025 像素），
   *    只用 `outsideReachSeed` 播种会得到**空前沿、产出 0 盒**。
   * ② **颜色可达像素暂时耗尽时必须【挂起保留进度】，不能就地挤出未满盒**。
   *    就地挤出会产生大量小盒：实测盒总数 61 → 99（p90 123、max 187），
   *    而棋盘可容纳约 62 盒（7×9 扣黑块/墙/管道格 ≈38 格 + 4 管×6 深 = 24），直接装不下。
   *    挂起后盒总数回到 60，与旧路径持平。用户口径也是「每满一个盒才挤出一个」。
   *
   * ── 实测效果（347 张图纸全量，与旧路径同参数对照）──
   * 队列同色 run 最长 5/7/16 → 2/3/5；前 3 行最大同色簇 5/8/16 → 2/3/4；同色对数 16/20/27 → 2/4/8；
   * 前 3 行色数 7 → 10；最大单色占比 25.9% → 22.2%；水平同色对占比 88.0% → 6.5%；
   * 「最大同色簇 ≤2」达标率 1.4% → 82.1%；盒总数 61 → 60；像素守恒 100%（两者皆是）。
   * 已追平/略优于四方向 v99 上线批次（簇 2/3/7、色数 10、单色 22.7%）。
   * 脚本：`_kiro临时/08.26-底部吐球重设计/_原型对比.js`。
   *
   * ── 已实测的代价 ──
   * 交错把压力从后期挪到前期：前期峰（5% 窗）0.33 → 1.83，`earlyOK` 10/10 → 7/10，
   * `trendOK` 7/10 → 4/10。可解率不受影响（10/10）。
   * 难度分的影响**测不出来**（三轮 10 关样本给出 65→82、72→87.5、73→76，无种子控制，噪声大于效应）。
   *
   * @param {number[][]} blocks 目标图
   * @param {object} config 生产参数
   * @param {number} P 并行槽位数（>=1；调用方已保证，0 走旧路径）
   * @returns {Array<{color:number,count:number,elimSeq:number}>} 盒队列，下标即消除趋势顺序
   */
  function baseFillBoxesBottomParallel(blocks, config, P) {
    var rows = blocks.length, cols = blocks[0].length;
    var boxMin = config.boxSizeMin || 40, boxMax = config.boxSizeMax || 56;
    if (boxMax < boxMin) { var t0 = boxMin; boxMin = boxMax; boxMax = t0; }
    var pickCap = makeCapPicker(config);   // 与另两处铺盒共用同一采样器（含 polar 两极化）

    // 已消除矩阵：先放入「从底边可达的背景连通区」。满图无背景时这里全 false，靠下面的底行播种起步。
    var elim = AntSolver.outsideReachSeed(blocks, rows, cols, true);

    var startR = rows - 1, startC = Math.floor((cols - 1) / 2);   // 底边最中心
    function distOf(r, c) { return Math.abs(r - startR) + Math.abs(c - startC); }
    // 同距离时：更靠底优先，再取离中心列更近的 → 「向左右和上方扩散」
    function cmpPix(a, b) {
      return (a.d - b.d) || (b.r - a.r) || (Math.abs(a.c - startC) - Math.abs(b.c - startC));
    }
    function makeHeap() {
      var a = [];
      return {
        size: function () { return a.length; },
        top: function () { return a[0]; },
        push: function (x) {
          a.push(x);
          var i = a.length - 1;
          while (i > 0) {
            var p = (i - 1) >> 1;
            if (cmpPix(a[i], a[p]) < 0) { var s = a[i]; a[i] = a[p]; a[p] = s; i = p; } else break;
          }
        },
        pop: function () {
          var top = a[0], last = a.pop();
          if (a.length) {
            a[0] = last;
            var i = 0;
            for (;;) {
              var l = 2 * i + 1, r = 2 * i + 2, m = i;
              if (l < a.length && cmpPix(a[l], a[m]) < 0) m = l;
              if (r < a.length && cmpPix(a[r], a[m]) < 0) m = r;
              if (m === i) break;
              var s2 = a[i]; a[i] = a[m]; a[m] = s2; i = m;
            }
          }
          return top;
        }
      };
    }

    var colorHeap = {};                                       // 色 → 该色的候选可达像素堆
    var queued = AntSolver.create2D(rows, cols, false);
    var DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    function expose(r, c) {
      if (r < 0 || r >= rows || c < 0 || c >= cols) return;
      if (elim[r][c] || queued[r][c]) return;
      var col = blocks[r][c];
      if (col <= 0) return;                                   // 背景不入盒
      queued[r][c] = true;
      if (!colorHeap[col]) colorHeap[col] = makeHeap();
      colorHeap[col].push({ r: r, c: c, d: distOf(r, c) });
    }
    // 初始前沿 —— 与 simulator.js floodFillEliminate 的 reachable() 同口径：
    for (var c0 = 0; c0 < cols; c0++) expose(rows - 1, c0);    // ① bottomOnly 下底行恒可达
    for (var r1 = 0; r1 < rows; r1++) {                        // ② 贴着已消除背景的
      for (var c1 = 0; c1 < cols; c1++) {
        if (!elim[r1][c1]) continue;
        for (var d1 = 0; d1 < 4; d1++) expose(r1 + DIRS[d1][0], c1 + DIRS[d1][1]);
      }
    }

    var totalPixels = 0;
    for (var ra = 0; ra < rows; ra++) for (var ca = 0; ca < cols; ca++) if (blocks[ra][ca] > 0) totalPixels++;

    var boxes = [], perColor = {}, taken = {};
    function freshTop(col) {                                   // 丢掉堆顶已被消除的陈旧节点
      var h = colorHeap[col];
      while (h && h.size()) {
        var tp = h.top();
        if (elim[tp.r][tp.c]) { h.pop(); continue; }
        return tp;
      }
      return null;
    }
    function pickColor() {                                     // 挑「有可达像素且未被占用」中最靠前的色
      var best = null, bestT = null;
      for (var k in colorHeap) {
        var col = parseInt(k, 10);
        if (taken[col]) continue;
        var tp = freshTop(col);
        if (!tp) continue;
        if (!bestT || cmpPix(tp, bestT) < 0) { bestT = tp; best = col; }
      }
      return best;
    }
    function openSlot() {
      var col = pickColor();
      if (col == null) return null;
      taken[col] = true;
      return { color: col, count: 0, cap: pickCap() };         // 每盒独立采样容量 → 制造大小差距
    }
    function emit(s) {
      var box = { color: s.color, count: s.count };
      boxes.push(box);
      if (!perColor[s.color]) perColor[s.color] = [];
      perColor[s.color].push(box);
    }

    var slots = [], parked = [];                               // parked：颜色暂无可达像素、挂起保留进度
    for (var i0 = 0; i0 < P; i0++) { var s0 = openSlot(); if (s0) slots.push(s0); else break; }

    var guard = totalPixels * 4 + 1000, guardN = 0;            // 死循环护栏
    while ((slots.length || parked.length) && guardN++ < guard) {
      var progressed = false;
      // 挂起槽复活：其颜色重新有可达像素就回到轮询（优先于开新色，避免半成品盒堆积）
      for (var pi = 0; pi < parked.length; pi++) {
        if (freshTop(parked[pi].color)) {
          slots.push(parked[pi]); parked.splice(pi, 1); pi--; progressed = true;
        }
      }
      for (var si = 0; si < slots.length; si++) {
        var s = slots[si], tp2 = freshTop(s.color);
        if (!tp2) {
          // 该色被别的颜色挡住、要等它先消 → 挂起，不挤出未满盒（见函数头注释②）
          parked.push(s); slots.splice(si, 1); si--;
          var nsA = openSlot();                                // 补一路，维持 P 路持续在扫
          if (nsA) { slots.push(nsA); progressed = true; }
          continue;
        }
        colorHeap[s.color].pop();
        elim[tp2.r][tp2.c] = true;
        s.count++;
        for (var d2 = 0; d2 < 4; d2++) expose(tp2.r + DIRS[d2][0], tp2.c + DIRS[d2][1]);
        progressed = true;
        if (s.count >= s.cap) {                                // 装满 → 立刻挤出一个完整盒
          emit(s);
          delete taken[s.color];
          var nsB = openSlot();
          if (nsB) slots[si] = nsB; else { slots.splice(si, 1); si--; }
        }
      }
      if (!progressed) break;
    }
    // 收尾：仍在装的槽 + 挂起槽把余量挤出（否则丢球，守恒基线会淘汰该候选）
    var rest = slots.concat(parked);
    for (var q0 = 0; q0 < rest.length; q0++) if (rest[q0] && rest[q0].count > 0) emit(rest[q0]);

    // 同色尾盒不足下限：与前一同色盒合并平分（沿用旧路径同一规则，不改盒在队列中的位置）
    for (var color2 in perColor) {
      var grp = perColor[color2];
      if (grp.length < 2) continue;
      var tailB = grp[grp.length - 1], prevB = grp[grp.length - 2];
      if (tailB.count >= boxMin) continue;
      var tot = prevB.count + tailB.count;
      prevB.count = Math.ceil(tot / 2); tailB.count = Math.floor(tot / 2);
    }
    // 挤出顺序即消除趋势顺序（旧路径靠 trendStart 排序，本路径天然有序，无需再排）
    for (var bi2 = 0; bi2 < boxes.length; bi2++) boxes[bi2].elimSeq = bi2;
    return boxes;
  }

  /**
   * 按当前 config 选择盒切分分支（唯一分发点，新旧流程共用）。
   *   bottomOnly=true  → baseFillBoxesBottom（底部依赖流）
   *   baseFillByElimOrder!==false → baseFillBoxes（默认：几何趋势流）
   *   否则 → solverGuidedBoxes（旧的"贪心可达最多色"序，其内部也已按 config.bottomOnly 取可达口径）
   *   【v137】boxCutMode==='anchor' → AntSolver.AnchorCut（锚点切盒，A 片先出/B 片后出；默认不走）
   */
  /**
   * 【v137】锚点切盒的配置组装：把生成器的通用参数翻译成 AnchorCut 需要的口径。
   * 用户 2026-10-14 拍板：均值取 boxSizeMin/Max 的中值、单盒下限取 boxSizeMin，**不新增输入框**。
   */
  function anchorCutConfig(config) {
    var bMin = config.boxSizeMin || 35, bMax = config.boxSizeMax || 80;
    if (bMax < bMin) { var t = bMin; bMin = bMax; bMax = t; }
    return {
      anchors: config.anchorAnchors || null,
      anchorMode: config.anchorMode || 'double',
      bigBoxMax: config.anchorBigBoxMax != null ? config.anchorBigBoxMax : 5,
      boxAvg: config.anchorBoxAvg != null ? config.anchorBoxAvg : Math.round((bMin + bMax) / 2),
      boxMinCap: config.anchorMinBoxCap != null ? config.anchorMinBoxCap : bMin,
      roleAwareCutEnabled: config.anchorRoleAwareCut !== false
    };
  }

  /**
   * 【v147】错位量：把「车在棋盘上的排位」相对「像素露头时刻」整体旋转 k%。
   *
   * 只动 `elimSeq` 这一串序位，**像素怎么切的一格不改**。下游所有读 `elimSeq` 的地方
   * （填盘顺序 buildStructureCandidateFixed/fillStructureFixed、溢出盒进管道的分配、
   * 窄路陷阱的"墙上/墙下"排序）都会自动跟着走 —— 这正是"排位"该有的传播范围。
   *
   * 契约：返回新数组（不改入参），且 elimSeq 仍是【唯一值集合】——只是把序位整体错开一格相位。
   *   · k = 0 → 原样返回（零值短路，保证"不填这项 = 口径不变"）
   *   · 第 i 个盒（按原 elimSeq 升序 = 货的时间线位次 i）拿到序位 seqs[(i+k) % n]
   */
  function applyBoxPhase(boxes, config) {
    var pct = parseFloat(config && config.boxPhaseShiftPct);
    if (!(pct > 0) || !boxes || boxes.length < 2) return boxes;
    var n = boxes.length;
    var k = Math.round(n * Math.min(90, pct) / 100);
    if (k <= 0) return boxes;
    var seqs = [];
    for (var i = 0; i < n; i++) seqs.push(boxes[i].elimSeq != null ? boxes[i].elimSeq : i);
    seqs.sort(function (a, b) { return a - b; });
    var ranked = boxes.map(function (b, idx) { return { b: b, seq: (b.elimSeq != null ? b.elimSeq : idx) }; });
    ranked.sort(function (a, b) { return a.seq - b.seq; });   // 按货的时间线排好 → 得到"第 i 个盒"
    var out = boxes.slice();
    for (var r = 0; r < n; r++) {
      var dst = seqs[(r + k) % n];                            // 该盒在棋盘上拿到的序位
      var nb = Object.assign({}, ranked[r].b);
      nb.elimSeq = dst;
      out[out.indexOf(ranked[r].b)] = nb;
    }
    return out;
  }

  /**
   * 【v207】按层切车（合球第一步）：同色**同一消除轮次**的像素单独成车。
   *   浅轮次的车 = 开壳车（开局就能填满）；深轮次的车 = 被包车（要等外层开了才吃得满）。
   *   总量守恒：每个像素恰好属于一辆车。config.cutMode === 'layerAware' 才用。
   *   失败返回 null → 调用方落回默认切法。
   */
  /**
   * 【v297·用户设计】按「依赖层」切车 —— 让容量认识"谁包着谁"。
   *
   * 用户 2026-10-20：「铺车和障碍该如何铺，容量该如何定，才能做到卡而有解，这就又回到了读懂依赖关系」。
   *
   * 现状问题（工作日志 221 节）：容量 = 像素总量 ÷ 目标车数，与"这次暴露的块多大"无关；
   *   于是浅层色块（开局就露）与深层色块（要挖很久）被切成一样大的车，
   *   前者一碰就满（免费车）、后者永远等不到够量（或早早被切碎）——
   *   压力只能靠冰和摆位去凑，这正是两周来"改了没反应"的根源。
   *
   * 本函数用的层是 `veinLayers` 的**真实依赖层**：
   *   level 0 = 贴边、开局就能碰到的色块；level k = 必须先把 ≤k-1 层清掉才碰得到。
   *   （注意：`eliminationOrder.round` 是贪心日程轮次，不是这个层，别混用。）
   *
   * 切法：
   *   1) 把色块按 (颜色, 依赖层) 归成"供给单元"；
   *   2) 每个单元切成 k 辆，k = ceil(该单元像素数 / 该层的容量上限)，
   *      每辆 ≈ 单元像素数 / k，最后一辆吸收余数（保证守恒）；
   *   3) 容量上限随层递增：浅层 capShallow（默认取 config.boxSizeMin），
   *      深层 capDeep（默认取 config.boxSizeMax 的 1.6 倍，夹到 capLayerCeil）。
   *
   * 这样天然得到：浅层车小（一点就满 = 供给）、深层车大（等外层清完才装满 = 债务）。
   * 不需要 capCeil=84 那种硬夹（v292 bigcap 的"86 大车 / 10 碎车"正是硬夹的副作用）。
   *
   * @returns {Array|null} [{color,count,layer,pixels}]，守恒不成立时返回 null 落回默认切法
   */
  function layerCutBoxes(blocks, config) {
    if (!blocks || !blocks.length) return null;
    var R = blocks.length, C = blocks[0].length;
    var parsed = { rows: R, cols: C, blocks: blocks };
    var info = null;
    try { info = veinLayers(parsed, { bottomOnly: !!(config && config.bottomOnly) }); } catch (e) { return null; }
    if (!info || !info.veins || !info.veins.length) return null;

    var bmin = Math.max(4, parseInt(config.boxSizeMin, 10) || 24);
    var bmax = Math.max(bmin + 2, parseInt(config.boxSizeMax, 10) || 36);
    // 浅层用 boxSizeMin（车小 → 一碰就满），深层放大到 1.6×bmax，但不超过显式上限
    var capShallow = Math.max(bmin, parseInt(config.layerCutCapShallow, 10) || bmin);
    var capDeepRaw = parseInt(config.layerCutCapDeep, 10) || Math.round(bmax * 1.6);
    var capCeilLayer = parseInt(config.layerCutCeil, 10) || 160;
    var capDeep = Math.max(capShallow + 2, Math.min(capCeilLayer, capDeepRaw));

    // 层号 → 该层的容量上限（线性过渡：L=0 用 capShallow，到 maxLevel 用 capDeep）
    var maxL = Math.max(1, info.maxLevel || 1);
    function capOf(layer) {
      var L = Math.max(0, Math.min(maxL, layer));
      var t = L / maxL;
      return Math.round(capShallow + (capDeep - capShallow) * t);
    }

    // 1) 按 (颜色, 层) 归组
    var groups = {}, order = [];
    for (var vi = 0; vi < info.veins.length; vi++) {
      var v = info.veins[vi];
      if (!(v.pixels > 0)) continue;
      var key = v.color + '#' + v.level;
      if (!groups[key]) { groups[key] = { color: v.color, layer: v.level, pixels: 0, blocks: [] }; order.push(key); }
      groups[key].pixels += v.pixels;
      groups[key].blocks.push(v);
    }
    if (!order.length) return null;

    // 【v297·修】单元太碎必须先合并，否则会切出容量 3 的碎车。
    //   实测（工作日志 222 节）这张图按 (色,层) 有 58 个单元，其中 22 个 < 10px、最小 1px。
    //   原样切车 → 69 辆车、最小容量 3，比 v292 bigcap 的碎车问题更严重。
    //   合并规则：**同一颜色内**，若某层单元 < unitFloor，就把它并进相邻层（优先更浅的一层，
    //   因为浅层是供给，晚熟的像素并入浅层不影响"什么时候能吃到"的上界）。
    //   注意只允许同色合并 —— 跨色合并会破坏"这辆车要什么颜色"的对应关系。
    var unitFloor = Math.max(8, parseInt(config.layerCutUnitFloor, 10) || Math.round(bmin * 0.6));
    var byColor = {};
    for (var oi0 = 0; oi0 < order.length; oi0++) {
      var g0 = groups[order[oi0]];
      (byColor[g0.color] = byColor[g0.color] || []).push(g0);
    }
    var merged = [];
    for (var ck in byColor) {
      var list0 = byColor[ck].slice().sort(function (a, b) { return a.layer - b.layer; });
      var acc = null;
      for (var li = 0; li < list0.length; li++) {
        var cur = list0[li];
        if (!acc) { acc = { color: cur.color, layer: cur.layer, pixels: cur.pixels, blocks: cur.blocks.slice() }; continue; }
        var accSmall = acc.pixels < unitFloor;
        var curSmall = cur.pixels < unitFloor;
        if (accSmall || curSmall) {
          // 合并：层号取较浅者，像素相加（保证守恒）
          acc.pixels += cur.pixels;
          acc.blocks = acc.blocks.concat(cur.blocks);
          // 层号保留 acc 的（acc 更浅，因为已按层升序）
          continue;
        }
        merged.push(acc);
        acc = { color: cur.color, layer: cur.layer, pixels: cur.pixels, blocks: cur.blocks.slice() };
      }
      if (acc) merged.push(acc);
    }
    groups = {}; order = [];
    for (var mi = 0; mi < merged.length; mi++) {
      var key2 = merged[mi].color + '#' + merged[mi].layer + '#' + mi;
      groups[key2] = merged[mi]; order.push(key2);
    }
    if (!order.length) return null;

    // 2) 每个单元切车
    var out = [];
    var totalPx = 0, sumCap = 0;
    for (var oi = 0; oi < order.length; oi++) {
      var g = groups[order[oi]];
      var cap = capOf(g.layer);
      var k = Math.max(1, Math.ceil(g.pixels / cap));
      // 剩余不足以成车时并回上一辆（避免出现容量 < bmin 的碎车）
      var per = Math.floor(g.pixels / k), rest = g.pixels - per * k;
      while (per < 4 && k > 1) { k--; per = Math.floor(g.pixels / k); rest = g.pixels - per * k; }
      for (var q = 0; q < k; q++) {
        var count = per + (q === k - 1 ? rest : 0);
        if (count <= 0) continue;
        out.push({ color: g.color, count: count, layer: g.layer, _layerCut: true });
        sumCap += count;
      }
      totalPx += g.pixels;
    }

    // 3) 守恒校验：Σ容量 必须等于彩色像素总数，否则整批作废
    var px = 0;
    for (var r2 = 0; r2 < R; r2++) for (var c2 = 0; c2 < C; c2++) if (blocks[r2][c2] > 0) px++;
    if (sumCap !== px) return null;

    // 4) 出场顺序：浅层先、同层内按像素从大到小（大车先占棋盘，小车后补）
    out.sort(function (a, b) { return (a.layer - b.layer) || (b.count - a.count); });
    for (var si = 0; si < out.length; si++) out[si].elimSeq = si;
    out._layerCutStat = {
      units: order.length, cars: out.length, px: px,
      maxLevel: info.maxLevel, capShallow: capShallow, capDeep: capDeep,
      byLayer: info.byLevel
    };
    return out;
  }

  /**
   * 【v298·用户裁决A】可达性检查：这个棋盘"一路挖得开吗"。
   *
   * 为什么需要（工作日志 223 节）：`depFill` 把深层车按依赖层埋进深格后，实测
   *   **形状对了（曲线 3/3.8/2.8/3.5/4/3.5、覆盖 83%）但稳健通关 0%** ——
   *   玩家挖到某一层就卡住：需要的那辆车在更深的位置，而他手上的车凑不满目标区当前暴露的颜色。
   *   这正是"被埋"的结构性翻版。全知求解器能通关不代表玩家能（它不挑"吃不饱"的车）。
   *
   * 判据：模拟一个**保守玩家**——每一步只取"取进来就能装满"（canConsume）且不阻塞的车；
   *   若这样还能把棋盘清空，说明存在一条不需要背债的挖掘路径 → 关卡不会被埋死。
   *   注意这不是"关卡难度"判据，只是**可达性下限**：通不过 → 这关结构上会卡死，直接淘汰。
   *
   * @param {object} level {blocks, bufferLimit, board}
   * @param {object} opts  {maxSteps} 安全上限
   * @returns {{ok:boolean, steps:number, reason:string|null, picked:number, left:number}}
   */
  function conservativeSolvable(level, opts) {
    opts = opts || {};
    var S = AntSolver.Simulator;
    if (!S || !S.enter || !S.listMoves || !S.applyPick) return { ok: true, steps: 0, reason: 'noSim', picked: 0, left: 0 };
    // 【v298·修】必须传**解析后**的 level（含 rows/cols/totalBoxes），原始 level 只有 blocks/board，
    //   模拟器进去后 listMoves 直接返回空 → 一步就判 deadWeight（实测 accessGate 全灭的真因）。
    if (level && (level.rows == null || level.totalBoxes == null)) {
      try { level = AntSolver.parseLevel(level); } catch (e) { return { ok: true, steps: 0, reason: 'parseFail', picked: 0, left: 0 }; }
    }
    var st;
    try { st = S.enter(level, { useSlotStart: true }); } catch (e) { return { ok: true, steps: 0, reason: 'enterFail', picked: 0, left: 0 }; }
    var maxSteps = opts.maxSteps || ((st.totalBoxes || 40) + 80);
    var _noProgress = 0;   // 【v298】连续"取了但没消掉像素"的步数，超阈值视为卡死
    var picked = 0;
    for (var step = 0; step < maxSteps; step++) {
      if (st.eliminatedPixels >= st.totalPixels) break;      // 目标区清空 = 通关
      var moves;
      try { moves = S.listMoves(st) || []; } catch (e) { break; }
      // 保守玩家：只挑"取进来立刻能装满"的车；若一辆都没有，就挑一辆不阻塞的（被迫背债）
      // 【v298·修】判据要允许背债 —— 背债是这个游戏的核心机制，
      //   原来"只取立刻能装满的车"等于要求一条零债务通路，任何有难度的关都不可能通过
      //   （实测 access: 8/15 全灭）。
      //   正确口径：模拟一个会背债的玩家——
      //     ① 优先取"能装满"的车；没有就取"该色在目标区剩余像素最多"的（最可能很快装满）；
      //     ② 真正的死局只有两种：暂存溢出，或场上全是"死重车"。
      //   死重车 = 该色在目标区剩余像素 < 该车容量 → 即使取进来也永远清不掉。
      var pv = null;
      try { pv = S.previewNextEliminationOrder ? S.previewNextEliminationOrder(st) : null; } catch (e) { pv = null; }
      var remByColor = (pv && pv.byColor) ? pv.byColor : null;
      function remainingOf(color) {
        if (!remByColor) return 1e9;                  // 量不到就别误杀
        var e = remByColor[color];
        if (e == null) return 0;
        // byColor 有线格式 {remaining,...}，也可能直接是数字
        return (typeof e === 'number') ? e : (e.remaining != null ? e.remaining : 0);
      }
      var pickP = null, pickBest = null, bestRem = -1;
      for (var mi = 0; mi < moves.length; mi++) {
        var mv = moves[mi];
        if (mv.blocked) continue;                     // 取则死，绝对不取
        if (mv.canConsume) { pickP = mv; break; }     // 能装满：最好
        // 否则按"该色剩余像素多"排序：剩余 < 容量 的是死重车，直接排除
        var rem = remainingOf(mv.antBox.color);
        var cnt = (mv.antBox.count != null) ? mv.antBox.count : 1;
        if (rem < cnt) continue;                      // 死重车：取进来永远清不掉
        if (rem > bestRem) { bestRem = rem; pickBest = mv; }
      }
      var use = pickP || pickBest;
      if (!use) {
        // 既没有能装满的、也没有"最终能清掉"的 → 真死局
        return { ok: false, steps: step, reason: 'deadWeight',
                 picked: picked, left: (st.totalPixels || 0) - (st.eliminatedPixels || 0) };
      }
      var before = st.eliminatedPixels || 0;
      try { S.applyPick(st, use.r, use.c); } catch (e) { return { ok: false, steps: step, reason: 'applyFail', picked: picked, left: 0 }; }
      picked++;
      if ((st.eliminatedPixels || 0) <= before) {
        // 取了但目标区一个像素都没消掉 → 纯占位动作（背债），连续太多说明卡死
        _noProgress++;
        if (_noProgress > 12) {
          return { ok: false, steps: step, reason: 'stuck', picked: picked, left: 0 };
        }
      } else {
        _noProgress = 0;                     // 有进展就重置
      }
      if (st.overflow || st.gameOver) {
        return { ok: false, steps: step, reason: 'overflow', picked: picked,
                 left: (st.totalPixels || 0) - (st.eliminatedPixels || 0) };
      }
    }
    var done = (st.eliminatedPixels || 0) >= (st.totalPixels || 1);
    return { ok: done, steps: picked, reason: done ? null : 'timeout',
             picked: picked, left: (st.totalPixels || 0) - (st.eliminatedPixels || 0) };
  }

  function layerAwareBoxes(blocks, config) {
    var R = blocks.length, C = blocks[0].length;
    var eo = null;
    try { eo = AntSolver.eliminationOrder(blocks, R, C, !!config.bottomOnly); } catch (e) { eo = null; }
    if (!eo || !eo.round) return null;
    var bmin = parseInt(config.boxSizeMin, 10) || 24;
    var bmax = parseInt(config.boxSizeMax, 10) || 36;
    if (bmax < bmin) bmax = bmin;
    var groups = {};
    for (var r = 0; r < R; r++) for (var c = 0; c < C; c++) {
      var col = blocks[r][c];
      if (col <= 0) continue;
      var rd = eo.round[r][c] || 1;
      var key = rd + '|' + col;
      if (!groups[key]) groups[key] = { round: rd, color: col, px: 0 };
      groups[key].px++;
    }
    var list = Object.keys(groups).map(function (k) { return groups[k]; });
    list.sort(function (a, b) { return a.round - b.round || a.color - b.color; });
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var parts = splitIntoBoxes(list[i].px, bmin, bmax);
      if (!parts || !parts.length) continue;
      for (var j = 0; j < parts.length; j++) out.push({ color: list[i].color, count: parts[j] });
    }
    return out.length ? out : null;
  }

  /**
   * 【v209】合球（按色块 × 层）：把目标图拆成色块、按依赖层排序，
   *   再按「同色 → 层升序 → 块大小降序」把碎片拼成车（容量 24~36；大色块允许拆多辆）。
   *   输出车单 [{color,count}]（顺序 = 层升序 = 供给顺序），供 forcedBoxes 直通。
   *   config.cutMode === 'component' 时启用；失败返回 null 落回默认切法。
   */
  function componentBoxes(blocks, config) {
    var R = blocks.length, C = blocks[0].length;
    var comp = [], comps = [];
    for (var r = 0; r < R; r++) { comp.push(new Array(C).fill(-1)); }
    for (var r2 = 0; r2 < R; r2++) for (var c2 = 0; c2 < C; c2++) {
      var v = blocks[r2][c2];
      if (v <= 0 || comp[r2][c2] >= 0) continue;
      var id = comps.length, stack = [[r2, c2]], pixels = [];
      comp[r2][c2] = id;
      while (stack.length) {
        var cur = stack.pop(); pixels.push(cur);
        var dirs = [[cur[0]-1,cur[1]],[cur[0]+1,cur[1]],[cur[0],cur[1]-1],[cur[0],cur[1]+1]];
        for (var di = 0; di < 4; di++) {
          var nr = dirs[di][0], nc = dirs[di][1];
          if (nr < 0 || nr >= R || nc < 0 || nc >= C) continue;
          if (comp[nr][nc] >= 0 || blocks[nr][nc] !== v) continue;
          comp[nr][nc] = id; stack.push([nr, nc]);
        }
      }
      comps.push({ id: id, color: v, px: pixels.length, pixels: pixels, layer: -1, minScan: 1e9 });
    }
    // 色块邻接 → 依赖层（多源 BFS：贴边的块为第 0 层）
    var adj = [];
    for (var i = 0; i < comps.length; i++) adj.push({});
    for (var r3 = 0; r3 < R; r3++) for (var c3 = 0; c3 < C; c3++) {
      var a = comp[r3][c3]; if (a < 0) continue;
      var nb = [[r3+1,c3],[r3,c3+1]];
      for (var k = 0; k < 2; k++) {
        var nr2 = nb[k][0], nc2 = nb[k][1];
        if (nr2 >= R || nc2 >= C) continue;
        var b = comp[nr2][nc2]; if (b < 0 || b === a) continue;
        adj[a][b] = 1; adj[b][a] = 1;
      }
    }
    var q = [];
    for (var ci = 0; ci < comps.length; ci++) {
      var cp = comps[ci], edge = false;
      for (var pi = 0; pi < cp.pixels.length && !edge; pi++) {
        var pr = cp.pixels[pi][0], pc = cp.pixels[pi][1];
        if (pr === 0 || pr === R - 1 || pc === 0 || pc === C - 1) edge = true;
      }
      if (edge) { cp.layer = 0; q.push(ci); }
    }
    var head = 0;
    while (head < q.length) {
      var qi = q[head++];
      for (var nbKey in adj[qi]) {
        var ji = +nbKey;
        if (comps[ji].layer < 0) { comps[ji].layer = comps[qi].layer + 1; q.push(ji); }
      }
    }
    for (var cj = 0; cj < comps.length; cj++) if (comps[cj].layer < 0) comps[cj].layer = 0;

    // 【v220】扫描序号：eliminationOrder.seq 是"每轮按扫描顺序的像素 id 列表"，
    //   展平后得到每个像素的出厂先后；每块取它最早的像素序号。
    try {
      var _eo = AntSolver.eliminationOrder(blocks, R, C, !!config.bottomOnly);
      if (_eo && _eo.seq) {
        var _ord = 0;
        for (var _ri = 0; _ri < _eo.seq.length; _ri++) {
          var _arr = _eo.seq[_ri] || [];
          for (var _ai = 0; _ai < _arr.length; _ai++) {
            var _pid = _arr[_ai];
            var _pr = Math.floor(_pid / C), _pc = _pid % C;
            var _cid = comp[_pr] && comp[_pr][_pc];
            if (_cid >= 0 && comps[_cid] && _ord < comps[_cid].minScan) comps[_cid].minScan = _ord;
            _ord++;
          }
        }
      }
    } catch (e) { /* 拿不到就退回按层 */ }

    // 按颜色合并
    var bmin = parseInt(config.boxSizeMin, 10) || 24;
    var bmax = parseInt(config.boxSizeMax, 10) || 36;
    if (bmax < bmin) bmax = bmin;
    // 外层暴露像素：贴图边界的像素（近似"开局可达"）
    var exposed = {};
    for (var rr = 0; rr < R; rr++) for (var cc = 0; cc < C; cc++) {
      if (rr !== 0 && rr !== R - 1 && cc !== 0 && cc !== C - 1) continue;
      var vv = blocks[rr][cc]; if (vv > 0) exposed[vv] = (exposed[vv] || 0) + 1;
    }
    var topExp = Object.keys(exposed).map(Number).sort(function (a, b) { return exposed[b] - exposed[a]; }).slice(0, 2);
    var byColor = {};
    for (var ck = 0; ck < comps.length; ck++) {
      var cc = comps[ck];
      (byColor[cc.color] = byColor[cc.color] || []).push(cc);
    }
    var out = [];
    for (var col in byColor) {
      var list = byColor[col].slice().sort(function (x, y) {
        return x.layer - y.layer || y.px - x.px || x.id - y.id;
      });
      // 【v210】先按 36px 贪心装满，再把"尾车"（<24px）并回前面的车，
      //   减少总车数（50 → 约 45），避免撞棋盘容量。
      var carsC = [], cur = 0, effLayer = 0;
      for (var li = 0; li < list.length; li++) {
        var rest = list[li].px;
        while (rest > 0) {
          var room = bmax - cur;
          var take = Math.min(room, rest);
          cur += take; rest -= take;
          effLayer = Math.max(effLayer, list[li].layer);
          if (cur >= bmax) { carsC.push({ color: +col, count: cur, layer: effLayer }); cur = 0; effLayer = 0; }
        }
      }
      if (cur > 0) carsC.push({ color: +col, count: cur, layer: effLayer });
      // 尾车并回：从最后一辆往前塞，塞不下就保留
      while (carsC.length > 1 && carsC[carsC.length - 1].count < bmin) {
        var tail = carsC.pop(), need = tail.count;
        for (var ti = carsC.length - 1; ti >= 0 && need > 0; ti--) {
          var room2 = bmax - carsC[ti].count;
          if (room2 <= 0) continue;
          var mv = Math.min(room2, need);
          carsC[ti].count += mv; need -= mv;
          carsC[ti].layer = Math.max(carsC[ti].layer, tail.layer);
        }
        if (need > 0) { tail.count = need; carsC.push(tail); break; }
      }
      for (var ci2 = 0; ci2 < carsC.length; ci2++) out.push(carsC[ci2]);
    }
    // 【v220】车单排序：默认按层（浅层先）；mergeOrder==='scan' 时保留切球的扫描顺序
    // 默认＝扫描序（保留切球顺序）；显式 mergeOrder:'layer' 才按层排
    if (config.mergeOrder !== 'layer') {
      out.sort(function (x, y) { return (x.scan || 0) - (y.scan || 0); });
    } else {
      out.sort(function (x, y) { return x.layer - y.layer || x.color - y.color; });
    }
    // 【v213b·方案C】铺球前置：车单顺序决定出场（逐行填 → 队首的车落在可点环上）。
    //   把队首重排成「浅层 2 辆（供给）+ 深层 2 辆（债点）」交替，其余车保持原顺序。
    var _ringPlan = config.ringPlan || (config.cutMode === 'component' ? 'C' : '');
    if (_ringPlan === 'H' || _ringPlan === 'G' || _ringPlan === 'F' || _ringPlan === 'E' || _ringPlan === 'D' || _ringPlan === 'C' || _ringPlan === 'B' || _ringPlan === 'A') {
      // F = "盖子"：队首只留 1 辆浅层，其余深层车全部提前 → 环上几乎全是吃不满的车，
      //     玩家/求解器必须先取债车才能露出内圈的浅层车（结构性债，不是容错低）。
      var wantShallow = _ringPlan === 'A' ? 3
        : (_ringPlan === 'H' ? 2 : (_ringPlan === 'F' ? 1 : (_ringPlan === 'G' ? 0 : (_ringPlan === 'D' ? 1 : (_ringPlan === 'E' ? 0 : 2)))));
      var wantDeep = (_ringPlan === 'F' || _ringPlan === 'G' || _ringPlan === 'H') ? 999
        : ((_ringPlan === 'D' || _ringPlan === 'E') ? 3 : (_ringPlan === 'C' ? 2 : 1));
      // 【v225】直接用数字覆盖（目标扫描用）：ringShallow / ringDeep
      if (config.ringShallow != null) wantShallow = Math.max(0, Math.min(9, parseInt(config.ringShallow, 10) || 0));
      if (config.ringDeep != null) wantDeep = Math.max(0, Math.min(12, parseInt(config.ringDeep, 10) || 0));
      var sh = [], dp = [], rest = [];
      for (var ri = 0; ri < out.length; ri++) {
        var rc = out[ri];
        if (rc.layer <= 1 && sh.length < wantShallow) sh.push(rc);
        else if (rc.layer >= 3 && dp.length < wantDeep) dp.push(rc);
        else rest.push(rc);
      }
      var head = [];
      for (var hi = 0; hi < Math.max(sh.length, dp.length); hi++) {
        if (hi < sh.length) head.push(sh[hi]);
        if (hi < dp.length) head.push(dp[hi]);
      }
      out = head.concat(rest);
    }
    // 【v213】序号设计：按"每 gap 辆浅层车插 1 辆深层车"重排车单，
    //   让深层车在出场序列里**按计划**出现（而不是全堆在最后），
    //   铺盒逐行填 → 车单顺序 ≈ 棋盘上的出场顺序。
    var _gap = parseInt(config.scheduleDeepGap, 10) || 0;
    if (_gap > 0) {
      var _sh = [], _mid = [], _deep = [];
      for (var _i = 0; _i < out.length; _i++) {
        var _c = out[_i];
        if (_c.layer <= 1) _sh.push(_c); else if (_c.layer >= 3) _deep.push(_c); else _mid.push(_c);
      }
      var _seq = [], _si = 0, _di = 0;
      while (_si < _sh.length || _di < _deep.length) {
        var _put = 0;
        while (_put < _gap && _si < _sh.length) { _seq.push(_sh[_si++]); _put++; }
        if (_di < _deep.length) _seq.push(_deep[_di++]);
        if (_put === 0 && _si >= _sh.length && _di >= _deep.length) break;
      }
      _seq = _seq.concat(_mid);
      out = _seq;
    }
    var total = 0; for (var oi = 0; oi < out.length; oi++) total += out[oi].count;
    var pix = 0; for (var rr = 0; rr < R; rr++) for (var ccc = 0; ccc < C; ccc++) if (blocks[rr][ccc] > 0) pix++;
    if (total !== pix) return null;   // 守恒不成立 → 落回默认
    return out;
  }

  /**
   * 【v218】清理"微型车"：容量 < minCount 的车，把它的像素并进同色的其它车（容量有空间的），
   *   合并后总量守恒；实在并无可并（该色只有这一辆）就保留。
   *   用户实测：合球切法会产出容量 1 的车，看起来像 bug。
   */
  function fixTinyBoxes(boxes, minCount) {
    if (!boxes || boxes.length < 2 || !(minCount > 1)) return boxes;
    var out = boxes.map(function (b) { return { color: b.color, count: b.count, layer: b.layer }; });
    for (var pass = 0; pass < 3; pass++) {
      var moved = false;
      for (var i = out.length - 1; i >= 0; i--) {
        if (out[i].count >= minCount) continue;
        // 找同色、有空间的车（容量上限 = 同色最大容量或 48）
        var cap = 48;
        for (var j = 0; j < out.length; j++) if (out[j].color === out[i].color && out[j].count > cap) cap = out[j].count;
        var need = out[i].count, donor = -1;
        for (var k = 0; k < out.length; k++) {
          if (k === i || out[k].color !== out[i].color) continue;
          if (cap - out[k].count >= 1) { donor = k; break; }
        }
        if (donor < 0) continue;
        var room = cap - out[donor].count;
        var take = Math.min(room, need);
        out[donor].count += take;
        out[i].count -= take;
        if (out[i].count <= 0) { out.splice(i, 1); }
        moved = true;
      }
      if (!moved) break;
    }
    return out;
  }

  /**
   * 【v223】债车构造：把 k 辆深层车"喂大"到目标容量。
   *   债车 = 容量大 + 含深层碎片 → 拿到手时吃不满、又占着暂存。
   *   做法：从同色的其它车里搬像素过来（优先搬最大的一辆），保证双方都 ≥ 3px。
   */
  function growDebtCars(cars, k, targetCap) {
    if (!cars || !cars.length || !(k > 0)) return cars;
    var want = Math.max(8, Math.min(60, parseInt(targetCap, 10) || 32));
    var deep = [];
    for (var i = 0; i < cars.length; i++) if (cars[i].layer >= 3) deep.push(i);
    deep.sort(function (a, b) { return cars[a].count - cars[b].count || a - b; });   // 先喂小的深层车
    var used = {};
    for (var j = 0; j < deep.length && j < k; j++) {
      var di = deep[j], dc = cars[di];
      if (dc.count >= want) continue;
      // 找同色、容量大的车当"供体"
      var guard = 0;
      while (dc.count < want && guard++ < 40) {
        var donor = -1, best = 0;
        for (var m = 0; m < cars.length; m++) {
          if (m === di) continue;
          var c = cars[m];
          if (c.color !== dc.color) continue;
          if (c.layer >= 3 && !used[m]) continue;        // 别抢其它债车
          var room = c.count - 3;                         // 供体至少留 3
          if (room > best) { best = room; donor = m; }
        }
        if (donor < 0 || best <= 0) break;
        var move = Math.min(best, want - dc.count);
        cars[donor].count -= move; dc.count += move;
      }
      used[di] = 1;
    }
    return cars;
  }

  /**
   * 【v228】填不满就拆车：车数少于目标时，把最大的一辆拆成两辆（同色、各 ≥12px）。
   *   用来满足"棋盘必须被填满"的结构约束，同时让"大容量 + 小棋盘"的组合能成立。
   */
  function splitCarsToTarget(cars, target, minHalf) {
    target = parseInt(target, 10) || 0;
    minHalf = Math.max(8, parseInt(minHalf, 10) || 12);
    if (!cars || !cars.length || cars.length >= target) return cars;
    var out = cars.slice();
    var guard = 0;
    while (out.length < target && guard++ < 200) {
      var bi = -1, best = 0;
      for (var i = 0; i < out.length; i++) {
        if (out[i].count >= minHalf * 2 && out[i].count > best) { best = out[i].count; bi = i; }
      }
      if (bi < 0) break;
      var c = out[bi], a = Math.floor(c.count / 2), b = c.count - a;
      if (a < minHalf || b < minHalf) break;
      out.splice(bi, 1,
        { color: c.color, count: a, layer: c.layer, scan: c.scan },
        { color: c.color, count: b, layer: c.layer, scan: c.scan });
    }
    return out;
  }

  /**
   * 【v230】定向埋深：每色把最大的一辆推到队尾（埋深），
   *   并把它的容量压到"该色总像素 × pct"以内——露面时还有 40% 可吃，不会变成死局。
   */
  function buryBigCars(cars, blocks, pct) {
    // 【v231】pct 为 'auto' 时按"外层可达像素 ×1.4"定容量，只埋暴露最多的 2 个颜色
    if (!cars || cars.length < 3) return cars;
    if (typeof pct === 'number' && !(pct > 0)) return cars;   // 'auto' 是字符串，别被 >0 挡掉
    var R = blocks.length, C = blocks[0].length, total = {};
    for (var r = 0; r < R; r++) for (var c = 0; c < C; c++) { var v = blocks[r][c]; if (v > 0) total[v] = (total[v] || 0) + 1; }
    var byColor = {};
    cars.forEach(function (x, i) { (byColor[x.color] = byColor[x.color] || []).push(i); });
    var bury = {};
    for (var col in byColor) {
      var idxs = byColor[col];
      if (idxs.length < 2) continue;
      var big = idxs[0];
      for (var k = 1; k < idxs.length; k++) if (cars[idxs[k]].count > cars[big].count) big = idxs[k];
      if (pct === 'auto' || pct === 'exposed') {
        if (topExp.indexOf(+col) < 0) continue;                 // 只埋暴露最多的 2 色
        var _fac = parseFloat(config.buryFactor) || 1.4;
        var capA = Math.floor((exposed[+col] || 0) * _fac);
        var cap = Math.max(6, Math.min(total[+col] || capA, capA));
      } else {
        var cap = Math.floor((total[+col] || cars[big].count) * pct);
      }
      if (cap < 6) continue;
      if (cars[big].count > cap) {
        var need = cars[big].count - cap, donor = -1, room = 0;
        for (var m = 0; m < idxs.length; m++) {
          if (idxs[m] === big) continue;
          if (cars[idxs[m]].count > room) { room = cars[idxs[m]].count; donor = idxs[m]; }
        }
        if (donor >= 0) { cars[donor].count += need; cars[big].count = cap; }
      }
      bury[big] = 1;
    }
    var keep = [], deep = [];
    for (var i2 = 0; i2 < cars.length; i2++) (bury[i2] ? deep : keep).push(cars[i2]);
    return keep.concat(deep);
  }

  /* ==================== 【v342·实验】按依赖层切车（layerCut2） ====================
   * 与 layerCut(v297) 的区别：那版只切不摆（第 0 行全同色，失败）。
   * 本版：按（洋葱依赖层 × 颜色）切车，小层并入同色最大层；每辆车带「到期」= 该层累计像素/总像素，
   *       切完按到期升序设 elimSeq —— buildBoard 的「按 elimSeq 行优先填」会自动把浅层车放前面。
   * 守恒校验：Σ车容量 = 彩色像素，不守恒直接返回 null 落回默认切法。
   * 默认关（config.cutMode !== 'layerCut2'）。 */
  function onionLayersOf(blocks) {
    var rows = blocks.length, cols = blocks[0].length;
    var removed = [];
    for (var r = 0; r < rows; r++) { var rr = []; for (var c = 0; c < cols; c++) rr.push(false); removed.push(rr); }
    var total = 0;
    for (var r0 = 0; r0 < rows; r0++) for (var c0 = 0; c0 < cols; c0++) if (blocks[r0][c0] > 0) total++;
    var done = 0, layers = [], DIRS = [[1,0],[-1,0],[0,1],[0,-1]];
    while (done < total && layers.length < 200) {
      var exp = [];
      for (var r1 = 0; r1 < rows; r1++) for (var c1 = 0; c1 < cols; c1++) {
        if (blocks[r1][c1] <= 0 || removed[r1][c1]) continue;
        if (r1 === 0 || r1 === rows-1 || c1 === 0 || c1 === cols-1) { exp.push([r1, c1]); continue; }
        for (var d0 = 0; d0 < 4; d0++) {
          var nr0 = r1 + DIRS[d0][0], nc0 = c1 + DIRS[d0][1];
          if (nr0 >= 0 && nr0 < rows && nc0 >= 0 && nc0 < cols && removed[nr0][nc0]) { exp.push([r1, c1]); break; }
        }
      }
      if (!exp.length) break;
      var cnt = {};
      for (var e0 = 0; e0 < exp.length; e0++) {
        var er = exp[e0][0], ec = exp[e0][1];
        if (removed[er][ec]) continue;
        var col = blocks[er][ec], n = 0, stack = [[er, ec]];
        removed[er][ec] = true;
        while (stack.length) {
          var cur = stack.pop(), x = cur[0], y = cur[1]; n++;
          for (var d1 = 0; d1 < 4; d1++) {
            var nx = x + DIRS[d1][0], ny = y + DIRS[d1][1];
            if (nx >= 0 && nx < rows && ny >= 0 && ny < cols && !removed[nx][ny] && blocks[nx][ny] === col) {
              removed[nx][ny] = true; stack.push([nx, ny]);
            }
          }
        }
        cnt[col] = (cnt[col] || 0) + n; done += n;
      }
      layers.push(cnt);
    }
    return { layers: layers, total: total };
  }

  function layerCutBoxes2(blocks, config) {
    var rows = blocks.length, cols = blocks[0].length;
    var boxMin = parseInt(config.boxSizeMin, 10) || 25;
    var boxMax = parseInt(config.boxSizeMax, 10) || 70;
    if (boxMax < boxMin) { var t = boxMin; boxMin = boxMax; boxMax = t; }
    var info = onionLayersOf(blocks);
    if (!info || !info.layers.length) return null;
    var layers = info.layers, total = info.total;
    if (!total) return null;
    // 小层并入同色最大层
    var perColor = {}, c, l;
    for (var li = 0; li < layers.length; li++) for (c in layers[li]) { (perColor[c] = perColor[c] || {})[li] = layers[li][c]; }
    var final = [];
    for (var fi = 0; fi < layers.length; fi++) final.push({});
    for (c in perColor) {
      var d = perColor[c], big = {}, small = {}, tgt = -1, best = -1;
      for (l in d) { if (d[l] >= boxMin) { big[l] = d[l]; if (d[l] > best) { best = d[l]; tgt = +l; } } else small[l] = d[l]; }
      if (tgt < 0) {
        var mx = -1, ml = 0;
        for (l in d) if (d[l] > mx) { mx = d[l]; ml = +l; }
        var ssum = 0; for (l in d) ssum += d[l];
        final[ml][c] = (final[ml][c] || 0) + ssum;
        continue;
      }
      for (l in big) final[+l][c] = (final[+l][c] || 0) + big[l];
      for (l in small) final[tgt][c] = (final[tgt][c] || 0) + small[l];
    }
    // 层累计
    var layerPx = [], cumBefore = [0];
    for (var lp = 0; lp < final.length; lp++) {
      var sp = 0; for (var k0 in final[lp]) sp += final[lp][k0];
      layerPx.push(sp); cumBefore.push(cumBefore[cumBefore.length-1] + sp);
    }
    // 切车
    var boxes = [];
    for (var fl = 0; fl < final.length; fl++) {
      var L = final[fl], cs = Object.keys(L).sort(function (a, b) { return L[b] - L[a]; });
      for (var ci = 0; ci < cs.length; ci++) {
        var cc = cs[ci], px = L[cc];
        // 【v346·用户裁决】不再为守下限减车数：容量由切法自然分配，只守上限。
        //   78px 切成 39/39（低于下限）而不是硬留一辆 78（突破上限）。
        var n = Math.max(1, Math.ceil(px / boxMax));
        var base = Math.floor(px / n), rest = px - base * n, off = 0;
        for (var kk = 0; kk < n; kk++) {
          var cnt = base + (kk < rest ? 1 : 0);
          off += cnt;
          boxes.push({ color: +cc, count: cnt, _due: (cumBefore[fl] + off) / total });
        }
      }
    }
    // 守恒校验
    var sum = 0;
    for (var bi = 0; bi < boxes.length; bi++) sum += boxes[bi].count;
    var _totalPx = total;
    if (sum !== total) { blocks._lbStat = { n: boxes.length, sum: sum, total: total, fail: 'sum' }; return null; }
    // 按到期排序 → elimSeq
    boxes.sort(function (a, b) { return a._due - b._due; });
    for (var bj = 0; bj < boxes.length; bj++) { boxes[bj].elimSeq = bj; boxes[bj].due = boxes[bj]._due; delete boxes[bj]._due; }
    return boxes;
  }

  /* ==================== 【v347·用户裁决】按「依赖层 × 色块」切车 ====================
   * 与 layerCut2 的区别：
   *   layerCut2 = 每层每「颜色」切（同色跨块的像素被当成一个整体）
   *   layerBlock = 每层每「同色连通块」切（块是自然单元），再按到期把相邻单元合并到目标车数
   * 容量不是切出来的，是「合并出来的」：先有自然块，再把到期的块并成一辆车。
   * 目标车数 = 盘格范围中值 × 0.86（不读用户容量输入）。
   * 守恒校验：Σ车容量 = 彩色像素，不通过返回 null 落回默认切法。 */
  function onionLayerMap(blocks) {
    var rows = blocks.length, cols = blocks[0].length;
    var layerOf = [], removed = [];
    for (var r = 0; r < rows; r++) {
      var a = [], b = [];
      for (var c = 0; c < cols; c++) { a.push(-1); b.push(false); }
      layerOf.push(a); removed.push(b);
    }
    var total = 0;
    for (var r1 = 0; r1 < rows; r1++) for (var c1 = 0; c1 < cols; c1++) if (blocks[r1][c1] > 0) total++;
    var done = 0, li = 0, DIRS = [[1,0],[-1,0],[0,1],[0,-1]], pxByLayer = [];
    while (done < total && li < 200) {
      var exp = [];
      for (var r2 = 0; r2 < rows; r2++) for (var c2 = 0; c2 < cols; c2++) {
        if (blocks[r2][c2] <= 0 || removed[r2][c2]) continue;
        if (r2 === 0 || r2 === rows-1 || c2 === 0 || c2 === cols-1) { exp.push([r2, c2]); continue; }
        for (var d0 = 0; d0 < 4; d0++) {
          var nr = r2 + DIRS[d0][0], nc = c2 + DIRS[d0][1];
          if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && removed[nr][nc]) { exp.push([r2, c2]); break; }
        }
      }
      if (!exp.length) break;
      var n = 0;
      for (var e0 = 0; e0 < exp.length; e0++) {
        var er = exp[e0][0], ec = exp[e0][1];
        if (removed[er][ec]) continue;
        var col = blocks[er][ec], stack = [[er, ec]];
        removed[er][ec] = true; layerOf[er][ec] = li;
        while (stack.length) {
          var cur = stack.pop(), x = cur[0], y = cur[1]; n++;
          for (var d1 = 0; d1 < 4; d1++) {
            var nx = x + DIRS[d1][0], ny = y + DIRS[d1][1];
            if (nx >= 0 && nx < rows && ny >= 0 && ny < cols && !removed[nx][ny] && blocks[nx][ny] === col) {
              removed[nx][ny] = true; layerOf[nx][ny] = li; stack.push([nx, ny]);
            }
          }
        }
      }
      pxByLayer.push(n); done += n; li++;
    }
    return { layerOf: layerOf, pxByLayer: pxByLayer, total: total, rows: rows, cols: cols };
  }

  /* 【v348·用户思路】按层不切：一层一色一辆，容量 = 该层该色全部像素。
   * 与 layerCut2 的区别：layerCut2 按上限 60 把一段切成几辆；这里不切，一段就是一辆。
   * 理由：一辆车的像素正好是「该段已暴露的」，玩家在该段点到它就能吃满；
   *       均分切开反而让每辆只覆盖一段的一部分，更容易攒票。 */
  function layerUnitCut(blocks, config) {
    var info = onionLayersOf(blocks);
    var layers = info.layers, total = info.total;
    if (!total) return null;
    var boxes = [], cum = 0;
    for (var li = 0; li < layers.length; li++) {
      var L = layers[li], layerSum = 0;
      for (var k in L) layerSum += L[k];
      for (var c in L) {
        boxes.push({ color: +c, count: L[c], layer: li, due: cum / total });
      }
      cum += layerSum;
    }
    var sum = 0;
    for (var i = 0; i < boxes.length; i++) sum += boxes[i].count;
    if (sum !== total) return null;
    boxes.sort(function (a, b) { return a.due - b.due || a.color - b.color; });
    for (var j = 0; j < boxes.length; j++) boxes[j].elimSeq = j;
    return boxes;
  }

  /* 【v348】自适应切车：不做「固定上限」，改成「按车数区间」——
   *   单元数 < 24 → 反复切当前最大的单元（大色块被切开，但不是按固定 60）
   *   单元数 > 40 → 反复合并「同色 + 到期最近」的相邻单元（碎块被并掉）
   *   24~40 之间不动（自然大小）。
   * 容量是切/并的结果，不是参数。 */
  function layerAdaptiveCut(blocks, config) {
    var info = onionLayersOf(blocks);
    var layers = info.layers, total = info.total;
    if (!total) return null;
    var units = [], cum = 0;
    for (var li = 0; li < layers.length; li++) {
      var L = layers[li], ls = 0;
      for (var k in L) ls += L[k];
      for (var c in L) units.push({ color: +c, count: L[c], due: cum / total, layer: li, split: false, merged: false });
      cum += ls;
    }
    var LO = 24, HI = 40;
    var guard = 0;
    while (units.length < LO && guard++ < 200) {
      var mi = 0;
      for (var i = 1; i < units.length; i++) if (units[i].count > units[mi].count) mi = i;
      if (units[mi].count < 20) break;
      var u = units[mi], a = Math.floor(u.count / 2), b = u.count - a;
      units.splice(mi, 1,
        { color: u.color, count: a, due: u.due, layer: u.layer, split: true, merged: false },
        { color: u.color, count: b, due: u.due, layer: u.layer, split: true, merged: false });
    }
    guard = 0;
    while (units.length > HI && guard++ < 200) {
      var bi = -1, bj = -1, bd = Infinity;
      for (var ii = 0; ii < units.length - 1; ii++) {
        for (var jj = ii + 1; jj < units.length; jj++) {
          if (units[ii].color !== units[jj].color) continue;
          var dd = Math.abs(units[ii].due - units[jj].due);
          if (dd < bd) { bd = dd; bi = ii; bj = jj; }
        }
      }
      if (bi < 0) break;
      units[bi].count += units[bj].count;
      units[bi].merged = true;
      units.splice(bj, 1);
    }
    var sum = 0;
    for (var si = 0; si < units.length; si++) sum += units[si].count;
    if (sum !== total) return null;
    units.sort(function (a, b) { return a.due - b.due || a.color - b.color; });
    for (var ei = 0; ei < units.length; ei++) units[ei].elimSeq = ei;
    return units;
  }

  /* 【v348】按目标车数反推：车数固定 target，每色分几辆 = 目标 × 该色像素占比；
   * 色内按「层序累积」切成 n 段（跨层连续），容量 = 段内像素和。
   * 上限不存在：切分点是「该色的第 k 段」而不是「够不够 60」。 */
  function colorSegmentCut(blocks, config) {
    var info = onionLayersOf(blocks);
    var layers = info.layers, total = info.total;
    if (!total) return null;
    // 【v349·用户裁决】目标车数由棋盘反推：盘格中值 × 0.86
    var _rMid = (parseInt(config.boardRowsMin, 10) || 4) + (parseInt(config.boardRowsMax, 10) || 8);
    var _cMid = (parseInt(config.boardColsMin, 10) || 6) + (parseInt(config.boardColsMax, 10) || 10);
    var _autoCars = Math.round((_rMid / 2) * (_cMid / 2) * 0.86);
    var target = Math.max(8, parseInt(config.carCountTarget, 10) || _autoCars);
    // 每色每层像素
    var per = {};   // color -> { layer: px }
    var layerPx = [];
    for (var li = 0; li < layers.length; li++) {
      var sum = 0;
      for (var k in layers[li]) {
        var c = +k, px = layers[li][k];
        (per[c] = per[c] || {})[li] = px;
        sum += px;
      }
      layerPx.push(sum);
    }
    var cum = [0];
    for (var lp = 0; lp < layerPx.length; lp++) cum.push(cum[cum.length - 1] + layerPx[lp]);
    var boxes = [];
    for (var col in per) {
      var d = per[col], pxSum = 0;
      for (var l in d) pxSum += d[l];
      var n = Math.max(1, Math.round(target * pxSum / total));
      var perCar = pxSum / n;
      var acc = 0, accLayer = 0, made = 0, seg = [];
      for (var l2 = 0; l2 < layers.length; l2++) {
        var p = d[l2] || 0;
        if (p <= 0) continue;
        var remaining = p;
        while (remaining > 0) {
          if (made >= n - 1) { acc += remaining; remaining = 0; break; }   // 已切够 → 剩余并入末段
          var need = Math.max(0, perCar - acc);
          var take = need > 0 ? Math.min(need, remaining) : remaining;
          acc += take; remaining -= take; accLayer = l2;
          if (acc >= perCar - 1e-6) {
            seg.push({ count: acc, layer: accLayer });
            made++; acc = 0;
          }
        }
      }
      if (acc > 0) {
        if (seg.length && made >= n - 1) seg[seg.length - 1].count += acc;
        else seg.push({ count: acc, layer: accLayer });
      }
      for (var si = 0; si < seg.length; si++) {
        boxes.push({ color: +col, count: Math.max(1, Math.round(seg[si].count)), layer: seg[si].layer,
                     due: cum[seg[si].layer] / total });
      }
    }
    // 整数化后做守恒修正（差额全加到最后一辆）
    var sum2 = 0;
    for (var bi = 0; bi < boxes.length; bi++) sum2 += boxes[bi].count;
    if (sum2 !== total) {
      boxes.sort(function (a, b) { return a.due - b.due || a.color - b.color; });
      boxes[boxes.length - 1].count += (total - sum2);
      if (boxes[boxes.length - 1].count <= 0) { blocks._csStat = { fail: 'neg' }; return null; }
      sum2 = total;
    }
    if (sum2 !== total) { blocks._csStat = { fail: 'sum', sum: sum2 }; return null; }
    boxes.sort(function (a, b) { return a.due - b.due || a.color - b.color; });
    for (var bj = 0; bj < boxes.length; bj++) boxes[bj].elimSeq = bj;
    blocks._csStat = { n: boxes.length, target: target };
    return boxes;
  }

  /* 【v348·用户设计】选择性合球做债务：
   *   · 以「同色连通块」为基本单元
   *   · 对每个色，找「最早层的块」和「最晚层的块」；若 浅 ≤ maxLight、深 ≤ maxDeep、层差 ≥ minGap
   *     → 合成一个「债务球」（浅层部分开局能吃，深层部分要等）
   *   · 其余小块（< minBlock）并入同色最大块
   *   · 不设容量上限；容量 = 块像素之和
   * 参数：debtMaxLight(默认60) / debtMaxDeep(默认10) / debtMinGap(默认2) / debtMinBlock(默认10) */
  /* 【v349·用户思路】按「遮挡关系」切：用真实消除序（eliminationOrder）把像素分轮，
   *   每一轮 × 每一色 = 一辆车，容量 = 该轮该色完全可达的像素数。
   * 为什么大车也安全：同一轮的像素在那一轮全都可达，玩家点它就能吃满。
   * 不设容量上限。 */
  function roundCut(blocks, config) {
    var R = blocks.length, C = blocks[0].length;
    var eo = null;
    try { eo = AntSolver.eliminationOrder(blocks, R, C, false); } catch (e) { return null; }
    if (!eo || !eo.round || !eo.rounds) return null;
    var rd = eo.round, rounds = eo.rounds;
    var groups = {}, total = 0;
    for (var r = 0; r < R; r++) for (var c = 0; c < C; c++) {
      var v = blocks[r][c];
      if (v <= 0) continue;
      total++;
      var k = rd[r][c], key = k + ':' + v;
      groups[key] = (groups[key] || 0) + 1;
    }
    var boxes = [];
    for (var g in groups) {
      var parts = g.split(':');
      boxes.push({ color: +parts[1], count: groups[g], round: +parts[0], due: (+parts[0]) / rounds });
    }
    var sum = 0;
    for (var i = 0; i < boxes.length; i++) sum += boxes[i].count;
    if (sum !== total) { blocks._rcStat = { fail: 'sum', sum: sum, total: total }; return null; }
    boxes.sort(function (a, b) { return a.due - b.due || a.color - b.color; });
    for (var j = 0; j < boxes.length; j++) boxes[j].elimSeq = j;
    blocks._rcStat = { n: boxes.length, rounds: rounds };
    return boxes;
  }

  function debtBlockCut(blocks, config) {
    var info = onionLayerMap(blocks);
    var rows = info.rows, cols = info.cols, total = info.total;
    if (!total) return null;
    var layerOf = info.layerOf;
    var maxLight = parseInt(config.debtMaxLight, 10) || 45;
    var maxDeep = parseInt(config.debtMaxDeep, 10) || 8;
    var minGap = parseInt(config.debtMinGap, 10) || 2;
    var minBlock = parseInt(config.debtMinBlock, 10) || 25;
    // 连通块（同色 4-连通），记录最浅层
    var seen = [], R = rows, C = cols;
    for (var r0 = 0; r0 < R; r0++) { var a = []; for (var c0 = 0; c0 < C; c0++) a.push(false); seen.push(a); }
    var comps = [];
    for (var r = 0; r < R; r++) for (var c = 0; c < C; c++) {
      if (blocks[r][c] <= 0 || seen[r][c]) continue;
      var col = blocks[r][c], stack = [[r, c]], px = 0, minL = 999;
      seen[r][c] = true;
      while (stack.length) {
        var cur = stack.pop(), x = cur[0], y = cur[1];
        px++; if (layerOf[x][y] < minL) minL = layerOf[x][y];
        for (var d = 0; d < 4; d++) {
          var nx = x + DIRS4[d][0], ny = y + DIRS4[d][1];
          if (nx >= 0 && nx < R && ny >= 0 && ny < C && !seen[nx][ny] && blocks[nx][ny] === col) {
            seen[nx][ny] = true; stack.push([nx, ny]);
          }
        }
      }
      comps.push({ color: col, px: px, layer: minL });
    }
    // 按色分组
    var byColor = {};
    for (var ci = 0; ci < comps.length; ci++) {
      var cc = comps[ci];
      (byColor[cc.color] = byColor[cc.color] || []).push(cc);
    }
    var boxes = [], debtN = 0;
    for (var ck in byColor) {
      var arr = byColor[ck].slice();
      // 每色最多做一对债务球
      var usedLight = -1, usedDeep = -1;
      if (arr.length >= 2) {
        var sortedL = arr.slice().sort(function (a, b) { return a.layer - b.layer || b.px - a.px; });
        for (var li = 0; li < sortedL.length && usedLight < 0; li++) {
          if (sortedL[li].px <= maxLight) usedLight = li;
        }
        var sortedD = arr.slice().sort(function (a, b) { return b.layer - a.layer || a.px - b.px; });
        for (var di = 0; di < sortedD.length && usedDeep < 0; di++) {
          if (sortedD[di].px <= maxDeep && sortedD[di].layer - sortedL[usedLight >= 0 ? usedLight : 0].layer >= minGap) usedDeep = di;
        }
        if (usedLight >= 0 && usedDeep >= 0) {
          var a1 = sortedL[usedLight], a2 = sortedD[usedDeep];
          var maxBall = parseInt(config.debtMaxBall, 10) || 150;
          if (a1 !== a2 && (a1.px + a2.px) <= maxBall) {
            boxes.push({ color: +ck, count: a1.px + a2.px, layer: a1.layer, debt: a2.px, due: 0, _debt: true });
            debtN++;
            arr = arr.filter(function (x) { return x !== a1 && x !== a2; });
          }
        }
      }
      // 【v348·修】剩余块：小块两两合并（不堆给最大块），避免出现 300 的超大球
      var big = arr.filter(function (x) { return x.px >= minBlock; });
      var small = arr.filter(function (x) { return x.px < minBlock; });
      var guardM = 0;
      while (small.length > 1 && guardM++ < 200) {
        small.sort(function (a, b) { return a.px - b.px || a.layer - b.layer; });
        var sa = small.shift(), sb2 = small.shift();
        small.push({ color: sa.color, px: sa.px + sb2.px, layer: Math.min(sa.layer, sb2.layer) });
        if (small.length === 1) break;
        var allBig = true;
        for (var sm = 0; sm < small.length; sm++) if (small[sm].px < minBlock) { allBig = false; break; }
        if (allBig) break;
      }
      var rest = big.concat(small);
      if (!rest.length) continue;
      for (var bi = 0; bi < rest.length; bi++) {
        boxes.push({ color: +ck, count: rest[bi].px, layer: rest[bi].layer, debt: 0, due: 0 });
      }
    }
    var sum = 0;
    for (var z = 0; z < boxes.length; z++) sum += boxes[z].count;
    if (sum !== total) { blocks._dbStat = { fail: 'sum', sum: sum, total: total, n: boxes.length }; return null; }
    // 层累计 → 到期
    var layerPx = [];
    for (var l2 = 0; l2 < info.pxByLayer.length; l2++) layerPx.push(info.pxByLayer[l2]);
    var cum = [0];
    for (var l3 = 0; l3 < layerPx.length; l3++) cum.push(cum[cum.length - 1] + layerPx[l3]);
    for (var b2 = 0; b2 < boxes.length; b2++) boxes[b2].due = cum[Math.min(boxes[b2].layer, cum.length - 1)] / total;
    boxes.sort(function (a, b) { return a.due - b.due || a.color - b.color; });
    for (var b3 = 0; b3 < boxes.length; b3++) boxes[b3].elimSeq = b3;
    blocks._dbStat = { n: boxes.length, debts: debtN };
    return boxes;
  }

  function layerBlockCut(blocks, config) {
    var map = onionLayerMap(blocks);
    var rows = map.rows, cols = map.cols, total = map.total;
    if (!total) return null;
    var layerOf = map.layerOf, pxByLayer = map.pxByLayer;
    var DIRS = [[1,0],[-1,0],[0,1],[0,-1]];
    // 目标车数：盘格范围中值 × 0.86（不读用户容量输入）
    var rMin = parseInt(config.boardRowsMin, 10) || 4, rMax = parseInt(config.boardRowsMax, 10) || 7;
    var cMin = parseInt(config.boardColsMin, 10) || 6, cMax = parseInt(config.boardColsMax, 10) || 9;
    var targetCars = Math.max(8, Math.round(((rMin + rMax) / 2) * ((cMin + cMax) / 2) * 0.86));
    // 每层内找「同色连通块」= 自然单元
    var units = [], cumBefore = [0];
    for (var pb = 0; pb < pxByLayer.length; pb++) cumBefore.push(cumBefore[cumBefore.length-1] + pxByLayer[pb]);
    var seen = [];
    for (var sr = 0; sr < rows; sr++) { var rowSeen = []; for (var sc = 0; sc < cols; sc++) rowSeen.push(false); seen.push(rowSeen); }
    for (var r3 = 0; r3 < rows; r3++) for (var c3 = 0; c3 < cols; c3++) {
      if (blocks[r3][c3] <= 0 || seen[r3][c3]) continue;
      var L = layerOf[r3][c3], colr = blocks[r3][c3];
      var stack2 = [[r3, c3]], px = 0, cellsList = [];
      seen[r3][c3] = true;
      while (stack2.length) {
        var cc2 = stack2.pop(), x2 = cc2[0], y2 = cc2[1]; px++; cellsList.push([x2, y2]);
        for (var d2 = 0; d2 < 4; d2++) {
          var nx2 = x2 + DIRS[d2][0], ny2 = y2 + DIRS[d2][1];
          if (nx2 >= 0 && nx2 < rows && ny2 >= 0 && ny2 < cols && !seen[nx2][ny2] &&
              blocks[nx2][ny2] === colr && layerOf[nx2][ny2] === L) {
            seen[nx2][ny2] = true; stack2.push([nx2, ny2]);
          }
        }
      }
      units.push({ color: colr, layer: L, px: px, due: (cumBefore[L] + px) / total, cells: cellsList });
    }
    // 【v347·修正】按色分配车数：每色车数 = 目标总车数 × 该色像素占比；
    //   色内把所有层的单元按到期升序、按像素累积切成 n 辆（容量由累积结果决定，不是切出来的）。
    var byColor = {};
    for (var ui2 = 0; ui2 < units.length; ui2++) {
      var u2 = units[ui2];
      (byColor[u2.color] = byColor[u2.color] || []).push(u2);
    }
    var boxes = [];
    for (var colKey in byColor) {
      var list = byColor[colKey].slice().sort(function (a, b) { return a.due - b.due; });
      var pxSum = 0;
      for (var ls = 0; ls < list.length; ls++) pxSum += list[ls].px;
      var nCar = Math.max(1, Math.round(targetCars * pxSum / total));
      if (nCar > list.length) nCar = list.length;
      var perCar = pxSum / nCar;
      var acc = 0, accDue = 0, made = 0;
      for (var lm = 0; lm < list.length; lm++) {
        acc += list[lm].px; accDue = list[lm].due;
        var remainingUnits = list.length - lm - 1;
        var needCars = nCar - made - 1;
        // 达到均值，或剩余单元数刚好等于剩余车数 → 封箱
        if ((acc >= perCar - 1e-6 && made < nCar - 1) || (remainingUnits === needCars && made < nCar - 1)) {
          boxes.push({ color: +colKey, count: acc, due: accDue });
          acc = 0; made++;
        }
      }
      if (acc > 0) boxes.push({ color: +colKey, count: acc, due: accDue });
    }
    var sum = 0;
    for (var bi2 = 0; bi2 < boxes.length; bi2++) sum += boxes[bi2].count;
    if (sum !== total) { blocks._lbStat = { n: boxes.length, sum: sum, total: total, fail: 'sum' }; return null; }
    boxes.sort(function (a, b) { return a.due - b.due; });
    for (var bj2 = 0; bj2 < boxes.length; bj2++) { boxes[bj2].elimSeq = bj2; }
    return boxes;
  }

  /**
   * 【v350·用户裁决】按「目标图暴露顺序」切车单。
   *
   * 现场（006 图实测，buffer 5，玩家模拟 8 局）：
   *   D 组 颜色按手画路径排 + 固定上限 60 → 0/8 通关，全部 33% 死
   *   B 组 颜色按目标图暴露序 + 固定上限 60 → 8/8 通关，顺序匹配 77%
   *   A 组 颜色按目标图暴露序 + 总量 2.5%±1% 浮动上限 → 8/8 通关，顺序匹配 100%
   *
   * 旧规则「该色总量 ≥ 上限就用上限」完全不看目标图什么时候吐料：
   *   一辆车可能远大于它出场那一轮能提供的像素数 → 车压在暂存区等料 → 暂存满 → 卡死。
   *
   * 规则：
   *   1) 颜色先后 = eliminationOrder 里每色的【首现轮次】
   *   2) 同色内按轮次分组；不足 mergeBelow 的小轮并入前一组（避免一辆车只装 3 个像素）
   *   3) 每组按【总像素 × pct】切车，pct 在 [lo, hi] 随机浮动（默认 1.5%~3.5%，即 2.5%±1%）
   */
  function exposeCut(blocks, config) {
    var rows = blocks.length, cols = blocks[0].length;
    var total = 0, r, c;
    for (r = 0; r < rows; r++) for (c = 0; c < cols; c++) if (blocks[r][c] > 0) total++;
    if (!total) return null;

    var eo;
    try { eo = AntSolver.eliminationOrder(blocks, rows, cols, !!config.bottomOnly); }
    catch (e) { return null; }
    if (!eo || !eo.order || !eo.order.length) return null;

    var firstRound = {}, byRound = {};
    for (var i = 0; i < eo.order.length; i++) {
      var p = eo.order[i];
      if (firstRound[p.color] == null || p.round < firstRound[p.color]) firstRound[p.color] = p.round;
      if (!byRound[p.color]) byRound[p.color] = {};
      byRound[p.color][p.round] = (byRound[p.color][p.round] || 0) + 1;
    }
    var colors = Object.keys(firstRound).map(Number).sort(function (a, b) { return firstRound[a] - firstRound[b]; });
    // 【v352·用户裁决】「指针」路线序：用路径工具画的那条线给出的颜色顺序，替代自动排的暴露序。
    //   用户原话："我画这个指针的目的就是为了能够通过小车的选取让他从那个方向开始进行进入"。
    //   机制说明（不改任何底层规则）：目标图上能消什么仍由「贴边或邻接已消」决定，
    //   这里只改【先给玩家哪个颜色的车】，从而改变他实际把消除推进到哪一边。
    //   实测（006，浮动容量）：路径序 8/8 通关；自动序 8/8。两者都能出关，差别在路线走向。
    if (config && config.routeOrder && config.routeOrder.length) {
      var route = [], _seen = {};
      for (var qi = 0; qi < config.routeOrder.length; qi++) {
        var _v = parseInt(config.routeOrder[qi], 10);
        if (!isNaN(_v) && byRound[_v] && !_seen[_v]) { _seen[_v] = 1; route.push(_v); }
      }
      for (var ci2 = 0; ci2 < colors.length; ci2++) if (!_seen[colors[ci2]]) { _seen[colors[ci2]] = 1; route.push(colors[ci2]); }
      if (route.length) colors = route;
    }

    // 【v351·用户裁决】上限 = 界面上的「球容量」参数（config.boxSizeMax，默认 60）；
    //   每辆车在【上限 − 浮动, 上限】之间取值，浮动幅度由用户自己设（config.capJitter，默认 5）。
    //   用户原话："按求解器上的固定容量的参数作为上限，同时有浮动（我自己设）"。
    var capBase = Math.max(1, parseInt(config.boxSizeMax, 10) || 60);
    var jitter = Math.max(0, parseInt(config.capJitter, 10));
    if (isNaN(jitter)) jitter = 5;
    var minCap = Math.max(1, parseInt(config.exposeCapMin, 10) || 8);
    var mergeBelow = Math.max(1, parseInt(config.exposeMergeBelow, 10) || 12);

    function pickCap() {
      var lo = Math.max(minCap, capBase - jitter);
      if (lo >= capBase) return capBase;
      return lo + Math.floor(rnd() * (capBase - lo + 1));   // [capBase-jitter, capBase]
    }

    // 【v351·用户裁决】每色车数 = ceil(该色总量 / 上限)，然后【平均分配】。
    //   这样每辆都贴着上限、且严格不超过它。
    //   ⚠ 数学上的硬约束：车数 = Σ ceil(T_c / C)。006（C=31）算出来是 46 辆 → 6×8 盘。
    //     历史 119 关的中位是 42 辆 / 6×7，但它们的单车最大到 76px —— 也就是说
    //     历史合格关卡本身允许个别车超上限。想要 6×7 且不超上限，两者不可兼得。
    var boxes = [];
    for (var ci = 0; ci < colors.length; ci++) {
      var col = colors[ci], g = byRound[col] || {};
      var rounds = Object.keys(g).map(Number).sort(function (a, b) { return a - b; });
      var cTot = 0;
      for (var ri0 = 0; ri0 < rounds.length; ri0++) cTot += g[rounds[ri0]];
      if (cTot <= 0) continue;
      var firstRd = rounds.length ? rounds[0] : 0;
      if (cTot <= capBase) { boxes.push({ color: col, count: cTot, exposeRound: firstRd }); continue; }
      var nCar = Math.ceil(cTot / capBase);
      if (nCar < 1) nCar = 1;
      // 平均分配 + ±jitter/2 的随机浮动（用户："不想让大色块都等于容量上限，5px 以内浮动"）
      //   逐辆取 min(剩余/剩余车数 + 抖动, 上限)，并夹在"给后面留得下"的区间里，保证总数守恒且不超上限。
      var rest = cTot;
      for (var k = 0; k < nCar; k++) {
        var left = nCar - k;
        if (left === 1) { boxes.push({ color: col, count: rest, exposeRound: firstRd }); rest = 0; break; }
        var avg = Math.round(rest / left);
        var jit = Math.round((rnd() * 2 - 1) * (jitter / 2));
        var cc = avg + jit;
        if (cc > capBase) cc = capBase;
        var maxAllowed = rest - (left - 1);              // 后面每辆至少 1
        var minAllowed = rest - (left - 1) * capBase;    // 后面每辆最多 capBase
        if (cc > maxAllowed) cc = maxAllowed;
        if (cc < minAllowed) cc = minAllowed;
        if (cc < 1) cc = 1;
        boxes.push({ color: col, count: cc, exposeRound: firstRd });
        rest -= cc;
      }
    }
    return boxes;
  }

  function pickBoxSplit(blocks, config) {
    // 【v350·用户裁决】按目标图暴露顺序切车单（配合 boardLayout='rowMajor' 使用）。
    if (config && config.cutMode === 'exposeCut') {
      try { var _ec = exposeCut(blocks, config); if (_ec && _ec.length) return _ec; } catch (e) { }
    }
    // 【v347·用户裁决】按「依赖层 × 色块」切车：先有自然块，再合并到目标车数
    if (config && config.cutMode === 'roundCut') {
      try { var _rc = roundCut(blocks, config); if (_rc && _rc.length) return _rc; } catch (e) { blocks._rcErr = String(e && e.message); }
    }
    if (config && config.cutMode === 'debtBlock') {
      try { var _db = debtBlockCut(blocks, config); if (_db && _db.length) return _db; } catch (e) { blocks._dbErr = String(e && e.message); }
    }
    if (config && config.cutMode === 'colorSegment') {
      try { var _cs = colorSegmentCut(blocks, config); if (_cs && _cs.length) return _cs; } catch (e) { blocks._csErr = String(e && e.message); }
    }
    if (config && config.cutMode === 'layerAdaptive') {
      try {
        var _la = layerAdaptiveCut(blocks, config);
        blocks._laStat = _la ? { n: _la.length } : null;
        if (_la && _la.length) return _la;
      } catch (e) { blocks._laErr = String(e && e.message); }
    }
    if (config && config.cutMode === 'layerUnit') {
      try { var _lu = layerUnitCut(blocks, config); if (_lu && _lu.length) return _lu; } catch (e) { }
    }
    if (config && config.cutMode === 'layerBlock') {
      try {
        var _lb = layerBlockCut(blocks, config);
        var _sum = 0; if (_lb) for (var _li = 0; _li < _lb.length; _li++) _sum += _lb[_li].count;
        blocks._lbStat = { n: _lb ? _lb.length : 0, sum: _sum };
        if (_lb && _lb.length) return _lb;
      } catch (e) { blocks._lbErr = String(e && e.message); }
    }
    // 【v342·实验】层切：按依赖层切车 + 按到期排序（失败自动落回默认切法）
    if (config && config.cutMode === 'layerCut2') {
      try {
        var _lc = layerCutBoxes2(blocks, config);
        if (_lc && _lc.length) return _lc;
      } catch (e) { }
    }
    var boxes = pickBoxSplitRaw(blocks, config);
    boxes = applyBoxPhase(boxes, config);
    // 【v284】先做容量归一化（同色内拆分/合并），再走后面的容量策略
    if (config.capNormalize !== false) {
      try {
        var _nv = normalizeCapacities(boxes, config);
        if (_nv && _nv.length) { if (_nv._norm) config._normStat = _nv._norm; boxes = _nv; }
      } catch (e) { }
    }
    // 【v219·实验】摆放顺序变量：同一批车，只改"谁先被放进棋盘"。
    //   逐行填 → 队首的车落在可点环上，所以顺序直接决定开局供给与债点。
    var _po = config && config.placeOrder;
    if (_po && boxes.length > 1) {
      var _arr = boxes.slice();
      if (_po === 'reverse') _arr.reverse();
      else if (_po === 'capDesc') _arr.sort(function (a, b) { return b.count - a.count; });
      else if (_po === 'capAsc') _arr.sort(function (a, b) { return a.count - b.count; });
      else if (_po === 'shuffle') {
        var _sd = (parseInt(config.placeSeed, 10) || 7) >>> 0;
        for (var _i = _arr.length - 1; _i > 0; _i--) {
          _sd = (_sd * 1664525 + 1013904223) >>> 0;
          var _j = _sd % (_i + 1), _t = _arr[_i]; _arr[_i] = _arr[_j]; _arr[_j] = _t;
        }
      }
      boxes = _arr;
    }
    // 【v244】同色跨层拆两辆（用户裁决 2）：浅层一块、深层一块分开切，深层那辆必须等。
    try {
      // 【v275】容量跟开局暴露量挂钩（先跑，后面的切法在它基础上再调）
      if (config.capTie) {
        var _ct = retuneCapacities(boxes, blocks, config._demandCurve, config);
        if (_ct && _ct.length) { if (_ct._capTie) config._capTieStat = _ct._capTie; boxes = _ct; }
      }
      if (config.chunkCut) {
        var _cc2 = chunkAlignedCut(boxes, blocks, config._demandCurve, config);
        if (_cc2 && _cc2.length) { if (_cc2._chunkCut) config._chunkCutStat = _cc2._chunkCut; boxes = _cc2; }
      }
      if (config.splitByLayer) {
        var _lbs = splitBoxesByLayer(blocks, config, boxes);
        if (_lbs && _lbs.length) {
          if (_lbs._layerSplit) config._layerSplitStat = _lbs._layerSplit;
          boxes = _lbs;
        }
      }
    } catch (e) { }
    // 【v218】收尾清理微型车（<3px），避免出现容量 1 的车
    try { boxes = fixTinyBoxes(boxes, Math.max(3, parseInt(config.boxSizeMin, 10) > 0 ? 3 : 3)); } catch (e) { }
    // 【v337·诊断】如果调用方传了 _cutLog，就把"这次切球的关键参数"记下来（默认不传 = 零开销）
    if (config && config._cutLog) {
      try { config._cutLog.push({ n: boxes.length, tc: config.targetCarCount, min: config.boxSizeMin, max: config.boxSizeMax, st: (new Error()).stack.split('\n').slice(2, 5).map(function (x) { return x.trim().split(' ')[1]; }).join(' < ') }); } catch (e) { }
    }
    // 【v228】车数不够目标 → 拆大车（填满棋盘、让"大容量+小棋盘"成立）
    // 【v313·用户裁决】拆出来的两半都不得低于用户设的容量下限。
    //   之前 minHalf 写死 12：35×35 图 targetCarCount=77 时，50 的车被对半拆成
    //   12/13/16/19 一堆小车，棋盘上满眼"19"（用户当场指出「还是不对」）。
    //   现在下限 = boxSizeMin；拆不动就不拆（宁可车少，不要车小）。
    try {
      if (config.targetCarCount) {
        var _minHalf = Math.max(12, parseInt(config.boxSizeMin, 10) || 12);
        boxes = splitCarsToTarget(boxes, parseInt(config.targetCarCount, 10), _minHalf);
      }
    } catch (e) { }
    // 【v230】定向埋深：每色最大的一辆推到队尾 + 容量压到该色总量的一半以内
    try {
      if (config.buryBig) {
        var _bp = config.buryPct;
        if (_bp !== 'auto' && _bp !== 'exposed') _bp = parseFloat(_bp) || 0.6;
        boxes = buryBigCars(boxes, blocks, _bp);
      }
    } catch (e) { }
    // 【v223】债车构造：把 k 辆深层车喂到目标容量（默认 0 = 不做）
    try { boxes = growDebtCars(boxes, parseInt(config.debtCars, 10) || 0, parseInt(config.debtCarCap, 10) || 32); } catch (e) { }
    return boxes;
  }

  function pickBoxSplitRaw(blocks, config) {
    // ===== 【v153 切球规划器】外部车单直通 =====
    //   config.forcedBoxes = [{color,count}, ...]（顺序 = 供给顺序）。
    //   切球方案由规划器按「供给时间线」给出（矿脉表 → 每条矿脉切 1~4 辆），
    //   生成器只负责把它造成关卡（选盘/铺障碍/填车/验证），不再自行决定切法。
    //   车单顺序即填车顺序：早矿脉的车摆在早可达位 → 「切球的顺序」由此进入关卡。
    if (config.forcedBoxes && config.forcedBoxes.length) {
      return config.forcedBoxes.map(function (b) { return { color: b.color, count: b.count }; });
    }
    // ===== v137 锚点切盒（可选；boxCutMode 默认 'trend'，不进这段）=====
    //   失败（拿不到盒/抛错）就落回默认切法 —— 新模式不许把关卡生产整死。
    if (config.boxCutMode === 'anchor' && AntSolver.AnchorCut && AntSolver.AnchorCut.cutBoxes) {
      try {
        var anchorBoxes = AntSolver.AnchorCut.cutBoxes(blocks, anchorCutConfig(config));
        if (anchorBoxes && anchorBoxes.length) return anchorBoxes;
      } catch (e) { /* 落回默认切法 */ }
    }
    // 【v209】合球（按色块 × 层；默认关）
    if (config.cutMode === 'component') {
      try {
        var cb = componentBoxes(blocks, config);
        if (cb && cb.length) return cb;
      } catch (e) { /* 落回默认切法 */ }
    }
    // 【v207】按层切车（合球第一步；默认关）
    // ===== 【v297·用户设计】按「依赖层」切车（`cutMode:'layerCut'`，默认关） =====
    // 与 `layerAware` 的区别（后者用的是贪心日程轮次，不是层，见工作日志 81 节"轮次≠层"）：
    //   本模式用 `veinLayers` 的**真实依赖层**（色块 4-连通 + 洋葱 BFS），
    //   即"必须先清掉外面几层，才碰得到它"。
    //
    // 切法：把同一颜色、同一依赖层的色块归为一个"供给单元"，再切成若干辆车。
    //   · 一辆车**不跨颜色、不跨层** —— 这是本模式的核心约束，
    //     保证"这辆车要什么"与"它什么时候能吃到"一一对应；
    //   · 容量上限跟着层走：浅层（L=0,1）用小容量 capShallow，深层用 capDeep
    //     → 浅层车小 = 一上来就能装满（供给）；深层车大 = 必须等外层清完（债务载体）。
    //
    // 守恒：每个供给单元的容量和 = 该单元像素数（最后一辆吸收余数），
    //   函数返回前整体校验 Σ容量 = 彩色像素总数，不守恒直接返回 null 落回默认切法。
    if (config.cutMode === 'layerCut') {
      try {
        var lcb = layerCutBoxes(blocks, config);
        if (lcb && lcb.length) return lcb;
      } catch (e) { /* 落回默认切法 */ }
    }
    if (config.cutMode === 'layerAware') {
      try {
        var lb = layerAwareBoxes(blocks, config);
        if (lb && lb.length) return lb;
      } catch (e) { /* 落回默认切法 */ }
    }
    // 瞬时连锁模式固定四方向：绝不走底部依赖流分支（需求 §七.3：不得继承底部单入口结构限制）。
    // 盒切分本身复用现有四方向口径，不新写第二套可达算法（需求 §十二）。
    if (config.instantChain) {
      return config.baseFillByElimOrder !== false ? baseFillBoxes(blocks, config) : solverGuidedBoxes(blocks, config);
    }
    if (config.bottomOnly) return baseFillBoxesBottom(blocks, config);
    return config.baseFillByElimOrder !== false ? baseFillBoxes(blocks, config) : solverGuidedBoxes(blocks, config);
  }

  /* ==================== 【v137】棋盘范围 × 车数 预检 ====================
   * 用户 2026-10-14 批准：「把『棋盘范围跟车数不匹配』做成开工前的拦截提示，免得再出现 0/0/0 却看不出原因」。
   *
   * 【症状】页面上只有「生产完成　合格 0 / 不合格 0 / 异常 0」，看不出为什么。实测（用户 Level4_目标图_27x32.txt，
   *   641 像素 / 5 色 / 约 20 辆车，行列 8~9 × 11~16）：8 个候选全部栽在结构层的 structSurplus，
   *   detail = 「空格63 > 盒数20，多余空格无法全部转黑块」，而这条 detail 一路被折叠成 lastFailReason:'noCandidate'
   *   → 落到记录里只剩「候选全灭：」四个字。
   *
   * 【必然淘汰的判据】结构层第③步「多余空格转黑块」的硬上限是 **45% 格数**（fillSurplusWithBlack 的 cap），
   *   所以任何尺寸下最终空格 ≥ 55% 格数；而「空格 > 盒数」即淘汰（structSurplus）。
   *   ⇒ 当 **车数 < 0.55 × 范围内能取到的最小格数** 时，无论随机到哪个尺寸都必然淘汰。
   *
   * 【口径：宁可漏报，不误杀】
   *   · 车数 n = 切盒跑 3 次取**最小**值（盒容量是随机采样，取最小=最保守）。
   *   · 最小/最大格数 = 方案范围内形态合法(列−行∈{1,2})的组合 ∪ 可用空间目标的「逐行向下缩小」路径
   *     （行 ≥ max(6, rowsMin−3)、列 = 行+1/行+2），取最小/最大面积。
   *   · 只在「必然淘汰」时拦截（boardFitGuard:'block'，默认）；其余只 warn（偏大/偏小），不改生产结果。
   */
  function boardCellsExtent(config) {
    var rMin = clampInt(config.boardRowsMin, AntSolver.BOARD_ROWS, 3, 20);
    var rMax = clampInt(config.boardRowsMax, AntSolver.BOARD_ROWS, rMin, 20);
    var cMin = clampInt(config.boardColsMin, AntSolver.BOARD_COLS_MIN, 3, 30);
    var cMax = clampInt(config.boardColsMax, AntSolver.BOARD_COLS_MAX, cMin, 30);
    var minA = Infinity, maxA = 0, minDim = null, maxDim = null, legal = 0;
    function consider(r, c) {
      if (!boardShapeOk(r, c, !!config.boardAllowSquare)) return;
      var a = r * c; legal++;
      if (a < minA) { minA = a; minDim = { rows: r, cols: c }; }
      if (a > maxA) { maxA = a; maxDim = { rows: r, cols: c }; }
    }
    for (var r = rMin; r <= rMax; r++) for (var c = cMin; c <= cMax; c++) consider(r, c);
    // 可用空间目标开启时，chooseBoardDimsFixed 允许「逐行向下缩小」到范围外（shrinkFloor = max(6, rMin-3)）
    if (parseFloat(config.usableSpaceTarget) > 0) {
      var floorR = Math.max(6, rMin - 3);
      for (var sr = floorR; sr < rMin; sr++) { consider(sr, sr + 1); consider(sr, sr + 2); }
    }
    return { rowsMin: rMin, rowsMax: rMax, colsMin: cMin, colsMax: cMax,
             cellsMin: minA, cellsMax: maxA, minDim: minDim, maxDim: maxDim, legalDims: legal };
  }

  /**
   * 【v145】由车数反推棋盘范围（列−行∈{1,2} 的合法形态；给成一【条带】，不是单一尺寸）。
   *
   * 【为什么给条带而不是一个数】棋盘大小是个三方约束：棋盘格数 C、溢出到管道的盒数 D、黑块 B。
   *   守恒关系是 D = n − C + K（K = C×(1−可用空间目标) 是"不放盒的配额"，B 与管道格 P 都从 K 里出）。
   *   而管道有个下限：要有 P 条管道、每条至少装 fill 个盒 → 溢出 D 必须 ≥ minPipes × pipeMinFill。
   *   把 D ≥ minPipes×fill 代进去就得到 **C 的上界**：棋盘再大，就没有足够的盒溢出到管道，
   *   管道下限就凑不出来了（生成器此时会退到"去掉管道"那条路，那正是"墙过多缩棋盘"要处理的情形）。
   *   下界不存在硬边界（太小的盘由 solveSpaceQuota 自己判无解并跳过），所以给一条带、让原本的
   *   可行性搜索（chooseBoardDimsFixed + solveSpaceQuota + 缩盘逻辑）在里面挑。
   *
   * 【旧的 v137 版本错在哪】直接用 cars/0.74，既没考虑管道（大图算出的盘偏大），
   *   又卡在 r≤8 直接返回 null（53×53 那类大图、76 车 → 根本没建议，报错文案里"建议行列"整句消失）。
   *   反过来"把管道容量整个减掉"也是错的——那会把棋盘算到只剩几格（16 车 / 4 条管道 → 3×4），
   *   因为管道装的是【溢出】，不是主体。
   *
   * @param {number} cars 车数（= 盒数）
   * @param {object} [config] 取可用空间目标与管道参数；缺省按 0.74 / 无管道
   */
  function suggestBoardRange(cars, config) {
    cars = Math.max(1, parseInt(cars, 10) || 1);
    var ust = parseFloat(config && config.usableSpaceTarget);
    if (!(ust > 0) || ust >= 1) ust = 0.74;
    var minPipes = Math.max(1, parseInt(config && config.minPipes, 10) || 1);
    var hasPipes = !(config && parseInt(config.minPipes, 10) === 0);
    var minFill = pipeMinFillOf(config), maxDepth = pipeDepthOf(config);
    // 期望的溢出盒数：按「单管最少 ~ 深度上限」的中值估。
    //   按深度上限估 → 棋盘偏小、全靠管道 → 实测 minPipes=4 的配置容易在结构层
    //   usablePipeShort（管道装不下）整关淘汰；按单管最少估又会让棋盘偏大（黑块超标）。
    //   中值与 chooseBoardDimsFixed 里的 minOv 同口径，实测最稳。
    // 【v392·用户裁决】先 board 后 pipe：boardFirst 时不预先给管道留溢出，先按全部车上盘反推棋盘。
    var dWant = (config && config.boardFirst) ? 0 : (hasPipes ? minPipes * Math.ceil((minFill + maxDepth) / 2) : 0);
    var cAll = Math.ceil(cars / ust);                      // 全部车都上盘所需格数（= 没有管道时的口径）
    var cTarget = Math.floor((cars - dWant) / ust);        // 想留出这么多溢出时的棋盘大小
    // 车太少 / 管道配太多 → 溢出根本凑不出来 → 直接按"全部车上盘"给盘，管道交给生成器自己决定去留
    var cTop = (cTarget < cAll * 0.5) ? cAll : cTarget;
    if (!(cTop > 0)) cTop = cAll;
    // 【v151 修一个 v145 的真 bug】取「**最小的、装得下 cTop 的**合法行数」。
    //   ⚠ 曾经写的是"取 |r(r+2) − cTop| 最小的行数"（argmin）—— 那**允许往下取**：
    //     19 车 × 极难档时 cTop=26，最接近的是 4×6=24（比 26 还小），
    //     于是条带下端 4×5=20 格比需求还小，下游 chooseBoardDimsFixed 就挑了那个最小的盘，
    //     19 辆车被硬塞进去（板上只放 15 盒、其余进管道）→ 开局"能吃满"的选项天然只有 2 个
    //     → 「选择余地」曲线天生是扁的。**这就是"没灵气"的第一因。**
    //   现在的判据与"只往上、不下探"的注释一致：r(r+2) ≥ cTop 的最小 r。
    var rHi = 20;
    for (var r = 3; r <= 20; r++) { if (r * (r + 2) >= cTop) { rHi = r; break; } }
    // 【只往上、不下探】条带 = 「r ~ r+1 行 × r+1 ~ r+2 列」（与 v137 的建议格式同形）。
    //   往下放会让 chooseBoardDimsFixed 随机挑到极小的盘：实测条带放到 r−3 时，
    //   16 辆车被挑到 3×4=12 格（盘上只放 7 辆、其余全塞管道），完全不像一关。
    //   棋盘略大于目标只意味着溢出的盒少一点（管道退到下限以下时生成器本就会去掉管道）。
    return {
      rowsMin: rHi, rowsMax: rHi + 1, colsMin: rHi + 1, colsMax: rHi + 2,
      cars: cars, ust: ust, dWant: dWant, cTarget: cTarget, cTop: cTop, cAll: cAll,
      need: cTop, pipeCap: dWant, cells: rHi * (rHi + 2)
    };
  }

  /** 把棋盘范围写进 config 的副本（不改原对象）。 */
  function withBoardRange(config, r) {
    var o = Object.assign({}, config);
    o.boardRowsMin = r.rowsMin; o.boardRowsMax = r.rowsMax;
    o.boardColsMin = r.colsMin; o.boardColsMax = r.colsMax;
    return o;
  }

  /**
   * 【v145】车数采样：切盒跑 3 次取中位数（覆盖容量区间的低/中/高三处）。
   * **绝不许扰动生产随机流** —— 这 3 次用固定值顶替 Math.random，结束后立刻还原
   * （否则后面所有候选拿到的随机数整体移位，"默认口径不变"就只剩口头承诺，实测会真产出不同关卡）。
   * 由 preflightBoardFit 与 applyAutoBoardRange 共用，避免两处各写一份。
   */
  function sampleCarCount(blocks, config) {
    var nMin = Infinity, nMax = 0, nAll = [], savedRandom = Math.random;
    var probe = [0.15, 0.5, 0.85];
    try {
      for (var i = 0; i < probe.length; i++) {
        var v = probe[i];
        Math.random = function () { return v; };
        var b = null;
        try { b = pickBoxSplit(blocks, config); } catch (e) { b = null; }
        if (b && b.length) { nAll.push(b.length); if (b.length < nMin) nMin = b.length; if (b.length > nMax) nMax = b.length; }
      }
    } finally { Math.random = savedRandom; }
    if (!nMax) return null;
    nAll.sort(function (a, b2) { return a - b2; });
    return { nMin: isFinite(nMin) ? nMin : nMax, nMax: nMax, nMed: nAll[Math.floor(nAll.length / 2)], samples: nAll.slice() };
  }

  /**
   * 【v149】管道下限的相容性检查：**车数少到装不下那么多管道时，自动把它降到撑得起来的值**。
   *
   * 症状（v148 实测，硬证据）：27×32 那张图用锚点切只切出 **14 辆车**，配「管道下限 4 条 + 单管最少 4 盒」
   *   → 要 4×4 = **16 个溢出盒**，可总共才 14 辆车 → **20/20 候选全部栽在结构层 `usablePipeShort`**。
   *   同配置换趋势切（16 辆车）勉强能过 —— 所以用户看到的是"换个切盒方式就产不出关了"。
   *
   * 为什么是"降到能凑出来的最大值"而不是"报错"：管道装的是【溢出】，车少时本来就没什么可溢出的；
   *   这跟 v145「棋盘自适应」是同一个思路 —— **参数互相打架时自动调成相容，并如实告知**，而不是让整批全灭。
   *   生成器本来就有"低于绝对下限就直接去除管道"的设计（pipeFloorCount），本函数只是把它【提前到选盘之前】。
   *
   * 判据：要求溢出不超过总车数的一半（板上至少留一半车），
   *   而 P 条管道每条至少 fill 个盒 ⇒ 溢出 ≥ P×fill  ⇒  P ≤ ⌊(cars/2) / fill⌋。
   *   例：14 车 / fill 4 → 最多 1 条；52 车 → 6 条；76 车 → 9 条（这两种不受影响，口径不变）。
   *
   * @returns {object|null} null = 本来就不冲突（口径不变）
   */
  function clampPipeDemand(cars, config) {
    var mp = parseInt(config && config.minPipes, 10) || 0;
    if (mp <= 0) return null;                       // 本来就没要求管道
    var fill = Math.max(1, pipeMinFillOf(config));
    var maxPipes = Math.floor((cars / 2) / fill);
    if (mp <= maxPipes) return null;                // 撑得起来 → 不动
    return { from: mp, to: Math.max(0, maxPipes), cars: cars, fill: fill };
  }

  /**
   * 【v145】棋盘自适应：不用你填行列范围，由「这张图切出多少辆车」直接反推。
   *
   * 用户 2026-10-15 原话：「我觉得他这个比如失败的时候，说『棋盘的范围跟这个车子的数量不匹配』，
   * 我觉得这个很扯淡。为什么不能让他的这个棋盘的范围自适应我的车子的数量呢？」
   *
   * 为什么可以反推：**车数只取决于「目标图 + 盒容量」，与棋盘无关** —— 这里的切盒只吃 blocks/config，
   * 棋盘尺寸是之后才选的。所以正确顺序就是「先切车 → 再算要多大盘」，而不是「先填盘 → 发现装不下 → 淘汰」。
   *
   * boardAuto !== false 时生效：把反推出来的范围写进 config 副本，下游 chooseBoardDimsFixed /
   * solveSpaceQuota / boardCellsExtent 一律不用改 —— 它们拿到的就是一个正常的范围。
   * 反推失败（切不出车）时原样返回，交回原有兜底。
   */
  function applyAutoBoardRange(blocks, config) {
    if (!config) return config;
    if (!blocks || !blocks.length || !blocks[0]) return config;
    var sc = null;
    try { sc = sampleCarCount(blocks, config); } catch (e) { sc = null; }
    if (!sc) return config;
    var o = config;
    // ① 【v149】管道下限相容性：**与 boardAuto 无关，两种模式都做**
    //    —— 这是"参数自相矛盾"，不是尺寸偏好问题；手填棋盘范围也一样会全灭。
    var clamp = clampPipeDemand(sc.nMed, o);
    if (clamp) { o = Object.assign({}, o, { minPipes: clamp.to, _autoPipeClamp: clamp }); }
    // ② 【v145】棋盘自适应（只在这一档开启时做）
    if (o.boardAuto === false) return o;
    var r = suggestBoardRange(sc.nMed, o);
    if (!r) return o;
    var o2 = withBoardRange(o, r);
    o2._autoBoardRange = { cars: sc.nMed, carsMin: sc.nMin, carsMax: sc.nMax, range: r };
    return o2;
  }

  function preflightBoardFit(blocks, config) {
    var ext = boardCellsExtent(config);
    var res = { ok: true, reason: null, detail: '', warn: null,
                cars: null, cellsMin: ext.cellsMin, cellsMax: ext.cellsMax,
                range: { rowsMin: ext.rowsMin, rowsMax: ext.rowsMax, colsMin: ext.colsMin, colsMax: ext.colsMax },
                minDim: ext.minDim, maxDim: ext.maxDim, suggest: null };
    if (!isFinite(ext.cellsMin) || ext.cellsMin <= 0) return res;   // 范围内没有形态合法的尺寸：不表态，交给现有兜底
    // 【关键】预检**不许扰动生产的随机流**：盒容量是随机采样的，若在这里白抽几次 Math.random，
    //   后面所有候选拿到的随机数就整体移位 → 「默认口径不变」就只剩口头承诺（实测会真的产出不同关卡）。
    //   做法：切盒那 3 次用三个固定值顶替 Math.random（覆盖容量区间低/中/高三处），结束后立刻还原。
    // 【判定用哪个数】取 3 次采样的【中位数】当拦截依据，另记最小/最大用于提示文案。三条口径实测对比：
    //   · 用【最小】车数（最严）：会把正常能出关的配置也拦掉——用户那张 27×32 小图，容量一抽大车就少，
    //     实测 4~5×6~7 这种本来能出关的配置被误杀（所以不采用）。
    //   · 用【最大】车数（最松）：只有在"车最多也装不满最小盘"时才拦，绝不会误杀，但会放过一批
    //     事实上必死的输入（用户那批 8~9×11~16 就是这种：车最多 24、最小盘 42 格，卡在临界点上）。
    //   · 取【中位数】（本版采用）：拿"典型那次切盒"去比，既保住小图正常配置不误杀，
    //     又能把用户那批这种"典型情况下装不满"的输入拦下来。boardFitGuard:'warn' 可改成只看提示不拦。
    var sc = sampleCarCount(blocks, config);   // 【v145】与「棋盘自适应」共用同一份采样（都不许扰动随机流）
    if (!sc) return res;
    var nMin = sc.nMin, nMax = sc.nMax, nAll = sc.samples;
    var nMed = sc.nMed;                        // 中位数：典型情况下的车数
    var n = nMed;
    res.cars = nMax; res.carsMed = nMed; res.carsMin = nMin;
    res.carsSamples = nAll.slice();
    // 【v153】源图体检：开局暴露了几种颜色（纯读，不改任何生成口径）。
    //   放在预检里而不是另做一遍的原因：这里的入口【每次生产都会走】（boardFitGuard!=='off'），
    //   而且失败/成功两条返回路径都能带上它 → 页面日志与逐关记录都能如实看到这张图的"开局可选性"。
    res.openingExposure = openingExposure(blocks, blocks.length, (blocks[0] || []).length, !!config.bottomOnly);
    var rng = ext.rowsMin + '~' + ext.rowsMax + ' × ' + ext.colsMin + '~' + ext.colsMax;
    if (n < 0.55 * ext.cellsMin) {
      var sug = suggestBoardRange(n, config);
      res.ok = false; res.reason = 'boardRangeMismatch'; res.suggest = sug;
      res.detail = '这张图切出约 ' + res.carsMin + '~' + nMax + ' 辆车（典型 ' + nMed + ' 辆），而棋盘范围 ' + rng + ' 最小也是 '
        + ext.minDim.rows + '×' + ext.minDim.cols + '=' + ext.cellsMin + ' 格；'
        + '多余空格最多只能补成 45% 的黑块，剩下的空格必然多于车数 → 每个候选都会在结构层被淘汰'
        + '（页面上表现为「合格 0 / 不合格 0 / 异常 0」）。'
        + (sug ? '建议把行数范围改成 ' + sug.rowsMin + '~' + sug.rowsMax + '、列数范围改成 ' + sug.colsMin + '~' + sug.colsMax + ' 再试；'
               : '建议把行列范围整体调小，或把盒容量调小让车变多（车数 ≈ 目标图像素数 ÷ 每车容量）。')
        + '也可以直接把「切盒方式」换成锚点切盒后重试（它按平均容量切，车数与趋势切不同）。';
      res.exposureWarn = exposureWarnText(res.openingExposure);   // 【v153】源图体检（可能为 null）
      return res;
    }
    if (nMax < 0.75 * ext.cellsMin) {
      var sug2 = suggestBoardRange(n, config);
      res.suggest = sug2;
      res.warn = '棋盘范围偏大：这张图切出约 ' + res.carsMin + '~' + nMax + ' 辆车，范围内最小盘 ' + ext.minDim.rows + '×' + ext.minDim.cols
        + ' 格也偏空，容易整批候选全灭。'
        + (sug2 ? ('建议行数 ' + sug2.rowsMin + '~' + sug2.rowsMax
            + '、列数 ' + sug2.colsMin + '~' + sug2.colsMax + '。') : '');
    } else if (res.carsMin > ext.cellsMax) {
      res.warn = '棋盘范围偏小：车数至少 ' + res.carsMin + ' > 范围内最大盘 ' + ext.maxDim.rows + '×' + ext.maxDim.cols
        + '=' + ext.cellsMax + ' 格，大量盒要走管道，可能撞管道容量/深度上限。';
    }
    // 【v153】开局仅 1~2 色可吃 → 追加一句"这是源图造成的、调参改不了"的说明（与上面那条提醒并存，不覆盖）。
    var expWarn = exposureWarnText(res.openingExposure);
    if (expWarn) res.warn = res.warn ? (res.warn + ' ｜ 另外：' + expWarn) : expWarn;
    return res;
  }

  /**
   * 【v137】候选全灭时，把"到底为什么全灭"翻译成一句人话。
   * 依据 = 各候选淘汰计数（flowStats.fail，由 recordAttempt 累加）+ 棋盘预检的结论。
   * 原先该字段只有「候选全灭：」四个字（内层 detail 被折叠掉了），现在带上计数与主因。
   */
  function diagnoseNoCandidate(flowStats, fit) {
    var f = (flowStats && flowStats.fail) || {}, total = 0, k;
    for (k in f) total += (f[k] || 0);
    if (!total) return null;
    if (f.structSurplus && f.structSurplus >= total * 0.5) {
      return { reason: 'boardRangeMismatch',
               detail: (fit && fit.detail) ? fit.detail
                 : ('结构层淘汰 ' + f.structSurplus + '/' + total + ' 次都是「多余空格 > 盒数」：棋盘比车数大太多，请把行列范围调小或把盒容量调小。') };
    }
    var top = null;
    for (k in f) if (f[k] > 0 && (!top || f[k] > f[top])) top = k;
    return { reason: 'noCandidate',
             detail: '候选淘汰主因「' + top + '」' + f[top] + '/' + total + ' 次；全部计数 ' + JSON.stringify(f) };
  }

  /**
   * 【仅底部入口】生产前可达性检查（原需求 §四 / 方案 C1）。
   *
   * 为什么必须查：Simulator.floodFillEliminate 的 reachable() 只从【底边】与【已消除格】扩散，
   * 而空白格仅在 outsideReachSeed 初始播种时才会被标为已消除。底部模式只播"与底边连通"的空白，
   * 于是【只与顶/左/右背景连通的空腔】永远打不通，被它包围的色块永久摸不到。四边模式下这些空腔
   * 一开始就被播种了，所以这是底部模式独有的结构性风险，必须在进入高成本候选生成之前判掉，
   * 避免把"源图结构不适配"误报成"生成器超时"。
   *
   * 算法：复用现有可达逻辑，不引入新算法。从 outsideReachSeed(...,true) 起，反复对每种剩余颜色执行
   * floodFillEliminate(..., Infinity, ..., true)，直到某一轮 0 消除；此时仍未消除的彩色像素即永久不可达。
   *
   * @returns {object} { ok, total, left, byColor, positions, rows, cols }
   *   ok=true 表示全图可达；left 为不可达像素数；positions 最多记录前 50 个坐标供美术定位修改。
   */
  /**
   * ==================== 目标图碎色率（生产前置闸门用） ====================
   * 任务 ANT-GEN-FRAGMENT-GATE-20260824，用户 2026-08-24 批准。
   *
   * 「碎色」= 目标图上那些【自己不够大、附近同色也凑不够】的色块。它们迫使一个 35~80 容量的盒
   * 跨越许多互不相连的小片去吃饱，从而拉长订单滞留。本函数只读目标图，不涉及棋盘与障碍。
   *
   * 口径（与 08-24 标定完全一致，改任一项都会使阈值失效）：
   *   ① 同色 4-连通分块 —— 与游戏消除口径一致（floodFillEliminate 也是四方向）。
   *   ② 孤立块 size<=isoMax(1)；小色块 isoMax<size<=smallMax(10)；正常块 size>smallMax。
   *   ③ 簇扩展：两同色块之间的「隔断」= 夹着的异色像素数 px 与颜色种类数 kinds。
   *      因目标图完全填满(实测 344/345 关无背景)，px 与曼哈顿距离等价(差 ±1)。
   *      停止条件按 AND：kinds>barrierKinds(1) 且 px>barrierPx(3) 才判定隔开、不并簇。
   *      （AND 为用户原式；08-24 扫描显示其优于 OR，故保留。）
   *   ④ 长期隔断过滤：隔断色若【不会先于本色被消除】，则视为长期隔断、不并簇。
   *      本色/隔断色的消除先后取自 AntSolver.eliminationOrder 的真实轮次。
   *   ⑤ 簇总像素 > smallMax 时，整簇内的小/孤立块改判正常（被"救回"）。
   *   ⑥ 碎色率 = 最终仍为碎色的像素数 ÷ 目标图彩色像素总数。
   *
   * @param {Array<Array<number>>} blocks 目标图
   * @param {object} [cfg] 覆盖口径参数（fragmentIsoMax/fragmentSmallMax/fragmentBarrierPx/fragmentBarrierKinds）
   *                       另可传 fragmentDetail:true 索取块级明细（默认不返回，见下）
   * @returns {object} { rate, isoRate, smallRate, fragPixels, totalPixels, fragBlocks, blocks:块数,
   *                     maxColorRate:最碎单色碎色率, avgFragDepth:碎色平均消除轮次, rounds }
   *                   传 fragmentDetail 时【额外】带上（不传则这三个字段不存在）：
   *                     fragCells:[{r,c,color,size,iso}]  —— 碎色像素坐标，length === fragPixels
   *                     fragBlockList:[{color,size,iso,cells}] —— 碎色块，length === fragBlocks
   *                     perColorDetail:[{color,total,frag,rate}] —— 分色明细，按碎色率降序
   *                   明细是「并簇救回之后」的最终判定结果，与 rate 同口径 ——
   *                   这正是它存在的理由：调用方自己按块大小近似会把视觉上连续的条带误判为碎色。
   */
  function computeFragmentation(blocks, cfg) {
    cfg = cfg || {};
    var isoMax = cfg.fragmentIsoMax != null ? cfg.fragmentIsoMax : 1;
    var smallMax = cfg.fragmentSmallMax != null ? cfg.fragmentSmallMax : 7;
    var barPx = cfg.fragmentBarrierPx != null ? cfg.fragmentBarrierPx : 3;
    var barKinds = cfg.fragmentBarrierKinds != null ? cfg.fragmentBarrierKinds : 1;
    var empty = { rate: 0, isoRate: 0, smallRate: 0, fragPixels: 0, totalPixels: 0, fragBlocks: 0, blocks: 0, maxColorRate: 0, avgFragDepth: 0, rounds: 0 };
    if (!blocks || !blocks.length || !blocks[0]) return empty;
    var rows = blocks.length, cols = blocks[0].length;
    var DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

    // ① 同色 4-连通分块
    var lab = [], r, c, i;
    for (r = 0; r < rows; r++) { lab.push([]); for (c = 0; c < cols; c++) lab[r].push(-1); }
    var compColor = [], compSize = [], compCells = [];
    for (r = 0; r < rows; r++) for (c = 0; c < cols; c++) {
      var v = blocks[r][c];
      if (v > 0 && lab[r][c] < 0) {
        var id = compColor.length, stack = [[r, c]], cells = [];
        lab[r][c] = id;
        while (stack.length) {
          var cur = stack.pop(); cells.push(cur);
          for (var d = 0; d < 4; d++) {
            var ny = cur[0] + DIRS[d][0], nx = cur[1] + DIRS[d][1];
            if (ny < 0 || ny >= rows || nx < 0 || nx >= cols) continue;
            if (blocks[ny][nx] === v && lab[ny][nx] < 0) { lab[ny][nx] = id; stack.push([ny, nx]); }
          }
        }
        compColor.push(v); compSize.push(cells.length); compCells.push(cells);
      }
    }
    var N = compColor.length;
    if (!N) return empty;
    var totalPx = 0;
    for (i = 0; i < N; i++) totalPx += compSize[i];

    // 消除轮次（长期隔断判定 + 碎色深度）。失败则退化为不做长期隔断过滤，不阻断生产。
    var roundOf = null, roundsTotal = 0, colorFirst = {};
    try {
      var eo = AntSolver.eliminationOrder(blocks, rows, cols, false);
      roundOf = eo.round; roundsTotal = eo.rounds;
      for (r = 0; r < rows; r++) for (c = 0; c < cols; c++) {
        var rd = roundOf[r][c] || 0, cv = blocks[r][c];
        if (cv > 0 && rd) { if (colorFirst[cv] == null || rd < colorFirst[cv]) colorFirst[cv] = rd; }
      }
    } catch (e) { roundOf = null; }

    // 颜色索引（隔断种类掩码用）
    var colorIdx = {}, colorList = [], cnum = 0;
    for (i = 0; i < N; i++) if (colorIdx[compColor[i]] == null) { colorIdx[compColor[i]] = cnum++; colorList.push(compColor[i]); }

    // ③ 0-1 BFS 逐色求相邻同色块对的隔断，并按门限并簇
    var parent = [];
    for (i = 0; i < N; i++) parent.push(i);
    function find(x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
    function union(a, b) { var ra = find(a), rb = find(b); if (ra !== rb) parent[rb] = ra; }

    var byColor = {};
    for (i = 0; i < N; i++) { (byColor[compColor[i]] = byColor[compColor[i]] || []).push(i); }
    for (var ci = 0; ci < colorList.length; ci++) {
      var col = colorList[ci], ks = byColor[col];
      if (!ks || ks.length < 2) continue;
      var cost = [], mask = [], own = [];
      for (r = 0; r < rows; r++) {
        cost.push([]); mask.push([]); own.push([]);
        for (c = 0; c < cols; c++) { cost[r].push(1e9); mask[r].push(0); own[r].push(-1); }
      }
      var q = [], head = 0;
      for (i = 0; i < ks.length; i++) {
        var cc2 = compCells[ks[i]];
        for (var j = 0; j < cc2.length; j++) { cost[cc2[j][0]][cc2[j][1]] = 0; own[cc2[j][0]][cc2[j][1]] = ks[i]; q.push(cc2[j]); }
      }
      var seenPair = {};
      function tryPair(a, b, px, m) {
        if (a === b) return;
        var lo = a < b ? a : b, hi = a < b ? b : a, key = lo + '_' + hi;
        var prev = seenPair[key];
        if (prev != null && prev.px <= px) return;
        seenPair[key] = { px: px, mask: m };
      }
      while (head < q.length) {
        var p0 = q[head++], y0 = p0[0], x0 = p0[1];
        var cy = cost[y0][x0], my = mask[y0][x0], oy = own[y0][x0];
        for (var dd = 0; dd < 4; dd++) {
          var ny2 = y0 + DIRS[dd][0], nx2 = x0 + DIRS[dd][1];
          if (ny2 < 0 || ny2 >= rows || nx2 < 0 || nx2 >= cols) continue;
          var vv = blocks[ny2][nx2];
          if (vv === col) {
            var o2 = own[ny2][nx2];
            if (o2 >= 0 && o2 !== oy) tryPair(oy, o2, cy, my);
            continue;
          }
          if (vv <= 0 || colorIdx[vv] == null) continue;
          var nm = my | (1 << colorIdx[vv]), nc = cy + 1;
          if (nc < cost[ny2][nx2]) { cost[ny2][nx2] = nc; mask[ny2][nx2] = nm; own[ny2][nx2] = oy; q.push([ny2, nx2]); }
          else if (own[ny2][nx2] >= 0 && own[ny2][nx2] !== oy) tryPair(oy, own[ny2][nx2], nc + cost[ny2][nx2] - 1, nm | mask[ny2][nx2]);
        }
      }
      for (var key2 in seenPair) {
        var e = seenPair[key2], parts = key2.split('_');
        var kinds = 0, mm = e.mask;
        while (mm) { kinds += (mm & 1); mm >>>= 1; }
        if (kinds > barKinds && e.px > barPx) continue;              // AND：又杂又厚才算隔开
        if (roundOf) {                                              // ④ 长期隔断过滤
          var latest = 0, m2 = e.mask, bi = 0;
          while (m2) { if (m2 & 1) { var fr = colorFirst[colorList[bi]] || 0; if (fr > latest) latest = fr; } m2 >>>= 1; bi++; }
          var ownFirst = colorFirst[col] || 0;
          if (latest && ownFirst && latest >= ownFirst) continue;    // 隔断色不会先消掉 → 长期隔断
        }
        union(parseInt(parts[0], 10), parseInt(parts[1], 10));
      }
    }

    // ⑤⑥ 结算
    var clusterPx = {};
    for (i = 0; i < N; i++) { var rt = find(i); clusterPx[rt] = (clusterPx[rt] || 0) + compSize[i]; }
    var fragPx = 0, isoPx = 0, smallPx = 0, fragBlocks = 0, depthW = 0;
    var perColorFrag = {}, perColorTot = {};
    // 【可选块级明细】任务 ANT-GEN-FRAGMENT-DETAIL-20260825，用户 2026-08-25 批准。
    //   只有显式传 cfg.fragmentDetail 才收集；不传时下面两个数组恒为 null，
    //   返回值与本参数引入前【逐字段完全相同】。
    //
    // 为什么要加：修图工具需要把"哪些像素被判为碎色"高亮给美术看，而本函数原先只返回汇总指标。
    //   工具侧只能自己按"块自身大小"近似判定，拿不到下面这两个 continue 的并簇救回结果，
    //   于是把【视觉上连续的条带】也标成了碎色（实测 6 张图误标 608 块，其中与最近同色块
    //   只隔 1 像素的占 559 块、条带形状占 427 块）。用户实机发现并反馈。
    //   在工具侧复刻并簇逻辑等于再造一份算法，所以改为由本函数把内部已知的结果输出出去。
    //
    // 零计算改动：明细完全来自本循环已有的 compCells[i] 与既有的两个 continue 判据，
    //   不新增任何判断、不改任何阈值比较、不影响任何汇总字段。
    var wantDetail = !!(cfg && cfg.fragmentDetail);
    var detailCells = wantDetail ? [] : null;      // 碎色像素坐标 [{r,c,color,size,iso}]
    var detailBlocks = wantDetail ? [] : null;     // 碎色块 [{color,size,iso,cells:[[r,c],...]}]
    for (i = 0; i < N; i++) perColorTot[compColor[i]] = (perColorTot[compColor[i]] || 0) + compSize[i];
    for (i = 0; i < N; i++) {
      if (compSize[i] > smallMax) continue;
      if (clusterPx[find(i)] > smallMax) continue;
      fragPx += compSize[i]; fragBlocks++;
      var isIso = compSize[i] <= isoMax;
      if (isIso) isoPx += compSize[i]; else smallPx += compSize[i];
      perColorFrag[compColor[i]] = (perColorFrag[compColor[i]] || 0) + compSize[i];
      if (wantDetail) {
        var dc = compCells[i];
        detailBlocks.push({ color: compColor[i], size: compSize[i], iso: isIso, cells: dc });
        for (var dz = 0; dz < dc.length; dz++) {
          detailCells.push({ r: dc[dz][0], c: dc[dz][1], color: compColor[i], size: compSize[i], iso: isIso });
        }
      }
      if (roundOf) {
        var cl = compCells[i], sum = 0;
        for (var z = 0; z < cl.length; z++) sum += (roundOf[cl[z][0]][cl[z][1]] || 0);
        depthW += sum;
      }
    }
    var maxColorRate = 0;
    for (var cid in perColorTot) {
      if (!perColorTot[cid]) continue;
      var rr = (perColorFrag[cid] || 0) / perColorTot[cid];
      if (rr > maxColorRate) maxColorRate = rr;
    }
    var res = {
      rate: totalPx ? fragPx / totalPx : 0,
      isoRate: totalPx ? isoPx / totalPx : 0,
      smallRate: totalPx ? smallPx / totalPx : 0,
      fragPixels: fragPx, totalPixels: totalPx, fragBlocks: fragBlocks, blocks: N,
      maxColorRate: +maxColorRate.toFixed(4),
      avgFragDepth: fragPx ? +(depthW / fragPx).toFixed(2) : 0,
      rounds: roundsTotal
    };
    // 可选明细：只在 cfg.fragmentDetail 为真时挂上，否则返回体与本参数引入前完全一致。
    //   perColorDetail 也一并给出（按颜色汇总的正式碎色量），供工具告诉美术"先修哪个颜色"。
    if (wantDetail) {
      var pcd = [];
      for (var pcid in perColorTot) {
        pcd.push({
          color: parseInt(pcid, 10),
          total: perColorTot[pcid],
          frag: perColorFrag[pcid] || 0,
          rate: perColorTot[pcid] ? +((perColorFrag[pcid] || 0) / perColorTot[pcid]).toFixed(4) : 0
        });
      }
      pcd.sort(function (a, b) { return (b.rate - a.rate) || (b.frag - a.frag); });
      res.fragCells = detailCells;         // 长度恒等于 fragPixels
      res.fragBlockList = detailBlocks;    // 长度恒等于 fragBlocks
      res.perColorDetail = pcd;            // 分色明细，按碎色率降序
    }
    return res;
  }

  /**
   * 生产前置碎色闸门：碎色率超过 config.fragmentMaxRate 即判定该源图不适合生产。
   * fragmentMaxRate <= 0 表示关闭（默认关闭，行为与本参数引入前完全一致）。
   * @returns {object} { ok, rate, limit, frag, detail }
   */
  function checkFragmentGate(blocks, config) {
    var limit = (config && config.fragmentMaxRate != null) ? config.fragmentMaxRate : 0;
    if (!(limit > 0)) return { ok: true, rate: null, limit: 0, frag: null, detail: '闸门未启用' };
    var f = computeFragmentation(blocks, config || {});
    var ok = f.rate <= limit;
    // 【v153】超标时补上"先修哪一色 + 要并入多少"（用户 2026-10-15 只看到「碎色超限」四个字，不知从何下手）。
    //   口径零改动：只是再向 computeFragmentation 多要一份块级明细（fragmentDetail:true，函数内部注释写明
    //   "明细完全来自已有结果、零计算改动"），再按色汇总。文案与修图工具那句"至少要把 N 个碎色像素
    //   并入邻近同色块"同一件事。仅在**已经判定超标**时才多算一遍，正常出关的路径不受影响。
    var hotTxt = '';
    if (!ok) {
      try {
        var fd = computeFragmentation(blocks, Object.assign({}, config || {}, { fragmentDetail: true }));
        var hot = (fd.perColorDetail || []).filter(function (d) { return d.frag > 0; })
          .sort(function (a, b) { return (b.frag - a.frag) || (b.rate - a.rate); }).slice(0, 3);
        if (hot.length) {
          var CN = (AntSolver.COLORS && AntSolver.COLORS.length) ? AntSolver.COLORS : null;
          hotTxt = '；最碎的是 ' + hot.map(function (d) {
            var nm = (CN && CN[d.color] && CN[d.color].name) ? ('(' + CN[d.color].name + ')') : '';
            return d.color + ' 号色' + nm + ' ' + d.frag + ' 像素/' + d.total;
          }).join('、')
            + '；要把碎色像素并入邻近同色块，降到上限以下（修图工具 → 碎色率检查里有逐色明细与红点高亮，' +
            '勾上就能直接看到该修哪些格）';
        }
      } catch (e) { hotTxt = ''; }
    }
    return {
      ok: ok, rate: +f.rate.toFixed(4), limit: limit, frag: f,
      detail: ok
        ? ('碎色率 ' + (f.rate * 100).toFixed(2) + '% ≤ 上限 ' + (limit * 100).toFixed(2) + '%')
        : ('碎色率 ' + (f.rate * 100).toFixed(2) + '% 超过上限 ' + (limit * 100).toFixed(2) + '%'
           + '（碎色 ' + f.fragPixels + '/' + f.totalPixels + ' 像素，碎块 ' + f.fragBlocks + '/' + f.blocks + '，最碎单色 ' + (f.maxColorRate * 100).toFixed(1) + '%）'
           + hotTxt)
    };
  }

  function checkBottomEntryFeasibility(blocks) {
    if (!blocks || !blocks.length || !blocks[0]) {
      return { ok: false, total: 0, left: 0, byColor: {}, positions: [], rows: 0, cols: 0, detail: '目标图为空' };
    }
    var Sim = AntSolver.Simulator;
    var rows = blocks.length, cols = blocks[0].length;
    var elim = AntSolver.outsideReachSeed(blocks, rows, cols, true);
    var total = 0;
    for (var r0 = 0; r0 < rows; r0++) for (var c0 = 0; c0 < cols; c0++) if (blocks[r0][c0] > 0) total++;
    var guard = rows * cols + 10;
    while (guard-- > 0) {
      var remain = {};
      for (var r1 = 0; r1 < rows; r1++) for (var c1 = 0; c1 < cols; c1++) {
        if (!elim[r1][c1] && blocks[r1][c1] > 0) remain[blocks[r1][c1]] = true;
      }
      var colors = Object.keys(remain);
      if (!colors.length) break;
      var moved = 0;
      for (var ci = 0; ci < colors.length; ci++) {
        moved += Sim.floodFillEliminate(elim, blocks, rows, cols, parseInt(colors[ci], 10), Infinity, null, null, true);
      }
      if (moved <= 0) break;      // 一轮无任何像素可消 → 剩下的都是永久不可达
    }
    var byColor = {}, positions = [], left = 0;
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
      if (!elim[r][c] && blocks[r][c] > 0) {
        left++;
        byColor[blocks[r][c]] = (byColor[blocks[r][c]] || 0) + 1;
        if (positions.length < 50) positions.push({ r: r, c: c, color: blocks[r][c] });
      }
    }
    var out = { ok: left === 0, total: total, left: left, byColor: byColor, positions: positions, rows: rows, cols: cols };
    if (left > 0) {
      out.detail = '仅底部入口下有 ' + left + '/' + total + ' 个像素永久不可达（上/左/右封闭后，只与顶/左/右背景连通的空腔打不通）；'
        + '需美术修改目标图结构。首个不可达像素 (r' + positions[0].r + ',c' + positions[0].c + ',色' + positions[0].color + ')';
    }
    return out;
  }

  /**
   * 统计每种颜色当前可达的像素数（不修改eliminated）
   */
  function countReachableByColor(eliminated, blocks, rows, cols, maxPerColor, bottomOnly) {
    var Sim = AntSolver.Simulator;
    bottomOnly = !!bottomOnly;
    var result = {};
    // 先找出所有还有剩余的颜色
    var remainingColors = {};
    for (var r = 0; r < rows; r++)
      for (var c = 0; c < cols; c++)
        if (!eliminated[r][c] && blocks[r][c] > 0) remainingColors[blocks[r][c]] = true;

    for (var colorId in remainingColors) {
      // 复制eliminated，模拟消除该色
      var scratch = [];
      for (var r = 0; r < rows; r++) scratch.push(eliminated[r].slice());
      var reach = Sim.floodFillEliminate(scratch, blocks, rows, cols, parseInt(colorId), maxPerColor, null, null, bottomOnly);
      if (reach > 0) result[colorId] = reach;
    }
    return result;
  }

  /**
   * 合并每种颜色尾部过小的盒子
   * 规则：同色相邻盒中，若某盒 < boxMin，与前一同色盒合并后均分为2盒
   */
  function mergeSmallTailBoxes(boxes, boxMin, boxMax) {
    // 按颜色分组处理（保持原序中每色的相对顺序）
    var byColor = {};
    for (var i = 0; i < boxes.length; i++) {
      var col = boxes[i].color;
      if (!byColor[col]) byColor[col] = [];
      byColor[col].push(i); // 记录索引
    }

    // 对每种颜色的盒子序列，处理尾部小盒
    for (var col in byColor) {
      var idxs = byColor[col];
      if (idxs.length < 2) continue;
      // 检查最后一个盒
      var lastIdx = idxs[idxs.length - 1];
      var prevIdx = idxs[idxs.length - 2];
      if (boxes[lastIdx].count < boxMin) {
        var merged = boxes[lastIdx].count + boxes[prevIdx].count;
        var h1 = Math.ceil(merged / 2), h2 = merged - h1;
        boxes[prevIdx].count = h1;
        boxes[lastIdx].count = h2;
      }
    }
    return boxes;
  }

  /**
   * 容量自洽分盒算法
   * 规则：
   * 1. 目标盒容量 = (boxMin + boxMax) / 2 取整
   * 2. 按目标容量均分像素数
   * 3. 如果最后一盒 < boxMin，与前一盒合并后再均分为2盒
   * 4. 确保每盒都在 [boxMin, boxMax] 范围内
   * 5. 总和严格 = pixelCount
   */
  // ==================== 【v239】需求日程：每辆车"什么时候才攒够" ====================
  //   根因（用户 2026-10-19 指出「左上角永远是那几个颜色」）：
  //     铺盘按【切序】排车，而切序来自 peel —— 只保证"这个颜色有 1 个像素在最外层"，
  //     不保证"够一辆车吃"。30 号色共 31 px、其中只有 1 px 在第 1 层，于是被切到第 4 位、
  //     又被摆到第 0 行；实测 109 / 156 / 107 三关都是 (0,3) 色30 要等到 91% 才吃得动。
  //   修法：先算一条【颜色 → 已暴露累计量】的曲线（纯目标图，与棋盘无关），
  //     把每辆车换算成"需求进度 = 该色攒够这辆容量时的全局进度"，再按它升序铺盘：
  //     早熟的放浅位、晚熟的放深位。曲线按图缓存，同图多次候选只算一次。
  var _demandCurveCache = {};
  function demandCurveOf(blocks) {
    try { return _demandCurveOf(blocks); } catch (e) { try { console.error('[demandCurveOf]', e && e.stack || e); } catch (x) {} return null; }
  }
  function _demandCurveOf(blocks) {
    var Sim = AntSolver.Simulator;
    if (!Sim || !Sim.createState || !Sim.previewNextEliminationOrder) return null;
    if (!blocks || !blocks.length || !blocks[0]) return null;
    var rows = blocks.length, cols = blocks[0].length;
    var total = 0, hash = rows * 131 + cols;
    for (var hr = 0; hr < rows; hr++) for (var hc = 0; hc < cols; hc++) {
      if (blocks[hr][hc] > 0) { total++; hash = (hash * 31 + blocks[hr][hc]) % 2147483647; }
    }
    if (!total) return null;
    var key = rows + 'x' + cols + ':' + total + ':' + hash;
    if (_demandCurveCache[key]) return _demandCurveCache[key];
    var s;
    try {
      s = Sim.createState({ blocks: blocks, rows: rows, cols: cols, totalPixels: total, totalBoxes: 0,
        bufferLimit: 5, board: { rows: 0, cols: 0, cells: [] } }, {});
    } catch (e) { return null; }
    var consumed = {}, curve = {}, startExposed = {}, done = 0, guard = 0;
    while (done < total && guard++ < 400) {
      var pv;
      try { pv = Sim.previewNextEliminationOrder(s); } catch (e) { break; }
      var prog = done / total, best = -1, bestN = 0;
      for (var k in pv.byColor) {
        var col = +k, av = (pv.byColor[col] && pv.byColor[col].reachable) || 0;
        var exp = (consumed[col] || 0) + av;
        var arr = curve[col] || (curve[col] = []);
        if (!arr.length) {
          startExposed[col] = exp;                     // 【v253】开局这一颜色露出来多少
          arr.push([exp, prog]);
        } else if (arr[arr.length - 1][0] < exp) {
          arr.push([exp, prog]);
        }
        if (av > bestN) { bestN = av; best = col; }
      }
      if (best < 0) break;
      var got = 0;
      try { got = Sim.elimDispatch(s, best, Infinity); } catch (e) { break; }
      if (!(got > 0)) break;
      consumed[best] = (consumed[best] || 0) + got; done += got;
    }
    var out = { curve: curve, total: total, startExposed: startExposed };
    _demandCurveCache[key] = out;
    return out;
  }
  /** 这辆车（颜色 color、容量 count）要等到全局进度百分之几，才攒得够。 */
  function demandAt(dc, color, count) {
    if (!dc || !dc.curve) return 0.5;
    var arr = dc.curve[color];
    if (!arr || !arr.length) return 1;
    var q = count > 0 ? count : 1;
    for (var i = 0; i < arr.length; i++) if (arr[i][0] >= q) return arr[i][1];
    return 1;
  }

  /**
   * 【v244·用户裁决】同色跨层拆两辆：一个颜色如果既有浅层像素又有深层像素，
   *   就按"浅层一块 / 深层一块"分别切车，而不是像原来那样按容量平均切。
   *   效果：深层那一块的容量必须等前几层被清掉才攒得够 → 天然的长债，不需要改车数。
   *   只在"浅层和深层都够一辆车"时才拆（sh≥boxMin 且 dp≥boxMin），否则该色原样保留。
   *   守恒：两段各自 splitIntoBoxes 的和 = 该色总像素，逐位对上才替换，否则原样退回。
   */
  /**
   * 【v266·用户裁决】按"露出块"切车（cut 层）。
   *   现状：每色按总像素均分成等容量的车 → 颜色在时间轴上均匀供给 → 任意时刻总有车能吃
   *        → 债务只能是尖峰（冲上去立刻归零），做不出"平台"。
   *   本函数：用 demandCurve 的暴露增量（chunk）做切点，让每辆车覆盖 chunkSpan 个块。
   *        块还没露出来，这辆车就吃不饱 → 它必须在暂存里等 → 平台。
   *   chunkSpan=1 ≈ 现状（每块一辆）；2 表示每辆跨两块（会等一整个块周期）。
   *   守恒：每色的车容量和强制等于该色总像素（最后一辆吸收误差）。
   */
  /**
   * 【v275·用户设计·第一步】让容量跟着"开局暴露量"走。
   *   病根（工作日志 195）：色 32 开局就露出 327px，而一辆车只有 40px → 这一色有 8 辆车"一点就满"，
   *   远超暂存 5 格，压力根本起不来。铺盘怎么排都没用，因为车本来就太小吃得太快。
   *   做法：每色的目标容量 = max(该色平均块大小, 开局暴露量 ÷ capPerColor 辆)
   *        capPerColor 默认 2 → 开局最多只能装满 2 辆，剩下的必须等后面露出的像素。
   *   守恒：每色车容量之和强制等于该色总像素。
   *   车数会变少 → 由 wantCars（棋盘格×0.9）反向调容量，保证棋盘装得下。
   */
  /**
   * 【v284·用户反馈】"还是有 96 的大容量" —— 切车层按像素游程切，天然会切出很小的和很大的车
   *   （实测 12~96）。这里做一次**同色内归一化**：大于上限的拆开、小于下限的并起来，
   *   同色总量不变（守恒），保证任何一辆车都落在 [minC, maxC] 里。
   */
  function normalizeCapacities(boxes, config) {
    if (!config || config.capNormalize === false) return boxes;
    // 【v306·用户裁决】没单独设 capNorm* 时，**直接用界面的球容量区间**当硬约束，
    //   保证最终每一辆车的容量都落在 [boxSizeMin, boxSizeMax] 里（余数盒会被并入同色车）。
    var minC = parseInt(config.capNormMin, 10) || parseInt(config.boxSizeMin, 10) || 0;
    var maxC = parseInt(config.capNormMax, 10) || parseInt(config.boxSizeMax, 10) || 0;
    if (minC <= 0 && maxC <= 0) return boxes;
    var byColor = {}, order = [];
    for (var i = 0; i < boxes.length; i++) {
      var b = boxes[i];
      if (!byColor[b.color]) { byColor[b.color] = []; order.push(b.color); }
      byColor[b.color].push(b.count);
    }
    var out = [], changed = 0;
    for (var oi = 0; oi < order.length; oi++) {
      var col = order[oi], caps = byColor[col].slice();
      var before = caps.length;
      // 1) 拆：超过上限的对半拆，直到不超过
      var split = [], guard = 0;
      for (var si = 0; si < caps.length; si++) {
        var v = caps[si];
        var stack = [v];
        while (stack.length && guard++ < 200) {
          var x = stack.pop();
          // 【v346·用户裁决】只守上限：x > maxC 就拆，不再要求 x >= 2*minC
          if (maxC > 0 && x > maxC) { stack.push(Math.floor(x / 2)); stack.push(x - Math.floor(x / 2)); }
          else split.push(x);
        }
      }
      // 2) 并：小于下限的按顺序两两合并，合到不超过上限为止
      var merged = [];
      for (var mi = 0; mi < split.length; mi++) {
        var cur = split[mi];
        if (minC > 0 && cur < minC) {
          var done = false;
          for (var mj = 0; mj < merged.length; mj++) {
            if (merged[mj] + cur <= (maxC > 0 ? maxC : 1e9)) { merged[mj] += cur; done = true; break; }
          }
          if (!done) merged.push(cur);
        } else merged.push(cur);
      }
      // 3) 守恒修正（合并/拆分不该改变总和，保险起见对齐）
      var sum0 = 0, sum1 = 0;
      for (var a1 = 0; a1 < caps.length; a1++) sum0 += caps[a1];
      for (var a2 = 0; a2 < merged.length; a2++) sum1 += merged[a2];
      if (merged.length && sum1 !== sum0) merged[merged.length - 1] += (sum0 - sum1);
      if (merged.length !== before) changed++;
      for (var q = 0; q < merged.length; q++) out.push({ color: col, count: merged[q] });
    }
    out._norm = { colors: order.length, changed: changed, minC: minC, maxC: maxC };
    return out.length ? out : boxes;
  }

  function retuneCapacities(boxes, blocks, dc, config) {
    if (!config || !config.capTie || !dc || !dc.curve) return boxes;
    var ceil = (config.capCeil != null) ? +config.capCeil : 160;
    var floorC = (config.capFloor != null) ? +config.capFloor : 12;
    var perColor = (config.capPerColor != null) ? +config.capPerColor : 2;
    if (!(perColor >= 1)) perColor = 2;
    // 每色：总像素 P、开局暴露 S、块序列
    var info = {};
    for (var ck in dc.curve) {
      var arr = dc.curve[ck], out = [], prev = 0;
      for (var i = 0; i < arr.length; i++) { var e = arr[i][0]; if (e > prev) { out.push(e - prev); prev = e; } }
      if (!out.length) continue;
      var P = out.reduce(function (a, b) { return a + b; }, 0);
      var S = (dc.startExposed && dc.startExposed[ck] != null) ? dc.startExposed[ck] : 0;
      var meanChunk = P / out.length;
      info[+ck] = { P: P, S: S, meanChunk: meanChunk, chunks: out };
    }
    var byColor = {}, order = [];
    for (var bi = 0; bi < boxes.length; bi++) {
      var b = boxes[bi];
      if (!byColor[b.color]) { byColor[b.color] = []; order.push(b.color); }
      byColor[b.color].push(b);
    }
    function buildCaps(color, scale) {
      var inf = info[color];
      var P = inf.P;
      var capBase = Math.max(inf.meanChunk, inf.S / perColor);
      var cap = Math.max(floorC, Math.min(ceil, Math.min(P, capBase * scale)));
      var n = Math.max(1, Math.round(P / cap));
      var caps = [];
      var per = Math.floor(P / n), rest = P - per * n;
      for (var q = 0; q < n; q++) caps.push(per + (q === n - 1 ? rest : 0));
      return caps;
    }
    var cells = (parseInt(config.boardRowsMax, 10) || 7) * (parseInt(config.boardColsMax, 10) || 8);
    var wantCars = Math.max(6, Math.round(cells * 0.90));
    var scale = 1.0, best = null, bestDiff = 1e9;
    for (var t = 0; t < 5; t++) {
      var rebuilt = {}, total = 0;
      for (var oi = 0; oi < order.length; oi++) {
        var col = order[oi];
        if (!info[col]) { rebuilt[col] = byColor[col].map(function (x) { return x.count; }); total += rebuilt[col].length; continue; }
        rebuilt[col] = buildCaps(col, scale);
        total += rebuilt[col].length;
      }
      var diff = Math.abs(total - wantCars);
      if (diff < bestDiff) { bestDiff = diff; best = rebuilt; }
      if (diff <= Math.max(2, wantCars * 0.08)) break;
      scale *= (total > wantCars) ? 1.18 : 0.85;     // 车太多→车变大；太少→车变小
    }
    var out2 = [];
    for (var oi2 = 0; oi2 < order.length; oi2++) {
      var col2 = order[oi2], caps2 = best[col2] || [];
      for (var q2 = 0; q2 < caps2.length; q2++) out2.push({ color: col2, count: caps2[q2] });
    }
    out2._capTie = { cars: out2.length, want: wantCars, perColor: perColor };
    return out2.length ? out2 : boxes;
  }

  function chunkAlignedCut(boxes, blocks, dc, config) {
    var span0 = parseInt(config && config.chunkCut, 10) || 0;
    if (span0 <= 0 || !dc || !dc.curve) return boxes;
    // 【v268·重构】不再用全局 [boxMin,boxMax] 夹，改成**每色各自的下限/上限**：
    //   一条颜色如果只露出过 20px 的块，那就没有理由把它的车切成 45px —— 那必然等不到。
    //   上限取 min(该色总量, 最大块×1.6, 96)，下限取 max(8, 最小块)。
    //   span = 每辆车想覆盖几个"露出块"（压力平台的台阶数）。
    var chunks = {};
    for (var ck in dc.curve) {
      var arr = dc.curve[ck], out = [], prev = 0;
      for (var i = 0; i < arr.length; i++) { var e = arr[i][0]; if (e > prev) { out.push(e - prev); prev = e; } }
      if (out.length) chunks[+ck] = out;
    }
    var byColor = {}, order = [];
    for (var bi = 0; bi < boxes.length; bi++) {
      var b = boxes[bi];
      if (!byColor[b.color]) { byColor[b.color] = []; order.push(b.color); }
      byColor[b.color].push(b);
    }
    function buildFor(color, P, ch, span) {
      var avg = P / ch.length;
      var mn = Math.max(8, Math.min.apply(null, ch));
      var mx = Math.min(P, Math.max.apply(null, ch) * 1.6, 96);
      if (mx < mn) mx = mn;
      var target = Math.round(avg * span);
      if (target < mn) target = Math.round(mn);
      if (target > mx) target = Math.round(mx);
      if (target < 1) target = 1;
      var cars = [], acc = 0;
      for (var ci = 0; ci < ch.length; ci++) {
        acc += ch[ci];
        while (acc >= target) { cars.push(target); acc -= target; }
      }
      if (acc > 0) {
        if (cars.length && acc < mn) cars[cars.length - 1] += acc;
        else cars.push(Math.round(acc));
      }
      if (!cars.length) cars = [P];
      var sum = 0; for (var si = 0; si < cars.length; si++) sum += cars[si];
      if (sum !== P) cars[cars.length - 1] += (P - sum);
      return cars;
    }
    // 目标车数 ≈ 棋盘可放格 × 0.9；span 从设定值开始，车太少就降 span、车太多就升 span
    var cells = (parseInt(config.boardRowsMax, 10) || 7) * (parseInt(config.boardColsMax, 10) || 8);
    var wantCars = Math.max(8, Math.round(cells * 0.90));
    var span = span0, best = null, bestCars = -1;
    for (var tries = 0; tries < 4; tries++) {
      var rebuiltTry = {};
      var totalCars = 0;
      for (var oi = 0; oi < order.length; oi++) {
        var col = order[oi], arr2 = byColor[col];
        var P = 0; for (var ai = 0; ai < arr2.length; ai++) P += arr2[ai].count;
        var ch = chunks[col];
        rebuiltTry[col] = (ch && ch.length >= 2) ? buildFor(col, P, ch, span) : arr2.map(function (x) { return x.count; });
        totalCars += rebuiltTry[col].length;
      }
      if (best === null || Math.abs(totalCars - wantCars) < Math.abs(bestCars - wantCars)) {
        best = rebuiltTry; bestCars = totalCars;
      }
      if (Math.abs(totalCars - wantCars) <= Math.max(2, wantCars * 0.08)) break;
      span = (totalCars > wantCars) ? (span + 1) : Math.max(1, span - 1);
      if (span > 6) break;
    }
    var out = [];
    for (var oi2 = 0; oi2 < order.length; oi2++) {
      var col2 = order[oi2], caps = best[col2] || [];
      for (var q = 0; q < caps.length; q++) out.push({ color: col2, count: caps[q] });
    }
    out._chunkCut = { span: span, cars: out.length, want: wantCars };
    return out.length ? out : boxes;
  }


  function splitBoxesByLayer(blocks, config, boxes) {
    if (!boxes || !boxes.length) return boxes;
    var R = blocks.length, C = blocks[0].length;
    var eo = null;
    try { eo = AntSolver.eliminationOrder(blocks, R, C, !!config.bottomOnly); } catch (e) { return boxes; }
    if (!eo || !eo.round) return boxes;
    var stat = {}, shCap = (config.layerSplitShallow != null) ? Math.max(1, parseInt(config.layerSplitShallow, 10) || 2) : 2;
    for (var r = 0; r < R; r++) for (var c = 0; c < C; c++) {
      var col = blocks[r][c];
      if (col <= 0) continue;
      var L = eo.round[r][c] || 1;
      var st = stat[col] || (stat[col] = { sh: 0, dp: 0 });
      if (L <= shCap) st.sh++; else st.dp++;
    }
    var bmin = parseInt(config.boxSizeMin, 10) || 24;
    var bmax = parseInt(config.boxSizeMax, 10) || 36;
    if (bmax < bmin) bmax = bmin;
    var byColor = {}, order = [];
    for (var i = 0; i < boxes.length; i++) {
      var b = boxes[i];
      if (!byColor[b.color]) { byColor[b.color] = []; order.push(b.color); }
      byColor[b.color].push(b);
    }
    // 【v245·限流】只拆"深层占比最高"的前 N 个颜色（默认 2）：全拆会把 +4~5 盒一次塞进来，
    //   实测直接顶到峰窗 5。限流后预期只 +1~2 盒，步长才对得上 3.2~4 的窄带。
    var maxSplit = (config.layerSplitMax != null) ? Math.max(1, parseInt(config.layerSplitMax, 10) || 2) : 2;
    var eligible = [];
    for (var ei = 0; ei < order.length; ei++) {
      var ecol = order[ei], es = stat[ecol];
      if (!es || es.sh < bmin || es.dp < bmin) continue;
      eligible.push({ color: ecol, ratio: es.dp / (es.sh + es.dp) });
    }
    eligible.sort(function (a, b) { return b.ratio - a.ratio; });
    var allowSplit = {};
    for (var el = 0; el < eligible.length && el < maxSplit; el++) allowSplit[eligible[el].color] = 1;
    var out = [], splitColors = 0, addedBoxes = 0;
    for (var ci = 0; ci < order.length; ci++) {
      var color = order[ci], arr = byColor[color];
      var P = 0; for (var ai = 0; ai < arr.length; ai++) P += arr[ai].count;
      var s = stat[color];
      if (!s || s.sh < bmin || s.dp < bmin || !allowSplit[color]) { for (var ai2 = 0; ai2 < arr.length; ai2++) out.push(arr[ai2]); continue; }
      var parts = splitIntoBoxes(s.sh, bmin, bmax).concat(splitIntoBoxes(s.dp, bmin, bmax));
      var sum = 0; for (var pi = 0; pi < parts.length; pi++) sum += parts[pi];
      if (sum !== P) { for (var ai3 = 0; ai3 < arr.length; ai3++) out.push(arr[ai3]); continue; }
      splitColors++; addedBoxes += (parts.length - arr.length);
      for (var pj = 0; pj < parts.length; pj++) out.push({ color: color, count: parts[pj] });
    }
    out._layerSplit = { colors: splitColors, added: addedBoxes };
    return out.length ? out : boxes;
  }

  function splitIntoBoxes(pixelCount, boxMin, boxMax) {
    if (pixelCount <= 0) return [];
    if (pixelCount <= boxMax) return [pixelCount]; // 一盒搞定

    var target = Math.round((boxMin + boxMax) / 2);
    var numBoxes = Math.round(pixelCount / target);
    if (numBoxes < 1) numBoxes = 1;

    // 均分
    var base = Math.floor(pixelCount / numBoxes);
    var remainder = pixelCount - base * numBoxes;
    var boxes = [];
    for (var i = 0; i < numBoxes; i++) {
      boxes.push(base + (i < remainder ? 1 : 0));
    }

    // 检查最后一盒是否太小
    if (boxes.length >= 2) {
      var last = boxes[boxes.length - 1];
      if (last < boxMin) {
        // 与前一盒合并后均分为2盒
        var merged = last + boxes[boxes.length - 2];
        boxes.pop();
        boxes.pop();
        var half1 = Math.ceil(merged / 2);
        var half2 = merged - half1;
        boxes.push(half1);
        boxes.push(half2);
      }
    }

    // 最终校验：如果有盒超出范围，尝试重新均分
    var outOfRange = boxes.some(function(b) { return b < boxMin || b > boxMax; });
    if (outOfRange && pixelCount > boxMax) {
      // 强制重新计算盒数
      numBoxes = Math.ceil(pixelCount / boxMax);
      base = Math.floor(pixelCount / numBoxes);
      remainder = pixelCount - base * numBoxes;
      boxes = [];
      for (var i = 0; i < numBoxes; i++) {
        boxes.push(base + (i < remainder ? 1 : 0));
      }
    }

    // 验证自洽
    var sum = boxes.reduce(function(s,b){return s+b;}, 0);
    if (sum !== pixelCount) {
      // 修正最后一盒
      boxes[boxes.length-1] += (pixelCount - sum);
    }

    // 【v235】关键修复：填盘会按 `_seq` 重排，必须把 `_seq` 同步成当前数组顺序，
    //   否则前面所有的"重排/埋深/配额"都会被冲掉（这就是顺序一直不起作用的原因）。
    try { boxes.forEach(function (b, i) { b._seq = i; }); } catch (e) { }
    return boxes;
  }

  // ==================== 棋盘障碍放置 ====================
  // 全部障碍作用在棋盘 cells 上（不在目标图）。
  //  - 数字冰：给盒子加冰(cell.numice=N)，按取走的盒数倒计时，减到 0 破碎。
  //  - chain：相邻两盒配对(cell.chain=组号)，两端都暴露才可取。
  //  - question：盒子隐藏色(cell.q=true)，软障碍。
  //  - black：占据空格永久阻挡（保证所有盒仍顶部可达）。

  /** 判断所有盒子是否仍从顶部可达（black/pipe 阻挡，盒子视为可通过=最终会被取走）。 */
  function isAllBoxesReachable(cells, rows, cols) {
    var vis = AntSolver.create2D(rows, cols, false);
    var q = [];
    function passable(cell) { return !(cell && (cell.t === 'black' || cell.t === 'pipe')); }
    for (var c = 0; c < cols; c++) if (passable(cells[0][c])) { vis[0][c] = true; q.push([0, c]); }
    var dirs = [[-1,0],[1,0],[0,-1],[0,1]];
    for (var h = 0; h < q.length; h++) {
      var r = q[h][0], cc = q[h][1];
      for (var d = 0; d < dirs.length; d++) {
        var nr = r + dirs[d][0], nc = cc + dirs[d][1];
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols || vis[nr][nc]) continue;
        if (passable(cells[nr][nc])) { vis[nr][nc] = true; q.push([nr, nc]); }
      }
    }
    for (var r2 = 0; r2 < rows; r2++) for (var c2 = 0; c2 < cols; c2++) {
      if (cells[r2][c2] && cells[r2][c2].t && cells[r2][c2].t === 'box' && !vis[r2][c2]) return false;
    }
    return true;
  }

  /**
   * 锁链可激活性检验（防结构性卡死）：锁链需【全部成员同时激活】才能连体取。
   * 由于激活单调，最大激活态 = 移除所有【非本组】盒。若此时仍有成员未暴露(顶部经空格不可达其邻)，
   * 则该组【永远无法全部激活】→ 结构性死锁。
   *  - 把非本组 box 视作已移除(空)，黑/管道为墙，本组成员为障碍；从第0行经空格 BFS。
   *  - 成员暴露 = 位于第0行 或 邻接可达空格。
   * @returns {boolean} 全部成员可激活=true
   */
  function chainActivatable(cells, rows, cols, members) {
    var mset = {};
    for (var i = 0; i < members.length; i++) mset[members[i].r + ',' + members[i].c] = true;
    function isEmptyLike(r, c) {
      var ce = cells[r][c];
      if (!ce) return true;                                   // 空格
      if (ce.t === 'black' || ce.t === 'pipe') return false;  // 墙
      if (ce.t === 'box') return !mset[r + ',' + c];          // 非本组盒=视作已移除；本组盒=障碍
      return true;
    }
    var R = AntSolver.create2D(rows, cols, false), q = [];
    for (var c0 = 0; c0 < cols; c0++) if (isEmptyLike(0, c0)) { R[0][c0] = true; q.push([0, c0]); }
    var dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (var h = 0; h < q.length; h++) {
      var r = q[h][0], cc = q[h][1];
      for (var d = 0; d < 4; d++) {
        var nr = r + dirs[d][0], nc = cc + dirs[d][1];
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols || R[nr][nc]) continue;
        if (isEmptyLike(nr, nc)) { R[nr][nc] = true; q.push([nr, nc]); }
      }
    }
    for (var m = 0; m < members.length; m++) {
      var mr = members[m].r, mc = members[m].c;
      if (mr === 0) continue;                                 // 第0行默认可激活
      var exposed = false;
      for (var dd = 0; dd < 4; dd++) {
        var er = mr + dirs[dd][0], ec = mc + dirs[dd][1];
        if (er < 0 || er >= rows || ec < 0 || ec >= cols) continue;
        if (R[er][ec]) { exposed = true; break; }
      }
      if (!exposed) return false;                             // 该成员永不暴露 → 整组不可激活
    }
    return true;
  }

  /**
   * 结构性卡死 + 合法性检验（合法性门，不做求解）：production 必须逐关调用。
   *  ① 所有盒从顶部可达；② 每个锁链组全部成员可激活(chainActivatable)；
   *  ③ 管道出口合法：任意两管道不得【共用同一出口格】、出口不得越界(防管道共用出口的 bug)。
   * @returns {{ok:boolean, reason:string}}
   */
  function structuralDeadlockCheck(board) {
    var cells = board.cells, rows = board.rows, cols = board.cols;
    if (!isAllBoxesReachable(cells, rows, cols)) return { ok: false, reason: '有盒从顶部不可达' };
    var groups = {};
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
      var ce = cells[r][c];
      if (ce && ce.t === 'box' && ce.chain > 0) (groups[ce.chain] = groups[ce.chain] || []).push({ r: r, c: c });
    }
    for (var g in groups) {
      if (groups[g].length >= 2 && !chainActivatable(cells, rows, cols, groups[g]))
        return { ok: false, reason: '锁链组' + g + '无法全部激活(结构性卡死)' };
    }
    // ③ 管道出口合法性检查
    var exitOwner = {};
    for (var pr = 0; pr < rows; pr++) for (var pc = 0; pc < cols; pc++) {
      var pcell = cells[pr][pc];
      if (!pcell || pcell.t !== 'pipe') continue;
      var dv = AntSolver.PIPE_DIRS[pcell.dir] || [1, 0];
      var er = pr + dv[0], ec = pc + dv[1];
      if (er < 0 || er >= rows || ec < 0 || ec >= cols) return { ok: false, reason: '管道(' + pr + ',' + pc + ')出口越界' };
      var ek = er + ',' + ec;
      if (exitOwner[ek]) return { ok: false, reason: '管道共用同一出口(' + ek + ')：' + exitOwner[ek] + ' 与 ' + pr + ',' + pc };
      exitOwner[ek] = pr + ',' + pc;
    }
    return { ok: true, reason: '' };
  }

  function placeBoardObstacles(cells, rows, cols, config) {
    var diffLevel = config.diffLevel || 2;
    var backRow = Math.floor(rows * 0.4);

    function boxCells(filterBack) {
      var arr = [];
      for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
        if (cells[r][c] && cells[r][c].t === 'box') {
          if (filterBack && r < backRow) continue;
          arr.push({ r: r, c: c });
        }
      }
      return arr;
    }
    function boxTotal() { return boxCells(false).length; }

    // 数字冰（【v139】老冰下线：数值由 numIceValueFor 按该盒自然进度位次 + 延后量现算）——【全棋盘可出现】
    if (config.icePercent > 0) {
      var iceCount = Math.floor(boxTotal() * config.icePercent / 100);
      var icePool = boxCells(false); // 全棋盘
      var iceSel = pickDispersed(icePool, iceCount, 2);
      for (var i = 0; i < iceSel.length; i++) {
        cells[iceSel[i].r][iceSel[i].c].numice = numIceValueFor(cells, rows, cols, iceSel[i].r, iceSel[i].c, config);
      }
    }

    // 锁链：每组2或3连，成员横/竖正交相邻(不可斜向)；三连可 L/反L；可与数字冰叠加。
    // 【两批放置·均在建棋盘期】首批 chainInitialRatio(默认50%) 全盘随机；剩余一半也在此填入，但【限制在棋盘 50% 行数以后】(下半区)——
    //   把"锁链卡点"预置到后期区域(顺序依赖抬压)，而非留到 P2 补链。
    var dirs8 = [[-1, 0], [1, 0], [0, -1], [0, 1]];

    // ===== 锁链档位组合（任务 ANT-DIFFICULTY-SYSTEM-V2-20260901，用户 2026-09-02 授权）=====
    // 用户原话：「关于锁链的全部档位直接给生成器赋予全部档位的生产选择组合。
    //            生成器根据实际关卡参数来随机选择这些组合。」
    //
    // 【为什么必须加参数】原实现里每组是 2 连还是 3 连由**写死的抛硬币**决定
    //   （`var size = (rnd() < 0.5) ? 3 : 2;`），`chainCount` 只控制组数。
    //   于是「2连/3连 的拆分」不可控 —— 评分体系 2.0 的锁链 18 档表恰好依赖这个拆分，
    //   实测组数钉死后档位仍漂 1.7 档，导致档位无法作为受控实验的自变量。
    //
    // 【三个入口，优先级从高到低】
    //   ① chainTierPool 非空 → 每关从池中**随机抽一档**（这就是用户要的「赋予全部档位的生产选择组合」）。
    //      格式：[[g2,g3], ...]，如 [[1,0],[0,1],[2,0],[1,1],[0,2]]；也接受 [{g2:1,g3:0}, ...]。
    //   ② chain2Count 与 chain3Count 同时给 → 用这组显式值（单档定值，受控实验用）。
    //   ③ 都不给 → **逐值回到原抛硬币行为**，旧方案与已产出批次逐字节可复现。
    // 缺省 null/null/null，即默认走 ③，正式生产行为不变。
    var chainWant = (function () {
      var pool = config.chainTierPool;
      if (pool && pool.length) {
        var pick = pool[Math.floor(rnd() * pool.length)];
        var a = (pick && pick.g2 != null) ? pick.g2 : (pick ? pick[0] : 0);
        var b = (pick && pick.g3 != null) ? pick.g3 : (pick ? pick[1] : 0);
        return { g2: Math.max(0, a | 0), g3: Math.max(0, b | 0), src: 'tierPool' };
      }
      if (config.chain2Count != null && config.chain3Count != null) {
        return { g2: Math.max(0, config.chain2Count | 0), g3: Math.max(0, config.chain3Count | 0), src: 'explicit' };
      }
      return null;   // 原行为
    })();
    // 待放置的连长队列。只在**放置成功**时消耗，失败不消耗 —— 否则一次落位失败就会永久丢掉一组，
    // 导致实际档位低于设定（这正是要避免的不可控）。
    var chainSizeQueue = null;
    if (chainWant) {
      chainSizeQueue = [];
      for (var q3 = 0; q3 < chainWant.g3; q3++) chainSizeQueue.push(3);
      for (var q2 = 0; q2 < chainWant.g2; q2++) chainSizeQueue.push(2);
      chainSizeQueue = shuffle(chainSizeQueue);   // 打散，避免 3 连全挤在首批
    }
    // 观测：把设定值挂到 config 上（同一 config 对象会随候选传到落库侧），便于事后核对设定 vs 实际
    if (chainWant) config._chainTierWant = { g2: chainWant.g2, g3: chainWant.g3, src: chainWant.src };

    function placeChainBatch(count, minRow, startGroup, chained) {
      var placed = 0, group = startGroup;
      var pool = boxCells(false).filter(function (p) { return p.r >= minRow; });
      var cand = pickDispersed(pool, count * 4 + 6, 2);
      for (var ci = 0; ci < cand.length && placed < count; ci++) {
        var sr = cand[ci].r, sc = cand[ci].c;
        if (chained[sr + ',' + sc] || cells[sr][sc].chain > 0) continue;
        // 队列模式：peek 不 shift；成功落位后才消耗（见下方 placed++ 处）
        var size = chainSizeQueue ? chainSizeQueue[0] : ((rnd() < 0.5) ? 3 : 2);
        if (chainSizeQueue && size == null) break;   // 队列空 → 本批不再放
        var members = [{ r: sr, c: sc }];
        var guard = 0;
        while (members.length < size && guard++ < 30) {
          var grew = false;
          for (var mi = 0; mi < members.length && !grew; mi++) {
            var order = shuffle(dirs8.slice());
            for (var d = 0; d < order.length; d++) {
              var nr = members[mi].r + order[d][0], nc = members[mi].c + order[d][1];
              if (nr < minRow || nr >= rows || nc < 0 || nc >= cols) continue;   // 次批限制在 ≥minRow(下半区)
              if (!cells[nr][nc] || cells[nr][nc].t !== 'box') continue;
              if (chained[nr + ',' + nc] || cells[nr][nc].chain > 0) continue;
              var dup = false;
              for (var mm = 0; mm < members.length; mm++) if (members[mm].r === nr && members[mm].c === nc) { dup = true; break; }
              if (dup) continue;
              members.push({ r: nr, c: nc }); grew = true; break;
            }
          }
          if (!grew) break;
        }
        // 队列模式下必须**长度精确匹配**才算成功：members 可能只长到 2 而队列要的是 3，
        // 那不能算这一组放成了（否则 3 连会静默退化成 2 连，档位又不可控了）。
        var sizeOK = chainSizeQueue ? (members.length === size) : (members.length >= 2);
        if (sizeOK && !chainGroupConflict(cells, rows, cols, members, group) && chainActivatable(cells, rows, cols, members)) {
          for (var mk = 0; mk < members.length; mk++) { cells[members[mk].r][members[mk].c].chain = group; chained[members[mk].r + ',' + members[mk].c] = true; }
          group++; placed++;
          if (chainSizeQueue) chainSizeQueue.shift();   // 只在成功时消耗
        }
      }
      return group;
    }
    // 队列模式下总组数由档位决定（g2+g3），不再读 chainCount —— 否则两者冲突时行为不明确。
    var totalChains = chainWant ? (chainWant.g2 + chainWant.g3) : Math.max(0, config.chainCount || 0);
    if (totalChains > 0) {
      var ratio = (typeof config.chainInitialRatio === 'number') ? config.chainInitialRatio : 0.5;
      var n1 = Math.round(totalChains * ratio);       // 首批：全盘
      var n2 = totalChains - n1;                       // 次批：棋盘 50% 行以后
      var chainedMap = {}, grp = 1;
      grp = placeChainBatch(n1, 0, grp, chainedMap);
      grp = placeChainBatch(n2, Math.floor(rows * 0.5), grp, chainedMap);
      // 队列还有剩 → 前两批位置不够（分散度约束 + 可激活性约束）。再补一轮**全盘**，
      // 否则实际档位会低于设定，受控实验就失真。补轮仍走同样的合法性校验，不降低标准。
      if (chainSizeQueue && chainSizeQueue.length) {
        grp = placeChainBatch(chainSizeQueue.length, 0, grp, chainedMap);
      }
      if (chainWant) {
        // 如实记录「设定 vs 实际」。放不满时**不静默**，由调用方与报告侧看得见。
        var actual2 = 0, actual3 = 0, seen = {};
        for (var ar = 0; ar < rows; ar++) for (var ac = 0; ac < cols; ac++) {
          var acell = cells[ar][ac];
          if (acell && acell.t === 'box' && acell.chain > 0) seen[acell.chain] = (seen[acell.chain] || 0) + 1;
        }
        for (var sk in seen) { if (seen[sk] === 2) actual2++; else if (seen[sk] === 3) actual3++; }
        config._chainTierActual = { g2: actual2, g3: actual3, shortfall: chainSizeQueue.length };
      }
    }

    // 问号（软障碍，偶数，分散）——【不在第0行】，其余全棋盘可出现；【可与数字冰叠加】；不与锁链叠加保持清晰
    if (config.questionPercent > 0) {
      var qCount = Math.floor(boxTotal() * config.questionPercent / 100);
      if (qCount % 2 === 1) qCount--;
      if (qCount >= 2) {
        var qpool = boxCells(false).filter(function(p) {
          return p.r !== 0 && cells[p.r][p.c].chain === 0; // 问号不在第0行；可与冰叠加；仅不与锁链叠加
        });
        var qSel = pickDispersed(qpool, qCount, 2);
        if (qSel.length % 2 === 1) qSel.pop(); // 保持偶数
        for (var qi = 0; qi < qSel.length; qi++) cells[qSel[qi].r][qSel[qi].c].q = true;
      }
    }

    // 黑块已在 buildBoard 中分散预留放置（此处不再处理）
  }

  /**
   * 顶部行障碍约束（生产后处理，仅做减法 → 只会更易，不破坏可解性/可达性）：
   *  ① 前2行(索引0/1)障碍密度 ≤ topObstacleMaxPercent(默认50%)；密度 = 障碍格 / 实际占用格(非空)。
   *  ② 前2行最多 1 对锁链：含前2行成员的锁链组多于1个时，只保留1组，其余整组清标。
   *  障碍 = 黑块 / 管道 / 带冰或锁链或问号的盒。移除优先级：问号 → 冰 → 锁链整组 → 黑块转空。
   *  管道不移除(承载溢出队列，移除会丢盒)。
   */
  function enforceTopObstacleCap(cells, rows, cols, config) {
    var pct = (typeof config.topObstacleMaxPercent === 'number') ? config.topObstacleMaxPercent : 50;
    var topRows = Math.min(2, rows);   // 前2行
    if (topRows <= 0 || cols <= 0) return;

    function isObs(cell) {
      return cell && (cell.t === 'black' || cell.t === 'pipe' ||
        (cell.t === 'box' && ((cell.numice > 0) || (cell.chain > 0) || cell.q)));
    }
    function countTop() {
      var n = 0;
      for (var r = 0; r < topRows; r++) for (var c = 0; c < cols; c++) if (isObs(cells[r][c])) n++;
      return n;
    }
    function countOccupied() { // 实际占用格数(非空/非null) = 密度分母
      var n = 0;
      for (var r = 0; r < topRows; r++) for (var c = 0; c < cols; c++) if (cells[r][c] != null) n++;
      return n;
    }
    function overCap() { // 障碍占实际占用格比 > pct% ?  (整数比较：obs×100 > pct×occ)
      var occ = countOccupied();
      if (occ <= 0) return false;
      return countTop() * 100 > pct * occ;
    }
    function clearChainGroup(g) { // 清掉整组锁链标记（可能含非顶部成员），组员变普通盒
      for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
        var x = cells[r][c];
        if (x && x.t === 'box' && x.chain === g) x.chain = 0;
      }
    }

    // ② 前2行最多 `topChainMaxGroups` 个锁链组：超出的整组清标。
    // 【任务 ANT-DIFFICULTY-SYSTEM-V2-20260901，用户 2026-09-02「关于首行豁免。可以打开，不用完全限制前两行」】
    //   原实现硬编码「最多 1 组」。实测这是锁链档位不可控的**主因之一**：
    //   规划期与绑定期都精确到设定组数（3/3/3、失败 0），到这里被摘掉后最终只剩 2.29 组均值，
    //   7 关里 4 关掉组 —— 而摘掉几组取决于落位随机性，故档位无法作为受控实验的自变量。
    //   现改为参数化：
    //     topChainMaxGroups = null（缺省）→ 逐值回到原「最多 1 组」行为，正式生产不变
    //     topChainMaxGroups = 数字        → 前2行最多留这么多组
    //     topChainExempt   = true        → **完全豁免**，前2行锁链一组不摘（实验用）
    //   注意豁免只影响②这条「组数上限」；①的密度封顶仍然生效，只是锁链不再是它的第一顺位牺牲品
    //   （见下方 chainRemovable 门控）。
    var chainExempt = !!config.topChainExempt;
    if (!chainExempt) {
      var topMaxG = (config.topChainMaxGroups != null) ? Math.max(0, config.topChainMaxGroups | 0) : 1;
      var topGroups = [];
      for (var gr = 0; gr < topRows; gr++) for (var gc = 0; gc < cols; gc++) {
        var gcell = cells[gr][gc];
        if (gcell && gcell.t === 'box' && gcell.chain > 0 && topGroups.indexOf(gcell.chain) < 0) topGroups.push(gcell.chain);
      }
      for (var tg = topMaxG; tg < topGroups.length; tg++) clearChainGroup(topGroups[tg]);
    }

    // ① 前2行障碍密度 ≤ pct%
    var guard = 0;
    while (overCap() && guard++ < 800) {
      var acted = false;
      // 1) 问号
      for (var r1 = 0; r1 < topRows && !acted; r1++) for (var c1 = 0; c1 < cols && !acted; c1++) {
        var a = cells[r1][c1];
        if (a && a.t === 'box' && a.q) { a.q = false; acted = true; }
      }
      if (acted) continue;
      // 2) 冰
      for (var r2 = 0; r2 < topRows && !acted; r2++) for (var c2 = 0; c2 < cols && !acted; c2++) {
        var b = cells[r2][c2];
        if (b && b.t === 'box' && b.numice > 0) { b.numice = 0; acted = true; }
      }
      if (acted) continue;
      // 3) 锁链整组 —— 豁免开启时跳过（否则密度封顶会绕过②继续摘锁链，档位照样漂）
      if (!chainExempt) {
        for (var r3 = 0; r3 < topRows && !acted; r3++) for (var c3 = 0; c3 < cols && !acted; c3++) {
          var d = cells[r3][c3];
          if (d && d.t === 'box' && d.chain > 0) { clearChainGroup(d.chain); acted = true; }
        }
      }
      if (acted) continue;
      // 4) 黑块 → 空格（last resort）
      for (var r4 = 0; r4 < topRows && !acted; r4++) for (var c4 = 0; c4 < cols && !acted; c4++) {
        if (cells[r4][c4] && cells[r4][c4].t === 'black') { cells[r4][c4] = null; acted = true; }
      }
      if (!acted) break; // 顶部只剩管道等不可移除项（正常棋盘管道偏后不会出现在1-3行）
    }
  }

  /**
   * 分散选取（最远点采样 FPS）：随机起点，之后每次选"离已选点最远"的候选，
   * 使障碍最大化分散、避免连续聚集。（minDist 仅作历史签名保留，未使用。）
   */
  var DISPERSED_MAXMIN = false;   // 【v174】false = 新的"随机 + 最小距离"（默认）；true = 旧的"最大化最小距离"（回退用）
  function pickDispersed(cands, count, minDist) {
    if (count <= 0 || !cands.length) return [];
    var pool = cands.slice();
    shuffle(pool); // 随机化：起点与并列打破都随机
    count = Math.min(count, pool.length);
    function cheby(a, b) { return Math.max(Math.abs(a.r - b.r), Math.abs(a.c - b.c)); }
    // 【v174】默认改成"随机顺序 + 最小距离约束"。
    //   为什么：原实现是**最大化最小距离**（每次挑"离已选点最远"的点），而**离中心最远的地方永远是边角** →
    //   于是冰/问号/黑块/锁链**系统性地被推到棋盘角落**。用户 2026-10-16 的观察正是这个：
    //   「同一张目标图反复点生成关卡，总是在左上角田字方格、两个锁链各锁两个」。
    //   新做法保持"彼此至少隔 minDist"（分散语义不变），但不再系统性地挑极端位置；距离不够时逐级放宽重试。
    if (!DISPERSED_MAXMIN) {
      var picked2 = [], used2 = {};
      for (var d = minDist; d >= 0 && picked2.length < count; d--) {
        for (var i2 = 0; i2 < pool.length && picked2.length < count; i2++) {
          var k2 = pool[i2].r + ',' + pool[i2].c;
          if (used2[k2]) continue;
          var ok2 = true;
          for (var j2 = 0; j2 < picked2.length; j2++) if (cheby(pool[i2], picked2[j2]) < d) { ok2 = false; break; }
          if (!ok2) continue;
          picked2.push(pool[i2]); used2[k2] = 1;
        }
      }
      return picked2;
    }

    var picked = [pool[0]];
    var used = {}; used[pool[0].r + ',' + pool[0].c] = true;
    // 每个候选到"最近已选点"的距离，增量维护
    var mind = new Array(pool.length);
    for (var i = 0; i < pool.length; i++) mind[i] = cheby(pool[i], picked[0]);

    while (picked.length < count) {
      var best = -1, bestD = -1;
      for (var j = 0; j < pool.length; j++) {
        if (used[pool[j].r + ',' + pool[j].c]) continue;
        if (mind[j] > bestD) { bestD = mind[j]; best = j; }
      }
      if (best < 0) break;
      var chosen = pool[best];
      picked.push(chosen);
      used[chosen.r + ',' + chosen.c] = true;
      for (var k = 0; k < pool.length; k++) {
        var d = cheby(pool[k], chosen);
        if (d < mind[k]) mind[k] = d;
      }
    }
    return picked;
  }

  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // ==================== 难度评分 ====================

  /**
   * 难度评分（参考StackSort难度体系）
   * 
   * 总分 = 暂存压力×0.35 + 消除深度×0.25 + 洗牌偏移×0.20 + 规模×0.20
   * 范围 0~100
   */
  function computeDifficulty(solveResult, level, config, generationEval) {
    // 难度评分 v2 权重不变；如生成诊断已跑严格玩家版则直接复用，避免重复模拟。
    if (AntSolver.Analysis) {
      var playerStats = null;
      if (generationEval && generationEval.player) {
        // v4：f1 用【操作 tick 轴】均值 avgBufferTick，f2 用玩家平均滞留 avgResidence。
        // 兼容：老结果若没有 avgBufferTick（例如历史落库数据），退回完成事件轴的 avgBuffer 以免整关无分，
        //       并在 statsAxis 上如实标出用的是哪条轴，避免把两种口径混着比。
        var gpv = generationEval.player;
        var hasTickAxis = (gpv.avgBufferTick != null);
        playerStats = {
          won: !!gpv.won,
          avgBuffer: hasTickAxis ? (gpv.avgBufferTick || 0) : (gpv.avgBuffer || 0),
          statsAxis: hasTickAxis ? 'operationTick' : 'completionEvent(legacy)',
          peak: gpv.peak || 0,
          revives: gpv.revives || 0,
          avgResidence: gpv.avgResidence || 0,
          effectiveTicks: gpv.effectiveTicks || 0,
          residenceCount: gpv.residenceCount || 0,
          preview: gpv.preview || null
        };
      } else {
        try {
          if (AntSolver.PlayerSim) {
            // 难度分析的玩家兜底模拟同样按本关入口模式与消除口径跑（各模式的难度分必须来自该玩法的真实压力）。
            var pl = AntSolver.PlayerSim.run(level, { seed: 7, bottomOnly: !!(config && config.bottomOnly), instantChain: !!(config && config.instantChain) });
            // v4：直接用 PlayerSim 的统一口径输出，不再就地按 pressureSamples 手算
            // （那是完成事件轴，与需求 §3 要求的操作 tick 轴不同）。
            playerStats = {
              won: pl.won, avgBuffer: pl.playerAvgBuffer || 0, statsAxis: 'operationTick',
              peak: pl.bufferPeak || 0, revives: pl.revivesUsed || 0,
              avgResidence: pl.avgResidence || 0,
              effectiveTicks: pl.effectiveTicks || 0,
              residenceCount: pl.residenceCount || 0
            };
          }
        } catch (e) { playerStats = null; }
      }
      var diff = AntSolver.Analysis.difficulty(level, solveResult, playerStats);
      diff.playerStats = playerStats;
      if (generationEval) diff.generationScore = generationEval.score;
      return diff;
    }
    // 兜底（Analysis 未加载）：简化暂存压力评分
    var bufferPressure = solveResult.maxBuffer > 0
      ? Math.min(100, (solveResult.maxBuffer / (config.bufferLimit || 5)) * 100) : 0;
    var score = Math.round(bufferPressure * 0.6);
    var grade = score <= 30 ? '简单' : (score <= 60 ? '普通' : (score <= 80 ? '困难' : '极难'));
    return { score: score, grade: grade, parts: { buffer: Math.round(bufferPressure) }, bufferHistory: solveResult.stepBufferHistory || [] };
  }

  // ==================== 目标图生成（无TXT时） ====================

  function generateTargetMap(size, colorCount, pattern) {
    var colors = getColorPalette(colorCount);
    switch (pattern) {
      case 'rings': return generateRings(size, colors);
      case 'stripes': return generateStripes(size, colors);
      case 'blob': return generateBlob(size, colors);
      default: return generateRandom(size, colors);
    }
  }

  function generateRings(size, colors) {
    var blocks = AntSolver.create2D(size, size, 0);
    var cx = size/2, cy = size/2, maxD = size/2 - 1;
    for (var r = 0; r < size; r++) for (var c = 0; c < size; c++) {
      var d = Math.max(Math.abs(r-cy), Math.abs(c-cx));
      if (d <= maxD) blocks[r][c] = colors[Math.min(Math.floor(d*colors.length/(maxD+1)), colors.length-1)];
    }
    return blocks;
  }

  function generateStripes(size, colors) {
    var blocks = AntSolver.create2D(size, size, 0);
    var w = Math.max(2, Math.floor(size / colors.length));
    for (var r = 0; r < size; r++) for (var c = 0; c < size; c++) {
      blocks[r][c] = colors[Math.floor(r / w) % colors.length];
    }
    return blocks;
  }

  function generateBlob(size, colors) {
    var blocks = AntSolver.create2D(size, size, 0);
    var assigned = AntSolver.create2D(size, size, false);
    var total = size * size, perColor = Math.floor(total / colors.length);
    var dirs = [[-1,0],[1,0],[0,-1],[0,1]];
    for (var ci = 0; ci < colors.length; ci++) {
      var sr, sc, att = 0;
      do { sr = Math.floor(rnd()*size); sc = Math.floor(rnd()*size); att++; } while (assigned[sr][sc] && att < 100);
      var queue = [{r:sr,c:sc}], grown = 0;
      while (queue.length > 0 && grown < perColor) {
        var idx = Math.floor(rnd()*queue.length);
        var cell = queue.splice(idx, 1)[0];
        if (assigned[cell.r][cell.c]) continue;
        assigned[cell.r][cell.c] = true; blocks[cell.r][cell.c] = colors[ci]; grown++;
        for (var d = 0; d < dirs.length; d++) {
          var nr = cell.r+dirs[d][0], nc = cell.c+dirs[d][1];
          if (nr >= 0 && nr < size && nc >= 0 && nc < size && !assigned[nr][nc]) queue.push({r:nr,c:nc});
        }
      }
    }
    for (var r = 0; r < size; r++) for (var c = 0; c < size; c++) if (!assigned[r][c]) blocks[r][c] = colors[Math.floor(rnd()*colors.length)];
    return blocks;
  }

  function generateRandom(size, colors) {
    var blocks = AntSolver.create2D(size, size, 0);
    for (var r = 0; r < size; r++) for (var c = 0; c < size; c++) blocks[r][c] = colors[Math.floor(rnd()*colors.length)];
    return blocks;
  }

  function getColorPalette(count) {
    var palette = [1, 4, 6, 3, 7, 8, 2, 5, 9, 10, 11, 12];
    return palette.slice(0, Math.min(count, palette.length));
  }

  // ==================== TXT解析 ====================

  /**
   * 目标图 TXT → 数字矩阵。
   * 【v154 修】起始行判定从 /^\d/ 放宽到 /^-?\d/：
   *   官方 JSON 原始颜色矩阵（bin/参考/色库/official_json_original_color_matrices/）
   *   用 -1 表示空位，一行**以 -1 开头**很正常；旧写法会把这种行当成标题整行丢掉，
   *   结果矩阵缺行、行列全错位。现在负号开头的行按数据行读入。
   */
  function blocksFromTXT(txtContent) {
    var lines = txtContent.trim().split('\n');
    var startIdx = 0;
    for (var i = 0; i < lines.length; i++) {
      var trimmed = lines[i].trim();
      if (trimmed === '' || !/^-?\d/.test(trimmed)) { startIdx = i + 1; } else { break; }
    }
    var blocks = [];
    for (var i = startIdx; i < lines.length; i++) {
      var line = lines[i].trim();
      if (line === '') continue;
      var row = line.split(/\s+/).map(function(s) { var n = parseInt(s,10); return isNaN(n)?0:n; });
      if (row.length > 0) blocks.push(row);
    }
    return blocks;
  }

  /* ===== 正式默认流程开关（v95 发布）=====
   * v95 起 produce() 默认走纠偏版流程 produceFixed（R01-R07）。
   * 发布依据：348 张同源图新旧双侧全量对照——新 98.85%(344/348) vs 旧 96.26%(335/348)；
   *   总耗时 1:51:15 vs 3:49:33（快 2.06 倍）；331 张两侧都合格的图上后期峰窗差均 -0.07、
   *   难度分差均 -0.06（质量打平）；棋盘尺寸越出方案范围的关 旧 122 → 新 0。
   * 旧流程实现一行未删，三种回退方式任选：
   *   ① 全局回退：AntSolver.Generator.FLOW = 'old'
   *   ② 单次回退：produce(blocks, Object.assign({}, cfg, { generatorFlow: 'old' }))
   *   ③ 直接调用：AntSolver.Generator.produceLegacy(blocks, config)
   * 返回契约：两条流程都经 finalizeProduce 返回同一候选对象结构，
   *   纠偏版额外带 flow / flowStats 字段，调用方无需改动。
   */
  var DEFAULT_FLOW = 'new_fixed';
  /** 【v194】一图多产的比较元组：先比六条过几条，再比离带距离，再比稳健通关率。 */
  var _PRESSURE_FIRST = false;   // 【v215】压力优先：可解的前提上，峰窗越高越好
  var _AUDIT_FIRST = false;      // 【v216】全知线优先：看"最优解自己扛多少"，不是玩家容错低
  /**
   * 【v314·用户裁决】任何"重产一次"的分支都必须走**当前选定的那条产线**。
   *   泄漏点：bandFixOnce（带外纠偏）和全灭兜底都写死调用 produceFixed —— 新版流程
   *   按结构/层铺盒，不认 boxSizeMin/Max。结果用户设 30~60，纠偏一变就成了
   *   74 辆 8~25 的车（管道塞 45 辆，棋盘 6×6），用户：「管道里塞了 45 辆车，怎么突然会这样」。
   */
  function runFlowOnce(blocks, config, opts) {
    try {
      if (config && config.generatorFlow === 'old') return produce(blocks, config);
      return produceFixed(blocks, config, opts || {});
    } catch (e) { return null; }
  }

  /**
   * 【v314】关卡里"低于用户容量下限"的车占比过高 → 这条产线没按容量走（多半是串到了新版流程）。
   *   容忍 15% 的余量（同色尾盒合并会把下限打穿一点）；超过 12% 的车低于 下限×0.85 就判为走错线。
   */
  function capsOffRange(level, config) {
    try {
      var mn = parseInt(config && config.boxSizeMin, 10) || 0;
      if (!(mn > 0)) return false;
      var cells = level && level.board && level.board.cells;
      if (!cells) return false;
      var caps = [], r, c, i, x;
      for (r = 0; r < cells.length; r++) for (c = 0; c < cells[r].length; c++) {
        x = cells[r][c];
        if (!x) continue;
        if (x.t === 'box') caps.push(x.count);
        else if (x.t === 'pipe' && x.queue) for (i = 0; i < x.queue.length; i++) caps.push(x.queue[i].count);
      }
      if (caps.length < 4) return false;
      var bad = 0;
      for (i = 0; i < caps.length; i++) if (caps[i] < mn * 0.85) bad++;
      return (bad / caps.length) > 0.12;
    } catch (e) { return false; }
  }

  /**
   * 【v242】带外纠偏一次：portfolio 选出的关如果峰窗不在目标带里，用"冰量"做一次比例修正再产一遍。
   *   为什么用冰：实测冰是最直接的压力旋钮（冰锁住浅层车 = 砍供给），而且不需要重算切法。
   *   只在带外时触发一次，带内不动；成本 = 一次额外 produceFixed（5~15s）。
   *   方向：峰窗低于下界 → 加冰（×1.2）；高于上界 → 减冰（×0.85）。
   */
  function bandFixOnce(out, blocks, config) {
    try {
      var gv = out && out.goodV3;
      if (!gv || gv.midLateMax == null) return out;
      var lo = (config && config.targetPeakMin != null) ? +config.targetPeakMin : 3.2;
      var hi = (config && config.targetPeakMax != null) ? +config.targetPeakMax : 4.0;
      var p = gv.midLateMax;
      var d0 = (p < lo) ? (lo - p) : (p > hi ? (p - hi) : 0);
      if (d0 <= 0.05) return out;
      var cfg = config || {};
      var ice0;
      if (cfg.icePercent != null && !isNaN(+cfg.icePercent)) ice0 = +cfg.icePercent;
      else if (cfg.icePercentMin != null && cfg.icePercentMax != null) ice0 = (+cfg.icePercentMin + +cfg.icePercentMax) / 2;
      else ice0 = 12;
      ice0 = Math.round(ice0);
      var down = (p > hi);
      var ni = Math.max(0, Math.min(45, Math.round(ice0 * (down ? 0.85 : 1.2))));
      if (ni === ice0) return out;
      var cfg2 = {};
      for (var k in cfg) if (k.charAt(0) !== '_') cfg2[k] = cfg[k];
      cfg2.icePercent = ni; cfg2.icePercentMin = ni; cfg2.icePercentMax = ni;
      cfg2._deadlineAt = 0;
      var alt = null;
      // 【v314】走当前产线；并且纠偏产出的关必须还在用户的容量区间里，否则不采纳
      try { alt = runFlowOnce(blocks, cfg2, {}); } catch (e) { alt = null; }
      if (!alt || !alt.level || !alt.goodV3) return out;
      if (capsOffRange(alt.level, cfg2)) return out;
      var p2 = alt.goodV3.midLateMax;
      var d2 = (p2 < lo) ? (lo - p2) : (p2 > hi ? (p2 - hi) : 0);
      // 【v243】只比"离带距离"是错的：实测 seed 402 被纠偏从 峰窗3/稳健50 换成 峰窗4/稳健100 ——
      //   峰窗进了带，但稳健从合格变成不合格，整体反而更差。
      //   正确顺序：先比为 0 的项数（fails 条数，越少越好），再比带距，最后比稳健离 55% 的远近。
      var f0 = (gv.fails || []).length, f2 = (alt.goodV3.fails || []).length;
      // 稳健也要算"离带距离"，不能只看峰窗：稳健 100%（怎么打都过）和 峰窗 2.0（没压力）
      //   都是 1 条不合格，但前者是"太简单"、后者是"没做出来"，对用户的价值完全不同。
      var slo = (config && config.targetSteadyMin != null) ? +config.targetSteadyMin : 30;
      var shi = (config && config.targetSteadyMax != null) ? +config.targetSteadyMax : 80;
      function dSteady(v) {
        if (v == null) return 9;
        return (v < slo) ? (slo - v) / 20 : (v > shi ? (v - shi) / 20 : 0);
      }
      var c0 = d0 + dSteady(gv.steadyWonPct), c2 = d2 + dSteady(alt.goodV3.steadyWonPct);
      // 【v272】纠偏重产的关**不走 portfolio 的结构组合**，所以覆盖率天然偏低；
      //   原来只要"离带更近"就替换，实测会把 cov=48% 的关换成 cov=18% 的。
      //   现在同违规条数时先比覆盖率，覆盖不掉才比带距。
      var b0 = (gv.persist && gv.persist.band3Pct != null) ? gv.persist.band3Pct : -1;
      var b2 = (alt.goodV3.persist && alt.goodV3.persist.band3Pct != null) ? alt.goodV3.persist.band3Pct : -1;
      var better = false;
      if (f2 !== f0) better = (f2 < f0);
      else if (b2 !== b0) better = (b2 > b0);
      else if (Math.abs(c2 - c0) > 0.05) better = (c2 < c0);
      else better = ((alt.goodV3.steadyWonPct || 0) > (gv.steadyWonPct || 0));
      if (better) { alt.bandFix = { from: p, to: p2, ice: ni, failsFrom: f0, failsTo: f2 }; return alt; }
      return out;
    } catch (e) { return out; }
  }

  /**
   * 【v246/v247】按「像素密度 ÷ 容量下限」反推这次棋盘能填多满，并写回车数/可用空间目标。
   *   不存在一个对所有图都成立的填满率：40×40 能到 0.97（黑块 1 块），
   *   35×35 只能到 0.88（再高就把容量压到下限以下 → 车切碎 → pipeCapacity 全灭）。
   *   usableSpaceTarget 必须跟着填满率走，否则配上"填不满 → 补墙"又会长出一堆黑块。
   */
  function applyFillRatio(cfg, blocks, config, rows, cols, ratioOverride) {
    var fill = (ratioOverride != null) ? +ratioOverride : ((config && config.carFillRatio != null) ? +config.carFillRatio : 0.86);
    if (!(fill > 0.3 && fill <= 1)) fill = 0.86;
    var px = 0;
    for (var r = 0; r < blocks.length; r++)
      for (var c = 0; c < blocks[r].length; c++) if (blocks[r][c] > 0) px++;
    var capFloor = Math.max(20, parseInt(config && config.boxSizeMin, 10) || 33);
    var cells = rows * cols;
    if (px > 0 && cells > 0 && capFloor > 0) {
      var maxRatio = (px / cells) / capFloor;
      if (maxRatio < fill) fill = maxRatio;
    }
    fill = Math.max(0.75, Math.min(0.97, fill));
    cfg.targetCarCount = Math.max(4, Math.round(cells * fill));
    cfg.usableSpaceTarget = fill;
    cfg._fillRatio = +fill.toFixed(3);
    return fill;
  }

  function portfolioTuple(out) {
    var g = out && out.goodV3;
    if (!g || !g.fails) return { f: 99, d: 1e9, s: -1 };
    var p = g.midLateMax;
    var d = (p == null) ? 1e9 : (p < 3.2 ? (3.2 - p) : (p > 4.8 ? (p - 4.8) : 0));
    return { f: g.fails.length, d: d, s: (g.steadyWonPct || 0), p: (p == null ? -1 : p), ok: !!g.pass, ap: (g.midLateAudit == null ? -1 : g.midLateAudit), ts: (g.targetScore == null ? null : g.targetScore),
             fc: (g.fillCurve ? g.fillCurve.medFull : null), lp: (g.fillCurve ? g.fillCurve.lowPct : null),
             ge: (g.persist ? g.persist.ge3Pct : null), lg: (g.persist ? g.persist.longest : null),
             cw: (g.persist ? g.persist.chokeWin : null), b3: (g.persist ? g.persist.band3Pct : null), pp: (g.persist && g.persist.playerPassPct != null ? g.persist.playerPassPct : null), pn: (g.fillCurve ? g.fillCurve.pressureN : 0), of: (g.fillCurve ? g.fillCurve.openingFree12 : 0),
             ep: (g.fillCurve ? g.fillCurve.earlyPeak10 : 0), ef: (g.fillCurve ? g.fillCurve.earlyFree10 : 0),
             sm: (g.fillCurve ? g.fillCurve.selectMedian : 0), fp: (g.fillCurve ? g.fillCurve.forcedPct : 0),
             ps: (g.fillCurve ? ((g.fillCurve.pressurePct3 || 0) * 2 + (g.fillCurve.pressurePeak || 0) * 10 - (g.fillCurve.freeLowPct || 0)) : 0),
             qg: (function () { try { return goalStructPass(out) ? 1 : 0; } catch (e) { return 0; } })() };
  }
  function portfolioBetter(x, y) {
    if (!y) return true;
    if (!!x.ok !== !!y.ok) return !!x.ok;                 // 能过（可解）优先
    // 【v460】结构门优先：qGate 过 > 不过
    if ((x.qg || 0) !== (y.qg || 0)) return (x.qg || 0) > (y.qg || 0);
    // 【v460】首通优先 ≤50；旧 30~80 会优先选偏松关
    var _hr = function (t) {
      if (t.pp == null) return 2;
      if (t.pp <= 50) return 0;
      if (t.pp <= 65) return 1;
      return 2;
    };
    if (_hr(x) !== _hr(y)) return _hr(x) < _hr(y);
    // 【v413】障碍变体：压力分差 ≥15 时优先压力高的，让冰/链/管道变体真正参与选择
    if (Math.abs((x.ps || 0) - (y.ps || 0)) >= 15) return (x.ps || 0) > (y.ps || 0);
    if ((x.pn > 0) !== (y.pn > 0)) return x.pn > 0;
    if (x.ts != null || y.ts != null) {
      if (!!x.ok !== !!y.ok) return !!x.ok;
      // 【v270 修】原来直接比 targetScore，而 targetScore 把"峰窗离 3.6 多远"算进去，
      //   0.1 的峰窗差异就能压过 30 个百分点的覆盖率 —— 实测 seed401 选了 cov=4% 而丢掉 cov=35%。
      //   用户口径是"30~80 覆盖优先"，所以：同违规条数时**先比覆盖率**，再比 targetScore。
      if (x.f !== y.f) return x.f < y.f;
      var _b3x = (x.b3 == null ? -1 : x.b3), _b3y = (y.b3 == null ? -1 : y.b3);
      if (_b3x !== _b3y) return _b3x > _b3y;
      // 【v378】首通 30~80% 优先，其次离 55 近
      if (x.pp != null && y.pp != null) {
        var _inX = (x.pp >= 30 && x.pp <= 80), _inY = (y.pp >= 30 && y.pp <= 80);
        if (_inX !== _inY) return _inX;
        var _dx = Math.abs(x.pp - 55), _dy = Math.abs(y.pp - 55);
        if (Math.abs(_dx - _dy) >= 10) return _dx < _dy;
      }
      if ((x.ts || 9) !== (y.ts || 9)) return (x.ts || 9) < (y.ts || 9);
      // 【v238】目标分打平时的加赛：优先「吃满≤1 的步占比」落在 45~90%（实测合格关集中带）。
      //   只影响完全同分的情况，不改合格门、不改目标分公式。
      var _band = function (v) { return (v == null) ? 99 : (Math.max(0, 45 - v) + Math.max(0, v - 90)); };
      if (_band(x.lp) !== _band(y.lp)) return _band(x.lp) < _band(y.lp);
      // 【v262】仍然同分：优先"全知压力更持久"的（≥3 步占比 + 最长连续）
      var _pers = function (t) { return ((t.b3 || 0) * 10.0 + (t.cw || 0) * 2.0 + (t.ge || 0) * 1.0 + (t.lg || 0) * 2.0); };  // v264：30-80 覆盖占比优先
      if (_pers(x) !== _pers(y)) return _pers(x) > _pers(y);
      return false;
    }
    if (_AUDIT_FIRST) {
      if (x.ap !== y.ap) return x.ap > y.ap;              // 全知线峰窗大的胜
      if (x.p !== y.p) return x.p > y.p;
      return x.s > y.s;
    }
    if (_PRESSURE_FIRST) {
      if (x.p !== y.p) return x.p > y.p;                  // 压力优先：峰窗大的胜
      if (x.f !== y.f) return x.f < y.f;
      return x.s > y.s;
    }
    if (x.f !== y.f) return x.f < y.f;
    if (Math.abs(x.d - y.d) > 0.05) return x.d < y.d;
    return x.s > y.s;
  }

  /**
   * 【2026-10-22·用户裁决】前沿宽度：按“每次消除一种颜色”的贪心序，统计每一步同时露着几种颜色。
   *   2~4 = 窄前沿（适合暴露序+行优先）；5+ = 宽前沿（适合按依赖层）。
   *   只读，不改变任何关卡；结果挂在 blocks._frontier 做缓存。
   */
  function frontierWidthOf(blocks) {
    try { if (blocks && blocks._frontier) return blocks._frontier; } catch (e) {}
    var Sim = AntSolver.Simulator;
    if (!Sim || !Sim.createState || !Sim.previewNextEliminationOrder || !Sim.elimDispatch) return null;
    if (!blocks || !blocks.length || !blocks[0]) return null;
    var rows = blocks.length, cols = blocks[0].length, total = 0;
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) if (blocks[r][c] > 0) total++;
    if (!total) return null;
    var s;
    try {
      s = Sim.createState({ blocks: blocks, rows: rows, cols: cols, totalPixels: total, totalBoxes: 0,
        bufferLimit: 5, board: { rows: 0, cols: 0, cells: [] } }, {});
    } catch (e) { return null; }
    var sum = 0, steps = 0, max = 0, done = 0, guard = 0;
    while (done < total && guard++ < 500) {
      var pv;
      try { pv = Sim.previewNextEliminationOrder(s); } catch (e) { break; }
      var active = 0, best = -1, bestN = 0;
      for (var k in pv.byColor) {
        var e = pv.byColor[k];
        if (e && e.reachable > 0) {
          active++;
          if (e.reachable > bestN) { bestN = e.reachable; best = +k; }
        }
      }
      if (best < 0) break;
      sum += active; steps++; if (active > max) max = active;
      var got = 0;
      try { got = Sim.elimDispatch(s, best, Infinity); } catch (e) { break; }
      if (!(got > 0)) break;
      done += got;
    }
    if (!steps) return null;
    var out = { avg: +(sum / steps).toFixed(2), max: max, steps: steps };
    try { blocks._frontier = out; } catch (e) {}
    return out;
  }

  /**
   * 【2026-10-22·用户裁决】按图推导容量带（用户不再手填上下限）。
   *   m = 需求块中位数；[1.5m, 4.5m] 内挑“开局白给车 ≤2”的容量；
   *   找不到 → 取上界，并在前端提示“需要冰/改图”。
   * 结果挂在 blocks._capBand 做缓存。
   */
  function deriveCapacityBand(blocks) {
    try { if (blocks && blocks._capBand) return blocks._capBand; } catch (e) {}
    if (!blocks || !blocks.length || !blocks[0]) return null;
    var R = blocks.length, C = blocks[0].length;
    var total = 0, byColor = {};
    for (var r = 0; r < R; r++) for (var c = 0; c < C; c++) {
      var v = blocks[r][c];
      if (v > 0) { total++; byColor[v] = (byColor[v] || 0) + 1; }
    }
    if (!total) return null;
    var exp = openingExposure(blocks, R, C, false);
    var E = {};
    if (exp && exp.detail) for (var i = 0; i < exp.detail.length; i++) E[exp.detail[i].color] = exp.detail[i].px;
    var dc = demandCurveOf(blocks);
    var incs = [];
    if (dc && dc.curve) {
      for (var col in dc.curve) {
        var arr = dc.curve[col], prev = 0;
        for (var j = 0; j < arr.length; j++) {
          var cum = arr[j][0];
          if (cum > prev) { incs.push(cum - prev); prev = cum; }
        }
      }
    }
    incs.sort(function (a, b) { return a - b; });
    var m = incs.length ? incs[Math.floor(incs.length / 2)] : 0;
    var frontier = frontierWidthOf(blocks);
    if (!(m > 0)) {
      return { m: 0, lo: 30, hi: 60, band: [40, 60], chosen: 50, feasible: false,
        free: null, freeHi: null, cars: null, frontier: frontier, reason: 'noChunk' };
    }
    var lo = Math.max(1, Math.ceil(m * 1.5));
    var hi = Math.max(lo, Math.floor(m * 4.5));
    function freeAt(cap) {
      var n = 0;
      for (var cc in E) n += Math.floor(E[cc] / cap);
      return n;
    }
    function carsAt(cap) {
      var n = 0;
      for (var cc in byColor) n += Math.max(1, Math.round(byColor[cc] / cap));
      return n;
    }
    var feas = [];
    for (var cap = lo; cap <= hi; cap++) if (freeAt(cap) <= 2) feas.push(cap);
    var feasible = feas.length > 0;
    var chosen = feasible ? feas[Math.floor(feas.length / 2)] : hi;
    var band = feasible ? [feas[0], feas[feas.length - 1]] : [hi, hi];
    var out = { m: m, lo: lo, hi: hi, band: band, chosen: chosen, feasible: feasible,
      free: freeAt(chosen), freeHi: freeAt(hi), cars: carsAt(chosen), frontier: frontier };
    try { blocks._capBand = out; } catch (e) {}
    return out;
  }

  /**
   * 【2026-10-22·用户裁决】目标模式（headless 版）：一直产，直到这一关满足当前验收（goodV3 全过）或被停止。
   *
   * ⚠ 只能在【没有 UI 交互】的场景用（CLI / 测试脚本）：它在一个同步 while 里跑，
   *   同线程的「结束」按钮 / Worker 的 {cmd:'stop'} 都处理不了。
   *   UI 走 `gen-worker.js` 的"一轮 produce + setTimeout 让出"循环，以及主线程回退的 `genRunGoalSync`。
   *
   * 与按时间模式的区别：
   *   - 按时间：每轮固定预算，到点返回最好；
   *   - 按目标：每轮固定预算（默认 20s），没达标就换种子再来，直到达标 / 停止 / 到上限。
   *
   * @param {Array} blocks
   * @param {object} config  goalPerRoundMs / goalMaxMs / goalMaxRounds（0 = 不限）
   * @param {object} opts    { shouldStop: function():boolean }
   */
  // 【v415】目标模式的结构门：可解 + 首通≤50 + J≤20 + W≤1≤35 + freeLow≤30
  //   不能再用旧 goodV3.pass，否则目标模式可能在旧判据上无限跑。
  function goalStructPass(r) {
    if (!r || !r.level || !r.valid || r.fallback) return false;
    var p = r.goodV3 && r.goodV3.persist;
    var fc = r.goodV3 && r.goodV3.fillCurve;
    if (!p || !fc) return false;
    // 【v436】目标模式追的结构门 = 当前 qGate-lite
    if (p.playerPassPct == null || p.playerPassPct > 50) return false;
    var dc = p.deathCauses || {}, dt = 0, dh = 0;
    for (var k in dc) { dt += dc[k]; if (k === '管道' || k === '问号') dh += dc[k]; }
    var J = dt ? Math.round(dh / dt * 100) : 0;
    if (J > 20) return false;
    if (fc.selectMedian != null && fc.selectMedian < 2) return false;
    if (fc.forcedPct != null && fc.forcedPct > 25) return false;
    if (fc.freeLowPct != null && fc.freeLowPct > 30) return false;
    return true;
  }

  function produceGoal(blocks, config, opts) {
    opts = opts || {};
    config = Object.assign({}, DEFAULT_CONFIG, config || {});
    var t0 = Date.now();
    var perMs = parseInt(config.goalPerRoundMs, 10);
    if (!(perMs > 0)) perMs = 20000;
    var maxMs = parseInt(config.goalMaxMs, 10);
    if (!(maxMs > 0)) maxMs = 0;
    var maxRounds = parseInt(config.goalMaxRounds, 10);
    if (!(maxRounds > 0)) maxRounds = 0;
    var baseSeed = (config.seed != null && !isNaN(+config.seed)) ? (+config.seed) : ((Date.now() & 0x7fffffff) >>> 0);
    function passed(r) { return goalStructPass(r); }
    function score(r) {
      if (!r || !r.level) return -1e15;
      var s = 0;
      if (r.valid) s += 1e6;
      if (!r.fallback) s += 1e5;
      if (r.goodV3 && r.goodV3.pass) s += 1e9;
      var p = (r.goodV3 && r.goodV3.persist) || {};
      s += (p.band3Pct || 0) * 1000;
      s += (p.bandPeak || 0) * 10;
      s += (r.difficulty && r.difficulty.score) || 0;
      return s;
    }
    var best = null, rounds = 0, stopped = false;
    while (true) {
      if (opts.shouldStop && opts.shouldStop()) { stopped = true; break; }
      if (maxRounds && rounds >= maxRounds) break;
      if (maxMs && (Date.now() - t0) >= maxMs) break;
      var cfg = Object.assign({}, config, {
        goalMode: false,
        portfolioK: 1,
        timeBudgetMs: perMs,
        seed: (baseSeed + rounds * 7919) >>> 0,
        _trace: []
      });
      var r = null;
      try { r = produceDispatch(blocks, cfg, opts); } catch (e) {
        r = { level: null, valid: false, lastFailReason: 'goalRoundError: ' + ((e && e.message) || e) };
      }
      rounds++;
      if (r) r.goalRound = rounds;
      if (!best || score(r) > score(best)) best = r;
      if (passed(r)) break;
    }
    if (best) {
      best.goalMode = true;
      best.goalRounds = rounds;
      best.goalElapsedMs = Date.now() - t0;
      best.goalStopped = stopped;
    }
    return best;
  }

  function produceDispatch(blocks, config, opts) {
    var _pdT0 = Date.now();
    var _pdBudget = parseInt(config && config.timeBudgetMs, 10) || 180000;
    var _pdReserve = Math.min(30000, Math.max(5000, Math.round(_pdBudget * 0.2)));
    function _pdLeft() { return _pdBudget - (Date.now() - _pdT0); }
    var flow = (config && config.generatorFlow) ||
      (AntSolver.Generator && AntSolver.Generator.FLOW) || DEFAULT_FLOW;
    // 【v194】一图多产：同图跑 K 次（seed + i），按最终 goodV3 择优；已全过就早停。
    //   config.portfolioK === 1（默认）时逐值等于改动前。
    // 【v334】生成轨迹数组（外层持有，内层 produce 往同一个数组里 push）
    if (!config._trace) config._trace = [];
    _PRESSURE_FIRST = !!(config && config.pressureFirst);
    _AUDIT_FIRST = !!(config && config.auditFirst);
    var _pk = Math.max(1, Math.min(10, parseInt(config && config.portfolioK, 10) || 1));
    var out = null;
    // 【v201·实验】设计扫描：把"饥荒强度"当成一个可搜索的设计参数（第0行保留几辆早车 = 3/2/1），
    //   每个取值真跑一关、按最终 goodV3 择优。耗时 ×3，用户已确认"几分钟正常"。
    if (config && config.designSweep) {
      // 【v224】目标扫描：只调两个数 k（债车数）× s（环上供给），目标是"峰窗3~4 + 稳健30~80"
      if (config.targetSweep) {
        // 【v226】容量 × 棋盘 网格搜索：容量管"稳健"，棋盘管"峰窗"
        var _capMin0 = parseInt(config.boxSizeMin, 10) || 22;
        var _capMax0 = parseInt(config.boxSizeMax, 10) || 30;
        var _scales = [1.0, 1.4, 1.8];
        // 棋盘改成"范围"，由引擎按车数挑最接近的合法尺寸（不再写死正方形）
        var _boards = [[[5, 6], [6, 7]], [[6, 7], [7, 8]], [[7, 8], [8, 9]]];
        var _boardCars = [31, 42, 55];   // 每档棋盘的"目标车数"（≈ 格数×0.86）
        var _tv = [];
        for (var _si = 0; _si < _scales.length; _si++) {
          for (var _bi = 0; _bi < _boards.length; _bi++) {
            _tv.push({
              bmin: Math.max(12, Math.round(_capMin0 * _scales[_si])),
              bmax: Math.max(16, Math.round(_capMax0 * _scales[_si])),
              rMin: _boards[_bi][0][0], rMax: _boards[_bi][0][1],
              cMin: _boards[_bi][1][0], cMax: _boards[_bi][1][1],
              cars: _boardCars[_bi]
            });
          }
        }
        // 固定尺寸组合（实测有效：6×7 + 容量×1.4 + 36 辆）
        var _dims = [[6, 7], [7, 7], [7, 8], [6, 6]];
        for (var _fj = 0; _fj < 2; _fj++) {
          var _sc2 = [1.4, 1.8][_fj];
          for (var _di = 0; _di < _dims.length; _di++) {
            _tv.push({
              bmin: Math.max(12, Math.round(_capMin0 * _sc2)),
              bmax: Math.max(16, Math.round(_capMax0 * _sc2)),
              rMin: _dims[_di][0], rMax: _dims[_di][0],
              cMin: _dims[_di][1], cMax: _dims[_di][1],
              cars: Math.round(_dims[_di][0] * _dims[_di][1] * 0.86),
              fixed: true
            });
          }
        }
        var _bestT = null, _bestTT = null, _bestTv = null;
        for (var _ti = 0; _ti < _tv.length; _ti++) {
          var _v = _tv[_ti];
          var _tc = Object.assign({}, config, {
            boxSizeMin: _v.bmin, boxSizeMax: _v.bmax,
            boardRowsMin: _v.rMin, boardRowsMax: _v.rMax,
            boardColsMin: _v.cMin, boardColsMax: _v.cMax,
            boardHardRange: !!_v.fixed, boardAuto: false, boardAllowSquare: true,
            targetCarCount: _v.cars,
            acceptMode: 'target', designSweep: false, pressureSweep: false,
            lidSweep: false, targetSweep: false, portfolioK: 1,
            candidateCount: 4, difficultyRounds: 2   // 复现手工配方（少候选少轮次）
          });
          var _to = flow === 'old' ? produce(blocks, _tc) : produceFixed(blocks, _tc, opts);
          var _tt = portfolioTuple(_to);
          if (_to && (!_bestT || portfolioBetter(_tt, _bestTT))) { _bestT = _to; _bestTT = _tt; _bestTv = _v; }
          if (_bestT && _bestT.goodV3 && _bestT.goodV3.pass) break;
        }
        out = _bestT;
        if (out) out.targetSweep = { best: _bestTv };
      } else
      // 【v216】盖子扫描：环上留 2 / 1 / 0 辆浅层，按**全知线峰**择优
      if (config.lidSweep) {
        var _lv = [{ ring: 'H', target: 2 }, { ring: 'F', target: 1 }, { ring: 'G', target: 0 }];
        var _bestL = null, _bestLT = null, _triedL = 0, _bestLv = null;
        for (var _li = 0; _li < _lv.length; _li++) {
          var _lc = Object.assign({}, config, {
            cutMode: 'component', ringPlan: _lv[_li].ring,
            designDebt: true, designSupplyTarget: _lv[_li].target, designRow0Target: _lv[_li].target,
            acceptMode: 'solvable', auditFirst: true, lidSweep: false, pressureSweep: false,
            designSweep: false, portfolioK: 1
          });
          var _lo = flow === 'old' ? produce(blocks, _lc) : produceFixed(blocks, _lc, opts);
          _triedL++;
          var _lt = portfolioTuple(_lo);
          if (_lo && (!_bestL || portfolioBetter(_lt, _bestLT))) { _bestL = _lo; _bestLT = _lt; _bestLv = _lv[_li].ring; }
        }
        out = _bestL;
        if (out) out.lidSweep = { tried: _triedL, best: _bestLv };
      } else
      // 【v215】压力扫描：可解前提下专门加压（环上少放供给、多放债点、多绑链）
      if (config.pressureSweep) {
        var _pv = [
          { target: 2, gap: 0, deep: 2, ring: 'C', chain: 0, inflate: 0 },
          { target: 2, gap: 0, deep: 3, ring: 'D', chain: 2, inflate: 0 },
          { target: 1, gap: 0, deep: 3, ring: 'E', chain: 3, inflate: 0 },
          { target: 2, gap: 0, deep: 3, ring: 'D', chain: 2, inflate: 1.5 },
          { target: 0, gap: 0, deep: 3, ring: 'E', chain: 3, inflate: 2 }
        ];
        var _bestP = null, _bestPT = null, _triedP = 0, _passP = 0, _bestPV = null;
        for (var _pi2 = 0; _pi2 < _pv.length; _pi2++) {
          var _v2 = _pv[_pi2];
          var _pc = Object.assign({}, config, {
            designDebt: true, designSupplyTarget: _v2.target, designRow0Target: _v2.target,
            designDeepRing: _v2.deep, ringPlan: _v2.ring, chainPlan: _v2.chain > 0,
            chainGroupsMax: _v2.chain || 0, designInflate: _v2.inflate,
            scheduleDeepGap: 0, pressureSweep: false, designSweep: false, portfolioK: 1
          });
          var _po = flow === 'old' ? produce(blocks, _pc) : produceFixed(blocks, _pc, opts);
          _triedP++;
          var _pt = portfolioTuple(_po);
          if (_po && _po.goodV3 && _po.goodV3.pass) _passP++;
          if (_po && (!_bestP || portfolioBetter(_pt, _bestPT))) { _bestP = _po; _bestPT = _pt; _bestPV = _v2; }
          if (_bestP && _bestP.goodV3 && _bestP.goodV3.pass && (_bestP.goodV3.midLateMax || 0) >= 4.5) break;
        }
        out = _bestP;
        if (out) out.pressureSweep = { tried: _triedP, passes: _passP, best: _bestPV };
        if (_pk <= 1) { /* 压力扫描已覆盖 */ }
      } else
      // 三阶段：① 早车档（只挪位）② 序号插深层车（gap）③ 增容
      var _variants = [];
      [4, 3, 2, 1, 0].forEach(function (t) { _variants.push({ target: t, inflate: 0, gap: 0, deep: 0, mo: 'scan' }); });
      _variants.push({ target: 2, inflate: 0, gap: 0, deep: 0, mo: 'layer' });   // 层序对照
      // gap / 债点 这两类只对"合球切法"有意义；默认切法不加，免得白白多跑 6 次
      if (config.cutMode === 'component') {
        [3, 4, 5].forEach(function (g) {
          _variants.push({ target: 2, inflate: 0, gap: g, deep: 1 });
          _variants.push({ target: 2, inflate: 0, gap: g, deep: 0 });
        });
      }
      [2, 1, 0].forEach(function (t) { [1.5, 2].forEach(function (k) { _variants.push({ target: t, inflate: k, gap: 0, deep: 0, mo: 'scan' }); }); });
      var _targets = _variants, _bestD = null, _bestDT = null, _triedD = 0, _passD = 0, _bestTarget = null;
      for (var _ti = 0; _ti < _variants.length; _ti++) {
        var _v = _variants[_ti];
        var _dcfg = Object.assign({}, config, {
          designDebt: true, designSupplyTarget: _v.target, designRow0Target: _v.target, designInflate: _v.inflate, scheduleDeepGap: _v.gap || 0, designDeepRing: _v.deep || 0, mergeOrder: _v.mo || 'scan', designSweep: false, portfolioK: 1
        });
        var _do = flow === 'old' ? produce(blocks, _dcfg) : produceFixed(blocks, _dcfg, opts);
        _triedD++;
        var _dt = portfolioTuple(_do);
        if (_do && _do.goodV3 && _do.goodV3.pass) _passD++;
        if (_do && (!_bestD || portfolioBetter(_dt, _bestDT))) { _bestD = _do; _bestDT = _dt; _bestTarget = _v.target + ("" + (_v.inflate ? '/' + _v.inflate : '')); }
        if (_bestD && _bestD.goodV3 && _bestD.goodV3.pass) break;
      }
      out = _bestD;
      if (out) out.designSweep = { variants: _variants, tried: _triedD, passes: _passD, best: _bestTarget };
    } else if (_pk <= 1) {
      out = flow === 'old' ? produce(blocks, config) : produceFixed(blocks, config, opts);
    } else {
      var _best = null, _bestT = null, _tried = 0, _passes = 0;
      for (var _pi = 0; _pi < _pk && _pdLeft() > _pdReserve; _pi++) {
        var _cfg = Object.assign({}, config, { portfolioK: 1 });
        // 【v344】轮换切法：奇数轮尝试按依赖层切车（layerCut2），由 portfolioBetter 按覆盖率择优。
        //   用户手动指定 cutMode 时不轮换（尊重用户）；_pk=1 时也不轮换（没有可比对象）。
        if (!config.cutMode && _pk > 1 && (_pi % 2 === 1)) _cfg.cutMode = 'layerCut2';
        // 【v234】棋盘自动选择：每次尝试换一个棋盘尺寸（由 config.boardTryDims 给出）
        if (config && config.boardTryDims && config.boardTryDims.length) {
          var _bd = config.boardTryDims[_pi % config.boardTryDims.length];
          _cfg.boardRowsMin = _bd[0]; _cfg.boardRowsMax = _bd[0];
          _cfg.boardColsMin = _bd[1]; _cfg.boardColsMax = _bd[1];
          _cfg.boardHardRange = true; _cfg.boardAuto = false; _cfg.boardAllowSquare = true;
          // 【v245】车数占格比可调：0.86 会让"车比格少 14%"，那些空格最后被配额填成黑块
          //   （实测 6×7 盘出 5~6 块墙）。用户要求"尽量用数字冰代替黑块"，这里把比例调到 ~0.96，
          //   空格只剩 1~2 个，墙自然就没了；多出来的车由冰/链承担压力。
          applyFillRatio(_cfg, blocks, config, _bd[0], _bd[1]);
          if (flow === 'old') _cfg.targetCarCount = 0;   // 【v337】同上：旧流程不按目标车数拆车
          // 【v270】自适应盘型同样按 8 种结构组合轮换（原来只有固定尺寸才换）
          if (config && config.mixStruct !== false) {
            var _MIX2 = [[0,0,0],[2,2,0],[0,2,2],[2,0,2],[1,0,0],[0,1,0],[3,2,0],[0,3,0]];
            var _mx = _MIX2[_pi % _MIX2.length];
            if (config.capTie) {
              // 【v275】capTie 已解决"车太小"根因；再叠 lag/capSeq 反而更差（58%→26%）。
              //   capTie 模式下组合改成只变"每色开局能装满几辆"。
              var _PERC2 = [2.0, 1.8, 2.2, 2.5, 1.6, 2.4, 2.0, 1.9];
              var _ICE2 = [2, 4, 3, 4, 2, 3, 4, 2];
              _cfg.fillLag = 0; _cfg.capSeqBoost = 0; _cfg.chunkCut = 0;
              _cfg.capPerColor = _PERC2[_pi % _PERC2.length];
              // 【v294·用户裁决】逐行铺 + 晚熟色前排：进组合轮换，0=纯需求序 / 1=仅第0行 / 2=前两行
              var _RM = [1, 2, 0, 1, 2, 0, 1, 2][_pi % 8];
              _cfg.rowMajorMix = _RM > 0;
              _cfg.freePerRow = (_RM === 1 ? 2 : 3);
              _cfg.mixRows = (_RM === 1 ? 1 : 2);
              // 【v286·方案A】每次尝试换棋盘填充率：0.62 / 0.70 / 0.86 轮换，由覆盖率选优
              var _SWa = [3,3,5,3,0,3,5,3][_pi % 8];
              _cfg.sandwich = _SWa > 0; _cfg.lateShallow = _SWa || 4; _cfg.earlyKeep = 2;
              _cfg.iceScheduleCount = _ICE2[_pi % _ICE2.length];
              _cfg.iceMultiPoint = (_cfg.iceScheduleCount >= 3);
              _cfg._mixTag = 'capTie/' + _cfg.capPerColor;
            } else {
              _cfg.fillLag = _mx[0]; _cfg.capSeqBoost = _mx[1]; _cfg.chunkCut = _mx[2];
              _cfg._mixTag = _mx.join('/');
            }
          }
          // 【v238】容量也随这次选的棋盘反推（原先只有 app 侧算一次，换尺寸后容量不跟着变）：
          //   每辆容量 ≈ 彩色像素 ÷ 目标车数，区间 ±12%。这样 6×7/7×7/6×8/7×8 各自有各自的容量，
          //   不会出现"小棋盘配大车装不下 / 大棋盘配小车太空"。
          var _px238 = 0;
          for (var _r238 = 0; _r238 < blocks.length; _r238++)
            for (var _c238 = 0; _c238 < blocks[_r238].length; _c238++) if (blocks[_r238][_c238] > 0) _px238++;
          if (_px238 > 0 && _cfg.targetCarCount > 0) {
            var _cap238 = Math.max(12, Math.min(96, Math.round(_px238 / _cfg.targetCarCount)));
            _cfg.boxSizeMin = Math.max(33, Math.round(_cap238 * 0.88));   // 【v238】下限 33：小图压低容量会切碎（35×35 实测 30~38 全灭）
            _cfg.boxSizeMax = Math.max(_cfg.boxSizeMin + 6, Math.round(_cap238 * 1.12));
          }
        }
        // 【v247】固定行列（不勾自适应）时也要按像素密度定填满率 ——
        //   v246 只写在 boardTryDims 分支里，用户一勾"手动行列"，35×35 就又按 0.97 硬算 → 全灭。
        if (!(config && config.boardTryDims && config.boardTryDims.length)) {
          var _fr = (config && config.carFillRatio != null) ? +config.carFillRatio : 0.86;
          var _rm = parseInt(_cfg.boardRowsMax, 10) || 0, _cm = parseInt(_cfg.boardColsMax, 10) || 0;
          if (_rm > 0 && _cm > 0) applyFillRatio(_cfg, blocks, config, _rm, _cm, _fr);
          // 【v337·修 bug】applyFillRatio 会顺手写 cfg.targetCarCount = 格数×填满率（这里 ≈46）。
          //   旧流程的棋盘是按盒数反推的，不该再按"目标车数"把 60 的车对半拆成 30——
          //   这就是用户看到的"大色块一堆 30 容量"的真凶（v315 只在 app 侧清了，生成器这边又被写回来了）。
          if (flow === 'old') _cfg.targetCarCount = 0;
          // 【v258·用户问"自己定尺寸会生成多少候选"】固定尺寸时棋盘不变，
          //   原来 8 次尝试只是在同一尺寸上重摇随机数 —— 多样性很差。
          //   现在每次换一组"容量 ±8% / 冰排程 2~3 块 / 延迟 3~5 步"，8 次尝试才有真正的结构差异。
          // 【v269】每次尝试换一组"结构手段"：需求滞后 / 同色容量序列 / 按块切车。
          //   单用任何一个都不稳（方差大于信号），但**让 8 次尝试各走一条路**，
          //   再由 band3Pct 选优，等于把"运气"变成了池子里的多样性。
          // 【v270】结构组合扩到 8 种：8 次尝试各走一条，覆盖"基线 / 滞后 / 容量序列 / 按块切"的组合
          // 【v271】冰档并进组合实测更差（中位 43%→31%），已回退为纯结构三件套
          var _MIXES = [
            [0, 0, 0], [2, 2, 0], [0, 2, 2], [2, 0, 2],
            [1, 0, 0], [0, 1, 0], [3, 2, 0], [0, 3, 0]
          ];
          var _mix = _MIXES[_pi % _MIXES.length];
          if (config && config.mixStruct !== false) {
            if (config.capTie) {
              // 【v275】capTie 已解决"车太小"根因；再叠 lag/capSeq 反而更差（58%→26%）
              var _PERC3 = [2.0, 1.8, 2.2, 2.5, 1.6, 2.4, 2.0, 1.9];
              _cfg.fillLag = 0; _cfg.capSeqBoost = 0; _cfg.chunkCut = 0;
              _cfg.capPerColor = _PERC3[_pi % _PERC3.length];
              // 【v294·用户裁决】逐行铺 + 晚熟色前排：进组合轮换，0=纯需求序 / 1=仅第0行 / 2=前两行
              var _RM = [1, 2, 0, 1, 2, 0, 1, 2][_pi % 8];
              _cfg.rowMajorMix = _RM > 0;
              _cfg.freePerRow = (_RM === 1 ? 2 : 3);
              _cfg.mixRows = (_RM === 1 ? 1 : 2);
            } else {
              _cfg.fillLag = _mix[0];
              _cfg.capSeqBoost = _mix[1];
              _cfg.chunkCut = _mix[2];
            }
          }
          var _vseq = [[1.00, 2, 3], [1.06, 2, 4], [0.94, 3, 3], [1.12, 2, 5]][_pi % 4];
          var _bmin0 = parseInt(_cfg.boxSizeMin, 10) || 33;
          var _bmax0 = parseInt(_cfg.boxSizeMax, 10) || 39;
          // 【v313·用户裁决】变体只允许把下限放大，绝不允许压低。
          // 【v330·用户裁决】上限也不许被缩放越过：1.06 档会把 70 变成 74，
          //   而 normalizeCapacities 看到 74 > 上限 70 就"对半拆成 37/37" →
          //   整盘 43 辆车里 26 辆都是 37，一辆 50 以上都没有（用户："怎么大色块没有到 70 的"）。
          //   现在：用户填了区间就**原样用**，不再乘系数；多样性交给结构组合（mix/冰/冰值）。
          var _uMin = parseInt(config.boxSizeMin, 10) || 0;
          var _uMax = parseInt(config.boxSizeMax, 10) || 0;
          if (_uMin > 0 && _uMax > 0) {
            _cfg.boxSizeMin = _uMin;
            _cfg.boxSizeMax = Math.max(_uMin + 1, _uMax);
          } else {
            _cfg.boxSizeMin = Math.max(14, Math.round(_bmin0 * _vseq[0]));
            _cfg.boxSizeMax = Math.max(_cfg.boxSizeMin + 4, Math.round(_bmax0 * _vseq[0]));
          }
          // v284：冰的块数与时长取"配置值与变体值的较大者"，否则每次尝试的变体会把 app 的加强覆盖回去
          _cfg.iceScheduleCount = Math.max(parseInt(config.iceScheduleCount,10)||3, _vseq[1]);
          _cfg.iceScheduleDelay = Math.max(parseInt(config.iceScheduleDelay,10)||7, _vseq[2]);
          _cfg._attemptVariant = { capScale: _vseq[0], iceCount: _vseq[1], iceDelay: _vseq[2] };
          _cfg._mixTag = config && config.capTie ? ('capTie/' + _cfg.capPerColor) : _mix.join('/');
        }
        if (config && config.seed != null && !isNaN(+config.seed)) _cfg.seed = (+config.seed) + _pi;
        // 【v413】障碍参数变体：冰值力度 / 链条数 / 管道数轮换，交给 portfolio 评估选
        _cfg.iceForceSteps = [0, 2, 4][_pi % 3];
        _cfg.chainByDemand = [2, 4][_pi % 2];
        _cfg.maxPipes = [1, 2][_pi % 2];
        _cfg._traceRound = _pi + 1;
        reportProgress({ phase: 'roundStart', round: _pi + 1, N: _pk, tag: _cfg._mixTag || '-', cut: _cfg.cutMode || 'auto', ice: _cfg.iceForceSteps, chain: _cfg.chainByDemand, pipes: _cfg.maxPipes });
        var _o = flow === 'old' ? produce(blocks, _cfg) : produceFixed(blocks, _cfg, opts);
        try {
          var _pf = _o && _o.goodV3 && _o.goodV3.fillCurve, _pp = _o && _o.goodV3 && _o.goodV3.persist, _qq = _pp && _pp.quality;
          reportProgress({ phase: 'roundDone', round: _pi + 1, N: _pk, valid: !!(_o && _o.level),
            first: (_pp && _pp.playerPassPct != null) ? _pp.playerPassPct : null,
            T: (_qq && _qq.T != null) ? _qq.T : null,
            freeLow: (_pf && _pf.freeLowPct != null) ? _pf.freeLowPct : null,
            pressure: (_pf && _pf.pressurePct3 != null) ? _pf.pressurePct3 : null });
        } catch (e) { }
        if (config._trace) { try { config._trace.push({ t: 'round', round: _pi + 1, mix: _cfg._mixTag || '-', cap: [_cfg.boxSizeMin, _cfg.boxSizeMax], ok: !!(_o && _o.level) }); } catch (e) { } }
        // 【v405】ABC 三个基底各自修复：前 p7BaseCount 轮在比较前先跑 A1→A2→A3→A4
        if (_o && _o.level && config && config.p7Repair && _pi < (parseInt(config.p7BaseCount, 10) || 3)) {
          try {
            var _p7b = p7RepairLevel(_o.level, config);
            if (_p7b && _p7b.level && _p7b.valid) {
              _o.level = _p7b.level; _o.solveResult = _p7b.solveResult; _o.audit = _p7b.audit;
              _o.goodV3 = _p7b.goodV3; _o.valid = true; _o.p7 = _p7b.p7;
            } else if (_p7b && _p7b.p7) { _o.p7 = _p7b.p7; }
          } catch (e) { _o.p7 = { error: String(e && e.message || e) }; }
        }
        _tried++;
        var _t = portfolioTuple(_o);
        if (_o && _o.goodV3 && _o.goodV3.pass) _passes++;
        if (_o && (!_best || portfolioBetter(_t, _bestT))) { _best = _o; _bestT = _t; }
        if (!config._attemptLog) config._attemptLog = [];
        config._attemptLog.push({ dim: _cfg.boardRowsMax + 'x' + _cfg.boardColsMax, mix: _cfg._mixTag || '-', ok: !!( _o && _o.level), cov: (_o && _o.goodV3 && _o.goodV3.persist) ? _o.goodV3.persist.band3Pct : null });
        if (_best && meetsEarlyStopQuality(_best, config)) break;   // 【v257】到带中段才早停
      }
      out = _best;
      if (out) out.portfolio = { K: _pk, tried: _tried, passes: _passes, tuple: _bestT };
      // 【v242】带外纠偏一次（只在这里触发，不在每个候选里跑，避免 ×8 的成本）
      if (out) { try { out = bandFixOnce(out, blocks, config); } catch (e) {} }
      // 【v250·保底】全灭时再试一档"宽松盘"：用户明确「黑块不是不许存在，可以配合管道」。
      //   宽松档 = 填满率 0.80（留 20% 给墙+管道）+ 管道最多 2 条/深度 6 + 只要求可解。
      //   目的不是出好关，是"至少有一关可玩"，避免整张图白跑。
      if (!out || !out.level) {
        try {
          var _fr2 = 0.80;
          var _rr2 = parseInt(config.boardRowsMax, 10) || 7;
          var _cc2 = parseInt(config.boardColsMax, 10) || 8;
          var _cells2 = _rr2 * _cc2;
          var _px2 = 0;
          for (var _r2 = 0; _r2 < blocks.length; _r2++)
            for (var _c2 = 0; _c2 < blocks[_r2].length; _c2++) if (blocks[_r2][_c2] > 0) _px2++;
          var _cars2 = Math.max(4, Math.round(_cells2 * _fr2));
          var _cap2 = Math.max(14, Math.round(_px2 / Math.max(1, _cars2)));
          var safeCfg = Object.assign({}, config, {
            boardHardRange: true, boardAuto: false,
            boardRowsMin: _rr2, boardRowsMax: _rr2, boardColsMin: _cc2, boardColsMax: _cc2,
            targetCarCount: (config.generatorFlow === 'old') ? 0 : _cars2,   // 【v314】旧流程不拆车
            // 【v306·用户裁决】兜底也不能无视用户设的球容量：有就用用户的，没有才按密度算。
            //   之前这里写死 max(14, px/cars*0.9)，所以兜底关会出现 14~20 的小车。
            boxSizeMin: (config.boxSizeMin != null ? +config.boxSizeMin : Math.max(14, Math.round(_cap2 * 0.9))),
            boxSizeMax: (config.boxSizeMax != null ? +config.boxSizeMax : Math.max(Math.max(14, Math.round(_cap2 * 0.9)) + 6, Math.round(_cap2 * 1.1))),
            usableSpaceTarget: _fr2,
            minPipes: 0, maxPipes: 2, pipeMaxDepth: 4, pipeMinFill: 2,
            portfolioK: 1, candidateCount: 1, difficultyRounds: 1,
            acceptMode: 'solvable', goodV3: false, requireHardPass: false,
            designSweep: false, designDebt: false, targetSweep: false,
            timeBudgetMs: Math.min(20000, (config.timeBudgetMs || 25000))
          });
          var safe = null;
          try { safe = runFlowOnce(blocks, safeCfg, {}); } catch (e) { safe = null; }   // 【v314】兜底也走当前产线
          if (safe && safe.level) {
            safe.safeFallback = { fill: _fr2, cars: _cars2, cap: _cap2, pipes: 2, note: '全灭兜底：宽松盘（允许墙+2条管道）' };
            out = safe;
          }
        } catch (e) { /* 兜底也失败就保持全灭 */ }
      }
    }
    // 唯一出口处统一标记本关的【目标图入口模式】，供批次记录 / CSV / 生产报告识别。
    // 只写在生产侧结果对象上，【不写入关卡本体】——关卡 JSON 协议保持不变(用户决定 D1)。
    // 三种模式互斥，出口只打一个标记（需求 §九：至少能区分原四方向 / 底部消除 / 四方向瞬时连锁）。
    if (out && config && config._trace && config._trace.length) { try { out.trace = config._trace; } catch (e) { } }
    if (out && !out.entryMode) {
      out.entryMode = (config && config.instantChain) ? 'fourSideInstantChain'
        : ((config && config.bottomOnly) ? 'bottomOnly' : 'fourSide');
    }
    // 【v403·A3d】切法层修复：如果 freePct 仍高，换一种切法重生成一次，再比较。
    if (out && out.level && config && config.p7Repair && !config._a3dTried && _pdLeft() > 25000) {
      var _fc0 = out.goodV3 && out.goodV3.fillCurve;
      var _fp0 = _fc0 ? _fc0.freePct : null;
      if (_fp0 != null && _fp0 > 50) {
        try {
          var _curCut = (out.config && out.config.cutMode) || 'layerCut2';
          var _altCut = (_curCut === 'exposeCut') ? 'layerCut2' : 'exposeCut';
          var _a3dCfg = Object.assign({}, config, {
            cutMode: _altCut, portfolioK: 1, candidateCount: 1,
            p7Repair: false, trapPost: false, _a3dTried: true
          });
          var _alt = runFlowOnce(blocks, _a3dCfg, {});
          var _afc = _alt && _alt.goodV3 && _alt.goodV3.fillCurve;
          var _afp = _afc ? _afc.freePct : null;
          if (_alt && _alt.level && _afp != null && _afp <= _fp0 - 5) {
            out = _alt;
            out.a3d = { fromCut: _curCut, toCut: _altCut, fromFreePct: _fp0, toFreePct: _afp };
          } else {
            out.a3d = { tried: true, fromCut: _curCut, toCut: _altCut, fromFreePct: _fp0, toFreePct: _afp };
          }
        } catch (e) { out.a3d = { error: String(e && e.message || e) }; }
      }
    }
    // 【v396·P7 接入】失败原因驱动修复：先 diagno se，主因 J>20% 时只修管道公平性（A→A1→A2→A3 串行）。
    if (out && out.level && config && !out.readyStats) {
      try { out.readyStats = sampleReadyStats(out.level, config, 5); } catch (e) { out.readyStats = null; }
    }
    if (out && config && out.readyStats) config._readyStats = out.readyStats;
    if (out && out.level && config && config.p7Repair && _pdLeft() > 15000) {
      config._repairDeadline = _pdT0 + _pdBudget - 8000;
      try {
        var _p7 = p7RepairLevel(out.level, config);
        if (_p7 && _p7.level && _p7.valid) {
          out.level = _p7.level; out.solveResult = _p7.solveResult; out.audit = _p7.audit;
          out.goodV3 = _p7.goodV3; out.valid = true; out.p7 = _p7.p7;
        } else if (_p7 && _p7.p7) {
          out.p7 = _p7.p7;
        }
      } catch (e) { out.p7 = { error: String(e && e.message || e) }; }
    }
    // 【v377·P3 接入】生成后陷阱后处理：只对最终关、首通 20~80% 的基准跑；
    //   命中才替换，替换后用 evaluateLevel 重算 solve/audit/goodV3，绝不沿用旧指标。
    if (out && out.level && config && config.trapPost && _pdLeft() > 12000) {
      var _t0 = Date.now();
      var _fcB = out.goodV3 && out.goodV3.fillCurve;
      var _qB = out.goodV3 && out.goodV3.persist && out.goodV3.persist.quality;
      try {
        var _tp = trapPostProcess(out.level, config);
        if (_tp && _tp.level) {
          var _ev = evaluateLevel(_tp.level, config);
          if (_ev && _ev.valid && _ev.goodV3) {
            var _fcA = _ev.goodV3.fillCurve, _qA = _ev.goodV3.persist && _ev.goodV3.persist.quality;
            // 【v404】trapPost 不能把“免费步/压力”修坏：free 变多或 T/R 掉 >5 就拒绝
            var _bad = false;
            if (_fcB && _fcA) {
              if (_fcA.freePct != null && _fcB.freePct != null && _fcA.freePct > _fcB.freePct + 5) _bad = true;
              if (_fcA.freeRunMax != null && _fcB.freeRunMax != null && _fcA.freeRunMax > _fcB.freeRunMax + 2) _bad = true;
            }
            if (_qB && _qA) {
              if (_qA.T != null && _qB.T != null && _qA.T < _qB.T - 5) _bad = true;
              if (_qA.R != null && _qB.R != null && _qA.R < _qB.R - 5) _bad = true;
            }
            if (_bad) {
              out.trapPost = { applied: false, reason: 'free/T guard', ms: Date.now() - _t0 };
            } else {
              out.level = _ev.level; out.solveResult = _ev.solveResult; out.audit = _ev.audit;
              out.goodV3 = _ev.goodV3; out.valid = true;
              out.trapPost = { applied: true, ms: Date.now() - _t0, stats: _tp.stats };
            }
          } else {
            out.trapPost = { applied: false, reason: 're-eval failed', ms: Date.now() - _t0 };
          }
        } else {
          out.trapPost = { applied: false, reason: (_tp && _tp.reason) || 'no hit', ms: Date.now() - _t0 };
        }
      } catch (e) {
        out.trapPost = { applied: false, error: String(e && e.message || e), ms: Date.now() - _t0 };
      }
    }
    if (out && out.level && config && config.readyStats !== false) {
      try { out.readyStats = sampleReadyStats(out.level, config, 5); } catch (e) { out.readyStats = null; }
    }
    return out;
  }

  // ==================== 【v377·P3 接入】生成后陷阱后处理 ====================
  //   只对最终关、首通 20~80% 的基准跑；最多 20 个交换/同色偏斜变异；
  //   命中才替换，替换后用 evaluateLevel 重算 solve/audit/goodV3（不沿用旧指标）。
  function evalTrapLevel(level, config) {
    var parsed;
    try { parsed = AntSolver.parseLevel(level); } catch (e) { return null; }
    var sr;
    try {
      sr = AntSolver.Solver.solve(parsed, {
        timeBudgetMs: 1200, bottomOnly: !!config.bottomOnly, instantChain: !!config.instantChain
      });
    } catch (e) { return null; }
    if (!sr || !sr.completed) return null;
    var runs = [], thr = [0.3, 0.45, 0.6, 0.75, 0.9];
    for (var ti = 0; ti < thr.length; ti++) for (var si = 0; si < 2; si++) {
      try {
        runs.push(AntSolver.PlayerSim.run(parsed, {
          pickThreshold: thr[ti], seed: 101 + si * 37, useItems: false, reviveCap: 0,
          bottomOnly: !!config.bottomOnly, instantChain: !!config.instantChain, capturePreviewStats: false
        }));
      } catch (e) { runs.push(null); }
    }
    var ok = runs.filter(Boolean);
    if (!ok.length) return null;
    var first = Math.round(ok.filter(function (r) { return r.won; }).length / ok.length * 100);
    var lw = 0, lr = 0;
    for (var ri = 0; ri < ok.length; ri++) {
      var r0 = ok[ri]; lr++;
      if (r0.won) { lw++; continue; }
      var bl = r0.lastBlocked || r0.lastRefuse, avoid = (bl && bl.color != null) ? bl.color : null, won = false;
      for (var at = 1; at <= 2; at++) {
        try {
          var rr = AntSolver.PlayerSim.run(parsed, {
            pickThreshold: 0.6 + (at === 1 ? 0.15 : -0.15), seed: 500 + at * 97,
            useItems: false, reviveCap: 0, bottomOnly: !!config.bottomOnly,
            instantChain: !!config.instantChain, capturePreviewStats: false, avoidColor: avoid
          });
          if (rr && rr.won) { won = true; break; }
          var b2 = rr && (rr.lastBlocked || rr.lastRefuse);
          if (b2 && b2.color != null) avoid = b2.color;
        } catch (e) { }
      }
      if (won) lw++;
    }
    var learned = Math.round(lw / lr * 100);
    var lookW = 0;
    for (var li = 0; li < 2; li++) {
      try {
        var lr2 = AntSolver.PlayerSim.run(parsed, {
          pickThreshold: 0.6, seed: 401 + li * 97, useItems: false, reviveCap: 0,
          bottomOnly: !!config.bottomOnly, instantChain: !!config.instantChain,
          capturePreviewStats: false, lookahead2: true, lookaheadLimit: 6
        });
        if (lr2 && lr2.won) lookW++;
      } catch (e) { }
    }
    var look = Math.round(lookW / 2 * 100);
    var best = ok.reduce(function (a, b) {
      return ((b.won && !a.won) || (b.won === a.won && (b.progress || 0) > (a.progress || 0))) ? b : a;
    }, ok[0]);
    var bestProg = best ? (best.progress || 0) : 0;
    var avg = ok.reduce(function (s, r) { return s + (r.progress || 0); }, 0) / ok.length;
    var R = Math.max(0, Math.round(bestProg - avg));
    var picked = {}, pickedN = 0;
    for (var pi = 0; pi < ok.length; pi++) {
      var po = ok[pi].pickOrder || [];
      for (var pj = 0; pj < po.length; pj++) {
        var k = po[pj].r + ',' + po[pj].c;
        if (!picked[k]) { picked[k] = 1; pickedN++; }
      }
    }
    var U = parsed.totalBoxes ? Math.max(0, Math.min(100, Math.round((1 - pickedN / parsed.totalBoxes) * 100))) : null;
    var fill = null;
    try { fill = choiceCurve(parsed, sr); } catch (e) { }
    var dec = (fill && fill.steps) ? fill.steps.filter(function (x) { return x.full >= 2; }).length : 0;
    var traps = {};
    if (best && best.won) {
      for (var xi = 0; xi < ok.length; xi++) {
        if (ok[xi].won) continue;
        var bp = best.pickOrder || [], rp = ok[xi].pickOrder || [], n = Math.min(bp.length, rp.length);
        for (var yi = 0; yi < n; yi++) {
          if (bp[yi].r !== rp[yi].r || bp[yi].c !== rp[yi].c) {
            traps[bp[yi].step != null ? bp[yi].step : yi] = 1; break;
          }
        }
      }
    }
    var trapN = 0; for (var tk in traps) trapN++;
    var T = dec > 0 && best && best.won ? Math.round(trapN / dec * 100) : 0;
    return { first: first, learned: learned, look: look, T: T, R: R, U: U, bestProg: bestProg, dec: dec, po: sr.pickOrder };
  }

  function evaluateLevel(level, config) {
    var parsed;
    try { parsed = AntSolver.parseLevel(level); } catch (e) { return null; }
    var sr;
    try {
      sr = AntSolver.Solver.solve(parsed, {
        timeBudgetMs: (config && config.trapEvalMs) || 1500,
        bottomOnly: !!(config && config.bottomOnly), instantChain: !!(config && config.instantChain)
      });
    } catch (e) { return null; }
    if (!sr || !sr.completed) return null;
    var audit = null;
    try {
      audit = AntSolver.Analysis.chokepointAudit(sr.pressureSamples || [], parsed.totalBoxes, level.bufferLimit);
    } catch (e) { audit = null; }
    var cand = { level: level, config: config || {}, solveResult: sr, audit: audit, generationEval: null, valid: true };
    var gv = null;
    try { gv = goodV3Of(cand); } catch (e) { gv = null; }
    return { level: level, solveResult: sr, audit: audit, goodV3: gv, valid: true };
  }

  /**
   * P7 v1：失败原因驱动的修复分支（A→A1→A2→A3）
   *   - 只修主因 hidden（J>20%）：把管道里的车合并到同色上盘车，减少隐藏信息；
   *   - 每次修复重算 evaluateLevel，J 不降就回退；
   *   - ABC 基底并行留给上层，本函数只负责一个分支的串行修复。
   */
  function p7DiagnoseEv(ev) {
    if (!ev || !ev.goodV3 || !ev.goodV3.persist) return null;
    var p = ev.goodV3.persist, q = p.quality || {};
    // J = 管道/问号死亡占比（与 app 的 _hidden0 同口径）
    var dc = p.deathCauses || {}, dt = 0, dh = 0;
    for (var dk in dc) { dt += dc[dk]; if (dk === '管道' || dk === '问号') dh += dc[dk]; }
    var J = dt ? Math.round(dh / dt * 100) : null;
    var T = (q.T != null) ? q.T : null, R = (q.R != null) ? q.R : null;
    var fc = ev.goodV3.fillCurve || {};
    var freePct = (fc.freePct != null) ? fc.freePct : null;
    var freeRunMax = (fc.freeRunMax != null) ? fc.freeRunMax : null;
    var freeLowPct = (fc.freeLowPct != null) ? fc.freeLowPct : null;
    var misplacedFreePct = (fc.misplacedFreePct != null) ? fc.misplacedFreePct : null;
    var pressurePct3 = (fc.pressurePct3 != null) ? fc.pressurePct3 : null;
    var pressurePeak = (fc.pressurePeak != null) ? fc.pressurePeak : null;
    var wLow = (fc.lowPct != null) ? fc.lowPct : null;
    var partialStepPct = (fc.partialStepPct != null) ? fc.partialStepPct : null;
    var fullMedian2 = (fc.fullMedian2 != null) ? fc.fullMedian2 : null;
    var selectMedian = (fc.selectMedian != null) ? fc.selectMedian : null;
    var earlyFree10 = (fc.earlyFree10 != null) ? fc.earlyFree10 : null;
    var earlyPeak10 = (fc.earlyPeak10 != null) ? fc.earlyPeak10 : null;
    var cause = null;
    if (J != null && J > 20) cause = 'hidden';
    // 【v452·用户裁决】不搞学习：learned/look 不再触发 black，A4 不跑
    else if ((earlyFree10 != null && earlyFree10 > 4) || (earlyPeak10 != null && earlyPeak10 < 3)) cause = 'early';
    else if (T != null && T < 10) cause = 'flat';
    else if (R != null && R < 15) cause = 'flat';
    else if (wLow != null && wLow > 35) cause = 'flat';
    else if (freePct != null && freePct > 50) cause = 'free';
    else if (freeRunMax != null && freeRunMax > 6) cause = 'free';
    return { J: J, T: T, R: R, freePct: freePct, freeRunMax: freeRunMax,
      learned: p.learnedPassPct, look: p.lookaheadPassPct,
      freeLowPct: freeLowPct, misplacedFreePct: misplacedFreePct, pressurePct3: pressurePct3, pressurePeak: pressurePeak, wLow: wLow,
      partialStepPct: partialStepPct, fullMedian2: fullMedian2, selectMedian: selectMedian,
      earlyFree10: earlyFree10, earlyPeak10: earlyPeak10,
      first: p.playerPassPct, pass: !!ev.goodV3.pass, cause: cause };
  }

  function p7PipeFairness(level, config) {
    var best = null, bestJ = null, evals = 0;
    var maxCap = parseInt(config && config.boxSizeMax, 10) || 60;
    for (var r = 0; r < level.board.rows; r++) {
      for (var c = 0; c < level.board.cols; c++) {
        var cell = level.board.cells[r] && level.board.cells[r][c];
        if (!cell || cell.t !== 'pipe' || !cell.queue || !cell.queue.length) continue;
        for (var qi = 0; qi < cell.queue.length; qi++) {
          var pc = cell.queue[qi];
          // 找同色上盘车，合并后不超容量上限
          for (var br = 0; br < level.board.rows; br++) {
            for (var bc = 0; bc < level.board.cols; bc++) {
              var bx = level.board.cells[br] && level.board.cells[br][bc];
              if (!bx || bx.t !== 'box' || bx.color !== pc.color) continue;
              if ((bx.count || 0) + (pc.count || 0) > maxCap) continue;
              var lv = JSON.parse(JSON.stringify(level));
              var pipe2 = lv.board.cells[r][c];
              var car = pipe2.queue.splice(qi, 1)[0];
              var target = lv.board.cells[br][bc];
              target.count += car.count;
              if (!pipe2.queue.length) { pipe2.t = 'black'; delete pipe2.queue; }
              if (evals >= 6) return best ? { level: best, J: bestJ } : null;
              evals++;
              var ev = null;
              try { ev = evaluateLevel(lv, config); } catch (e) { }
              var d = p7DiagnoseEv(ev);
              if (!d || d.J == null) continue;
              if (best == null || d.J < bestJ) { best = lv; bestJ = d.J; }
              break; // 同一管道车只试一个上盘目标
            }
            if (best && best !== level && bestJ != null && bestJ <= 0) break;
          }
        }
      }
    }
    // 【v412】A1b：换位暴露——管道车和盘上车交换，不改总数，只让危险车可见
    if (evals < 6) {
      for (var pr2 = 0; pr2 < level.board.rows && evals < 6; pr2++) {
        for (var pc2 = 0; pc2 < level.board.cols && evals < 6; pc2++) {
          var pipeC = level.board.cells[pr2] && level.board.cells[pr2][pc2];
          if (!pipeC || pipeC.t !== 'pipe' || !pipeC.queue || !pipeC.queue.length) continue;
          for (var q2 = 0; q2 < pipeC.queue.length && evals < 6; q2++) {
            var pcar = pipeC.queue[q2];
            var bcar = null, bpos = null;
            for (var br2 = 0; br2 < level.board.rows && !bcar; br2++) {
              for (var bc2 = 0; bc2 < level.board.cols; bc2++) {
                var bx2 = level.board.cells[br2] && level.board.cells[br2][bc2];
                if (bx2 && bx2.t === 'box' && !bx2.chain && !bx2.numice && !bx2.q) { bcar = bx2; bpos = [br2, bc2]; break; }
              }
            }
            if (!bcar) continue;
            var lv3 = JSON.parse(JSON.stringify(level));
            lv3.board.cells[pr2][pc2].queue[q2] = { color: bcar.color, count: bcar.count };
            lv3.board.cells[bpos[0]][bpos[1]] = { t: 'box', color: pcar.color, count: pcar.count, chain: 0, q: false, numice: 0 };
            evals++;
            var ev3 = null;
            try { ev3 = evaluateLevel(lv3, config); } catch (e) { }
            var d3x = p7DiagnoseEv(ev3);
            if (!d3x || d3x.J == null) continue;
            if (best == null || d3x.J < bestJ) { best = lv3; bestJ = d3x.J; }
          }
        }
      }
    }
    return best ? { level: best, J: bestJ } : null;
  }

  // P7-A3：收紧开局——前 20% 的早熟免费车加冰/链/换深
  function p7TightenOpening(level, config, ev) {
    var steps = ev && ev.goodV3 && ev.goodV3.fillCurve && ev.goodV3.fillCurve.steps;
    if (!steps || !steps.length) return null;
    var best = null, bestScore = null, evals = 0;
    var maxCap = parseInt(config && config.boxSizeMax, 10) || 60;
    function plainCell(lv, r, c) {
      var x = lv.board.cells[r] && lv.board.cells[r][c];
      return x && x.t === 'box' && !x.chain && !x.numice && !x.q;
    }
    function scoreOf(ev2) {
      var fc = ev2 && ev2.goodV3 && ev2.goodV3.fillCurve;
      if (!fc) return null;
      return { freePct: fc.freePct, freeRunMax: fc.freeRunMax };
    }
    var tries = 0;
    for (var si = 0; si < steps.length && tries < 4; si++) {
      var st = steps[si];
      if (!(st.prog <= 0.50 && st.full >= 2 && st.free >= 3)) continue;   // v408：免费步不一定在开局，前50%都可修
      var cands = (st.moves || []).filter(function (m) { return m.full; });
      if (st.pick && plainCell(level, st.pick.r, st.pick.c)) cands.push(st.pick);
      for (var ci = 0; ci < cands.length && tries < 4; ci++) {
        var cd = cands[ci];
        if (!plainCell(level, cd.r, cd.c)) continue;
        tries++;
        // 变体 1：早熟车加冰
        var lv1 = JSON.parse(JSON.stringify(level));
        lv1.board.cells[cd.r][cd.c].numice = 2;
        var ev1 = null;
        try { ev1 = evaluateLevel(lv1, config); } catch (e) { }
        var sc1 = scoreOf(ev1);
        if (sc1 && (bestScore == null || sc1.freePct < bestScore.freePct)) { best = lv1; bestScore = sc1; }
        // 变体 1b：只加 1 层冰（更温和）
        var lv1b = JSON.parse(JSON.stringify(level));
        lv1b.board.cells[cd.r][cd.c].numice = 1;
        var ev1b = null;
        try { ev1b = evaluateLevel(lv1b, config); } catch (e) { }
        var sc1b = scoreOf(ev1b);
        if (sc1b && (bestScore == null || sc1b.freePct < bestScore.freePct)) { best = lv1b; bestScore = sc1b; }
        // 变体 1c：换深——早熟免费车和 40~65% 的债务车交换位置
        var deepCands = [];
        for (var sj = 0; sj < steps.length; sj++) {
          var sd = steps[sj];
          if (!(sd.prog >= 0.40 && sd.prog <= 0.65)) continue;
          var dcs = (sd.moves || []).filter(function (m) { return m.full; });
          if (sd.pick && plainCell(level, sd.pick.r, sd.pick.c)) dcs.push(sd.pick);
          for (var dj = 0; dj < dcs.length; dj++) deepCands.push(dcs[dj]);
        }
        if (deepCands.length && evals < 5) {
          var dsel = deepCands[0];
          for (var dk = 1; dk < deepCands.length; dk++) {
            if ((deepCands[dk].count || 0) > (dsel.count || 0)) dsel = deepCands[dk];
          }
          if (dsel.r !== cd.r || dsel.c !== cd.c) {
            var lv1c = JSON.parse(JSON.stringify(level));
            var ca = lv1c.board.cells[cd.r][cd.c];
            var cb = lv1c.board.cells[dsel.r][dsel.c];
            lv1c.board.cells[cd.r][cd.c] = cb;
            lv1c.board.cells[dsel.r][dsel.c] = ca;
            evals++;
            var ev1c = null;
            try { ev1c = evaluateLevel(lv1c, config); } catch (e) { }
            var sc1c = scoreOf(ev1c);
            if (sc1c && (bestScore == null || sc1c.freePct < bestScore.freePct)) { best = lv1c; bestScore = sc1c; }
          }
        }
        // 变体 2：早熟车加链
        for (var dr2 = 0; dr2 <= 1; dr2++) for (var dc2 = -1; dc2 <= 1; dc2++) {
          if (dr2 === 0 && dc2 <= 0) continue;
          var nr2 = cd.r + dr2, nc2 = cd.c + dc2;
          if (!plainCell(level, nr2, nc2)) continue;
          if (evals >= 5) break;
          var lv2 = JSON.parse(JSON.stringify(level));
          var maxCh = 0;
          for (var rr2 = 0; rr2 < lv2.board.rows; rr2++) for (var cc2 = 0; cc2 < lv2.board.cols; cc2++) {
            var xx2 = lv2.board.cells[rr2] && lv2.board.cells[rr2][cc2];
            if (xx2 && xx2.chain > maxCh) maxCh = xx2.chain;
          }
          lv2.board.cells[cd.r][cd.c].chain = maxCh + 1;
          lv2.board.cells[nr2][nc2].chain = maxCh + 1;
          evals++;
          var ev2 = null;
          try { ev2 = evaluateLevel(lv2, config); } catch (e) { }
          var sc2 = scoreOf(ev2);
          if (sc2 && (bestScore == null || sc2.freePct < bestScore.freePct)) { best = lv2; bestScore = sc2; }
        }
      }
    }
    return best ? { level: best, freePct: bestScore.freePct, freeRunMax: bestScore.freeRunMax } : null;
  }

  // P7-A3b：开局供给结构——交换 2 组早熟免费车与 20~45% 债务车
  function p7SupplyStructure(level, config, ev) {
    var steps = ev && ev.goodV3 && ev.goodV3.fillCurve && ev.goodV3.fillCurve.steps;
    if (!steps || !steps.length) return null;
    function plain(r, c) {
      var x = level.board.cells[r] && level.board.cells[r][c];
      return x && x.t === 'box' && !x.chain && !x.numice && !x.q;
    }
    var early = [], deep = [], seenE = {}, seenD = {};
    for (var i = 0; i < steps.length; i++) {
      var st = steps[i];
      var cands = (st.moves || []).filter(function (m) { return m.full; });
      if (st.pick && plain(st.pick.r, st.pick.c)) cands.push(st.pick);
      for (var j = 0; j < cands.length; j++) {
        var m = cands[j];
        if (!plain(m.r, m.c)) continue;
        var key = m.r + ',' + m.c;
        if (st.prog <= 0.18 && st.full >= 2 && st.free >= 3 && !seenE[key]) { seenE[key] = 1; early.push(m); }
        if (st.prog >= 0.22 && st.prog <= 0.45 && !seenD[key]) { seenD[key] = 1; deep.push(m); }
      }
    }
    if (early.length < 2 || deep.length < 2) return null;
    deep.sort(function (a, b) { return (b.count || 0) - (a.count || 0); });
    var lv = JSON.parse(JSON.stringify(level));
    var used = {}, pairs = 0;
    for (var ei = 0; ei < early.length && pairs < 2; ei++) {
      var e = early[ei];
      if (used[e.r + ',' + e.c]) continue;
      for (var di = 0; di < deep.length; di++) {
        var d = deep[di];
        if (used[d.r + ',' + d.c] || (d.r === e.r && d.c === e.c)) continue;
        var ca = lv.board.cells[e.r][e.c], cb = lv.board.cells[d.r][d.c];
        if (!ca || !cb || ca.t !== 'box' || cb.t !== 'box') continue;
        lv.board.cells[e.r][e.c] = cb;
        lv.board.cells[d.r][d.c] = ca;
        used[e.r + ',' + e.c] = 1; used[d.r + ',' + d.c] = 1; pairs++;
        break;
      }
    }
    if (!pairs) return null;
    var ev2 = null;
    try { ev2 = evaluateLevel(lv, config); } catch (e) { }
    var fc = ev2 && ev2.goodV3 && ev2.goodV3.fillCurve;
    if (!fc) return null;
    return { level: lv, freePct: fc.freePct, freeRunMax: fc.freeRunMax };
  }

  // P7-A3R：把“低缓冲白给车”挪到“高缓冲窗口”，不是冻掉
  function p7RelocateFree(level, config, ev) {
    var steps = ev && ev.goodV3 && ev.goodV3.fillCurve && ev.goodV3.fillCurve.steps;
    if (!steps || !steps.length) return null;
    function plain(r, c) {
      var x = level.board.cells[r] && level.board.cells[r][c];
      return x && x.t === 'box' && !x.chain && !x.numice && !x.q;
    }
    var low = [], high = [], seen = {};
    for (var i = 0; i < steps.length; i++) {
      var st = steps[i];
      var cands = (st.moves || []).filter(function (m) { return m.full; });
      if (st.pick && plain(st.pick.r, st.pick.c)) cands.push(st.pick);
      for (var j = 0; j < cands.length; j++) {
        var m = cands[j];
        if (!plain(m.r, m.c)) continue;
        var k = m.r + ',' + m.c;
        if (seen[k]) continue;
        if (st.full >= 2 && st.free >= 4 && low.length < 6) { seen[k] = 1; low.push(m); }
        if (st.free <= 2 && st.prog >= 0.20 && st.prog <= 0.65 && high.length < 8) { seen[k] = 1; high.push(m); }
      }
    }
    if (!low.length || !high.length) return null;
    high.sort(function (a, b) { return (b.count || 0) - (a.count || 0); });
    var best = null, bestScore = null;
    for (var li = 0; li < low.length && li < 3; li++) {
      for (var hi = 0; hi < high.length && hi < 3; hi++) {
        var a = low[li], b = high[hi];
        if (a.r === b.r && a.c === b.c) continue;
        var lv = JSON.parse(JSON.stringify(level));
        var ca = lv.board.cells[a.r][a.c], cb = lv.board.cells[b.r][b.c];
        if (!ca || !cb || ca.t !== 'box' || cb.t !== 'box') continue;
        lv.board.cells[a.r][a.c] = cb;
        lv.board.cells[b.r][b.c] = ca;
        var ev2 = null;
        try { ev2 = evaluateLevel(lv, config); } catch (e) { }
        if (!ev2 || !ev2.goodV3) continue;
        var fc = ev2.goodV3.fillCurve || {};
        var _pp = (ev2.goodV3.persist && ev2.goodV3.persist.playerPassPct != null) ? ev2.goodV3.persist.playerPassPct : 100;
        var sc = (100 - (fc.freeLowPct || 0)) + (fc.pressurePct3 || 0) * 2 + (fc.pressurePeak || 0) * 5 - _pp * 2;
        if (bestScore == null || sc > bestScore) {
          best = { level: lv, freeLowPct: fc.freeLowPct, pressurePct3: fc.pressurePct3, pressurePeak: fc.pressurePeak, misplacedFreePct: fc.misplacedFreePct, first: _pp };
          bestScore = sc;
        }
      }
    }
    return best;
  }

  // P7-A2：压力点岔路——在 35~70%、free≤1、full≥2 处加链/冰
  function p7ForceChoice(level, config, ev) {
    var steps = ev && ev.goodV3 && ev.goodV3.fillCurve && ev.goodV3.fillCurve.steps;
    if (!steps || !steps.length) return null;
    function plain(r, c) {
      var x = level.board.cells[r] && level.board.cells[r][c];
      return x && x.t === 'box' && !x.chain && !x.numice && !x.q;
    }
    var best = null, bestScore = null, tries = 0;
    for (var i = 0; i < steps.length && tries < 5; i++) {
      var st = steps[i];
      if (!(st.prog >= 0.20 && st.prog <= 0.75 && st.full >= 1)) continue;
      var cands = (st.moves || []).slice();
      if (st.pick && plain(st.pick.r, st.pick.c) && !cands.some(function (m) { return m.r === st.pick.r && m.c === st.pick.c; })) cands.push(st.pick);
      for (var ci = 0; ci < cands.length && tries < 5; ci++) {
        var cd = cands[ci];
        if (!plain(level, cd.r, cd.c)) continue;
        tries++;
        // 优先加链，找不到相邻盒再加冰
        var pair = null;
        for (var dr = 0; dr <= 1 && !pair; dr++) for (var dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc <= 0) continue;
          var nr = cd.r + dr, nc = cd.c + dc;
          if (plain(level, nr, nc)) { pair = [nr, nc]; break; }
        }
        var consider = function (lvx) {
          var ev2 = null;
          try { ev2 = evaluateLevel(lvx, config); } catch (e) { }
          if (!ev2 || !ev2.goodV3) return;
          var q = ev2.goodV3.persist && ev2.goodV3.persist.quality || {};
          var fc = ev2.goodV3.fillCurve || {};
          var _wl = fc.lowPct != null ? fc.lowPct : 50;
          var sc = (q.T || 0) * 2 + (q.R || 0) + (50 - _wl) * 0.8 - Math.max(0, (fc.freePct || 0) - 50) * 0.3;
          if (bestScore == null || sc > bestScore) {
            best = { level: lvx, T: q.T, R: q.R, freePct: fc.freePct, freeRunMax: fc.freeRunMax, wLow: fc.lowPct };
            bestScore = sc;
          }
        };
        // 先试最温和的冰1，链/冰2 可能直接把关打死
        var lvIce = JSON.parse(JSON.stringify(level));
        lvIce.board.cells[cd.r][cd.c].numice = 1;
        consider(lvIce);
        // 【v424】安全替代：和 35~65% 的深层车交换，不加障碍，通常不破坏可解
        var deepCell = null;
        for (var di2 = 0; di2 < steps.length && !deepCell; di2++) {
          var sd2 = steps[di2];
          if (!(sd2.prog >= 0.35 && sd2.prog <= 0.65)) continue;
          var dm = (sd2.moves || []).filter(function (m) {
            return plain(m.r, m.c) && !(m.r === cd.r && m.c === cd.c);
          });
          if (dm.length) deepCell = dm[0];
        }
        if (deepCell) {
          var lvSwap = JSON.parse(JSON.stringify(level));
          var ca2 = lvSwap.board.cells[cd.r][cd.c];
          var cb2 = lvSwap.board.cells[deepCell.r][deepCell.c];
          if (ca2 && cb2 && ca2.t === 'box' && cb2.t === 'box') {
            lvSwap.board.cells[cd.r][cd.c] = cb2;
            lvSwap.board.cells[deepCell.r][deepCell.c] = ca2;
            consider(lvSwap);
          }
        }
        var lv = JSON.parse(JSON.stringify(level));
        if (pair) {
          var maxCh = 0;
          for (var rr = 0; rr < lv.board.rows; rr++) for (var cc = 0; cc < lv.board.cols; cc++) {
            var xx = lv.board.cells[rr] && lv.board.cells[rr][cc];
            if (xx && xx.chain > maxCh) maxCh = xx.chain;
          }
          lv.board.cells[cd.r][cd.c].chain = maxCh + 1;
          lv.board.cells[pair[0]][pair[1]].chain = maxCh + 1;
        } else {
          lv.board.cells[cd.r][cd.c].numice = 2;
        }
        consider(lv);
      }
    }
    return best;
  }

  // P7-A4：太黑减负——拆一组链/一块冰
  // P7-A2c：partial 选项——把深层大车换到压力点，制造“能点但吃不满”
  function p7PartialChoice(level, config, ev) {
    var steps = ev && ev.goodV3 && ev.goodV3.fillCurve && ev.goodV3.fillCurve.steps;
    if (!steps || !steps.length) return null;
    function plain(r, c) {
      var x = level.board.cells[r] && level.board.cells[r][c];
      return x && x.t === 'box' && !x.chain && !x.numice && !x.q;
    }
    var pressure = [], deep = [];
    for (var i = 0; i < steps.length; i++) {
      var st = steps[i];
      if (st.prog >= 0.25 && st.prog <= 0.70 && st.full >= 1) {
        var cs = (st.moves || []).filter(function (m) { return plain(m.r, m.c); });
        if (!cs.length && st.pick && plain(st.pick.r, st.pick.c)) cs = [st.pick];
        for (var j = 0; j < cs.length; j++) pressure.push(cs[j]);
      }
      if (st.prog >= 0.40 && st.prog <= 0.70) {
        var ds = (st.moves || []).filter(function (m) { return plain(m.r, m.c); });
        for (var k = 0; k < ds.length; k++) deep.push(ds[k]);
      }
    }
    if (!pressure.length || !deep.length) return null;
    var _rs2 = (config && config._readyStats && config._readyStats.byCell) || {};
    deep.sort(function (a, b) {
      var _ra = _rs2[a.r + ',' + a.c] || {}, _rb = _rs2[b.r + ',' + b.c] || {};
      var _qa = (_ra.median != null ? _ra.median : 0.5) * 100 - (_ra.spread || 0) * 40;
      var _qb = (_rb.median != null ? _rb.median : 0.5) * 100 - (_rb.spread || 0) * 40;
      if (Math.abs(_qb - _qa) >= 5) return _qb - _qa;
      return (b.count || 0) - (a.count || 0);
    });
    var best = null, bestScore = -Infinity, tried = 0;
    for (var pi = 0; pi < pressure.length && tried < 3; pi++) {
      var p = pressure[pi];
      for (var di = 0; di < deep.length && tried < 3; di++) {
        var d = deep[di];
        if (p.r === d.r && p.c === d.c) continue;
        tried++;
        var lv = JSON.parse(JSON.stringify(level));
        var a = lv.board.cells[p.r][p.c], b = lv.board.cells[d.r][d.c];
        if (!a || !b || a.t !== 'box' || b.t !== 'box') continue;
        lv.board.cells[p.r][p.c] = b;
        lv.board.cells[d.r][d.c] = a;
        var ev2 = null;
        try { ev2 = evaluateLevel(lv, config); } catch (e) { }
        if (!ev2 || !ev2.goodV3) continue;
        var q = ev2.goodV3.persist && ev2.goodV3.persist.quality || {};
        var fc = ev2.goodV3.fillCurve || {};
        var sc = (fc.partialStepPct || 0) * 2 - (fc.fullMedian2 || 0) * 10 + (q.T || 0) + (q.R || 0) * 0.3;
        if (sc > bestScore) {
          best = { level: lv, T: q.T, R: q.R, partialStepPct: fc.partialStepPct, fullMedian2: fc.fullMedian2, wLow: fc.lowPct };
          bestScore = sc;
        }
      }
    }
    return best;
  }

  // P7-A2b：安全拆分——相邻同色两车合并再拆成 (sum-1,1)，不改总数，制造一个 1 块安全车
  function p7SafeSplit(level, config) {
    var best = null, bestScore = null, maxCap = parseInt(config && config.boxSizeMax, 10) || 60, tries = 0;
    function plain(r, c) {
      var x = level.board.cells[r] && level.board.cells[r][c];
      return x && x.t === 'box' && !x.chain && !x.numice && !x.q;
    }
    for (var r = 0; r < level.board.rows; r++) {
      for (var c = 0; c < level.board.cols; c++) {
        if (!plain(r, c) || tries >= 6) continue;
        var a = level.board.cells[r][c];
        var dirs = [[0, 1], [1, 0]];
        for (var di = 0; di < dirs.length; di++) {
          var nr = r + dirs[di][0], nc = c + dirs[di][1];
          if (!plain(nr, nc)) continue;
          var b = level.board.cells[nr][nc];
          if (b.color !== a.color) continue;
          var sum = (a.count || 0) + (b.count || 0);
          if (sum - 1 > maxCap) continue;
          tries++;
          var lv = JSON.parse(JSON.stringify(level));
          lv.board.cells[r][c].count = sum - 1;
          lv.board.cells[nr][nc].count = 1;
          var ev2 = null;
          try { ev2 = evaluateLevel(lv, config); } catch (e) { }
          if (!ev2 || !ev2.goodV3) continue;
          var q = ev2.goodV3.persist && ev2.goodV3.persist.quality || {}, fc = ev2.goodV3.fillCurve || {};
          var wl = fc.lowPct != null ? fc.lowPct : 50;
          var sc = (q.T || 0) * 2 + (q.R || 0) + (50 - wl) * 0.8;
          if (bestScore == null || sc > bestScore) {
            best = { level: lv, T: q.T, R: q.R, wLow: fc.lowPct, freePct: fc.freePct, freeRunMax: fc.freeRunMax };
            bestScore = sc;
          }
        }
      }
    }
    return best;
  }

  function p7Soften(level, config, ev) {
    var best = null, bestScore = null, tries = 0;
    for (var r = 0; r < level.board.rows; r++) {
      for (var c = 0; c < level.board.cols; c++) {
        var x = level.board.cells[r] && level.board.cells[r][c];
        if (!x || x.t !== 'box') continue;
        if (!(x.chain > 0 || x.numice > 0)) continue;
        if (tries >= 6) break;
        tries++;
        var lv = JSON.parse(JSON.stringify(level));
        var y = lv.board.cells[r][c];
        if (y.chain > 0) {
          var g = y.chain;
          for (var rr = 0; rr < lv.board.rows; rr++) for (var cc = 0; cc < lv.board.cols; cc++) {
            var z = lv.board.cells[rr] && lv.board.cells[rr][cc];
            if (z && z.chain === g) z.chain = 0;
          }
        } else { y.numice = 0; }
        var ev2 = null;
        try { ev2 = evaluateLevel(lv, config); } catch (e) { }
        if (!ev2 || !ev2.goodV3) continue;
        var p = ev2.goodV3.persist || {}, q = p.quality || {}, fc = ev2.goodV3.fillCurve || {};
        var sc = (p.learnedPassPct || 0) + (p.lookaheadPassPct || 0) * 0.5 + (q.T || 0) * 0.3;
        if (bestScore == null || sc > bestScore) {
          best = { level: lv, learned: p.learnedPassPct, look: p.lookaheadPassPct, T: q.T, R: q.R, freePct: fc.freePct };
          bestScore = sc;
        }
      }
    }
    return best;
  }

  // P7-A2E：前 10 步加压——把早期免费车和 40~70% 的大车交换，提升 earlyPeak10
  function p7EarlyPressure(level, config, ev) {
    var steps = ev && ev.goodV3 && ev.goodV3.fillCurve && ev.goodV3.fillCurve.steps;
    if (!steps || !steps.length) return null;
    function plain(r, c) {
      var x = level.board.cells[r] && level.board.cells[r][c];
      return x && x.t === 'box' && !x.chain && !x.numice && !x.q;
    }
    var early = [], deep = [];
    for (var i = 0; i < steps.length; i++) {
      var st = steps[i];
      if (i < 10 && st.free >= 3 && st.full >= 2) {
        var es = (st.moves || []).filter(function (m) { return plain(m.r, m.c); });
        if (st.pick && plain(st.pick.r, st.pick.c)) es.push(st.pick);
        for (var j = 0; j < es.length; j++) early.push(es[j]);
      }
      if (st.prog >= 0.40 && st.prog <= 0.70) {
        var ds = (st.moves || []).filter(function (m) { return plain(m.r, m.c); });
        for (var k = 0; k < ds.length; k++) deep.push(ds[k]);
      }
    }
    if (!early.length || !deep.length) return null;
    // 【v443】优先把“当前颜色还没露够”的车换到前期，才能顶高 earlyPeak
    var _exp = {};
    try {
      var _oe = openingExposure(level.blocks, level.board.rows, level.board.cols, false);
      if (_oe && _oe.detail) for (var _oi = 0; _oi < _oe.detail.length; _oi++) _exp[_oe.detail[_oi].color] = _oe.detail[_oi].px;
    } catch (e) { }
    var _rs = (config && config._readyStats && config._readyStats.byCell) || {};
    deep.sort(function (a, b) {
      var _ra = _rs[a.r + ',' + a.c] || {}, _rb = _rs[b.r + ',' + b.c] || {};
      var _qa = ((a.count || 0) - (_exp[a.color] || 0)) * 100 + (_ra.median != null ? _ra.median : 0.5) * 20 - (_ra.spread || 0) * 40;
      var _qb = ((b.count || 0) - (_exp[b.color] || 0)) * 100 + (_rb.median != null ? _rb.median : 0.5) * 20 - (_rb.spread || 0) * 40;
      return _qb - _qa;
    });
    var best = null, bestScore = -Infinity, tried = 0;
    for (var ei = 0; ei < early.length && tried < 3; ei++) {
      for (var di = 0; di < deep.length && tried < 3; di++) {
        var e = early[ei], d = deep[di];
        if (e.r === d.r && e.c === d.c) continue;
        tried++;
        var lv = JSON.parse(JSON.stringify(level));
        var a = lv.board.cells[e.r][e.c], b = lv.board.cells[d.r][d.c];
        if (!a || !b || a.t !== 'box' || b.t !== 'box') continue;
        lv.board.cells[e.r][e.c] = b;
        lv.board.cells[d.r][d.c] = a;
        var ev2 = null;
        try { ev2 = evaluateLevel(lv, config); } catch (er) { }
        if (!ev2 || !ev2.goodV3) continue;
        var fc = ev2.goodV3.fillCurve || {};
        var sc = (fc.earlyPeak10 || 0) * 100 - (fc.earlyFree10 || 0) * 10;
        if (sc > bestScore) {
          best = { level: lv, earlyFree10: fc.earlyFree10, earlyPeak10: fc.earlyPeak10, T: (ev2.goodV3.persist && ev2.goodV3.persist.quality || {}).T };
          bestScore = sc;
        }
      }
    }
    // 【v442】多组交换：一次换 2~3 对，把前10步峰值再推高
    for (var _pairs = 2; _pairs <= 3; _pairs++) {
      if (early.length < _pairs || deep.length < _pairs) continue;
      var lvM = JSON.parse(JSON.stringify(level)), okM = true;
      for (var _pi = 0; _pi < _pairs; _pi++) {
        var _e = early[_pi], _d = deep[_pi];
        var _a = lvM.board.cells[_e.r][_e.c], _b = lvM.board.cells[_d.r][_d.c];
        if (!_a || !_b || _a.t !== 'box' || _b.t !== 'box' || (_e.r === _d.r && _e.c === _d.c)) { okM = false; break; }
        lvM.board.cells[_e.r][_e.c] = _b; lvM.board.cells[_d.r][_d.c] = _a;
      }
      if (!okM) continue;
      var evM = null;
      try { evM = evaluateLevel(lvM, config); } catch (e) { }
      if (!evM || !evM.goodV3) continue;
      var fcM = evM.goodV3.fillCurve || {};
      var scM = (fcM.earlyPeak10 || 0) * 100 - (fcM.earlyFree10 || 0) * 10;
      if (scM > bestScore) {
        best = { level: lvM, earlyFree10: fcM.earlyFree10, earlyPeak10: fcM.earlyPeak10, T: (evM.goodV3.persist && evM.goodV3.persist.quality || {}).T };
        bestScore = scM;
      }
    }
    // 【v444】直接替换“当前取盒”：让第一选择本身 partial，同时保留另一个 full
    for (var _si = 0; _si < steps.length && _si < 10; _si++) {
      var _st = steps[_si];
      if (!_st || _st.full < 2 || !_st.pick) continue;
      if (!plain(_st.pick.r, _st.pick.c)) continue;
      var _alts = (_st.moves || []).filter(function (m) {
        return m.full && plain(m.r, m.c) && !(m.r === _st.pick.r && m.c === _st.pick.c);
      });
      if (!_alts.length) continue;
      if (!deep.length) break;
      var _d = deep[0];
      if (_d.r === _st.pick.r && _d.c === _st.pick.c) continue;
      var lvP = JSON.parse(JSON.stringify(level));
      var _pa = lvP.board.cells[_st.pick.r][_st.pick.c], _pb = lvP.board.cells[_d.r][_d.c];
      if (!_pa || !_pb || _pa.t !== 'box' || _pb.t !== 'box') continue;
      lvP.board.cells[_st.pick.r][_st.pick.c] = _pb;
      lvP.board.cells[_d.r][_d.c] = _pa;
      var evP = null;
      try { evP = evaluateLevel(lvP, config); } catch (e) { }
      if (!evP || !evP.goodV3) continue;
      var fcP = evP.goodV3.fillCurve || {};
      var scP = (fcP.earlyPeak10 || 0) * 100 - (fcP.earlyFree10 || 0) * 10;
      if (scP > bestScore) {
        best = { level: lvP, earlyFree10: fcP.earlyFree10, earlyPeak10: fcP.earlyPeak10, T: (evP.goodV3.persist && evP.goodV3.persist.quality || {}).T };
        bestScore = scP;
      }
    }
    return best;
  }

  function p7RepairLevel(level, config) {
    var ev0 = null;
    try { ev0 = evaluateLevel(level, config); } catch (e) { }
    var d0 = p7DiagnoseEv(ev0);
    if (!d0) return null;
    var cur = level, diag = d0, ev = ev0, tried = 0, accepted = 0, path = [], notes = [];
    var _dl = config && config._repairDeadline;
    // A1：管道公平性
    for (var i = 0; i < 3 && diag.cause === 'hidden' && (!_dl || Date.now() < _dl); i++) {
      tried++;
      var rep = p7PipeFairness(cur, config);
      if (!rep) break;
      var ev2 = null;
      try { ev2 = evaluateLevel(rep.level, config); } catch (e) { }
      var d2 = p7DiagnoseEv(ev2);
      if (!d2) break;
      var improved = (diag.J != null && d2.J != null && d2.J <= diag.J - 5) || (d2.pass && !diag.pass);
      if (!improved) break;
      cur = rep.level; ev = ev2; diag = d2; accepted++;
      path.push({ step: 'A1.' + (i + 1), J: d2.J, T: d2.T, R: d2.R, freePct: d2.freePct, pass: d2.pass });
      if (d2.pass) break;
    }
    // Early：前10步加压
    var _earlyBad = (diag.earlyFree10 != null && diag.earlyFree10 > 4) || (diag.earlyPeak10 != null && diag.earlyPeak10 < 3);
    for (var ei2 = 0; ei2 < 2 && _earlyBad && (!_dl || Date.now() < _dl); ei2++) {
      tried++;
      var repE = p7EarlyPressure(cur, config, ev);
      if (!repE) { notes.push('early no candidate'); break; }
      var evE = null;
      try { evE = evaluateLevel(repE.level, config); } catch (e) { }
      var dE = p7DiagnoseEv(evE);
      if (!dE) break;
      var okE = (diag.earlyPeak10 != null && dE.earlyPeak10 != null && dE.earlyPeak10 >= diag.earlyPeak10 + 1) ||
                (diag.earlyFree10 != null && dE.earlyFree10 != null && dE.earlyFree10 <= diag.earlyFree10 - 2);
      if (!okE) { notes.push('early no improve'); break; }
      cur = repE.level; ev = evE; diag = dE; accepted++;
      path.push({ step: 'Early.' + (ei2 + 1), earlyFree10: dE.earlyFree10, earlyPeak10: dE.earlyPeak10, T: dE.T, pass: dE.pass });
      if (dE.pass) break;
    }
    // A2：压力点岔路
    for (var k = 0; k < 2 && diag.cause === 'flat' && (!_dl || Date.now() < _dl); k++) {
      tried++;
      var rep2 = p7ForceChoice(cur, config, ev);
      if (!rep2) { rep2 = p7PartialChoice(cur, config, ev); if (rep2) notes.push('A2 partial'); }
      if (!rep2) { rep2 = p7SafeSplit(cur, config); notes.push('A2 fallback split'); }
      if (!rep2) { notes.push('A2 no candidate'); break; }
      var ev2b = null;
      try { ev2b = evaluateLevel(rep2.level, config); } catch (e) { }
      var d2b = p7DiagnoseEv(ev2b);
      if (!d2b) break;
      var improved2 = (diag.T != null && d2b.T != null && d2b.T >= diag.T + 5) ||
                      (diag.R != null && d2b.R != null && d2b.R >= diag.R + 5) ||
                      (diag.wLow != null && d2b.wLow != null && d2b.wLow <= diag.wLow - 5) ||
                      (diag.partialStepPct != null && d2b.partialStepPct != null && d2b.partialStepPct >= diag.partialStepPct + 5) ||
                      (diag.fullMedian2 != null && d2b.fullMedian2 != null && d2b.fullMedian2 <= diag.fullMedian2 - 1);
      if (diag.freePct != null && d2b.freePct != null && d2b.freePct > diag.freePct + 5) break;
      if (diag.J != null && d2b.J != null && d2b.J > diag.J + 5) break;
      if (!improved2) break;
      cur = rep2.level; ev = ev2b; diag = d2b; accepted++;
      path.push({ step: 'A2.' + (k + 1), J: d2b.J, T: d2b.T, R: d2b.R, freePct: d2b.freePct, pass: d2b.pass });
      if (d2b.pass) break;
    }
    // A3：收紧开局（freePct/freeRunMax）
    var _earlyOkForA3 = !((diag.earlyFree10 != null && diag.earlyFree10 > 4) || (diag.earlyPeak10 != null && diag.earlyPeak10 < 3));
    for (var j = 0; j < 2 && diag.cause !== 'black' && _earlyOkForA3 && (!_dl || Date.now() < _dl) && (diag.cause === 'free' || (diag.freePct != null && diag.freePct > 50) || (diag.freeRunMax != null && diag.freeRunMax > 6)); j++) {
      tried++;
      // A3R：先挪位置（低缓冲白给 → 高缓冲窗口）
      var repR = p7RelocateFree(cur, config, ev);
      if (repR) {
        var evR = null;
        try { evR = evaluateLevel(repR.level, config); } catch (e) { }
        var dR = p7DiagnoseEv(evR);
        // 【v410·用户裁决】T/R/learned/look 都是模拟代理，不做硬守卫；
        // A3R 只看“白给位置是否真的变好”+ 硬门可解/守恒。
        var posImproved = (diag.freeLowPct != null && dR && dR.freeLowPct != null && dR.freeLowPct <= diag.freeLowPct - 5) ||
                          (diag.pressurePct3 != null && dR && dR.pressurePct3 != null && dR.pressurePct3 >= diag.pressurePct3 + 5) ||
                          (diag.pressurePeak != null && dR && dR.pressurePeak != null && dR.pressurePeak > diag.pressurePeak);
        if (dR && posImproved && diag.first != null && dR.first != null && dR.first > 60) {
          notes.push('A3R too easy first ' + dR.first + '>60');
        } else if (dR && posImproved) {
          cur = repR.level; ev = evR; diag = dR; accepted++;
          path.push({ step: 'A3R.' + (j + 1), freeLowPct: dR.freeLowPct, pressurePct3: dR.pressurePct3, pressurePeak: dR.pressurePeak,
            first: dR.first, learned: dR.learned, look: dR.look, T: dR.T, R: dR.R, pass: dR.pass });
          if (dR.pass) break;
          continue;
        }
      }
      var rep3 = p7TightenOpening(cur, config, ev);
      if (!rep3) { notes.push('A3 no candidate'); rep3 = p7SupplyStructure(cur, config, ev); }
      if (!rep3) { notes.push('A3b no candidate'); break; }
      var ev3 = null;
      try { ev3 = evaluateLevel(rep3.level, config); } catch (e) { }
      var d3 = p7DiagnoseEv(ev3);
      if (!d3) break;
      var improved3 = (diag.freePct != null && d3.freePct != null && d3.freePct <= diag.freePct - 5) ||
                      (diag.freeRunMax != null && d3.freeRunMax != null && d3.freeRunMax <= diag.freeRunMax - 2);
      // A3 不能把 T/R 修坏：T/R 掉 >5 就拒绝
      if (diag.T != null && (d3.T == null || d3.T < diag.T - 5)) { notes.push('A3 T guard '+(d3.T)+'<'+diag.T+'-5'); break; }
      if (diag.R != null && (d3.R == null || d3.R < diag.R - 5)) { notes.push('A3 R guard '+(d3.R)+'<'+diag.R+'-5'); break; }
      if (!improved3) { notes.push('A3 free no improve '+diag.freePct+'->'+d3.freePct); break; }
      cur = rep3.level; ev = ev3; diag = d3; accepted++;
      path.push({ step: 'A3.' + (j + 1), J: d3.J, T: d3.T, R: d3.R, freePct: d3.freePct, freeRunMax: d3.freeRunMax, pass: d3.pass });
      if (d3.pass) break;
    }
    // A4：太黑减负
    if (diag.cause === 'black') {
      for (var m = 0; m < 2; m++) {
        tried++;
        var rep4 = p7Soften(cur, config, ev);
        if (!rep4) break;
        var ev4 = null;
        try { ev4 = evaluateLevel(rep4.level, config); } catch (e) { }
        var d4 = p7DiagnoseEv(ev4);
        if (!d4) break;
        var improved4 = (diag.learned != null && d4.learned != null && d4.learned >= diag.learned + 5) ||
                        (diag.look != null && d4.look != null && d4.look >= diag.look + 5);
        if (!improved4) break;
        cur = rep4.level; ev = ev4; diag = d4; accepted++;
        path.push({ step: 'A4.' + (m + 1), learned: d4.learned, look: d4.look, T: d4.T, freePct: d4.freePct, pass: d4.pass });
        if (d4.pass) break;
      }
    }
    return {
      level: cur, goodV3: ev && ev.goodV3, solveResult: ev && ev.solveResult,
      audit: ev && ev.audit, valid: !!(ev && ev.valid),
      p7: { tried: tried, accepted: accepted, fromJ: d0.J, toJ: diag.J,
        fromT: d0.T, toT: diag.T, fromR: d0.R, toR: diag.R,
        fromFreePct: d0.freePct, toFreePct: diag.freePct,
        fromFreeRunMax: d0.freeRunMax, toFreeRunMax: diag.freeRunMax,
        fromFreeLowPct: d0.freeLowPct, toFreeLowPct: diag.freeLowPct,
        fromPressurePct3: d0.pressurePct3, toPressurePct3: diag.pressurePct3,
        fromPressurePeak: d0.pressurePeak, toPressurePeak: diag.pressurePeak, path: path, notes: notes }
    };
  }

  // 【v445】B-lite：多路径 ready 采样（只报告，不改障碍）
  function sampleReadyStats(level, config, sampleN) {
    var parsed = null;
    try { parsed = AntSolver.parseLevel(level); } catch (e) { return null; }
    var S = AntSolver.Simulator;
    if (!S || !S.createState || !S.listMoves || !S.applyPick) return null;
    var total = parsed.totalBoxes || 1;
    var K = Math.max(2, Math.min(8, parseInt(sampleN, 10) || 5));
    var byCell = {}, byPick = {};
    var okSamples = 0;
    for (var si = 0; si < K; si++) {
      var st = null;
      try { st = S.createState(parsed, { useSlotStart: true }); } catch (e) { continue; }
      var local = {}, localPick = {}, steps = 0;
      while (steps++ < total + 20) {
        var moves = [];
        try { moves = S.listMoves(st).filter(function (m) { return !m.blocked; }); } catch (e) { break; }
        if (!moves.length) break;
        var blob = null;
        try { blob = exposedBlobByColor(st.eliminated, st.blocks, st.rows, st.cols); } catch (e) { break; }
        for (var mi = 0; mi < moves.length; mi++) {
          var mv = moves[mi], cell = st.cells[mv.r] && st.cells[mv.r][mv.c];
          if (!cell) continue;
          var key = mv.r + ',' + mv.c;
          if (local[key] == null && (blob[cell.color] || 0) >= cell.count) {
            local[key] = +((st.completedBoxes || 0) / total).toFixed(3);
          }
        }
        var full = [];
        for (var fi = 0; fi < moves.length; fi++) {
          var cc = st.cells[moves[fi].r] && st.cells[moves[fi].r][moves[fi].c];
          if (cc && (blob[cc.color] || 0) >= cc.count) full.push(moves[fi]);
        }
        var pool = (full.length && rnd() < 0.7) ? full : moves;
        var pick = pool[Math.floor(rnd() * pool.length)];
        if (!pick) break;
        var _pk = pick.r + ',' + pick.c;
        if (localPick[_pk] == null) localPick[_pk] = +((st.completedBoxes || 0) / total).toFixed(3);
        if (!S.applyPick(st, pick.r, pick.c)) break;
        if (st.gameOver) break;
      }
      // 没采到 ready 的盒按 1.0 处理
      for (var rr = 0; rr < level.board.rows; rr++) for (var rc = 0; rc < level.board.cols; rc++) {
        var bx = level.board.cells[rr] && level.board.cells[rr][rc];
        if (!bx || bx.t !== 'box') continue;
        var k2 = rr + ',' + rc;
        if (local[k2] == null) local[k2] = 1;
        if (!byCell[k2]) byCell[k2] = [];
        byCell[k2].push(local[k2]);
        if (!byPick[k2]) byPick[k2] = [];
        byPick[k2].push(localPick[k2] != null ? localPick[k2] : 1);
      }
      okSamples++;
    }
    if (!okSamples) return null;
    var stable = 0, spreadSum = 0, nCars = 0;
    for (var k in byCell) {
      var arr = byCell[k].slice().sort(function (a, b) { return a - b; });
      var min = arr[0], max = arr[arr.length - 1];
      var med = arr[Math.floor(arr.length / 2)];
      var spread = +(max - min).toFixed(3);
      var parr = (byPick[k] || [1]).slice().sort(function (a, b) { return a - b; });
      var pmed = parr[Math.floor(parr.length / 2)];
      byCell[k] = { min: min, max: max, median: med, spread: spread, n: arr.length, pickedMedian: pmed };
      nCars++; spreadSum += spread;
      if (spread <= 0.25) stable++;
    }
    return { samples: okSamples, cars: nCars, stablePct: nCars ? Math.round(stable / nCars * 100) : 0,
      avgSpread: nCars ? +(spreadSum / nCars).toFixed(3) : 0, byCell: byCell };
  }

  // 【v447】两遍建盘：用多路径 ready 重放冰/链
  // 【v450】生成时 Early：用首解 pickOrder 把前10步的第一选择换成“未暴露/吃不满”的车
  function applyGenerationEarly(level, config, sr, which) {
    if (!level || !sr || !sr.pickOrder || !sr.pickOrder.length) return { tries: [{ reason: 'no level/sr' }] };
    function plain(r, c) {
      var x = level.board.cells[r] && level.board.cells[r][c];
      return x && x.t === 'box' && !x.chain && !x.numice && !x.q;
    }
    var po = sr.pickOrder.slice().sort(function (a, b) { return (a.step || 0) - (b.step || 0); });
    var early = [], deep = [];
    var exp = {};
    try {
      var oe = openingExposure(level.blocks, level.board.rows, level.board.cols, false);
      if (oe && oe.detail) for (var oi = 0; oi < oe.detail.length; oi++) exp[oe.detail[oi].color] = oe.detail[oi].px;
    } catch (e) { }
    for (var i = 0; i < po.length; i++) {
      var p = po[i];
      if (!plain(p.r, p.c)) continue;
      var prog = i / Math.max(1, po.length - 1);
      if (i < 10) early.push(p);
      if (prog >= 0.40 && prog <= 0.70) deep.push(p);
    }
    if (!early.length || !deep.length) return null;
    deep.sort(function (a, b) {
      var _a = (a.count || 0) - (exp[a.color] || 0), _b = (b.count || 0) - (exp[b.color] || 0);
      if (_b !== _a) return _b - _a;
      return (b.count || 0) - (a.count || 0);
    });
    var lv = JSON.parse(JSON.stringify(level));
    var e = early[Math.min(early.length - 1, Math.max(0, which || 0))], d = deep[0];
    if (e.r === d.r && e.c === d.c) return null;
    var a = lv.board.cells[e.r][e.c], b = lv.board.cells[d.r][d.c];
    if (!a || !b || a.t !== 'box' || b.t !== 'box') return null;
    lv.board.cells[e.r][e.c] = b; lv.board.cells[d.r][d.c] = a;
    lv.semanticEarly = { from: [e.r, e.c], to: [d.r, d.c], early: e.color, deep: d.color };
    return lv;
  }

  function applySemanticObstacles(board, blocks, config) {
    if (!board || !config || !config.semanticObstacles) return null;
    var level = { blocks: blocks, bufferLimit: config.bufferLimit || 5, board: board };
    var rs = null;
    try { rs = sampleReadyStats(level, config, 5); } catch (e) { rs = null; }
    if (!rs || !rs.byCell) return null;
    var total = 0;
    for (var r0 = 0; r0 < board.rows; r0++) for (var c0 = 0; c0 < board.cols; c0++) {
      var x0 = board.cells[r0][c0];
      if (x0 && x0.t === 'box') total++;
      else if (x0 && x0.t === 'pipe') total += (x0.queue ? x0.queue.length : 0);
    }
    // 清掉旧冰/链
    for (var r1 = 0; r1 < board.rows; r1++) for (var c1 = 0; c1 < board.cols; c1++) {
      var x1 = board.cells[r1][c1];
      if (!x1) continue;
      if (x1.numice) x1.numice = 0;
      if (x1.chain) x1.chain = 0;
    }
    function st(r, c) { return rs.byCell[r + ',' + c] || null; }
    // 冰：稳定晚熟车
    var iceC = [], iceFallback = [];
    for (var r2 = 0; r2 < board.rows; r2++) for (var c2 = 0; c2 < board.cols; c2++) {
      var x2 = board.cells[r2][c2];
      if (!x2 || x2.t !== 'box' || x2.chain || x2.numice || x2.q) continue;
      var s2 = st(r2, c2);
      if (!s2 || s2.spread > 0.35) continue;
      var _pk2 = (s2.pickedMedian != null) ? s2.pickedMedian : 1;
      // 前10步会被点到的车：优先锁它
      if (_pk2 <= 0.35) iceC.push({ r: r2, c: c2, s: s2, cell: x2, picked: _pk2 });
      else if (s2.median >= 0.25) iceFallback.push({ r: r2, c: c2, s: s2, cell: x2, picked: _pk2 });
    }
    iceC.sort(function (a, b) { return (a.picked - b.picked) || (b.s.median - a.s.median); });
    if (!iceC.length) {
      iceFallback.sort(function (a, b) { return b.s.median - a.s.median; });
      iceC = iceFallback;
    }
    var iceN = Math.min(4, iceC.length), iced = 0;
    var force = parseInt(config.iceForceSteps, 10); if (isNaN(force)) force = 2;
    for (var ii = 0; ii < iceN; ii++) {
      var ic = iceC[ii];
      var val = Math.max(2, Math.min(12, Math.round(ic.s.median * total) + force));
      ic.cell.numice = val; iced++;
    }
    // 链：稳定一早一晚
    var chains = 0, group = 0;
    for (var r3 = 0; r3 < board.rows && chains < 2; r3++) for (var c3 = 0; c3 < board.cols - 1 && chains < 2; c3++) {
      var a3 = board.cells[r3][c3], b3 = board.cells[r3][c3 + 1];
      if (!a3 || !b3 || a3.t !== 'box' || b3.t !== 'box') continue;
      if (a3.chain || b3.chain || a3.numice || b3.numice || a3.q || b3.q) continue;
      var sa = st(r3, c3), sb = st(r3, c3 + 1);
      if (!sa || !sb || sa.spread > 0.25 || sb.spread > 0.25) continue;
      var early = (sa.median <= sb.median) ? sa : sb;
      var late = (early === sa) ? sb : sa;
      if (!(early.median + 0.05 < late.median)) continue;
      group++;
      a3.chain = group; b3.chain = group; chains++;
    }
    var info = { ice: iced, chains: chains, stablePct: rs.stablePct, total: total };
    try { board.semanticObstacles = info; } catch (e) { }
    return info;
  }

  function trapPostProcess(level, config) {
    if (!level || !AntSolver.PlayerSim || !AntSolver.Solver) return null;
    var base = evalTrapLevel(level, config);
    if (!base || base.first < 20 || base.first > 80) return { applied: false, reason: 'base first ' + (base ? base.first : '?') };
    var plain = function (r, c) {
      var cell = level.board && level.board.cells && level.board.cells[r] && level.board.cells[r][c];
      return cell && cell.t === 'box' && !cell.chain && !cell.numice && !cell.q;
    };
    var po = base.po || [], early = [], deep = [];
    for (var i = 0; i < po.length; i++) {
      var p = po[i];
      if (!plain(p.r, p.c)) continue;
      if (i < 6) early.push(p);
      if (i >= Math.floor(po.length * 0.3) && i <= Math.floor(po.length * 0.6)) deep.push(p);
    }
    var muts = [];
    for (var ei = 0; ei < early.length; ei++) for (var di = 0; di < deep.length; di++) {
      var e = early[ei], d = deep[di];
      if (e.color !== d.color) muts.push({ type: 'swap', a: e, b: d });
      else if (e.count > 1 && d.count > 1) {
        var delta = Math.max(1, Math.min(10, Math.floor(d.count / 2)));
        if (e.count + delta > d.count) muts.push({ type: 'skew', a: e, b: d, delta: delta });
      }
    }
    var best = null;
    for (var mi = 0; mi < muts.length && mi < 30; mi++) {
      var mut = muts[mi];
      var lv = JSON.parse(JSON.stringify(level));
      if (mut.type === 'swap') {
        var a = lv.board.cells[mut.a.r][mut.a.c], b = lv.board.cells[mut.b.r][mut.b.c];
        lv.board.cells[mut.a.r][mut.a.c] = b; lv.board.cells[mut.b.r][mut.b.c] = a;
      } else {
        var a2 = lv.board.cells[mut.a.r][mut.a.c], b2 = lv.board.cells[mut.b.r][mut.b.c];
        if (!a2 || !b2) continue;
        a2.count += mut.delta; b2.count -= mut.delta;
        if (b2.count <= 0) continue;
      }
      var m = evalTrapLevel(lv, config);
      if (!m) continue;
      if (m.T <= 0 || m.first < 10 || m.first > 90 || (m.U != null && m.U > 30)) continue;
      if (m.first > base.first + 5) continue;
      if (m.learned < base.learned - 5 || m.look < base.look - 5 || m.T < base.T) continue;
      if (m.learned <= m.first) continue;
      if (m.learned <= base.learned && m.look <= base.look && m.T <= base.T) continue;
      var score = (m.learned - base.learned) * 3 + (m.look - base.look) + (m.T - base.T) * 2 + (m.R - base.R) * 0.2 - Math.max(0, m.first - base.first) * 2;
      if (!best || score > best.score) best = { score: score, level: lv, mut: mut, m: m };
    }
    if (!best) return { applied: false, reason: 'no hit', base: base };
    return { applied: true, level: best.level, stats: { base: base, best: best.m, score: best.score, mut: best.mut } };
  }

  // 【v394·调试】打印一组尺寸的 solveSpaceQuota 结果，排查“扩展盘为什么进不去”
  function debugBoardDims(n, config) {
    var out = [];
    for (var r = 3; r <= 20; r++) {
      for (var c = 3; c <= 30; c++) {
        if (!boardShapeOk(r, c, !!(config && config.boardAllowSquare))) continue;
        var q = null;
        try { q = solveSpaceQuota(n, r, c, config); } catch (e) { q = null; }
        out.push({
          rows: r, cols: c, cells: r * c, ok: !!(q && q.ok),
          overflow: q ? q.overflow : null, pipeWant: q ? q.pipeWant : null,
          breach: q ? q.breachLevel : null, black: q ? q.blackTarget : null,
          usable: q ? Math.round(q.usable * 1000) / 10 : null,
          blackPct: q ? Math.round(q.blackPct * 1000) / 10 : null
        });
      }
    }
    return out;
  }

  return {
    generate: generate,
    generateFromBlocks: generateFromBlocks,
    // produce 为正式默认入口：v95 起分发到纠偏版；produceLegacy 是 v94 及以前的旧实现。
    produce: produceDispatch,
    produceGoal: produceGoal,               // 【2026-10-22】目标模式：没达标就换种子再来，停止时返回当前最好
    produceLegacy: produce,
    FLOW: DEFAULT_FLOW,
    // ===== 纠偏版（R01-R07）入口与可单测的内部函数 =====
    // 旧版导出全部保留不动；新版通过 *Fixed 名称并列导出，生产脚本显式选择调用哪一套。
    produceFixed: produceFixed,
    runFlowOnce: runFlowOnce,               // 【v314】按 generatorFlow 选产线（纠偏/兜底复用）
    capsOffRange: capsOffRange,             // 【v314】关卡容量是否跑出用户区间（走错产线的哨兵）
    // 【同比难度缩放 · 用户 2026-09-02】导出以便单测与落库追溯；生产路径由
    //   proportionalDifficultyAdjust（缺省 false）门控，不导出也会被内部调用。
    scaleDifficultyProportional: scaleDifficultyProportional,
    iceCellTiers: iceCellTiers,          // 数字冰格数档位阶梯（用户 2026-09-02；键名保留兼容）
    iceTierOf: iceTierOf,
    generateFromBlocksFixed: generateFromBlocksFixed,
    buildStructureCandidateFixed: buildStructureCandidateFixed,
    planObstacleSlotsFixed: planObstacleSlotsFixed,
    fillStructureFixed: fillStructureFixed,
    buildOneCandidateAttempt: buildOneCandidateAttempt,
    buildConservationBaseline: buildConservationBaseline,
    scanBoardActual: scanBoardActual,
    verifyConservation: verifyConservation,
    screenCandidateFixed: screenCandidateFixed,
    // ===== 仅底部入口模式（ANT-GEN-BOTTOM-ONLY-20260729）=====
    baseFillBoxesBottom: baseFillBoxesBottom,               // 底部依赖流盒切分（bottomOnly 分支）
    pickBoxSplit: pickBoxSplit,                             // 盒切分分发点（新旧流程共用）
    // 【v137】锚点切盒与棋盘预检：导出以便单测/脚本核对（不改变调用方行为）
    anchorCutConfig: anchorCutConfig,                       // 锚点切盒参数组装
    preflightBoardFit: preflightBoardFit,                   // 棋盘范围 × 车数 预检
    // 【v151】「选择余地」曲线：每步有几个"能吃满"的选项（供闸门/报告/界面共用）
    choiceCurve: choiceCurve,
    // 【v153】源图体检：开局暴露了几种颜色（"这张图能不能出有选择的关"的第一判据）
    openingExposure: openingExposure,
    exposureWarnText: exposureWarnText,
    setCurveScore: setCurveScore,           // 【v151】曲线评分开关（默认关）
    isCurveScore: isCurveScore,
    choiceCurveScore: choiceCurveScore,
    evaluateLevel: evaluateLevel, trapPostProcess: trapPostProcess, p7RepairLevel: p7RepairLevel, goalStructPass: goalStructPass, sampleReadyStats: sampleReadyStats, debugBoardDims: debugBoardDims,
    exposedBlobByColor: exposedBlobByColor,
    // 【v145】棋盘自适应：车数采样 / 由车数反推范围 / 把范围写进 config 副本
    sampleCarCount: sampleCarCount,
    suggestBoardRange: suggestBoardRange,
    applyAutoBoardRange: applyAutoBoardRange,
    applyBoxPhase: applyBoxPhase,           // 【v147】错位量：旋转车在棋盘上的排位
    clampPipeDemand: clampPipeDemand,       // 【v149】管道下限相容性：车少时自动降级
    cutSpanPixels: cutSpanPixels,           // 【v148】切盒跨度：趋势序 ↔ 等深线序
    pixelDepthMap: pixelDepthMap,
    withBoardRange: withBoardRange,
    boardCellsExtent: boardCellsExtent,                     // 方案范围内合法棋盘的最小/最大格数
    suggestBoardRange: suggestBoardRange,                   // 由车数反推建议行列范围
    diagnoseNoCandidate: diagnoseNoCandidate,               // 候选全灭的原因翻译
    checkBottomEntryFeasibility: checkBottomEntryFeasibility, // 生产前可达性检查（可独立调用做源图体检）
    // ===== 生产前置碎色闸门（ANT-GEN-FRAGMENT-GATE-20260824）=====
    computeFragmentation: computeFragmentation,               // 只算碎色率，可独立调用做源图体检
    checkFragmentGate: checkFragmentGate,                     // 闸门判定（fragmentMaxRate<=0 时恒放行）
    // ===== 管道深度参数化 + 兜底（ANT-GEN-PIPE-DEPTH-FALLBACK-20260825）=====
    pipeDepthOf: pipeDepthOf,                                 // 生效的管道队列深度上限
    pipeMinFillOf: pipeMinFillOf,                             // 生效的单管最少装盒数
    applyBeatProps: applyBeatProps,       // 【v153】债务节拍→道具落位（冰/链）
    midChokeOf: midChokeOf,               // 【v153】30~80% 区间内的卡点数（同档候选首选键）
    enforceChainAdjacency: enforceChainAdjacency,   // 【v161】锁链相邻性修复（同组必须 4-邻接连通）；供体检/单测直接调用
    midgameCapacitySqueeze: midgameCapacitySqueeze, // 【v172】切球层加压（中段成片吃不饱）；供单测直接调用
    pressureBoostIce: pressureBoostIce,             // 【v170】冰当墙（定向锁免费选项）；供单测直接调用
    chokeV2Of: chokeV2Of,                 // 【v157】卡点判据 v2（R1~R9）：全知线/玩家线各量一遍再取最差
    chokeV2Violations: chokeV2Violations, // 【v157】违反项（空数组=达标）——页面每关日志与报告用
    chokeV2GreedyLine: chokeV2GreedyLine, // 【v176】第三条线「贪心玩家」：垫槽/赌管道/峰窗（页面每关日志 + 体检用；不进候选循环）
    simulatePlay: simulatePlay,           // 【v177】"玩一遍"模拟器（policy: steady/bold/random + 随机源）
    chokeV2PlayBatch: chokeV2PlayBatch,   // 【v177】"同一关玩 N 遍"：通关率 / 峰窗区间 / 结束位置分布
    chokeV2Attribute: chokeV2Attribute,   // 【v179】机制归因：拿掉墙/管道/冰/链/问号各跑一遍，看通关率回升多少
    veinLayers: veinLayers,               // 【v180】矿脉层表：谁包着谁、最深几层（只由图决定）
    conservativeSolvable: conservativeSolvable,   // 【v298】可达性下限：保守玩家能否一路挖开
    veinDebt: veinDebt,                   // 【v180】债务 Δ：最优路线 vs 实际路线，每条矿脉晚了多少手才被碰到
    buriedCountOf: buriedCountOf,         // 【v182】"被埋"计数：稳健一局终局里有几辆车"量够但够不着"
    CHOKE_V2_GATES: CHOKE_V2_GATES,       // 【v157】参考门阈值（暂定：独木桥≤1 / 预算点≥12 / 无满解≤3 / 70%前≥4≤10%）
    setProgressHook: setProgressHook,     // 【v153】单关进度钩子（worker/界面显示跑到哪了）
    solveSpaceQuota: solveSpaceQuota,                         // 可用空间配额联立解（含管道兜底），可独立调用体检参数是否自相矛盾
    pipeCountByConservation: pipeCountByConservation,          // 守恒反推管道数（usableSpaceTarget 关闭时生效）
    // ===== 卡点体系类型化（ANT-GEN-CHOKE-TYPES-20260824）=====
    rareColorRank: rareColorRank,                             // 稀有色识别（按像素占比升序）
    pickClustered: pickClustered,                             // 聚集选点（pickDispersed 的对立面）
    pickChokeTypes: pickChokeTypes,                           // v115：按「检查次数×概率」抽互不重合的卡点类型
    sampleRangedConfig: sampleRangedConfig,                    // v115：按区间采样一组参数（每候选一次）
    chokeRareColorKeyPlace: chokeRareColorKeyPlace,           // 稀有色落位（首次换球时执行）
    CHOKE_TYPE_LIST: CHOKE_TYPE_LIST,
    baseFillBoxes: baseFillBoxes,                           // 默认几何趋势流盒切分（对照用）
    baselineSolutionFixed: baselineSolutionFixed,
    derivePipeReleaseOrder: derivePipeReleaseOrder,
    deriveRegionUnlockOrder: deriveRegionUnlockOrder,
    deriveObstacleProgress: deriveObstacleProgress,
    makeChokeVariantFixed: makeChokeVariantFixed,
    SCREEN_PASSES_FIXED: SCREEN_PASSES_FIXED,
    analyzeEliminationLayers: analyzeEliminationLayers,
    generateQueues: generateQueues,
    buildBoard: buildBoard,
    chooseBoardDims: chooseBoardDims,
    reserveNarrowWalls: reserveNarrowWalls,
    placeBoardObstacles: placeBoardObstacles,
    structuralDeadlockCheck: structuralDeadlockCheck,
    chainActivatable: chainActivatable,
    splitIntoBoxes: splitIntoBoxes,
    demandCurveOf: demandCurveOf, demandAt: demandAt,   // 【v253】需求日程（供工具/单测）
    frontierWidthOf: frontierWidthOf,                   // 【2026-10-22】前沿宽度（自动选切法用）
    deriveCapacityBand: deriveCapacityBand,             // 【2026-10-22】按图推导容量带（自动容量用）
    computeDifficulty: computeDifficulty,
    evaluateGeneration: evaluateGeneration,
    generationScore: generationScore,
    generateTargetMap: generateTargetMap,
    blocksFromTXT: blocksFromTXT,
    getColorPalette: getColorPalette,
    DEFAULT_CONFIG: DEFAULT_CONFIG
  };
})();
