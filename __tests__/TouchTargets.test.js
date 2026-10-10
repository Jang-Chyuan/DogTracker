// Every tappable element (DESIGN.md §5「觸控與按鈕」, 設計稿「元件狀態」「無障礙」):
// - a role and a label for TalkBack (accessibilityLabel, or its own text);
// - a pressed state (PressScale's 0.97 + pressedOverlay, or a style that
//   changes while `pressed`);
// - at least 48dp to the finger: a style of 48dp or more high, or a hitSlop
//   that makes up the difference (the 44dp calendar cell is the design's only
//   exception). The width is checked on the device (scripts/touch-audit.js).
// Checked statically over src (not src/dev, debug only) and App.js.
import fs from 'fs';
import path from 'path';
import * as parser from '@babel/parser';
import traverse from '@babel/traverse';
import * as tokens from '../src/theme/tokens';

const root = path.join(__dirname, '..');
const TOUCHABLES = ['Pressable', 'PressScale'];
// Elements whose target is decided elsewhere, with the reason.
const EXCEPTIONS = new Map([
  // The design's one exception: 44dp calendar cells (DESIGN.md §5.1).
  ['src/mapHistory/HistoryCalendarSheet.js:DayCell', 'calendar cell 44dp (design exception)'],
  // The panel's grab handle: 20dp + 8dp slop each way. The whole header
  // (handle, date row, summary) is the drag target and far taller; a taller
  // tap area would cover the date row's ‹ › and date pill below it.
  ['src/mapHistory/HistoryPanel.js:HistoryPanel', 'handle inside the draggable header'],
  // Full-screen scrims behind sheets: the whole screen is the target.
  ['scrim', 'StyleSheet.absoluteFill'],
]);

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return file.endsWith(path.join('src', 'dev')) ? [] : files(file);
    return /\.jsx?$/.test(file) ? [file] : [];
  });
}

// Evaluates a style value: numbers, token paths, file constants, + - * /.
function evaluator(ast) {
  const imported = {};
  const constants = {};
  for (const node of ast.program.body) {
    if (node.type === 'ImportDeclaration' && /theme\/tokens$/.test(node.source.value)) {
      for (const spec of node.specifiers) {
        if (spec.type === 'ImportSpecifier') imported[spec.local.name] = tokens[spec.imported.name];
      }
    }
    if (node.type === 'VariableDeclaration') {
      for (const decl of node.declarations) {
        if (decl.id.type === 'Identifier' && decl.init) constants[decl.id.name] = decl.init;
      }
    }
  }
  const value = node => {
    if (!node) return undefined;
    switch (node.type) {
      case 'NumericLiteral':
        return node.value;
      case 'Identifier':
        if (node.name in imported) return imported[node.name];
        return constants[node.name] ? value(constants[node.name]) : undefined;
      case 'MemberExpression': {
        const object = value(node.object);
        const key = node.computed ? value(node.property) : node.property.name;
        return object == null ? undefined : object[key];
      }
      case 'BinaryExpression': {
        const a = value(node.left);
        const b = value(node.right);
        if (typeof a !== 'number' || typeof b !== 'number') return undefined;
        return { '+': a + b, '-': a - b, '*': a * b, '/': a / b }[node.operator];
      }
      case 'ObjectExpression':
        return node;
      default:
        return undefined;
    }
  };
  return value;
}

// The StyleSheet entries of a file: name -> ObjectExpression.
function styleEntries(ast) {
  const entries = {};
  traverse(ast, {
    CallExpression(p) {
      const callee = p.node.callee;
      if (callee.type === 'MemberExpression' && callee.object.name === 'StyleSheet' && callee.property.name === 'create') {
        const arg = p.node.arguments[0];
        if (arg?.type !== 'ObjectExpression') return;
        for (const prop of arg.properties) {
          if (prop.type === 'ObjectProperty' && prop.value.type === 'ObjectExpression') {
            entries[prop.key.name ?? prop.key.value] = prop.value;
          }
        }
      }
    },
  });
  return entries;
}

