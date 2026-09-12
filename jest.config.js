module.exports = {
  preset: '@react-native/jest-preset',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: {
    '^react-native-ble-plx$': '<rootDir>/__mocks__/react-native-ble-plx.js',
    '^react-native-nitro-sqlite$': '<rootDir>/__mocks__/react-native-nitro-sqlite.js',
  },
};
