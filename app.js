// Ticketsasa storefront

const state = {
    currency: 'KES',
    usdRate: 125, // 1 USD = 125 KES
    quantities: {},
    tipAmount: 0, // In KES
    promoCode: null,
    discountPercent: 0,
    tierPrices: {},
    passes: [],
    checkout: null,
    isPlayingAudio: false,
    audioToneOscillator: null,
    audioCtx: null
};

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
    if (typeof window.lucide?.createIcons === 'function') window.lucide.createIcons();
    restoreCart();
    void restoreAccount();
    void loadAccountProviders();
    setupCurrencyToggle();
    updatePriceDisplays();
    loadCommerceCatalog();
    loadPublishedEvents();
    loadFeaturedEvent();
    document.getElementById('btn-my-tickets')?.addEventListener('click', openTicketWallet);
    setupNavigation();
    initFlightEngine();
    updateCartDisplay();
});

// Currency Switcher
function setupCurrencyToggle() {
    const btn = document.getElementById('currency-toggle');
    if (!btn) return;
    const renderCurrency = () => {
        btn.textContent = state.currency;
        btn.setAttribute('aria-label', 'Switch currency. Current currency: ' + state.currency);
    };
    renderCurrency();

    btn.addEventListener('click', () => {
        state.currency = state.currency === 'KES' ? 'USD' : 'KES';
        renderCurrency();
        updatePriceDisplays();
        updateCartDisplay();
        showToast(`Currency switched to ${state.currency}`);
    });
}

function updatePriceDisplays() {
    const isKes = state.currency === 'KES';

    // Hero preview
    const heroPrice = document.getElementById('hero-price-preview');
    if (heroPrice) heroPrice.textContent = isKes ? 'KES 1,500' : '$12';

    // Tier Cards
    document.querySelectorAll('.tier-price').forEach(el => {
        const kes = el.getAttribute('data-kes');
        const usd = el.getAttribute('data-usd');
        el.textContent = isKes ? `KES ${Number(kes).toLocaleString()}` : `$${usd}`;
    });

}

const pageViews = ['events', 'flights', 'holidays', 'blog', 'checkticket', 'login', 'sell'];

function setMenuOpen(open) {
    document.getElementById('mobile-menu-btn').setAttribute('aria-expanded', String(open));
    document.getElementById('site-nav').classList.toggle('is-open', open);
}

function setupNavigation() {
    const menuButton = document.getElementById('mobile-menu-btn');
    menuButton.addEventListener('click', () => {
        setMenuOpen(menuButton.getAttribute('aria-expanded') !== 'true');
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && menuButton.getAttribute('aria-expanded') === 'true') {
            setMenuOpen(false);
            menuButton.focus();
        }
    });
    matchMedia('(min-width: 960px)').addEventListener('change', () => setMenuOpen(false));

    document.querySelectorAll('a[data-view]').forEach(link => {
        link.addEventListener('click', event => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
            event.preventDefault();
            switchTab(link.dataset.view);
        });
    });

    function restoreView() {
        const requested = new URLSearchParams(location.search).get('view');
        switchTab(pageViews.includes(requested) ? requested : 'events', { updateHistory: false });
    }

    window.addEventListener('popstate', restoreView);
    restoreView();
}

function updateQty(tier, change) {
    const current = state.quantities[tier] || 0;
    state.quantities[tier] = Math.min(state.tierPrices[tier]?.stock ?? 100, 100, Math.max(0, current + change));

    for (const output of document.querySelectorAll('[data-ticket-quantity]')) {
        if (output.dataset.ticketQuantity === tier) output.textContent = state.quantities[tier];
    }
    const el = document.getElementById(`qty-${tier}`);
    if (el) el.textContent = state.quantities[tier];
    updateCartDisplay();
}

// Tip Jar
function setTip(amountKes) {
    state.tipAmount = amountKes;
    document.querySelectorAll('.tip-chip').forEach(el => {
        el.classList.toggle('active-tip', Number(el.getAttribute('data-tip')) === amountKes);
    });
    updateCartDisplay();
    showToast(amountKes > 0 ? `Tip of KES ${amountKes} added to stage crew!` : 'Tip removed');
}

// Promo Code Engine
async function applyPromoCode() {
    const input = document.getElementById('promo-code-input');
    const status = document.getElementById('promo-status');
    const code = input.value.trim().toUpperCase();
    const request = Symbol();
    state.promoRequest = request;
    state.promoCode = null;
    state.discountPercent = 0;
    status.classList.remove('hidden');
    status.textContent = code ? 'Checking promo code?' : 'Promo code removed.';
    updateCartDisplay();
    calculateModalTotals();
    if (!code) return;

    try {
        const promo = await commerceRequest('/tickets/validate-promo', { code });
        if (state.promoRequest !== request) return;
        state.promoCode = promo.code;
        state.discountPercent = promo.discountPercent;
        status.textContent = promo.label + ' applied.';
    } catch (error) {
        if (state.promoRequest !== request) return;
        status.textContent = error.message;
    }
    updateCartDisplay();
    calculateModalTotals();
}

// Unified Cart Calculations
function roundMoney(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
}

function calculateTotals() {
    let subtotalKes = 0;
    let subtotalUsd = 0;
    let totalItems = 0;

    // Passes
    for (const [tier, qty] of Object.entries(state.quantities)) {
        if (qty > 0) {
            totalItems += qty;
            subtotalKes += qty * state.tierPrices[tier].kes;
            subtotalUsd += qty * state.tierPrices[tier].usd;
        }
    }

    // Tip


    // Apply Promo Discount
    let finalKes = subtotalKes;
    let finalUsd = subtotalUsd;
    if (state.discountPercent > 0) {
        const factor = (100 - state.discountPercent) / 100;
        finalKes = roundMoney(subtotalKes * factor);
        finalUsd = roundMoney(subtotalUsd * factor);
    }

    finalKes = roundMoney(finalKes + state.tipAmount);
    finalUsd = roundMoney(finalUsd + state.tipAmount / state.usdRate);
    return { totalItems, subtotalKes, subtotalUsd, finalKes, finalUsd };
}

let savedTicketQuantities = {};

function restoreCart() {
    try {
        const saved = JSON.parse(localStorage.getItem('ticketsasa-cart-v1'));
        if (saved?.currency === 'USD') state.currency = 'USD';
        savedTicketQuantities = saved?.quantities ?? {};
    } catch {
        // Storage may be unavailable in a private or restricted browser.
    }
}

