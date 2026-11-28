import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io } from 'socket.io-client';
import './style.css';
import {
    autoRequest,
    AutomationOverview,
    TicketManagementPanel,
    FlightManagementPanel,
    HolidayPackagesPanel,
    PendingDepositsPanel,
    NotificationsPanel,
    ReportsPanel,
    SystemLogsPanel
} from './automationPanels';
import { DiscoveryCenterPanel } from './discoveryCenterPanel';
import { TravelOpsPanel } from './travelOpsPanel';
import { BlogManagerPanel } from './blogPanel';
import {
    AlertSoundKind,
    NotificationPermState,
    getNotificationPermission,
    isAudioReady,
    playPaymentSound,
    requestNotificationPermission,
    showBrowserNotification,
    unlockAudioEngine
} from './soundEngine';

type Tier = { tierKey: string; title: string; priceKes: number; remainingAllocation: number; sold: number };
type Event = { id: string; title: string; venue: string; startsAt: string; image?: string; status?: string; tiers: Tier[] };
type Order = { orderReference: string; customer: { name: string; email: string; phone?: string }; items: { title: string; quantity: number; kind: string }[]; totalTickets: number; totalKes: number; paymentStatus: string; paidAt?: string; createdAt?: string; provider?: string; receipt?: string; failureReason?: string; failureCode?: string; failedAt?: string };
type Audit = { action: string; target: string; timestamp: string };
type PaymentSettings = { provider: string | null; storageAvailable: boolean; options: { id: string; name: string; configured: boolean }[] };
type TicketRevenue = { todayKes: number; weekKes: number; totalKes: number; undatedPayments: number };
type Data = { storageAvailable: boolean; storefrontUrl?: string; payments: PaymentSettings; ticketRevenue: TicketRevenue; events: Event[]; orders: Order[] };

type DepositAlert = {
    _id?: string;
    reference: string;
    orderReference?: string;
    customerName: string;
    customerPhone: string;
    amountKes: number;
    method: string;
    status: string;
    mpesaReceipt?: string;
    failureReason?: string;
    failureCode?: string;
    initiatedAt: string;
};

type LiveBanner = {
    id: string;
    tone: 'pending' | 'success' | 'failed';
    title: string;
    detail: string;
    target: Section;
};

const sections = [
    'Dashboard Overview',
    'Automated Discovery Center',
    'All Events',
    'Ticket Management',
    'Blog Manager',
    'Flight Management',
    'Holiday Packages',
    'Travel Fulfillment & Pricing',
    'Pending Deposits',
    'Transactions',
    'Payment settings',
    'Support Contact',
    'Notifications',
    'Reports',
    'System Logs'
] as const;
type Section = typeof sections[number];

