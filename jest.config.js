module.exports = {
  preset: '@react-native/jest-preset',
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|react-native-url-polyfill|@react-native(-community)?)/)',
  ],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  // git worktree 常被建在 <repo>/.claude/worktrees/*，它自己的 node_modules 會讓
  // jest 在主 checkout 同時看到兩份 React，測試會炸在 useImperativeHandle 為 null。
  modulePathIgnorePatterns: ['<rootDir>/.claude/'],
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/.claude/'],
  moduleNameMapper: {
    '^react-native-maps$': '<rootDir>/__mocks__/react-native-maps.js',
    '^react-native-ble-plx$': '<rootDir>/__mocks__/react-native-ble-plx.js',
    '^react-native-nitro-sqlite$':
      '<rootDir>/__mocks__/react-native-nitro-sqlite.js',
  },
};
