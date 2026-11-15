const POLL_MS = 60_000;
const dateFormatter = new Intl.DateTimeFormat('en-KE', {
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Africa/Nairobi'
});
const dayFormatter = new Intl.DateTimeFormat('en-KE', {
    dateStyle: 'medium', timeZone: 'Africa/Nairobi'
});

function element(tag, text, attributes = {}) {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    return node;
}

class KenyaEventCatalog extends HTMLElement {
    constructor() {
        super();
        const root = this.attachShadow({ mode: 'open' });
        const style = element('style');
        style.textContent = `
            :host { display: block; color: #182134; font: 1rem/1.45 system-ui, -apple-system, sans-serif; }
            section { background: transparent; padding: 0; }
            header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .75rem; margin-bottom: 1.25rem; border-bottom: 1px solid #e2e8f0; padding-bottom: .75rem; }
            h2 { margin: 0; font-size: 1.65rem; font-weight: 800; color: #0f172a; letter-spacing: -0.02em; }
            h3, p { margin: 0; }
            .controls { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; }
            input { font: inherit; font-size: .875rem; color: inherit; background: white; border: 1px solid #cbd5e1; border-radius: .65rem; padding: .5rem .85rem; box-sizing: border-box; min-height: 42px; min-width: 220px; max-width: 100%; }
            input:focus { outline: 2px solid #D81A21; border-color: #D81A21; }
            .status { margin: .65rem 0 1rem; color: #475569; font-size: .9rem; }
            .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 15.5rem), 1fr)); gap: 1.5rem; }
            article { background: white; border: 1px solid #e2e8f0; border-radius: .85rem; overflow: hidden; display: flex; flex-direction: column; transition: transform .2s ease, box-shadow .2s ease; cursor: pointer; box-shadow: 0 1px 3px rgba(15,23,42,0.05); }
            article:hover { transform: translateY(-3px); box-shadow: 0 12px 24px -6px rgba(15,23,42,0.12); border-color: #cbd5e1; }
            .img-wrap { width: 100%; aspect-ratio: 1 / 1; overflow: hidden; background: #f1f5f9; position: relative; }
            img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform .35s ease; }
            article:hover img { transform: scale(1.04); }
            .cat-badge { position: absolute; top: .6rem; left: .6rem; background: rgba(15,23,42,0.78); color: #fff; font-size: .68rem; font-weight: 700; padding: .2rem .55rem; border-radius: .35rem; backdrop-filter: blur(4px); }
            .details { padding: 1rem; display: flex; flex-direction: column; gap: .35rem; flex: 1; }
            time { color: #D81A21; font-size: .75rem; font-weight: 800; text-transform: uppercase; letter-spacing: .02em; }
            h3 { font-size: 1rem; font-weight: 800; color: #0f172a; line-height: 1.3; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
            .venue { color: #64748b; font-size: .8rem; display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden; }
            .price-row { margin-top: auto; padding-top: .65rem; border-top: 1px solid #f1f5f9; display: flex; align-items: center; justify-content: space-between; gap: .5rem; }
            .price-text { font-size: .85rem; font-weight: 800; color: #0f172a; }
            .price-text span { font-weight: 500; color: #64748b; font-size: .75rem; margin-right: .2rem; }
            .book-link { display: inline-flex; align-items: center; justify-content: center; background: #D81A21; color: white; text-decoration: none; font-size: .75rem; font-weight: 700; padding: .4rem .75rem; border-radius: .45rem; transition: background .15s; }
            .book-link:hover { background: #b9151b; }
            .pagination-bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: .5rem; margin-top: 2rem; }
            button { min-height: 40px; border: 1px solid #cbd5e1; padding: .45rem .9rem; border-radius: .5rem; background: white; font: inherit; font-size: .85rem; font-weight: 700; color: #334155; cursor: pointer; transition: all .15s; }
            button:hover { border-color: #D81A21; color: #D81A21; }
            button.active-page { background: #D81A21; color: white; border-color: #D81A21; }
        `;
        this.search = element('input', '', { type: 'search', placeholder: 'Search events, venues or cities...', 'aria-label': 'Search Kenyan events' });
        this.search.addEventListener('input', () => { this.page = 1; this.limit = 12; this.render(); });
        const controls = element('div', '', { class: 'controls' });
        controls.append(this.search);
        const header = element('header');
        header.append(element('h2', 'Upcoming events', { id: 'heading' }), controls);
        this.status = element('p', 'Loading events…', { class: 'status', role: 'status' });
        this.grid = element('div', '', { class: 'grid' });
        this.pagination = element('div', '', { class: 'pagination-bar' });
        this.more = element('button', 'Show All Events', { type: 'button', hidden: '' });
        this.more.addEventListener('click', () => { this.limit = 100; this.render(); });
        const section = element('section', '', { 'aria-labelledby': 'heading' });
        section.append(header, this.status, this.grid, this.pagination, this.more);
        root.append(style, section);
        this.events = [];
        this.page = 1;
        this.limit = 12;
    }

    connectedCallback() {
        this.refresh();
        this.timer = setInterval(() => this.refresh(), POLL_MS);
    }

    disconnectedCallback() {
        clearInterval(this.timer);
        this.request?.abort();
    }

    setQuery(query) {
        this.search.value = query;
        this.page = 1;
        this.limit = 26;
        this.render();
    }

