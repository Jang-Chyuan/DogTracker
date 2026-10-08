// 「地圖標記一律用自己的樣式」: no map marker may fall back to Google's red
// default pin. Every marker goes through StyledMarker and every marker
// element draws a view of its own.
import fs from 'fs';
import path from 'path';
import * as parser from '@babel/parser';
import traverse from '@babel/traverse';
import React from 'react';
import Renderer from 'react-test-renderer';

const root = path.join(__dirname, '..');
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
const MARKER_NAMES = new Set(['Marker', 'StyledMarker', 'GoogleMarker']);

test('every map marker element draws a view of its own; only StyledMarker uses the SDK marker', () => {
  const problems = [];
  for (const file of files(path.join(root, 'src'))) {
    const relative = path.relative(root, file);
    const ast = parser.parse(fs.readFileSync(file, 'utf8'), {
      sourceType: 'module',
      plugins: ['jsx'],
    });
    traverse(ast, {
      JSXElement(node) {
        const name = node.node.openingElement.name.name;
        if (!MARKER_NAMES.has(name)) return;
        const attrs = node.node.openingElement.attributes;
        const hasIcon = attrs.some(a => ['image', 'icon'].includes(a.name?.name));
        // An image/icon marker would be fine for the SDK, but we draw views only.
        if (hasIcon)
          problems.push(`${relative}:${node.node.loc.start.line} <${name}> with an image instead of a view`);
        const hasView = node.node.children.some(
          child =>
            child.type === 'JSXElement' ||
            (child.type === 'JSXExpressionContainer' &&
              child.expression.type !== 'JSXEmptyExpression'),
        );
        if (!hasView)
          problems.push(`${relative}:${node.node.loc.start.line} <${name}> without a view`);
        if (name === 'GoogleMarker' && relative !== 'src/map/GoogleTrackingMap.js')
          problems.push(`${relative}: SDK marker outside GoogleTrackingMap`);
      },
      ImportSpecifier(node) {
        if (
          node.parent.source.value === 'react-native-maps' &&
          node.node.imported.name === 'Marker' &&
          node.node.local.name !== 'GoogleMarker'
        )
          problems.push(`${relative}: Marker imported without going through StyledMarker`);
      },
    });
  }
  expect(problems).toEqual([]);
});

test('StyledMarker hands the SDK its view, and complains in debug when it has none', () => {
  const { StyledMarker } = require('../src/map/GoogleTrackingMap');
  const { Marker } = require('react-native-maps');
  const { View } = require('react-native');
  let renderer;
  Renderer.act(() => {
    renderer = Renderer.create(
      <StyledMarker coordinate={{ latitude: 25, longitude: 121 }}>
        <View testID="own-view" />
      </StyledMarker>,
    );
  });
  const marker = renderer.root.findByType(Marker);
  expect(marker.findByProps({ testID: 'own-view' })).toBeTruthy();

  const error = jest.spyOn(console, 'error').mockImplementation(() => {});
  Renderer.act(() => {
    renderer.update(
      <StyledMarker
        identifier="empty"
        coordinate={{ latitude: 25, longitude: 121 }}
      />,
    );
  });
  expect(error).toHaveBeenCalledWith(expect.stringContaining('empty'));
  error.mockRestore();
});
