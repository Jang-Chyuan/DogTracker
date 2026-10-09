import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import resources from '../src/i18n/zh-TW.json';
import deckSnapshot from './fixtures/i18n-copy-deck.json';
import additions from '../i18n/deck-additions.json';
import exampleMappings from '../i18n/deck-template-mappings.json';
import { t } from '../src/i18n';

const root = path.resolve(__dirname, '..');
const cjk = /[\u3400-\u9fff\uf900-\ufaff]/u;
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)],
);
const files = [path.join(root, 'App.js'), ...walk(path.join(root, 'src'))]
  .filter(file => /\.[jt]sx?$/.test(file) && !/[/\\]i18n[/\\]/.test(file));
const violations = [];
const calls = [];
const fragmentJoins = [];
const translationWrites = [];
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  const ast = parse(source, { sourceType: 'unambiguous', plugins: ['jsx', 'typescript'] });
  const addressDataEnd = file.endsWith('AddressLookup.js') ? source.indexOf('export function describePlace') : -1;
  traverse(ast, {
    ImportSpecifier(nodePath) {
      if (nodePath.node.imported.name !== 't') return;
      const binding = nodePath.scope.getBinding(nodePath.node.local.name);
      for (const write of binding.constantViolations) translationWrites.push(`${path.relative(root, file)}:${write.node.loc.start.line}`);
    },
    enter(nodePath) {
      const node = nodePath.node;
      // Only the administrative normalization data is exempt, not describePlace UI.
      if (node.start < addressDataEnd) return;
      const directTranslation = value => value?.type === 'CallExpression' && value.callee.name === 't';
      if ((node.type === 'BinaryExpression' && node.operator === '+' &&
          [node.left, node.right].some(directTranslation)) ||
          (node.type === 'TemplateLiteral' && node.expressions.some(directTranslation))) {
        fragmentJoins.push(`${path.relative(root, file)}:${node.loc.start.line}`);
      }
      const text = node.type === 'StringLiteral' || node.type === 'JSXText' ? node.value
        : node.type === 'TemplateElement' ? node.value.cooked || node.value.raw : null;
      const devFixture = /[/\\]dev[/\\]/.test(file) && !file.endsWith('AlertPreview.js');
      const logMessage = nodePath.findParent(parent => parent.isCallExpression() &&
        parent.node.callee.type === 'MemberExpression' &&
        /^(logger|console)$/.test(parent.node.callee.object.name));
      if (!devFixture && !logMessage && text && cjk.test(text)) violations.push(`${path.relative(root, file)}:${node.loc.start.line} ${text}`);
      if (node.type === 'CallExpression' && node.callee.name === 't') {
        const key = node.arguments[0];
        calls.push({ file: path.relative(root, file), line: node.loc.start.line,
          key: key?.type === 'StringLiteral' ? key.value : null, params: node.arguments[1] });
      }
    },
  });
}
const paramNames = { 名稱: 'name', 狗名: 'dogName', 數量: 'count', 距離: 'distance', 時刻: 'time', 時長: 'duration',
  百分比: 'percentage', 日期: 'date', 地址: 'address', 帳號: 'account', 月: 'month', 日: 'day', 區: 'district',
  版本: 'version', 原因: 'reason', 編號: 'number' };
const mappedTemplate = template => {
  const counts = {};
  return template.replace(/\{([^{}]+)\}/g, (_, chinese) => {
    const name = paramNames[chinese] || (/^[A-Za-z][A-Za-z0-9_]*$/.test(chinese) ? chinese : null);
    if (!name) throw new Error(`Unmapped deck parameter: ${chinese}`);
    counts[name] = (counts[name] || 0) + 1;
    return `{{${name}${counts[name] > 1 ? counts[name] : ''}}}`;
  });
};

test('no Chinese UI literals outside resources, dev fixtures and address data', () => {
  expect(violations).toEqual([]);
});

test('translated fragments are not directly concatenated or embedded in template literals', () => {
  expect(fragmentJoins).toEqual([]);
});

test('all translation calls are static, exist and supply exactly their named parameters', () => {
  const failures = [];
  for (const call of calls) {
    if (!call.key || typeof resources[call.key] !== 'string') { failures.push(call); continue; }
    const required = [...new Set([...resources[call.key].matchAll(/\{\{([^{}]+)\}\}/g)].map(match => match[1]))].sort();
    const supplied = (call.params?.properties || []).map(property => property.key?.name || property.key?.value).sort();
    if (JSON.stringify(required) !== JSON.stringify(supplied)) failures.push({ ...call, params: undefined, required, supplied });
  }
  expect(failures).toEqual([]);
});

test('every used copy-deck id exactly preserves its authoritative template after parameter mapping', () => {
  const deck = new Map([...deckSnapshot, ...additions].map(row => [row.id, row.tpl]));
  const mismatches = Object.keys(resources).filter(key => /^c\d+$/.test(key))
    .filter(key => !deck.has(key) || resources[key] !== mappedTemplate(exampleMappings[key]?.tpl || deck.get(key)))
    .map(key => ({ key, actual: resources[key], deck: deck.get(key) }));
  expect(mismatches).toEqual([]);
});

