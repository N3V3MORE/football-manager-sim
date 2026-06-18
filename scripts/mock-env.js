
const Module = require('module');
const originalRequire = Module.prototype.require;
const asyncStorageData = new Map();

const asyncStorageMock = {
  getItem: async (key) => asyncStorageData.has(key) ? asyncStorageData.get(key) : null,
  setItem: async (key, value) => {
    asyncStorageData.set(key, value);
  },
  removeItem: async (key) => {
    asyncStorageData.delete(key);
  },
};
asyncStorageMock.default = asyncStorageMock;
asyncStorageMock.__esModule = true;

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
    return asyncStorageMock;
  }
  if (id === 'expo-constants') return { default: { expoConfig: {} } };
  if (id === 'expo-font') return { loadAsync: async () => {} };
  return originalRequire.apply(this, arguments);
};
