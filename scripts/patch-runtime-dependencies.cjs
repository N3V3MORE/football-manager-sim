const fs = require('node:fs');
const path = require('node:path');

const patchCompatibility = (filePath, original, patched) => {
  const source = fs.readFileSync(filePath, 'utf8');
  if (source.includes(original)) {
    fs.writeFileSync(filePath, source.replace(original, patched));
  } else if (!source.includes(patched)) {
    throw new Error(`Dependency changed; review compatibility in ${filePath} before installing.`);
  }
};

// query-string 7 expects a CommonJS function. The security-fixed decoder 0.5
// exports that same function as an ESM default; preserve the router's API.
patchCompatibility(require.resolve('query-string'),
  "const decodeComponent = require('decode-uri-component');",
  "const decodeComponent = require('decode-uri-component').default;");

// image-size 2 accepts buffers, while Metro 0.83 also passes image filenames.
// Adapt that one call without changing Metro's asset metadata or loader.
patchCompatibility(path.join(path.dirname(require.resolve('metro/package.json')), 'src', 'Assets.js'),
  '(0, _imageSize.default)(isImageInput)',
  '(0, _imageSize.default)(typeof isImageInput === "string" ? _fs.default.readFileSync(isImageInput) : isImageInput)');
