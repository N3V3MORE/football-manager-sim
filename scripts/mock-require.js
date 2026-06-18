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

Module.prototype.require = function(id) {
  if (id === 'react-native-get-random-values') return {};
  if (id === '@react-native-async-storage/async-storage') {
    return asyncStorageMock;
  }
  return originalRequire.apply(this, arguments);
};