function updateCartDisplay() {
    try {
        const { currency, quantities } = state;
        localStorage.setItem('ticketsasa-cart-v1', JSON.stringify({ currency, quantities }));
    } catch {
        // The current cart still works for this page.
    }
    const { totalItems, finalKes, finalUsd } = calculateTotals();
    const isKes = state.currency === 'KES';
    const totalString = isKes ? `KES ${finalKes.toLocaleString()}` : `$${finalUsd.toLocaleString()}`;

    const navCart = document.getElementById('cart-total-nav');
    if (navCart) navCart.textContent = totalString;

    const cartDisplay = document.getElementById('cart-total-display');
    const cartCount = document.getElementById('cart-tickets-count');
    const checkoutBtn = document.getElementById('btn-open-checkout');

    if (cartDisplay) cartDisplay.textContent = totalString;
    if (cartCount) cartCount.textContent = `(${totalItems} ${totalItems === 1 ? 'item' : 'items'} in order)`;
    if (checkoutBtn) checkoutBtn.disabled = totalItems === 0;

    const badge = document.getElementById('ticket-badge-count');
    if (badge) {
        if (state.passes.length > 0) {
            badge.textContent = state.passes.length;
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    }
}

function openCheckoutModal() {
    const isDirectCheckout = Boolean(state.checkout && state.checkout.itemKey);

    if (!isDirectCheckout) {
        populateOrderItems();
    }
    const statusEl = document.getElementById('checkout-status');
    if (statusEl) statusEl.textContent = '';
    const modalEl = document.getElementById('checkout-modal');
    if (modalEl) {
        checkoutReturnFocus = document.activeElement;
        modalEl.classList.remove('hidden');
        modalEl.querySelector('button')?.focus();
    }
}

let checkoutReturnFocus;

function closeCheckoutModal() {
    document.getElementById('checkout-modal').classList.add('hidden');
    checkoutReturnFocus?.focus();
}

function populateOrderItems(focusKey, focusAction) {
    const container = document.getElementById('modal-order-items');
    container.replaceChildren();
    let focusTarget;

    for (const [quantities, prices, adjust] of [
        [state.quantities, state.tierPrices, updateQty]
    ]) {
        for (const [key, quantity] of Object.entries(quantities)) {
            if (!quantity || !prices[key]) continue;
            const meta = prices[key];
            const row = document.createElement('div');
            row.className = 'cart-line';
            const label = document.createElement('strong');
            label.textContent = meta.eventTitle ? meta.eventTitle + ' · ' + meta.name : meta.name;
            if (meta.eventId && publishedEventDates.has(meta.eventId)) {
                const time = document.createElement('time');
                time.dateTime = publishedEventDates.get(meta.eventId);
                time.textContent = eventDateFormatter.format(new Date(time.dateTime));
                label.append(time);
            }
            const amount = document.createElement('span');
            amount.textContent = formatMoney(quantity * (state.currency === 'KES' ? meta.kes : meta.usd), state.currency);
            const controls = document.createElement('div');
            const count = document.createElement('span');
            count.textContent = 'Quantity ' + quantity;
            for (const [action, change] of [['Decrease', -1], ['Increase', 1], ['Remove', -quantity]]) {
                const button = document.createElement('button');
                button.type = 'button';
                button.textContent = action === 'Decrease' ? '−' : action === 'Increase' ? '+' : 'Remove';
                button.setAttribute('aria-label', action + ' ' + meta.name);
                button.disabled = change > 0 && quantity >= Math.min(100, meta.stock ?? 100);
                button.addEventListener('click', () => {
                    adjust(key, change);
                    populateOrderItems(key, action);
                });
                controls.append(button);
                if (key === focusKey && action === focusAction && !button.disabled) focusTarget = button;
            }
            controls.prepend(count);
            row.append(label, amount, controls);
            container.append(row);
        }
    }

    const totals = calculateTotals();
    if (!totals.totalItems) container.textContent = 'Your cart is empty.';
    const summary = document.createElement('p');
    summary.id = 'cart-adjustments';
    container.append(summary);
    document.getElementById('btn-submit-pay').disabled = checkoutSubmitting || !totals.totalItems;
    calculateModalTotals();
    if (focusKey) (focusTarget || container.querySelector('button:not(:disabled)') ||
        document.querySelector('#checkout-modal button[onclick="closeCheckoutModal()"]'))?.focus();
}

function calculateModalTotals() {
    const { finalKes, finalUsd } = calculateTotals();
    const isKes = state.currency === 'KES';
    const adjustments = document.getElementById('cart-adjustments');
    if (adjustments) {
        adjustments.textContent = 'Tip ' + formatMoney(isKes ? state.tipAmount : state.tipAmount / 125, state.currency)
            + ' · Discount ' + state.discountPercent + '%';
    }
    const totalEl = document.getElementById('modal-order-total');
    if (totalEl) {
        totalEl.textContent = isKes ? `KES ${finalKes.toLocaleString()}` : `$${finalUsd.toLocaleString()}`;
    }
}



function filterEventsChip(mode) {
    const catalog = document.getElementById('upcoming-events');
    if (!catalog) return;
    if (mode === 'all') {
        filterEvents('all');
        return;
    }
    if (mode === 'free') {
        catalog.setQuery?.('free');
    } else if (mode === 'featured') {
        catalog.setQuery?.('');
    } else if (mode === 'weekend') {
        catalog.setQuery?.('Sat');
    } else if (mode === 'trending') {
        document.getElementById('trending-events')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
    } else if (mode === 'drops') {
        catalog.setQuery?.('Early');
    }
    catalog.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function toggleFlightDestinationsTab(scope) {
    const localGrid = document.getElementById('flight-dest-local-grid');
    const intlGrid = document.getElementById('flight-dest-intl-grid');
    const localBtn = document.getElementById('btn-flight-dest-local');
    const intlBtn = document.getElementById('btn-flight-dest-intl');
    if (localGrid && intlGrid) {
        localGrid.classList.toggle('hidden', scope !== 'local');
        intlGrid.classList.toggle('hidden', scope !== 'intl');
    }
    if (localBtn && intlBtn) {
        localBtn.className = scope === 'local'
            ? 'px-4 py-1.5 rounded-full text-xs font-extrabold bg-[#009FE3] text-white transition'
            : 'px-4 py-1.5 rounded-full text-xs font-bold bg-slate-100 text-slate-700 hover:bg-slate-200 transition';
        intlBtn.className = scope === 'intl'
            ? 'px-4 py-1.5 rounded-full text-xs font-extrabold bg-[#009FE3] text-white transition'
            : 'px-4 py-1.5 rounded-full text-xs font-bold bg-slate-100 text-slate-700 hover:bg-slate-200 transition';
    }
}

function closePassModal() {
    document.getElementById('pass-modal').classList.add('hidden');
    openTicketWallet();
}

async function shareEvent() {
    try {
        await navigator.clipboard.writeText(window.location.href);
        showToast('Page link copied.');
    } catch {
        showToast('Could not copy the page link.');
    }
}

function showToast(msg) {
    const toast = document.getElementById('toast');
    const toastMsg = document.getElementById('toast-msg');
    if (!toast || !toastMsg) return;

    toastMsg.textContent = msg;
    toast.classList.remove('translate-y-24', 'opacity-0');
    toast.classList.add('translate-y-0', 'opacity-100');

    if (window.toastTimeout) clearTimeout(window.toastTimeout);
    window.toastTimeout = setTimeout(() => {
        toast.classList.add('translate-y-24', 'opacity-0');
        toast.classList.remove('translate-y-0', 'opacity-100');
    }, 3500);
}
// Append tab switching and Ticketsasa simulation to app.js

function switchTab(tabName, { updateHistory = true } = {}) {
    if (!pageViews.includes(tabName)) return;

    const menuWasOpen = document.getElementById('mobile-menu-btn').getAttribute('aria-expanded') === 'true';
    setMenuOpen(false);

    for (const view of pageViews) {
        document.getElementById(`view-${view}`).classList.toggle('hidden', view !== tabName);
    }
    document.querySelectorAll('#site-nav [data-view]').forEach(link => {
        if (link.dataset.view === tabName) {
            link.setAttribute('aria-current', 'page');
        } else {
            link.removeAttribute('aria-current');
        }
    });
    document.getElementById('sub-nav-bar').hidden = tabName !== 'events';

    const activeView = document.getElementById(`view-${tabName}`);
    document.querySelector('.skip-link').href = `#${activeView.id}`;
    if (menuWasOpen) activeView.focus({ preventScroll: true });

    if (tabName === 'flights') {
        initFlightEngine();
    } else if (tabName === 'holidays') {
        searchHolidayCards('');
    }

    if (updateHistory) {
        const url = new URL(location.href);
        url.searchParams.set('view', tabName);
        url.hash = '';
        if (url.href !== location.href) history.pushState(null, '', url);
        window.scrollTo(0, 0);
    }
}

function filterEvents(category) {
    document.getElementById('event-search-input').value = category === 'all' ? '' : category;
    const cityInput = document.getElementById('event-city-input');
    if (cityInput && category === 'all') cityInput.value = '';
    executeEventSearch();
}

function executeEventSearch() {
    const nameQuery = document.getElementById('event-search-input')?.value.trim() || '';
    const cityQuery = document.getElementById('event-city-input')?.value.trim() || '';
    const query = [nameQuery, cityQuery].filter(Boolean).join(' ').trim();
    const catalog = document.getElementById('upcoming-events');
    const term = query.toLowerCase();
    let matches = 0;
    for (const card of document.querySelectorAll('[data-published-search]')) {
        card.hidden = !card.dataset.publishedSearch.includes(term);
        if (!card.hidden) matches++;
    }
    const publishedStatus = document.getElementById('published-status');
    if (publishedStatus && document.querySelector('[data-published-search]')) {
        publishedStatus.textContent = matches ? '' : 'No ticketed events match your search.';
    }
    catalog.setQuery?.(query);
    const results = catalog || (matches ? document.getElementById('published-events') : catalog);
    results.setAttribute('tabindex', '-1');
    results.focus({ preventScroll: true });
    results.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// =========================================================================
// 3-TAB HERO SEARCH CARD & FEATURED EVENT SLIDER (ticketsasa.com 1:1)
// =========================================================================
const heroSliderItems = [
    {
        eventId: 'ticketsasa-back-to-rock-5',
        title: 'Back To Rock 5',
        priceKes: 2000,
        imageUrl: 'assets/real/QZGqWDTxBF-1791963807.jpg'
    },
    {
        eventId: 'ticketsasa-rx-fest-round-3',
        title: 'RX FEST ROUND 3',
        priceKes: 500,
        imageUrl: 'assets/real/SzYy0XWlBI-1792688119.png'
    },
    {
        eventId: 'ticketsasa-mr-miss-usiu-africa',
        title: 'Mr & Miss USIU - Africa',
        priceKes: 400,
        imageUrl: 'assets/real/GAzVjovyNO-1794384397.jpg'
    },
    {
        eventId: 'ticketsasa-back-forth-old-school-party-dec19',
        title: 'BACK & FORTH Old School Party',
        priceKes: 1500,
        imageUrl: 'assets/real/DzLV4G9UWo-1790859483.jpg'
    },
    {
        eventId: 'ticketsasa-l-boogie-the-2026-annual-diaspora-reunion',
        title: 'L-BOOGIE - THE 2026 ANNUAL DIASPORA REUNION',
        priceKes: 2000,
        imageUrl: 'assets/real/lheAq1Zpc0-1794303741.jpg'
    },
    {
        eventId: 'ticketsasa-street-courture-padel-meets-fashion',
        title: 'Street Courture: Padel Meets Fashion',
        priceKes: 1500,
        imageUrl: 'assets/real/61JOc0e8b5-1793268189.jpg'
    },
    {
        eventId: 'ticketsasa-sportpesa-boxing-presents-to-you-wba-ko-drugs',
        title: 'Sportpesa Boxing Presents to you: WBA KO Drugs',
        priceKes: 1500,
        imageUrl: 'assets/real/g4Gi3xRTDO-1793174308.jpg'
    },
    {
        eventId: 'ticketsasa-badshah',
        title: 'BADSHAH LIVE IN KENYA – ONE VOICE EDITION',
        priceKes: 5000,
        imageUrl: 'assets/real/aeIvhrxstM-1793471602.jpg'
    }
];
let currentHeroSlideIndex = 0;
let heroSliderTimer = null;

function switchHeroSearchTab(tab) {
    const card = document.getElementById('hero-search-card');
    if (!card) return;
    const colors = {
        events: '#D81A21',
        flights: '#009FE3',
        holidays: '#689F38'
    };
    card.style.backgroundColor = colors[tab] || '#D81A21';
    for (const key of ['events', 'flights', 'holidays']) {
        const btn = document.getElementById('hero-tab-' + key);
        const panel = document.getElementById('hero-panel-' + key);
        const active = key === tab;
        if (btn) {
            btn.classList.toggle('border-white', active);
            btn.classList.toggle('bg-white/10', active);
            btn.classList.toggle('border-transparent', !active);
            btn.classList.toggle('text-white/85', !active);
        }
        if (panel) panel.classList.toggle('hidden', !active);
    }
}

function submitHeroFlightSearch() {
    const orig = document.getElementById('hero-flight-origin')?.value || 'NBO';
    const dest = document.getElementById('hero-flight-dest')?.value || 'MBA';
    const cabin = document.getElementById('hero-flight-cabin')?.value || 'economy';
    const type = document.getElementById('hero-flight-type')?.value || 'round';
    switchTab('flights');
    const origEl = document.getElementById('flight-origin');
    const destEl = document.getElementById('flight-destination');
    const cabinEl = document.getElementById('flight-cabin-class');
    if (origEl) origEl.value = orig;
    if (destEl) destEl.value = dest;
    if (cabinEl) cabinEl.value = cabin;
    toggleTripType(type);
    executeFlightSearch(true);
}

function submitHeroHolidaySearch() {
    const loc = document.getElementById('hero-holiday-loc')?.value.trim() || '';
    switchTab('holidays');
    filterHolidays(loc || 'all');
}

function renderHeroSlide() {
    const slide = heroSliderItems[currentHeroSlideIndex] || heroSliderItems[0];
    if (!slide) return;
    const poster = document.getElementById('hero-poster-img');
    const titleEl = document.getElementById('hero-floating-title');
    const priceEl = document.getElementById('hero-floating-price');
    const linkEl = document.getElementById('hero-floating-link');
    const cardEl = document.getElementById('hero-floating-card');

    if (poster) {
        poster.src = slide.imageUrl;
        poster.alt = slide.title;
    }
    if (titleEl) titleEl.textContent = slide.title;
    if (priceEl) {
        const isKes = state.currency === 'KES';
        priceEl.textContent = isKes
            ? `KES ${Number(slide.priceKes).toLocaleString()}`
            : `$${Math.max(1, Math.round(slide.priceKes / 125))}`;
    }
    if (linkEl) linkEl.href = '?view=events&event=' + encodeURIComponent(slide.eventId);
    if (cardEl) cardEl.hidden = false;

    const dots = document.getElementById('hero-slider-dots');
    if (dots) {
        dots.replaceChildren(...heroSliderItems.map((item, idx) => {
            const dot = document.createElement('button');
            dot.type = 'button';
            dot.setAttribute('aria-label', 'Slide ' + (idx + 1) + ': ' + item.title);
            dot.className = idx === currentHeroSlideIndex
                ? 'w-6 h-2 rounded-full bg-[#D81A21] transition-all'
                : 'w-2 h-2 rounded-full bg-white/70 hover:bg-white transition-all';
            dot.onclick = () => {
                currentHeroSlideIndex = idx;
                renderHeroSlide();
            };
            return dot;
        }));
    }
}

function stepHeroSlider(delta) {
    currentHeroSlideIndex = (currentHeroSlideIndex + delta + heroSliderItems.length) % heroSliderItems.length;
    renderHeroSlide();
}

function openCurrentHeroSliderEvent() {
    const slide = heroSliderItems[currentHeroSlideIndex] || heroSliderItems[0];
    if (slide) openTicketsasaEventModal(slide.eventId);
}

async function loadFeaturedEvent() {
    renderHeroSlide();
    if (!heroSliderTimer) {
        heroSliderTimer = setInterval(() => stepHeroSlider(1), 6000);
    }
    try {
        const { data: event } = await commerceRequest('/events/featured');
        if (!event) return;
        const card = document.getElementById('hero-floating-card');
        if (card) card.hidden = false;
    } catch {
        // Fallback slider already rendered
    }
}

function toggleLiveChat() {
    toggleChatSupport();
}

function handleChatKey(e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        submitSupportQuestion(e.target);
    }
}





// =========================================================================
// CHECK TICKET ENGINE (Screenshot 6)
// =========================================================================

// =========================================================================
// CUSTOMER CHAT SUPPORT (Screenshots 1, 2, 3, 6)
// =========================================================================
function toggleChatSupport(opening = document.getElementById('chat-support-modal').classList.contains('hidden')) {
    const modal = document.getElementById('chat-support-modal');
    const launcher = document.getElementById('support-launcher');
    modal.classList.toggle('hidden', !opening);
    launcher.setAttribute('aria-expanded', String(opening));
    (opening ? modal.querySelector('input') : launcher).focus();
}


function openHelpModal() {
    toggleChatSupport();
}

// =========================================================================
// SOCIAL LOGIN & AUTH SIMULATION (Screenshot 7)
// =========================================================================



// =========================================================================
// M-PESA STK PUSH & DIGITAL PASS FLOW (Full End-to-End Interactivity)
// =========================================================================
let checkoutSubmitting = false;

async function handleMpesaSubmit(event) {
    event.preventDefault();
    const button = document.getElementById('btn-submit-pay');
    if (button.disabled || checkoutSubmitting) return;
    const status = document.getElementById('checkout-status');
    const value = id => document.getElementById(id).value.trim();
    const customer = { name: value('cust-name'), email: value('cust-email'), phone: value('cust-phone') };
    const items = [
        ...Object.entries(state.quantities).filter(([, quantity]) => quantity > 0)
            .map(([tierKey, quantity]) => ({
                tierKey,
                quantity,
                title: state.tierPrices[tierKey]?.name || tierKey,
                eventTitle: state.tierPrices[tierKey]?.eventTitle || 'Ticketsasa Event',
                unitPriceKes: state.tierPrices[tierKey]?.kes || 1000
            })),
    ];
    if (!items.length) {
        status.textContent = 'Select at least one ticket before checkout.';
        return;
    }
    const payload = { customer, items, currency: state.currency, promoCode: state.promoCode, tipKes: state.tipAmount };
    checkoutSubmitting = true;
    button.disabled = true;
    const { mode } = await commerceRequest('/payments/mode').catch(() => ({ mode: 'unavailable' }));
    if (mode === 'unavailable') {
        checkoutSubmitting = false;
        status.textContent = 'Online checkout is currently unavailable.';
        button.disabled = false;
        return;
    }
    if (mode === 'live') payload.currency = 'KES';
    const fingerprint = JSON.stringify(payload);
    status.textContent = 'Preparing your order…';
    try {
        if (state.checkout?.fingerprint !== fingerprint) {
            const { data } = await commerceRequest('/orders', payload);
            state.checkout = { fingerprint, reference: data.orderReference };
            const amount = data.currency === 'KES' ? data.totalKes : data.totalUsd;
            document.getElementById('modal-order-total').textContent = formatMoney(amount, data.currency);
        }
        const orderReference = state.checkout.reference;
        document.getElementById('wallet-reference').value = orderReference;
        document.getElementById('wallet-email').value = customer.email;
        status.textContent = 'Starting M-Pesa payment. Order ' + orderReference + '…';
        const payment = await commerceRequest('/payments/mpesa/stkpush', { orderReference, phone: customer.phone });
        let result;
        if (payment.mode === 'demo') {
            result = await commerceRequest('/payments/demo/confirm', { orderReference, checkoutRequestId: payment.CheckoutRequestID });
        } else {
            status.textContent = (payment.checkoutStarted ? 'Approve the M-Pesa prompt on your phone.'
                : 'Waiting for the payment provider to confirm the request.') + ' Order ' + orderReference + '.';
            for (let attempt = 0; attempt < 15; attempt++) {
                await new Promise(resolve => setTimeout(resolve, 3500));
                const check = await commerceRequest('/payments/status/' + encodeURIComponent(orderReference) + '?email=' + encodeURIComponent(customer.email)).catch(() => null);
                if (check?.status === 'COMPLETED') {
                    result = { data: check.order, passes: check.passes };
                    break;
                }
                if (check?.status === 'FAILED') {
                    state.checkout = null;
                    throw new Error(check.reason || 'Payment was declined or cancelled on your mobile phone.');
                }
                status.textContent = `Awaiting payment confirmation (${attempt + 1}/15)... Order ${orderReference}`;
            }
            if (!result || result.data?.paymentStatus !== 'COMPLETED') {
                const lookup = await commerceRequest('/orders/lookup', { orderReference, email: customer.email }).catch(() => null);
                if (lookup?.data?.paymentStatus === 'COMPLETED') {
                    result = lookup;
                } else {
                    throw new Error('Payment processing in progress. Once confirmed, your passes will appear in My tickets (Order: ' + orderReference + ').');
                }
            }
        }
        state.checkout = null;
        for (const quantities of [state.quantities]) {
            for (const key of Object.keys(quantities)) quantities[key] = 0;
        }
        state.tipAmount = 0;
        state.promoCode = null;
        state.discountPercent = 0;
        state.promoRequest = null;
        document.querySelectorAll('[id^="qty-"]').forEach(el => { el.textContent = '0'; });
        document.querySelectorAll('.tip-chip').forEach(el => el.classList.toggle('active-tip', el.dataset.tip === '0'));
        document.getElementById('promo-code-input').value = '';
        document.getElementById('promo-status').classList.add('hidden');
        rememberOrder(result.data, result.passes);
        document.getElementById('wallet-reference').value = result.data.orderReference;
        document.getElementById('wallet-email').value = customer.email;
        closeCheckoutModal();
        openTicketWallet();
        loadCommerceCatalog();
    } catch (error) {
        if ([409, 410, 422].includes(error.status)) state.checkout = null;
        status.textContent = error.message;
    } finally {
        checkoutSubmitting = false;
        button.disabled = false;
    }
}

function openDigitalPass(pass) {
    document.getElementById('res-name').textContent = pass.attendeeName;
    document.getElementById('res-order-id').textContent = pass.orderReference;
    document.getElementById('res-event-title').textContent = pass.eventTitle;
    document.getElementById('res-tier').textContent = pass.tierName;
    document.getElementById('ticket-pass-gate').textContent = pass.designatedGate;
    document.getElementById('pass-status').textContent = pass.status === 'VALID' ? 'Verified Ticket Pass' : pass.status;
    document.getElementById('pass-reference').textContent = pass.passReference;
    const image = document.querySelector('#qr-code-container img');
    image.hidden = pass.status !== 'VALID';
    if (image.hidden) {
        image.removeAttribute('src');
    } else {
        image.src = '/api/passes/qr/' + encodeURIComponent(pass.qrCodeToken);
    }
    closeTicketWallet();
    document.getElementById('pass-modal').classList.remove('hidden');
}

function closePassModal() {
    document.getElementById('pass-modal').classList.add('hidden');
    openTicketWallet();
}

// =========================================================================
// =========================================================================
// FLIGHT SEARCH INTERACTIVITY
// =========================================================================

// ============================================================================
// TICKETSASA HOLIDAY LOBBY INTERACTIVITY
// ============================================================================

function filterHolidays(keyword) {
    const input = document.getElementById('holiday-search-input');
    if (input) input.value = keyword === 'all' ? '' : keyword;
    searchHolidayCards(input ? input.value : '');
    const container = document.getElementById('holiday-cards-container');
    if (container) container.scrollIntoView({ behavior: 'smooth', block: 'start' });
    showToast(`Showing holiday deals for: ${keyword}`);
}

function searchHolidayCards(query) {
    const terms = (query || '').toLowerCase().trim().split(/\s+/).filter(Boolean);
    let count = 0;
    const cards = document.querySelectorAll('.holiday-card');
    cards.forEach(card => {
        const dest = card.dataset.destination || '';
        const title = card.dataset.title || '';
        const text = [dest, title, card.textContent].join(' ').toLowerCase();
        const match = terms.length === 0 || terms.every(t => text.includes(t));
        card.style.display = match ? 'flex' : 'none';
        if (match) count++;
    });
    const badge = document.getElementById('holiday-count-badge');
    if (badge) badge.textContent = count;
    const emptyEl = document.getElementById('holiday-empty');
    if (emptyEl) emptyEl.hidden = count !== 0;
}

// ============================================================================
// TICKETSASA REAL FLIGHTS ENGINE & GDS INTEGRATION
// ============================================================================

const flightsDb = [
    {
        id: 'KQ604',
        airline: 'Kenya Airways',
        logo: 'assets/airlines/kenya-airways.svg',
        flightNumber: 'KQ 604',
        aircraft: 'Embraer E190',
        origin: 'NBO',
        originCity: 'Nairobi – Jomo Kenyatta',
        dest: 'MBA',
        destCity: 'Mombasa – Moi Intl',
        depTime: '08:00',
        arrTime: '09:00',
        durationMinutes: 60,
        durationText: '1h 00m',
        stops: 'Non-Stop',
        baggage: '✓ 23kg Check-in + 7kg Cabin',
        amenities: 'Complimentary Refreshment & Tea',
        priceKes: 7850,
        priceUsd: 60,
        seatsLeft: 8
    },
    {
        id: 'JM8602',
        airline: 'Jambojet',
        logo: 'assets/airlines/jambojet.svg',
        flightNumber: 'JM 8602',
        aircraft: 'De Havilland Dash 8-Q400',
        origin: 'NBO',
        originCity: 'Nairobi – Jomo Kenyatta',
        dest: 'MBA',
        destCity: 'Mombasa – Moi Intl',
        depTime: '06:30',
        arrTime: '07:30',
        durationMinutes: 60,
        durationText: '1h 00m',
        stops: 'Non-Stop',
        baggage: '✓ 10kg Hand Luggage',
        amenities: 'Early Bird Special Fare',
        priceKes: 5900,
        priceUsd: 45,
        seatsLeft: 14
    },
    {
        id: 'OW214',
        airline: 'Skyward Express',
        logo: 'assets/airlines/skyward.svg',
        flightNumber: 'OW 214',
        aircraft: 'Fokker 50 / Dash 8-300',
        origin: 'WIL',
        originCity: 'Nairobi – Wilson Airport',
        dest: 'MBA',
        destCity: 'Mombasa – Moi Intl',
        depTime: '09:30',
        arrTime: '10:45',
        durationMinutes: 75,
        durationText: '1h 15m',
        stops: 'Non-Stop (Wilson)',
        baggage: '✓ 15kg Check-in + 5kg Cabin',
        amenities: 'Quick City Airport Boarding',
        priceKes: 6400,
        priceUsd: 49,
        seatsLeft: 6
    },
    {
        id: 'JM8608',
        airline: 'Jambojet',
        logo: 'assets/airlines/jambojet.svg',
        flightNumber: 'JM 8608',
        aircraft: 'De Havilland Dash 8-Q400',
        origin: 'NBO',
        originCity: 'Nairobi – Jomo Kenyatta',
        dest: 'MBA',
        destCity: 'Mombasa – Moi Intl',
        depTime: '13:45',
        arrTime: '14:45',
        durationMinutes: 60,
        durationText: '1h 00m',
        stops: 'Non-Stop',
        baggage: '✓ 10kg Hand Luggage',
        amenities: 'Afternoon Coast Express',
        priceKes: 6200,
        priceUsd: 48,
        seatsLeft: 19
    },
    {
        id: 'KQ612',
        airline: 'Kenya Airways',
        logo: 'assets/airlines/kenya-airways.svg',
        flightNumber: 'KQ 612',
        aircraft: 'Boeing 737-800',
        origin: 'NBO',
        originCity: 'Nairobi – Jomo Kenyatta',
        dest: 'MBA',
        destCity: 'Mombasa – Moi Intl',
        depTime: '17:15',
        arrTime: '18:15',
        durationMinutes: 60,
        durationText: '1h 00m',
        stops: 'Non-Stop',
        baggage: '✓ 23kg Check-in + 7kg Cabin',
        amenities: 'Hot Savory Snack & Beverage',
        priceKes: 8400,
        priceUsd: 65,
        seatsLeft: 5
    },
    {
        id: '5H402',
        airline: 'Fly540',
        logo: 'assets/airlines/fly540.svg',
        flightNumber: '5H 402',
        aircraft: 'Bombardier CRJ-200',
        origin: 'NBO',
        originCity: 'Nairobi – Jomo Kenyatta',
        dest: 'MBA',
        destCity: 'Mombasa – Moi Intl',
        depTime: '19:30',
        arrTime: '20:30',
        durationMinutes: 60,
        durationText: '1h 00m',
        stops: 'Non-Stop',
        baggage: '✓ 15kg Baggage Included',
        amenities: 'Evening Commuter Flight',
        priceKes: 5400,
        priceUsd: 42,
        seatsLeft: 11
    },
    {
        id: 'KQ654',
        airline: 'Kenya Airways',
        logo: 'assets/airlines/kenya-airways.svg',
        flightNumber: 'KQ 654',
        aircraft: 'Embraer E190',
        origin: 'NBO',
        originCity: 'Nairobi – Jomo Kenyatta',
        dest: 'KIS',
        destCity: 'Kisumu – Kisumu Intl',
        depTime: '10:30',
        arrTime: '11:25',
        durationMinutes: 55,
        durationText: '0h 55m',
        stops: 'Non-Stop',
        baggage: '✓ 23kg Check-in + 7kg Cabin',
        amenities: 'Lake Basin Express',
        priceKes: 7950,
        priceUsd: 61,
        seatsLeft: 9
    },
    {
        id: 'JM8640',
        airline: 'Jambojet',
        logo: 'assets/airlines/jambojet.svg',
        flightNumber: 'JM 8640',
        aircraft: 'Dash 8-Q400',
        origin: 'NBO',
        originCity: 'Nairobi – Jomo Kenyatta',
        dest: 'KIS',
        destCity: 'Kisumu – Kisumu Intl',
        depTime: '07:00',
        arrTime: '07:50',
        durationMinutes: 50,
        durationText: '0h 50m',
        stops: 'Non-Stop',
        baggage: '✓ 10kg Hand Luggage',
        amenities: 'Morning Flight',
        priceKes: 6100,
        priceUsd: 47,
        seatsLeft: 15
    },
    {
        id: 'OW302',
        airline: 'Skyward Express',
        logo: 'assets/airlines/skyward.svg',
        flightNumber: 'OW 302',
        aircraft: 'Dash 8-300',
        origin: 'WIL',
        originCity: 'Nairobi – Wilson Airport',
        dest: 'UKA',
        destCity: 'Diani – Ukunda Airstrip',
        depTime: '08:30',
        arrTime: '09:45',
        durationMinutes: 75,
        durationText: '1h 15m',
        stops: 'Non-Stop',
        baggage: '✓ 15kg Baggage Included',
        amenities: 'Direct Beach Landing',
        priceKes: 7200,
        priceUsd: 55,
        seatsLeft: 7
    },
    {
        id: 'JM8660',
        airline: 'Jambojet',
        logo: 'assets/airlines/jambojet.svg',
        flightNumber: 'JM 8660',
        aircraft: 'Dash 8-Q400',
        origin: 'NBO',
        originCity: 'Nairobi – Jomo Kenyatta',
        dest: 'EDL',
        destCity: 'Eldoret – Eldoret Intl',
        depTime: '08:15',
        arrTime: '09:05',
        durationMinutes: 50,
        durationText: '0h 50m',
        stops: 'Non-Stop',
        baggage: '✓ 10kg Hand Luggage',
        amenities: 'North Rift Shuttle',
        priceKes: 6300,
        priceUsd: 49,
        seatsLeft: 12
    },
    {
        id: 'JM8680',
        airline: 'Jambojet',
        logo: 'assets/airlines/jambojet.svg',
        flightNumber: 'JM 8680',
        aircraft: 'Dash 8-Q400',
        origin: 'NBO',
        originCity: 'Nairobi – Jomo Kenyatta',
        dest: 'MYD',
        destCity: 'Malindi – Malindi Airport',
        depTime: '11:00',
        arrTime: '12:10',
        durationMinutes: 70,
        durationText: '1h 10m',
        stops: 'Non-Stop',
        baggage: '✓ 10kg Hand Luggage',
        amenities: 'Italian Coast Special',
        priceKes: 6900,
        priceUsd: 53,
        seatsLeft: 10
    },
    {
        id: 'OW504',
        airline: 'Skyward Express',
        logo: 'assets/airlines/skyward.svg',
        flightNumber: 'OW 504',
        aircraft: 'Fokker 50',
        origin: 'WIL',
        originCity: 'Nairobi – Wilson Airport',
        dest: 'LAU',
        destCity: 'Lamu – Manda Airport',
        depTime: '12:30',
        arrTime: '14:00',
        durationMinutes: 90,
        durationText: '1h 30m',
        stops: 'Non-Stop',
        baggage: '✓ 15kg Baggage Included',
        amenities: 'Archipelago Express',
        priceKes: 8900,
        priceUsd: 68,
        seatsLeft: 4
    }
];

let flightSearchState = {
    tripType: 'round',
    origin: 'NBO',
    destination: 'MBA',
    cabinClass: 'economy',
    airlineFilter: 'all',
    sortBy: 'price-asc',
    selectedFlight: null
};

function toggleTripType(type) {
    flightSearchState.tripType = type;
    const btnRound = document.getElementById('btn-trip-round');
    const btnOne = document.getElementById('btn-trip-one');
    const retContainer = document.getElementById('flight-return-container');

    if (type === 'round') {
        if (btnRound) {
            btnRound.classList.add('bg-white', 'text-slate-900', 'shadow-sm');
            btnRound.classList.remove('text-slate-600');
        }
        if (btnOne) {
            btnOne.classList.remove('bg-white', 'text-slate-900', 'shadow-sm');
            btnOne.classList.add('text-slate-600');
        }
        if (retContainer) retContainer.style.display = '';
    } else {
        if (btnOne) {
            btnOne.classList.add('bg-white', 'text-slate-900', 'shadow-sm');
            btnOne.classList.remove('text-slate-600');
        }
        if (btnRound) {
            btnRound.classList.remove('bg-white', 'text-slate-900', 'shadow-sm');
            btnRound.classList.add('text-slate-600');
        }
        if (retContainer) retContainer.style.display = 'none';
    }
    executeFlightSearch();
}

function swapFlightAirports() {
    const origEl = document.getElementById('flight-origin');
    const destEl = document.getElementById('flight-destination');
    if (!origEl || !destEl) return;

    const tmp = origEl.value;
    origEl.value = destEl.value;
    destEl.value = tmp;

    executeFlightSearch();
    showToast(`Swapped route: ${origEl.value} ➔ ${destEl.value}`);
}

function syncFlightRoute() {
    const origEl = document.getElementById('flight-origin');
    const destEl = document.getElementById('flight-destination');
    if (!origEl || !destEl) return;

    if (origEl.value === destEl.value) {
        destEl.value = origEl.value === 'NBO' ? 'MBA' : 'NBO';
    }
    executeFlightSearch();
}

function filterFlightsByAirline(airline) {
    flightSearchState.airlineFilter = airline;
    document.querySelectorAll('.flight-filter-pill').forEach(pill => {
        const txt = pill.textContent;
        const active = (airline === 'all' && txt.includes('All Airlines')) || (airline !== 'all' && txt.includes(airline));
        pill.classList.toggle('bg-sky-600', active);
        pill.classList.toggle('text-white', active);
        pill.classList.toggle('border-sky-600', active);
        pill.classList.toggle('bg-white', !active);
        pill.classList.toggle('text-slate-700', !active);
        pill.classList.toggle('border-slate-200', !active);
    });
    executeFlightSearch(false);
}

function selectPartnerAirline(airline) {
    filterFlightsByAirline(airline);
    const resultsSec = document.getElementById('flight-search-results-section');
    if (resultsSec) resultsSec.scrollIntoView({ behavior: 'smooth', block: 'start' });
    for (const card of document.querySelectorAll('#view-flights [data-airline]')) {
        card.setAttribute('aria-pressed', String(card.dataset.airline === airline));
    }
    showToast(`Showing sample flights for ${airline}`);
}

function sortFlightResults(sortMode) {
    flightSearchState.sortBy = sortMode;
    executeFlightSearch(false);
}

function executeFlightSearch(scroll = false) {
    if (!document.getElementById('flight-results-list')) return;
    const origEl = document.getElementById('flight-origin');
    const destEl = document.getElementById('flight-destination');
    const cabinEl = document.getElementById('flight-cabin-class');
    const origin = origEl ? origEl.value : 'NBO';
    const dest = destEl ? destEl.value : 'MBA';
    const cabin = cabinEl ? cabinEl.value : 'economy';

    flightSearchState.origin = origin;
    flightSearchState.destination = dest;
    flightSearchState.cabinClass = cabin;

    // Filter by route
    let matched = flightsDb.filter(f => {
        const matchesOrigin = f.origin === origin || (origin === 'NBO' && f.origin === 'WIL') || (origin === 'WIL' && f.origin === 'NBO');
        const matchesDest = f.dest === dest;
        return matchesOrigin && matchesDest;
    });

    // Fallback if no specific flights on that exact pair: show regional network flights


    // Filter by airline
    if (flightSearchState.airlineFilter !== 'all') {
        const filtered = matched.filter(f => f.airline.toLowerCase().includes(flightSearchState.airlineFilter.toLowerCase()));
        matched = filtered;
    }

    // Sort
    if (flightSearchState.sortBy === 'price-asc') {
        matched.sort((a, b) => a.priceKes - b.priceKes);
    } else if (flightSearchState.sortBy === 'duration-asc') {
        matched.sort((a, b) => a.durationMinutes - b.durationMinutes);
    } else if (flightSearchState.sortBy === 'depart-asc') {
        matched.sort((a, b) => a.depTime.localeCompare(b.depTime));
    }

    renderFlightCards(matched);

    // Update Titles
    const titleEl = document.getElementById('flight-results-route-title');
    if (titleEl) {
        const origName = getAirportCityName(origin);
        const destName = getAirportCityName(dest);
        titleEl.innerHTML = `<span>${origName} (${origin})</span> <svg class="w-4 h-4 text-slate-400 inline mx-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg> <span>${destName} (${dest})</span>`;
    }

    const subEl = document.getElementById('flight-results-date-subtitle');
    if (subEl) {
        const minFare = matched.length > 0 ? Math.min(...matched.map(f => f.priceKes)) : 5400;
        const isKes = state.currency === 'KES';
        const fareStr = isKes ? `KES ${minFare.toLocaleString()}` : `$${Math.round(minFare / 130)}`;
        subEl.textContent = `Showing ${matched.length} flights · ${matched.length ? 'Example fare: ' + fareStr : 'No matching sample flights'} · ${cabin.toUpperCase()} · Sample schedules and fares`;
    }

    if (scroll) {
        const resultsSec = document.getElementById('flight-search-results-section');
        if (resultsSec) resultsSec.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

function getAirportCityName(code) {
    const map = {
        NBO: 'Nairobi',
        WIL: 'Nairobi Wilson',
        MBA: 'Mombasa',
        KIS: 'Kisumu',
        EDL: 'Eldoret',
        UKA: 'Diani / Ukunda',
        MYD: 'Malindi',
        LAU: 'Lamu'
    };
    return map[code] || code;
}

function renderFlightCards(flights) {
    const container = document.getElementById('flight-results-list');
    if (!container) return;

    const isKes = state.currency === 'KES';

    container.innerHTML = flights.map(f => {
        const priceStr = isKes ? `KES ${f.priceKes.toLocaleString()}` : `$${f.priceUsd}`;
        return `
            <div class="flight-result-card bg-white rounded-2xl border border-slate-200 p-5 shadow-sm hover:shadow-xl transition group">
                <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
                    <!-- Airline & Flight Info -->
                    <div class="flex items-center gap-4 lg:w-1/4">
                        <div class="w-14 h-14 rounded-2xl bg-slate-50 border border-slate-100 p-2 flex items-center justify-center shrink-0">
                            <img src="${f.logo}" alt="${f.airline}" class="max-h-8 max-w-full object-contain">
                        </div>
                        <div>
                            <div class="font-extrabold text-base text-slate-900 group-hover:text-sky-600 transition">${f.airline}</div>
                            <div class="text-xs text-slate-500 font-mono">${f.flightNumber} · ${f.aircraft}</div>
                            <div class="mt-1 inline-flex items-center gap-1 text-[10px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded font-bold">
                                <span>●</span> ${f.seatsLeft} seats left at this fare
                            </div>
                        </div>
                    </div>

                    <!-- Flight Timing & Route Timeline -->
                    <div class="flex-1 grid grid-cols-3 items-center text-center">
                        <div class="text-left">
                            <div class="text-2xl font-black text-slate-900">${f.depTime}</div>
                            <div class="text-xs font-bold text-sky-700">${f.origin}</div>
                            <div class="text-[11px] text-slate-500 truncate">${f.originCity}</div>
                        </div>

                        <div class="px-2 space-y-1">
                            <div class="text-[11px] font-bold text-slate-500">${f.durationText}</div>
                            <div class="relative flex items-center justify-center">
                                <div class="w-full border-t-2 border-slate-200"></div>
                                <svg class="w-4 h-4 text-sky-600 absolute rotate-90" fill="currentColor" viewBox="0 0 20 20"><path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z"/></svg>
                            </div>
                            <div class="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">${f.stops}</div>
                        </div>

                        <div class="text-right">
                            <div class="text-2xl font-black text-slate-900">${f.arrTime}</div>
                            <div class="text-xs font-bold text-sky-700">${f.dest}</div>
                            <div class="text-[11px] text-slate-500 truncate">${f.destCity}</div>
                        </div>
                    </div>

                    <!-- Inclusions & Price & Book CTA -->
                    <div class="lg:w-1/4 flex flex-col sm:flex-row lg:flex-col items-end justify-between lg:justify-center gap-3 lg:border-l lg:border-slate-100 lg:pl-6">
                        <div class="text-right">
                            <div class="text-[11px] text-slate-500">${f.baggage}</div>
                            <div class="text-2xl font-black text-slate-900">${priceStr}</div>
                            <div class="text-[10px] text-slate-400 font-medium">Includes all taxes &amp; passenger fees</div>
                        </div>
                        <button type="button" onclick="openFlightBookingModal('${f.id}')" class="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-gradient-to-r from-sky-600 to-blue-700 hover:from-sky-500 hover:to-blue-600 text-white font-extrabold text-xs uppercase tracking-wider shadow-md shadow-sky-600/20 transition flex items-center justify-center gap-2">
                            <span>Book Flight</span>
                            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function openFlightBookingModal(flightId) {
    const flight = flightsDb.find(f => f.id === flightId) || flightsDb[0];
    flightSearchState.selectedFlight = flight;

    // Populate modal summary
    const logoEl = document.getElementById('fbm-airline-logo');
    if (logoEl) logoEl.src = flight.logo;

    const nameEl = document.getElementById('fbm-airline-name');
    if (nameEl) nameEl.textContent = flight.airline;

    const fnEl = document.getElementById('fbm-flight-number');
    if (fnEl) fnEl.textContent = `${flight.flightNumber} · ${flight.aircraft}`;

    const depTimeEl = document.getElementById('fbm-dep-time');
    if (depTimeEl) depTimeEl.textContent = flight.depTime;

    const depCodeEl = document.getElementById('fbm-dep-code');
    if (depCodeEl) depCodeEl.textContent = flight.origin;

    const depCityEl = document.getElementById('fbm-dep-city');
    if (depCityEl) depCityEl.textContent = flight.originCity;

    const arrTimeEl = document.getElementById('fbm-arr-time');
    if (arrTimeEl) arrTimeEl.textContent = flight.arrTime;

    const arrCodeEl = document.getElementById('fbm-arr-code');
    if (arrCodeEl) arrCodeEl.textContent = flight.dest;

    const arrCityEl = document.getElementById('fbm-arr-city');
    if (arrCityEl) arrCityEl.textContent = flight.destCity;

    const durEl = document.getElementById('fbm-duration');
    if (durEl) durEl.textContent = flight.durationText;

    const bagEl = document.getElementById('fbm-baggage-note');
    if (bagEl) bagEl.textContent = flight.baggage;

    const dateVal = document.getElementById('flight-depart-date')?.value;
    const travelDateEl = document.getElementById('fbm-travel-date');
    if (travelDateEl) {
        travelDateEl.textContent = dateVal ? `Date: ${dateVal}` : 'Date: Scheduled Departure';
    }

    const statusEl = document.getElementById('fbm-status');
    if (statusEl) statusEl.textContent = '';

    calculateFlightTotal();

    const modal = document.getElementById('flight-booking-modal');
    if (modal) modal.classList.remove('hidden');
}

function closeFlightBookingModal() {
    const modal = document.getElementById('flight-booking-modal');
    if (modal) modal.classList.add('hidden');
}

function calculateFlightTotal() {
    const flight = flightSearchState.selectedFlight;
    if (!flight) return;

    const isKes = state.currency === 'KES';
    const baseFare = flight.priceKes;
    const tax = Math.round(baseFare * 0.05);

    let addons = 0;
    const insEl = document.getElementById('fbm-addon-insurance');
    if (insEl && insEl.checked) addons += 750;

    const bagEl = document.getElementById('fbm-addon-baggage');
    if (bagEl && bagEl.checked) addons += 2000;

    const seatEl = document.getElementById('fbm-seat-pref');
    if (seatEl && seatEl.value === 'extra-leg') addons += 1200;

    const totalKes = baseFare + tax + addons;
    const totalUsd = Math.round(totalKes / 130);

    const baseEl = document.getElementById('fbm-summary-base');
    if (baseEl) baseEl.textContent = isKes ? `KES ${baseFare.toLocaleString()}` : `$${flight.priceUsd}`;

    const taxEl = document.getElementById('fbm-summary-tax');
    if (taxEl) taxEl.textContent = isKes ? `KES ${tax.toLocaleString()}` : `$${Math.round(tax / 130)}`;

    const addonsEl = document.getElementById('fbm-summary-addons');
    if (addonsEl) addonsEl.textContent = isKes ? `KES ${addons.toLocaleString()}` : `$${Math.round(addons / 130)}`;

    const totalEl = document.getElementById('fbm-summary-total');
    if (totalEl) totalEl.textContent = isKes ? `KES ${totalKes.toLocaleString()}` : `$${totalUsd}`;

    const btnLabel = document.getElementById('btn-fbm-label');
    if (btnLabel) {
        btnLabel.textContent = isKes ? `PAY KES ${totalKes.toLocaleString()} VIA M-PESA` : `PAY $${totalUsd} VIA M-PESA`;
    }

    return { totalKes, totalUsd };
}

async function handleFlightBookingSubmit(event) {
    event.preventDefault();
    const flight = flightSearchState.selectedFlight;
    if (!flight) return;
    const firstName = document.getElementById('fbm-first-name')?.value?.trim() || 'Passenger';
    const lastName = document.getElementById('fbm-last-name')?.value?.trim() || '';
    const passport = document.getElementById('fbm-passport')?.value?.trim() || '';
    const email = document.getElementById('fbm-email')?.value?.trim() || '';
    const phone = document.getElementById('fbm-phone')?.value?.trim() || '';
    const totals = calculateFlightTotal() || { totalKes: flight.priceKes };
    const statusEl = document.getElementById('fbm-status');
    const submitBtn = document.getElementById('btn-fbm-submit');
    saveTravelPlan('flight', 'fbm-status', {
        airline: flight.airline,
        flightNo: flight.flightNumber || flight.flightNo,
        origin: flight.origin,
        destination: flight.dest,
        departure: document.getElementById('flight-depart-date')?.value || '',
        returnDate: document.getElementById('flight-return-date')?.disabled ? '' : (document.getElementById('flight-return-date')?.value || ''),
        cabin: flightSearchState.cabinClass,
        passenger: [firstName, lastName].filter(Boolean).join(' '),
        passport,
        email,
        phone,
        totalKes: `KES ${Number(totals.totalKes || 0).toLocaleString()}`
    });
    if (!phone || !email) return;
    if (submitBtn) submitBtn.disabled = true;
    const departureDate = document.getElementById('flight-depart-date')?.value || new Date().toISOString().split('T')[0];
    const returnDate = document.getElementById('flight-return-date')?.disabled ? '' : (document.getElementById('flight-return-date')?.value || '');
    const seatPref = document.getElementById('fbm-seat-pref')?.value || 'window';
    if (statusEl) statusEl.textContent = `Holding seat on ${flight.airline} (${flight.flightNumber}) & sending M-Pesa STK Push to ${phone}...`;
    try {
        const orderRes = await commerceRequest('/orders', {
            customer: { name: [firstName, lastName].filter(Boolean).join(' '), email, phone },
            items: [{
                kind: 'flight',
                id: flight.id || 'FLT-1',
                title: `${flight.airline} (${flight.flightNumber || flight.id}) ${flight.origin} → ${flight.dest}`,
                unitPriceKes: Math.round(totals.totalKes || flight.priceKes),
                quantity: 1
            }],
            currency: 'KES',
            paymentMethod: 'MPESA'
        });
        const orderReference = orderRes.data.orderReference;
        const holdRes = await commerceRequest('/travel/flights/reserve', {
            orderReference,
            flight,
            passenger: { name: [firstName, lastName].filter(Boolean).join(' '), passport, email, phone },
            departureDate,
            returnDate,
            cabin: flightSearchState.cabinClass,
            seatPref,
            totalKes: Math.round(totals.totalKes || flight.priceKes)
        });
        const pnr = holdRes?.reservation?.reservationRef || 'HELD';
        const payRes = await commerceRequest('/payments/mpesa/stkpush', { orderReference, phone });
        if (payRes.mode === 'demo') {
            const conf = await commerceRequest('/payments/demo/confirm', { orderReference, checkoutRequestId: payRes.CheckoutRequestID });
            const confirmedRes = await commerceRequest('/travel/reservations/' + encodeURIComponent(orderReference)).catch(() => null);
            const code = confirmedRes?.reservation?.confirmationCode || pnr;
            rememberOrder(conf.data, conf.passes);
            if (statusEl) statusEl.textContent = `Flight confirmed! PNR: ${pnr} · E-Ticket: ${code} · Order: ${orderReference}`;
        } else {
            if (statusEl) statusEl.textContent = `PNR ${pnr} held. ${payRes.CustomerMessage || `STK Push sent to ${phone}!`}`;
            for (let attempt = 0; attempt < 15; attempt++) {
                await new Promise(resolve => setTimeout(resolve, 3500));
                const check = await commerceRequest('/payments/status/' + encodeURIComponent(orderReference) + '?email=' + encodeURIComponent(email)).catch(() => null);
                if (check?.status === 'COMPLETED') {
                    const confirmedRes = await commerceRequest('/travel/reservations/' + encodeURIComponent(orderReference)).catch(() => null);
                    const code = confirmedRes?.reservation?.confirmationCode || pnr;
                    rememberOrder(check.order, check.passes);
                    if (statusEl) statusEl.textContent = `Flight confirmed! PNR: ${pnr} · E-Ticket: ${code}`;
                    showToast(`Flight confirmed! PNR ${pnr}`);
                    return;
                }
                if (check?.status === 'FAILED') {
                    throw new Error(check.reason || 'Payment declined or cancelled on mobile phone.');
                }
            }
        }
        if (typeof showToast === 'function') {
            showToast(`PNR ${pnr} held — complete M-Pesa prompt on ${phone}`);
        }
    } catch (err) {
        if (statusEl) statusEl.textContent = err.message || 'Could not complete flight reservation.';
    } finally {
        if (submitBtn) submitBtn.disabled = false;
    }
}

function initFlightEngine() {
    const depDateInput = document.getElementById('flight-depart-date');
    const retDateInput = document.getElementById('flight-return-date');
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const nextWeek = new Date(today);
    nextWeek.setDate(nextWeek.getDate() + 5);

    const fmt = d => d.toISOString().split('T')[0];
    if (depDateInput) {
        depDateInput.min = fmt(today);
        depDateInput.value = fmt(tomorrow);
    }
    if (retDateInput) {
        retDateInput.min = fmt(tomorrow);
        retDateInput.value = fmt(nextWeek);
    }

    executeFlightSearch();
}


// ============================================================================
// TICKETSASA REAL HOLIDAYS & HOTEL PACKAGES ENGINE
// ============================================================================

const holidayDb = {
    'neptune-village': {
        key: 'neptune-village',
        title: '5 Days 4 Nights At Neptune Village Beach Resort & Spa',
        resortName: 'Neptune Village Beach Resort & Spa',
        destination: 'Diani Beach, South Coast, Kenya',
        duration: '5D / 4N',
        image: 'assets/holidays/neptune-village.jpg',
        rate: 67760,
        originalRate: 240000,
        discount: '72% OFF',
        mealPlan: 'All-Inclusive (Breakfast, Lunch, Dinner, Afternoon Tea & Selected Drinks)',
        inclusions: [
            '5 Days 4 Nights in a superior Makuti-roof garden room',
            'Unlimited selected house alcoholic & non-alcoholic beverages',
            'Full buffet breakfast, lunch, and themed international dinners',
            'Free return transfers from Ukunda Airstrip or SGR Diani Terminal',
            'Access to 2 large freshwater swimming pools & private beach direct access',
            'Daily animations: beach volleyball, water polo & evening cultural Swahili shows'
        ],
        roomTypes: [
            { name: 'Deluxe Garden Room', surcharge: 0 },
            { name: 'Ocean View Suite', surcharge: 6000 },
            { name: 'Presidential Beachfront Villa', surcharge: 14000 }
        ]
    },
    'medina-palms': {
        key: 'medina-palms',
        title: '5 Days 4 Nights At Medina Palms Luxury Resort',
        resortName: 'Medina Palms Luxury Resort',
        destination: 'Watamu Marine Reserve, Kenya',
        duration: '5D / 4N',
        image: 'assets/holidays/medina-palms.jpg',
        rate: 60460,
        originalRate: 308000,
        discount: '80% OFF',
        mealPlan: 'Half Board (Breakfast & 4-Course Fine Dining Dinner)',
        inclusions: [
            '5 Days 4 Nights in a luxury Medina Palms suite',
            'Gourmet breakfast & dinner prepared by executive chefs',
            'Complimentary access to Sakina Oceanfront Spa & Fitness gym',
            'Direct access to Watamu protected Marine National Reserve',
            'High-speed Starlink WiFi & 24/7 dedicated butler service'
        ],
        roomTypes: [
            { name: 'Medina 1-Bedroom Suite', surcharge: 0 },
            { name: 'Penthouse Oceanview Suite', surcharge: 8000 },
            { name: 'Oceanfront Luxury Villa', surcharge: 18000 }
        ]
    },
    'baobab-beach': {
        key: 'baobab-beach',
        title: '5 Days 4 Nights At Baobab Beach Resort & Spa',
        resortName: 'Baobab Beach Resort & Spa',
        destination: 'Diani Beach, South Coast',
        duration: '5D / 4N',
        image: 'assets/holidays/baobab-beach-resort.jpg',
        rate: 40220,
        originalRate: 145000,
        discount: '72% OFF',
        mealPlan: 'All-Inclusive Dining & Cocktails',
        inclusions: [
            'Accommodation across 80 acres of indigenous coastal forest',
            '3 sparkling cascading swimming pools with ocean lookouts',
            'All meals, soft drinks, local beers and spirits included',
            'Tennis courts, table tennis & archery activities'
        ],
        roomTypes: [
            { name: 'Standard Forest Room', surcharge: 0 },
            { name: 'Superior Sea Facing Room', surcharge: 5000 },
            { name: 'Deluxe Bungalow', surcharge: 10000 }
        ]
    },
    'leopard-beach': {
        key: 'leopard-beach',
        title: '5 Days 4 Nights At Leopard Beach Resort & Spa',
        resortName: 'Leopard Beach Resort & Spa',
        destination: 'Diani Beach, South Coast',
        duration: '5D / 4N',
        image: 'assets/holidays/leopard-beach-resort.jpg',
        rate: 59600,
        originalRate: 190000,
        discount: '68% OFF',
        mealPlan: 'Half Board Dining',
        inclusions: [
            'Half board buffet dining at Horizon Restaurant',
            'Access to Uzuri Spa & Wellness forest sanctuaries',
            'Private beach cove with coral reef snorkeling'
        ],
        roomTypes: [
            { name: 'Superior Balcony Room', surcharge: 0 },
            { name: 'Chui Ocean Front Cottage', surcharge: 7000 }
        ]
    },
    'serena-beach': {
        key: 'serena-beach',
        title: '3 Days 2 Nights At Serena Beach Resort & Spa',
        resortName: 'Serena Beach Resort & Spa',
        destination: 'Shanzu Beach, Mombasa North Coast',
        duration: '3D / 2N',
        image: 'assets/holidays/serena-beach-resort.jpg',
        rate: 18475,
        originalRate: 48000,
        discount: '61% OFF',
        mealPlan: 'Half Board Dining',
        inclusions: [
            'Authentic Swahili village architectural setting',
            'Half board dining at the historic Jahazi Marine Restaurant',
            'Butterfly sanctuary guided tour & nature trail walk'
        ],
        roomTypes: [
            { name: 'Village Room', surcharge: 0 },
            { name: 'Garden Superior Room', surcharge: 4000 }
        ]
    },
    'swahili-beach': {
        key: 'swahili-beach',
        title: '3 Days 2 Nights At Swahili Beach Resort Diani',
        resortName: 'Swahili Beach Resort Diani',
        destination: 'Diani Beach, South Coast',
        duration: '3D / 2N',
        image: 'assets/holidays/swahili-beach-resort.jpg',
        rate: 40100,
        originalRate: 85000,
        discount: '53% OFF',
        mealPlan: 'Half Board Dining',
        inclusions: [
            'Iconic 8-tier cascading swimming pool spanning 200 meters',
            'Majilis dining experience & Indian-Arabic fusion cuisine',
            'Prime beach location with white sand views'
        ],
        roomTypes: [
            { name: 'Standard Deluxe', surcharge: 0 },
            { name: 'Executive Suite', surcharge: 8000 }
        ]
    },
    'masai-mara': {
        key: 'masai-mara',
        title: '3 Days 2 Nights Mara Sopa Migration Safari Package',
        resortName: 'Masai Mara Sopa Lodge',
        destination: 'Masai Mara Game Reserve, Kenya',
        duration: '3D / 2N',
        image: 'assets/holidays/masai-mara-sopa-lodge.jpg',
        rate: 13350,
        originalRate: 32000,
        discount: '58% OFF',
        mealPlan: 'Full Board Bush Dining (All meals included)',
        inclusions: [
            'Comprehensive safari package with 4x4 Land Cruiser game drives',
            'Full board breakfast, bush picnic lunch & evening buffet dinner',
            'Scenic vistas of Oloolaimutia Hills & Big Five tracking with licensed guide',
            'Evening Maasai cultural moran warrior dance around the bonfire'
        ],
        roomTypes: [
            { name: 'Standard Safari Rondavel', surcharge: 0 },
            { name: 'Panoramic Hillside Suite', surcharge: 6000 }
        ]
    },
    'sarova-whitesands': {
        key: 'sarova-whitesands',
        title: '4 Days 3 Nights At Sarova Whitesands Beach Resort',
        resortName: 'Sarova Whitesands Beach Resort & Spa',
        destination: 'Bamburi Beach, Mombasa North Coast',
        duration: '4D / 3N',
        image: 'assets/holidays/sarova-whitesands.jpg',
        rate: 52800,
        originalRate: 110000,
        discount: '52% OFF',
        mealPlan: 'Half Board Dining',
        inclusions: [
            '5 resort swimming pools with water slide & dive board',
            'Breakfast & dinner at Pavilions & Minazi oceanfront restaurants',
            'Tulia Spa and Ozone Kids Club complimentary access'
        ],
        roomTypes: [
            { name: 'Standard Garden View', surcharge: 0 },
            { name: 'Sea Facing Palm Room', surcharge: 5000 }
        ]
    },
    'neptune-village-3d': {
        key: 'neptune-village-3d',
        title: '3 Days 2 Nights At Neptune Village Beach Resort & Spa',
        resortName: 'Neptune Village Beach Resort & Spa',
        destination: 'Diani, South Coast, Kenya',
        duration: '3D / 2N',
        image: 'assets/holidays/karamu-village.jpg',
        rate: 37620,
        originalRate: 66000,
        discount: '43% OFF',
        mealPlan: 'All-Inclusive Package (Meals, Drinks & Resort Activities)',
        inclusions: [
            '3 Days 2 Nights in a Makuti-thatched superior room',
            'All meals and selected house beverages included',
            'Access to freshwater pools, water sports & evening entertainment'
        ],
        roomTypes: [
            { name: 'Superior Garden Room', surcharge: 0 },
            { name: 'Ocean View Room', surcharge: 4500 }
        ]
    },
    'jambo-mutara-camp': {
        key: 'jambo-mutara-camp',
        title: 'Jambo Mutara Camp',
        resortName: 'Jambo Mutara Camp Laikipia',
        destination: 'Nanyuki / Ol Pejeta & Mutara Conservancy, Kenya',
        duration: '2D / 1N',
        image: 'assets/holidays/safari-holidays.jpg',
        rate: 21200,
        originalRate: 32000,
        discount: '34% OFF',
        mealPlan: 'Full Board Luxury Safari Dining',
        inclusions: [
            'Luxury tented accommodation overlooking Mount Kenya & Aberdares',
            'Full board gourmet bush dining (Breakfast, Lunch & Dinner)',
            'Guided nature walks & wildlife viewing in Mutara Conservancy'
        ],
        roomTypes: [
            { name: 'Luxury Panoramic Tent', surcharge: 0 },
            { name: 'Family Safari Suite Tent', surcharge: 6500 }
        ]
    },
    'medina-palms-3d': {
        key: 'medina-palms-3d',
        title: '3 Days 2 Nights At Medina Palms',
        resortName: 'Medina Palms Luxury Resort',
        destination: 'Watamu Marine Reserve, Kenya',
        duration: '3D / 2N',
        image: 'assets/holidays/medina-palms.jpg',
        rate: 45000,
        originalRate: 90000,
        discount: '50% OFF',
        mealPlan: 'Half Board Luxury Dining',
        inclusions: [
            '3 Days 2 Nights in a Swahili-Moroccan luxury suite',
            'Daily breakfast & dinner at Amandina Restaurant',
            'Direct private beach access to Watamu Marine National Park'
        ],
        roomTypes: [
            { name: 'Medina 1-Bedroom Suite', surcharge: 0 },
            { name: 'Oceanfront Penthouse', surcharge: 7500 }
        ]
    },
    'leopard-beach-3d': {
        key: 'leopard-beach-3d',
        title: '3 Days 2 Nights At Leopard Beach Resort and Spa',
        resortName: 'Leopard Beach Resort & Spa',
        destination: 'Diani Beach, South Coast, Kenya',
        duration: '3D / 2N',
        image: 'assets/holidays/leopard-beach-restaurant.jpg',
        rate: 33300,
        originalRate: 70200,
        discount: '53% OFF',
        mealPlan: 'Half Board Buffet & Chui Grill Dining',
        inclusions: [
            '3 Days 2 Nights accommodation at Diani\'s premier resort',
            'Daily buffet breakfast and themed dinner',
            'Access to Uzuri Spa & Fitness Forest Sanctuary'
        ],
        roomTypes: [
            { name: 'Superior Balcony Room', surcharge: 0 },
            { name: 'Chui Seaview Cottage', surcharge: 6000 }
        ]
    },
    'voyager-beach-resort': {
        key: 'voyager-beach-resort',
        title: '3 Days 2 Nights At Voyager Beach Resort Mombasa',
        resortName: 'Voyager Beach Resort',
        destination: 'Nyali Beach, Mombasa North Coast, Kenya',
        duration: '3D / 2N',
        image: 'assets/holidays/voyager-beach-resort.jpg',
        rate: 19800,
        originalRate: 38000,
        discount: '48% OFF',
        mealPlan: 'All-Inclusive Cruise-Themed Dining',
        inclusions: [
            '3 Days 2 Nights in a cabin-styled garden or sea-view room',
            'All-inclusive meals, snacks, and local beverages',
            '3 swimming pools including whirlpool & watersports centre'
        ],
        roomTypes: [
            { name: 'Garden View Cabin', surcharge: 0 },
            { name: 'Superior Sea View Cabin', surcharge: 4500 }
        ]
    }
};

let currentHolidayBooking = null;

function openHolidayBookingModal(packageKey) {
    const pkg = holidayDb[packageKey] || holidayDb['neptune-village'];
    currentHolidayBooking = pkg;

    const imgEl = document.getElementById('hbm-image');
    if (imgEl) imgEl.src = pkg.image;

    const durEl = document.getElementById('hbm-duration-badge');
    if (durEl) durEl.textContent = pkg.duration;

    const destEl = document.getElementById('hbm-dest-text');
    if (destEl) destEl.textContent = pkg.destination;

    const nameEl = document.getElementById('hbm-package-name');
    if (nameEl) nameEl.textContent = pkg.title;

    const incEl = document.getElementById('hbm-inclusions-text');
    if (incEl) incEl.textContent = `Includes ${pkg.mealPlan}. ${pkg.inclusions[0]}`;

    const isKes = state.currency === 'KES';
    const rateEl = document.getElementById('hbm-base-rate');
    if (rateEl) {
        rateEl.textContent = isKes ? `KES ${pkg.rate.toLocaleString()} / Sharing` : `$${Math.round(pkg.rate / 130)} / Sharing`;
    }

    // Set dates
    const checkin = document.getElementById('hbm-checkin-date');
    const checkout = document.getElementById('hbm-checkout-date');
    const today = new Date();
    const d1 = new Date(today);
    d1.setDate(d1.getDate() + 3);
    const d2 = new Date(d1);
    d2.setDate(d2.getDate() + (pkg.duration.includes('5D') ? 4 : (pkg.duration.includes('4D') ? 3 : 2)));

    const fmt = d => d.toISOString().split('T')[0];
    if (checkin) {
        checkin.min = fmt(today);
        checkin.value = fmt(d1);
    }
    if (checkout) {
        checkout.min = fmt(d1);
        checkout.value = fmt(d2);
    }

    const statusEl = document.getElementById('hbm-status');
    if (statusEl) statusEl.textContent = '';

    calculateHolidayTotal();

    const modal = document.getElementById('holiday-booking-modal');
    if (modal) modal.classList.remove('hidden');
}

function closeHolidayBookingModal() {
    const modal = document.getElementById('holiday-booking-modal');
    if (modal) modal.classList.add('hidden');
}

function openHolidayDetails(packageKey) {
    const pkg = holidayDb[packageKey] || holidayDb['neptune-village'];
    const titleEl = document.getElementById('hdm-title');
    if (titleEl) titleEl.textContent = pkg.resortName;

    const destEl = document.getElementById('hdm-destination');
    if (destEl) destEl.textContent = `${pkg.destination} · ${pkg.duration}`;

    const imgEl = document.getElementById('hdm-image');
    if (imgEl) imgEl.src = pkg.image;

    const durEl = document.getElementById('hdm-duration');
    if (durEl) durEl.textContent = pkg.duration;

    const contentEl = document.getElementById('hdm-content');
    if (contentEl) {
        contentEl.innerHTML = `
            <div class="space-y-2">
                <h4 class="font-bold text-slate-900 text-sm">Package Inclusions:</h4>
                <ul class="space-y-1.5 list-disc pl-5">
                    ${pkg.inclusions.map(inc => `<li>${inc}</li>`).join('')}
                </ul>
            </div>
            <div class="p-3 rounded-xl bg-emerald-50 border border-emerald-200">
                <span class="font-bold text-emerald-800">Dining Plan: </span>
                <span class="text-emerald-700">${pkg.mealPlan}</span>
            </div>
            <div class="text-[11px] text-slate-500">
                <strong>Cancellation Policy:</strong> Free cancellation up to 72 hours before arrival date. Instant confirmation with official resort reservation voucher upon payment.
            </div>
        `;
    }

    const bookBtn = document.getElementById('hdm-book-btn');
    if (bookBtn) {
        bookBtn.onclick = () => {
            closeHolidayDetailsModal();
            openHolidayBookingModal(packageKey);
        };
    }

    const modal = document.getElementById('holiday-details-modal');
    if (modal) modal.classList.remove('hidden');
}

function closeHolidayDetailsModal() {
    const modal = document.getElementById('holiday-details-modal');
    if (modal) modal.classList.add('hidden');
}

function calculateHolidayTotal() {
    const pkg = currentHolidayBooking;
    if (!pkg) return;

    const isKes = state.currency === 'KES';
    const adultsEl = document.getElementById('hbm-adults-count');
    const adults = adultsEl ? Number(adultsEl.value) : 2;

    const roomEl = document.getElementById('hbm-room-type');
    const roomSurchargePerNight = roomEl ? Number(roomEl.value) : 0;
    const nights = pkg.duration.includes('5D') ? 4 : (pkg.duration.includes('4D') ? 3 : 2);
    const roomSurcharge = roomSurchargePerNight * nights;

    let extras = 0;
    const sgrEl = document.getElementById('hbm-addon-sgr');
    if (sgrEl && sgrEl.checked) extras += 4500 * adults;

    const excEl = document.getElementById('hbm-addon-excursion');
    if (excEl && excEl.checked) extras += 6500 * adults;

    const baseCost = pkg.rate * adults;
    const tax = Math.round((baseCost + roomSurcharge) * 0.02);
    const totalKes = baseCost + roomSurcharge + extras + tax;
    const totalUsd = Math.round(totalKes / 130);

    const baseEl = document.getElementById('hbm-summary-base');
    if (baseEl) baseEl.textContent = isKes ? `KES ${baseCost.toLocaleString()}` : `$${Math.round(baseCost / 130)}`;

    const roomSumEl = document.getElementById('hbm-summary-room');
    if (roomSumEl) roomSumEl.textContent = isKes ? `KES ${roomSurcharge.toLocaleString()}` : `$${Math.round(roomSurcharge / 130)}`;

    const extrasEl = document.getElementById('hbm-summary-extras');
    if (extrasEl) extrasEl.textContent = isKes ? `KES ${extras.toLocaleString()}` : `$${Math.round(extras / 130)}`;

    const taxEl = document.getElementById('hbm-summary-tax');
    if (taxEl) taxEl.textContent = isKes ? `KES ${tax.toLocaleString()}` : `$${Math.round(tax / 130)}`;

    const totalEl = document.getElementById('hbm-summary-total');
    if (totalEl) totalEl.textContent = isKes ? `KES ${totalKes.toLocaleString()}` : `$${totalUsd}`;

    const btnLabel = document.getElementById('btn-hbm-label');
    if (btnLabel) {
        btnLabel.textContent = isKes ? `PAY KES ${totalKes.toLocaleString()} VIA M-PESA` : `PAY $${totalUsd} VIA M-PESA`;
    }

    return { totalKes, totalUsd };
}

async function handleHolidayBookingSubmit(event) {
    event.preventDefault();
    if (!currentHolidayBooking) return;
    const checkin = document.getElementById('hbm-checkin-date').value;
    const checkout = document.getElementById('hbm-checkout-date').value;
    const statusEl = document.getElementById('hbm-status');
    const submitBtn = document.getElementById('btn-hbm-submit');
    if (!checkin || !checkout || checkout <= checkin) {
        if (statusEl) statusEl.textContent = 'Choose a check-out date after check-in.';
        return;
    }
    const guestName = document.getElementById('hbm-guest-name')?.value?.trim() || 'Guest';
    const guestEmail = document.getElementById('hbm-guest-email')?.value?.trim() || '';
    const guestPhone = document.getElementById('hbm-guest-phone')?.value?.trim() || '';
    const totals = calculateHolidayTotal() || { totalKes: currentHolidayBooking.rate };
    saveTravelPlan('holiday', 'hbm-status', {
        title: currentHolidayBooking.title,
        checkin,
        checkout,
        travellers: document.getElementById('hbm-adults-count').value + ' Adults',
        guestName,
        guestEmail,
        guestPhone,
        totalKes: `KES ${Number(totals.totalKes || 0).toLocaleString()}`
    });
    if (!guestPhone || !guestEmail) return;
    if (submitBtn) submitBtn.disabled = true;
    const adults = document.getElementById('hbm-adults-count')?.value || '2';
    const roomTypeEl = document.getElementById('hbm-room-type');
    const roomType = roomTypeEl?.options?.[roomTypeEl.selectedIndex]?.text || 'Standard Sharing';
    if (statusEl) statusEl.textContent = `Holding ${currentHolidayBooking.resortName} & sending M-Pesa STK Push to ${guestPhone}...`;
    try {
        const orderRes = await commerceRequest('/orders', {
            customer: { name: guestName, email: guestEmail, phone: guestPhone },
            items: [{
                kind: 'holiday',
                id: currentHolidayBooking.key || 'HOL-1',
                title: `${currentHolidayBooking.title} (${checkin} to ${checkout})`,
                unitPriceKes: Math.round(totals.totalKes || currentHolidayBooking.rate),
                quantity: 1
            }],
            currency: 'KES',
            paymentMethod: 'MPESA'
        });
        const orderReference = orderRes.data.orderReference;
        const holdRes = await commerceRequest('/travel/holidays/reserve', {
            orderReference,
            holiday: currentHolidayBooking,
            guest: { name: guestName, email: guestEmail, phone: guestPhone },
            checkin,
            checkout,
            adults,
            roomType,
            totalKes: Math.round(totals.totalKes || currentHolidayBooking.rate)
        });
        const bookingRef = holdRes?.reservation?.reservationRef || 'HELD';
        const payRes = await commerceRequest('/payments/mpesa/stkpush', { orderReference, phone: guestPhone });
        if (payRes.mode === 'demo') {
            const conf = await commerceRequest('/payments/demo/confirm', { orderReference, checkoutRequestId: payRes.CheckoutRequestID });
            const confirmedRes = await commerceRequest('/travel/reservations/' + encodeURIComponent(orderReference)).catch(() => null);
            const voucher = confirmedRes?.reservation?.confirmationCode || bookingRef;
            rememberOrder(conf.data, conf.passes);
            if (statusEl) statusEl.textContent = `Holiday confirmed! Ref: ${bookingRef} · Voucher: ${voucher} · Order: ${orderReference}`;
        } else {
            if (statusEl) statusEl.textContent = `Resort Ref ${bookingRef} held. ${payRes.CustomerMessage || `STK Push sent to ${guestPhone}!`}`;
            for (let attempt = 0; attempt < 15; attempt++) {
                await new Promise(resolve => setTimeout(resolve, 3500));
                const check = await commerceRequest('/payments/status/' + encodeURIComponent(orderReference) + '?email=' + encodeURIComponent(guestEmail)).catch(() => null);
                if (check?.status === 'COMPLETED') {
                    const confirmedRes = await commerceRequest('/travel/reservations/' + encodeURIComponent(orderReference)).catch(() => null);
                    const voucher = confirmedRes?.reservation?.confirmationCode || bookingRef;
                    rememberOrder(check.order, check.passes);
                    if (statusEl) statusEl.textContent = `Holiday confirmed! Ref: ${bookingRef} · Voucher: ${voucher}`;
                    showToast(`Holiday confirmed! Voucher ${voucher}`);
                    return;
                }
                if (check?.status === 'FAILED') {
                    throw new Error(check.reason || 'Payment declined or cancelled on mobile phone.');
                }
            }
        }
        if (typeof showToast === 'function') {
            showToast(`Resort Ref ${bookingRef} held — complete M-Pesa prompt on ${guestPhone}`);
        }
    } catch (err) {
        if (statusEl) statusEl.textContent = err.message || 'Could not complete holiday reservation.';
    } finally {
        if (submitBtn) submitBtn.disabled = false;
    }
}

function saveTravelPlan(kind, statusId, plan) {
    const status = document.getElementById(statusId);
    try {
        localStorage.setItem('ticketsasa-' + kind + '-itinerary', JSON.stringify(plan));
        status.textContent = 'Itinerary saved on this browser. Booking requires provider confirmation.';
    } catch {
        status.textContent = 'This browser could not save the itinerary.';
    }
}

function showTravelPlan(kind) {
    const status = document.getElementById('saved-' + kind + '-status');
    try {
        const plan = JSON.parse(localStorage.getItem('ticketsasa-' + kind + '-itinerary'));
        status.textContent = plan ? Object.values(plan).filter(Boolean).join(' · ') : 'No saved itinerary yet.';
    } catch {
        status.textContent = 'Could not load the saved itinerary.';
    }
}

// Maintain backwards compatibility for card clicks
function openHolidayPlan(card, saved) {
    const key = card?.dataset?.key || 'neptune-village';
    openHolidayBookingModal(key);
}


// ============================================================================
// ADMIN LAUNCHER MODAL
// ============================================================================




function openJazaInfo() {
    const jazaBox = document.getElementById('jaza-info-box');
    if (jazaBox) {
        jazaBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
        jazaBox.classList.add('ring-4', 'ring-amber-400');
        setTimeout(() => {
            jazaBox.classList.remove('ring-4', 'ring-amber-400');
        }, 2000);
    }
}

function openChatWithContext(topic) {
    toggleChatSupport(true);
    document.querySelector('#chat-support-modal input').value = topic;
}

// ============================================================================
function formatMoney(value, currency) {
    return new Intl.NumberFormat('en-KE', { style: 'currency', currency, currencyDisplay: 'code' }).format(value);
}

async function commerceRequest(path, body) {
    const response = await fetch('/api' + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30000)
    }).catch(() => { throw new Error('Could not reach the booking service. Try again.'); });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(result.message || 'The booking request failed.'), { status: response.status });
    return result;
}

async function loadCommerceCatalog() {
    try {
        const tickets = await commerceRequest('/tickets');
        for (const tier of tickets.data) {
            const saved = savedTicketQuantities[tier.tierKey];
            state.quantities[tier.tierKey] ??= Number.isSafeInteger(saved) && saved > 0 ? saved : 0;
            state.tierPrices[tier.tierKey] = {
                name: tier.title, eventId: tier.eventId, eventTitle: tier.eventTitle, kes: tier.priceKes, usd: tier.priceUsd,
                gate: tier.designatedGate, stock: tier.remainingAllocation
            };
        }
        savedTicketQuantities = {};
        const available = new Map(tickets.data.map(tier => [tier.tierKey, tier.remainingAllocation]));
        for (const key of Object.keys(state.quantities)) {
            state.quantities[key] = Math.min(state.quantities[key], available.get(key) ?? 0);
        }
        renderDemoTicketOptions(tickets.data.filter(tier => !tier.published));
        renderPublishedTiers(tickets.data);
        updatePriceDisplays();
        updateCartDisplay();
    } catch {
        const status = document.getElementById('demo-ticket-status');
        if (status) status.textContent = 'Ticket options could not be loaded. Refresh to try again.';
    }
}

let walletReturnFocus;

function openTicketWallet() {
    walletReturnFocus = document.activeElement;
    const wallet = document.getElementById('ticket-wallet');
    wallet.classList.remove('hidden');
    document.getElementById('wallet-reference').focus();
}

function closeTicketWallet() {
    document.getElementById('ticket-wallet').classList.add('hidden');
    walletReturnFocus?.focus();
}

function rememberOrder(order, passes) {
    state.passes = passes;
    updateCartDisplay();
    const summary = document.getElementById('wallet-status');
    const status = { COMPLETED: 'Completed', PROCESSING: 'Awaiting confirmation', PENDING: 'Awaiting payment', FAILED: 'Failed' };
    summary.textContent = ['Order', status[order.paymentStatus], order.orderReference].filter(Boolean).join(' · ');
    const list = document.getElementById('wallet-passes');
    list.replaceChildren();
    for (const pass of passes) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'block w-full rounded-lg border border-slate-200 px-3 py-2 text-left text-sm';
        button.textContent = [pass.eventTitle, pass.tierName, pass.status].filter(Boolean).join(' · ');
        button.addEventListener('click', () => openDigitalPass(pass));
        list.append(button);
    }
}

async function lookupTicketOrder(event) {
    event.preventDefault();
    const status = document.getElementById('wallet-status');
    const button = event.submitter;
    if (button) button.disabled = true;
    status.textContent = 'Looking up your order…';
    document.getElementById('wallet-passes').replaceChildren();
    try {
        const result = await commerceRequest('/orders/lookup', {
            email: document.getElementById('wallet-email').value,
            orderReference: document.getElementById('wallet-reference').value
        });
        rememberOrder(result.data, result.passes);
    } catch (error) {
        status.textContent = error.message;
    } finally {
        if (button) button.disabled = false;
    }
}

function submitSupportQuestion(trigger) {
    const modal = trigger.closest('#chat-support-modal, #live-chat-modal');
    const input = modal.querySelector('[data-support-input]');
    const message = input.value.trim();
    if (!message) return;

    const answers = [
        [/refund|cancel/i, 'Demo orders do not charge money. Refund requests for purchases made elsewhere are handled by the original seller.'],
        [/qr|gate|ticket|order|pass/i, 'Open Tickets in the header. Enter your order reference and checkout email, then select a pass to view its QR code.'],
        [/pay|mpesa|checkout|cart/i, 'Choose tickets for an event on sale, then review your order to pay by M-Pesa.'],
        [/flight|holiday|hotel/i, 'You can browse the travel pages here. Flight and holiday booking are unavailable in the app.'],
    ];
    const answer = answers.find(([pattern]) => pattern.test(message))?.[1] ??
        'I can help with ticket lookup, M-Pesa checkout, seating, and travel availability. Which one do you need?';
    const log = modal.querySelector('[data-support-messages]');
    for (const [label, text] of [['You', message], ['Help', answer]]) {
        const entry = document.createElement('p');
        entry.className = 'rounded-lg border border-slate-200 bg-white p-3 text-slate-900';
        entry.textContent = label + ': ' + text;
        log.append(entry);
    }
    input.value = '';
    log.scrollTop = log.scrollHeight;
    input.focus();
}

function filterBlog(value) {
    const query = value.trim().toLowerCase();
    let count = 0;
    document.querySelectorAll('[data-blog-post]').forEach(post => {
        const match = post.textContent.toLowerCase().includes(query);
        post.classList.toggle('hidden', !match);
        if (match) count++;
    });
    document.getElementById('blog-result-status').textContent = query
        ? count + (count === 1 ? ' article found.' : ' articles found.') : '';
}

function filterBlogCategory(category) {
    const cat = String(category || 'all').trim().toLowerCase();
    let count = 0;
    document.querySelectorAll('[data-blog-post]').forEach(post => {
        const postCat = (post.getAttribute('data-blog-cat') || post.textContent || '').toLowerCase();
        const match = cat === 'all' || postCat.includes(cat);
        post.classList.toggle('hidden', !match);
        if (match) count++;
    });
    const statusEl = document.getElementById('blog-result-status');
    if (statusEl) {
        statusEl.textContent = cat === 'all' ? '' : `${count} article(s) in "${category}".`;
    }
}

async function executeCheckTicket() {
    const refInput = document.getElementById('check-ticket-ref');
    const emailInput = document.getElementById('check-ticket-email');
    const resEl = document.getElementById('check-ticket-result');
    if (!refInput || !emailInput || !resEl) return;
    const orderReference = refInput.value.trim();
    const email = emailInput.value.trim();
    if (!orderReference || !email) return;
    resEl.textContent = 'Verifying your ticket order on Ticketsasa...';
    try {
        const result = await commerceRequest('/orders/lookup', { email, orderReference });
        rememberOrder(result.data, result.passes);
        resEl.textContent = `Order ${result.data.orderReference} verified (${result.passes.length} pass(es)). Opening Ticket Wallet...`;
        openTicketWallet();
    } catch (err) {
        resEl.textContent = err.message || 'Could not find a matching ticket order. Check your reference and email.';
    }
}

let signedInAccount = null;
let accountProviders;
let accountRequestInProgress = false;
let accountChanged = false;
const accountPrefills = new Map();

function showAccount(user) {
    signedInAccount = user;
    const nav = document.getElementById('account-nav');
    if (nav) nav.textContent = user ? 'My account' : 'Log In';
    for (const surface of document.querySelectorAll('[data-auth-surface]')) {
        surface.querySelector('[data-auth-form]').hidden = Boolean(user);
        surface.querySelector('[data-account-panel]').hidden = !user;
        surface.querySelector('[data-account-name]').textContent = user ? user.name + ' · ' + user.email : '';
        updateAccountReadiness(surface.querySelector('[data-auth-form]'));
    }
    for (const [input, value] of accountPrefills) {
        if (input.value === value) input.value = '';
    }
    accountPrefills.clear();
    if (user) {
        for (const [id, value] of [
            ['cust-name', user.name], ['cust-email', user.email],
            ['wallet-email', user.email], ['ts-cust-name', user.name], ['ts-cust-email', user.email]
        ]) {
            const input = document.getElementById(id);
            if (input && !input.value) {
                input.value = value;
                accountPrefills.set(input, value);
            }
        }
    }
}

async function restoreAccount() {
    try {
        const { user } = await commerceRequest('/auth/me');
        if (!accountChanged) showAccount(user);
    } catch {
        // A visitor without a session stays signed out.
    }
}

async function loadAccountProviders() {
    const notices = {
        'google-unavailable': 'Google sign-in is not configured.',
        'google-failed': 'Google sign-in could not be completed. Try again.',
        'google-account': 'Use a Gmail or Google Workspace account, or confirm your email and sign in with your password.'
    };
    const notice = notices[new URLSearchParams(location.search).get('auth')];
    if (notice) {
        const status = document.querySelector('#view-login [data-auth-status]');
        if (status) status.textContent = notice;
        const url = new URL(location.href);
        url.searchParams.delete('auth');
        history.replaceState(history.state, '', url);
    }
    await refreshAccountProviders();
}

async function refreshAccountProviders() {
    try {
        accountProviders = await commerceRequest('/auth/providers');
    } catch {
        accountProviders = { storageAvailable: false, google: false, confirmationEmail: false };
    }
    for (const form of document.querySelectorAll('[data-auth-form]')) updateAccountReadiness(form);
}

function updateAccountReadiness(form) {
    const surface = form.closest('[data-auth-surface]');
    const readiness = surface.querySelector('[data-auth-readiness]');
    const registering = form.dataset.mode === 'register';
    const connected = accountProviders?.storageAvailable !== false;
    const canConfirm = accountProviders?.confirmationEmail !== false || accountProviders?.instantRegistration === true;
    const message = signedInAccount ? '' : !connected
        ? 'Accounts are temporarily unavailable. You can still look up an existing ticket.'
        : registering && !canConfirm
            ? 'Account creation is temporarily unavailable because confirmation emails cannot be sent.'
            : '';
    readiness.textContent = message;
    readiness.hidden = !message;
    form.querySelector('button[type=submit]').disabled =
        accountRequestInProgress || !connected || (registering && !canConfirm);
    form.querySelector('[data-auth-resend]').hidden = !connected || !accountProviders?.confirmationEmail;
    // Google OAuth is unavailable inside Android WebView.
    const googleLink = form.querySelector('[data-auth-google]');
    if (googleLink) {
        googleLink.hidden = !connected || !accountProviders?.google || /; wv\)/.test(navigator.userAgent);
    }
}

async function resendAccountConfirmation(button) {
    if (accountRequestInProgress) return;
    const form = button.form;
    const email = form.elements.email;
    const status = form.closest('[data-auth-surface]').querySelector('[data-auth-status]');
    if (!email.reportValidity()) return;
    accountRequestInProgress = true;
    button.disabled = true;
    status.textContent = 'Requesting a new confirmation link…';
    try {
        const result = await commerceRequest('/auth/resend-confirmation', { email: email.value });
        status.textContent = result.message;
    } catch (error) {
        status.textContent = error.message;
    } finally {
        accountRequestInProgress = false;
        button.disabled = false;
    }
}

function setAccountMode(form, mode) {
    const registering = mode === 'register';
    form.dataset.mode = mode;
    form.querySelector('[data-auth-name]').hidden = !registering;
    form.elements.name.required = registering;
    form.elements.password.minLength = registering ? 12 : 0;
    form.elements.password.autocomplete = registering ? 'new-password' : 'current-password';
    form.querySelector('button[type=submit]').textContent = registering ? 'Create account' : 'Log In';
    form.querySelector('[data-auth-toggle]').textContent = registering ? 'Back to log in' : 'Create an account';
    const title = form.closest('#ticketsasa-auth-modal') ? document.getElementById('ts-auth-title') : document.getElementById('login-page-title');
    if (title && (!form.closest('#ticketsasa-auth-modal') || ['login', 'register'].includes(title.closest('[role=dialog]').dataset.mode))) {
        title.textContent = signedInAccount ? 'My account' : registering ? 'Create a Ticketsasa account' : 'Log In to Ticketsasa';
    }
    updateAccountReadiness(form);
    form.closest('[data-auth-surface]').querySelector('[data-auth-status]').textContent = registering
        ? 'Use at least 12 characters for your password.' : '';
}

function toggleAccountMode(form) {
    if (accountRequestInProgress) return;
    setAccountMode(form, form.dataset.mode === 'register' ? 'login' : 'register');
}

async function handleAccountLogin(event) {
    event.preventDefault();
    if (accountRequestInProgress) return;
    const form = event.currentTarget;
    const status = form.closest('[data-auth-surface]').querySelector('[data-auth-status]');
    const submit = form.querySelector('button[type=submit]');
    const registering = form.dataset.mode === 'register';
    accountRequestInProgress = true;
    submit.disabled = true;
    status.textContent = registering ? 'Creating your account…' : 'Signing in…';
    try {
        const result = await commerceRequest(registering ? '/auth/register' : '/auth/login', {
            name: form.elements.name.value, email: form.elements.email.value, password: form.elements.password.value
        });
        if (registering && !result.verified) {
            setAccountMode(form, 'login');
            status.textContent = result.message;
            return;
        }
        accountChanged = true;
        form.reset();
        setAccountMode(form, 'login');
        showAccount(result.user);
        if (form.closest('#ticketsasa-auth-modal')) closeTicketsasaAuthModal();
        showToast(registering ? 'Account created and signed in.' : 'You are signed in.');
    } catch (error) {
        status.textContent = error.message;
    } finally {
        form.elements.password.value = '';
        accountRequestInProgress = false;
        updateAccountReadiness(form);
    }
}

async function signOutAccount(button) {
    if (accountRequestInProgress) return;
    const status = button.closest('[data-auth-surface]').querySelector('[data-auth-status]');
    accountRequestInProgress = true;
    button.disabled = true;
    status.textContent = 'Signing out…';
    try {
        await commerceRequest('/auth/logout', {});
        accountChanged = true;
        showAccount(null);
        state.passes = [];
        document.getElementById('wallet-passes')?.replaceChildren();
        for (const id of ['wallet-reference', 'wallet-email']) {
            const field = document.getElementById(id);
            if (field) field.value = '';
        }
        const walletStatus = document.getElementById('wallet-status');
        if (walletStatus) walletStatus.textContent = '';
        status.textContent = 'Signed out.';
    } catch (error) {
        status.textContent = error.message;
    } finally {
        accountRequestInProgress = false;
        button.disabled = false;
        updateAccountReadiness(button.closest('[data-auth-surface]').querySelector('[data-auth-form]'));
    }
}

function renderDemoTicketOptions(tiers, options = document.getElementById('demo-ticket-options')) {
    if (!options) return;
    const status = document.getElementById('demo-ticket-status');
    if (options.id === 'demo-ticket-options' && status) {
        status.textContent = tiers.length ? '' : '';
    }
    options.replaceChildren();
    for (const tier of tiers) {
        const card = document.createElement('article');
        card.className = 'space-y-2 rounded-xl border border-slate-200 p-3';
        const title = document.createElement('h3');
        title.className = 'font-bold';
        title.textContent = tier.title;
        const event = document.createElement('p');
        event.className = 'text-sm text-slate-600';
        event.textContent = tier.eventTitle;
        const price = document.createElement('p');
        price.className = 'tier-price text-sm';
        price.dataset.kes = tier.priceKes;
        price.dataset.usd = tier.priceUsd;
        price.textContent = formatMoney(state.currency === 'KES' ? tier.priceKes : tier.priceUsd, state.currency);
        const controls = document.createElement('div');
        controls.className = 'flex items-center gap-3';
        const quantity = document.createElement('output');
        quantity.id = 'qty-' + tier.tierKey;
        quantity.dataset.ticketQuantity = tier.tierKey;
        quantity.textContent = state.quantities[tier.tierKey];
        const adjust = (label, change) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'min-h-11 min-w-11 rounded-lg bg-slate-100 font-semibold';
            button.textContent = label;
            button.setAttribute('aria-label', (change < 0 ? 'Remove ' : 'Add ') + tier.title);
            button.disabled = tier.remainingAllocation === 0;
            button.addEventListener('click', () => updateQty(tier.tierKey, change));
            return button;
        };
        controls.append(adjust('−', -1), quantity, adjust('+', 1));
        const availability = document.createElement('p');
        availability.className = 'text-sm font-medium';
        availability.textContent = tier.remainingAllocation === 0 ? 'Sold out'
            : tier.remainingAllocation.toLocaleString('en-KE') + ' seats remaining';
        card.append(event, title, price, availability);
        card.append(controls);
        options.append(card);
    }
}

// =========================================================================
const publishedOptions = new Map();
const publishedEventDates = new Map();
const eventDateFormatter = new Intl.DateTimeFormat('en-KE', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Nairobi'
});
let currentTicketTiers = [];
const ticketsasaCatalogMap = new Map();
let activeTicketsasaDetailEvent = null;
let pendingDetailOrder;

window.onTicketsasaCatalogLoaded = function (eventsList) {
    if (!Array.isArray(eventsList)) return;
    for (const ev of eventsList) {
        if (ev?.id) ticketsasaCatalogMap.set(ev.id, ev);
    }
};

async function loadPublishedEvents() {
    const section = document.getElementById('published-events');
    try {
        const { data } = await commerceRequest('/published-events');
        for (const ev of data) {
            if (ev?.id) {
                const existing = ticketsasaCatalogMap.get(ev.id);
                ticketsasaCatalogMap.set(ev.id, {
                    ...existing,
                    ...ev,
                    tiers: ev.tiers?.length ? ev.tiers : (existing?.tiers || [])
                });
            }
        }
        section.querySelectorAll('[data-published-search]').forEach(card => card.remove());
        publishedOptions.clear();
        document.getElementById('published-status').textContent = data.length ? '' : 'No events currently have tickets on this site.';
        const focused = new URLSearchParams(location.search).get('event');
        for (const event of data) {
            publishedEventDates.set(event.id, event.startsAt);
            const card = document.createElement('details');
            card.className = 'rounded-xl border border-slate-200 bg-white p-4';
            card.open = event.id === focused;
            card.dataset.publishedSearch = [event.title, event.venue, event.description].join(' ').toLowerCase();
            const title = document.createElement('summary');
            title.className = 'cursor-pointer text-lg font-semibold';
            title.textContent = event.title;
            const info = document.createElement('p');
            info.textContent = event.venue + ' · ' + (event.startAtLabel || eventDateFormatter.format(new Date(event.startsAt)));
            const description = document.createElement('p');
            description.className = 'my-3 whitespace-pre-line';
            description.textContent = event.description;
            const permalink = document.createElement('a');
            permalink.href = '?view=events&event=' + encodeURIComponent(event.id);
            permalink.textContent = 'Open Ticketsasa Event & Booking Page →';
            permalink.className = 'underline text-rose-700 font-semibold';
            permalink.addEventListener('click', ev => {
                ev.preventDefault();
                openTicketsasaEventModal(event.id);
            });
            card.append(title, info, description, permalink);
            if (event.image) {
                const image = new Image();
                image.src = event.image.startsWith('/') ? event.image.slice(1) : event.image;
                image.alt = event.title;
                image.loading = 'lazy';
                image.className = 'my-3 max-h-64 rounded-lg object-contain';
                card.append(image);
            }
            const options = document.createElement('div');
            options.className = 'grid gap-3 sm:grid-cols-2';
            if (event.onSale) {
                publishedOptions.set(event.id, options);
                const checkout = document.createElement('button');
                checkout.type = 'button';
                checkout.className = 'my-3 rounded-lg bg-rose-700 px-4 py-2 font-semibold text-white';
                checkout.textContent = 'Review ticket order';
                checkout.addEventListener('click', openCheckoutModal);
                checkout.hidden = true;
                card.append(options, checkout);
            }
            else options.textContent = 'Tickets are currently off sale.';
            if (!options.parentNode) card.append(options);
            section.append(card);
            if (card.open) card.scrollIntoView({ block: 'start' });
        }
        if (document.getElementById('event-search-input').value.trim()) {
            const term = document.getElementById('event-search-input').value.trim().toLowerCase();
            for (const card of section.querySelectorAll('[data-published-search]')) {
                card.hidden = !card.dataset.publishedSearch.includes(term);
            }
            if (data.length && !section.querySelector('[data-published-search]:not([hidden])')) {
                document.getElementById('published-status').textContent = 'No ticketed events match your search.';
            }
        }
        renderDemoTicketOptions(currentTicketTiers.filter(tier => !tier.published));
        renderPublishedTiers(currentTicketTiers);
    } catch {
        document.getElementById('published-status').textContent = 'Ticketed events could not be loaded.';
    }
}

function renderPublishedTiers(tiers) {
    currentTicketTiers = tiers;
    for (const [id, options] of publishedOptions) {
        const eventTiers = tiers.filter(tier => tier.eventId === id);
        renderDemoTicketOptions(eventTiers, options);
        options.nextElementSibling.hidden = !eventTiers.some(tier => tier.remainingAllocation > 0);
        if (!options.children.length) options.textContent = 'Tickets are off sale or availability is unavailable.';
    }
}


function openTicketsasaEventModal(eventId) {
    let ev = ticketsasaCatalogMap.get(eventId);
    if (!ev) {
        ev = [...ticketsasaCatalogMap.values()].find(item => item.slug === eventId || String(item.numericId) === eventId);
    }
    if (!ev) return;
    activeTicketsasaDetailEvent = ev;

    const imgPath = (ev.imageUrl || ev.image || 'assets/real/QZGqWDTxBF-1791963807.jpg').replace(/^\//, '');
    const catEl = document.getElementById('ts-detail-category');
    const titleEl = document.getElementById('ts-detail-title');
    const venueEl = document.getElementById('ts-detail-venue');
    const dateEl = document.getElementById('ts-detail-date');
    const imgEl = document.getElementById('ts-detail-image');
    const ticketHeadingEl = document.getElementById('ts-detail-ticket-heading');
    const hostEl = document.getElementById('ts-detail-host');
    const descEl = document.getElementById('ts-detail-description');
    const datesBoxEl = document.getElementById('ts-detail-dates-box');
    const locBoxEl = document.getElementById('ts-detail-location-box');
    const mapLinkEl = document.getElementById('ts-detail-map-link');
    const statusEl = document.getElementById('ts-checkout-status');

    if (catEl) catEl.textContent = ev.category || 'Featured Event';
    if (titleEl) titleEl.textContent = ev.title;
    if (venueEl) venueEl.textContent = ev.locationFull || ev.venue || 'Nairobi, Kenya';
    if (dateEl) dateEl.textContent = ev.formattedDate || ev.startAtLabel || eventDateFormatter.format(new Date(ev.startsAt));
    if (imgEl) {
        imgEl.src = imgPath;
        imgEl.alt = ev.title;
        imgEl.onerror = () => {
            if (ev.remoteImageUrl && imgEl.src !== ev.remoteImageUrl) imgEl.src = ev.remoteImageUrl;
        };
    }
    if (ticketHeadingEl) ticketHeadingEl.textContent = 'Get your tickets to ' + ev.title;
    if (hostEl) hostEl.textContent = ev.host || 'Ticketsasa Official Organizer';
    if (descEl) descEl.textContent = ev.description || '';
    if (datesBoxEl) datesBoxEl.textContent = ev.startAtLabel || ev.formattedDate || eventDateFormatter.format(new Date(ev.startsAt));
    if (locBoxEl) locBoxEl.textContent = ev.locationFull || ev.venue || 'Nairobi, Kenya';
    if (mapLinkEl) {
        mapLinkEl.href = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(ev.locationFull || ev.venue || 'Nairobi');
    }
    const mapFrame = document.getElementById('ts-detail-map-iframe');
    if (mapFrame) {
        mapFrame.src = 'https://maps.google.com/maps?q=' + encodeURIComponent(ev.locationFull || ev.venue || 'Nairobi, Kenya') + '&output=embed';
    }
    if (statusEl) statusEl.textContent = '';

    const eventTiers = currentTicketTiers.filter(tier => tier.eventId === ev.id);
    activeTicketsasaDetailEvent = { ...ev, tiers: eventTiers };
    const bookButton = document.getElementById('ts-btn-book-now');
    if (bookButton) bookButton.disabled = !eventTiers.some(tier => tier.remainingAllocation > 0);
    if (statusEl && !eventTiers.some(tier => tier.remainingAllocation > 0)) {
        statusEl.textContent = 'Tickets for this event are unavailable.';
    }
    for (const tier of eventTiers) {
        state.quantities[tier.tierKey] ??= 0;
        state.tierPrices[tier.tierKey] = {
            name: tier.title,
            eventId: ev.id,
            eventTitle: ev.title,
            kes: Math.max(1, Number(tier.priceKes || ev.startingPrice || 1000)),
            usd: Math.max(1, Number(tier.priceUsd || Math.round((tier.priceKes || 1000) / 125))),
            gate: tier.designatedGate || 'Gate A',
            stock: tier.remainingAllocation
        };
    }
    const firstAvailable = eventTiers.find(tier => tier.remainingAllocation > 0);
    if (firstAvailable && !eventTiers.some(tier => (state.quantities[tier.tierKey] || 0) > 0)) {
        updateQty(firstAvailable.tierKey, 1);
    }

    renderTicketsasaDetailTiers(eventTiers);
    renderTicketsasaRelatedEvents(ev.id);

    const modal = document.getElementById('ticketsasa-event-modal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.scrollTop = 0;
    }
}
window.openTicketsasaEventModal = openTicketsasaEventModal;

function closeTicketsasaEventModal() {
    const modal = document.getElementById('ticketsasa-event-modal');
    if (modal) modal.classList.add('hidden');
}

function renderTicketsasaDetailTiers(eventTiers) {
    const tbody = document.getElementById('ts-detail-tiers-tbody');
    if (!tbody) return;
    tbody.replaceChildren();
    const isKes = state.currency === 'KES';

    for (const tier of eventTiers) {
        const qty = state.quantities[tier.tierKey] || 0;
        const unitPrice = isKes ? tier.priceKes : tier.priceUsd;
        const subtotal = qty * unitPrice;

        const tr = document.createElement('tr');
        tr.className = 'hover:bg-slate-50/80 transition';
        tr.innerHTML = `
            <td class="py-3.5 px-4">
                <div class="font-extrabold text-slate-900">${tier.title}</div>
                <div class="text-[11px] text-slate-500 mt-0.5">Closes on ${tier.formattedSaleEnd || 'Event Day'} &bull; ${tier.designatedGate || 'Gate A'}</div>
            </td>
            <td class="py-3.5 px-4 font-bold text-slate-900">
                ${isKes ? 'KES ' + Number(tier.priceKes).toLocaleString() : '$' + tier.priceUsd}
            </td>
            <td class="py-3.5 px-4">
                <div class="flex items-center justify-center gap-2">
                    <button type="button" data-ts-tier="${tier.tierKey}" data-ts-delta="-1" class="w-8 h-8 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 font-extrabold text-slate-700">&minus;</button>
                    <span class="w-7 text-center font-extrabold text-slate-900">${qty}</span>
                    <button type="button" data-ts-tier="${tier.tierKey}" data-ts-delta="1" class="w-8 h-8 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 font-extrabold text-slate-700">&plus;</button>
                </div>
            </td>
            <td class="py-3.5 px-4 text-right font-extrabold text-slate-900">
                ${isKes ? 'KES ' + Number(subtotal).toLocaleString() : '$' + subtotal.toFixed(2)}
            </td>
        `;
        tr.querySelectorAll('button[data-ts-tier]').forEach(btn => {
            btn.addEventListener('click', () => {
                updateQty(btn.dataset.tsTier, Number(btn.dataset.tsDelta));
                renderTicketsasaDetailTiers(eventTiers);
            });
        });
        tbody.append(tr);
    }

    // Update live Your Order box
    const linesEl = document.getElementById('ts-detail-order-lines');
    const countEl = document.getElementById('ts-detail-order-count');
    const totalEl = document.getElementById('ts-detail-order-total');
    let selectedCount = 0;
    let totalAmount = 0;

    if (linesEl) {
        linesEl.replaceChildren();
        for (const tier of eventTiers) {
            const qty = state.quantities[tier.tierKey] || 0;
            if (!qty) continue;
            selectedCount += qty;
            const unit = isKes ? tier.priceKes : tier.priceUsd;
            const lineSub = qty * unit;
            totalAmount += lineSub;

            const row = document.createElement('div');
            row.className = 'flex items-center justify-between py-1 border-b border-slate-100 last:border-0';
            row.innerHTML = `
                <div>
                    <span class="font-bold text-slate-900">${qty} &times; ${tier.title}</span>
                    <span class="text-slate-400 ml-1">(${activeTicketsasaDetailEvent?.title || ''})</span>
                </div>
                <div class="flex items-center gap-3">
                    <span class="font-bold text-slate-900">${isKes ? 'KES ' + lineSub.toLocaleString() : '$' + lineSub.toFixed(2)}</span>
                    <button type="button" class="text-rose-600 hover:underline font-bold text-[11px]">Remove</button>
                </div>
            `;
            row.querySelector('button').addEventListener('click', () => {
                updateQty(tier.tierKey, -qty);
                renderTicketsasaDetailTiers(eventTiers);
            });
            linesEl.append(row);
        }
        if (!selectedCount) {
            const p = document.createElement('p');
            p.className = 'text-slate-400';
            p.textContent = 'Select ticket quantities above to build your order.';
            linesEl.append(p);
        }
    }
    if (countEl) countEl.textContent = `${selectedCount} ${selectedCount === 1 ? 'ticket' : 'tickets'} selected`;
    if (totalEl) totalEl.textContent = isKes ? `KES ${totalAmount.toLocaleString()}` : `$${totalAmount.toFixed(2)}`;
}

function renderTicketsasaRelatedEvents(excludeId) {
    const grid = document.getElementById('ts-detail-related-grid');
    if (!grid) return;
    grid.replaceChildren();
    const others = [...ticketsasaCatalogMap.values()].filter(e => e.id !== excludeId).slice(0, 4);
    for (const ev of others) {
        const imgPath = (ev.imageUrl || ev.image || '').replace(/^\//, '');
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'text-left rounded-xl border border-slate-200 overflow-hidden bg-white hover:shadow-md transition flex flex-col';
        card.innerHTML = `
            <div class="aspect-square w-full bg-slate-100 overflow-hidden">
                <img src="${imgPath}" alt="${ev.title}" class="w-full h-full object-cover">
            </div>
            <div class="p-2.5 space-y-1">
                <div class="text-[10px] font-extrabold text-[#D81A21] uppercase truncate">${ev.formattedDate || ev.startAtLabel || ''}</div>
                <div class="text-xs font-extrabold text-slate-900 line-clamp-1">${ev.title}</div>
                <div class="text-[11px] font-bold text-slate-600">KES ${Number(ev.startingPrice || 1000).toLocaleString()}</div>
            </div>
        `;
        card.addEventListener('click', () => openTicketsasaEventModal(ev.id));
        grid.append(card);
    }
}

async function handleTicketsasaDetailCheckout(event) {
    event.preventDefault();
    if (!activeTicketsasaDetailEvent) return;
    const ev = activeTicketsasaDetailEvent;
    const eventTiers = ev.tiers || [];
    const hasSelected = eventTiers.some(t => (state.quantities[t.tierKey] || 0) > 0);
    const firstAvailable = eventTiers.find(tier => tier.remainingAllocation > 0);
    if (!hasSelected && firstAvailable) {
        updateQty(firstAvailable.tierKey, 1);
        renderTicketsasaDetailTiers(eventTiers);
    }
    const nameVal = document.getElementById('ts-cust-name')?.value.trim() || '';
    const emailVal = document.getElementById('ts-cust-email')?.value.trim() || '';
    const phoneVal = document.getElementById('ts-cust-phone')?.value.trim() || '';
    const statusEl = document.getElementById('ts-checkout-status');
    const bookBtn = document.getElementById('ts-btn-book-now');

    const selectedItems = eventTiers
        .filter(t => (state.quantities[t.tierKey] || 0) > 0)
        .map(t => ({
            tierKey: t.tierKey,
            quantity: state.quantities[t.tierKey],
            title: t.title,
            eventTitle: ev.title,
            unitPriceKes: Math.max(1, Number(t.priceKes || ev.startingPrice || 1000))
        }));

    if (!selectedItems.length) {
        if (statusEl) statusEl.textContent = 'Please select at least 1 ticket above.';
        return;
    }

    if (bookBtn) bookBtn.disabled = true;
    if (statusEl) statusEl.textContent = `Creating order & sending M-Pesa STK Push to ${phoneVal}...`;

    try {
        const payload = {
            customer: { name: nameVal, email: emailVal, phone: phoneVal },
            items: selectedItems, currency: 'KES', paymentMethod: 'MPESA'
        };
        const fingerprint = JSON.stringify(payload);
        if (pendingDetailOrder?.fingerprint !== fingerprint) {
            const orderRes = await commerceRequest('/orders', payload);
            pendingDetailOrder = { fingerprint, orderReference: orderRes.data.orderReference };
        }
        const { orderReference } = pendingDetailOrder;
        document.getElementById('wallet-reference').value = orderReference;
        document.getElementById('wallet-email').value = emailVal;

        if (statusEl) statusEl.textContent = `Initiating M-Pesa prompt on ${phoneVal} (Order ${orderReference})...`;
        const payment = await commerceRequest('/payments/mpesa/stkpush', {
            orderReference,
            phone: phoneVal
        });

        if (payment.mode === 'demo') {
            const conf = await commerceRequest('/payments/demo/confirm', {
                orderReference,
                checkoutRequestId: payment.CheckoutRequestID
            });
            for (const t of eventTiers) state.quantities[t.tierKey] = 0;
            updateCartDisplay();
            pendingDetailOrder = undefined;
            rememberOrder(conf.data, conf.passes);
            closeTicketsasaEventModal();
            openTicketWallet();
            return;
        }

        if (statusEl) {
            statusEl.textContent = payment.CustomerMessage || `Approve the M-Pesa prompt sent to ${phoneVal}. Order: ${orderReference}`;
        }
        if (typeof showToast === 'function') {
            showToast(payment.CustomerMessage || `M-Pesa STK prompt sent to ${phoneVal}!`);
        }

        for (let attempt = 0; attempt < 15; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 3500));
            const check = await commerceRequest('/payments/status/' + encodeURIComponent(orderReference) + '?email=' + encodeURIComponent(emailVal)).catch(() => null);
            if (check?.status === 'COMPLETED') {
                for (const t of eventTiers) state.quantities[t.tierKey] = 0;
                updateCartDisplay();
                pendingDetailOrder = undefined;
                rememberOrder(check.order, check.passes);
                closeTicketsasaEventModal();
                openTicketWallet();
                return;
            }
            if (check?.status === 'FAILED') {
                pendingDetailOrder = undefined;
                throw new Error(check.reason || 'Payment was declined or cancelled on your mobile phone.');
            }
            if (statusEl) {
                statusEl.textContent = `Awaiting M-Pesa confirmation (${attempt + 1}/15)... Order: ${orderReference}`;
            }
        }
        if (statusEl) statusEl.textContent = 'Payment still pending. Check My tickets with order ' + orderReference + '.';
    } catch (err) {
        if ([409, 410, 422].includes(err.status)) pendingDetailOrder = undefined;
        if (statusEl) statusEl.textContent = err.message || 'Could not start M-Pesa payment. Please check your phone number and try again.';
    } finally {
        if (bookBtn) bookBtn.disabled = false;
    }
}

function openTicketsasaAuthModal(mode = 'login') {
    const modal = document.getElementById('ticketsasa-auth-modal');
    const title = document.getElementById('ts-auth-title');
    if (!modal || !title) return;
    const titles = {
        login: 'Log In to Ticketsasa',
        sell: 'Sell Your Event on Ticketsasa',
        terms: 'Ticketsasa Terms & Conditions',
        privacy: 'Ticketsasa Privacy Policy'
    };
    modal.dataset.mode = mode;
    void refreshAccountProviders();
    title.textContent = signedInAccount && mode === 'login' ? 'My account' : (titles[mode] || 'Ticketsasa Account');
    const form = modal.querySelector('[data-auth-form]');
    if (!accountRequestInProgress) setAccountMode(form, mode === 'register' ? 'register' : 'login');
    modal.classList.remove('hidden');
}

function closeTicketsasaAuthModal() {
    const modal = document.getElementById('ticketsasa-auth-modal');
    if (modal) modal.classList.add('hidden');
}

document.addEventListener('keydown', event => {
    const dialog = Array.from(document.querySelectorAll('[role="dialog"]:not(.hidden)')).at(-1);
    if (event.key === 'Escape') {
        if (dialog?.id === 'ticketsasa-event-modal') closeTicketsasaEventModal();
        else if (dialog?.id === 'ticketsasa-auth-modal') closeTicketsasaAuthModal();
        else if (dialog?.id === 'checkout-modal') closeCheckoutModal();
        else if (dialog?.id === 'ticket-wallet') closeTicketWallet();
        else if (!document.getElementById('chat-support-modal').classList.contains('hidden')) toggleChatSupport();
    }
    if (event.key !== 'Tab' || !dialog) return;
    const focusable = Array.from(dialog.querySelectorAll('button, input, select, textarea, a[href]'))
        .filter(element => !element.disabled && element.getClientRects().length);
    const edge = event.shiftKey ? focusable.at(-1) : focusable[0];
    const opposite = event.shiftKey ? focusable[0] : focusable.at(-1);
    if (edge && (document.activeElement === opposite || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        edge.focus();
    }
});
