const install = document.getElementById('install-app');
const download = document.getElementById('download-apk');
let promptEvent;

window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    promptEvent = event;
    install.hidden = false;
});

install.addEventListener('click', async () => {
    if (!promptEvent) return;
    const event = promptEvent;
    promptEvent = null;
    install.hidden = true;
    await event.prompt();
});

window.addEventListener('appinstalled', () => {
    promptEvent = null;
    install.hidden = true;
});

if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('/service-worker.js').catch(() => {});
}

fetch('/downloads/ticketsasa.apk', { method: 'HEAD', cache: 'no-store' })
    .then(response => {
        if (response.ok && response.headers.get('content-type')?.startsWith('application/vnd.android.package-archive')) {
            download.hidden = false;
        }
    }).catch(() => {});
