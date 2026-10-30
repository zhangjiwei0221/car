(function () {
  var filesInput = document.getElementById('files');
  var fileCount = document.getElementById('fileCount');
  var goBtn = document.getElementById('go');
  var resultEl = document.getElementById('result');
  var picked = [];

  filesInput.addEventListener('change', function (e) {
    picked = Array.prototype.slice.call(e.target.files);
    fileCount.textContent = picked.length ? ('已选择 ' + picked.length + ' 个文件') : '未选择文件';
    goBtn.disabled = picked.length === 0;
  });

  function readFileText(file) {
    return new Promise(function (resolve) {
      var r = new FileReader();
      r.onload = function (ev) { resolve({ name: file.name, content: String(ev.target.result) }); };
      r.onerror = function () { resolve({ name: file.name, content: '' }); };
      r.readAsText(file);
    });
  }

  goBtn.addEventListener('click', async function () {
    if (picked.length === 0) return;
    goBtn.disabled = true;
    resultEl.className = 'hint';
    resultEl.textContent = '读取文件中…';
    var files = await Promise.all(picked.map(readFileText));
    var params = {
      groupSize: +document.getElementById('pGroupSize').value || 5,
      bossThreshold: +document.getElementById('pBoss').value,
      startLevel: +document.getElementById('pStart').value || 1,
      nameTemplate: document.getElementById('pName').value || '第{level}关_{name}',
      keepAnalysis: document.getElementById('pKeep').checked,
    };
    var baRaw = document.getElementById('pBossAnchor').value.trim();
    var biRaw = document.getElementById('pBossInterval').value.trim();
    params.bossAnchor = baRaw === '' ? undefined : +baRaw;
    params.bossInterval = biRaw === '' ? undefined : +biRaw;
    resultEl.textContent = '排序中…';
    try {
      var resp = await fetch('/api/sort-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: files, params: params }),
      });
      var data = await resp.json();
      if (!data.ok) {
        resultEl.className = 'err';
        resultEl.textContent = '失败：' + (data.error || '未知错误');
      } else {
        var lines = [];
        lines.push('✅ 完成：已输出 ' + data.written + '/' + data.total + ' 关到文件夹「' + data.folder + '」');
        lines.push('（含 排序清单.csv，位于产出包根目录）');
        if (data.missingAnalysis && data.missingAnalysis.length) {
          lines.push('\n⚠ 以下 ' + data.missingAnalysis.length + ' 关缺少内嵌 _analysis（按难度0参与排序，建议用生产器产出的关卡）：');
          lines.push(data.missingAnalysis.join(', '));
        }
        if (data.parseErrors && data.parseErrors.length) {
          lines.push('\n⚠ 以下文件解析失败被跳过：' + data.parseErrors.join(', '));
        }
        resultEl.className = (data.missingAnalysis && data.missingAnalysis.length) ? 'warn' : 'ok';
        resultEl.textContent = lines.join('\n');
      }
    } catch (e) {
      resultEl.className = 'err';
      resultEl.textContent = '请求失败：' + (e && e.message || e);
    }
    goBtn.disabled = false;
  });
})();
