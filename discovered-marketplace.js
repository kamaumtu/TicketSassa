/* Auto-Discovered Public Events, Concerts, Sports, Flights & Holiday Packages */
(() => {
    const formatKes = v => v == null ? 'Price on Request' : 'KES ' + Number(v).toLocaleString('en-KE');
    const formatDate = v => v ? new Intl.DateTimeFormat('en-KE', {
        dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Nairobi'
    }).format(new Date(v)) : 'Schedule on source site';

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined && text !== null) node.textContent = text;
        return node;
    }

    function escapeHtml(v) {
        return String(v ?? '').replace(/[&<>"']/g, ch => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[ch] || ch));
    }

    let metaCache = { counties: [], eventCategories: [], airports: [], holidayCategories: [], holidayDestinations: [] };

    const evState = { kind: 'all', category: '', county: '', q: '', sort: 'date', page: 1 };
    const flState = { destination: '', q: '', page: 1 };
    const hlState = { category: '', destination: '', q: '', sort: 'price_asc', page: 1 };

    async function loadMeta() {
        try {
            const res = await fetch('/api/automation/meta');
            if (res.ok) metaCache = await res.json();
        } catch {}
    }

    async function loadEventsSection() {
        const host = document.getElementById('view-events');
        if (!host) return;
        let container = document.getElementById('auto-discovered-events-section');
        if (!container) {
            container = el('section', 'max-w-7xl mx-auto px-4 sm:px-6 py-8 border-t border-slate-200');
            container.id = 'auto-discovered-events-section';
            host.append(container);
        }

        const params = new URLSearchParams({
            kind: evState.kind,
            category: evState.category,
            county: evState.county,
            q: evState.q,
            sort: evState.sort,
            page: String(evState.page),
            limit: '12'
        });

        let payload = { events: [], totals: { events: 0 } };
        try {
            const res = await fetch('/api/automation/public/catalog?' + params.toString());
            if (res.ok) payload = await res.json();
        } catch {}

        const events = payload.events || [];
        const total = payload.totals?.events || 0;
        const totalPages = Math.max(1, Math.ceil(total / 12));

        container.innerHTML = `
            <div class="flex flex-wrap items-center justify-between gap-4 mb-5">
                <div>
                    <h2 class="text-2xl font-extrabold text-slate-900">Kenya Auto-Discovered Events, Concerts &amp; Sports</h2>
                    <p class="text-xs text-slate-600 mt-1">Discovered across 47 Kenyan counties from verified public sources. Prices &amp; ticket types are clearly labeled.</p>
                </div>
                <div class="flex flex-wrap gap-2 text-xs font-bold">
                    <button type="button" data-kind="all" class="px-3 py-1.5 rounded-full border ${evState.kind === 'all' ? 'bg-[#D81A21] text-white border-[#D81A21]' : 'bg-white text-slate-700 border-slate-300'}">All Events</button>
                    <button type="button" data-kind="concerts" class="px-3 py-1.5 rounded-full border ${evState.kind === 'concerts' ? 'bg-[#D81A21] text-white border-[#D81A21]' : 'bg-white text-slate-700 border-slate-300'}">Concerts</button>
                    <button type="button" data-kind="sports" class="px-3 py-1.5 rounded-full border ${evState.kind === 'sports' ? 'bg-[#D81A21] text-white border-[#D81A21]' : 'bg-white text-slate-700 border-slate-300'}">Sports</button>
                </div>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-6">
                <input type="search" id="auto-ev-search" value="${escapeHtml(evState.q)}" placeholder="Search event, venue, town…" class="px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white">
                <select id="auto-ev-county" class="px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white">
                    <option value="">All 47 Counties</option>
                    ${(metaCache.counties || []).map(c => `<option value="${escapeHtml(c)}" ${evState.county === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
                </select>
                <select id="auto-ev-cat" class="px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white">
                    <option value="">All Categories</option>
                    ${(metaCache.eventCategories || []).map(c => `<option value="${escapeHtml(c)}" ${evState.category === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
                </select>
                <select id="auto-ev-sort" class="px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white">
                    <option value="date" ${evState.sort === 'date' ? 'selected' : ''}>Sort: Upcoming Date</option>
                    <option value="price_asc" ${evState.sort === 'price_asc' ? 'selected' : ''}>Sort: Price Low → High</option>
                    <option value="price_desc" ${evState.sort === 'price_desc' ? 'selected' : ''}>Sort: Price High → Low</option>
                </select>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5" id="auto-ev-grid"></div>
            <div class="flex items-center justify-center gap-3 mt-6 text-xs font-bold">
                <button type="button" id="auto-ev-prev" ${evState.page <= 1 ? 'disabled' : ''} class="px-3 py-1.5 rounded border border-slate-300 bg-white disabled:opacity-40">Previous</button>
                <span>Page ${evState.page} of ${totalPages} (${total} verified events)</span>
                <button type="button" id="auto-ev-next" ${evState.page >= totalPages ? 'disabled' : ''} class="px-3 py-1.5 rounded border border-slate-300 bg-white disabled:opacity-40">Next</button>
            </div>
        `;

        container.querySelectorAll('[data-kind]').forEach(btn => {
            btn.addEventListener('click', () => {
                evState.kind = btn.getAttribute('data-kind') || 'all';
                evState.category = '';
                evState.page = 1;
                void loadEventsSection();
            });
        });
        container.querySelector('#auto-ev-search').addEventListener('change', e => { evState.q = e.target.value; evState.page = 1; void loadEventsSection(); });
        container.querySelector('#auto-ev-county').addEventListener('change', e => { evState.county = e.target.value; evState.page = 1; void loadEventsSection(); });
        container.querySelector('#auto-ev-cat').addEventListener('change', e => { evState.category = e.target.value; evState.kind = 'all'; evState.page = 1; void loadEventsSection(); });
        container.querySelector('#auto-ev-sort').addEventListener('change', e => { evState.sort = e.target.value; evState.page = 1; void loadEventsSection(); });
        container.querySelector('#auto-ev-prev').addEventListener('click', () => { if (evState.page > 1) { evState.page--; void loadEventsSection(); } });
        container.querySelector('#auto-ev-next').addEventListener('click', () => { if (evState.page < totalPages) { evState.page++; void loadEventsSection(); } });

        const grid = container.querySelector('#auto-ev-grid');
        if (!events.length) {
            grid.innerHTML = `<p class="col-span-full text-sm text-slate-500 py-4">No auto-discovered events match these filters yet.</p>`;
            return;
        }
        for (const ev of events) {
            const card = el('article', 'bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col shadow-sm hover:shadow-md transition');
            const displayPrice = ev.confirmedPriceKes ?? ev.estimatedPriceKes;
            const imgUrl = ev.image?.url || '/assets/real/DzLV4G9UWo-1790859483.jpg';
            card.innerHTML = `
                <div class="relative aspect-[16/10] bg-slate-100 overflow-hidden">
                    <img src="${escapeHtml(imgUrl)}" alt="${escapeHtml(ev.name)}" loading="lazy" class="w-full h-full object-cover" onerror="this.src='/assets/real/DzLV4G9UWo-1790859483.jpg'">
                    <span class="absolute top-2 left-2 bg-slate-900/80 text-white text-[10px] font-bold px-2 py-0.5 rounded">${escapeHtml(ev.county)}</span>
                    <span class="absolute top-2 right-2 ${ev.authorizedToSell ? 'bg-emerald-600' : 'bg-blue-700'} text-white text-[10px] font-bold px-2 py-0.5 rounded">${escapeHtml(ev.ticketTypeLabel)}</span>
                </div>
                <div class="p-4 flex flex-col gap-1.5 flex-1">
                    <div class="text-[11px] font-bold text-[#D81A21] uppercase">${escapeHtml(formatDate(ev.startsAt))}</div>
                    <h3 class="text-sm font-extrabold text-slate-900 line-clamp-2">${escapeHtml(ev.name)}</h3>
                    <p class="text-xs text-slate-600 line-clamp-1">${escapeHtml(ev.venue || ev.town || ev.county)} · ${escapeHtml(ev.category)}</p>
                    <p class="text-[11px] text-slate-500 line-clamp-2">${escapeHtml(ev.description || '')}</p>
                    <div class="mt-auto pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                        <div>
                            <div class="text-xs font-extrabold text-slate-900">${escapeHtml(formatKes(displayPrice))}</div>
                            <div class="text-[10px] text-slate-500">${escapeHtml(ev.priceLabel)} · ${escapeHtml(ev.bookingLabel)}</div>
                        </div>
                        ${ev.authorizedToSell && typeof window.openTicketsasaEventModal === 'function'
                            ? `<button type="button" data-buy-internal="${escapeHtml(ev.externalId)}" class="px-3 py-1.5 rounded-lg bg-[#D81A21] text-white text-xs font-bold">Buy Tickets</button>`
                            : `<a href="${escapeHtml(ev.ticketPurchaseUrl || ev.originalUrl)}" target="_blank" rel="noopener noreferrer" class="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-bold">Official Site ↗</a>`}
                    </div>
                    <div class="text-[10px] text-slate-400">Source: ${escapeHtml(ev.discoverySource)} · Verified ${escapeHtml(formatDate(ev.lastVerifiedAt))}</div>
                </div>
            `;
            const buyBtn = card.querySelector('[data-buy-internal]');
            if (buyBtn) {
                buyBtn.addEventListener('click', () => window.openTicketsasaEventModal(ev.externalId));
            }
            grid.append(card);
        }
    }

    async function loadFlightsSection() {
        const host = document.getElementById('view-flights');
        if (!host) return;
        let container = document.getElementById('auto-discovered-flights-section');
        if (!container) {
            container = el('section', 'max-w-7xl mx-auto px-4 sm:px-6 py-8 border-t border-slate-200');
            container.id = 'auto-discovered-flights-section';
            host.append(container);
        }

        const params = new URLSearchParams({ kind: 'flights', destination: flState.destination, q: flState.q, page: String(flState.page), limit: '12' });
        let payload = { flights: [], totals: { flights: 0 } };
        try {
            const res = await fetch('/api/automation/public/catalog?' + params.toString());
            if (res.ok) payload = await res.json();
        } catch {}

        const flights = payload.flights || [];
        const total = payload.totals?.flights || 0;

        container.innerHTML = `
            <div class="flex flex-wrap items-center justify-between gap-4 mb-4">
                <div>
                    <h2 class="text-2xl font-extrabold text-slate-900">Kenya &amp; Regional Airlines — Public Route &amp; Fare Discovery</h2>
                    <p class="text-xs text-slate-600 mt-1">Only verified airline routes &amp; published fares from official airline websites. Clicking continues to the airline's official website to complete booking.</p>
                </div>
                <div class="flex flex-wrap gap-2">
                    <input type="search" id="auto-fl-search" value="${escapeHtml(flState.q)}" placeholder="Search airline or airport…" class="px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white">
                    <select id="auto-fl-dest" class="px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white">
                        <option value="">All Airports</option>
                        ${(metaCache.airports || []).map(a => `<option value="${escapeHtml(a.code)}" ${flState.destination === a.code ? 'selected' : ''}>${escapeHtml(a.code)} · ${escapeHtml(a.city)}</option>`).join('')}
                    </select>
                </div>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" id="auto-fl-grid"></div>
        `;

        container.querySelector('#auto-fl-search').addEventListener('change', e => { flState.q = e.target.value; void loadFlightsSection(); });
        container.querySelector('#auto-fl-dest').addEventListener('change', e => { flState.destination = e.target.value; void loadFlightsSection(); });

        const grid = container.querySelector('#auto-fl-grid');
        if (!flights.length) {
            grid.innerHTML = `<p class="col-span-full text-sm text-slate-500 py-4">No public flight routes match (${total} total indexed).</p>`;
            return;
        }
        for (const fl of flights) {
            const card = el('article', 'bg-white border border-slate-200 rounded-xl p-4 flex flex-col gap-2 shadow-sm');
            card.innerHTML = `
                <div class="flex items-center justify-between gap-2">
                    <div class="flex items-center gap-2.5">
                        <img src="${escapeHtml(fl.airlineLogo || '/assets/airlines/kenya-airways.svg')}" alt="${escapeHtml(fl.airline)}" class="w-10 h-6 object-contain">
                        <div>
                            <div class="text-sm font-extrabold text-slate-900">${escapeHtml(fl.airline)} ${escapeHtml(fl.flightNumber || '')}</div>
                            <div class="text-[11px] text-slate-500">${escapeHtml(fl.originCode)} → ${escapeHtml(fl.destinationCode)}</div>
                        </div>
                    </div>
                    <span class="px-2 py-0.5 rounded bg-sky-100 text-sky-900 text-[10px] font-bold">${escapeHtml(fl.bookingLabel)}</span>
                </div>
                <p class="text-xs text-slate-700">${escapeHtml(fl.routeSummary || `${fl.originName || fl.originCode} → ${fl.destinationName || fl.destinationCode}`)}</p>
                <p class="text-[11px] text-slate-500">${fl.departureTime ? formatDate(fl.departureTime) : 'Schedule & seat availability verified directly on official airline site'} · ${escapeHtml(fl.baggageAllowance || '')}</p>
                <div class="mt-auto pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                    <div>
                        <div class="text-sm font-extrabold text-slate-900">${escapeHtml(formatKes(fl.priceKes))}</div>
                        <div class="text-[10px] text-slate-500">${escapeHtml(fl.priceLabel)}</div>
                    </div>
                    <a href="${escapeHtml(fl.bookingUrl)}" target="_blank" rel="noopener noreferrer" class="px-3 py-1.5 rounded-lg bg-sky-700 hover:bg-sky-800 text-white text-xs font-bold">Check on Airline ↗</a>
                </div>
                <div class="text-[10px] text-slate-400">Source: ${escapeHtml(fl.source)} · Verified ${escapeHtml(formatDate(fl.lastVerifiedAt))}</div>
            `;
            grid.append(card);
        }
    }

    async function loadHolidaysSection() {
        const host = document.getElementById('view-holidays');
        if (!host) return;
        let container = document.getElementById('auto-discovered-holidays-section');
        if (!container) {
            container = el('section', 'max-w-7xl mx-auto px-4 sm:px-6 py-8 border-t border-slate-200');
            container.id = 'auto-discovered-holidays-section';
            host.append(container);
        }

        const params = new URLSearchParams({ kind: 'holidays', category: hlState.category, destination: hlState.destination, q: hlState.q, sort: hlState.sort, page: String(hlState.page), limit: '12' });
        let payload = { holidays: [], totals: { holidays: 0 } };
        try {
            const res = await fetch('/api/automation/public/catalog?' + params.toString());
            if (res.ok) payload = await res.json();
        } catch {}

        const holidays = payload.holidays || [];
        container.innerHTML = `
            <div class="flex flex-wrap items-center justify-between gap-4 mb-4">
                <div>
                    <h2 class="text-2xl font-extrabold text-slate-900">Kenya &amp; International Holiday Packages</h2>
                    <p class="text-xs text-slate-600 mt-1">Discovered from verified tour operators &amp; holiday websites with live FX currency conversion. Clicking opens the operator's booking page.</p>
                </div>
                <div class="flex flex-wrap gap-2">
                    <input type="search" id="auto-hl-search" value="${escapeHtml(hlState.q)}" placeholder="Search safari, beach, Dubai…" class="px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white">
                    <select id="auto-hl-dest" class="px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white">
                        <option value="">All Destinations</option>
                        ${(metaCache.holidayDestinations || []).map(d => `<option value="${escapeHtml(d)}" ${hlState.destination === d ? 'selected' : ''}>${escapeHtml(d)}</option>`).join('')}
                    </select>
                    <select id="auto-hl-cat" class="px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white">
                        <option value="">All Holiday Types</option>
                        ${(metaCache.holidayCategories || []).map(c => `<option value="${escapeHtml(c)}" ${hlState.category === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
                    </select>
                </div>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5" id="auto-hl-grid"></div>
        `;

        container.querySelector('#auto-hl-search').addEventListener('change', e => { hlState.q = e.target.value; void loadHolidaysSection(); });
        container.querySelector('#auto-hl-dest').addEventListener('change', e => { hlState.destination = e.target.value; void loadHolidaysSection(); });
        container.querySelector('#auto-hl-cat').addEventListener('change', e => { hlState.category = e.target.value; void loadHolidaysSection(); });

        const grid = container.querySelector('#auto-hl-grid');
        if (!holidays.length) {
            grid.innerHTML = `<p class="col-span-full text-sm text-slate-500 py-4">No holiday packages match this filter yet.</p>`;
            return;
        }
        for (const hl of holidays) {
            const img = hl.images?.[0]?.url || '/assets/real/lheAq1Zpc0-1794303741.jpg';
            const canBuyHere = hl.priceKes != null && Number(hl.priceKes) > 0 && hl.availability !== 'sold_out' && typeof window.openCustomHolidayBookingModal === 'function';
            const card = el('article', 'bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col shadow-sm');
            card.innerHTML = `
                <div class="relative aspect-[16/10] bg-slate-100 overflow-hidden">
                    <img src="${escapeHtml(img)}" alt="${escapeHtml(hl.title)}" loading="lazy" class="w-full h-full object-cover" onerror="this.src='/assets/real/lheAq1Zpc0-1794303741.jpg'">
                    <span class="absolute top-2 left-2 bg-slate-900/80 text-white text-[10px] font-bold px-2 py-0.5 rounded">${escapeHtml(hl.destination)}</span>
                    <span class="absolute top-2 right-2 bg-amber-600 text-white text-[10px] font-bold px-2 py-0.5 rounded">${escapeHtml(hl.bookingLabel)}</span>
                </div>
                <div class="p-4 flex flex-col gap-1.5 flex-1">
                    <div class="text-[11px] font-bold text-emerald-700 uppercase">${escapeHtml(hl.category)} ${hl.duration ? '· ' + escapeHtml(hl.duration) : ''}</div>
                    <h3 class="text-sm font-extrabold text-slate-900 line-clamp-2">${escapeHtml(hl.title)}</h3>
                    <p class="text-[11px] text-slate-600 line-clamp-2">${escapeHtml(hl.description || '')}</p>
                    <p class="text-[10px] text-slate-500">${[hl.meals, hl.transport].filter(Boolean).join(' · ') || 'See operator itinerary'}</p>
                    <div class="mt-auto pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                        <div>
                            <div class="text-xs font-extrabold text-slate-900">${escapeHtml(formatKes(hl.priceKes))}</div>
                            <div class="text-[10px] text-slate-500">${escapeHtml(hl.priceLabel)}</div>
                        </div>
                        <div class="flex items-center gap-1.5">
                            ${canBuyHere ? `<button type="button" data-buy-holiday class="px-3 py-1.5 rounded-lg bg-[#15803D] hover:bg-[#166534] text-white text-xs font-bold">Buy Tickets</button>` : ''}
                            ${hl.bookingUrl ? `<a href="${escapeHtml(hl.bookingUrl)}" target="_blank" rel="noopener noreferrer" class="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold">View Deal ↗</a>` : ''}
                        </div>
                    </div>
                    <div class="text-[10px] text-slate-400">Operator: ${escapeHtml(hl.provider)} · Verified ${escapeHtml(formatDate(hl.lastVerifiedAt))}</div>
                </div>
            `;
            const buyBtn = card.querySelector('[data-buy-holiday]');
            if (buyBtn) {
                buyBtn.addEventListener('click', () => window.openCustomHolidayBookingModal(hl));
            }
            grid.append(card);
        }
    }

    async function init() {
        await loadMeta();
        await Promise.all([loadEventsSection(), loadFlightsSection(), loadHolidaysSection()]);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => void init());
    } else {
        void init();
    }
})();
