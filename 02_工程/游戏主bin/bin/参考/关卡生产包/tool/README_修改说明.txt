本包为 2026-05-14 修正版工具。

已修正：
1. 网页工具「保存关卡」导出 level.txt，不再导出 level.json。
2. TXT 标准格式：
   第一行：像素矩阵
   后续每行：空格分隔数字矩阵
3. Node 批量关卡生成器不再直接输出 JSON，统一转为标准 TXT。

关键文件：
- dist_new/js/parsers.js
- dist_new/js/terrainUI.js
- dist5_preview/dist 5/js/parsers.js
- dist5_preview/dist 5/js/terrainUI.js
- scripts/levelTxtFormat.js
- scripts/txt_matrix_format.py
- scripts/levelGeneratorFree.js
- scripts/levelGeneratorTxt.js
- scripts/levelGeneratorTxtNoBlack.js
- scripts/levelGeneratorTxt_11color_hard.js
