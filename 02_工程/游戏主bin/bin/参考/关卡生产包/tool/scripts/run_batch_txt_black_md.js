/**
 * Batch generate TXT levels with the 319 black-block workflow.
 * Usage: node scripts/run_batch_txt_black_md.js <inputDir> <outputDir>
 */
const path = require('path');
const fs = require('fs');
const gen = require('./levelGeneratorTxt');

const [,, inputDir, outputDir] = process.argv;
if (!inputDir || !outputDir) {
  console.error('Usage: node scripts/run_batch_txt_black_md.js <inputDir> <outputDir>');
  process.exit(1);
}

(async () => {
  const files = fs.readdirSync(inputDir)
    .filter(f => f.endsWith('.txt'))
    .sort((a, b) => {
      const an = parseInt(path.basename(a, '.txt'), 10);
      const bn = parseInt(path.basename(b, '.txt'), 10);
      if (!Number.isNaN(an) && !Number.isNaN(bn)) return an - bn;
      return a.localeCompare(b);
    })
    .map(f => path.join(inputDir, f));

  console.log(`Using workflow: 319关卡生产工作流程_TXT导入15x15图案_最终版(4).md`);
  console.log(`共 ${files.length} 个关卡，开始生产...`);
  const { generated, subpar } = await gen.generateLevels(files, outputDir, {
    failedLogPath: path.join(outputDir, 'failed.txt'),
  });
  console.log(`完成：达标 ${generated.length}，不达标/失败 ${subpar.length}，共 ${files.length}`);
})();
