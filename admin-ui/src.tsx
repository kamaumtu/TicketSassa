import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

type Tier = { tierKey: string; title: string; priceKes: number; remainingAllocation: number; sold: number };
type Event = { id: string; title: string; venue: string; startsAt: string; image?: string; status?: string; tiers: Tier[] };
type Order = { orderReference: string; customer: { name: string; email: string }; items: { title: string; quantity: number; kind: string }[]; totalTickets: number; totalKes: number; paymentStatus: string; paidAt?: string; provider?: string };
type Import = { id: string; title: string; venue: string; startsAt: string; source?: string; ticketStatus: string; startingPrice: number | null; priceSource?: string; priceCheckedAt?: string };
type Audit = { action: string; target: string; timestamp: string };
type PaymentSettings = { provider: string | null; options: { id: string; name: string; configured: boolean }[] };
type TicketRevenue = { todayKes: number; weekKes: number; totalKes: number; undatedPayments: number };
type Imports = { events: Import[]; allocationStatus: string; updatedAt: string | null; providerStatuses: Record<string, string> };
type SyncRun = { id: string; startedAt: string; finishedAt?: string; trigger: string; stage: string; allocationStatus?: string;
    sources: Record<string, { status: string; count: number; removed: number; priced?: number }> };
type Lobby = Imports & { activeRun: SyncRun | null; nextRunAt: string | null; history: SyncRun[] };
type Data = { storageAvailable: boolean; payments: PaymentSettings; ticketRevenue: TicketRevenue; events: Event[]; orders: Order[]; imports: Imports };

const sections = ['Overview', 'Kenya discovery', 'Events', 'Publishing lobby', 'Travel lobby', 'Tickets', 'Customers', 'Transactions', 'Payment settings', 'Audit log'] as const;
type Section = typeof sections[number];
type DepositAlert = { id: string; orderReference: string; customerName: string; customerPhone: string; totalKes: number; provider: string; mode: string; itemsSummary: string; initiatedAt: string };
type DiscoveryTicket = { name: string; priceKes: number; gate: string; note: string };
type DiscoveryItem = { id: string; kind: 'event' | 'flight' | 'holiday'; title: string; venue: string; region: string; startsAt: string; source: string; imageUrl: string; coverImageUrl?: string; pricingMode: 'live' | 'advertised' | 'estimated'; startingPriceKes: number | null; tickets: DiscoveryTicket[] };
type DiscoveryData = { scannedAt: string; regions: string[]; summary: { eventsCount: number; flightsCount: number; holidaysCount: number; regionsCovered: number }; events: DiscoveryItem[]; flights: DiscoveryItem[]; holidays: DiscoveryItem[] };

let sharedAudioCtx: AudioContext | null = null;
function playDepositChime() {
    try {
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtx) return;
        if (!sharedAudioCtx) sharedAudioCtx = new AudioCtx();
        if (sharedAudioCtx.state === 'suspended') void sharedAudioCtx.resume();
        const now = sharedAudioCtx.currentTime;
        const notes = [880, 1108.73, 1318.51]; // A5 -> C#6 -> E6 bright chime
        notes.forEach((freq, idx) => {
            const osc = sharedAudioCtx!.createOscillator();
            const gain = sharedAudioCtx!.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, now + idx * 0.11);
            gain.gain.setValueAtTime(0.001, now + idx * 0.11);
            gain.gain.exponentialRampToValueAtTime(0.24, now + idx * 0.11 + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.11 + 0.35);
            osc.connect(gain);
            gain.connect(sharedAudioCtx!.destination);
            osc.start(now + idx * 0.11);
            osc.stop(now + idx * 0.11 + 0.38);
        });
    } catch {
        // Browser may block audio until first user gesture
    }
}

function escapeHtml(value: string) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] || ch));
}

