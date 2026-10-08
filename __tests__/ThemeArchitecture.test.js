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
    const relative = path.relative(root, file);
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
          /theme\/tokens$|theme\/AppTheme$|\/MapTheme$/.test(
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
              'mapColors',
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
