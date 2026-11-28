const fs = require('fs');
const path = require('path');

const frontendDir = path.resolve(__dirname, '..');
const outDir = path.join(frontendDir, 'pages-dist');

const filesToCopy = [
    'index.html',
    'offline.html',
    'organizer.html',
    'staff-check-in.html',
    'app.js',
    'blog.js',
    'discovered-marketplace.js',
    'install-app.js',
    'organizer.js',
    'service-worker.js',
    'staff-check-in.js',
    'support-answers.js',
    'support-chat.js',
    'travel-offers.js',
    'styles.css',
    'manifest.webmanifest',
    '_headers',
    '_redirects'
];

const dirsToCopy = ['assets'];

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

for (const file of filesToCopy) {
    const src = path.join(frontendDir, file);
    if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(outDir, file));
    }
}

for (const dir of dirsToCopy) {
    const src = path.join(frontendDir, dir);
    if (fs.existsSync(src)) {
        fs.cpSync(src, path.join(outDir, dir), { recursive: true });
    }
}

const catalogComponentSrc = path.join(frontendDir, 'frontend-angular', 'src', 'kenya-event-catalog.js');
if (fs.existsSync(catalogComponentSrc)) {
    const catalogDestDir = path.join(outDir, 'frontend-angular', 'src');
    fs.mkdirSync(catalogDestDir, { recursive: true });
    fs.copyFileSync(catalogComponentSrc, path.join(catalogDestDir, 'kenya-event-catalog.js'));
}

console.log(`Prepared Cloudflare Pages output in ${outDir}`);
