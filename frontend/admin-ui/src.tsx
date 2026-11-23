import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io } from 'socket.io-client';
import './style.css';
import {
    autoRequest,
    AutomationOverview,
    EventDiscoveryPanel,
    TicketManagementPanel,
    FlightManagementPanel,
    HolidayPackagesPanel,
    PendingDepositsPanel,
    NotificationsPanel,
    DataSourcesPanel,
    AutomationSettingsPanel,
    ReportsPanel,
    SystemLogsPanel
} from './automationPanels';
import { DiscoveryCenterPanel } from './discoveryCenterPanel';
import { TravelOpsPanel } from './travelOpsPanel';

type Tier = { tierKey: string; title: string; priceKes: number; remainingAllocation: number; sold: number };
type Event = { id: string; title: string; venue: string; startsAt: string; image?: string; status?: string; tiers: Tier[] };
type Order = { orderReference: string; customer: { name: string; email: string }; items: { title: string; quantity: number; kind: string }[]; totalTickets: number; totalKes: number; paymentStatus: string; paidAt?: string; provider?: string; receipt?: string; failureReason?: string; failureCode?: string; failedAt?: string };
type Audit = { action: string; target: string; timestamp: string };
type PaymentSettings = { provider: string | null; storageAvailable: boolean; options: { id: string; name: string; configured: boolean }[] };
type TicketRevenue = { todayKes: number; weekKes: number; totalKes: number; undatedPayments: number };
type Data = { storageAvailable: boolean; payments: PaymentSettings; ticketRevenue: TicketRevenue; events: Event[]; orders: Order[] };

type DepositAlert = {
    _id?: string;
    reference: string;
    orderReference?: string;
    customerName: string;
    customerPhone: string;
    amountKes: number;
    method: string;
    status: string;
    initiatedAt: string;
};

const sections = [
    'Dashboard Overview',
    'Automated Discovery Center',
    'Event Discovery',
    'All Events',
    'Ticket Management',
    'Flight Discovery',
    'Flight Management',
    'Holiday Packages',
    'Travel Bookings',
    'Travel Fulfillment & Pricing',
    'Pending Deposits',
    'Transactions',
    'Payment settings',
    'Notifications',
    'Data Sources',
    'Automation Settings',
    'Reports',
    'System Logs'
] as const;
type Section = typeof sections[number];

const navGroups: { label: string; items: { id: Section; icon: string }[] }[] = [
    {
        label: 'Overview & Payments',
        items: [
            { id: 'Dashboard Overview', icon: '📊' },
            { id: 'Transactions', icon: '💳' },
            { id: 'Pending Deposits', icon: '🔔' },
            { id: 'Notifications', icon: '📬' },
            { id: 'Reports', icon: '📈' }
        ]
    },
    {
        label: 'Events & Tickets',
        items: [
            { id: 'All Events', icon: '🎟️' },
            { id: 'Event Discovery', icon: '🔎' },
            { id: 'Ticket Management', icon: '🎫' }
        ]
    },
    {
        label: 'Flights & Holidays',
        items: [
            { id: 'Travel Fulfillment & Pricing', icon: '✈️' },
            { id: 'Travel Bookings', icon: '🧳' },
            { id: 'Flight Discovery', icon: '🛫' },
            { id: 'Flight Management', icon: '🗺️' },
            { id: 'Holiday Packages', icon: '🏖️' }
        ]
    },
    {
        label: 'Settings & Automation',
        items: [
            { id: 'Automated Discovery Center', icon: '🤖' },
            { id: 'Payment settings', icon: '⚙️' },
            { id: 'Data Sources', icon: '🌐' },
            { id: 'Automation Settings', icon: '🛠️' },
            { id: 'System Logs', icon: '📜' }
        ]
    }
];

