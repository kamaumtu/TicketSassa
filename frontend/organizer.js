const form = document.querySelector('#publish');
const tiers = document.querySelector('#tiers');
const add = document.querySelector('#add-tier');
const status = form.querySelector('output');
const submit = form.querySelector('[type=submit]');
const quickTicket = document.querySelector('#quick-ticket');
const customTickets = document.querySelector('#custom-tickets');
let requestId;

form.elements.ticketSetup.addEventListener('change', () => {
    const quick = form.elements.ticketSetup.value === 'quick';
    quickTicket.hidden = quickTicket.disabled = !quick;
    customTickets.hidden = customTickets.disabled = quick;
});
form.addEventListener('input', () => { requestId = undefined; });

function updateControls() {
    add.disabled = tiers.children.length >= 20;
    for (const button of tiers.querySelectorAll('[data-remove]')) button.disabled = tiers.children.length === 1;
}

function addTier() {
    const tier = document.querySelector('#tier').content.cloneNode(true);
    const remove = tier.querySelector('[data-remove]');
    remove.addEventListener('click', () => {
        remove.closest('fieldset').remove();
        updateControls();
    });
    tiers.append(tier);
    updateControls();
}

add.addEventListener('click', addTier);
addTier();

const starts = form.elements.startsAt;
const opens = form.elements.salesOpen;
const closes = form.elements.salesClose;
opens.value = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 16);
starts.addEventListener('change', () => {
    if (!closes.value || closes.value > starts.value) closes.value = starts.value;
    closes.max = starts.value;
});

async function compressImageForUpload(file) {
    if (!file || !file.size) return { dataUrl: null, originalBytes: 0, finalBytes: 0, mime: '' };
    const originalBytes = file.size;
    // Fast path for already-small WebP/JPEG/PNG files under 180 KB
    if (originalBytes <= 180 * 1024 && /^image\/(webp|jpeg|png)$/i.test(file.type)) {
        const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('Could not read the photo.'));
            reader.readAsDataURL(file);
        });
        return { dataUrl, originalBytes, finalBytes: originalBytes, mime: file.type };
    }
    const bitmapUrl = URL.createObjectURL(file);
    try {
        const img = await new Promise((resolve, reject) => {
            const node = new Image();
            node.onload = () => resolve(node);
            node.onerror = () => reject(new Error('Unsupported or corrupted image file.'));
            node.src = bitmapUrl;
        });
        const maxDim = 1200;
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
            const scale = Math.min(maxDim / width, maxDim / height);
            width = Math.max(1, Math.round(width * scale));
            height = Math.max(1, Math.round(height * scale));
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        let mime = 'image/webp';
        let dataUrl = canvas.toDataURL(mime, 0.82);
        if (!dataUrl.startsWith('data:image/webp')) {
            mime = 'image/jpeg';
            dataUrl = canvas.toDataURL(mime, 0.82);
        }
        for (const q of [0.72, 0.6, 0.48]) {
            if (dataUrl.length <= 650000) break;
            dataUrl = canvas.toDataURL(mime, q);
        }
        if (dataUrl.length > 1380000) {
            throw new Error('Could not compress image under 1 MB. Choose a smaller image.');
        }
        const finalBytes = Math.round((dataUrl.length * 3) / 4);
        return { dataUrl, originalBytes, finalBytes, mime };
    } finally {
        URL.revokeObjectURL(bitmapUrl);
    }
}

const fileInput = form.querySelector('input[type=file][name=image]');
if (fileInput) {
    const helper = document.createElement('small');
    helper.style.display = 'block';
    helper.style.marginTop = '4px';
    helper.style.opacity = '0.8';
    fileInput.insertAdjacentElement('afterend', helper);
    fileInput.addEventListener('change', async () => {
        const f = fileInput.files?.[0];
        if (!f) { helper.textContent = ''; return; }
        helper.textContent = 'Optimizing photo for fast upload…';
        try {
            const opt = await compressImageForUpload(f);
            const fmt = (b) => b >= 1024 * 1024 ? (b / 1024 / 1024).toFixed(2) + ' MB' : Math.round(b / 1024) + ' KB';
            helper.textContent = `Fast upload ready: ${fmt(opt.originalBytes)} → ${fmt(opt.finalBytes)} (${opt.mime.replace('image/', '').toUpperCase()})`;
        } catch (err) {
            helper.textContent = err.message || 'Could not optimize photo.';
        }
    });
}

form.addEventListener('submit', async event => {
    event.preventDefault();
    submit.disabled = true;
    const data = new FormData(form);
    const quick = data.get('ticketSetup') === 'quick';
    delete status.dataset.state;
    status.textContent = 'Optimizing photo & publishing...';
    try {
        const localTime = field => data.get(field) + '+03:00';
        const startsAt = localTime('startsAt');
        const payload = { title: data.get('title'), venue: data.get('venue'), description: data.get('description'), startsAt };
        if (quick) {
            requestId ??= crypto.randomUUID();
            payload.requestId = requestId;
            payload.quickTicket = {
                priceKes: Number(data.get('quickPrice')), capacity: Number(data.get('quickCapacity')),
                gate: data.get('quickGate')
            };
        } else {
            payload.salesOpen = localTime('salesOpen');
            payload.salesClose = localTime('salesClose');
            payload.tiers = Array.from(tiers.children, tier => ({
                title: tier.querySelector('[name=tierTitle]').value,
                priceKes: Number(tier.querySelector('[name=price]').value),
                capacity: Number(tier.querySelector('[name=capacity]').value),
                gate: tier.querySelector('[name=gate]').value
            }));
        }
        const file = data.get('image');
        if (file && file.size > 0) {
            const compressed = await compressImageForUpload(file);
            payload.image = compressed.dataUrl;
            status.textContent = `Uploading optimized photo (${Math.round(compressed.finalBytes / 1024)} KB)...`;
        } else {
            payload.image = null;
        }
        const response = await fetch('/api/admin/events', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'X-Admin-Action': 'dashboard' },
            body: JSON.stringify(payload)
        });
        const result = await response.json().catch(() => null);
        if (response.status === 401 || response.status === 403) {
            throw new Error('Sign in through Admin again, then retry publishing.');
        }
        if (!response.ok) throw new Error(result?.message ||
            (response.status === 413 ? 'The event photo is too large.' : 'The event could not be published. Try again.'));
        const link = document.createElement('a');
        link.href = '/?view=events&event=' + encodeURIComponent(result.data.id);
        link.textContent = 'View published event';
        status.dataset.state = 'success';
        status.replaceChildren('Event published. ', link);
    } catch (error) {
        status.dataset.state = 'error';
        status.textContent = error.message;
    } finally {
        submit.disabled = false;
    }
});
