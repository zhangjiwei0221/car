var fs = require('fs');
var AntSolver = {};
eval(fs.readFileSync(__dirname + '/js/utils.js', 'utf-8'));
eval(fs.readFileSync(__dirname + '/js/simulator.js', 'utf-8'));
eval(fs.readFileSync(__dirname + '/js/solver.js', 'utf-8'));

// 洋葱层关卡: 红色外框 → 绿色中层 → 蓝色核心
// 必须先消红才能碰绿，先消绿才能碰蓝
var blocks = [];
for (var r = 0; r < 10; r++) {
  var row = [];
  for (var c = 0; c < 10; c++) {
    if (r === 0 || r === 9 || c === 0 || c === 9) row.push(1);      // 红(外)
    else if (r === 1 || r === 8 || c === 1 || c === 8) row.push(4); // 绿(中)
    else row.push(6);                                                 // 蓝(内)
  }
  blocks.push(row);
}
var R=0, G=0, B=0;
for(var r=0;r<10;r++) for(var c=0;c<10;c++){
  if(blocks[r][c]===1) R++;
  if(blocks[r][c]===4) G++;
  if(blocks[r][c]===6) B++;
}
console.log('洋葱层关卡: R=' + R + ' G=' + G + ' B=' + B + ' 总=' + (R+G+B));

// --- 测试1: 正序（红→绿→蓝） ---
console.log('\n--- [正序] 红→绿→蓝 ---');
var q1 = [];
for(var i=0; i<Math.ceil(R/6); i++) q1.push({color:1, count:Math.min(6, R-i*6)});
for(var i=0; i<Math.ceil(G/6); i++) q1.push({color:4, count:Math.min(6, G-i*6)});
for(var i=0; i<Math.ceil(B/6); i++) q1.push({color:6, count:Math.min(6, B-i*6)});
var level1 = AntSolver.parseLevel({blocks:blocks, queues:[q1], bufferLimit:5});
var r1 = AntSolver.Solver.solve(level1);
console.log(r1.completed?'PASS':'FAIL('+r1.progress+'%)', '步数:'+r1.steps, '暂存峰:'+r1.maxBuffer, r1.time+'ms');

// --- 测试2: 逆序（蓝→绿→红） ---
// 蓝色被包围无法消除→必须全进暂存→暂存溢出→应该失败（如果暂存不够）
console.log('\n--- [逆序] 蓝→绿→红 (蓝被包围→进暂存) ---');
var q2 = [];
for(var i=0; i<Math.ceil(B/6); i++) q2.push({color:6, count:Math.min(6, B-i*6)});
for(var i=0; i<Math.ceil(G/6); i++) q2.push({color:4, count:Math.min(6, G-i*6)});
for(var i=0; i<Math.ceil(R/6); i++) q2.push({color:1, count:Math.min(6, R-i*6)});
var level2 = AntSolver.parseLevel({blocks:blocks, queues:[q2], bufferLimit:5});
var r2 = AntSolver.Solver.solve(level2);
console.log(r2.completed?'PASS':'FAIL('+r2.progress+'%)', '步数:'+r2.steps, '暂存峰:'+r2.maxBuffer, r2.time+'ms');

// --- 测试3: 双队列(一条红,一条蓝绿混合) ---
console.log('\n--- [双队列] Q1=红, Q2=蓝+绿 ---');
var qa = [], qb = [];
for(var i=0; i<Math.ceil(R/6); i++) qa.push({color:1, count:Math.min(6, R-i*6)});
for(var i=0; i<Math.ceil(B/6); i++) qb.push({color:6, count:Math.min(6, B-i*6)});
for(var i=0; i<Math.ceil(G/6); i++) qb.push({color:4, count:Math.min(6, G-i*6)});
var level3 = AntSolver.parseLevel({blocks:blocks, queues:[qa, qb], bufferLimit:5});
var r3 = AntSolver.Solver.solve(level3);
console.log(r3.completed?'PASS':'FAIL('+r3.progress+'%)', '步数:'+r3.steps, '暂存峰:'+r3.maxBuffer, r3.time+'ms');
if (r3.completed) {
  console.log('操作序列:');
  for (var i = 0; i < r3.pickOrder.length; i++) {
    var p = r3.pickOrder[i];
    process.stdout.write('Q'+(p.queueIdx+1)+':'+AntSolver.getColorName(p.color)+'x'+p.count+' ');
    if ((i+1)%6===0) process.stdout.write('\n');
  }
  console.log('');
}

// --- 测试4: 暂存区压力测试 ---
console.log('\n--- [压力] 暂存上限=3, 逆序 ---');
var level4 = AntSolver.parseLevel({blocks:blocks, queues:[q2], bufferLimit:3});
var r4 = AntSolver.Solver.solve(level4);
console.log(r4.completed?'PASS':'FAIL('+r4.progress+'%)', '步数:'+r4.steps, '暂存峰:'+r4.maxBuffer, r4.time+'ms');