test('the checked-in copy-deck snapshot agrees with the external deck when available', () => {
  const external = path.join(root, '.deck-copy_rows.json');
  if (fs.existsSync(external)) {
    const rows = JSON.parse(fs.readFileSync(external, 'utf8')).map(({ id, tpl }) => ({ id, tpl }));
    expect(deckSnapshot).toEqual(rows);
  }
});

test('resources have no unused keys', () => {
  const used = new Set([...calls.map(call => call.key), ...nativeKeys]);
  expect(Object.keys(resources).filter(key => !used.has(key))).toEqual([]);
});

test('interpolation preserves numbers, empty text, raw markup and replacement syntax', () => {
  expect(t('c177', { number: 0 })).toBe('接收器 0');
  expect(t('c168', { dogName: '<狗>&$&' })).toBe('<狗>&$& 不在接收範圍');
  expect(t('c168', { dogName: '' })).toBe(' 不在接收範圍');
  expect(() => t('missing.key')).toThrow('Missing translation');
});

const nativeFiles = walk(path.join(root, 'android/app/src/main')).filter(file => /\.(kt|xml)$/.test(file) && !file.endsWith('/values/strings.xml'));
const nativeKeys = new Set();
const nativeViolations = [];
for (const file of nativeFiles) {
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(/(?:R\.string\.|@string\/)([A-Za-z0-9_]+)/g)) nativeKeys.add(match[1]);
  if (!file.endsWith('.kt')) continue;
  // Keep strings intact before discarding comments; covers Kotlin interpolation and raw strings.
  const tokens = source.matchAll(/"""[\s\S]*?"""|"(?:\\.|[^"\\])*"|\/\*[\s\S]*?\*\/|\/\/[^\n]*|[^"/]+|./g);
  for (const token of tokens) {
    if (token[0].startsWith('//') || token[0].startsWith('/*')) continue;
    const lineStart = source.lastIndexOf('\n', token.index) + 1;
    const line = source.slice(lineStart, source.indexOf('\n', token.index) < 0 ? source.length : source.indexOf('\n', token.index));
    if (/\bAppLog\.[diwe]\(/.test(line)) continue;
    if (cjk.test(token[0])) nativeViolations.push(`${path.relative(root, file)}:${source.slice(0, token.index).split('\n').length} ${token[0]}`);
  }
}

test('native Kotlin has no Chinese literals outside resources and log messages', () => {
  expect(nativeViolations).toEqual([]);
  expect([...nativeKeys].filter(key => typeof resources[key] !== 'string')).toEqual([]);
});

test('all production resource keys are copy-deck ids; new ids never reuse retired ids', () => {
  expect(Object.keys(resources).filter(key => !/^(c\d+|dev\..+)$/.test(key))).toEqual([]);
  const ids = [...deckSnapshot, ...additions].map(row => row.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(additions.filter(row => Number(row.id.slice(1)) < 433)).toEqual([]);
  expect(additions.filter(row => row.src !== '程式（062 補登）' || row.kind !== '定稿' || !row.area || !row.screens.length)).toEqual([]);
  expect(additions.filter(row => row.supersedes && !deckSnapshot.some(old => old.id === row.supersedes))).toEqual([]);
  const text = fs.readFileSync(path.join(root, 'src/i18n/zh-TW.json'), 'utf8');
  const rawKeys = [...text.matchAll(/^ {2}"([^"]+)":/gm)].map(match => match[1]);
  expect(rawKeys.length).toBe(Object.keys(resources).length);
});

test('strings.xml and native parity are generated from the single canonical JSON resource', () => {
  expect(() => execFileSync(process.execPath, ['i18n/generate-native.cjs', '--check'], { cwd: root })).not.toThrow();
});

test('copy removed by D15 and the design decisions stays out of production resources', () => {
  const retired = /上次用|出發（手動）|還沒出發|確認出發中…|沒辦法自動判斷出發|主角|資料來源/;
  expect(Object.entries(resources).filter(([key, value]) => !key.startsWith('dev.') && retired.test(value))).toEqual([]);
  // The cursor retains the expressly specified c342/c343; no movement-row exclusion badge.
  expect(Object.keys(resources).filter(key => resources[key].includes('不算距離') && !['c342', 'c343'].includes(key))).toEqual([]);
});

test('translation imports are never assigned to or incremented', () => {
  expect(translationWrites).toEqual([]);
});

// Only fixed example values are generalized; authoritative wording stays intact.
test('deck example mappings preserve wording and retired ids stay unused', () => {
  const examples = { c304: '3', c305: '2', c292: 'N' };
  for (const [id, mapping] of Object.entries(exampleMappings)) {
    expect(deckSnapshot.find(row => row.id === id).tpl).toBe(mapping.example);
    const values = id === 'c267' ? { expected: '7', got: '3' } : id === 'c295' ? { expected: '8', got: '3' } : { 數量: examples[id] };
    expect(mapping.tpl.replace(/\{([^{}]+)\}/g, (placeholder, name) => values[name] ?? placeholder)).toBe(mapping.example);
  }
  for (const row of additions.filter(item => item.retired)) {
    expect(resources[row.id]).toBeUndefined();
    expect(resources[row.replaced_by]).toBeDefined();
  }
});
