import React, { useEffect, useState } from 'react';
import { autoRequest } from './automationPanels';

const money = (value: number | null | undefined, currency = 'KES') =>
    value == null ? 'Price on Request' : new Intl.NumberFormat('en-KE', { style: 'currency', currency }).format(value);
const dateFmt = (value?: string | null) =>
    value ? new Intl.DateTimeFormat('en-KE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Nairobi' }).format(new Date(value)) : '—';

type SubTab = 'listings' | 'sources' | 'logs' | 'rules';

export function DiscoveryCenterPanel() {
    const [tab, setTab] = useState<SubTab>('listings');
    const [overviewData, setOverviewData] = useState<any>();
    const [listingKind, setListingKind] = useState<'events' | 'flights' | 'holidays'>('events');
    const [approvalFilter, setApprovalFilter] = useState<'all' | 'approved' | 'pending' | 'rejected'>('all');
    const [searchQ, setSearchQ] = useState('');
    const [listings, setListings] = useState<any[]>([]);
    const [sources, setSources] = useState<any[]>([]);
    const [logs, setLogs] = useState<any[]>([]);
    const [logKind, setLogKind] = useState('all');
    const [settings, setSettings] = useState<any>();
    const [meta, setMeta] = useState<any>();
    const [editing, setEditing] = useState<any>(null);
    const [sourceForm, setSourceForm] = useState({ name: '', type: 'event', adapter: 'public_events_html', url: '' });
    const [msg, setMsg] = useState('');
    const [busy, setBusy] = useState(false);

    async function loadOverview() {
        const res = await autoRequest<any>('/discovery-center/overview');
        setOverviewData(res);
    }

    async function loadListings() {
        if (listingKind === 'events') {
            const params = new URLSearchParams({ approvalStatus: approvalFilter, q: searchQ });
            const r = await autoRequest<{ data: any[] }>('/events?' + params.toString());
            setListings(r.data || []);
        } else if (listingKind === 'flights') {
            const r = await autoRequest<{ data: any[] }>('/flights?q=' + encodeURIComponent(searchQ));
            const rows = r.data || [];
            setListings(approvalFilter === 'all' ? rows : rows.filter((x: any) => x.approvalStatus === approvalFilter));
        } else {
            const r = await autoRequest<{ data: any[] }>('/holidays');
            const rows = (r.data || []).filter((x: any) => !searchQ.trim() || [x.title, x.destination, x.provider].join(' ').toLowerCase().includes(searchQ.trim().toLowerCase()));
            setListings(approvalFilter === 'all' ? rows : rows.filter((x: any) => x.approvalStatus === approvalFilter));
        }
    }

    async function loadSources() {
        const r = await autoRequest<{ data: any[] }>('/sources');
        setSources(r.data || []);
    }

    async function loadLogs() {
        const r = await autoRequest<{ data: any[] }>(`/discovery-center/logs?kind=${encodeURIComponent(logKind)}&limit=100`);
        setLogs(r.data || []);
    }

    async function loadSettings() {
        const r = await autoRequest<any>('/settings');
        setSettings(r.settings);
        setMeta(r.meta);
    }

    useEffect(() => {
        void loadOverview().catch(e => setMsg(e.message));
        void loadListings().catch(() => {});
        void loadSources().catch(() => {});
        void loadSettings().catch(() => {});
    }, []);

    useEffect(() => { void loadListings().catch(() => {}); }, [listingKind, approvalFilter]);
    useEffect(() => { if (tab === 'logs') void loadLogs().catch(() => {}); }, [tab, logKind]);

    async function control(action: string, kind = 'all') {
        setBusy(true);
        setMsg('');
        try {
            const res = await autoRequest<any>('/discovery-center/control', 'POST', { action, kind });
            setMsg(res.message || `Worker action "${action}" applied.`);
            await loadOverview();
            if (action === 'search_now' || action === 'start') {
                setTimeout(() => {
                    void loadOverview().catch(() => {});
                    void loadListings().catch(() => {});
                    void loadSources().catch(() => {});
                }, 3500);
            }
        } catch (err: any) {
            setMsg(err.message);
        } finally {
            setBusy(false);
        }
    }

    async function verifySource(item: any) {
        const url = item.originalUrl || item.bookingUrl;
        if (!url) { setMsg('No source URL recorded on this listing.'); return; }
        setBusy(true);
        try {
            const entityType = listingKind === 'events' ? 'event' : listingKind === 'flights' ? 'flight' : 'holiday';
            const r = await autoRequest<any>('/discovery-center/verify-source', 'POST', { entityType, id: item._id, url });
            setMsg(r.verified ? `Source link verified (HTTP ${r.status}).` : `Source check returned HTTP ${r.status || 'unreachable'}.`);
            await loadListings();
        } catch (e: any) { setMsg(e.message); }
        finally { setBusy(false); }
    }

    async function togglePublish(item: any) {
        setBusy(true);
        try {
            const nextStatus = item.approvalStatus === 'approved' ? 'pending' : 'approved';
            const path = listingKind === 'events' ? `/events/${item._id}` : listingKind === 'flights' ? `/flights/${item._id}` : `/holidays/${item._id}`;
            await autoRequest(path, 'PATCH', { approvalStatus: nextStatus });
            setMsg(nextStatus === 'approved' ? 'Listing published to website.' : 'Listing unpublished to review queue.');
            await Promise.all([loadListings(), loadOverview()]);
        } catch (e: any) { setMsg(e.message); }
        finally { setBusy(false); }
    }

    async function deleteItem(item: any) {
        setBusy(true);
        try {
            const path = listingKind === 'events' ? `/events/${item._id}` : listingKind === 'flights' ? `/flights/${item._id}` : `/holidays/${item._id}`;
            await autoRequest(path, 'DELETE');
            setMsg('Listing deleted.');
            await Promise.all([loadListings(), loadOverview()]);
        } catch (e: any) { setMsg(e.message); }
        finally { setBusy(false); }
    }

    async function saveEdit(e: React.FormEvent) {
        e.preventDefault();
        if (!editing) return;
        setBusy(true);
        try {
            if (listingKind === 'events') {
                await autoRequest(`/events/${editing._id}`, 'PATCH', {
                    name: editing.name,
                    description: editing.description,
                    venue: editing.venue,
                    confirmedPriceKes: editing.priceInput === '' ? null : Number(editing.priceInput),
                    priceType: editing.priceInput === '' ? 'unavailable' : 'verified',
                    image: { ...(editing.image || {}), url: editing.imageUrlInput, license: editing.image?.license || 'Admin Updated Media' }
                });
            } else if (listingKind === 'flights') {
                await autoRequest(`/flights/${editing._id}`, 'PATCH', {
                    flightNumber: editing.flightNumber,
                    priceKes: editing.priceInput === '' ? null : Number(editing.priceInput),
                    priceType: editing.priceInput === '' ? 'unavailable' : 'verified',
                    priceStatus: editing.priceInput === '' ? 'price_on_request' : 'verified',
                    bookingUrl: editing.bookingUrl
                });
            } else {
                await autoRequest(`/holidays/${editing._id}`, 'PATCH', {
                    title: editing.title,
                    description: editing.description,
                    destination: editing.destination,
                    pricePerPerson: editing.priceInput === '' ? null : Number(editing.priceInput),
                    currency: editing.currency || 'KES',
                    images: [{ url: editing.imageUrlInput, attribution: editing.provider || 'Admin', license: 'Admin Verified' }]
                });
            }
            setEditing(null);
            setMsg('Listing updated.');
            await loadListings();
        } catch (err: any) { setMsg(err.message); }
        finally { setBusy(false); }
    }

    const ov = overviewData?.overview || {};
    const ws = overviewData?.workerStatus || {};

    return <div className="publishing-lobby">
        {msg && <p className="notice" role="status">{msg}</p>}

        {/* Discovery Controls Header */}
        <section className="panel">
            <div className="lobby-toolbar">
                <div>
                    <h2>API-Free Automated Internet Discovery &amp; Auto-Publishing Center</h2>
                    <p role="status">
                        Worker Status: <strong>{(ws.status || 'idle').toUpperCase()}</strong>
                        {ws.nextRunSchedule?.eventsAt ? ` · Next Events Scan: ${dateFmt(ws.nextRunSchedule.eventsAt)}` : ''}
                        {ws.nextRunSchedule?.flightsAt ? ` · Next Flights Scan: ${dateFmt(ws.nextRunSchedule.flightsAt)}` : ''}
                    </p>
                </div>
                <div className="actions">
                    <button className="primary" disabled={busy} onClick={() => void control('search_now', 'all')}>Search All Now</button>
                    <button disabled={busy} onClick={() => void control('search_now', 'events')}>Events Only</button>
                    <button disabled={busy} onClick={() => void control('search_now', 'flights')}>Flights Only</button>
                    <button disabled={busy} onClick={() => void control('search_now', 'holidays')}>Holidays Only</button>
                    {ws.paused
                        ? <button className="primary" disabled={busy} onClick={() => void control('resume')}>Resume Auto</button>
                        : <button disabled={busy} onClick={() => void control('pause')}>Pause Auto</button>}
                    <button disabled={busy} onClick={async () => {
                        setBusy(true);
                        const r = await autoRequest<any>('/discovery-center/cleanup-duplicates', 'POST', {});
                        setMsg(`Duplicate cleanup removed ${r.totalRemoved} duplicate(s).`);
                        await Promise.all([loadListings(), loadOverview()]);
                        setBusy(false);
                    }}>Delete Duplicates</button>
                    <button disabled={busy} onClick={async () => {
                        setBusy(true);
                        const r = await autoRequest<any>('/events/cleanup-expired', 'POST', {});
                        setMsg(`Removed ${r.removedCount} expired listing(s).`);
                        await Promise.all([loadListings(), loadOverview()]);
                        setBusy(false);
                    }}>Remove Expired</button>
                </div>
            </div>

            {/* 9 Discovery Overview KPI Cards */}
            <div className="metrics" style={{ marginTop: 14 }}>
                {[
                    ['Total Websites Discovered', ov.totalWebsitesDiscovered ?? 0],
                    ['Websites Monitored', ov.websitesMonitored ?? 0],
                    ['Total Events Found', ov.totalEventsFound ?? 0],
                    ['Total Flights Found', ov.totalFlightsFound ?? 0],
                    ['Total Holidays Found', ov.totalHolidaysFound ?? 0],
                    ['Listings Published', ov.listingsPublished ?? 0],
                    ['Awaiting Verification', ov.listingsAwaitingVerification ?? 0],
                    ['Failed Discoveries', ov.failedDiscoveries ?? 0],
                    ['Duplicate Listings Detected', ov.duplicateListingsDetected ?? 0]
                ].map(([label, val]) => <article key={label}><span>{label}</span><strong>{val}</strong></article>)}
            </div>

            <div className="actions" style={{ marginTop: 14 }}>
                <button className={tab === 'listings' ? 'primary' : ''} onClick={() => setTab('listings')}>Discovered Listings</button>
                <button className={tab === 'sources' ? 'primary' : ''} onClick={() => setTab('sources')}>Monitored Websites ({sources.length})</button>
                <button className={tab === 'logs' ? 'primary' : ''} onClick={() => setTab('logs')}>Extraction, Image &amp; Publishing Logs</button>
                <button className={tab === 'rules' ? 'primary' : ''} onClick={() => setTab('rules')}>Schedules &amp; Auto-Publish Rules</button>
            </div>
        </section>

        {/* TAB 1: Listing Management */}
        {tab === 'listings' && <section className="panel">
            <div className="actions" style={{ marginBottom: 14 }}>
                <select value={listingKind} onChange={e => setListingKind(e.target.value as any)}>
                    <option value="events">Events (47 Counties)</option>
                    <option value="flights">Flights (Airlines &amp; Airports)</option>
                    <option value="holidays">Holidays &amp; Travel Packages</option>
                </select>
                <select value={approvalFilter} onChange={e => setApprovalFilter(e.target.value as any)}>
                    <option value="all">All Statuses</option>
                    <option value="approved">Published</option>
                    <option value="pending">Awaiting Verification</option>
                    <option value="rejected">Rejected</option>
                </select>
                <input placeholder="Search title, destination, venue, source…" value={searchQ} onChange={e => setSearchQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && void loadListings()} />
                <button onClick={() => void loadListings()}>Search</button>
            </div>

            {editing && <form className="panel" style={{ border: '2px solid #D81A21', marginBottom: 16 }} onSubmit={saveEdit}>
                <h3>Edit Discovered {listingKind === 'events' ? 'Event' : listingKind === 'flights' ? 'Flight' : 'Holiday'}</h3>
                <div className="form-grid">
                    {listingKind === 'events' && <>
                        <label>Title<input value={editing.name || ''} onChange={e => setEditing({ ...editing, name: e.target.value })} /></label>
                        <label>Venue<input value={editing.venue || ''} onChange={e => setEditing({ ...editing, venue: e.target.value })} /></label>
                        <label>Price (KES)<input type="number" value={editing.priceInput ?? ''} onChange={e => setEditing({ ...editing, priceInput: e.target.value })} /></label>
                        <label>Image URL<input value={editing.imageUrlInput || ''} onChange={e => setEditing({ ...editing, imageUrlInput: e.target.value })} /></label>
                        <label>Description<input value={editing.description || ''} onChange={e => setEditing({ ...editing, description: e.target.value })} /></label>
                    </>}
                    {listingKind === 'flights' && <>
                        <label>Flight Number<input value={editing.flightNumber || ''} onChange={e => setEditing({ ...editing, flightNumber: e.target.value })} /></label>
                        <label>Published Price (KES)<input type="number" value={editing.priceInput ?? ''} onChange={e => setEditing({ ...editing, priceInput: e.target.value })} /></label>
                        <label>Booking URL<input value={editing.bookingUrl || ''} onChange={e => setEditing({ ...editing, bookingUrl: e.target.value })} /></label>
                    </>}
                    {listingKind === 'holidays' && <>
                        <label>Title<input value={editing.title || ''} onChange={e => setEditing({ ...editing, title: e.target.value })} /></label>
                        <label>Destination<input value={editing.destination || ''} onChange={e => setEditing({ ...editing, destination: e.target.value })} /></label>
                        <label>Price ({editing.currency || 'KES'})<input type="number" value={editing.priceInput ?? ''} onChange={e => setEditing({ ...editing, priceInput: e.target.value })} /></label>
                        <label>Image URL<input value={editing.imageUrlInput || ''} onChange={e => setEditing({ ...editing, imageUrlInput: e.target.value })} /></label>
                        <label>Description<input value={editing.description || ''} onChange={e => setEditing({ ...editing, description: e.target.value })} /></label>
                    </>}
                    <button className="primary" type="submit" disabled={busy}>Save Changes</button>
                    <button type="button" onClick={() => setEditing(null)}>Cancel</button>
                </div>
            </form>}

            <div className="discovery-grid">
                {listings.map(item => {
                    const title = item.name || item.title || `${item.airline} ${item.originCode} → ${item.destinationCode}`;
                    const img = listingKind === 'events' ? item.image?.url : listingKind === 'flights' ? item.airlineLogo : item.images?.[0]?.url;
                    const srcUrl = item.originalUrl || item.bookingUrl;
                    const priceVal = listingKind === 'events' ? (item.confirmedPriceKes ?? item.estimatedPriceKes) : item.priceKes;
                    return <article className="panel discovery-card" key={item._id}>
                        <div className="discovery-media" style={listingKind === 'flights' ? { height: 110, background: '#f8fafc', padding: 16 } : undefined}>
                            <img src={img || '/assets/real/DzLV4G9UWo-1790859483.jpg'} alt={title}
                                style={listingKind === 'flights' ? { objectFit: 'contain' } : undefined}
                                onError={e => { (e.currentTarget as HTMLImageElement).src = '/assets/real/DzLV4G9UWo-1790859483.jpg'; }} />
                            <span className="discovery-badge">{item.approvalStatus}</span>
                            <span className="discovery-price-mode" data-mode={item.priceType === 'verified' ? 'live' : 'estimated'}>
                                {priceVal == null ? 'Price on Request' : money(priceVal)}
                            </span>
                        </div>
                        <div className="discovery-body">
                            <h3>{title}</h3>
                            {listingKind === 'events' && <p className="discovery-meta">{item.category} · {item.venue}, {item.county} · {dateFmt(item.startsAt)}</p>}
                            {listingKind === 'flights' && <p className="discovery-meta">{item.routeSummary || `${item.originCode} → ${item.destinationCode}`} · {item.departureTime ? dateFmt(item.departureTime) : 'Verified Route (Check Airline Schedule)'}</p>}
                            {listingKind === 'holidays' && <p className="discovery-meta">{item.destination} · {item.duration || (item.nights ? `${item.nights} Nights` : '')} · {item.provider}</p>}
                            {item.description && <p className="discovery-meta">{String(item.description).slice(0, 120)}{item.description.length > 120 ? '…' : ''}</p>}
                            <p className="discovery-meta">Verified: {dateFmt(item.lastVerifiedAt)} {srcUrl && <>· <a href={srcUrl} target="_blank" rel="noreferrer">Original Source</a></>}</p>
                            {!!item.validationIssues?.length && <p className="discovery-meta" style={{ color: '#b91c1c' }}>Review note: {item.validationIssues.join(', ')}</p>}
                            <div className="actions">
                                <button className={item.approvalStatus === 'approved' ? '' : 'primary'} onClick={() => void togglePublish(item)}>
                                    {item.approvalStatus === 'approved' ? 'Unpublish' : 'Publish'}
                                </button>
                                <button onClick={() => setEditing({
                                    ...item,
                                    priceInput: priceVal ?? '',
                                    imageUrlInput: img || ''
                                })}>Edit</button>
                                <button onClick={() => void verifySource(item)}>Verify Link</button>
                                <button onClick={() => void deleteItem(item)}>Delete</button>
                            </div>
                        </div>
                    </article>;
                })}
                {!listings.length && <p>No listings found. Click "Search All Now" to discover live public listings.</p>}
            </div>
        </section>}

        {/* TAB 2: Monitored Websites */}
        {tab === 'sources' && <div className="publishing-lobby">
            <section className="panel">
                <h3>Add Public Website / RSS / Sitemap Source (No API Key Required)</h3>
                <form className="form-grid" onSubmit={async e => {
                    e.preventDefault();
                    setBusy(true);
                    try {
                        await autoRequest('/sources', 'POST', sourceForm);
                        setSourceForm({ name: '', type: 'event', adapter: 'public_events_html', url: '' });
                        setMsg('Public discovery source added.');
                        await Promise.all([loadSources(), loadOverview()]);
                    } catch (err: any) { setMsg(err.message); }
                    finally { setBusy(false); }
                }}>
                    <input required placeholder="Website Name" value={sourceForm.name} onChange={e => setSourceForm({ ...sourceForm, name: e.target.value })} />
                    <select value={sourceForm.type} onChange={e => {
                        const t = e.target.value;
                        const adapter = t === 'flight' ? 'public_flights_html' : t === 'holiday' ? 'public_holidays_html' : 'public_events_html';
                        setSourceForm({ ...sourceForm, type: t, adapter });
                    }}><option value="event">Events</option><option value="flight">Flights</option><option value="holiday">Holidays</option></select>
                    <select value={sourceForm.adapter} onChange={e => setSourceForm({ ...sourceForm, adapter: e.target.value })}>
                        <option value="public_events_html">Public Events HTML / JSON-LD</option>
                        <option value="rss_events">Public RSS Feed</option>
                        <option value="public_flights_html">Airline Route &amp; Fare HTML</option>
                        <option value="public_holidays_html">Tour / Holiday HTML</option>
                    </select>
                    <input required type="url" placeholder="https://..." value={sourceForm.url} onChange={e => setSourceForm({ ...sourceForm, url: e.target.value })} />
                    <button className="primary" type="submit" disabled={busy}>Add Website</button>
                </form>
            </section>
            <section className="panel">
                <h3>Monitored Public Sources ({sources.length})</h3>
                <div className="scroll"><table>
                    <thead><tr><th>Website</th><th>Type / Adapter</th><th>Status</th><th>robots.txt</th><th>Items</th><th>Last Crawl</th><th>Actions</th></tr></thead>
                    <tbody>{sources.map(s => <tr key={s._id}>
                        <td><strong>{s.name}</strong><small>{s.url}</small></td>
                        <td>{s.type} · {s.adapter}</td>
                        <td><span className="sync-badge" data-state={s.lastStatus}>{s.lastStatus}</span>{s.lastError && <small>{s.lastError}</small>}</td>
                        <td>{s.robotsAllowed === false ? 'Disallowed' : 'Allowed'}</td>
                        <td>{s.itemCount ?? 0}</td>
                        <td>{dateFmt(s.lastRunAt)} ({s.lastCrawlDurationMs || 0}ms)</td>
                        <td className="actions">
                            <button onClick={async () => { await autoRequest('/sources/' + s._id, 'PATCH', { enabled: !s.enabled }); await loadSources(); }}>{s.enabled ? 'Disable' : 'Enable'}</button>
                            <button onClick={async () => { await autoRequest('/sources/' + s._id, 'DELETE'); await loadSources(); }}>Remove</button>
                        </td>
                    </tr>)}</tbody>
                </table></div>
            </section>
        </div>}

        {/* TAB 3: Extraction, Image & Publishing Logs */}
        {tab === 'logs' && <section className="panel">
            <div className="lobby-toolbar">
                <h3>Discovery Logs &amp; Publishing History ({logs.length})</h3>
                <div className="actions">
                    <select value={logKind} onChange={e => setLogKind(e.target.value)}>
                        <option value="all">All Logs</option>
                        <option value="extraction">Extraction Logs</option>
                        <option value="image">Image Collection Logs</option>
                        <option value="publish">Publishing History</option>
                        <option value="robots_skip">robots.txt Skips</option>
                        <option value="error">Failed / Restricted Sources</option>
                    </select>
                    <button onClick={() => void loadLogs()}>Refresh Logs</button>
                </div>
            </div>
            <div className="scroll"><table>
                <thead><tr><th>Time</th><th>Kind</th><th>Source</th><th>Entity</th><th>Message</th></tr></thead>
                <tbody>{logs.map(l => <tr key={l._id}>
                    <td>{dateFmt(l.createdAt)}</td>
                    <td><strong>{l.kind}</strong></td>
                    <td>{l.sourceName}</td>
                    <td>{l.entityType}</td>
                    <td>{l.message}{l.url && <small><a href={l.url} target="_blank" rel="noreferrer">{l.url}</a></small>}</td>
                </tr>)}</tbody>
            </table></div>
            {!logs.length && <p>No logs recorded for this filter yet.</p>}
        </section>}

        {/* TAB 4: Automation Rules & Schedules */}
        {tab === 'rules' && settings && <section className="panel">
            <h3>Configurable Discovery Schedules &amp; Auto-Publishing Rules</h3>
            <div className="form-grid" style={{ marginTop: 12 }}>
                <label>Events Search (hours)<input type="number" min="1" max="168" value={settings.schedules?.eventsHours ?? 6} onChange={e => setSettings({ ...settings, schedules: { ...settings.schedules, eventsHours: Number(e.target.value) } })} /></label>
                <label>Flights Search (hours)<input type="number" min="1" max="168" value={settings.schedules?.flightsHours ?? 3} onChange={e => setSettings({ ...settings, schedules: { ...settings.schedules, flightsHours: Number(e.target.value) } })} /></label>
                <label>Holidays Search (hours)<input type="number" min="1" max="168" value={settings.schedules?.holidaysHours ?? 12} onChange={e => setSettings({ ...settings, schedules: { ...settings.schedules, holidaysHours: Number(e.target.value) } })} /></label>
                <label>Image Refresh (hours)<input type="number" min="1" max="336" value={settings.schedules?.imageRefreshHours ?? 24} onChange={e => setSettings({ ...settings, schedules: { ...settings.schedules, imageRefreshHours: Number(e.target.value) } })} /></label>
                <label>Expiration Check (hours)<input type="number" min="1" max="72" value={settings.schedules?.expirationCheckHours ?? 1} onChange={e => setSettings({ ...settings, schedules: { ...settings.schedules, expirationCheckHours: Number(e.target.value) } })} /></label>
                <label>Auto-Publish Events<select value={String(settings.autoPublish?.events !== false)} onChange={e => setSettings({ ...settings, autoPublish: { ...(settings.autoPublish || {}), events: e.target.value === 'true' } })}><option value="true">Enabled</option><option value="false">Review Queue Only</option></select></label>
                <label>Auto-Publish Flights<select value={String(settings.autoPublish?.flights !== false)} onChange={e => setSettings({ ...settings, autoPublish: { ...(settings.autoPublish || {}), flights: e.target.value === 'true' } })}><option value="true">Enabled</option><option value="false">Review Queue Only</option></select></label>
                <label>Auto-Publish Holidays<select value={String(settings.autoPublish?.holidays !== false)} onChange={e => setSettings({ ...settings, autoPublish: { ...(settings.autoPublish || {}), holidays: e.target.value === 'true' } })}><option value="true">Enabled</option><option value="false">Review Queue Only</option></select></label>
                <label>Require Price to Auto-Publish<select value={String(Boolean(settings.autoPublish?.requirePrice))} onChange={e => setSettings({ ...settings, autoPublish: { ...(settings.autoPublish || {}), requirePrice: e.target.value === 'true' } })}><option value="false">Allow "Price on Request"</option><option value="true">Require Published Price</option></select></label>
                <button className="primary" onClick={async () => {
                    setBusy(true);
                    const r = await autoRequest<any>('/settings', 'PUT', { schedules: settings.schedules, autoPublish: settings.autoPublish, enabledCounties: settings.enabledCounties });
                    setSettings(r.settings);
                    setMsg('Schedules, counties, and auto-publish rules saved.');
                    setBusy(false);
                }}>Save Automation Rules</button>
            </div>
            {meta?.counties?.length > 0 && (
                <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
                    <div className="lobby-toolbar">
                        <h3>Active Kenyan Counties ({settings.enabledCounties?.length || 0} / 47)</h3>
                        <div className="actions">
                            <button type="button" onClick={() => setSettings({ ...settings, enabledCounties: meta.counties })}>Select All 47</button>
                            <button type="button" onClick={() => setSettings({ ...settings, enabledCounties: ['Nairobi', 'Mombasa', 'Kilifi', 'Kwale', 'Nakuru', 'Kisumu', 'Uasin Gishu'] })}>Major Hubs Only</button>
                        </div>
                    </div>
                    <div className="chip-grid">
                        {meta.counties.map((c: string) => {
                            const active = (settings.enabledCounties || []).includes(c);
                            return <button type="button" key={c} className={active ? 'chip active' : 'chip'} onClick={() => {
                                const next = active ? settings.enabledCounties.filter((x: string) => x !== c) : [...(settings.enabledCounties || []), c];
                                setSettings({ ...settings, enabledCounties: next });
                            }}>{c}</button>;
                        })}
                    </div>
                </div>
            )}
        </section>}
    </div>;
}
