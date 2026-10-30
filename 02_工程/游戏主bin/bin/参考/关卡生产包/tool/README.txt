yarn_txt_tool_fixed_20260514

Fixed on 2026-05-14:
1. Web tool Save Level exports level.txt instead of level.json.
2. TXT format:
   像素矩阵
   1 2 3
   4 5 6
3. Node batch level generators export standard TXT instead of raw JSON.

Key files:
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