function printDiscoveryTickets(items: DiscoveryItem[], heading: string) {
    const win = window.open('', '_blank', 'width=960,height=780');
    if (!win) return;
    const cards = items.map(item => {
        const rows = item.tickets.map(t => `
            <tr>
                <td><strong>${escapeHtml(t.name)}</strong><br><small>${escapeHtml(t.note)}</small></td>
                <td>${escapeHtml(t.gate)}</td>
                <td style="text-align:right;font-weight:700">${escapeHtml(money(t.priceKes))}</td>
            </tr>`).join('');
        const imgSrc = item.coverImageUrl || item.imageUrl;
        return `
        <article class="ticket-sheet-card">
            <div class="ticket-head">
                <img src="${escapeHtml(imgSrc)}" alt="" onerror="this.src='/assets/real/DzLV4G9UWo-1790859483.jpg'" />
                <div>
                    <span class="badge">${escapeHtml(item.kind.toUpperCase())} · ${escapeHtml(item.region)} · ${escapeHtml(item.pricingMode.toUpperCase())}</span>
                    <h2>${escapeHtml(item.title)}</h2>
                    <p>${escapeHtml(item.venue)} · ${escapeHtml(date(item.startsAt))}</p>
                    <small>Source: ${escapeHtml(item.source)} · Ref: ${escapeHtml(item.id)}</small>
                </div>
            </div>
            <table>
                <thead><tr><th>Ticket / Fare Tier</th><th>Gate / Check-in</th><th style="text-align:right">Price (KES)</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </article>`;
    }).join('');
    win.document.write(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(heading)} · Ticketsasa</title>
        <style>
            body{font:14px/1.45 system-ui,-apple-system,sans-serif;color:#0f172a;margin:24px;background:#fff}
            header{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #D81A21;padding-bottom:12px;margin-bottom:20px}
            h1{margin:0;font-size:20px}
            .ticket-sheet-card{border:1px solid #cbd5e1;border-radius:10px;padding:16px;margin-bottom:18px;page-break-inside:avoid}
            .ticket-head{display:flex;gap:14px;align-items:center;margin-bottom:12px}
            .ticket-head img{width:88px;height:88px;object-fit:cover;border-radius:8px;border:1px solid #e2e8f0;background:#f8fafc}
            .ticket-head h2{margin:4px 0;font-size:16px}
            .ticket-head p{margin:2px 0;color:#475569;font-size:13px}
            .badge{display:inline-block;background:#fee2e2;color:#991b1b;font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px}
            table{width:100%;border-collapse:collapse;font-size:13px}
            th,td{padding:8px 10px;border-top:1px solid #e2e8f0;text-align:left}
            th{background:#f8fafc;font-size:12px;text-transform:uppercase;color:#475569}
            @media print{.no-print{display:none}body{margin:8px}}
        </style></head><body>
        <header><div><h1>Ticketsasa Kenya — ${escapeHtml(heading)}</h1><small>Generated ${escapeHtml(new Date().toLocaleString('en-KE'))} · ${items.length} listing(s)</small></div>
        <button class="no-print" onclick="window.print()" style="background:#D81A21;color:#fff;border:0;padding:8px 16px;border-radius:6px;font-weight:700;cursor:pointer">Print</button></header>
        ${cards}
        </body></html>`);
    win.document.close();
    setTimeout(() => win.print(), 350);
}
const paymentLabels: Record<string, string> = {
    COMPLETED: 'Completed', FAILED: 'Failed', PROCESSING: 'Awaiting confirmation', PENDING: 'Awaiting payment'
};
const paymentLabel = (status: string) => paymentLabels[status] ?? status;

function PaymentBadge({ status }: { status: string }) {
    return <span className="payment-badge" data-status={status}>{paymentLabel(status)}</span>;
}
const money = (value: number) => new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(value);
const date = (value: string) => new Intl.DateTimeFormat('en-KE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Nairobi' }).format(new Date(value));

async function request<T>(path: string, method = 'GET', body?: object, signal?: AbortSignal): Promise<T> {
    const response = await fetch('/api/admin' + path, {
        method, credentials: 'same-origin', signal,
        headers: method === 'GET' ? undefined : { 'Content-Type': 'application/json', 'X-Admin-Action': 'dashboard' },
        body: body ? JSON.stringify(body) : undefined
    });
    if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.message || ('Request failed (' + response.status + ')'));
    }
    return response.json();
}

const sourceLabels: Record<string, string> = { soldoutafrica: 'SoldOut Africa', quicket: 'Quicket Kenya', ticketsdev: 'Tickets.dev', tkt: 'TKT', egotickets: 'eGotickets' };
const syncLabels: Record<string, string> = { live: 'Connected', stale: 'Using last import', checking: 'Checking', unconfigured: 'Setup required',
    unavailable: 'Unavailable', 'database-offline': 'Database offline', pending: 'Waiting for first sync',
    startup: 'Server startup', 'database-ready': 'Database connected', scheduled: 'Scheduled', manual: 'Manual' };
const saleLabels: Record<string, string> = { 'on-sale': 'On sale', 'awaiting-allocation': 'Awaiting supplier inventory', paused: 'Paused by admin',
    'allocation-expired': 'Supplier inventory expired or withdrawn', scheduled: 'Sale scheduled', 'sales-closed': 'Sales window closed',
    'no-allocation-left': 'No supplier allocation left' };

function PublishingLobby() {
    const [lobby, setLobby] = useState<Lobby>();
    const [error, setError] = useState('');
    const [syncing, setSyncing] = useState(false);
    const [search, setSearch] = useState('');
    const [saleStatus, setSaleStatus] = useState('all');

    useEffect(() => {
        const controller = new AbortController();
        let pending = false;
        async function poll() {
            if (document.hidden || pending) return;
            pending = true;
            try {
                setLobby(await request<Lobby>('/imports/lobby', 'GET', undefined, controller.signal));
                setError('');
            } catch (err) {
                if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Could not load publishing activity.');
            } finally { pending = false; }
        }
        void poll();
        const interval = window.setInterval(poll, 5000);
        return () => { controller.abort(); window.clearInterval(interval); };
    }, []);

    async function sync() {
        setSyncing(true);
        setError('');
        try { setLobby(await request<Lobby>('/imports/sync', 'POST', {})); }
        catch (err) { setError(err instanceof Error ? err.message : 'Could not run sync.'); }
        finally { setSyncing(false); }
    }

    if (!lobby) return <p className="panel" role="status">{error || 'Loading publishing activity…'}</p>;
    const onSale = lobby.events.filter(event => event.ticketStatus === 'on-sale').length;
    const visible = lobby.events.filter(event => (saleStatus === 'all' || event.ticketStatus === saleStatus) &&
        [event.title, event.venue, event.source].join(' ').toLowerCase().includes(search.trim().toLowerCase()));
    const activity = lobby.activeRun;
    return <div className="publishing-lobby">
        {error && <p className="notice" role="status">{error}</p>}
        <section className="panel">
            <div className="lobby-toolbar"><div><h2>{activity?.stage ?? (syncing ? 'Starting sync' : 'Sync status')}</h2>
                <p role="status">{activity ? `Started ${date(activity.startedAt)}` : `Next scheduled run ${lobby.nextRunAt ? date(lobby.nextRunAt) : 'unavailable'}`}</p></div>
                <button className="primary" disabled={syncing || Boolean(activity)} onClick={() => void sync()}>Sync now</button></div>
            <dl className="lobby-summary">
                <div><dt>Imported events</dt><dd>{lobby.events.length}</dd></div><div><dt>On sale</dt><dd>{onSale}</dd></div>
                <div><dt>Listings with prices</dt><dd>{lobby.events.filter(event => event.startingPrice != null).length}</dd></div>
                <div><dt>Supplier inventory feed</dt><dd>{syncLabels[lobby.allocationStatus] ?? lobby.allocationStatus}</dd></div>
                <div><dt>Last successful source refresh</dt><dd>{lobby.updatedAt ? date(lobby.updatedAt) : 'Unavailable'}</dd></div>
            </dl>
            <ul className="lobby-sources">{Object.entries(lobby.providerStatuses).map(([id, status]) => {
                const current = activity?.sources[id];
                return <li key={id}><strong>{sourceLabels[id] ?? id}</strong><span className="sync-badge" data-state={current?.status ?? status}>{syncLabels[current?.status ?? status] ?? status}{current?.status === 'live' ? ` · ${current.count} listings` : ''}</span></li>;
            })}</ul>
        </section>
        <section className="panel"><h2>Event decisions</h2>
            <div className="actions"><input aria-label="Search imported events" placeholder="Search title, venue or source" value={search} onChange={event => setSearch(event.target.value)}/>
                <select aria-label="Filter by ticket status" value={saleStatus} onChange={event => setSaleStatus(event.target.value)}><option value="all">All statuses</option>{Object.entries(saleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
            {visible.length ? <div className="scroll lobby-events"><table><thead><tr><th>Event</th><th>Source</th><th>Starts (EAT)</th><th>Price from</th><th>Ticket decision</th></tr></thead>
                <tbody>{visible.map(event => <tr key={event.id}><td><a href={'/?view=events&event=' + encodeURIComponent(event.id)}>{event.title}</a><small>{event.venue}</small></td><td>{event.source}</td><td>{date(event.startsAt)}</td>
                    <td>{event.startingPrice == null ? 'Unavailable' : money(event.startingPrice)}{event.priceSource && <small><a href={event.priceSource} target="_blank" rel="noreferrer">Advertised price source</a>{event.priceCheckedAt && ` · ${date(event.priceCheckedAt)}`}</small>}</td><td><span className="sync-badge" data-state={event.ticketStatus}>{saleLabels[event.ticketStatus]}</span></td></tr>)}</tbody></table></div> : <p>No imported events match this view.</p>}
        </section>
        <section className="panel"><h2>Recent sync runs</h2>{lobby.history.length ? lobby.history.map(run => <details className="sync-run" key={run.id}>
            <summary>{date(run.startedAt)} · {syncLabels[run.trigger] ?? run.trigger} · Supplier inventory {syncLabels[run.allocationStatus ?? 'pending']?.toLowerCase()}</summary>
            {run.finishedAt && <p>Finished {date(run.finishedAt)}</p>}
            <ul>{Object.entries(run.sources).map(([id, source]) => <li key={id}>{sourceLabels[id] ?? id} · {syncLabels[source.status] ?? source.status}{source.status === 'live' ? ` · ${source.count} synced · ${source.removed} removed${source.priced == null ? '' : ` · ${source.priced} priced`}` : ''}</li>)}</ul>
        </details>) : <p>No completed runs have been saved yet.</p>}</section>
    </div>;
}

function exportOrders(orders: Order[]) {
    const quote = (value: string | number) => '"' + String(value).replace(/^([=+@-]|\s)/, "'$1").replaceAll('"', '""') + '"';
    const rows = [['Reference', 'Status', 'Tickets', 'Total KES'], ...orders.map(order =>
        [order.orderReference, order.paymentStatus, order.totalTickets, order.totalKes])];
    const url = URL.createObjectURL(new Blob([rows.map(row => row.map(quote).join(',')).join('\r\n')], { type: 'text/csv' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'transactions.csv';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type TravelOffer = { id: string; kind: string; title: string; supplier: string; status: string; priceKes: number; available: number; startsAt: string; checkedAt: string };
type TravelLobbyData = { stage: string; storageAvailable: boolean; nextRunAt: string | null; offers: TravelOffer[];
    reservations: { orderReference: string; kind: string; title: string; status: string; totalKes: number; createdAt: string; confirmationCode?: string }[];
    configuration: Record<string, { feedConfigured: boolean; bookingConfigured: boolean }>;
    sources: Record<string, { status: string; count: number; available?: number; rejected?: number; message?: string }>;
    history: { _id: string; startedAt: string; finishedAt: string; trigger: string; sources: Record<string, { status: string; count: number }> }[] };
function TravelLobby() {
    const [data, setData] = useState<TravelLobbyData>();
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [kind, setKind] = useState('all');
    async function load() { setData(await request<TravelLobbyData>('/travel/lobby')); }
    useEffect(() => {
        let active = true;
        const refresh = () => request<TravelLobbyData>('/travel/lobby').then(value => { if (active) { setData(value); setError(''); } }).catch(err => { if (active) setError(err.message); });
        void refresh(); const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 5000);
        return () => { active = false; window.clearInterval(timer); };
    }, []);
    return <div className="publishing-lobby">
        <section className="panel"><div className="section-heading"><div><h2>Holiday and flight publishing</h2>
            <p>Offers refresh automatically every 15 minutes. Prices, dates and supplier holds control availability.</p></div>
            <button className="primary" disabled={busy} onClick={async () => { setBusy(true); setError(''); try { await request('/travel/sync', 'POST'); await load(); } catch (err) { setError(err instanceof Error ? err.message : 'Sync failed.'); } finally { setBusy(false); } }}>{busy ? 'Syncing…' : 'Sync now'}</button></div>
            {error && <p role="alert">{error}</p>}
            {data && <><p role="status">{data.storageAvailable ? `System ${data.stage}` : 'Database offline. Publishing and bookings will resume after reconnection.'}{data.nextRunAt && ` · Next refresh ${date(data.nextRunAt)}`}</p>
                <div className="lobby-metrics">{['flight', 'holiday'].map(key => <div key={key}><h3>{key === 'flight' ? 'Flights' : 'Holidays'}</h3>
                    <p>{data.sources[key]?.status.replaceAll('_', ' ') || 'Waiting for sync'}</p>
                    <p>{data.sources[key]?.available || 0} bookable · {data.sources[key]?.count || 0} imported</p>
                    <p>Offers feed {data.configuration[key]?.feedConfigured ? 'configured' : 'needs setup'} · Booking connection {data.configuration[key]?.bookingConfigured ? 'configured' : 'needs setup'}</p>
                    {data.sources[key]?.message && <p>{data.sources[key].message}</p>}</div>)}</div></>}
        </section>
        <section className="panel"><h2>Offer decisions</h2><select aria-label="Travel type" value={kind} onChange={e => setKind(e.target.value)}><option value="all">Flights and holidays</option><option value="flight">Flights</option><option value="holiday">Holidays</option></select>
            <div className="table-wrap"><table><thead><tr><th>Offer</th><th>Supplier</th><th>Departure / check-in</th><th>Price</th><th>Availability</th><th>Last checked</th></tr></thead>
                <tbody>{data?.offers.filter(o => kind === 'all' || o.kind === kind).map(o => <tr key={o.id}><td>{o.title}<small>{o.kind}</small></td><td>{o.supplier}</td><td>{date(o.startsAt)}</td><td>{money(o.priceKes)}</td><td>{o.status.replaceAll('_', ' ')} · {o.available} remaining</td><td>{date(o.checkedAt)}</td></tr>)}</tbody></table></div>
            {!data?.offers.length && <p>No supplier offers imported yet. The system publishes valid offers automatically once the feeds are connected.</p>}
        </section>
        <section className="panel"><h2>Recent supplier reservations</h2><div className="table-wrap"><table><thead><tr><th>Order</th><th>Trip</th><th>Supplier status</th><th>Total</th><th>Confirmation</th></tr></thead><tbody>{data?.reservations.map(row => <tr key={row.orderReference}><td>{row.orderReference}</td><td>{row.title}<small>{row.kind}</small></td><td>{row.status.replaceAll('_', ' ')}</td><td>{money(row.totalKes)}</td><td>{row.confirmationCode || 'Pending'}</td></tr>)}</tbody></table></div><p>Payment status is tracked separately in Transactions. Supplier confirmation may follow payment.</p></section>
        <section className="panel"><h2>Activity history</h2>{data?.history.map(run => <p key={run._id}>{date(run.startedAt)} · {run.trigger} · {Object.entries(run.sources).map(([key, source]) => `${key}: ${source.status.replaceAll('_', ' ')} (${source.count})`).join(' · ')}</p>)}</section>
    </div>;
}

function KenyaDiscovery() {
    const [discovery, setDiscovery] = useState<DiscoveryData>();
    const [error, setError] = useState('');
    const [scanning, setScanning] = useState(false);
    const [kind, setKind] = useState<'all' | 'event' | 'flight' | 'holiday'>('all');
    const [region, setRegion] = useState('all');
    const [search, setSearch] = useState('');

    async function loadDiscovery() {
        try {
            setDiscovery(await request<DiscoveryData>('/discovery'));
            setError('');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not load Kenya discovery feed.');
        }
    }

    async function scanNow() {
        setScanning(true);
        setError('');
        try {
            setDiscovery(await request<DiscoveryData>('/discovery/scan', 'POST', {}));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Kenya discovery scan failed.');
        } finally {
            setScanning(false);
        }
    }

    useEffect(() => {
        void loadDiscovery();
        const timer = window.setInterval(() => {
            if (!document.hidden) void loadDiscovery();
        }, 5 * 60 * 1000);
        return () => window.clearInterval(timer);
    }, []);

    if (!discovery) return <p className="panel" role="status">{error || 'Scanning events, flights and holidays across Kenya…'}</p>;

    const allItems: DiscoveryItem[] = [
        ...(kind === 'all' || kind === 'event' ? discovery.events : []),
        ...(kind === 'all' || kind === 'flight' ? discovery.flights : []),
        ...(kind === 'all' || kind === 'holiday' ? discovery.holidays : [])
    ];
    const q = search.trim().toLowerCase();
    const visible = allItems.filter(item =>
        (region === 'all' || item.region === region) &&
        (!q || [item.title, item.venue, item.region, item.source].join(' ').toLowerCase().includes(q))
    );

    return <div className="publishing-lobby">
        {error && <p className="notice" role="status">{error}</p>}
        <section className="panel">
            <div className="lobby-toolbar">
                <div>
                    <h2>Automatic Kenya Events, Flights &amp; Holidays Discovery</h2>
                    <p role="status">Last scanned {date(discovery.scannedAt)} · Covers {discovery.summary.regionsCovered} Kenyan regions · Auto-refreshes every 5 minutes</p>
                </div>
                <div className="actions">
                    <button className="primary" disabled={scanning} onClick={() => void scanNow()}>{scanning ? 'Scanning Kenya…' : 'Scan Kenya now'}</button>
                    <button disabled={!visible.length} onClick={() => printDiscoveryTickets(visible, 'Kenya Ticket & Price Sheet')}>Print all ({visible.length})</button>
                </div>
            </div>
            <dl className="lobby-summary">
                <div><dt>Kenya events</dt><dd>{discovery.summary.eventsCount}</dd></div>
                <div><dt>Kenya flights</dt><dd>{discovery.summary.flightsCount}</dd></div>
                <div><dt>Kenya holidays</dt><dd>{discovery.summary.holidaysCount}</dd></div>
                <div><dt>Regions covered</dt><dd>{discovery.summary.regionsCovered}</dd></div>
            </dl>
            <div className="actions" style={{ marginTop: 12 }}>
                <input aria-label="Search Kenya discovery" placeholder="Search event, route, resort or county…" value={search} onChange={e => setSearch(e.target.value)} />
                <select aria-label="Filter category" value={kind} onChange={e => setKind(e.target.value as 'all' | 'event' | 'flight' | 'holiday')}>
                    <option value="all">All (Events, Flights &amp; Holidays)</option>
                    <option value="event">Events ({discovery.summary.eventsCount})</option>
                    <option value="flight">Flights ({discovery.summary.flightsCount})</option>
                    <option value="holiday">Holidays ({discovery.summary.holidaysCount})</option>
                </select>
                <select aria-label="Filter Kenyan region" value={region} onChange={e => setRegion(e.target.value)}>
                    <option value="all">All Kenya regions</option>
                    {discovery.regions.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
            </div>
        </section>
        <section className="discovery-grid">
            {visible.map(item => <article className="panel discovery-card" key={item.id}>
                <div className="discovery-media">
                    <img src={item.coverImageUrl || item.imageUrl} alt={item.title} loading="lazy"
                        onError={e => { (e.currentTarget as HTMLImageElement).src = '/assets/real/DzLV4G9UWo-1790859483.jpg'; }} />
                    <span className="discovery-badge" data-kind={item.kind}>{item.kind} · {item.region}</span>
                    <span className="discovery-price-mode" data-mode={item.pricingMode}>{item.pricingMode}</span>
                </div>
                <div className="discovery-body">
                    <div className="discovery-title-row">
                        {item.kind === 'flight' && <img className="airline-logo" src={item.imageUrl} alt={item.source} />}
                        <h3>{item.title}</h3>
                    </div>
                    <p className="discovery-meta">{item.venue}</p>
                    <p className="discovery-meta">{date(item.startsAt)} · {item.source}</p>
                    <ul className="discovery-tiers">
                        {item.tickets.map((t, idx) => <li key={idx}>
                            <span><strong>{t.name}</strong> <small>({t.gate})</small></span>
                            <strong>{money(t.priceKes)}</strong>
                        </li>)}
                    </ul>
                    <div className="actions">
                        <button className="primary" onClick={() => printDiscoveryTickets([item], item.title)}>Print tickets</button>
                    </div>
                </div>
            </article>)}
            {!visible.length && <p className="panel">No Kenya events, flights, or holidays match this filter.</p>}
        </section>
    </div>;
}

function App() {
    const [section, setSection] = useState<Section>(
        location.pathname === '/admin/travel' ? 'Travel lobby'
            : location.pathname === '/admin/publishing' ? 'Publishing lobby'
            : location.pathname === '/admin/discovery' ? 'Kenya discovery'
            : 'Overview'
    );
    const inLobby = section === 'Publishing lobby' || section === 'Travel lobby' || section === 'Kenya discovery';
    const [data, setData] = useState<Data>();
    const [audit, setAudit] = useState<Audit[]>([]);
    const [query, setQuery] = useState('');
    const [status, setStatus] = useState('all');
    const [page, setPage] = useState(0);
    const [selected, setSelected] = useState<Order>();
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState('');
    const [dark, setDark] = useState(false);
    const [collapsed, setCollapsed] = useState(false);
    const [soundEnabled, setSoundEnabled] = useState(true);
    const [depositAlert, setDepositAlert] = useState<DepositAlert | null>(null);
    const soundEnabledRef = React.useRef(soundEnabled);
    soundEnabledRef.current = soundEnabled;

    useEffect(() => {
        const source = new EventSource('/api/admin/deposits/stream', { withCredentials: true });
        source.addEventListener('deposit_initiated', (event) => {
            try {
                const payload = JSON.parse((event as MessageEvent).data) as DepositAlert;
                setDepositAlert(payload);
                if (soundEnabledRef.current) playDepositChime();
            } catch {}
        });
        return () => source.close();
    }, []);

    async function load() {
        const [overview, logs] = await Promise.all([request<Data>('/overview'), request<{ data: Audit[] }>('/audit')]);
        setData(overview);
        setAudit(logs.data);
        setSelected(current => current && overview.orders.find(order => order.orderReference === current.orderReference));
    }

    async function run(action: () => Promise<void>) {
        setBusy(true);
        setNotice('');
        try { await action(); } catch (error) { setNotice(error instanceof Error ? error.message : 'Request failed.'); }
        finally { setBusy(false); }
    }

    useEffect(() => {
        if (inLobby) return;
        void run(load);
        const interval = window.setInterval(() => {
            if (!document.hidden) void load().catch(() => {});
        }, 30000);
        return () => window.clearInterval(interval);
    }, [inLobby]);

    const events = data?.events ?? [];
    const orders = data?.orders ?? [];
    const completed = orders.filter(order => order.paymentStatus === 'COMPLETED');
    const customers = [...new Map(orders.map(order => [order.customer.email, order.customer])).values()];
    const matches = (...values: string[]) => values.join(' ').toLowerCase().includes(query.trim().toLowerCase());
    const eventStatus = (event: Event) => event.status || 'published';
    const filteredEvents = events.filter(event => matches(event.title, event.venue) && (status === 'all' || eventStatus(event) === status));
    const filteredOrders = orders.filter(order => matches(order.orderReference, order.customer.email, order.paymentStatus));
    const eventPage = Math.min(page, Math.max(0, Math.ceil(filteredEvents.length / 10) - 1));

    return <div className={dark ? 'shell dark' : 'shell'}>
        <aside className={collapsed ? 'sidebar collapsed' : 'sidebar'}>
            <div className="brand"><strong>Ticketsassa</strong><span>Administration</span></div>
            <button className="menu" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed}>{collapsed ? 'Show menu' : 'Hide menu'}</button>
            <nav aria-label="Admin navigation">{sections.map(item => item === 'Publishing lobby' || item === 'Travel lobby'
                ? <a key={item} href={item === 'Travel lobby' ? '/admin/travel' : '/admin/publishing'} aria-current={section === item ? 'page' : undefined}>{item}</a>
                : <button key={item} aria-current={section === item ? 'page' : undefined} onClick={() => {
                if (inLobby) history.replaceState(null, '', '/admin');
                setSection(item); setQuery(''); setStatus('all'); setPage(0); setSelected(undefined);
            }}>{item}</button>)}</nav>
            <a href="/">Back to storefront</a>
        </aside>
        <main>
            <header><div><p className="eyebrow">Ticketing operations</p><h1>{section}</h1></div>
                <div className="actions">
                <button onClick={() => {
                    const next = !soundEnabled;
                    setSoundEnabled(next);
                    if (next) playDepositChime();
                }}>{soundEnabled ? 'Deposit sound: ON' : 'Deposit sound: Muted'}</button>
                <button onClick={() => playDepositChime()}>Test sound</button>
                <button onClick={() => setDark(!dark)}>{dark ? 'Light mode' : 'Dark mode'}</button>
                {!inLobby && <button disabled={busy} onClick={() => void run(load)}>Refresh</button>}
                <a className="primary" href="/organizer">Publish an event</a></div>
            </header>
            {depositAlert && <div className="deposit-banner" role="alert">
                <div>
                    <strong>Incoming M-Pesa Deposit Initiated!</strong>
                    <span>{depositAlert.customerName} ({depositAlert.customerPhone}) · {money(depositAlert.totalKes)} · {depositAlert.orderReference} · {depositAlert.itemsSummary}</span>
                </div>
                <div className="actions">
                    <button className="primary" onClick={() => { setSection('Transactions'); setQuery(depositAlert.orderReference); setDepositAlert(null); }}>View order</button>
                    <button onClick={() => setDepositAlert(null)}>Dismiss</button>
                </div>
            </div>}
            {notice && <p className="notice" role="status">{notice}</p>}
            {data && !data.storageAvailable && !inLobby && <p className="notice" role="status">Database connection unavailable. Stored events, orders, revenue and account changes will return when Atlas reconnects. <a href="/admin/publishing">View source activity</a></p>}
            {section === 'Kenya discovery' && <KenyaDiscovery />}
            {section === 'Publishing lobby' && <PublishingLobby />}
            {section === 'Travel lobby' && <TravelLobby />}
            {!inLobby && !data && <p className="panel" role="status">{busy ? 'Loading dashboard…' : 'Dashboard data unavailable.'}</p>}
            {data && section === 'Overview' && <>
                <div className="metrics">{[
                    ['Ticket revenue today (EAT)', data.storageAvailable ? money(data.ticketRevenue.todayKes) : 'Unavailable'],
                    ['Ticket revenue this week (EAT)', data.storageAvailable ? money(data.ticketRevenue.weekKes) : 'Unavailable'],
                    ['Organizer events', events.length],
                    ['Published events', events.filter(event => eventStatus(event) === 'published').length],
                    ['Upcoming events', events.filter(event => Date.parse(event.startsAt) > Date.now()).length],
                    ['Expired events', events.filter(event => Date.parse(event.startsAt) <= Date.now()).length],
                    ['Verified live tickets sold', completed.reduce((sum, order) => sum + order.totalTickets, 0)],
                    ['Verified ticket revenue', data.storageAvailable ? money(data.ticketRevenue.totalKes) : 'Unavailable'],
                    ['Customers with orders', customers.length],
                    ['Discovered events', data.imports.events.length]
                ].map(([label, value]) => <article key={label}><span>{label}</span><strong>{value}</strong></article>)}</div>
                {data.ticketRevenue.undatedPayments > 0 && <p className="notice" role="note">
                    {data.ticketRevenue.undatedPayments} older payment(s) have no recorded confirmation date and are excluded from daily and weekly totals.
                </p>}
                <section className="panel"><h2>Recent orders</h2>{orders.length ? orders.slice(0, 5).map(order =>
                    <p className="recent-order" key={order.orderReference}><strong>{order.customer.name}</strong><span>{money(order.totalKes)}</span><PaymentBadge status={order.paymentStatus}/></p>)
                    : <p>No live orders yet.</p>}</section>
            </>}
            {data && section === 'Events' && <section className="panel">
                <div className="actions"><input aria-label="Search events" placeholder="Search name or venue" value={query} onChange={event => {setQuery(event.target.value); setPage(0);}}/>
                <select aria-label="Event status" value={status} onChange={event => {setStatus(event.target.value); setPage(0);}}>
                    <option value="all">All statuses</option><option>published</option><option>unpublished</option><option>archived</option>
                </select></div>
                <div className="scroll"><table><thead><tr><th>Event</th><th>Venue</th><th>Starts</th><th>Status</th><th>Actions</th></tr></thead>
                    <tbody>{filteredEvents.slice(eventPage * 10, eventPage * 10 + 10).map(event => <tr key={event.id}>
                        <td>{event.image && <img src={event.image} alt="" />}{event.title}</td><td>{event.venue}</td><td>{date(event.startsAt)}</td><td>{eventStatus(event)}</td>
                        <td className="actions">{['published', 'unpublished', 'archived'].filter(next => next !== eventStatus(event)).map(next =>
                            <button key={next} disabled={busy} onClick={() => void run(async () => {
                                await request('/events/' + encodeURIComponent(event.id), 'PATCH', { status: next }); await load(); setNotice('Event status updated.');
                            })}>{({ published: 'Publish', unpublished: 'Unpublish', archived: 'Archive' })[next]}</button>)}</td>
                    </tr>)}</tbody></table></div>
                {!filteredEvents.length && <p>No matching events.</p>}
                <div className="actions"><button disabled={eventPage === 0} onClick={() => setPage(eventPage - 1)}>Previous</button><span>Page {eventPage + 1}</span>
                <button disabled={(eventPage + 1) * 10 >= filteredEvents.length} onClick={() => setPage(eventPage + 1)}>Next</button></div>
            </section>}
            {data && section === 'Tickets' && <section className="panel"><h2>Inventory by tier</h2>
                {events.length ? <div className="scroll"><table><thead><tr><th>Event</th><th>Tier</th><th>Price</th><th>Live tickets sold</th><th>Configured capacity</th></tr></thead>
                <tbody>{events.flatMap(event => event.tiers.map(tier => <tr key={tier.tierKey}><td>{event.title}</td><td>{tier.title}</td><td>{money(tier.priceKes)}</td><td>{tier.sold}</td><td>{tier.remainingAllocation}</td></tr>))}</tbody></table></div> : <p>Publish an event to create ticket tiers.</p>}
                <p><a href="/staff/check-in">Open staff check-in</a></p>
            </section>}
            {data && section === 'Customers' && <section className="panel"><input aria-label="Search customers" placeholder="Search name or email" value={query} onChange={event => setQuery(event.target.value)}/>
                {!customers.some(customer => matches(customer.name, customer.email)) && <p>No matching customers.</p>}
                <div className="scroll"><table><thead><tr><th>Name</th><th>Email</th><th>Orders</th></tr></thead><tbody>{customers.filter(customer => matches(customer.name, customer.email)).map(customer =>
                    <tr key={customer.email}><td>{customer.name}</td><td>{customer.email}</td><td><button onClick={() => {setSection('Transactions');setQuery(customer.email);}}>View orders</button></td></tr>)}</tbody></table></div>
            </section>}
            {data && section === 'Transactions' && <section className="panel"><div className="actions">
                <input aria-label="Search transactions" placeholder="Search reference, email or status" value={query} onChange={event => {setQuery(event.target.value);setSelected(undefined);}}/>
                <button disabled={!filteredOrders.length} onClick={() => exportOrders(filteredOrders)}>Download CSV</button></div>
                {!filteredOrders.length && <p>No matching live transactions.</p>}
                <div className="scroll"><table><thead><tr><th>Reference</th><th>Customer</th><th>Status</th><th>Total</th><th></th></tr></thead><tbody>{filteredOrders.map(order =>
                    <tr key={order.orderReference}><td>{order.orderReference}</td><td>{order.customer.name}</td><td><PaymentBadge status={order.paymentStatus}/></td>
                    <td>{money(order.totalKes)}</td><td><button onClick={() => setSelected(order)}>View order</button></td></tr>)}</tbody></table></div>
                {selected && <section className="detail"><h2>Order details</h2><p>{selected.customer.email}</p>
                    <p>Payment status: {paymentLabel(selected.paymentStatus)}{selected.paidAt ? ' · ' + date(selected.paidAt) : ''}</p>
                    <ul>{selected.items.map((item, index) => <li key={index}>{item.quantity} × {item.title}</li>)}</ul>{selected.paymentStatus === 'PROCESSING' && <button disabled={busy} onClick={() => void run(async () => {
                        const result = await request<{ paymentStatus: string }>(
                            '/orders/' + encodeURIComponent(selected.orderReference) + '/check-payment', 'POST');
                        setSelected({ ...selected, paymentStatus: result.paymentStatus });
                        setNotice('Payment status: ' + paymentLabel(result.paymentStatus));
                        await load();
                    })}>Check M-Pesa status</button>}<button onClick={() => setSelected(undefined)}>Close details</button></section>}
            </section>}
            {data && section === 'Payment settings' && <section className="panel">
                <h2>M-Pesa provider</h2>
                <p>Current provider: {data.payments.options.find(option => option.id === data.payments.provider)?.name ?? 'Unavailable'}</p>
                <div className="actions">
                    {data.payments.options.map(option => <button key={option.id}
                        disabled={busy || !data.storageAvailable || !option.configured || data.payments.provider === option.id}
                        onClick={() => void run(async () => {
                            const payments = await request<PaymentSettings>('/payments/settings', 'PUT', { provider: option.id });
                            setData(previous => previous && { ...previous, payments });
                            setNotice(option.name + ' will handle new M-Pesa requests.');
                        })}>
                        {option.name}{data.payments.provider === option.id ? ' (selected)' : !option.configured ? ' (setup required)' : ''}
                    </button>)}
                </div>
            </section>}
            {data && section === 'Audit log' && <section className="panel">{audit.length ? <div className="scroll"><table><thead><tr><th>Action</th><th>Event ID</th><th>Time</th></tr></thead><tbody>{audit.map((entry, index) =>
                <tr key={index}><td>{entry.action}</td><td>{entry.target}</td><td>{date(entry.timestamp)}</td></tr>)}</tbody></table></div> : <p>No event status changes recorded.</p>}</section>}
        </main>
    </div>;
}

createRoot(document.getElementById('root')!).render(<App />);
