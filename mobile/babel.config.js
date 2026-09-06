module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // react-native-worklets must be last. Reanimated is not used for layout
    // today, but gesture-driven overlays in Phase 6 will want it and adding the
    // plugin later is a rebuild everyone forgets to do.
    plugins: ['react-native-worklets/plugin'],
  };
};
