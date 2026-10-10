import fs from 'fs';
import path from 'path';
import * as parser from '@babel/parser';
import traverse from '@babel/traverse';

const root = path.join(__dirname, '..');
// Dog identity colours and fixed-light PNG output are deliberately independent
// of the phone's scheme. Only this exact palette file is allowed today; the
// current PNG renderer is native, so no JS export file needs an exception.
const literalAllowList = new Set(['src/dogs/DogArt.js']);
function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory()
      ? files(file)
      : /\.[jt]sx?$/.test(file)
      ? [file]
      : [];
  });
}
test('UI has no hard-coded colours or static colour imports; only Google imports the map SDK', () => {
  const problems = [];
  for (const file of [
    ...files(path.join(root, 'src')),
    path.join(root, 'App.js'),
  ]) {
    const relative = path.relative(root, file).split(path.sep).join('/');
    if (relative.startsWith('src/theme/')) continue;
    const ast = parser.parse(fs.readFileSync(file, 'utf8'), {
      sourceType: 'module',
      plugins: ['jsx'],
    });
    traverse(ast, {
      StringLiteral(node) {
        if (
          !literalAllowList.has(relative) &&
          /^(#[\da-f]{3,8}$|rgba?\()/i.test(node.node.value)
        ) {
          problems.push(
            `${relative}:${node.node.loc.start.line} colour ${node.node.value}`,
          );
        }
      },
      TemplateLiteral(node) {
        if (
          !literalAllowList.has(relative) &&
          !node.node.expressions.length &&
          /^(#[\da-f]{3,8}$|rgba?\()/i.test(node.node.quasis[0].value.cooked)
        ) {
          problems.push(
            `${relative}:${node.node.loc.start.line} colour template`,
          );
        }
      },
      ImportDeclaration(node) {
        if (
          node.node.source.value === 'react-native-maps' &&
          relative !== 'src/map/GoogleTrackingMap.js'
        ) {
          problems.push(`${relative}: map SDK`);
        }
        if (
          /theme\/tokens$|theme\/AppTheme$/.test(
            node.node.source.value,
          ) &&
          node.node.specifiers.some(s =>
            [
              'colors',
              'routeColors',
              'settingIcon',
              'opacity',
              'shadow',
              'appColors',
              'floatingShadow',
            ].includes(s.imported?.name),
          )
        ) {
          problems.push(`${relative}: static palette`);
        }
      },
    });
  }
  expect(problems).toEqual([]);
});

// No exceptions today. Any future exact file/property exception must explain
// why a native dimension cannot be expressed by the design tokens.
const styleLiteralAllowList = new Map();
const styleProperty =
  /^(?:padding\w*|margin\w*|gap|rowGap|columnGap|border\w*Radius|fontSize|lineHeight|fontWeight|width|height|minWidth|minHeight|maxWidth|maxHeight|top|bottom|left|right|border\w*Width|hitSlop|pressRetentionOffset)$/;

function styleLiteralProblems(source, relative) {
  const ast = parser.parse(source, { sourceType: 'module', plugins: ['jsx'] });
  const problems = new Set();
  const hasDesignOrRuntime = (value, seen = new Set()) => {
    if (!value?.node) return false;
    const node = value.node;
    if (node.type === 'Identifier') {
      const binding = value.scope.getBinding(node.name);
      if (!binding || !binding.path.isVariableDeclarator()) return true;
      if (seen.has(binding)) return false;
      seen.add(binding);
      return hasDesignOrRuntime(binding.path.get('init'), seen);
    }
    if (node.type === 'MemberExpression' || node.type === 'CallExpression')
      return true;
    if (node.type === 'UnaryExpression')
      return hasDesignOrRuntime(value.get('argument'), seen);
    if (node.type === 'BinaryExpression')
      return (
        hasDesignOrRuntime(value.get('left'), new Set(seen)) ||
        hasDesignOrRuntime(value.get('right'), new Set(seen))
      );
    return ![
      'NumericLiteral',
      'StringLiteral',
      'BooleanLiteral',
      'NullLiteral',
    ].includes(node.type);
  };
  const check = (value, property, seen = new Set(), ratio = false) => {
    if (!value?.node) return;
    const node = value.node;
    if (
      (node.type === 'NumericLiteral' && node.value !== 0 && !ratio) ||
      (property === 'fontWeight' && node.type === 'StringLiteral')
    ) {
      const reason = styleLiteralAllowList.get(`${relative}:${property}`);
      if (!reason?.trim())
        problems.add(`${relative}:${node.loc.start.line} ${property}`);
      return;
    }
    if (node.type === 'Identifier') {
      const binding = value.scope.getBinding(node.name);
      if (!binding || seen.has(binding) || !binding.path.isVariableDeclarator())
        return;
      seen.add(binding);
      check(binding.path.get('init'), property, seen, ratio);
    } else if (node.type === 'UnaryExpression') {
      check(value.get('argument'), property, seen, ratio);
    } else if (node.type === 'BinaryExpression') {
      // Unitless factors and divisors (size / 2, size * 0.75) are permitted;
      // adding a length (size + 6) still requires a spacing/component token.
      const arithmetic = hasDesignOrRuntime(value);
      check(
        value.get('left'),
        property,
        seen,
        ratio ||
          (arithmetic &&
            node.operator === '*' &&
            ['NumericLiteral', 'Identifier'].includes(node.left.type)),
      );
      check(
        value.get('right'),
        property,
        seen,
        ratio || (arithmetic && ['*', '/', '**'].includes(node.operator)),
      );
    } else if (node.type === 'ConditionalExpression') {
      check(value.get('consequent'), property, seen, ratio);
      check(value.get('alternate'), property, seen, ratio);
    } else if (node.type === 'CallExpression') {
      value.get('arguments').forEach(arg => check(arg, property, seen, ratio));
    } else if (node.type === 'ObjectExpression') {
      value.get('properties').forEach(prop => {
        if (prop.isObjectProperty())
          check(prop.get('value'), property, seen, ratio);
      });
    } else if (node.type === 'ArrayExpression') {
      value.get('elements').forEach(item => check(item, property, seen, ratio));
    }
  };
  traverse(ast, {
    ObjectProperty(p) {
      const property = p.node.key.name ?? p.node.key.value;
      if (styleProperty.test(property)) check(p.get('value'), property);
    },
    JSXAttribute(p) {
      const property = p.node.name.name;
      const component = p.parent.name.name;
      if (
        styleProperty.test(property) ||
        (property === 'size' && /DogAvatar|Glyph|Icon$|Art$/.test(component)) ||
        (property === 'border' && component === 'DogAvatar')
      ) {
        if (p.node.value?.type === 'JSXExpressionContainer')
          check(p.get('value.expression'), property);
      }
    },
    AssignmentPattern(p) {
      // Size defaults on avatars and icons belong to their component spec too.
      if (p.node.left.name === 'size') check(p.get('right'), 'size');
    },
  });
  return [...problems];
}

test('components use tokens for style dimensions, typography and touch extensions', () => {
  const problems = [];
  for (const file of [
    ...files(path.join(root, 'src')),
    path.join(root, 'App.js'),
  ]) {
    const relative = path.relative(root, file).split(path.sep).join('/');
    if (/^src\/(theme|dev)\//.test(relative)) continue;
    problems.push(
      ...styleLiteralProblems(fs.readFileSync(file, 'utf8'), relative),
    );
  }
  expect(problems).toEqual([]);
});

test.each([
  'const styles = { padding: 6 };',
  'const styles = { top: -3 };',
  'const styles = { width: sizes.marker.normal + 4 };',
  'const HEIGHT = 44; const styles = { minHeight: HEIGHT };',
  'const WIDTH = 40 * 2; const styles = { width: WIDTH };',
  'const styles = { fontWeight: "700" };',
  'const view = <Pressable hitSlop={{ top: 2, bottom: 2 }} />;',
  'const view = <Pressable pressRetentionOffset={6} />;',
  'const view = <DogAvatar size={26} />;',
  'const view = <Glyph size={18} />;',
])('style audit rejects %s', source => {
  expect(styleLiteralProblems(source, 'fixture.js').length).toBeGreaterThan(0);
});

test('style audit permits zero, tokens, negation and unitless geometry ratios', () => {
  expect(
    styleLiteralProblems(
      `
    const HEIGHT = touch.min;
    const styles = { padding: 0, minHeight: HEIGHT, top: -space.s,
      width: sizes.marker.normal / 2,
      height: (touch.min - sizes.chip.height) / 2 };
    const view = <DogAvatar size={sizes.marker.normal} />;
  `,
      'fixture.js',
    ),
  ).toEqual([]);
});