    async refresh() {
        if (this.request) return;
        const request = new AbortController();
        this.request = request;
        const { hostname, protocol } = window.location;
        const local = ['localhost', '127.0.0.1'].includes(hostname) || protocol === 'file:';
        const endpoint = this.getAttribute('api-url') ||
            (local && (protocol === 'file:' || location.port === '4200')
                ? 'http://localhost:8000/api/events/kenya' : '/api/events/kenya');

        try {
            const response = await fetch(endpoint, {
                signal: AbortSignal.any([request.signal, AbortSignal.timeout(20_000)])
            });
            if (!response.ok) throw new Error('Catalog unavailable');
            const data = await response.json();
            if (!Array.isArray(data.events)) throw new Error('Invalid catalog response');
            this.events = data.events.map(event => ({
                ...event,
                imageUrl: event.imageUrl?.startsWith('/assets/') ? new URL(event.imageUrl, new URL(endpoint, location.href)).href : event.imageUrl
            }));
            this.storefront = new URL('/', new URL(endpoint, location.href));
            this.feedStatus = data.status;
            if (typeof window.onTicketsasaCatalogLoaded === 'function') {
                window.onTicketsasaCatalogLoaded(this.events, data.sliders);
            }
        } catch {
            if (request.signal.aborted) return;
            this.feedStatus = 'stale';
        } finally {
            this.request = null;
        }
        this.render();
    }

    render() {
        const query = this.search.value.trim().toLowerCase();
        const events = this.events.filter(event =>
            Date.parse(event.startsAt) > Date.now() &&
            [event.title, event.venue, event.city, event.category, event.locationFull].some(value => value?.toLowerCase().includes(query))
        );
        const status = this.feedStatus === 'local' && events.length ? 'Saved listings. Prices and availability may have changed.'
            : this.feedStatus === 'unavailable' ? 'The event feed is temporarily unavailable.'
            : this.feedStatus === 'stale' ? (this.events.length ? 'Showing the last available listings. Prices may have changed.' : 'The event feed is temporarily unavailable.')
            : ['live', 'local'].includes(this.feedStatus) ? (events.length ? '' : query ? 'No events match your search.' : 'No upcoming events are currently listed.')
            : 'Loading events…';
        if (this.status.textContent !== status) this.status.textContent = status;
        this.status.hidden = !status;

        const totalPages = Math.ceil(events.length / this.limit) || 1;
        if (this.page > totalPages) this.page = 1;
        const startIdx = (this.page - 1) * this.limit;
        const visible = events.slice(startIdx, startIdx + this.limit);

        this.more.hidden = events.length <= this.limit;
        this.pagination.replaceChildren();
        if (events.length > 12 && this.limit < events.length) {
            for (let p = 1; p <= totalPages; p++) {
                const btn = element('button', String(p), {
                    type: 'button',
                    class: p === this.page ? 'active-page' : ''
                });
                btn.addEventListener('click', () => {
                    this.page = p;
                    this.render();
                    this.scrollIntoView({ behavior: 'smooth', block: 'start' });
                });
                this.pagination.append(btn);
            }
            const showAllBtn = element('button', `View All (${events.length})`, { type: 'button' });
            showAllBtn.addEventListener('click', () => {
                this.limit = 100;
                this.page = 1;
                this.render();
            });
            this.pagination.append(showAllBtn);
        }

        const signature = JSON.stringify(visible.map(e => e.id)) + ':' + this.page + ':' + this.limit;
        if (this.signature !== signature) {
            this.signature = signature;
            this.grid.replaceChildren(...visible.map(event => this.card(event)));
        }
    }

    card(event) {
        const card = element('article');
        const openDetail = (ev) => {
            if (typeof window.openTicketsasaEventModal === 'function') {
                ev.preventDefault();
                window.openTicketsasaEventModal(event.id);
            }
        };
        card.addEventListener('click', openDetail);

        if (event.imageUrl) {
            const wrap = element('div', '', { class: 'img-wrap' });
            const image = element('img', '', { src: event.imageUrl, alt: event.title || '', loading: 'lazy' });
            image.addEventListener('error', () => {
                if (event.remoteImageUrl && image.src !== event.remoteImageUrl) {
                    image.src = event.remoteImageUrl;
                } else {
                    image.src = '/assets/real/SzYy0XWlBI-1792688119.png';
                }
            }, { once: true });
            wrap.append(image);
            if (event.category) {
                wrap.append(element('span', event.category, { class: 'cat-badge' }));
            }
            card.append(wrap);
        }
        const details = element('div', '', { class: 'details' });
        const formatter = event.dateOnly ? dayFormatter : dateFormatter;
        const dateLabel = event.formattedDate || formatter.format(new Date(event.startsAt));
        const isFree = Boolean(event.isFree && (!event.startingPrice || event.startingPrice === 0));
        const priceAmount = event.startingPrice !== undefined ? event.startingPrice : event.price?.amount;
        const priceFormatted = isFree
            ? 'Free Entry'
            : priceAmount !== undefined
                ? `KES ${Number(priceAmount).toLocaleString('en-KE')}`
                : 'Available';

        details.append(
            element('time', dateLabel, { datetime: event.startsAt }),
            element('h3', event.title),
            element('p', event.locationFull || [event.venue, event.city].filter(Boolean).join(', '), { class: 'venue' })
        );

        const priceRow = element('div', '', { class: 'price-row' });
        const priceNode = element('div', '', { class: 'price-text' });
        if (!isFree) {
            priceNode.append(element('span', 'Starting '), document.createTextNode(priceFormatted));
        } else {
            priceNode.textContent = 'Free';
        }
        priceRow.append(priceNode);

        if (event.checkout) {
            const url = new URL(this.storefront ?? location.href);
            url.search = new URLSearchParams({ view: 'events', event: event.id }).toString();
            const link = element('a', 'View tickets', { href: url.href, class: 'book-link' });
            link.addEventListener('click', openDetail);
            priceRow.append(link);
        }
        details.append(priceRow);
        card.append(details);
        return card;
    }
}

customElements.define('kenya-event-catalog', KenyaEventCatalog);
