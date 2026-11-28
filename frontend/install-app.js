const install = document.getElementById('install-app');
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
