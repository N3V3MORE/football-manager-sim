const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function(id) {
  if (id === 'react-native-get-random-values') return {};
  if (id === '@react-native-async-storage/async-storage') {
    return { default: { getItem: async()=>null, setItem: async()=>null, removeItem: async()=>null } };
  }
  return originalRequire.apply(this, arguments);
};
