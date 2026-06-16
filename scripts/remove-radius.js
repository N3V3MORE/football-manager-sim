const fs = require('fs');
const path = require('path');

function walk(dir, callback) {
  fs.readdirSync(dir).forEach(f => {
    const dirPath = path.join(dir, f);
    if (fs.statSync(dirPath).isDirectory()) walk(dirPath, callback);
    else callback(path.join(dir, f));
  });
}

function removeRadiusTarget(file) {
  if (!file.endsWith('.tsx') && !file.endsWith('.ts')) return;
  const content = fs.readFileSync(file, 'utf8');
  if (content.includes('borderRadius')) {
    const res = content.replace(/borderRadius:\s*[^,}\n]+,/g, 'borderRadius: 0,');
    const res2 = res.replace(/borderRadius:\s*[^,}\n]+}/g, 'borderRadius: 0 }');
    fs.writeFileSync(file, res2, 'utf8');
    console.log('Modified', file);
  }
}

['app', 'components'].forEach(dir => {
  if (fs.existsSync(dir)) walk(dir, removeRadiusTarget);
});
