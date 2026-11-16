const form = document.querySelector('#publish');
const tiers = document.querySelector('#tiers');
const add = document.querySelector('#add-tier');
const status = form.querySelector('output');
const submit = form.querySelector('[type=submit]');

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

form.addEventListener('submit', async event => {
    event.preventDefault();
    submit.disabled = true;
    status.textContent = 'Publishing...';
    try {
        const data = new FormData(form);
        const file = data.get('image');
        if (file.size > 1000000) throw new Error('Choose an image under 1 MB.');
        const image = file.size ? await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('Could not read the photo.'));
            reader.readAsDataURL(file);
        }) : null;
        const localTime = field => data.get(field) + '+03:00';
        if (!(Date.parse(localTime('salesOpen')) < Date.parse(localTime('salesClose')) &&
              Date.parse(localTime('salesClose')) <= Date.parse(localTime('startsAt')) &&
              Date.parse(localTime('startsAt')) > Date.now())) {
            throw new Error('Set a future event start. Sales must open before closing, and close by the event start.');
        }
        const response = await fetch('/api/admin/events', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'X-Admin-Action': 'dashboard' },
            body: JSON.stringify({
                title: data.get('title'), venue: data.get('venue'), description: data.get('description'),
                startsAt: localTime('startsAt'), salesOpen: localTime('salesOpen'), salesClose: localTime('salesClose'), image,
                tiers: Array.from(tiers.children, tier => ({
                    title: tier.querySelector('[name=tierTitle]').value,
                    priceKes: Number(tier.querySelector('[name=price]').value),
                    capacity: Number(tier.querySelector('[name=capacity]').value),
                    gate: tier.querySelector('[name=gate]').value
                }))
            })
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
