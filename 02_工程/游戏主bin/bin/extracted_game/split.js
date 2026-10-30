const fs = require('fs');
const html = fs.readFileSync('game.html', 'utf8');

// crude split of <script ...>...</script> blocks
const re = /<script([^>]*)>([\s\S]*?)<\/script>/g;
let m, i = 0;
fs.mkdirSync('scripts', { recursive: true });
const index = [];
while ((m = re.exec(html)) !== null) {
  const attrs = m[1].trim();
  const body = m[2];
  const name = `scripts/s${String(i).padStart(2,'0')}.js`;
  fs.writeFileSync(name, body);
  index.push(`${name}\tattrs=[${attrs}]\tlen=${body.length}`);
  i++;
}
fs.writeFileSync('scripts/_index.txt', index.join('\n'));
console.log(index.join('\n'));
