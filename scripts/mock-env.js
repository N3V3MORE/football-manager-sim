
const Module = require('module');
const originalRequire = Module.prototype.require;

// Mock React Native and other modules that don't run in Node
Module.prototype.require = function(id) {
  if (id === 'react-native' || id.startsWith('react-native/')) {
    return {
      Platform: { OS: 'ios' },
      StyleSheet: { create: (obj) => obj },
    };
  }
  if (id === 'react-native-get-random-values') return {};
  if (id === '@react-native-async-storage/async-storage') {
    return { 
      default: { 
        getItem: async () => null, 
        setItem: async () => {}, 
        removeItem: async () => {} 
      } 
    };
  }
  if (id === 'expo-constants') return { default: { expoConfig: {} } };
  if (id === 'expo-font') return { loadAsync: async () => {} };
  return originalRequire.apply(this, arguments);
};