const paymentLabels: Record<string, string> = {
    COMPLETED: 'Completed', FAILED: 'Failed', PROCESSING: 'Awaiting confirmation', PENDING: 'Awaiting payment'
};
const paymentLabel = (status: string) => paymentLabels[status] ?? status;
const money = (value: number) => new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(value || 0);
const date = (value: string) => new Intl.DateTimeFormat('en-KE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Nairobi' }).format(new Date(value));

function PaymentBadge({ status }: { status: string }) {
    return <span className="payment-badge" data-status={status}>{paymentLabel(status)}</span>;
}

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

function PaymentSettingsPanel() {
    const [settings, setSettings] = useState<PaymentSettings>();
    const [selected, setSelected] = useState('');
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    async function load() {
        setBusy(true); setMessage('');
        try { const value = await request<PaymentSettings>('/payments/settings'); setSettings(value); setSelected(value.provider || ''); }
        catch (error) { setMessage(error instanceof Error ? error.message : 'Could not load payment settings.'); }
        finally { setBusy(false); }
    }
    useEffect(() => { void load(); }, []);
    return <section className="panel">
        <h2>M-Pesa payment provider</h2>
        <p>Choose which provider handles new customer payments. Customers receive an M-Pesa prompt automatically. Payments already started keep their original provider.</p>
        {settings && <form onSubmit={async event => {
            event.preventDefault(); if (busy || !settings.storageAvailable || !selected) return;
            setBusy(true); setMessage('');
            try {
                const saved = await request<PaymentSettings>('/payments/settings', 'PUT', { provider: selected });
                setSettings(saved); setSelected(saved.provider || '');
                setMessage(`${saved.options.find(option => option.id === saved.provider)?.name} saved for new M-Pesa payments.`);
            } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save payment settings.'); }
            finally { setBusy(false); }
        }}>
            <p><strong>Current provider:</strong> {settings.options.find(option => option.id === settings.provider)?.name || 'None selected'}</p>
            {!settings.storageAvailable && <p className="notice" role="status">Database offline. Reconnect and refresh before saving a provider.</p>}
            <fieldset disabled={busy || !settings.storageAvailable} style={{ border: 0, padding: '16px 0' }}>
                <legend>Choose a provider</legend>
                <div className="actions">{settings.options.filter(option => ['payhero', 'nexuspay'].includes(option.id)).map(option => <label key={option.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 16, border: '1px solid var(--border, #cbd5e1)', borderRadius: 12 }}>
                    <input type="radio" name="payment-provider" value={option.id} checked={selected === option.id} disabled={!option.configured}
                        onChange={() => { setSelected(option.id); setMessage(''); }} />
                    <span><strong>{option.name}</strong><small style={{ display: 'block' }}>{option.configured ? 'Configured' : 'Credentials needed in backend settings'}</small></span>
                </label>)}</div>
            </fieldset>
            <button className="primary" type="submit" disabled={busy || !settings.storageAvailable || !selected || selected === settings.provider}>{busy ? 'Saving…' : 'Save provider'}</button>
        </form>}
        <p role="status" aria-live="polite">{message || (!settings && busy ? 'Loading payment settings…' : '')}</p>
        <button type="button" disabled={busy} onClick={() => void load()}>Refresh settings</button>
    </section>;
}

let sharedAudioCtx: AudioContext | null = null;
async function ensureAudioContext() {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    if (!sharedAudioCtx) sharedAudioCtx = new AudioCtx();
    if (sharedAudioCtx.state === 'suspended') {
        await sharedAudioCtx.resume();
    }
    return sharedAudioCtx;
}

