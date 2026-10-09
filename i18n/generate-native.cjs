// zh-TW.json is the source of truth. Run `node i18n/generate-native.cjs` after copy changes.
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const resources = require('../src/i18n/zh-TW.json');
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
const keys = new Set();
for (const file of walk(path.join(root, 'android/app/src/main'))) {
  if (!/\.(kt|xml)$/.test(file) || file.endsWith('/values/strings.xml')) continue;
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(/(?:R\.string\.|@string\/)(c\d+)\b/g)) keys.add(match[1]);
}
const escape = value => '"' + value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n')
  .replace(/\t/g, '\\t').replace(/'/g, "\\'").replace(/"/g, '\\"')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '"';
const ids = [...keys].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
const xml = '<!-- Generated from src/i18n/zh-TW.json by i18n/generate-native.cjs. -->\n<resources>\n' +
  ids.map(id => {
    if (typeof resources[id] !== 'string') throw new Error(`Missing native copy: ${id}`);
    return `    <string name="${id}" formatted="false">${escape(resources[id])}</string>`;
  }).join('\n') + '\n</resources>\n';
const outputs = {
  'android/app/src/main/res/values/strings.xml': xml,
  'src/i18n/native-parity.json': JSON.stringify(ids.map(id => ({ native: id, js: id })), null, 2) + '\n',
};
for (const [file, content] of Object.entries(outputs)) {
  const target = path.join(root, file);
  if (process.argv.includes('--check')) {
    if (fs.readFileSync(target, 'utf8') !== content) throw new Error(`Stale native copy: ${file}`);
  } else fs.writeFileSync(target, content);
}
console.log(`${process.argv.includes('--check') ? 'Checked' : 'Generated'} ${ids.length} native strings and parity mappings.`);
