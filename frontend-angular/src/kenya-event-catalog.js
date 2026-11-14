const POLL_MS = 60_000;
const dateFormatter = new Intl.DateTimeFormat('en-KE', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Nairobi'
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
            :host { display: block; color: #182134; font: 1rem/1.45 system-ui, sans-serif; }
            section { background: #f8fafc; padding: clamp(1rem, 3vw, 2rem); border: 1px solid #e2e8f0; border-radius: 1rem; }
            header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .75rem; }
            h2, h3, p { margin: 0; }
            input { font: inherit; color: inherit; background: white; border: 1px solid #64748b; border-radius: .5rem; padding: .45rem .65rem; box-sizing: border-box; min-height: 44px; max-width: 100%; }
            .status { margin: .65rem 0 1rem; color: #475569; font-size: .9rem; }
            .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 14rem), 1fr)); gap: 1rem; }
            article { background: white; border: 1px solid #e2e8f0; border-radius: .75rem; overflow: hidden; display: flex; flex-direction: column; }
            img { width: 100%; aspect-ratio: 16/9; object-fit: cover; display: block; }
            .details { padding: .9rem; display: flex; flex-direction: column; gap: .35rem; flex: 1; }
            h3 { font-size: 1rem; overflow-wrap: anywhere; }
            time, .venue { color: #475569; font-size: .875rem; }
            button { min-height: 44px; margin-top: 1rem; border: 1px solid #64748b; padding: .45rem .75rem; border-radius: .5rem; background: white; font: inherit; cursor: pointer; }
        `;
        this.search = element('input', '', { type: 'search', placeholder: 'Search events', 'aria-label': 'Search Kenyan events' });
        this.search.addEventListener('input', () => { this.limit = 12; this.render(); });
        const header = element('header');
        header.append(element('h2', 'Upcoming events in Kenya', { id: 'heading' }), this.search);
        this.status = element('p', 'Loading events…', { class: 'status', role: 'status' });
        this.grid = element('div', '', { class: 'grid' });
        this.more = element('button', 'Show more events', { type: 'button', hidden: '' });
        this.more.addEventListener('click', () => { this.limit += 12; this.render(); });
        const section = element('section', '', { 'aria-labelledby': 'heading' });
        section.append(header, this.status, this.grid, this.more);
        root.append(style, section);
        this.events = [];
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
        this.limit = 12;
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
            this.feedStatus = data.status;
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
            [event.title, event.venue, event.city].some(value => value?.toLowerCase().includes(query))
        );
        const status = this.feedStatus === 'local' && events.length ? 'Saved listings. Prices and availability may have changed.'
            : this.feedStatus === 'unconfigured' ? 'The event feed has not been configured.'
            : this.feedStatus === 'stale' ? (this.events.length ? 'Showing the last available listings. Prices may have changed.' : 'The event feed is temporarily unavailable.')
            : ['live', 'local'].includes(this.feedStatus) ? (events.length ? '' : query ? 'No events match your search.' : 'No upcoming events are currently listed.')
            : 'Loading events…';
        if (this.status.textContent !== status) this.status.textContent = status;
        this.status.hidden = !status;
        this.more.hidden = events.length <= this.limit;
        const visible = events.slice(0, this.limit);
        const signature = JSON.stringify(visible);
        if (this.signature !== signature) {
            this.signature = signature;
            this.grid.replaceChildren(...visible.map(event => this.card(event)));
        }
    }

    card(event) {
        const card = element('article');
        if (event.imageUrl) {
            const image = element('img', '', { src: event.imageUrl, alt: '', loading: 'lazy' });
            image.addEventListener('error', () => image.remove(), { once: true });
            card.append(image);
        }
        const details = element('div', '', { class: 'details' });
        const formatter = event.dateOnly ? dayFormatter : dateFormatter;
        const price = event.price && new Intl.NumberFormat('en-KE', {
            style: 'currency', currency: event.price.currency, currencyDisplay: 'code'
        }).format(event.price.amount);
        details.append(
            element('time', formatter.format(new Date(event.startsAt)), { datetime: event.startsAt }),
            element('h3', event.title),
            element('p', [event.venue, event.city].filter(Boolean).join(', '), { class: 'venue' }),
            element('p', event.status === 'offsale' ? 'Currently off sale' : price ? 'From ' + price : 'Price unavailable')
        );
        if (event.source) details.append(element('p', 'Source: ' + event.source, { class: 'venue' }));
        card.append(details);
        return card;
    }
}

customElements.define('kenya-event-catalog', KenyaEventCatalog);