async function playToneSequence(notes: number[], { volume = 0.85, step = 0.13, duration = 0.36, wave = 'triangle' as OscillatorType } = {}) {
    try {
        const ctx = await ensureAudioContext();
        if (!ctx) return false;
        const now = ctx.currentTime + 0.02;
        const gainPeak = Math.max(0.08, Math.min(1, volume)) * 0.65;
        notes.forEach((freq, idx) => {
            const start = now + idx * step;
            const osc = ctx.createOscillator();
            const overtone = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = wave;
            overtone.type = 'sine';
            osc.frequency.setValueAtTime(freq, start);
            overtone.frequency.setValueAtTime(freq * 2, start);
            gain.gain.setValueAtTime(0.001, start);
            gain.gain.linearRampToValueAtTime(gainPeak, start + 0.015);
            gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
            osc.connect(gain);
            overtone.connect(gain);
            gain.connect(ctx.destination);
            osc.start(start);
            overtone.start(start);
            osc.stop(start + duration + 0.03);
            overtone.stop(start + duration + 0.03);
        });
        return true;
    } catch {
        return false;
    }
}

// Sound 1: Played once when a user initiates a deposit (stops automatically)
function playDepositInitiatedSound(volume = 0.85) {
    void playToneSequence([740, 987.77], { volume, step: 0.14, duration: 0.36, wave: 'triangle' });
}

