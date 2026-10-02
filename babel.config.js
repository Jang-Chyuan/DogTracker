module.exports = {
  presets: ['module:@react-native/babel-preset'],
  // Reanimated 4 runs the home sheet's gesture and animations as worklets.
  plugins: ['react-native-worklets/plugin'],
};
