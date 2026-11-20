/* Supplier offers use their exact dates and total price. Sample itineraries stay separate. */
(() => {
    const money = value => new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(value);
    const date = value => new Date(value).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi', dateStyle: 'medium', timeStyle: 'short' });
    let offers = [];
    let selected;
    let booking;
    let poll;
    const el = (tag, text, cls) => { const node = document.createElement(tag); if (text) node.textContent = text; if (cls) node.className = cls; return node; };
    const dialog = el('dialog', '', 'travel-offer-dialog');
    dialog.innerHTML = `<form><h2>Book your trip</h2><p data-offer-summary></p><p>Price includes the travellers, dates and services described in this offer.</p>
        <label>Full name<input name="name" required maxlength="120" autocomplete="name"></label>
        <label>Email<input name="email" type="email" required maxlength="254" autocomplete="email"></label>
        <label>M-Pesa phone<input name="phone" type="tel" required autocomplete="tel" placeholder="07… or 2547…"></label>
        <p data-booking-status role="status" aria-live="polite"></p><button type="submit">Reserve and pay with M-Pesa</button>
        <button type="button" data-close>Close</button><a href="/?view=checkticket" hidden data-lookup>Check payment</a></form>`;
    document.body.append(dialog);
    const form = dialog.querySelector('form');
    const status = dialog.querySelector('[data-booking-status]');
    const submit = dialog.querySelector('[type=submit]');
    dialog.querySelector('[data-close]').onclick = () => dialog.close();
    dialog.addEventListener('close', () => { clearTimeout(poll); });
    function open(offer) {
        clearTimeout(poll); selected = offer; booking = { requestId: crypto.randomUUID() }; form.reset();
        status.textContent = ''; submit.disabled = false; submit.hidden = false;
        dialog.querySelector('[data-lookup]').hidden = true;
        dialog.querySelector('[data-offer-summary]').textContent = `${offer.title} · ${date(offer.startsAt)} to ${date(offer.endsAt)} · ${money(offer.priceKes)} ${offer.priceBasis}`;
        dialog.showModal();
    }
    async function check() {
        if (!dialog.open || !booking?.orderReference) return;
        try {
            const result = await commerceRequest(`/travel/bookings/${encodeURIComponent(booking.orderReference)}?email=${encodeURIComponent(booking.email)}`);
            const ref = booking.orderReference;
            if (result.paymentStatus === 'COMPLETED') {
                const reservation = result.reservation;
                status.textContent = reservation?.status === 'CONFIRMED'
                    ? `Booking confirmed. Supplier reference ${reservation.confirmationCode}. Order ${ref}.`
                    : `Payment received. Supplier confirmation is pending. Order ${ref}.`;
                if (reservation?.status === 'CONFIRMED') return;
            } else if (result.paymentStatus === 'FAILED') { status.textContent = `Payment failed. Order ${ref}. Start a new booking to try again.`; return; }
            else status.textContent = `Approve the M-Pesa prompt on your phone. Order ${ref}.`;
        } catch (error) { status.textContent = `${error.message} Your order is ${booking.orderReference}. Use Check payment before starting again.`; }
        poll = setTimeout(check, 10000);
    }
    form.onsubmit = async event => {
        event.preventDefault(); if (submit.disabled || !form.reportValidity()) return;
        submit.disabled = true; status.textContent = 'Confirming the price and reserving with the supplier…';
        const fields = new FormData(form);
        const customer = Object.fromEntries(['name', 'email', 'phone'].map(key => [key, String(fields.get(key)).trim()]));
        try {
            if (!booking.orderReference) {
                const result = await commerceRequest('/travel/bookings', { offerId: selected.id, customer, requestId: booking.requestId });
                booking = { ...booking, ...result, email: customer.email };
            }
            dialog.querySelector('[data-lookup]').hidden = false;
            status.textContent = `Reserved. Starting M-Pesa for ${money(booking.totalKes)}…`;
            const payment = await commerceRequest('/payments/mpesa/stkpush', { orderReference: booking.orderReference, phone: customer.phone });
            status.textContent = `${payment.CustomerMessage} Order ${booking.orderReference}.`;
            submit.hidden = true; void check();
        } catch (error) {
            status.textContent = error.message + (booking.orderReference ? ` Order ${booking.orderReference}. Check payment before retrying.` : '');
            submit.disabled = false;
        }
    };
    function render(kind, data) {
        const view = document.getElementById(kind === 'flight' ? 'view-flights' : 'view-holidays');
        if (!view) return;
        if (!view.querySelector('[data-travel-lookup]')) {
            const lookup = el('section', '', 'travel-live-offers'); lookup.dataset.travelLookup = '';
            lookup.innerHTML = `<h2>Check your travel booking</h2><form class="travel-lookup-form"><label>Order reference<input name="reference" required placeholder="ORD-…" autocomplete="off"></label><label>Booking email<input name="email" type="email" required autocomplete="email"></label><button type="submit">Check booking</button><p role="status" aria-live="polite"></p></form>`;
            lookup.querySelector('form').onsubmit = async event => {
                event.preventDefault(); const fields = new FormData(event.currentTarget); const resultText = lookup.querySelector('[role=status]');
                const button = lookup.querySelector('button'); button.disabled = true; resultText.textContent = 'Checking your booking…';
                try {
                    const result = await commerceRequest(`/travel/bookings/${encodeURIComponent(String(fields.get('reference')).trim().toUpperCase())}?email=${encodeURIComponent(String(fields.get('email')).trim())}`);
                    resultText.textContent = `${result.reservation?.title || 'Travel booking'} · ${money(result.totalKes)} · Payment ${result.paymentStatus.toLowerCase()} · Reservation ${(result.reservation?.status || 'pending').replaceAll('_', ' ').toLowerCase()}${result.reservation?.confirmationCode ? ' · Supplier confirmation ' + result.reservation.confirmationCode : ''}`;
                } catch (error) { resultText.textContent = error.message; } finally { button.disabled = false; }
            };
            view.prepend(lookup);
        }
        let section = view.querySelector('.travel-live-offers:not([data-travel-lookup])');
        if (!section) { section = el('section', '', 'travel-live-offers'); view.prepend(section); }
        section.replaceChildren(el('h2', kind === 'flight' ? 'Available flight offers' : 'Available holiday packages'));
        section.append(el('p', 'Prices and dates are supplied by our travel partners and checked again before payment.'));
        const rows = offers.filter(offer => offer.kind === kind);
        if (!rows.length) { section.append(el('p', data.storageAvailable ? 'New offers will appear here after the next supplier update. You can browse itinerary ideas below.' : 'We’re reconnecting to the booking service. Please check again shortly.', 'travel-offer-notice')); return; }
        const grid = el('div', '', 'travel-offer-grid');
        for (const offer of rows) {
            const card = el('article', '', 'travel-offer-card'); card.append(el('h3', offer.title), el('p', offer.description),
                el('p', `${offer.origin ? offer.origin + ' → ' : ''}${offer.destination} · ${offer.supplier}`),
                el('p', `${date(offer.startsAt)} – ${date(offer.endsAt)}`), el('strong', `${money(offer.priceKes)} ${offer.priceBasis}`));
            const button = el('button', offer.status === 'available' ? 'Book this offer' : 'Details only');
            button.disabled = offer.status !== 'available'; button.onclick = () => open(offer); card.append(button); grid.append(card);
        }
        section.append(grid);
    }
    async function refresh() {
        try { const data = await commerceRequest('/travel/offers'); offers = data.offers; for (const kind of ['flight', 'holiday']) render(kind, data); }
        catch { for (const kind of ['flight', 'holiday']) render(kind, { storageAvailable: false }); }
    }
    void refresh(); setInterval(() => { if (!document.hidden) void refresh(); }, 60000);
})();
