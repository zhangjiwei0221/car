/**
 * 毛线JSON关卡编辑器 - 目标区预览渲染
 */

var YarnLevel = YarnLevel || {};

YarnLevel.TargetViewer = (function() {
  var container = null;
  var lastBlocks = null;     // 缓存最近渲染的blocks，供缩放重绘
  var zoomSize = 8;          // 当前缩放（px/格），由滑块控制

  function init() {
    container = document.getElementById('target-viewer');
  }

  /**
   * 设置缩放尺寸并重绘（供缩放滑块调用）
   */
  function setZoom(px) {
    zoomSize = px;
    if (lastBlocks) render(lastBlocks);
  }

  /**
   * 渲染目标区块（中间放大显示，固定格子尺寸=zoomSize，容器滚动）
   * @param {Array} blocks - 2D数组，元素可为数字或{id,type}
   */
  function render(blocks) {
    if (!container) init();
    if (!blocks || blocks.length === 0) {
      container.innerHTML = '<div style="color:#666;padding:10px;font-size:12px;">无目标区数据</div>';
      lastBlocks = null;
      return;
    }
    lastBlocks = blocks;

    var rows = blocks.length;
    var cols = blocks[0].length;
    var cellSize = zoomSize;

    container.style.gridTemplateColumns = 'repeat(' + cols + ', ' + cellSize + 'px)';
    container.innerHTML = '';

    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var block = blocks[r][c];
        var blockId = YarnLevel.getBlockId(block);
        var cell = document.createElement('div');
        cell.className = 'target-cell';
        cell.style.width = cellSize + 'px';
        cell.style.height = cellSize + 'px';

        if (blockId > 0) {
          var color = YarnLevel.getColorCSS(blockId);
          if (color) {
            cell.style.backgroundColor = color;
          }
        } else {
          cell.style.backgroundColor = 'transparent';
        }

        cell.title = '(' + r + ',' + c + ') id=' + blockId;
        container.appendChild(cell);
      }
    }
  }

  /**
   * 清空目标区
   */
  function clear() {
    if (!container) init();
    container.innerHTML = '<div style="color:#666;padding:10px;font-size:12px;">导入JSON查看目标图案</div>';
    lastBlocks = null;
  }

  return {
    init: init,
    render: render,
    clear: clear,
    setZoom: setZoom
  };
})();