const navGroups: { label: string; items: Section[] }[] = [
    {
        label: 'Overview & Payments',
        items: [
            'Dashboard Overview',
            'Transactions',
            'Pending Deposits',
            'Notifications',
            'Reports'
        ]
    },
    {
        label: 'Events & Content',
        items: [
            'All Events',
            'Ticket Management',
            'Blog Manager'
        ]
    },
    {
        label: 'Flights & Holidays',
        items: [
            'Travel Fulfillment & Pricing',
            'Flight Management',
            'Holiday Packages'
        ]
    },
    {
        label: 'Settings & Discovery',
        items: [
            'Automated Discovery Center',
            'Payment settings',
            'Support Contact',
            'System Logs'
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

type SupportContactSettings = {
    email: string | null;
    phone: string | null;
    whatsapp: string | null;
    whatsappUrl: string | null;
    hours: string | null;
    updatedAt?: string | null;
    storageAvailable: boolean;
};

function SupportContactPanel() {
    const [settings, setSettings] = useState<SupportContactSettings>();
    const [email, setEmail] = useState('');
    const [phone, setPhone] = useState('');
    const [whatsapp, setWhatsapp] = useState('');
    const [hours, setHours] = useState('');
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');

    async function load() {
        setBusy(true);
        setMessage('');
        try {
            const value = await request<SupportContactSettings>('/support/contact');
            setSettings(value);
            setEmail(value.email || '');
            setPhone(value.phone || '');
            setWhatsapp(value.whatsapp || '');
            setHours(value.hours || '');
        } catch (error) {
            setMessage(error instanceof Error ? error.message : 'Could not load support contact settings.');
        } finally {
            setBusy(false);
        }
    }

    useEffect(() => { void load(); }, []);

    async function save(payload: { email: string; phone: string; whatsapp: string; hours: string }) {
        if (busy || !settings?.storageAvailable) return;
        setBusy(true);
        setMessage('');
        try {
            const saved = await request<SupportContactSettings>('/support/contact', 'PUT', payload);
            setSettings(saved);
            setEmail(saved.email || '');
            setPhone(saved.phone || '');
            setWhatsapp(saved.whatsapp || '');
            setHours(saved.hours || '');
            const hasAny = Boolean(saved.email || saved.phone || saved.whatsapp);
            setMessage(hasAny
                ? 'Support contact saved — live immediately in the storefront Help widget.'
                : 'Support contact cleared.');
        } catch (error) {
            setMessage(error instanceof Error ? error.message : 'Could not save support contact settings.');
        } finally {
            setBusy(false);
        }
    }

    return <div className="publishing-lobby">
        <section className="panel">
            <h2>Storefront Support Contact</h2>
            <p>Set your own support Email, Phone, and WhatsApp details shown inside the Ticketsassa Help widget. Leave any field blank to hide it.</p>
            {settings && !settings.storageAvailable && (
                <p className="notice" role="status">Database offline. Reconnect and refresh before saving support contact details.</p>
            )}
            <form onSubmit={e => { e.preventDefault(); void save({ email, phone, whatsapp, hours }); }} style={{ marginTop: 14 }}>
                <div className="form-grid">
                    <label>
                        Support Email
                        <input
                            type="email"
                            placeholder="support@yourdomain.com"
                            value={email}
                            disabled={busy || !settings?.storageAvailable}
                            onChange={e => setEmail(e.target.value)}
                        />
                    </label>
                    <label>
                        Support Phone (Call)
                        <input
                            type="tel"
                            placeholder="+254 7XX XXX XXX"
                            value={phone}
                            disabled={busy || !settings?.storageAvailable}
                            onChange={e => setPhone(e.target.value)}
                        />
                    </label>
                    <label>
                        WhatsApp Number
                        <input
                            type="tel"
                            placeholder="+254 7XX XXX XXX or 07XX XXX XXX"
                            value={whatsapp}
                            disabled={busy || !settings?.storageAvailable}
                            onChange={e => setWhatsapp(e.target.value)}
                        />
                    </label>
                    <label>
                        Support Hours (Optional)
                        <input
                            type="text"
                            maxLength={120}
                            placeholder="Daily, 8:00 AM – 8:00 PM EAT"
                            value={hours}
                            disabled={busy || !settings?.storageAvailable}
                            onChange={e => setHours(e.target.value)}
                        />
                    </label>
                </div>
                <div className="actions" style={{ marginTop: 14 }}>
                    <button className="primary" type="submit" disabled={busy || !settings?.storageAvailable}>
                        {busy ? 'Saving…' : 'Save Support Contact'}
                    </button>
                    <button
                        type="button"
                        disabled={busy || !settings?.storageAvailable}
                        onClick={() => void save({ email: '', phone: '', whatsapp: '', hours: '' })}
                    >
                        Clear All
                    </button>
                    <button type="button" disabled={busy} onClick={() => void load()}>Refresh</button>
                </div>
            </form>
            {message && <p className="notice" role="status" aria-live="polite" style={{ marginTop: 12 }}>{message}</p>}
            {settings?.updatedAt && <p style={{ opacity: 0.7, fontSize: '0.85rem', marginTop: 8 }}>Last updated: {date(settings.updatedAt)}</p>}
        </section>
        <section className="panel">
            <h3>Customer Preview (Help Widget)</h3>
            {settings && (settings.email || settings.phone || settings.whatsapp) ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
                    <p>Contact the Ticketsassa support team using the details below.{settings.hours ? ` Support hours: ${settings.hours}.` : ''}</p>
                    <div className="actions">
                        {settings.email && <a href={`mailto:${settings.email}`}>Email: {settings.email}</a>}
                        {settings.phone && <a href={`tel:${settings.phone}`}>Call: {settings.phone}</a>}
                        {settings.whatsapp && settings.whatsappUrl && (
                            <a className="primary" href={settings.whatsappUrl} target="_blank" rel="noreferrer">WhatsApp: {settings.whatsapp}</a>
                        )}
                    </div>
                </div>
            ) : (
                <p style={{ opacity: 0.75, marginTop: 8 }}>No support contact saved yet. Add your email, phone, or WhatsApp above and click Save.</p>
            )}
        </section>
    </div>;
}

const SOUND_ENABLED_KEY = 'ticketsasa_admin_sound_enabled';
const SOUND_VOLUME_KEY = 'ticketsasa_admin_sound_volume';

function readStoredBool(key: string, fallback: boolean): boolean {
    try {
        const raw = localStorage.getItem(key);
        if (raw === 'true') return true;
        if (raw === 'false') return false;
    } catch {}
    return fallback;
}

function readStoredVolume(key: string, fallback: number): number {
    try {
        const num = Number(localStorage.getItem(key));
        if (Number.isFinite(num) && num >= 0 && num <= 1) return num;
    } catch {}
    return fallback;
}

function exportOrders(orders: Order[]) {
    const quote = (value: string | number) => '"' + String(value ?? '').replace(/^([=+@-]|\s)/, "'$1").replaceAll('"', '""') + '"';
    const rows = [
        ['Reference', 'Date', 'Customer', 'Phone', 'Email', 'Items', 'Status', 'M-Pesa Receipt', 'Failure Reason', 'Total KES'],
        ...orders.map(order => [
            order.orderReference,
            order.paidAt || order.createdAt || '',
            order.customer?.name || '',
            order.customer?.phone || '',
            order.customer?.email || '',
            (order.items || []).map(i => `${i.quantity}x ${i.title}`).join('; '),
            order.paymentStatus,
            order.receipt || '',
            order.failureReason || '',
            order.totalKes
        ])
    ];
    const url = URL.createObjectURL(new Blob([rows.map(row => row.map(quote).join(',')).join('\r\n')], { type: 'text/csv' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'transactions.csv';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function App() {
    const [section, setSection] = useState<Section>(
        new URLSearchParams(location.search).get('section') === 'payments' ? 'Payment settings'
            : location.pathname === '/admin/travel' ? 'Travel Fulfillment & Pricing'
            : location.pathname === '/admin/discovery' || location.pathname === '/admin/publishing' ? 'Automated Discovery Center'
            : 'Dashboard Overview'
    );
    const [data, setData] = useState<Data>();
    const [audit, setAudit] = useState<Audit[]>([]);
    const [query, setQuery] = useState('');
    const [status, setStatus] = useState('all');
    const [page, setPage] = useState(0);
    const [selected, setSelected] = useState<Order>();
    const [rescheduleId, setRescheduleId] = useState<string | null>(null);
    const [rescheduleAt, setRescheduleAt] = useState('');
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState('');
    const [dark, setDark] = useState(false);
    const [collapsed, setCollapsed] = useState(false);

    // Sound & Real-Time Deposit Notification State
    const [soundEnabled, setSoundEnabled] = useState(() => readStoredBool(SOUND_ENABLED_KEY, true));
    const [audioUnlocked, setAudioUnlocked] = useState(() => isAudioReady());
    const [audioBlocked, setAudioBlocked] = useState(false);
    const [notifPerm, setNotifPerm] = useState<NotificationPermState>(() => getNotificationPermission());
    const [volume, setVolume] = useState(() => readStoredVolume(SOUND_VOLUME_KEY, 0.85));
    const [unreadCount, setUnreadCount] = useState(0);
    const [unacknowledgedDeposits, setUnacknowledgedDeposits] = useState<DepositAlert[]>([]);
    const [liveBanners, setLiveBanners] = useState<LiveBanner[]>([]);
    const [refreshKey, setRefreshKey] = useState(0);
    const [socketConnected, setSocketConnected] = useState(false);
    const [sseConnected, setSseConnected] = useState(false);
    const [titleAlert, setTitleAlert] = useState('');

    const soundEnabledRef = useRef(soundEnabled);
    soundEnabledRef.current = soundEnabled;
    const volumeRef = useRef(volume);
    volumeRef.current = volume;
    const seenDepositStatusRef = useRef<Map<string, string>>(new Map());
    const seenTestRef = useRef<Set<string>>(new Set());
    const initialLoadDoneRef = useRef(false);
    const titleTimerRef = useRef<number | null>(null);

    useEffect(() => {
        try { localStorage.setItem(SOUND_ENABLED_KEY, String(soundEnabled)); } catch {}
    }, [soundEnabled]);

    useEffect(() => {
        try { localStorage.setItem(SOUND_VOLUME_KEY, String(volume)); } catch {}
    }, [volume]);

    // Unlock browser audio on first real user gesture without hiding notification permission prompt
    useEffect(() => {
        const handleGesture = () => {
            if (isAudioReady()) {
                setAudioUnlocked(true);
                setAudioBlocked(false);
                return;
            }
            void unlockAudioEngine().then(ok => {
                if (ok) {
                    setAudioUnlocked(true);
                    setAudioBlocked(false);
                }
            });
        };
        window.addEventListener('pointerdown', handleGesture, { passive: true });
        window.addEventListener('keydown', handleGesture, { passive: true });
        return () => {
            window.removeEventListener('pointerdown', handleGesture);
            window.removeEventListener('keydown', handleGesture);
        };
    }, []);

    // Keep browser tab title updated with unread count and active payment alert flashes
    useEffect(() => {
        const badgeCount = Math.max(unreadCount, unacknowledgedDeposits.length);
        if (titleAlert) {
            document.title = `${titleAlert} · Ticketsasa Admin`;
        } else if (badgeCount > 0) {
            document.title = `(${badgeCount}) Ticketsasa Admin`;
        } else {
            document.title = 'Ticketsasa Admin';
        }
    }, [unreadCount, unacknowledgedDeposits.length, titleAlert]);

    function flashDocumentTitle(label: string) {
        setTitleAlert(label);
        if (titleTimerRef.current) window.clearTimeout(titleTimerRef.current);
        titleTimerRef.current = window.setTimeout(() => setTitleAlert(''), 10000);
    }

    function pushLiveBanner(banner: LiveBanner) {
        setLiveBanners(prev => [banner, ...prev.filter(b => b.id !== banner.id)].slice(0, 4));
        window.setTimeout(() => {
            setLiveBanners(prev => prev.filter(b => b.id !== banner.id));
        }, 30000);
    }

    async function triggerSound(kind: AlertSoundKind, forcePlay = false) {
        if (!forcePlay && !soundEnabledRef.current) return;
        const result = await playPaymentSound(kind, volumeRef.current);
        if (result.played) {
            setAudioUnlocked(true);
            setAudioBlocked(false);
        } else if (result.blocked) {
            setAudioBlocked(true);
        }
    }

    function normalizeAlertStatus(rawStatus: string): 'PENDING' | 'COMPLETED' | 'FAILED' | string {
        const upper = String(rawStatus || '').toUpperCase();
        if (upper === 'PROCESSING' || upper === 'PENDING') return 'PENDING';
        return upper;
    }

    function statusRank(status: string): number {
        const norm = normalizeAlertStatus(status);
        if (norm === 'COMPLETED') return 3;
        if (norm === 'FAILED') return 2;
        if (norm === 'PENDING') return 1;
        return 0;
    }

    function handleDepositTransition(dep: DepositAlert & { updatedAt?: string; failedAt?: string; paidAt?: string }, { fromRealtime = false, isTest = false, silent = false } = {}) {
        const key = dep?.orderReference || dep?.reference;
        if (!key) return;
        const nextStatus = normalizeAlertStatus(dep.status);
        let prevStatus: string | undefined;
        if (isTest) {
            const testKey = `${key}:${nextStatus}`;
            if (seenTestRef.current.has(testKey)) return;
            seenTestRef.current.add(testKey);
            if (seenTestRef.current.size > 40) seenTestRef.current.clear();
        } else {
            prevStatus = seenDepositStatusRef.current.get(key);
            if (prevStatus === nextStatus) return;
            // Never downgrade a terminal status (COMPLETED / FAILED) back to PENDING from stale records
            if (prevStatus && statusRank(nextStatus) < statusRank(prevStatus)) return;
            seenDepositStatusRef.current.set(key, nextStatus);
        }

        // On initial poll load or silent seeding, record status without playing chimes or banners.
        if (silent || (!fromRealtime && !isTest && !initialLoadDoneRef.current)) return;

        // For poll-discovered transitions (not live Socket.IO/SSE/test), ignore historical records older than 15 minutes
        if (!fromRealtime && !isTest) {
            const stamp = Date.parse(dep.failedAt || dep.paidAt || dep.updatedAt || dep.initiatedAt || '');
            if (Number.isFinite(stamp) && Date.now() - stamp > 15 * 60 * 1000) return;
        }

        const amountLabel = `KES ${Number(dep.amountKes || 0).toLocaleString('en-KE')}`;
        const testTag = isTest ? ' (Test)' : '';
        if (nextStatus === 'PENDING' && (isTest || !prevStatus)) {
            void triggerSound('initiated', isTest);
            flashDocumentTitle(`[PAYMENT PROMPT${testTag}]`);
            pushLiveBanner({
                id: `${key}:PENDING${isTest ? ':' + Date.now() : ''}`,
                tone: 'pending',
                title: `PAYMENT PROMPT SENT${testTag.toUpperCase()}`,
                detail: `${dep.customerName} (${dep.customerPhone || dep.method || 'M-Pesa'}) · ${amountLabel} · Awaiting PIN`,
                target: 'Pending Deposits'
            });
            showBrowserNotification(`Payment Prompt Sent${testTag}`, `${dep.customerName} · ${amountLabel} · ${dep.method || 'M-Pesa'}`, {
                tag: `${key}:PENDING`,
                onClick: () => goToSection('Pending Deposits')
            });
        } else if (nextStatus === 'COMPLETED' && (isTest || prevStatus !== 'COMPLETED')) {
            void triggerSound('success', isTest);
            flashDocumentTitle(`[PAYMENT CONFIRMED${testTag}]`);
            pushLiveBanner({
                id: `${key}:COMPLETED${isTest ? ':' + Date.now() : ''}`,
                tone: 'success',
                title: `PAYMENT CONFIRMED${testTag.toUpperCase()}`,
                detail: `${dep.customerName} · ${amountLabel}${dep.mpesaReceipt ? ` · M-Pesa: ${dep.mpesaReceipt}` : ''} · ${dep.orderReference || dep.reference}`,
                target: 'Transactions'
            });
            showBrowserNotification(`Payment Confirmed${testTag}`, `${dep.customerName} · ${amountLabel}${dep.mpesaReceipt ? ` · ${dep.mpesaReceipt}` : ''}`, {
                tag: `${key}:COMPLETED`,
                onClick: () => goToSection('Transactions')
            });
        } else if (nextStatus === 'FAILED' && (isTest || prevStatus !== 'FAILED')) {
            void triggerSound('failed', isTest);
            flashDocumentTitle(`[PAYMENT FAILED${testTag}]`);
            const reason = dep.failureReason || 'Payment failed or cancelled';
            pushLiveBanner({
                id: `${key}:FAILED${isTest ? ':' + Date.now() : ''}`,
                tone: 'failed',
                title: `PAYMENT FAILED${testTag.toUpperCase()}`,
                detail: `${dep.customerName} · ${amountLabel} · ${reason}`,
                target: 'Transactions'
            });
            showBrowserNotification(`Payment Failed${testTag}`, `${dep.customerName} · ${amountLabel} · ${reason}`, {
                tag: `${key}:FAILED`,
                onClick: () => goToSection('Transactions')
            });
        }
    }

    async function load(fresh = false) {
        const [overview, logs, notifs, recentDeps] = await Promise.all([
            request<Data>(fresh ? '/overview?fresh=1' : '/overview').catch(() => undefined),
            request<{ data: Audit[] }>('/audit').catch(() => ({ data: [] })),
            autoRequest<{ unreadCount: number }>('/notifications').catch(() => ({ unreadCount: 0 })),
            autoRequest<{ data: DepositAlert[] }>('/deposits').catch(() => undefined)
        ]);
        if (overview) {
            setData(overview);
            setSelected(current => current && overview.orders.find(order => order.orderReference === current.orderReference));
        }
        setAudit(logs.data || []);
        setUnreadCount(notifs.unreadCount || 0);

        const allDeps = recentDeps?.data || [];
        const orderStatusByRef = new Map<string, string>();
        const mergedByKey = new Map<string, DepositAlert & { failedAt?: string; paidAt?: string }>();

        const mergeRecord = (rec: DepositAlert & { failedAt?: string; paidAt?: string }) => {
            const key = rec.orderReference || rec.reference;
            if (!key) return;
            const existing = mergedByKey.get(key);
            if (!existing || statusRank(rec.status) > statusRank(existing.status)) {
                mergedByKey.set(key, {
                    ...existing,
                    ...rec,
                    mpesaReceipt: rec.mpesaReceipt || existing?.mpesaReceipt,
                    failureReason: rec.failureReason || existing?.failureReason,
                    failureCode: rec.failureCode || existing?.failureCode
                });
            }
        };

        for (const dep of allDeps) mergeRecord(dep);
        if (overview?.orders?.length) {
            for (const ord of overview.orders.slice(0, 60)) {
                orderStatusByRef.set(ord.orderReference, normalizeAlertStatus(ord.paymentStatus));
                if (!['PROCESSING', 'COMPLETED', 'FAILED'].includes(ord.paymentStatus)) continue;
                mergeRecord({
                    reference: ord.orderReference,
                    orderReference: ord.orderReference,
                    customerName: ord.customer?.name || 'Customer',
                    customerPhone: ord.customer?.phone || '',
                    amountKes: ord.totalKes,
                    method: ord.provider?.toUpperCase() || 'M-PESA',
                    status: ord.paymentStatus,
                    mpesaReceipt: ord.receipt,
                    failureReason: ord.failureReason,
                    failureCode: ord.failureCode,
                    failedAt: ord.failedAt,
                    paidAt: ord.paidAt,
                    initiatedAt: ord.failedAt || ord.paidAt || ord.createdAt || ''
                });
            }
        }

        const isFirstFullSeed = !initialLoadDoneRef.current;
        for (const rec of mergedByKey.values()) {
            handleDepositTransition(rec, { fromRealtime: false, silent: isFirstFullSeed });
        }
        if (overview && recentDeps) {
            initialLoadDoneRef.current = true;
        }

        setUnacknowledgedDeposits(allDeps.filter((d: any) => {
            if (!['PENDING', 'PROCESSING'].includes(d.status) || d.acknowledged) return false;
            const liveOrderStatus = d.orderReference ? orderStatusByRef.get(d.orderReference) : undefined;
            return !liveOrderStatus || liveOrderStatus === 'PENDING';
        }));
    }

    async function run(action: () => Promise<void>) {
        setBusy(true);
        setNotice('');
        try { await action(); } catch (error) { setNotice(error instanceof Error ? error.message : 'Request failed.'); }
        finally { setBusy(false); }
    }

    useEffect(() => {
        void run(() => load(false));
    }, []);

    // Keep syncing even in background tabs so alerts still fire if real-time transport drops
    const realtimeConnected = socketConnected || sseConnected;
    useEffect(() => {
        const intervalMs = realtimeConnected ? 30000 : 8000;
        const interval = window.setInterval(() => {
            void load(false).catch(() => {});
        }, intervalMs);
        const onVisible = () => {
            if (!document.hidden) void load(true).catch(() => {});
        };
        document.addEventListener('visibilitychange', onVisible);
        return () => {
            window.clearInterval(interval);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, [realtimeConnected]);

    // Real-Time Deposit Notifications (Signed Socket.IO + SSE Backup)
    useEffect(() => {
        let cancelled = false;
        let socket: ReturnType<typeof io> | null = null;
        let sse: EventSource | null = null;

        const handleRealtimeEvent = (eventName: string, payload: any) => {
            if (eventName === 'deposit:initiated') {
                const deposit = payload?.deposit as DepositAlert | undefined;
                if (!deposit) return;
                setUnacknowledgedDeposits(prev => [deposit, ...prev.filter(d => d.reference !== deposit.reference && d.orderReference !== deposit.orderReference)]);
                setUnreadCount(c => c + 1);
                setRefreshKey(k => k + 1);
                handleDepositTransition(deposit, { fromRealtime: true });
                void load(true).catch(() => {});
            } else if (eventName === 'deposit:verified') {
                const deposit = payload?.deposit as DepositAlert | undefined;
                if (deposit) {
                    setUnacknowledgedDeposits(prev => prev.filter(d => d.reference !== deposit.reference && d.orderReference !== deposit.orderReference));
                    setUnreadCount(c => c + 1);
                    handleDepositTransition(deposit, { fromRealtime: true });
                }
                setRefreshKey(k => k + 1);
                void load(true).catch(() => {});
            } else if (eventName === 'deposit:acknowledged') {
                const { reference, orderReference, id } = payload || {};
                setUnacknowledgedDeposits(prev => prev.filter(d => d.reference !== reference && d.orderReference !== orderReference && d._id !== id));
                setRefreshKey(k => k + 1);
            } else if (eventName === 'notifications:cleared') {
                setUnacknowledgedDeposits([]);
                setUnreadCount(0);
                setRefreshKey(k => k + 1);
            } else if (eventName === 'deposit:test') {
                const deposit = payload?.deposit as DepositAlert | undefined;
                if (deposit) {
                    handleDepositTransition(deposit, { fromRealtime: true, isTest: true });
                }
            }
        };

        // 1. SSE backup stream (uses browser Basic Auth credentials natively)
        try {
            sse = new EventSource('/api/admin/deposits/stream', { withCredentials: true });
            sse.addEventListener('connected', () => { if (!cancelled) setSseConnected(true); });
            sse.addEventListener('deposit_event', (evt) => {
                try {
                    const parsed = JSON.parse((evt as MessageEvent).data);
                    if (parsed?.event) handleRealtimeEvent(parsed.event, parsed.payload);
                } catch {}
            });
            sse.onerror = () => { if (!cancelled) setSseConnected(false); };
        } catch {}

        // 2. Signed Socket.IO primary channel
        (async () => {
            let token = '';
            try {
                const res = await request<{ token: string }>('/socket-token');
                token = res?.token || '';
            } catch {}
            if (cancelled) return;

            socket = io({
                path: '/socket.io',
                withCredentials: true,
                auth: token ? { token } : undefined,
                transports: ['polling', 'websocket'],
                reconnectionDelay: 1000,
                reconnectionDelayMax: 5000
            });
            socket.on('connect', () => { if (!cancelled) setSocketConnected(true); });
            socket.on('disconnect', () => { if (!cancelled) setSocketConnected(false); });
            socket.on('deposit:initiated', payload => handleRealtimeEvent('deposit:initiated', payload));
            socket.on('deposit:verified', payload => handleRealtimeEvent('deposit:verified', payload));
            socket.on('deposit:acknowledged', payload => handleRealtimeEvent('deposit:acknowledged', payload));
            socket.on('notifications:cleared', payload => handleRealtimeEvent('notifications:cleared', payload));
            socket.on('deposit:test', payload => handleRealtimeEvent('deposit:test', payload));
        })();

        return () => {
            cancelled = true;
            if (socket) socket.disconnect();
            if (sse) sse.close();
        };
    }, []);

    async function acknowledgeOne(idOrRef: string) {
        await autoRequest(`/deposits/${encodeURIComponent(idOrRef)}/acknowledge`, 'POST', {});
        setUnacknowledgedDeposits(prev => prev.filter(d => d._id !== idOrRef && d.reference !== idOrRef && d.orderReference !== idOrRef));
        setUnreadCount(c => Math.max(0, c - 1));
    }

    async function acknowledgeAll() {
        await autoRequest('/notifications/acknowledge-all', 'POST', {});
        setUnacknowledgedDeposits([]);
        setUnreadCount(0);
    }

    async function activateAlerts() {
        const unlocked = await unlockAudioEngine();
        setAudioUnlocked(unlocked);
        setAudioBlocked(!unlocked);
        await triggerSound('initiated', true);
        const perm = await requestNotificationPermission();
        setNotifPerm(perm);
        if (perm === 'granted') {
            showBrowserNotification('Ticketsasa Alerts Active', 'You will hear a chime and get desktop popups for new payments.', { tag: 'ticketsasa-alerts-ready' });
            setNotice('Sound and desktop payment alerts are active.');
        } else if (perm === 'denied') {
            setNotice('Sound alerts are active. Desktop notifications are blocked in your browser — click the lock icon beside the URL to allow notifications.');
        } else {
            setNotice('Sound alerts are active.');
        }
    }

    async function enableDesktopAlerts() {
        const perm = await requestNotificationPermission();
        setNotifPerm(perm);
        if (perm === 'granted') {
            await triggerSound('success', true);
            showBrowserNotification('Desktop Payment Alerts Enabled', 'Live M-Pesa and card payment notifications will appear here.', { tag: 'ticketsasa-desktop-ready' });
            setNotice('Desktop notifications enabled.');
        } else if (perm === 'denied') {
            setNotice('Desktop notifications are blocked by your browser. Click the site lock/tune icon in the address bar and allow Notifications.');
        }
    }

    async function runLiveTestAlert(kind: 'initiated' | 'completed' | 'failed') {
        // Unlock right inside user gesture so browser autoplay never blocks
        await unlockAudioEngine();
        if (notifPerm === 'default') {
            const perm = await requestNotificationPermission();
            setNotifPerm(perm);
        }
        // Trigger server-side broadcast to verify end-to-end Socket.IO/SSE delivery; fallback to local preview if offline
        if (socketConnected || sseConnected) {
            try {
                await autoRequest('/notifications/test', 'POST', { kind });
                return;
            } catch {}
        }
        const localRef = `LOCAL-TEST-${Date.now().toString(36).toUpperCase()}`;
        handleDepositTransition({
            reference: localRef,
            orderReference: localRef,
            customerName: 'Test Customer',
            customerPhone: '254700000000',
            amountKes: 1500,
            method: 'M-PESA',
            status: kind === 'completed' ? 'COMPLETED' : kind === 'failed' ? 'FAILED' : 'PENDING',
            mpesaReceipt: kind === 'completed' ? 'TEST987654' : undefined,
            failureReason: kind === 'failed' ? 'Cancelled by user (test alert)' : undefined,
            initiatedAt: new Date().toISOString()
        }, { fromRealtime: true, isTest: true });
    }

    const events = data?.events ?? [];
    const orders = data?.orders ?? [];
    const matches = (...values: string[]) => values.join(' ').toLowerCase().includes(query.trim().toLowerCase());
    const eventStatus = (event: Event) => event.status || 'published';
    const filteredEvents = events.filter(event => matches(event.title, event.venue) && (status === 'all' || eventStatus(event) === status));
    const filteredOrders = orders.filter(order => matches(order.orderReference, order.customer.name, order.customer.email, order.customer.phone || '', order.paymentStatus, order.receipt || '', order.failureReason || ''));
    const eventPage = Math.min(page, Math.max(0, Math.ceil(filteredEvents.length / 10) - 1));

    const goToSection = (item: Section) => {
        setSection(item); setQuery(''); setStatus('all'); setPage(0); setSelected(undefined);
    };

    const liveStatusLabel = socketConnected
        ? '● Live Socket Connected'
        : sseConnected
            ? '● Live Stream Connected'
            : '○ Polling Live (8s)…';

    return <div className={dark ? 'shell dark' : 'shell'}>
        <aside className={collapsed ? 'sidebar collapsed' : 'sidebar'}>
            <div className="brand">
                <strong>Ticketsasa Admin</strong>
                <span>{liveStatusLabel}</span>
            </div>
            <button className="menu" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed}>{collapsed ? 'Show Menu' : 'Hide Menu'}</button>
            <nav aria-label="Admin navigation">
                {navGroups.map(group => (
                    <div key={group.label} style={{ marginBottom: '0.75rem' }}>
                        <div style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', opacity: 0.55, padding: '0.35rem 0.65rem' }}>
                            {group.label}
                        </div>
                        {group.items.map(id => (
                            <button key={id} aria-current={section === id ? 'page' : undefined} onClick={() => goToSection(id)}>
                                <span>{id}</span>
                                {id === 'Pending Deposits' && unacknowledgedDeposits.length > 0 && <span className="nav-badge">{unacknowledgedDeposits.length}</span>}
                                {id === 'Notifications' && unreadCount > 0 && <span className="nav-badge">{unreadCount}</span>}
                            </button>
                        ))}
                    </div>
                ))}
            </nav>
            <a href={data?.storefrontUrl || 'https://ticketsassa.ticketsassa.workers.dev'} target="_blank" rel="noreferrer">Open Live Storefront</a>
        </aside>
        <main>
            <header>
                <div><p className="eyebrow">Automated Discovery &amp; Payment Center</p><h1>{section}</h1></div>
                <div className="actions sound-controls">
                    <button onClick={() => {
                        const next = !soundEnabled;
                        setSoundEnabled(next);
                        if (next) void triggerSound('initiated', true);
                    }}>
                        {soundEnabled ? 'Sound: On' : 'Sound: Off'}
                    </button>
                    <label className="volume-control" title="Alert Volume">
                        <span>Vol</span>
                        <input type="range" min="0" max="1" step="0.05" value={volume} onChange={e => setVolume(Number(e.target.value))} />
                    </label>
                    {notifPerm === 'default' && (
                        <button className="primary" onClick={() => void enableDesktopAlerts()}>Enable Desktop Alerts</button>
                    )}
                    {notifPerm === 'granted' && (
                        <button onClick={() => void runLiveTestAlert('completed')} title="Desktop notifications active — click to send live test">Desktop Alerts: On</button>
                    )}
                    {notifPerm === 'denied' && (
                        <button onClick={() => setNotice('Browser notifications are blocked for this site. Click the site icon in your address bar and allow Notifications.')} title="Click for instructions to unblock notifications">Alerts Blocked</button>
                    )}
                    <button onClick={() => void runLiveTestAlert('initiated')}>Test Prompt</button>
                    <button onClick={() => void runLiveTestAlert('completed')}>Test Paid</button>
                    <button onClick={() => void runLiveTestAlert('failed')}>Test Failed</button>
                    <button onClick={() => setDark(!dark)}>{dark ? 'Light' : 'Dark'}</button>
                    <a className="primary" href="/organizer">Publish Event</a>
                </div>
            </header>

            {(!audioUnlocked || audioBlocked) && <div className="notice" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                <span>{audioBlocked
                    ? 'Browser blocked automatic alert sound. Click Activate Sound & Alerts to enable audio chimes and desktop popups.'
                    : 'Click Activate Sound & Alerts once so new payment chimes and desktop notifications work automatically (even in background tabs).'}</span>
                <button className="primary" onClick={() => void activateAlerts()}>Activate Sound &amp; Alerts</button>
            </div>}

            {liveBanners.map(b => (
                <div key={b.id} role="alert" style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem',
                    padding: '0.75rem 1rem', marginBottom: '0.6rem', borderRadius: '10px',
                    background: b.tone === 'success' ? '#ecfdf5' : b.tone === 'failed' ? '#fef2f2' : '#fffbeb',
                    border: `1px solid ${b.tone === 'success' ? '#10b981' : b.tone === 'failed' ? '#ef4444' : '#f59e0b'}`,
                    color: b.tone === 'success' ? '#065f46' : b.tone === 'failed' ? '#991b1b' : '#92400e'
                }}>
                    <div>
                        <strong style={{ marginRight: '0.5rem' }}>{b.title}:</strong>
                        <span>{b.detail}</span>
                    </div>
                    <div className="actions">
                        <button className="primary" onClick={() => goToSection(b.target)}>Open</button>
                        <button onClick={() => setLiveBanners(prev => prev.filter(x => x.id !== b.id))}>Dismiss</button>
                    </div>
                </div>
            ))}

            {unacknowledgedDeposits.map(dep => (
                <div className="deposit-banner" role="alert" key={dep.reference}>
                    <div>
                        <strong>AWAITING M-PESA PIN</strong>
                        <span>
                            Customer: {dep.customerName} ({dep.customerPhone || dep.method}) · Amount: {money(dep.amountKes)} · Method: {dep.method} · Ref: {dep.reference}
                        </span>
                    </div>
                    <div className="actions">
                        <button className="primary" onClick={() => { setSection('Pending Deposits'); }}>Inspect</button>
                        <button onClick={() => void acknowledgeOne(dep._id || dep.reference)}>Dismiss</button>
                    </div>
                </div>
            ))}

            {notice && <p className="notice" role="status">{notice}</p>}

            {section === 'Dashboard Overview' && <AutomationOverview onNavigate={target => setSection(target as Section)} refreshKey={refreshKey} />}
            {section === 'Automated Discovery Center' && <DiscoveryCenterPanel />}
            {section === 'Ticket Management' && <TicketManagementPanel />}
            {section === 'Blog Manager' && <BlogManagerPanel storefrontUrl={data?.storefrontUrl} />}
            {section === 'Flight Management' && <FlightManagementPanel mode="manage" />}
            {section === 'Holiday Packages' && <HolidayPackagesPanel />}
            {section === 'Travel Fulfillment & Pricing' && <TravelOpsPanel />}
            {section === 'Pending Deposits' && <PendingDepositsPanel onAcknowledge={acknowledgeOne} refreshKey={refreshKey} />}
            {section === 'Payment settings' && <PaymentSettingsPanel />}
            {section === 'Support Contact' && <SupportContactPanel />}
            {section === 'Notifications' && <NotificationsPanel onAcknowledgeAll={acknowledgeAll} onReadOne={() => setUnreadCount(c => Math.max(0, c - 1))} onSendTest={runLiveTestAlert} refreshKey={refreshKey} />}
            {section === 'Reports' && <ReportsPanel />}
            {section === 'System Logs' && <SystemLogsPanel audit={audit} />}

            {section === 'All Events' && <section className="panel">
                <div className="actions"><input aria-label="Search events" placeholder="Search name or venue" value={query} onChange={event => {setQuery(event.target.value); setPage(0);}}/>
                <select aria-label="Event status" value={status} onChange={event => {setStatus(event.target.value); setPage(0);}}>
                    <option value="all">All statuses</option><option>published</option><option>unpublished</option><option>archived</option>
                </select></div>
                <div className="scroll"><table><thead><tr><th>Event</th><th>Venue</th><th>Starts</th><th>Status</th><th>Actions</th></tr></thead>
                    <tbody>{filteredEvents.slice(eventPage * 10, eventPage * 10 + 10).map(event => {
                        const isPast = Date.parse(event.startsAt) <= Date.now();
                        const st = eventStatus(event);
                        const storefrontBase = (data?.storefrontUrl || 'https://ticketsassa.ticketsassa.workers.dev').replace(/\/+$/, '');
                        return <tr key={event.id}>
                            <td>{event.image && <img src={event.image} alt="" loading="lazy" decoding="async" />}{event.title}</td>
                            <td>{event.venue}</td>
                            <td>
                                {date(event.startsAt)}
                                {isPast && <small style={{ display: 'block', color: '#b91c1c', fontWeight: 700 }}>Past date — hidden on storefront until rescheduled</small>}
                                {rescheduleId === event.id && (
                                    <div className="actions" style={{ marginTop: 6 }}>
                                        <input type="datetime-local" value={rescheduleAt} onChange={e => setRescheduleAt(e.target.value)} />
                                        <button className="primary" disabled={busy || !rescheduleAt} onClick={() => void run(async () => {
                                            await request('/events/' + encodeURIComponent(event.id), 'PATCH', { startsAt: rescheduleAt + '+03:00', status: 'published' });
                                            setRescheduleId(null);
                                            setRescheduleAt('');
                                            await load(true);
                                            setNotice(`"${event.title}" rescheduled to a future date and published — now visible in storefront search.`);
                                        })}>Save &amp; Publish</button>
                                        <button type="button" onClick={() => setRescheduleId(null)}>Cancel</button>
                                    </div>
                                )}
                            </td>
                            <td>{st}</td>
                            <td className="actions">
                                {['published', 'unpublished', 'archived'].filter(next => next !== st).map(next =>
                                    <button key={next} disabled={busy} onClick={() => void run(async () => {
                                        const res = await request<{ isPast?: boolean }>('/events/' + encodeURIComponent(event.id), 'PATCH', { status: next });
                                        await load(true);
                                        if (next === 'published' && res?.isPast) {
                                            setNotice(`"${event.title}" is marked published, but its start date (${date(event.startsAt)}) is in the past so it is hidden from Upcoming Events. Click "Reschedule" to set a future date.`);
                                        } else {
                                            setNotice('Event status updated.');
                                        }
                                    })}>{({ published: 'Publish', unpublished: 'Unpublish', archived: 'Archive' })[next]}</button>)}
                                <button type="button" disabled={busy} onClick={() => {
                                    const nextWeek = new Date(Date.now() + 7 * 86400000 + 3 * 3600000).toISOString().slice(0, 16);
                                    setRescheduleId(event.id);
                                    setRescheduleAt(nextWeek);
                                }}>Reschedule</button>
                                {st === 'published' && !isPast && (
                                    <a className="primary" href={`${storefrontBase}/?view=events&event=${encodeURIComponent(event.id)}&fresh=1`} target="_blank" rel="noreferrer">View Live</a>
                                )}
                            </td>
                        </tr>;
                    })}</tbody></table></div>
                {!filteredEvents.length && <p>No matching organizer events.</p>}
                <div className="actions"><button disabled={eventPage === 0} onClick={() => setPage(eventPage - 1)}>Previous</button><span>Page {eventPage + 1}</span>
                <button disabled={(eventPage + 1) * 10 >= filteredEvents.length} onClick={() => setPage(eventPage + 1)}>Next</button></div>
            </section>}

            {section === 'Transactions' && <div className="publishing-lobby">
                <section className="panel"><h2>M-Pesa payment provider</h2><p>Manage PayHero and NexusPay for new payments.</p><button onClick={() => setSection('Payment settings')}>Open payment settings</button></section>
                <section className="panel">
                    <div className="actions">
                        <input aria-label="Search transactions" placeholder="Search reference, customer, phone, or receipt" value={query} onChange={event => {setQuery(event.target.value);setSelected(undefined);}}/>
                        <button onClick={() => void run(() => load(true))}>Refresh</button>
                        <button disabled={!filteredOrders.length} onClick={() => exportOrders(filteredOrders)}>Download CSV</button>
                    </div>
                    {!filteredOrders.length && <p>No matching live transactions.</p>}
                    <div className="scroll"><table><thead><tr><th>#</th><th>Reference</th><th>Customer &amp; Phone</th><th>Items</th><th>Status</th><th>M-Pesa Code / Failure Reason</th><th>Total</th><th></th></tr></thead><tbody>{filteredOrders.map((order, idx) =>
                        <tr key={order.orderReference}>
                            <td><strong>#{idx + 1}</strong></td>
                            <td><strong>{order.orderReference}</strong>{order.createdAt && <small style={{ display: 'block', opacity: 0.7 }}>{date(order.createdAt)}</small>}</td>
                            <td>{order.customer.name}{order.customer.phone && <small style={{ display: 'block', opacity: 0.75 }}>{order.customer.phone}</small>}</td>
                            <td><small>{(order.items || []).map(i => `${i.quantity}× ${i.title}`).join(', ') || '—'}</small></td>
                            <td><PaymentBadge status={order.paymentStatus}/></td>
                            <td>{order.paymentStatus === 'COMPLETED'
                                ? <span style={{ color: '#15803d', fontWeight: 700, fontFamily: 'monospace' }}>{order.receipt ? `M-Pesa: ${order.receipt}` : 'Paid'}{order.paidAt ? ` · ${date(order.paidAt)}` : ''}</span>
                                : order.paymentStatus === 'FAILED'
                                    ? <span style={{ color: '#b91c1c', fontWeight: 600 }}>{order.failureReason || 'Payment failed'}{order.failureCode ? ` (Code ${order.failureCode})` : ''}</span>
                                    : order.failureReason
                                        ? <span style={{ color: '#b45309', fontWeight: 600 }}>{order.failureReason}</span>
                                        : 'Awaiting M-Pesa confirmation'}</td>
                            <td><strong>{money(order.totalKes)}</strong></td>
                            <td><button onClick={() => setSelected(order)}>View order</button></td>
                        </tr>)}</tbody></table></div>
                    {selected && <section className="detail"><h2>Order details</h2><p>{selected.customer.name} · {selected.customer.email}{selected.customer.phone ? ` · ${selected.customer.phone}` : ''}</p>
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
                            await load(true);
                        })}>Check M-Pesa status</button>}
                        <button onClick={() => setSelected(undefined)}>Close details</button></section>}
                </section>
            </div>}
        </main>
    </div>;
}

createRoot(document.getElementById('root')!).render(<App />);
