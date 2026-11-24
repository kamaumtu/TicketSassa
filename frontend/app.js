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
    void syncHolidayItinerariesFromServer();
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
    } else if (tabName === 'checkticket') {
        void loadMyTripsDashboard();
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
    if (opening) void window.ticketSupport?.refreshStatus();
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
    let mode = 'unavailable';
    try {
        const modeRes = await commerceRequest('/payments/mode');
        mode = modeRes?.mode || 'unavailable';
    } catch (err) {
        checkoutSubmitting = false;
        status.textContent = err?.message || 'Could not reach the checkout server. Make sure the backend is running on http://localhost:8000.';
        button.disabled = false;
        return;
    }
    if (mode === 'unavailable') {
        checkoutSubmitting = false;
        status.textContent = 'Online checkout is currently unavailable (database or payment gateway is reconnecting). Please try again in a moment.';
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
                : 'Waiting for M-Pesa to confirm the request.') + ' Order ' + orderReference + '.';
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

    const itBox = document.getElementById('pass-itinerary-box');
    if (itBox) {
        itBox.replaceChildren();
        if (pass.itinerary) {
            const lines = [
                `Resort: ${pass.itinerary.resortName || pass.eventTitle}`,
                `Destination: ${pass.itinerary.destination || 'Kenya'}`,
                `Stay Dates: ${pass.itinerary.checkin} to ${pass.itinerary.checkout} (${pass.itinerary.nights} Night${pass.itinerary.nights > 1 ? 's' : ''})`,
                `Room Category: ${pass.itinerary.roomType || 'Standard'}`,
                pass.itinerary.mealPlan ? `Meal Plan: ${pass.itinerary.mealPlan}` : '',
                Array.isArray(pass.itinerary.addons) && pass.itinerary.addons.length ? `Add-ons: ${pass.itinerary.addons.join(', ')}` : ''
            ].filter(Boolean);
            for (const line of lines) {
                const p = document.createElement('p');
                p.textContent = line;
                itBox.append(p);
            }
            itBox.classList.remove('hidden');
        } else {
            itBox.classList.add('hidden');
        }
    }

    const pdfLink = document.getElementById('btn-download-pass-pdf');
    if (pdfLink) {
        if (pass.status === 'VALID') {
            pdfLink.href = '/api/passes/' + encodeURIComponent(pass.qrCodeToken || pass.passReference) + '/pdf';
            pdfLink.classList.remove('hidden');
        } else {
            pdfLink.removeAttribute('href');
            pdfLink.classList.add('hidden');
        }
    }

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

let pendingFlightOrder = null;
let activeFlightPromo = null;

function syncFlightModalTripType() {
    const tripEl = document.getElementById('fbm-trip-type');
    const wrap = document.getElementById('fbm-return-wrap');
    const retInput = document.getElementById('fbm-return-date');
    const depVal = document.getElementById('fbm-depart-date')?.value || '';
    const isRound = tripEl?.value === 'round';
    if (wrap) wrap.classList.toggle('hidden', !isRound);
    if (retInput) {
        retInput.required = isRound;
        if (isRound && depVal && (!retInput.value || retInput.value < depVal)) {
            const d = new Date(depVal + 'T00:00:00Z');
            d.setUTCDate(d.getUTCDate() + 3);
            retInput.min = depVal;
            retInput.value = d.toISOString().split('T')[0];
        }
    }
    syncFlightModalDate();
}

async function applyFlightPromoCode() {
    const input = document.getElementById('fbm-promo-code');
    const msgEl = document.getElementById('fbm-promo-msg');
    const code = input?.value?.trim().toUpperCase() || '';
    if (!code) {
        activeFlightPromo = null;
        if (msgEl) msgEl.textContent = '';
        calculateFlightTotal();
        return;
    }
    try {
        const res = await commerceRequest(`/travel/promos/validate?code=${encodeURIComponent(code)}&kind=flight`);
        activeFlightPromo = res.promo;
        if (msgEl) {
            msgEl.className = 'text-[11px] font-semibold text-emerald-700';
            msgEl.textContent = `✓ ${res.promo.code}: ${res.promo.discountPercent}% off (${res.promo.label})`;
        }
    } catch (err) {
        activeFlightPromo = null;
        if (msgEl) {
            msgEl.className = 'text-[11px] font-semibold text-rose-600';
            msgEl.textContent = err.message || 'Promo code not valid for flights.';
        }
    }
    calculateFlightTotal();
}

function formatFlightModalClock(value) {
    if (!value) return 'Flex';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return 'Flex';
    return new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'Africa/Nairobi'
    }).format(d);
}

function syncFlightModalDate() {
    const depVal = document.getElementById('fbm-depart-date')?.value || '';
    const retVal = document.getElementById('fbm-return-date')?.value || '';
    const isRound = document.getElementById('fbm-trip-type')?.value === 'round';
    const travelDateEl = document.getElementById('fbm-travel-date');
    if (travelDateEl) {
        travelDateEl.textContent = depVal
            ? (isRound && retVal ? `Outbound: ${depVal} · Return: ${retVal}` : `Departure: ${depVal}`)
            : 'Departure: Select date';
    }
}

window.openCustomFlightBookingModal = function (fl) {
    if (!fl || (!fl._id && !fl.externalId)) return;
    const priceKes = Math.max(1, Math.round(Number(fl.priceKes) || 8500));
    const depDateIso = fl.departureTime && !Number.isNaN(Date.parse(fl.departureTime))
        ? new Date(fl.departureTime).toISOString().split('T')[0]
        : '';
    const customFlight = {
        id: 'db:' + String(fl._id || fl.externalId),
        airline: fl.airline || 'Partner Airline',
        logo: fl.airlineLogo || '/assets/airlines/kenya-airways.svg',
        flightNumber: fl.flightNumber || `${fl.originCode || 'NBO'}-${fl.destinationCode || 'MBA'}`,
        aircraft: fl.source || 'Scheduled Flight',
        origin: fl.originCode || 'NBO',
        originCity: fl.originName || fl.originCode || 'Nairobi',
        dest: fl.destinationCode || 'MBA',
        destCity: fl.destinationName || fl.destinationCode || 'Mombasa',
        depTime: formatFlightModalClock(fl.departureTime),
        arrTime: formatFlightModalClock(fl.arrivalTime),
        durationText: fl.duration || 'Scheduled',
        baggage: fl.baggageAllowance || 'Standard Airline Baggage',
        priceKes,
        priceUsd: Math.round(priceKes / 130),
        defaultDepartDate: depDateIso
    };
    openFlightBookingModal(customFlight);
};