// Sound 2: Played once when a payment succeeds (stops automatically)
function playDepositSuccessSound(volume = 0.85) {
    void playToneSequence([523.25, 659.25, 783.99, 1046.5], { volume, step: 0.11, duration: 0.45, wave: 'triangle' });
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

function TravelBookingsPanel() {
    const [data, setData] = useState<{ data: any[]; travelReservations: any[] }>();
    useEffect(() => { void autoRequest<{ data: any[]; travelReservations: any[] }>('/bookings').then(setData); }, []);
    return <section className="panel">
        <h2>Travel Bookings &amp; Supplier Reservations</h2>
        <div className="scroll"><table>
            <thead><tr><th>Order / Ref</th><th>Type</th><th>Title</th><th>Status</th><th>Total</th><th>Confirmation</th></tr></thead>
            <tbody>{(data?.travelReservations || []).map((r: any, idx: number) => <tr key={idx}>
                <td>{r.orderReference || r.reservationRef}</td><td>{r.kind}</td><td>{r.title || r.route || r.destination}</td>
                <td><PaymentBadge status={r.status} /></td><td>{money(r.totalKes)}</td><td>{r.confirmationCode || 'Pending'}</td>
            </tr>)}</tbody>
        </table></div>
        {!data?.travelReservations?.length && <p>No travel reservations recorded yet.</p>}
    </section>;
}

function App() {
    const [section, setSection] = useState<Section>(
        new URLSearchParams(location.search).get('section') === 'payments' ? 'Payment settings'
            : location.pathname === '/admin/travel' ? 'Travel Bookings'
            : location.pathname === '/admin/discovery' ? 'Automated Discovery Center'
            : location.pathname === '/admin/publishing' ? 'Event Discovery'
            : 'Dashboard Overview'
    );
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

    // Sound & Real-Time Deposit Notification State
    const [soundEnabled, setSoundEnabled] = useState(true);
    const [audioUnlocked, setAudioUnlocked] = useState(false);
    const [volume, setVolume] = useState(0.75);
    const [unreadCount, setUnreadCount] = useState(0);
    const [unacknowledgedDeposits, setUnacknowledgedDeposits] = useState<DepositAlert[]>([]);
    const [socketConnected, setSocketConnected] = useState(false);

    const soundEnabledRef = useRef(soundEnabled);
    soundEnabledRef.current = soundEnabled;
    const volumeRef = useRef(volume);
    volumeRef.current = volume;

    async function load() {
        const [overview, logs, notifs, pendingDeps] = await Promise.all([
            request<Data>('/overview').catch(() => undefined),
            request<{ data: Audit[] }>('/audit').catch(() => ({ data: [] })),
            autoRequest<{ unreadCount: number }>('/notifications').catch(() => ({ unreadCount: 0 })),
            autoRequest<{ data: DepositAlert[] }>('/deposits?status=PENDING').catch(() => ({ data: [] }))
        ]);
        if (overview) {
            setData(overview);
            setSelected(current => current && overview.orders.find(order => order.orderReference === current.orderReference));
        }
        setAudit(logs.data || []);
        setUnreadCount(notifs.unreadCount || 0);
        setUnacknowledgedDeposits((pendingDeps.data || []).filter((d: any) => !d.acknowledged));
    }

    async function run(action: () => Promise<void>) {
        setBusy(true);
        setNotice('');
        try { await action(); } catch (error) { setNotice(error instanceof Error ? error.message : 'Request failed.'); }
        finally { setBusy(false); }
    }

    useEffect(() => {
        void run(load);
        const interval = window.setInterval(() => {
            if (!document.hidden) void load().catch(() => {});
        }, 30000);
        return () => window.clearInterval(interval);
    }, []);

    // Socket.IO Real-Time Deposit Notifications
    useEffect(() => {
        const socket = io({ path: '/socket.io', withCredentials: true });
        socket.on('connect', () => setSocketConnected(true));
        socket.on('disconnect', () => setSocketConnected(false));
        socket.on('deposit:initiated', ({ deposit }: { deposit: DepositAlert }) => {
            if (!deposit) return;
            setUnacknowledgedDeposits(prev => [deposit, ...prev.filter(d => d.reference !== deposit.reference)]);
            setUnreadCount(c => c + 1);
            if (soundEnabledRef.current) playDepositInitiatedSound(volumeRef.current);
            if ('Notification' in window && Notification.permission === 'granted') {
                new Notification('NEW DEPOSIT REQUEST!', {
                    body: `Customer: ${deposit.customerName}\nAmount: KES ${Number(deposit.amountKes).toLocaleString('en-KE')}\nMethod: ${deposit.method}\nReference: ${deposit.reference}\nStatus: ${deposit.status}`
                });
            }
        });
        socket.on('deposit:acknowledged', ({ reference, id }: { reference?: string; id?: string }) => {
            setUnacknowledgedDeposits(prev => prev.filter(d => d.reference !== reference && d._id !== id));
        });
        socket.on('deposit:verified', ({ deposit }: { deposit: DepositAlert }) => {
            if (deposit) {
                setUnacknowledgedDeposits(prev => prev.filter(d => d.reference !== deposit.reference));
                if (deposit.status === 'COMPLETED') {
                    if (soundEnabledRef.current) playDepositSuccessSound(volumeRef.current);
                    if ('Notification' in window && Notification.permission === 'granted') {
                        new Notification('PAYMENT SUCCESSFUL!', {
                            body: `Customer: ${deposit.customerName}\nAmount: KES ${Number(deposit.amountKes).toLocaleString('en-KE')}\nReference: ${deposit.reference}`
                        });
                    }
                }
            }
            void load().catch(() => {});
        });
        return () => { socket.disconnect(); };
    }, []);

    async function acknowledgeOne(idOrRef: string) {
        await autoRequest(`/deposits/${encodeURIComponent(idOrRef)}/acknowledge`, 'POST', {});
        setUnacknowledgedDeposits(prev => prev.filter(d => d._id !== idOrRef && d.reference !== idOrRef));
        setUnreadCount(c => Math.max(0, c - 1));
    }

    async function acknowledgeAll() {
        await autoRequest('/notifications/acknowledge-all', 'POST', {});
        setUnacknowledgedDeposits([]);
        setUnreadCount(0);
    }

    function unlockAudio() {
        setAudioUnlocked(true);
        playDepositInitiatedSound(volume);
        if ('Notification' in window && Notification.permission === 'default') {
            void Notification.requestPermission().catch(() => {});
        }
    }

    const events = data?.events ?? [];
    const orders = data?.orders ?? [];
    const matches = (...values: string[]) => values.join(' ').toLowerCase().includes(query.trim().toLowerCase());
    const eventStatus = (event: Event) => event.status || 'published';
    const filteredEvents = events.filter(event => matches(event.title, event.venue) && (status === 'all' || eventStatus(event) === status));
    const filteredOrders = orders.filter(order => matches(order.orderReference, order.customer.name, order.customer.email, order.paymentStatus, order.receipt || '', order.failureReason || ''));
    const eventPage = Math.min(page, Math.max(0, Math.ceil(filteredEvents.length / 10) - 1));

    const goToSection = (item: Section) => {
        setSection(item); setQuery(''); setStatus('all'); setPage(0); setSelected(undefined);
    };

    return <div className={dark ? 'shell dark' : 'shell'} onClick={() => { if (!audioUnlocked) { setAudioUnlocked(true); void ensureAudioContext(); } }}>
        <aside className={collapsed ? 'sidebar collapsed' : 'sidebar'}>
            <div className="brand">
                <strong>Ticketsasa Admin</strong>
                <span>{socketConnected ? '● Live Socket Connected' : '○ Connecting…'}</span>
            </div>
            <button className="menu" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed}>{collapsed ? '☰ Show Menu' : '✕ Hide Menu'}</button>
            <nav aria-label="Admin navigation">
                {navGroups.map(group => (
                    <div key={group.label} style={{ marginBottom: '0.65rem' }}>
                        <div style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', opacity: 0.6, padding: '0.35rem 0.6rem' }}>
                            {group.label}
                        </div>
                        {group.items.map(({ id, icon }) => (
                            <button key={id} aria-current={section === id ? 'page' : undefined} onClick={() => goToSection(id)}>
                                <span>{icon} {id}</span>
                                {id === 'Pending Deposits' && unacknowledgedDeposits.length > 0 && <span className="nav-badge">{unacknowledgedDeposits.length}</span>}
                                {id === 'Notifications' && unreadCount > 0 && <span className="nav-badge">{unreadCount}</span>}
                            </button>
                        ))}
                    </div>
                ))}
            </nav>
            <a href="/">← Back to storefront</a>
        </aside>
        <main>
            <header>
                <div><p className="eyebrow">Automated Discovery &amp; Payment Center</p><h1>{section}</h1></div>
                <div className="actions sound-controls">
                    <button onClick={() => { const next = !soundEnabled; setSoundEnabled(next); if (next) { setAudioUnlocked(true); playDepositInitiatedSound(volume); } }}>
                        {soundEnabled ? '🔊 Sound: ON' : '🔇 Sound: OFF'}
                    </button>
                    <label className="volume-control" title="Alert Volume">
                        <span>Vol</span>
                        <input type="range" min="0" max="1" step="0.05" value={volume} onChange={e => setVolume(Number(e.target.value))} />
                    </label>
                    <button onClick={() => { setAudioUnlocked(true); playDepositInitiatedSound(volume); }}>Test Initiated Sound</button>
                    <button onClick={() => { setAudioUnlocked(true); playDepositSuccessSound(volume); }}>Test Success Sound</button>
                    <button onClick={() => setDark(!dark)}>{dark ? 'Light' : 'Dark'}</button>
                    <a className="primary" href="/organizer">Publish Event</a>
                </div>
            </header>
            <div className="actions" style={{ flexWrap: 'wrap', marginBottom: '0.75rem', gap: '0.4rem' }}>
                {(['Dashboard Overview', 'Transactions', 'Pending Deposits', 'Travel Fulfillment & Pricing', 'All Events', 'Payment settings'] as Section[]).map(quick => (
                    <button key={quick} className={section === quick ? 'primary' : ''} onClick={() => goToSection(quick)}>
                        {quick}
                    </button>
                ))}
            </div>

            {!audioUnlocked && <div className="notice" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Browser autoplay policy requires one click to activate automatic deposit notification sounds &amp; browser alerts.</span>
                <button className="primary" onClick={unlockAudio}>Activate Sound Alerts</button>
            </div>}

            {unacknowledgedDeposits.map(dep => (
                <div className="deposit-banner" role="alert" key={dep.reference}>
                    <div>
                        <strong>NEW DEPOSIT REQUEST!</strong>
                        <span>
                            Customer: {dep.customerName} ({dep.customerPhone}) · Amount: {money(dep.amountKes)} · Method: {dep.method} · Reference: {dep.reference} · Status: {dep.status}
                        </span>
                    </div>
                    <div className="actions">
                        <button className="primary" onClick={() => void acknowledgeOne(dep._id || dep.reference)}>Acknowledge &amp; Stop Sound</button>
                        <button onClick={() => { setSection('Pending Deposits'); }}>Inspect</button>
                    </div>
                </div>
            ))}

            {notice && <p className="notice" role="status">{notice}</p>}

            {section === 'Dashboard Overview' && <AutomationOverview onNavigate={target => setSection(target as Section)} />}
            {section === 'Automated Discovery Center' && <DiscoveryCenterPanel />}
            {section === 'Event Discovery' && <EventDiscoveryPanel />}
            {section === 'Ticket Management' && <TicketManagementPanel />}
            {section === 'Flight Discovery' && <FlightManagementPanel mode="discovery" />}
            {section === 'Flight Management' && <FlightManagementPanel mode="manage" />}
            {section === 'Holiday Packages' && <HolidayPackagesPanel />}
            {section === 'Travel Bookings' && <TravelBookingsPanel />}
            {section === 'Travel Fulfillment & Pricing' && <TravelOpsPanel />}
            {section === 'Pending Deposits' && <PendingDepositsPanel onAcknowledge={acknowledgeOne} />}
            {section === 'Payment settings' && <PaymentSettingsPanel />}
            {section === 'Notifications' && <NotificationsPanel onAcknowledgeAll={acknowledgeAll} />}
            {section === 'Data Sources' && <DataSourcesPanel />}
            {section === 'Automation Settings' && <AutomationSettingsPanel />}
            {section === 'Reports' && <ReportsPanel />}
            {section === 'System Logs' && <SystemLogsPanel audit={audit} />}

            {section === 'All Events' && <section className="panel">
                <div className="actions"><input aria-label="Search events" placeholder="Search name or venue" value={query} onChange={event => {setQuery(event.target.value); setPage(0);}}/>
                <select aria-label="Event status" value={status} onChange={event => {setStatus(event.target.value); setPage(0);}}>
                    <option value="all">All statuses</option><option>published</option><option>unpublished</option><option>archived</option>
                </select></div>
                <div className="scroll"><table><thead><tr><th>Event</th><th>Venue</th><th>Starts</th><th>Status</th><th>Actions</th></tr></thead>
                    <tbody>{filteredEvents.slice(eventPage * 10, eventPage * 10 + 10).map(event => <tr key={event.id}>
                        <td>{event.image && <img src={event.image} alt="" loading="lazy" decoding="async" />}{event.title}</td><td>{event.venue}</td><td>{date(event.startsAt)}</td><td>{eventStatus(event)}</td>
                        <td className="actions">{['published', 'unpublished', 'archived'].filter(next => next !== eventStatus(event)).map(next =>
                            <button key={next} disabled={busy} onClick={() => void run(async () => {
                                await request('/events/' + encodeURIComponent(event.id), 'PATCH', { status: next }); await load(); setNotice('Event status updated.');
                            })}>{({ published: 'Publish', unpublished: 'Unpublish', archived: 'Archive' })[next]}</button>)}</td>
                    </tr>)}</tbody></table></div>
                {!filteredEvents.length && <p>No matching organizer events.</p>}
                <div className="actions"><button disabled={eventPage === 0} onClick={() => setPage(eventPage - 1)}>Previous</button><span>Page {eventPage + 1}</span>
                <button disabled={(eventPage + 1) * 10 >= filteredEvents.length} onClick={() => setPage(eventPage + 1)}>Next</button></div>
            </section>}

            {section === 'Transactions' && <div className="publishing-lobby">
                <section className="panel"><h2>M-Pesa payment provider</h2><p>Manage PayHero and NexusPay for new payments.</p><button onClick={() => setSection('Payment settings')}>Open payment settings</button></section>
                <section className="panel">
                    <div className="actions">
                        <input aria-label="Search transactions" placeholder="Search reference, email or status" value={query} onChange={event => {setQuery(event.target.value);setSelected(undefined);}}/>
                        <button disabled={!filteredOrders.length} onClick={() => exportOrders(filteredOrders)}>Download CSV</button>
                    </div>
                    {!filteredOrders.length && <p>No matching live transactions.</p>}
                    <div className="scroll"><table><thead><tr><th>#</th><th>Reference</th><th>Customer</th><th>Status</th><th>M-Pesa Code / Failure Reason</th><th>Total</th><th></th></tr></thead><tbody>{filteredOrders.map((order, idx) =>
                        <tr key={order.orderReference}>
                            <td><strong>#{idx + 1}</strong></td>
                            <td>{order.orderReference}</td>
                            <td>{order.customer.name}</td>
                            <td><PaymentBadge status={order.paymentStatus}/></td>
                            <td>{order.paymentStatus === 'COMPLETED'
                                ? <span style={{ color: '#15803d', fontWeight: 700, fontFamily: 'monospace' }}>{order.receipt ? `M-Pesa: ${order.receipt}` : 'Paid'}{order.paidAt ? ` · ${date(order.paidAt)}` : ''}</span>
                                : order.paymentStatus === 'FAILED'
                                    ? <span style={{ color: '#b91c1c', fontWeight: 600 }}>{order.failureReason || 'Payment failed'}{order.failureCode ? ` (Code ${order.failureCode})` : ''}</span>
                                    : order.failureReason
                                        ? <span style={{ color: '#b45309', fontWeight: 600 }}>{order.failureReason}</span>
                                        : '—'}</td>
                            <td>{money(order.totalKes)}</td>
                            <td><button onClick={() => setSelected(order)}>View order</button></td>
                        </tr>)}</tbody></table></div>
                    {selected && <section className="detail"><h2>Order details</h2><p>{selected.customer.name} · {selected.customer.email}</p>
                        <p>Payment status: {paymentLabel(selected.paymentStatus)}{selected.paidAt ? ' · ' + date(selected.paidAt) : ''}</p>
                        {selected.paymentStatus === 'COMPLETED' && selected.receipt && (
                            <p style={{ color: '#15803d', fontWeight: 700, fontFamily: 'monospace' }}>
                                M-Pesa Receipt Code: {selected.receipt}
                            </p>
                        )}
                        {selected.paymentStatus === 'FAILED' && (
                            <p style={{ color: '#b91c1c', fontWeight: 700 }}>
                                Failure reason: {selected.failureReason || 'Payment failed or cancelled'}{selected.failureCode ? ` (M-Pesa code ${selected.failureCode})` : ''}{selected.failedAt ? ' · ' + date(selected.failedAt) : ''}
                            </p>
                        )}
                        <ul>{selected.items.map((item, index) => <li key={index}>{item.quantity} × {item.title}</li>)}</ul>
                        {selected.paymentStatus === 'PROCESSING' && <button disabled={busy} onClick={() => void run(async () => {
                            const result = await request<{ paymentStatus: string; failureReason?: string; failureCode?: string }>('/orders/' + encodeURIComponent(selected.orderReference) + '/check-payment', 'POST');
                            setSelected({ ...selected, paymentStatus: result.paymentStatus, failureReason: result.failureReason || selected.failureReason, failureCode: result.failureCode || selected.failureCode });
                            setNotice('Payment status: ' + paymentLabel(result.paymentStatus) + (result.failureReason ? ' — ' + result.failureReason : ''));
                            await load();
                        })}>Check M-Pesa status</button>}
                        <button onClick={() => setSelected(undefined)}>Close details</button></section>}
                </section>
            </div>}
        </main>
    </div>;
}

createRoot(document.getElementById('root')!).render(<App />);
