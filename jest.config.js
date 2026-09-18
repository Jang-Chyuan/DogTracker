module.exports = {
  preset: '@react-native/jest-preset',
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|react-native-url-polyfill|@react-native(-community)?)/)',
  ],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  // A git worktree under <repo>/.claude/worktrees/* brings its own node_modules,
  // which makes jest see two copies of React from the main checkout and every
  // renderer test die on useImperativeHandle being null.
  modulePathIgnorePatterns: ['<rootDir>/.claude/'],
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/.claude/'],
  moduleNameMapper: {
    '^react-native-maps$': '<rootDir>/__mocks__/react-native-maps.js',
    '^react-native-ble-plx$': '<rootDir>/__mocks__/react-native-ble-plx.js',
    '^react-native-nitro-sqlite$':
      '<rootDir>/__mocks__/react-native-nitro-sqlite.js',
  },
};
