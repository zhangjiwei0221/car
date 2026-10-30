// 测试蚂蚁拿块求解器核心逻辑
var fs = require('fs');
var path = require('path');

var AntSolver = {};

// 加载模块
eval(fs.readFileSync(path.join(__dirname, 'js/utils.js'), 'utf-8'));
eval(fs.readFileSync(path.join(__dirname, 'js/simulator.js'), 'utf-8'));
eval(fs.readFileSync(path.join(__dirname, 'js/solver.js'), 'utf-8'));

console.log('=== 测试1: 生成示例关卡 ===');
var sampleJson = AntSolver.generateSampleLevel();
console.log('目标图尺寸:', sampleJson.blocks.length + 'x' + sampleJson.blocks[0].length);
console.log('队列数:', sampleJson.queues.length);
var totalBoxes = 0;
for (var i = 0; i < sampleJson.queues.length; i++) totalBoxes += sampleJson.queues[i].length;
console.log('蚂蚁盒总数:', totalBoxes);

console.log('\n=== 测试2: 解析关卡 ===');
var level = AntSolver.parseLevel(sampleJson);
console.log('总像素:', level.totalPixels);
console.log('颜色分布:', JSON.stringify(level.colorCounts));
console.log('暂存上限:', level.bufferLimit);

console.log('\n=== 测试3: 模拟消除逻辑 ===');
var state = AntSolver.Simulator.createState(level);
console.log('初始已消除:', state.eliminatedPixels);

// 测试flood-fill消除：取第一个蚂蚁盒
var firstBox = level.queues[0][0];
console.log('第一个蚂蚁盒: 颜色=' + AntSolver.getColorName(firstBox.color) + ' 数量=' + firstBox.count);

// 手动消除测试
var tempElim = AntSolver.deepClone(state.eliminated);
var eliminated = AntSolver.Simulator.floodFillEliminate(
  tempElim, state.blocks, state.rows, state.cols, firstBox.color, firstBox.count
);
console.log('第一个盒子消除了:', eliminated, '个像素');

// 验证边缘可达性
var reachable = AntSolver.Simulator.getReachableCells(state);
console.log('初始可达边界格子数:', reachable.length);
var colorGroups = {};
for (var i = 0; i < reachable.length; i++) {
  var c = reachable[i].colorId;
  colorGroups[c] = (colorGroups[c] || 0) + 1;
}
console.log('边界颜色分组:', JSON.stringify(colorGroups));

console.log('\n=== 测试4: 模拟游玩流程 ===');
AntSolver.Simulator.enter(level);
for (var step = 0; step < 5; step++) {
  var moves = AntSolver.Simulator.getAvailableMoves();
  if (moves.length === 0) break;
  var picked = moves[0];
  var success = AntSolver.Simulator.pickFromQueue(picked.queueIdx);
  var s = AntSolver.Simulator.getState();
  console.log('步骤' + (step+1) + ': Q' + (picked.queueIdx+1) + 
    ' ' + AntSolver.getColorName(picked.antBox.color) + '×' + picked.antBox.count +
    ' | 消除:' + s.eliminatedPixels + '/' + s.totalPixels +
    ' | 暂存:' + s.buffer.length);
}
AntSolver.Simulator.exit();

console.log('\n=== 测试5: 求解器 ===');
var startTime = Date.now();
var result = AntSolver.Solver.solve(level);
var elapsed = Date.now() - startTime;
console.log('求解结果:', result.completed ? '✅ 通关' : '❌ 未通关');
console.log('步数:', result.steps);
console.log('消除:', result.eliminatedPixels + '/' + result.totalPixels);
console.log('进度:', result.progress + '%');
console.log('最大暂存:', result.maxBuffer);
console.log('平均暂存:', result.avgBuffer);
console.log('耗时:', elapsed + 'ms');
if (result.retryRound) console.log('重试轮次:', result.retryRound);

console.log('\n=== 测试6: 撤销功能 ===');
AntSolver.Simulator.enter(level);
AntSolver.Simulator.pickFromQueue(0);
var s1 = AntSolver.Simulator.getState();
console.log('操作后消除:', s1.eliminatedPixels);
AntSolver.Simulator.undo();
var s2 = AntSolver.Simulator.getState();
console.log('撤销后消除:', s2.eliminatedPixels);
console.log('撤销正确:', s2.eliminatedPixels === 0 ? '✅' : '❌');
AntSolver.Simulator.exit();

console.log('\n=== 所有测试完成 ===');
