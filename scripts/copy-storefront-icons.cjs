const { readFileSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');

const bundle = readFileSync(require.resolve('lucide/dist/umd/lucide.min.js'), 'utf8');
writeFileSync(resolve(__dirname, '../assets/lucide.js'), bundle.replace(/^\/\/# sourceMappingURL=.*$/m, ''));