function attributes(element) {
  return Object.fromEntries(
    element.attributes.filter(a => a.type === 'JSXAttribute').map(a => [a.name.name, a.value]),
  );
}

const hasText = jsx =>
  jsx.children?.some(child =>
    (child.type === 'JSXText' && child.value.trim()) ||
    (child.type === 'JSXElement' && (child.openingElement.name.name === 'Text' || hasText(child))) ||
    (child.type === 'JSXExpressionContainer' && child.expression.type === 'JSXElement' && hasText({ children: [child.expression] })),
  );

// Pressable can style its visible child through the children render function,
// while keeping the larger touch target transparent. Ignore the parameter
// declaration: an unused `pressed` parameter is not visual feedback.
function hasPressedChild(element, source) {
  return element.children?.some(child => {
    const fn = child.type === 'JSXExpressionContainer' && child.expression;
    if (!['ArrowFunctionExpression', 'FunctionExpression'].includes(fn?.type)) return false;
    return /\bpressed\b/.test(source.slice(fn.body.start, fn.body.end));
  });
}

function audit() {
  const problems = [];
  let count = 0;
  for (const file of [...files(path.join(root, 'src')), path.join(root, 'App.js')]) {
    const relative = path.relative(root, file);
    const ast = parser.parse(fs.readFileSync(file, 'utf8'), { sourceType: 'module', plugins: ['jsx'] });
    const value = evaluator(ast);
    const entries = styleEntries(ast);
    traverse(ast, {
      JSXElement(p) {
        const opening = p.node.openingElement;
        const name = opening.name.name;
        if (!TOUCHABLES.includes(name)) return;
        // PressScale's own definition passes everything on.
        if (opening.attributes.some(a => a.type === 'JSXSpreadAttribute') && relative === 'src/map/MapControls.js' && !attributes(opening).testID) return;
        count += 1;
        const attrs = attributes(opening);
        const where = `${relative}:${opening.loc.start.line}`;
        const fn = p.getFunctionParent();
        const component = fn?.node.id?.name ?? fn?.parentPath?.node?.id?.name;
        const source = fs.readFileSync(file, 'utf8');
        let styleSource = attrs.style ? source.slice(attrs.style.start, attrs.style.end) : '';
        // A local style variable (const style = kind === 'text' ? styles.text : …).
        for (const [, local] of styleSource.matchAll(/\b([a-zA-Z_]\w*)\b/g)) {
          const init = p.scope.getBinding(local)?.path.node.init;
          if (init && init.start != null && p.scope.getBinding(local).kind === 'const') {
            styleSource += ` ${source.slice(init.start, init.end)}`;
          }
        }
        // Scrims (the whole screen) and tap catchers hidden from TalkBack.
        if (/StyleSheet\.absoluteFill|styles\.scrim\b/.test(styleSource)) return;
        if (attrs.accessible?.expression?.value === false) return;
        const press = attrs.onPress?.expression;
        if (press?.type === 'ArrowFunctionExpression' && press.body.type === 'BlockStatement' && !press.body.body.length) return;
        if (!attrs.accessibilityRole) problems.push(`${where} <${name}> no accessibilityRole`);
        if (!attrs.accessibilityLabel && !hasText(p.node)) problems.push(`${where} <${name}> no accessibilityLabel`);
        const feedback =
          name === 'PressScale' ||
          attrs.android_ripple ||
          /\bpressed\b/.test(styleSource) ||
          hasPressedChild(p.node, source);
        if (!feedback) problems.push(`${where} <${name}> no pressed state`);
        if (EXCEPTIONS.has(`${relative}:${component}`)) return;
        const used = [...styleSource.matchAll(/\b[a-zA-Z_]\w*\.(\w+)/g)].map(m => m[1]).filter(key => entries[key]);
        // The tallest height / minHeight the styles give (undefined: content-sized).
        let styleHeight;
        for (const key of used) {
          for (const prop of entries[key].properties) {
            if (!['height', 'minHeight'].includes(prop.key?.name)) continue;
            const v = value(prop.value);
            if (typeof v === 'number') styleHeight = Math.max(styleHeight ?? 0, v);
          }
        }
        // hitSlop: a number, or { top, bottom, … } (a file constant or tokens).
        let slop = null;
        if (attrs.hitSlop) {
          const expression = attrs.hitSlop.expression;
          const given = expression.type === 'ObjectExpression' ? expression : value(expression);
          if (typeof given === 'number') slop = given * 2;
          else if (given?.type === 'ObjectExpression') {
            const side = name2 => {
              const prop = given.properties.find(item => item.key?.name === name2);
              return prop ? value(prop.value) ?? 0 : 0;
            };
            slop = side('top') + side('bottom');
          } else if (given && typeof given === 'object') slop = (given.top ?? 0) + (given.bottom ?? 0);
          if (slop == null || Number.isNaN(slop)) problems.push(`${where} <${name}> hitSlop not resolvable`);
        }
        const tall = styleHeight != null && styleHeight + (slop ?? 0) >= tokens.touch.min;
        // A content-sized element with a slop: its height is read on the device
        // (scripts/touch-audit.js); the slop itself must be real.
        if (styleHeight == null && slop != null) {
          if (slop <= 0) problems.push(`${where} <${name}> hitSlop of 0`);
          return;
        }
        if (!tall) problems.push(`${where} <${name}> under 48dp high (${styleHeight ?? 'no height'}dp + slop ${slop ?? 0}; ${used.join(',') || 'no style'})`);
      },
    });
  }
  return { problems, count };
}

