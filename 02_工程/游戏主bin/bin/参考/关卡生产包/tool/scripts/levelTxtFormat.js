// Canonical TXT level export helpers.
// Format confirmed by Tian Geng: first line "像素矩阵", then space-separated id matrix rows.

function levelObjectFromJSON(levelJSON) {
  if (typeof levelJSON === 'string') return JSON.parse(levelJSON);
  return levelJSON || {};
}

function matrixFromLevel(levelJSON) {
  const obj = levelObjectFromJSON(levelJSON);
  const source = Array.isArray(obj.spools) && obj.spools.length > 0
    ? obj.spools
    : (Array.isArray(obj.blocks) ? obj.blocks : []);
  return source.map(row => (Array.isArray(row) ? row : []).map(cell => {
    if (typeof cell === 'number') return cell;
    if (cell && typeof cell.id === 'number') return cell.id;
    return 0;
  }));
}

function matrixToTXT(matrix) {
  return '像素矩阵\n' + matrix.map(row => row.map(v => String(Number.isFinite(v) ? v : 0)).join(' ')).join('\n') + '\n';
}

function levelJSONToTXT(levelJSON) {
  return matrixToTXT(matrixFromLevel(levelJSON));
}

module.exports = { levelObjectFromJSON, matrixFromLevel, matrixToTXT, levelJSONToTXT };
