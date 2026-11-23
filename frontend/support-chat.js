(() => {
    const panel = document.getElementById('chat-support-modal');
    if (!panel) return;
    const log = panel.querySelector('[data-support-messages]');
    const input = panel.querySelector('[data-support-input]');
    const form = panel.querySelector('form');
    const send = form.querySelector('[type=submit]');
    const badge = panel.querySelector('[data-support-status]');
    let busy = false;
    let generation = 0;
    let status = {};
    let contacts;
    function welcome() {
        log.replaceChildren();
        append('assistant', 'Welcome to Ticketsassa. I can help you find tickets, check a payment, or understand a booking. Choose a topic below or type your question.');
    }
    function append(who, text, actions = []) {
        const entry = document.createElement('div'); entry.className = 'support-message support-message--' + who;
        const label = document.createElement('span'); label.className = 'support-message-label'; label.textContent = who === 'user' ? 'You' : 'Ticketsassa guide';
        const body = document.createElement('p'); body.textContent = text; entry.append(label, body);
        if (actions.length) {
            const group = document.createElement('div'); group.className = 'support-message-actions';
            for (const action of actions) {
                const button = document.createElement('button'); button.type = 'button'; button.textContent = action.label;
                button.addEventListener('click', () => act(action.id)); group.append(button);
            }
            entry.append(group);
        }
        log.append(entry);
        while (log.children.length > 60) log.firstElementChild.remove();
        log.scrollTop = log.scrollHeight;
    }
    async function read(path) {
        const response = await fetch('/api' + path, { signal: AbortSignal.timeout(6000), cache: 'no-store' });
        if (!response.ok) throw new Error('Service unavailable');
        return response.json();
    }
    async function refreshStatus() {
        const results = await Promise.allSettled([read('/health'), read('/auth/providers')]);
        status = { health: results[0].status === 'fulfilled' ? results[0].value : null,
            auth: results[1].status === 'fulfilled' ? results[1].value : null };
        badge.textContent = !status.health ? 'Service check unavailable' : status.health.database !== 'connected' ? 'Booking service reconnecting' : 'Booking service connected';
        badge.dataset.state = status.health?.database === 'connected' ? 'connected' : 'unavailable';
        return status;
    }
    async function submit(question) {
        if (busy) return;
        const text = String(question ?? input.value).trim().slice(0, 500);
        if (!text) return;
        busy = true; send.disabled = true; input.value = '';
        const turn = generation;
        // Questions stay in this tab. Secrets are redacted before appearing in the transcript.
        const preliminary = window.TicketsassaSupport.answer(text);
        append('user', preliminary.sensitive ? '[Private information omitted]' : text);
        form.setAttribute('aria-busy', 'true');
        panel.querySelector('[data-support-progress]').textContent = 'Checking guidance…';
        try {
            await refreshStatus();
            if (turn !== generation) return;
            const reply = window.TicketsassaSupport.answer(text, status);
            append('assistant', reply.text, reply.actions);
        } finally {
            if (turn === generation) {
                busy = false; send.disabled = false; form.removeAttribute('aria-busy');
                panel.querySelector('[data-support-progress]').textContent = '';
                if (!panel.classList.contains('hidden')) input.focus();
            }
        }
    }
    async function contact() {
        try { contacts = await read('/support/contact'); } catch { contacts = null; }
        append('assistant', contacts?.email || contacts?.phone
            ? 'Contact the Ticketsassa support team using the details below. This opens your email or phone app; no message is sent automatically.'
            : 'A support contact has not been configured for this website yet. Keep your order reference and payment receipt. The site owner needs to add a support email or phone number.');
        if (!contacts) return;
        const entry = log.lastElementChild;
        for (const [text, href] of [[contacts.email, contacts.email ? 'mailto:' + contacts.email : ''], [contacts.phone, contacts.phone ? 'tel:' + contacts.phone : '']]) {
            if (!text) continue;
            const link = document.createElement('a'); link.textContent = text; link.href = href; link.className = 'support-contact-link'; entry.append(link);
        }
        log.scrollTop = log.scrollHeight;
    }
    function act(id) {
        if (busy) return;
        if (id === 'orders') { toggleChatSupport(false); openTicketWallet(); }
        else if (['events', 'flights', 'holidays', 'login'].includes(id)) { toggleChatSupport(false); switchTab(id); }
        else if (id === 'contact') void contact();
        else void submit(id === 'status' ? 'Check service status' : 'Help with M-Pesa payment');
    }
    form.addEventListener('submit', event => { event.preventDefault(); void submit(); });
    panel.querySelectorAll('[data-support-topic]').forEach(button => button.addEventListener('click', () => {
        if (button.dataset.supportTopic === 'orders') act('orders');
        else void submit(button.dataset.supportTopic);
    }));
    panel.querySelector('[data-support-clear]').addEventListener('click', () => {
        generation++; busy = false; send.disabled = false; form.removeAttribute('aria-busy'); input.value = '';
        panel.querySelector('[data-support-progress]').textContent = ''; welcome(); input.focus();
    });
    panel.querySelector('[data-support-contact]').addEventListener('click', () => act('contact'));
    window.ticketSupport = { submit, refreshStatus };
    welcome();
})();