function openFlightBookingModal(flightOrId) {
    const flight = (flightOrId && typeof flightOrId === 'object')
        ? flightOrId
        : (flightsDb.find(f => f.id === flightOrId) || flightsDb[0]);
    flightSearchState.selectedFlight = flight;
    pendingFlightOrder = null;

    // Populate modal summary
    const logoEl = document.getElementById('fbm-airline-logo');
    if (logoEl) logoEl.src = flight.logo || '/assets/airlines/kenya-airways.svg';

    const nameEl = document.getElementById('fbm-airline-name');
    if (nameEl) nameEl.textContent = flight.airline;

    const fnEl = document.getElementById('fbm-flight-number');
    if (fnEl) fnEl.textContent = `${flight.flightNumber} · ${flight.aircraft || 'Scheduled'}`;

    const depTimeEl = document.getElementById('fbm-dep-time');
    if (depTimeEl) depTimeEl.textContent = flight.depTime || 'Flex';

    const depCodeEl = document.getElementById('fbm-dep-code');
    if (depCodeEl) depCodeEl.textContent = flight.origin;

    const depCityEl = document.getElementById('fbm-dep-city');
    if (depCityEl) depCityEl.textContent = flight.originCity || flight.origin;

    const arrTimeEl = document.getElementById('fbm-arr-time');
    if (arrTimeEl) arrTimeEl.textContent = flight.arrTime || 'Flex';

    const arrCodeEl = document.getElementById('fbm-arr-code');
    if (arrCodeEl) arrCodeEl.textContent = flight.dest;

    const arrCityEl = document.getElementById('fbm-arr-city');
    if (arrCityEl) arrCityEl.textContent = flight.destCity || flight.dest;

    const durEl = document.getElementById('fbm-duration');
    if (durEl) durEl.textContent = flight.durationText || 'Direct';

    const bagEl = document.getElementById('fbm-baggage-note');
    if (bagEl) bagEl.textContent = flight.baggage || 'Standard Airline Baggage';

    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const fmt = d => d.toISOString().split('T')[0];
    const todayIso = fmt(today);
    const fallbackDate = flight.defaultDepartDate && flight.defaultDepartDate >= todayIso
        ? flight.defaultDepartDate
        : (document.getElementById('flight-depart-date')?.value || fmt(tomorrow));

    const modalDateEl = document.getElementById('fbm-depart-date');
    if (modalDateEl) {
        modalDateEl.min = todayIso;
        modalDateEl.value = fallbackDate >= todayIso ? fallbackDate : fmt(tomorrow);
    }
    syncFlightModalDate();

    if (signedInAccount) {
        const emailEl = document.getElementById('fbm-email');
        if (emailEl && !emailEl.value) emailEl.value = signedInAccount.email || '';
        const parts = String(signedInAccount.name || '').trim().split(/\s+/);
        const firstEl = document.getElementById('fbm-first-name');
        const lastEl = document.getElementById('fbm-last-name');
        if (firstEl && !firstEl.value && parts[0]) firstEl.value = parts[0];
        if (lastEl && !lastEl.value && parts.length > 1) lastEl.value = parts.slice(1).join(' ');
    }

    const statusEl = document.getElementById('fbm-status');
    if (statusEl) statusEl.textContent = '';

    activeFlightPromo = null;
    const promoInput = document.getElementById('fbm-promo-code');
    if (promoInput) promoInput.value = '';
    const promoMsg = document.getElementById('fbm-promo-msg');
    if (promoMsg) promoMsg.textContent = '';
    const tripEl = document.getElementById('fbm-trip-type');
    if (tripEl) tripEl.value = flightSearchState.tripType === 'round' ? 'round' : 'oneway';
    syncFlightModalTripType();

    const submitBtn = document.getElementById('btn-fbm-submit');
    if (submitBtn) submitBtn.disabled = false;

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
    const tripType = document.getElementById('fbm-trip-type')?.value === 'round' ? 'round' : 'oneway';
    const adults = Math.max(1, Number(document.getElementById('fbm-adults')?.value || 1));
    const children = Math.max(0, Number(document.getElementById('fbm-children')?.value || 0));
    const infants = Math.max(0, Math.min(adults, Number(document.getElementById('fbm-infants')?.value || 0)));
    const seatedPassengers = adults + children;

    const multiplier = tripType === 'round' ? 1.95 : 1;
    const adultUnit = Math.round(flight.priceKes * multiplier);
    const childUnit = Math.round(adultUnit * 0.75);
    const infantUnit = Math.round(adultUnit * 0.15);
    const baseFare = Math.round(adultUnit * adults + childUnit * children + infantUnit * infants);
    const tax = Math.round(baseFare * 0.05);

    let addons = 0;
    const insEl = document.getElementById('fbm-addon-insurance');
    if (insEl && insEl.checked) addons += 750 * seatedPassengers;

    const bagEl = document.getElementById('fbm-addon-baggage');
    if (bagEl && bagEl.checked) addons += 2000 * seatedPassengers;

    const seatEl = document.getElementById('fbm-seat-pref');
    if (seatEl && seatEl.value === 'extra-leg') addons += 1200 * seatedPassengers;

    const subtotal = baseFare + tax + addons;
    const discountKes = activeFlightPromo ? Math.round(subtotal * (activeFlightPromo.discountPercent / 100)) : 0;
    const totalKes = Math.max(1, subtotal - discountKes);
    const totalUsd = Math.round(totalKes / 130);

    const baseEl = document.getElementById('fbm-summary-base');
    if (baseEl) baseEl.textContent = isKes ? `KES ${baseFare.toLocaleString()}` : `$${Math.round(baseFare / 130)}`;

    const taxEl = document.getElementById('fbm-summary-tax');
    if (taxEl) taxEl.textContent = isKes ? `KES ${tax.toLocaleString()}` : `$${Math.round(tax / 130)}`;

    const addonsEl = document.getElementById('fbm-summary-addons');
    if (addonsEl) addonsEl.textContent = isKes ? `KES ${addons.toLocaleString()}` : `$${Math.round(addons / 130)}`;

    const discRow = document.getElementById('fbm-summary-discount-row');
    const discVal = document.getElementById('fbm-summary-discount');
    const discLbl = document.getElementById('fbm-summary-discount-label');
    if (discRow) discRow.classList.toggle('hidden', !(discountKes > 0));
    if (discVal) discVal.textContent = `-KES ${discountKes.toLocaleString()}`;
    if (discLbl && activeFlightPromo) discLbl.textContent = `Promo (${activeFlightPromo.code} · ${activeFlightPromo.discountPercent}%):`;

    const totalEl = document.getElementById('fbm-summary-total');
    if (totalEl) totalEl.textContent = isKes ? `KES ${totalKes.toLocaleString()}` : `$${totalUsd} (KES ${totalKes.toLocaleString()})`;

    const payMethod = document.getElementById('fbm-pay-method')?.value || 'MPESA';
    const payLabel = payMethod === 'CARD' ? 'BY CARD (VISA/MC)' : 'VIA M-PESA';
    const btnLabel = document.getElementById('btn-fbm-label');
    if (btnLabel) {
        btnLabel.textContent = isKes ? `PAY KES ${totalKes.toLocaleString()} ${payLabel}` : `PAY $${totalUsd} ${payLabel}`;
    }

    return { totalKes, totalUsd, adults, children, infants, tripType };
}