test('child render feedback requires using pressed in the visible child', () => {
  for (const [source, expected] of [
    ['<Pressable>{({ pressed }) => <View style={pressed && styles.highlight} />}</Pressable>', true],
    ['<Pressable>{({ pressed }) => <View style={styles.disc} />}</Pressable>', false],
    ['<Pressable><View style={styles.disc} /></Pressable>', false],
  ]) {
    const ast = parser.parseExpression(source, { plugins: ['jsx'] });
    expect(hasPressedChild(ast, source)).toBe(expected);
  }
});

test('every tappable element has a role, a label, a pressed state and a 48dp target', () => {
  const { problems, count } = audit();
  expect(count).toBeGreaterThan(60);
  expect(problems).toEqual([]);
});

// 060: a glyph or number drawn inside a fixed shape never grows with the
// system font past that shape (「!」, stop numbers, ✓, ✕, ＋, ›): such a Text
// has allowFontScaling={false}, or the glyph is a vector (BangGlyph, Glyph).
test('glyphs inside fixed shapes do not scale with the font', () => {
  const problems = [];
  for (const file of [...files(path.join(root, 'src')), path.join(root, 'App.js')]) {
    const source = fs.readFileSync(file, 'utf8');
    const ast = parser.parse(source, { sourceType: 'module', plugins: ['jsx'] });
    traverse(ast, {
      JSXElement(p) {
        if (p.node.openingElement.name.name !== 'Text') return;
        const only = p.node.children.filter(c => !(c.type === 'JSXText' && !c.value.trim()));
        if (only.length !== 1) return;
        const child = only[0];
        const glyph = child.type === 'JSXText' && /^\s*[!✓✕＋›‹]\s*$/.test(child.value);
        const number = child.type === 'JSXExpressionContainer' && /\.number$/.test(source.slice(child.expression.start, child.expression.end));
        if (!glyph && !number) return;
        const attrs = attributes(p.node.openingElement);
        const fixed = attrs.allowFontScaling?.expression?.value === false || !!attrs.maxFontSizeMultiplier;
        if (!fixed) problems.push(`${path.relative(root, file)}:${p.node.loc.start.line} ${source.slice(child.start, child.end).trim()}`);
      },
    });
  }
  expect(problems).toEqual([]);
});
