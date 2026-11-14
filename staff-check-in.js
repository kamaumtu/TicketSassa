const form = document.querySelector('#check-in');
const button = form.querySelector('button');
const status = form.querySelector('output');

form.addEventListener('submit', async event => {
    event.preventDefault();
    if (button.disabled) return;
    const code = form.elements.namedItem('code');
    const token = code.value.trim();
    if (!token) {
        status.textContent = 'Enter a ticket code.';
        code.focus();
        return;
    }

    button.disabled = true;
    status.textContent = 'Checking ticket...';
    try {
        const response = await fetch('/api/passes/redeem/' + encodeURIComponent(token), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + form.elements.namedItem('key').value
            },
            body: JSON.stringify({ gate: form.elements.namedItem('gate').value }),
            signal: AbortSignal.timeout(12000)
        });
        const result = await response.json();
        if (response.ok && result.status === 'USED') {
            status.textContent = 'Checked in: ' + result.passReference;
            code.value = '';
        } else {
            status.textContent = result.message || 'Check-in could not be confirmed.';
        }
    } catch {
        status.textContent = 'Check-in could not be confirmed. Check the connection before retrying.';
    } finally {
        button.disabled = false;
        code.focus();
        code.select();
    }
});
