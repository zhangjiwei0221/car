/**
 * 批量验证关卡是否死锁（卡死）
 * 使用 validator/js/app.js 中的 LevelActivityValidator 逻辑
 * 对 json关卡文件 目录下所有 JSON 文件进行验证
 */

const fs = require('fs');
const path = require('path');

// 直接引入 validator 逻辑
require('./validator/js/app.js');

const LEVEL_DIR = path.join(__dirname, 'json关卡文件');

// 获取所有 JSON 文件并按关卡号排序
const files = fs.readdirSync(LEVEL_DIR)
  .filter(f => f.endsWith('.json') && f.startsWith('G5_uy_level_'))
  .sort((a, b) => {
    const numA = parseInt(a.match(/\d+/)[0]);
    const numB = parseInt(b.match(/\d+/)[0]);
    return numA - numB;
  });

console.log(`共发现 ${files.length} 个关卡文件，开始验证...\n`);

let passCount = 0;
let failCount = 0;
let errorCount = 0;
const failedLevels = [];
const errorLevels = [];

for (const file of files) {
  const filePath = path.join(LEVEL_DIR, file);
  let levelData;
  
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    levelData = JSON.parse(content);
  } catch (e) {
    errorCount++;
    errorLevels.push({ file, error: 'JSON解析失败: ' + e.message });
    continue;
  }

  const validator = new LevelActivityValidator(levelData);
  const result = validator.validate();

  if (result.success) {
    passCount++;
  } else {
    failCount++;
    failedLevels.push({ file, result });
  }
}

// 输出汇总
console.log('='.repeat(60));
console.log('验证完成汇总');
console.log('='.repeat(60));
console.log(`总关卡数: ${files.length}`);
console.log(`验证通过: ${passCount}`);
console.log(`验证失败(死锁): ${failCount}`);
console.log(`文件错误: ${errorCount}`);
console.log('='.repeat(60));

if (errorLevels.length > 0) {
  console.log('\n--- 文件错误列表 ---');
  for (const item of errorLevels) {
    console.log(`  ${item.file}: ${item.error}`);
  }
}

if (failedLevels.length > 0) {
  console.log('\n--- 死锁关卡列表 ---');
  for (const item of failedLevels) {
    const levelNum = item.file.match(/\d+/)[0];
    console.log(`\n第 ${levelNum} 关 (${item.file}):`);
    console.log(`  ${item.result.message}`);
    if (item.result.failures && item.result.failures.length > 0) {
      const maxShow = 10;
      const failures = item.result.failures;
      for (let i = 0; i < Math.min(failures.length, maxShow); i++) {
        const f = failures[i];
        let detail = `  ${i + 1}. [${f.type}]`;
        if (f.pos && f.cell) {
          detail += ` 第${f.pos.row + 1}行第${f.pos.col + 1}列 id=${f.cell.id} type=${Array.isArray(f.cell.type) ? '[' + f.cell.type.join(',') + ']' : f.cell.type}`;
        }
        if (f.message) {
          detail += ` - ${f.message}`;
        }
        console.log(detail);
      }
      if (failures.length > maxShow) {
        console.log(`  ... 还有 ${failures.length - maxShow} 项`);
      }
    }
  }
}

if (failedLevels.length === 0 && errorLevels.length === 0) {
  console.log('\n全部关卡验证通过，无死锁！');
}