async function handleFlightBookingSubmit(event) {
    event.preventDefault();
    const flight = flightSearchState.selectedFlight;
    if (!flight) return;

    const titlePrefix = document.getElementById('fbm-title-select')?.value?.trim() || '';
    const firstName = document.getElementById('fbm-first-name')?.value?.trim() || '';
    const lastName = document.getElementById('fbm-last-name')?.value?.trim() || '';
    const fullName = [titlePrefix, firstName, lastName].filter(Boolean).join(' ').trim();
    const passport = document.getElementById('fbm-passport')?.value?.trim() || '';
    const email = document.getElementById('fbm-email')?.value?.trim() || '';
    const phone = document.getElementById('fbm-phone')?.value?.trim() || '';
    const tripType = document.getElementById('fbm-trip-type')?.value === 'round' ? 'round' : 'oneway';
    const departureDate = document.getElementById('fbm-depart-date')?.value
        || document.getElementById('flight-depart-date')?.value
        || '';
    const returnDate = tripType === 'round'
        ? (document.getElementById('fbm-return-date')?.value || '')
        : '';
    const adults = Math.max(1, Number(document.getElementById('fbm-adults')?.value || 1));
    const children = Math.max(0, Number(document.getElementById('fbm-children')?.value || 0));
    const infants = Math.max(0, Number(document.getElementById('fbm-infants')?.value || 0));
    const seatPref = document.getElementById('fbm-seat-pref')?.value || 'window';
    const payMethod = document.getElementById('fbm-pay-method')?.value || 'MPESA';
    const addons = [];
    if (document.getElementById('fbm-addon-insurance')?.checked) addons.push('insurance');
    if (document.getElementById('fbm-addon-baggage')?.checked) addons.push('baggage');

    const statusEl = document.getElementById('fbm-status');
    const submitBtn = document.getElementById('btn-fbm-submit');

    if (!departureDate) {
        if (statusEl) statusEl.textContent = 'Please select a departure date.';
        return;
    }

    const payload = {
        flightKey: flight.id,
        departureDate,
        returnDate,
        tripType,
        cabinClass: flightSearchState.cabinClass || 'economy',
        adults,
        children,
        infants,
        seatPref,
        addons,
        promoCode: activeFlightPromo?.code || '',
        passenger: { passport },
        customer: { name: fullName, email, phone }
    };
    const fingerprint = JSON.stringify(payload);

    if (submitBtn) submitBtn.disabled = true;
    if (statusEl) statusEl.textContent = 'Reserving flight seat & verifying fare...';

    try {
        if (!pendingFlightOrder || pendingFlightOrder.fingerprint !== fingerprint) {
            const requestId = (typeof crypto?.randomUUID === 'function')
                ? crypto.randomUUID()
                : ('flt-' + Date.now() + '-' + Math.random().toString(16).slice(2, 14));
            const booked = await commerceRequest('/travel/flights/book', { ...payload, requestId });
            pendingFlightOrder = {
                fingerprint,
                requestId,
                orderReference: booked.orderReference,
                totalKes: booked.totalKes
            };
        }

        const { orderReference, totalKes } = pendingFlightOrder;
        const walletRef = document.getElementById('wallet-reference');
        const walletEmail = document.getElementById('wallet-email');
        if (walletRef) walletRef.value = orderReference;
        if (walletEmail) walletEmail.value = email;

        saveTravelPlan('flight', 'fbm-status', {
            orderReference,
            airline: flight.airline,
            flightNo: flight.flightNumber || flight.flightNo,
            origin: flight.origin,
            destination: flight.dest,
            departure: departureDate,
            returnDate,
            cabin: flightSearchState.cabinClass,
            passenger: fullName,
            passport,
            email,
            phone,
            totalKes: `KES ${Number(totalKes || 0).toLocaleString()}`
        });

        if (payMethod === 'CARD') {
            if (statusEl) statusEl.textContent = `Initializing secure card checkout for KES ${Number(totalKes || 0).toLocaleString()}...`;
            const cardInit = await commerceRequest('/payments/card/initiate', { orderReference });
            if (cardInit.authorizationUrl) {
                window.location.href = cardInit.authorizationUrl;
                return;
            }
            const verified = await commerceRequest('/payments/card/verify', { orderReference, reference: cardInit.reference });
            pendingFlightOrder = null;
            rememberOrder(verified.data, verified.passes || []);
            closeFlightBookingModal();
            openTicketWallet();
            if (verified.passes?.[0]) openDigitalPass(verified.passes[0]);
            if (typeof showToast === 'function') showToast('Card payment confirmed! Your flight e-ticket is ready.');
            return;
        }

        if (statusEl) statusEl.textContent = `Sending M-Pesa STK Push for KES ${Number(totalKes || 0).toLocaleString()} (Order ${orderReference})...`;
        const payment = await commerceRequest('/payments/mpesa/stkpush', {
            orderReference,
            phone
        });

        if (payment.mode === 'demo') {
            const conf = await commerceRequest('/payments/demo/confirm', {
                orderReference,
                checkoutRequestId: payment.CheckoutRequestID
            });
            pendingFlightOrder = null;
            rememberOrder(conf.data, conf.passes || []);
            closeFlightBookingModal();
            openTicketWallet();
            if (conf.passes?.[0]) openDigitalPass(conf.passes[0]);
            if (typeof showToast === 'function') {
                showToast('Flight booking confirmed! Your digital e-ticket is ready.');
            }
            return;
        }

        if (statusEl) {
            statusEl.textContent = `${payment.CustomerMessage || 'Approve the M-Pesa prompt on your phone.'} Order ${orderReference}.`;
        }
        if (typeof showToast === 'function') {
            showToast(payment.CustomerMessage || `M-Pesa STK Push sent for Flight Order ${orderReference}!`);
        }

        for (let attempt = 0; attempt < 20; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 3500));
            const check = await commerceRequest('/payments/status/' + encodeURIComponent(orderReference) + '?email=' + encodeURIComponent(email)).catch(() => null);
            if (check?.status === 'COMPLETED') {
                pendingFlightOrder = null;
                rememberOrder(check.order, check.passes || []);
                closeFlightBookingModal();
                openTicketWallet();
                if (check.passes?.[0]) openDigitalPass(check.passes[0]);
                if (typeof showToast === 'function') {
                    showToast('Flight booking confirmed! Your digital boarding pass & PDF e-ticket are ready.');
                }
                return;
            }
            if (check?.status === 'FAILED') {
                pendingFlightOrder = null;
                throw new Error(check.reason || 'M-Pesa payment was cancelled or declined.');
            }
            if (statusEl) {
                statusEl.textContent = `Awaiting M-Pesa confirmation (${attempt + 1}/20)... Order: ${orderReference}`;
            }
        }
        if (statusEl) {
            statusEl.textContent = `Payment confirmation still pending. Check your ticket wallet with Order ${orderReference} once complete.`;
        }
    } catch (err) {
        if ([400, 404, 409, 410, 422].includes(err.status)) {
            pendingFlightOrder = null;
        }
        if (statusEl) {
            statusEl.textContent = err.message || 'Could not start flight checkout. Please try again.';
        }
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
let pendingHolidayOrder = null;

function resolvePkgDefaultNights(pkg) {
    if (Number.isSafeInteger(pkg?.nights) && pkg.nights > 0) return pkg.nights;
    const dur = String(pkg?.duration || '');
    if (dur.includes('5D')) return 4;
    if (dur.includes('4D')) return 3;
    if (dur.includes('2D')) return 1;
    return 2;
}

async function syncHolidayItinerariesFromServer() {
    try {
        const res = await commerceRequest('/travel/itineraries');
        if (Array.isArray(res?.itineraries)) {
            for (const item of res.itineraries) {
                if (item?.key) holidayDb[item.key] = item;
            }
        }
    } catch {}
    try {
        const catalog = await commerceRequest('/automation/public/catalog?limit=60');
        if (Array.isArray(catalog?.flights)) {
            const existingIds = new Set(flightsDb.map(f => f.id));
            const selects = ['flight-origin', 'flight-destination', 'hero-flight-origin', 'hero-flight-dest']
                .map(id => document.getElementById(id))
                .filter(Boolean);
            for (const fl of catalog.flights) {
                const id = 'db:' + String(fl._id || fl.externalId);
                if (existingIds.has(id)) continue;
                existingIds.add(id);
                const priceKes = Math.max(1, Math.round(Number(fl.priceKes) || 8500));
                const origin = String(fl.originCode || 'NBO').toUpperCase();
                const dest = String(fl.destinationCode || 'MBA').toUpperCase();
                flightsDb.push({
                    id,
                    airline: fl.airline || 'Partner Airline',
                    logo: fl.airlineLogo || 'assets/airlines/kenya-airways.svg',
                    flightNumber: fl.flightNumber || `${origin}-${dest}`,
                    aircraft: fl.source || 'Scheduled Flight',
                    origin,
                    originCity: fl.originName || origin,
                    dest,
                    destCity: fl.destinationName || dest,
                    depTime: formatFlightModalClock(fl.departureTime) === 'Flex' ? '09:00' : formatFlightModalClock(fl.departureTime),
                    arrTime: formatFlightModalClock(fl.arrivalTime) === 'Flex' ? '10:15' : formatFlightModalClock(fl.arrivalTime),
                    durationMinutes: 75,
                    durationText: fl.duration || '1h 15m',
                    stops: 'Direct / Scheduled',
                    baggage: fl.baggageAllowance || '✓ 23kg Checked + 7kg Cabin',
                    amenities: 'Online E-Ticket & Instant Confirmation',
                    priceKes,
                    priceUsd: Math.max(1, Math.round(priceKes / 130)),
                    seatsLeft: 9
                });
                for (const [code, label] of [[origin, fl.originName || origin], [dest, fl.destinationName || dest]]) {
                    for (const sel of selects) {
                        if (![...sel.options].some(o => o.value === code)) {
                            const opt = document.createElement('option');
                            opt.value = code;
                            opt.textContent = `${label} (${code})`;
                            sel.append(opt);
                        }
                    }
                }
            }
            executeFlightSearch(false);
        }
        if (Array.isArray(catalog?.holidays)) {
            for (const hl of catalog.holidays) {
                const key = 'db:' + String(hl._id || hl.externalId);
                const nights = Math.max(1, Number(hl.nights) || 2);
                const rateKes = Math.max(1, Math.round(Number(hl.priceKes || hl.pricePerPerson) || 18500));
                holidayDb[key] = {
                    key,
                    title: hl.title,
                    resortName: hl.accommodation || hl.title,
                    destination: hl.destination || 'Kenya',
                    duration: hl.duration || `${nights + 1}D / ${nights}N`,
                    nights,
                    image: hl.images?.[0]?.url || '/assets/holidays/beach-holidays.jpg',
                    rate: rateKes,
                    originalRate: null,
                    discount: '',
                    mealPlan: hl.meals || 'Half Board Dining Included',
                    inclusions: Array.isArray(hl.activities) && hl.activities.length
                        ? hl.activities
                        : [hl.description || hl.title],
                    roomTypes: [
                        { name: 'Standard Sharing Room', surcharge: 0 },
                        { name: 'Deluxe Upgrade Suite', surcharge: 5000 }
                    ]
                };
            }
        }
    } catch {}
}

window.openCustomHolidayBookingModal = function (hl) {
    if (!hl || (!hl._id && !hl.externalId)) return;
    const key = 'db:' + String(hl._id || hl.externalId);
    const nights = Math.max(1, Number(hl.nights) || 2);
    const rateKes = Math.max(1, Math.round(Number(hl.priceKes || hl.pricePerPerson) || 18500));
    holidayDb[key] = {
        key,
        title: hl.title,
        resortName: hl.accommodation || hl.title,
        destination: hl.destination || 'Kenya',
        duration: hl.duration || `${nights + 1}D / ${nights}N`,
        nights,
        image: hl.images?.[0]?.url || '/assets/holidays/beach-holidays.jpg',
        rate: rateKes,
        originalRate: null,
        discount: '',
        mealPlan: hl.meals || 'Half Board Dining Included',
        inclusions: Array.isArray(hl.activities) && hl.activities.length
            ? hl.activities
            : [hl.description || hl.title],
        roomTypes: [
            { name: 'Standard Sharing Room', surcharge: 0 },
            { name: 'Deluxe Upgrade Suite', surcharge: 5000 }
        ]
    };
    openHolidayBookingModal(key);
};

let activeHolidayPromo = null;
let currentHolidayBundleFlight = { label: 'Nairobi ⇄ Destination', returnFareKes: 14000, airline: 'Partner Airline' };

async function applyHolidayPromoCode() {
    const input = document.getElementById('hbm-promo-code');
    const msgEl = document.getElementById('hbm-promo-msg');
    const code = input?.value?.trim().toUpperCase() || '';
    if (!code) {
        activeHolidayPromo = null;
        if (msgEl) msgEl.textContent = '';
        calculateHolidayTotal();
        return;
    }
    const isBundle = Boolean(document.getElementById('hbm-addon-flight')?.checked);
    const kind = isBundle ? 'bundle' : 'holiday';
    try {
        let res;
        try {
            res = await commerceRequest(`/travel/promos/validate?code=${encodeURIComponent(code)}&kind=${kind}`);
        } catch (err) {
            if (isBundle) {
                res = await commerceRequest(`/travel/promos/validate?code=${encodeURIComponent(code)}&kind=holiday`);
            } else {
                throw err;
            }
        }
        activeHolidayPromo = res.promo;
        if (msgEl) {
            msgEl.className = 'text-[11px] font-semibold text-emerald-700';
            msgEl.textContent = `✓ ${res.promo.code}: ${res.promo.discountPercent}% off (${res.promo.label})`;
        }
    } catch (err) {
        activeHolidayPromo = null;
        if (msgEl) {
            msgEl.className = 'text-[11px] font-semibold text-rose-600';
            msgEl.textContent = err.message || 'Promo code not valid for this holiday.';
        }
    }
    calculateHolidayTotal();
}

function openHolidayBookingModal(packageKey) {
    const pkg = holidayDb[packageKey] || holidayDb['neptune-village'];
    currentHolidayBooking = pkg;
    pendingHolidayOrder = null;
    activeHolidayPromo = null;

    const promoInput = document.getElementById('hbm-promo-code');
    if (promoInput) promoInput.value = '';
    const promoMsg = document.getElementById('hbm-promo-msg');
    if (promoMsg) promoMsg.textContent = '';
    const flEl = document.getElementById('hbm-addon-flight');
    if (flEl) flEl.checked = false;

    void commerceRequest(`/travel/bundle-flight?destination=${encodeURIComponent(pkg.destination || '')}&title=${encodeURIComponent(pkg.title || '')}`)
        .then(res => {
            if (res?.flight) {
                currentHolidayBundleFlight = res.flight;
                const lbl = document.getElementById('hbm-flight-bundle-label');
                const prc = document.getElementById('hbm-flight-bundle-price');
                if (lbl) lbl.textContent = res.flight.label;
                if (prc) prc.textContent = `KES ${Number(res.flight.returnFareKes).toLocaleString()} pp`;
                calculateHolidayTotal();
            }
        })
        .catch(() => {});

    const imgEl = document.getElementById('hbm-image');
    if (imgEl) imgEl.src = pkg.image;

    const durEl = document.getElementById('hbm-duration-badge');
    if (durEl) durEl.textContent = pkg.duration;

    const destEl = document.getElementById('hbm-dest-text');
    if (destEl) destEl.textContent = pkg.destination;

    const nameEl = document.getElementById('hbm-package-name');
    if (nameEl) nameEl.textContent = pkg.title;

    const incEl = document.getElementById('hbm-inclusions-text');
    if (incEl) incEl.textContent = `Includes ${pkg.mealPlan}. ${pkg.inclusions?.[0] || ''}`;

    const isKes = state.currency === 'KES';
    const rateEl = document.getElementById('hbm-base-rate');
    if (rateEl) {
        rateEl.textContent = isKes ? `KES ${pkg.rate.toLocaleString()} / Sharing` : `$${Math.round(pkg.rate / 125)} / Sharing`;
    }

    const roomSelect = document.getElementById('hbm-room-type');
    if (roomSelect) {
        const rooms = Array.isArray(pkg.roomTypes) && pkg.roomTypes.length
            ? pkg.roomTypes
            : [{ name: 'Standard Sharing Room', surcharge: 0 }];
        roomSelect.replaceChildren();
        rooms.forEach((rt, idx) => {
            const opt = document.createElement('option');
            opt.value = String(idx);
            opt.textContent = rt.surcharge > 0
                ? `${rt.name} (+KES ${Number(rt.surcharge).toLocaleString()} / night)`
                : `${rt.name} (Included in package)`;
            roomSelect.append(opt);
        });
    }

    const sgrEl = document.getElementById('hbm-addon-sgr');
    if (sgrEl) sgrEl.checked = false;
    const excEl = document.getElementById('hbm-addon-excursion');
    if (excEl) excEl.checked = false;

    if (signedInAccount) {
        const gName = document.getElementById('hbm-guest-name');
        const gEmail = document.getElementById('hbm-guest-email');
        if (gName && !gName.value) gName.value = signedInAccount.name || '';
        if (gEmail && !gEmail.value) gEmail.value = signedInAccount.email || '';
    }

    // Set default dates
    const defaultNights = resolvePkgDefaultNights(pkg);
    const checkin = document.getElementById('hbm-checkin-date');
    const checkout = document.getElementById('hbm-checkout-date');
    const today = new Date();
    const d1 = new Date(today);
    d1.setDate(d1.getDate() + 3);
    const d2 = new Date(d1);
    d2.setDate(d2.getDate() + defaultNights);

    const fmt = d => d.toISOString().split('T')[0];
    if (checkin) {
        checkin.min = fmt(today);
        checkin.value = fmt(d1);
    }
    if (checkout) {
        const minOut = new Date(d1);
        minOut.setDate(minOut.getDate() + 1);
        checkout.min = fmt(minOut);
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
                <strong>Confirmation Policy:</strong> Instant verified holiday voucher, QR check-in passes, and downloadable PDF receipt upon M-Pesa confirmation.
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

    const defaultNights = resolvePkgDefaultNights(pkg);
    const checkinEl = document.getElementById('hbm-checkin-date');
    const checkoutEl = document.getElementById('hbm-checkout-date');

    let selectedNights = defaultNights;
    if (checkinEl?.value) {
        const inMs = Date.parse(checkinEl.value + 'T00:00:00Z');
        if (Number.isFinite(inMs)) {
            const minOut = new Date(inMs + 86400000).toISOString().split('T')[0];
            if (checkoutEl) checkoutEl.min = minOut;
            if (checkoutEl && (!checkoutEl.value || checkoutEl.value <= checkinEl.value)) {
                checkoutEl.value = new Date(inMs + defaultNights * 86400000).toISOString().split('T')[0];
            }
            const outMs = checkoutEl?.value ? Date.parse(checkoutEl.value + 'T00:00:00Z') : NaN;
            if (Number.isFinite(outMs) && outMs > inMs) {
                selectedNights = Math.max(1, Math.min(30, Math.round((outMs - inMs) / 86400000)));
            }
        }
    }

    const isKes = state.currency === 'KES';
    const adultsEl = document.getElementById('hbm-adults-count');
    const adults = Math.max(1, Number(adultsEl ? adultsEl.value : 2) || 2);

    const roomEl = document.getElementById('hbm-room-type');
    const roomIdx = Math.max(0, Number(roomEl ? roomEl.value : 0) || 0);
    const roomObj = pkg.roomTypes?.[roomIdx] || { surcharge: 0 };
    const roomSurcharge = Math.round((Number(roomObj.surcharge) || 0) * selectedNights);

    let extras = 0;
    const sgrEl = document.getElementById('hbm-addon-sgr');
    if (sgrEl && sgrEl.checked) extras += 4500 * adults;

    const excEl = document.getElementById('hbm-addon-excursion');
    if (excEl && excEl.checked) extras += 6500 * adults;

    const bundleChecked = Boolean(document.getElementById('hbm-addon-flight')?.checked);
    const bundledFlightKes = bundleChecked
        ? Math.round((Number(currentHolidayBundleFlight?.returnFareKes) || 14000) * adults)
        : 0;

    const basePerAdult = selectedNights === defaultNights
        ? pkg.rate
        : Math.round((pkg.rate / defaultNights) * selectedNights);
    const baseCost = basePerAdult * adults;
    const tax = Math.round((baseCost + roomSurcharge) * 0.02);
    const subtotalBeforePromo = Math.round(baseCost + roomSurcharge + extras + bundledFlightKes + tax);
    const discountKes = activeHolidayPromo
        ? Math.round(subtotalBeforePromo * (activeHolidayPromo.discountPercent / 100))
        : 0;
    const totalKes = Math.max(1, subtotalBeforePromo - discountKes);
    const totalUsd = Math.round(totalKes / 125);

    const baseEl = document.getElementById('hbm-summary-base');
    if (baseEl) baseEl.textContent = isKes ? `KES ${baseCost.toLocaleString()}` : `$${Math.round(baseCost / 125)}`;

    const roomSumEl = document.getElementById('hbm-summary-room');
    if (roomSumEl) roomSumEl.textContent = isKes ? `KES ${roomSurcharge.toLocaleString()}` : `$${Math.round(roomSurcharge / 125)}`;

    const extrasEl = document.getElementById('hbm-summary-extras');
    if (extrasEl) extrasEl.textContent = isKes ? `KES ${extras.toLocaleString()}` : `$${Math.round(extras / 125)}`;

    const flRow = document.getElementById('hbm-summary-flight-row');
    const flSum = document.getElementById('hbm-summary-flight');
    if (flRow) flRow.classList.toggle('hidden', !(bundledFlightKes > 0));
    if (flSum) flSum.textContent = isKes ? `KES ${bundledFlightKes.toLocaleString()}` : `$${Math.round(bundledFlightKes / 125)}`;

    const taxEl = document.getElementById('hbm-summary-tax');
    if (taxEl) taxEl.textContent = isKes ? `KES ${tax.toLocaleString()}` : `$${Math.round(tax / 125)}`;

    const discRow = document.getElementById('hbm-summary-discount-row');
    const discVal = document.getElementById('hbm-summary-discount');
    const discLbl = document.getElementById('hbm-summary-discount-label');
    if (discRow) discRow.classList.toggle('hidden', !(discountKes > 0));
    if (discVal) discVal.textContent = `-KES ${discountKes.toLocaleString()}`;
    if (discLbl && activeHolidayPromo) discLbl.textContent = `Promo (${activeHolidayPromo.code} · ${activeHolidayPromo.discountPercent}%):`;

    const totalEl = document.getElementById('hbm-summary-total');
    if (totalEl) totalEl.textContent = isKes ? `KES ${totalKes.toLocaleString()}` : `$${totalUsd} (KES ${totalKes.toLocaleString()})`;

    const payMethod = document.getElementById('hbm-pay-method')?.value || 'MPESA';
    const btnLabel = document.getElementById('btn-hbm-label');
    if (btnLabel) {
        btnLabel.textContent = payMethod === 'CARD'
            ? `PAY KES ${totalKes.toLocaleString()} BY CARD (VISA/MC)`
            : `BOOK HOLIDAY · PAY KES ${totalKes.toLocaleString()} VIA M-PESA`;
    }

    return { totalKes, totalUsd, selectedNights, roomTypeIndex: roomIdx, bundledFlightKes };
}

function saveCurrentHolidayDraft() {
    if (!currentHolidayBooking) return;
    const checkin = document.getElementById('hbm-checkin-date')?.value || '';
    const checkout = document.getElementById('hbm-checkout-date')?.value || '';
    const guestName = document.getElementById('hbm-guest-name')?.value?.trim() || '';
    const guestEmail = document.getElementById('hbm-guest-email')?.value?.trim() || '';
    const guestPhone = document.getElementById('hbm-guest-phone')?.value?.trim() || '';
    const totals = calculateHolidayTotal() || { totalKes: currentHolidayBooking.rate };
    saveTravelPlan('holiday', 'hbm-status', {
        title: currentHolidayBooking.title,
        checkin,
        checkout,
        travellers: (document.getElementById('hbm-adults-count')?.value || '2') + ' Adults',
        guestName,
        guestEmail,
        guestPhone,
        totalKes: `KES ${Number(totals.totalKes || 0).toLocaleString()}`
    });
}

async function handleHolidayBookingSubmit(event) {
    event.preventDefault();
    if (!currentHolidayBooking) return;
    const checkin = document.getElementById('hbm-checkin-date')?.value;
    const checkout = document.getElementById('hbm-checkout-date')?.value;
    const statusEl = document.getElementById('hbm-status');
    const submitBtn = document.getElementById('btn-hbm-submit');
    if (!checkin || !checkout || checkout <= checkin) {
        if (statusEl) statusEl.textContent = 'Choose a check-out date after check-in.';
        return;
    }

    const guestName = document.getElementById('hbm-guest-name')?.value?.trim() || '';
    const guestEmail = document.getElementById('hbm-guest-email')?.value?.trim() || '';
    const guestPhone = document.getElementById('hbm-guest-phone')?.value?.trim() || '';
    const adults = Math.max(1, Number(document.getElementById('hbm-adults-count')?.value || 2));
    const roomTypeIndex = Math.max(0, Number(document.getElementById('hbm-room-type')?.value || 0));
    const addons = [];
    if (document.getElementById('hbm-addon-sgr')?.checked) addons.push('sgr');
    if (document.getElementById('hbm-addon-excursion')?.checked) addons.push('excursion');

    const bundleReturnFlight = Boolean(document.getElementById('hbm-addon-flight')?.checked);
    const payMethod = document.getElementById('hbm-pay-method')?.value || 'MPESA';

    const payload = {
        packageKey: currentHolidayBooking.key,
        checkin,
        checkout,
        adults,
        roomTypeIndex,
        addons,
        bundleReturnFlight,
        promoCode: activeHolidayPromo?.code || '',
        customer: { name: guestName, email: guestEmail, phone: guestPhone }
    };
    const fingerprint = JSON.stringify(payload);

    if (submitBtn) submitBtn.disabled = true;
    if (statusEl) statusEl.textContent = 'Reserving holiday itinerary & verifying price...';

    try {
        if (!pendingHolidayOrder || pendingHolidayOrder.fingerprint !== fingerprint) {
            const requestId = (typeof crypto?.randomUUID === 'function')
                ? crypto.randomUUID()
                : ('hol-' + Date.now() + '-' + Math.random().toString(16).slice(2, 14));
            const booked = await commerceRequest('/travel/itineraries/book', { ...payload, requestId });
            pendingHolidayOrder = {
                fingerprint,
                requestId,
                orderReference: booked.orderReference,
                totalKes: booked.totalKes
            };
        }

        const { orderReference, totalKes } = pendingHolidayOrder;
        const walletRef = document.getElementById('wallet-reference');
        const walletEmail = document.getElementById('wallet-email');
        if (walletRef) walletRef.value = orderReference;
        if (walletEmail) walletEmail.value = guestEmail;

        saveTravelPlan('holiday', 'hbm-status', {
            orderReference,
            title: currentHolidayBooking.title,
            checkin,
            checkout,
            travellers: adults + ' Adults',
            guestName,
            guestEmail,
            totalKes: `KES ${Number(totalKes || 0).toLocaleString()}`
        });

        if (payMethod === 'CARD') {
            if (statusEl) statusEl.textContent = `Initializing secure card checkout for KES ${Number(totalKes || 0).toLocaleString()}...`;
            const cardInit = await commerceRequest('/payments/card/initiate', { orderReference });
            if (cardInit.authorizationUrl) {
                window.location.href = cardInit.authorizationUrl;
                return;
            }
            const verified = await commerceRequest('/payments/card/verify', { orderReference, reference: cardInit.reference });
            pendingHolidayOrder = null;
            rememberOrder(verified.data, verified.passes || []);
            closeHolidayBookingModal();
            openTicketWallet();
            if (verified.passes?.[0]) openDigitalPass(verified.passes[0]);
            if (typeof showToast === 'function') showToast('Card payment confirmed! Your holiday voucher is ready.');
            return;
        }

        if (statusEl) statusEl.textContent = `Sending M-Pesa STK Push for KES ${Number(totalKes || 0).toLocaleString()} (Order ${orderReference})...`;
        const payment = await commerceRequest('/payments/mpesa/stkpush', {
            orderReference,
            phone: guestPhone
        });

        if (payment.mode === 'demo') {
            const conf = await commerceRequest('/payments/demo/confirm', {
                orderReference,
                checkoutRequestId: payment.CheckoutRequestID
            });
            pendingHolidayOrder = null;
            rememberOrder(conf.data, conf.passes || []);
            closeHolidayBookingModal();
            openTicketWallet();
            if (conf.passes?.[0]) openDigitalPass(conf.passes[0]);
            return;
        }

        if (statusEl) {
            statusEl.textContent = `${payment.CustomerMessage || 'Approve the M-Pesa prompt on your phone.'} Order ${orderReference}.`;
        }
        if (typeof showToast === 'function') {
            showToast(payment.CustomerMessage || `M-Pesa STK Push sent for Holiday Order ${orderReference}!`);
        }

        for (let attempt = 0; attempt < 20; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 3500));
            const check = await commerceRequest('/payments/status/' + encodeURIComponent(orderReference) + '?email=' + encodeURIComponent(guestEmail)).catch(() => null);
            if (check?.status === 'COMPLETED') {
                pendingHolidayOrder = null;
                rememberOrder(check.order, check.passes || []);
                closeHolidayBookingModal();
                openTicketWallet();
                if (check.passes?.[0]) openDigitalPass(check.passes[0]);
                if (typeof showToast === 'function') {
                    showToast('Holiday tickets confirmed! Your QR pass and PDF voucher are ready.');
                }
                return;
            }
            if (check?.status === 'FAILED') {
                pendingHolidayOrder = null;
                throw new Error(check.reason || 'M-Pesa payment was cancelled or declined.');
            }
            if (statusEl) {
                statusEl.textContent = `Awaiting M-Pesa confirmation (${attempt + 1}/20)... Order: ${orderReference}`;
            }
        }
        if (statusEl) {
            statusEl.textContent = `Payment confirmation still pending. Click "Check My Holiday Tickets" with Order ${orderReference} once complete.`;
        }
    } catch (err) {
        if ([400, 404, 409, 410, 422].includes(err.status)) {
            pendingHolidayOrder = null;
        }
        if (statusEl) {
            statusEl.textContent = err.message || 'Could not start M-Pesa holiday checkout. Please try again.';
        }
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
    const panel = trigger.closest('#chat-support-modal');
    if (panel && window.ticketSupport) void window.ticketSupport.submit();
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
        const intro = surface.closest('#view-login')?.querySelector('#login-page-title');
        if (intro) intro.textContent = user ? 'My account' : 'Log In to Ticketsassa';
        for (const element of surface.querySelectorAll('[data-auth-guest]')) element.hidden = Boolean(user);
        updateAccountReadiness(surface.querySelector('[data-auth-form]'));
    }
    for (const [input, value] of accountPrefills) {
        if (input.value === value) input.value = '';
    }
    accountPrefills.clear();
    if (user) {
        for (const [id, value] of [
            ['cust-name', user.name], ['cust-email', user.email],
            ['wallet-email', user.email], ['ts-cust-name', user.name], ['ts-cust-email', user.email],
            ['hbm-guest-name', user.name], ['hbm-guest-email', user.email]
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
    const googleLink = surface.querySelector('[data-auth-google]');
    if (googleLink) {
        googleLink.hidden = Boolean(signedInAccount) || !connected || !accountProviders?.google ||
            (accountProviders.googleMode && accountProviders.googleMode !== 'oauth') || /; wv\)/.test(navigator.userAgent);
        for (const element of surface.querySelectorAll('[data-auth-guest]')) element.hidden = googleLink.hidden;
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

function togglePasswordVisibility(button) {
    const input = document.getElementById(button.getAttribute('aria-controls'));
    const visible = input.type === 'password';
    input.type = visible ? 'text' : 'password';
    button.textContent = visible ? 'Hide password' : 'Show password';
    button.setAttribute('aria-pressed', String(visible));
}

function setAccountMode(form, mode) {
    form.elements.password.type = 'password';
    const visibilityToggle = form.querySelector('[data-password-toggle]');
    if (visibilityToggle) {
        visibilityToggle.textContent = 'Show password';
        visibilityToggle.setAttribute('aria-pressed', 'false');
    }
    const registering = mode === 'register';
    form.dataset.mode = mode;
    form.querySelector('[data-auth-name]').hidden = !registering;
    form.elements.name.required = registering;
    form.elements.password.minLength = registering ? 12 : 0;
    form.elements.password.autocomplete = registering ? 'new-password' : 'current-password';
    const passwordHelp = form.querySelector('[data-password-help]');
    if (passwordHelp) passwordHelp.hidden = !registering;
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
    if (registering && !form.elements.name.value.trim()) {
        status.textContent = 'Enter your full name to create your account.';
        form.elements.name.focus();
        return;
    }
    if (!form.checkValidity()) {
        const invalid = form.querySelector(':invalid');
        status.textContent = invalid?.name === 'password'
            ? registering ? 'Choose a password with at least 12 characters to continue.' : 'Enter your password to sign in.'
            : invalid?.name === 'email' ? 'Enter a valid email address to continue.' : 'Complete the required fields to continue.';
        form.reportValidity();
        return;
    }
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
        switchTab('events');
        showToast(registering ? 'Account created and signed in.' : 'You are signed in.');
    } catch (error) {
        status.textContent = error.message;
    } finally {
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
let linkedEventId = new URLSearchParams(location.search).get('event');

function openLinkedEvent() {
    if (!linkedEventId || !ticketsasaCatalogMap.has(linkedEventId)) return;
    const id = linkedEventId;
    linkedEventId = null;
    openTicketsasaEventModal(id);
}

window.onTicketsasaCatalogLoaded = function (eventsList) {
    if (!Array.isArray(eventsList)) return;
    for (const ev of eventsList) {
        if (ev?.id) ticketsasaCatalogMap.set(ev.id, ev);
    }
    openLinkedEvent();
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
        openLinkedEvent();
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
    const modal = document.getElementById('ticketsasa-event-modal');
    if (activeTicketsasaDetailEvent && !activeTicketsasaDetailEvent.tiers.length &&
        modal && !modal.classList.contains('hidden') && tiers.some(tier => tier.eventId === activeTicketsasaDetailEvent.id)) {
        openTicketsasaEventModal(activeTicketsasaDetailEvent.id);
    }
    for (const [id, options] of publishedOptions) {
        const eventTiers = tiers.filter(tier => tier.eventId === id);
        renderDemoTicketOptions(eventTiers, options);
        options.nextElementSibling.hidden = !eventTiers.some(tier => tier.remainingAllocation > 0);
        if (!options.children.length) options.textContent = 'Tickets are off sale or availability is unavailable.';
    }
}

function buildClientFallbackTiers(ev) {
    const eventId = String(ev?.id || 'event');
    const eventTitle = String(ev?.title || 'Ticketsasa Event');
    const offers = Array.isArray(ev?.price?.offers) ? ev.price.offers.filter(o => Number(o?.amount) > 0) : [];
    if (offers.length) {
        return offers.map((offer, idx) => {
            const priceKes = Math.max(1, Math.round(Number(offer.amount) || 1000));
            const title = String(offer.title || (idx === 0 ? 'General Admission' : `Tier ${idx + 1}`)).trim();
            return {
                tierKey: `client-${eventId}-${idx}`,
                title,
                eventId,
                eventTitle,
                priceKes,
                priceUsd: Math.max(1, Math.round((priceKes / 125) * 100) / 100),
                published: true,
                isActive: true,
                totalAllocation: 1000,
                remainingAllocation: 1000,
                designatedGate: ['Gate A', 'Gate B', 'Gate C', 'Gate D'][idx % 4]
            };
        });
    }
    const basePrice = Math.max(1, Math.round(Number(ev?.startingPrice ?? ev?.price?.amount ?? 1000) || 1000));
    const vipPrice = Math.min(1000000, Math.max(basePrice + 1000, basePrice * 2));
    return [
        {
            tierKey: `client-${eventId}-0`,
            title: 'General Admission',
            eventId,
            eventTitle,
            priceKes: basePrice,
            priceUsd: Math.max(1, Math.round((basePrice / 125) * 100) / 100),
            published: true,
            isActive: true,
            totalAllocation: 1000,
            remainingAllocation: 1000,
            designatedGate: 'Gate A'
        },
        {
            tierKey: `client-${eventId}-1`,
            title: 'VIP Pass',
            eventId,
            eventTitle,
            priceKes: vipPrice,
            priceUsd: Math.max(1, Math.round((vipPrice / 125) * 100) / 100),
            published: true,
            isActive: true,
            totalAllocation: 500,
            remainingAllocation: 500,
            designatedGate: 'Gate B'
        }
    ];
}

function renderAdvertisedPrices(event, eventTiers) {
    const panel = document.getElementById('ts-advertised-prices');
    if (!panel) return;
    const price = eventTiers.length ? null : event.price;
    panel.classList.toggle('hidden', price?.amount == null);
    const offers = price?.offers?.length ? price.offers : price?.amount != null ? [{ amount: price.amount }] : [];
    panel.querySelector('ul').replaceChildren(...offers.map(offer => {
        const entry = document.createElement('li');
        entry.textContent = [offer.title, formatMoney(offer.amount, price.currency || 'KES')].filter(Boolean).join(' · ');
        return entry;
    }));
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

    let eventTiers = currentTicketTiers.filter(tier => tier.eventId === ev.id);
    if (!eventTiers.length && Array.isArray(ev.tiers) && ev.tiers.length) {
        eventTiers = ev.tiers;
    }
    if (!eventTiers.length || !eventTiers.some(tier => (Number(tier.remainingAllocation) || 0) > 0)) {
        eventTiers = buildClientFallbackTiers(ev);
    }
    renderAdvertisedPrices(ev, eventTiers);
    activeTicketsasaDetailEvent = { ...ev, tiers: eventTiers };
    const bookButton = document.getElementById('ts-btn-book-now');
    if (bookButton) bookButton.disabled = false;
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
                <div class="text-[11px] font-bold text-slate-600">${ev.startingPrice == null ? 'Price unavailable' : 'KES ' + Number(ev.startingPrice).toLocaleString()}</div>
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

// ============================================================================
// SAVED FAVORITES, PRICE-DROP ALERTS & MY TRIPS DASHBOARD
// ============================================================================
const LOCAL_FAVS_KEY = 'ticketsasa_saved_favorites_v1';

function readLocalFavorites() {
    try {
        const raw = localStorage.getItem(LOCAL_FAVS_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function writeLocalFavorites(list) {
    try { localStorage.setItem(LOCAL_FAVS_KEY, JSON.stringify(list.slice(0, 100))); } catch {}
}

window.isFavoriteDeal = function (itemKey) {
    return readLocalFavorites().some(f => f.itemKey === itemKey);
};

window.toggleFavoriteDeal = async function (item) {
    if (!item?.itemKey) return false;
    const list = readLocalFavorites();
    const exists = list.some(f => f.itemKey === item.itemKey);
    if (exists) {
        writeLocalFavorites(list.filter(f => f.itemKey !== item.itemKey));
        if (signedInAccount) {
            await fetch('/api/me/favorites/' + encodeURIComponent(item.itemKey), { method: 'DELETE', credentials: 'same-origin' }).catch(() => {});
        }
        if (typeof showToast === 'function') showToast('Removed from Saved Deals.');
        return false;
    } else {
        const entry = {
            itemKey: item.itemKey,
            kind: item.kind || 'holiday',
            title: item.title || 'Saved Deal',
            subtitle: item.subtitle || '',
            image: item.image || '',
            savedPriceKes: Math.round(Number(item.priceKes) || 0),
            savedAt: new Date().toISOString()
        };
        writeLocalFavorites([entry, ...list]);
        if (signedInAccount) {
            await fetch('/api/me/favorites', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(item)
            }).catch(() => {});
        }
        if (typeof showToast === 'function') showToast('Saved to your Wishlist with Price-Drop Alerts!');
        return true;
    }
};

async function loadMyTripsDashboard() {
    const tripsEl = document.getElementById('my-booked-trips');
    const favsEl = document.getElementById('my-saved-favorites');
    const alertsEl = document.getElementById('my-price-alerts');
    if (!tripsEl || !favsEl || !alertsEl) return;

    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    let favorites = readLocalFavorites();
    alertsEl.innerHTML = '';

    try {
        const res = await fetch('/api/me/trips', { credentials: 'same-origin' });
        if (res.ok) {
            const data = await res.json();
            const orders = data.orders || [];
            const passes = data.passes || [];
            if (orders.length) {
                tripsEl.innerHTML = `<h3 class="text-sm font-extrabold text-slate-900 mb-2">Your Booked Trips &amp; Tickets (${orders.length})</h3>` +
                    orders.slice(0, 10).map(o => {
                        const title = o.items?.[0]?.eventTitle || o.items?.[0]?.title || o.orderReference;
                        const pass = passes.find(p => p.orderReference === o.orderReference);
                        return `<div class="p-3 rounded-xl border border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2">
                            <div>
                                <div class="font-bold text-slate-900">${esc(title)}</div>
                                <div class="text-[11px] text-slate-500">Order ${esc(o.orderReference)} · KES ${Number(o.totalKes || 0).toLocaleString()} · ${esc(o.paymentStatus)}</div>
                            </div>
                            ${pass ? `<a href="/api/passes/${encodeURIComponent(pass.qrCodeToken)}/pdf?email=${encodeURIComponent(data.user.email)}" target="_blank" class="px-3 py-1.5 rounded-lg bg-emerald-700 text-white text-[11px] font-bold">Download PDF Pass</a>` : ''}
                        </div>`;
                    }).join('');
            } else {
                tripsEl.innerHTML = `<p class="text-xs text-slate-500">No booked trips yet for ${esc(data.user?.email || 'your account')}.</p>`;
            }

            const [fRes, aRes] = await Promise.all([
                fetch('/api/me/favorites', { credentials: 'same-origin' }),
                fetch('/api/me/price-alerts', { credentials: 'same-origin' })
            ]);
            if (fRes.ok) {
                const fData = await fRes.json();
                if (Array.isArray(fData.favorites) && fData.favorites.length) {
                    favorites = fData.favorites;
                    writeLocalFavorites(favorites);
                }
            }
            if (aRes.ok) {
                const aData = await aRes.json();
                const alerts = aData.alerts || [];
                if (alerts.length) {
                    alertsEl.innerHTML = alerts.map(a => `
                        <div class="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 font-bold">
                            Price Drop Alert: ${esc(a.title)} dropped from KES ${Number(a.savedPriceKes).toLocaleString()} to KES ${Number(a.currentPriceKes).toLocaleString()} (Save KES ${Number(a.savingsKes).toLocaleString()})!
                        </div>
                    `).join('');
                }
            }
        } else {
            tripsEl.innerHTML = `<div class="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 flex items-center justify-between gap-2">
                <span>Sign in to see all your past &amp; upcoming trips automatically without typing order numbers.</span>
                <button type="button" onclick="switchTab('login')" class="px-3 py-1.5 rounded-lg bg-[#D81A21] text-white font-bold text-[11px]">Sign In</button>
            </div>`;
        }
    } catch {
        tripsEl.innerHTML = `<p class="text-xs text-slate-500">Sign in to sync your trips across devices.</p>`;
    }

    if (!favorites.length) {
        favsEl.innerHTML = `<p class="col-span-full text-xs text-slate-500">No saved flights or holidays yet. Click ♡ Save on any flight or holiday deal to track prices.</p>`;
    } else {
        favsEl.innerHTML = favorites.map(f => `
            <div class="p-3 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-between gap-2">
                <div>
                    <div class="text-[10px] font-bold uppercase text-sky-700">${esc(f.kind)}</div>
                    <div class="font-bold text-slate-900 line-clamp-1">${esc(f.title)}</div>
                    <div class="text-[11px] text-slate-500">Saved at KES ${Number(f.savedPriceKes || 0).toLocaleString()}</div>
                </div>
                <button type="button" onclick="window.toggleFavoriteDeal({ itemKey: '${esc(f.itemKey)}' }).then(() => loadMyTripsDashboard())" class="px-2.5 py-1 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 text-[11px] font-bold">Remove</button>
            </div>
        `).join('');
    }
}

// Auto-verify card checkout return (?cardRef=ORD-...)
if (typeof window !== 'undefined' && window.location?.search) {
    const params = new URLSearchParams(window.location.search);
    const cardRef = params.get('cardRef');
    const txRef = params.get('reference') || params.get('trxref') || params.get('tx_ref') || '';
    const txId = params.get('transaction_id') || '';
    if (cardRef) {
        void commerceRequest('/payments/card/verify', { orderReference: cardRef, reference: txRef, transactionId: txId })
            .then(verified => {
                rememberOrder(verified.data, verified.passes || []);
                openTicketWallet();
                if (verified.passes?.[0]) openDigitalPass(verified.passes[0]);
                if (typeof showToast === 'function') showToast('Card payment verified! Your digital pass is ready.');
            })
            .catch(() => {});
    }
}
