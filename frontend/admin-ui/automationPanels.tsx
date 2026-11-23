import React, { useEffect, useState } from 'react';

const money = (value: number, currency = 'KES') =>
    new Intl.NumberFormat('en-KE', { style: 'currency', currency }).format(value || 0);
const dateFmt = (value: string) =>
    value ? new Intl.DateTimeFormat('en-KE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Nairobi' }).format(new Date(value)) : '—';

export async function autoRequest<T>(path: string, method = 'GET', body?: object): Promise<T> {
    const res = await fetch('/api/admin/automation' + path, {
        method,
        credentials: 'same-origin',
        headers: method === 'GET' ? undefined : { 'Content-Type': 'application/json', 'X-Admin-Action': 'dashboard' },
        body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.message || `Request failed (${res.status})`);
    }
    return res.json();
}

function BarChart({ title, rows, valueSuffix = '' }: { title: string; rows: { label: string; value: number }[]; valueSuffix?: string }) {
    const max = Math.max(1, ...rows.map(r => r.value));
    return <section className="panel chart-card">
        <h3>{title}</h3>
        {!rows.length ? <p className="muted">No data recorded yet.</p> : <div className="bar-list">
            {rows.map((row, idx) => <div className="bar-row" key={idx}>
                <div className="bar-label"><span>{row.label}</span><strong>{row.value.toLocaleString('en-KE')}{valueSuffix}</strong></div>
                <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.max(4, Math.round((row.value / max) * 100))}%` }} /></div>
            </div>)}
        </div>}
    </section>;
}

export function AutomationOverview({ onNavigate }: { onNavigate: (section: string) => void }) {
    const [data, setData] = useState<any>();
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    async function load() {
        try {
            setData(await autoRequest('/overview'));
            setError('');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load overview.');
        }
    }

    useEffect(() => { void load(); }, []);

    async function triggerRun(kind: string) {
        setBusy(true);
        try {
            await autoRequest('/jobs/run', 'POST', { kind });
            setTimeout(() => void load(), 2500);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to start job.');
        } finally { setBusy(false); }
    }

    if (!data) return <p className="panel">{error || 'Loading dashboard overview…'}</p>;
    const s = data.stats || {};
    const kpis: [string, string | number, string][] = [
        ['Total Discovered Events', s.totalDiscoveredEvents ?? 0, 'Event Discovery'],
        ['Upcoming Events', s.upcomingEvents ?? 0, 'Event Discovery'],
        ['Pending Event Approvals', s.pendingEventApprovals ?? 0, 'Event Discovery'],
        ['Approved Events', s.approvedEvents ?? 0, 'All Events'],
        ['Tickets Generated', s.ticketsGenerated ?? 0, 'Ticket Management'],
        ['Tickets Sold (Live)', s.ticketsSold ?? 0, 'Transactions'],
        ['Estimated Revenue', money(s.estimatedRevenueKes ?? 0), 'Reports'],
        ['Available Flights', s.availableFlights ?? 0, 'Flight Management'],
        ['Holiday Packages', s.holidayPackages ?? 0, 'Holiday Packages'],
        ['Pending Deposits', s.pendingDeposits ?? 0, 'Pending Deposits'],
        ['Successful Deposits', s.successfulDeposits ?? 0, 'Transactions'],
        ['Failed Deposits', s.failedDeposits ?? 0, 'Transactions']
    ];

    return <div className="publishing-lobby">
        {error && <p className="notice">{error}</p>}
        <section className="panel">
            <div className="lobby-toolbar">
                <div><h2>Operations Overview</h2><p>Real-time events, flights, holidays &amp; deposit automation metrics.</p></div>
                <div className="actions">
                    <button className="primary" disabled={busy} onClick={() => void triggerRun('all')}>{busy ? 'Starting…' : 'Run All Discovery Now'}</button>
                    <button onClick={() => void load()}>Refresh</button>
                </div>
            </div>
        </section>
        <div className="metrics">
            {kpis.map(([label, val, target]) => (
                <article key={label} style={{ cursor: 'pointer' }} onClick={() => onNavigate(target)}>
                    <span>{label}</span>
                    <strong>{val}</strong>
                </article>
            ))}
        </div>
        <div className="charts-grid">
            <BarChart title="Daily Sales (Last 7 Days · KES)" rows={(data.charts?.dailySeries || []).map((d: any) => ({ label: d.day, value: d.salesKes }))} valueSuffix=" KES" />
            <BarChart title="Daily Deposits Initiated (Last 7 Days)" rows={(data.charts?.dailySeries || []).map((d: any) => ({ label: d.day, value: d.depositsCount }))} />
            <BarChart title="Top Kenyan Counties by Events" rows={data.charts?.topDestinations || []} />
            <BarChart title="Discovery Activity (Found per Run)" rows={(data.charts?.discoveryActivity || []).map((d: any) => ({ label: `${d.kind} · ${d.label}`, value: d.found }))} />
        </div>
    </div>;
}

export function EventDiscoveryPanel() {
    const [events, setEvents] = useState<any[]>([]);
    const [meta, setMeta] = useState<{ counties: string[]; eventCategories: string[] }>({ counties: [], eventCategories: [] });
    const [county, setCounty] = useState('all');
    const [category, setCategory] = useState('all');
    const [approval, setApproval] = useState('all');
    const [q, setQ] = useState('');
    const [msg, setMsg] = useState('');
    const [busy, setBusy] = useState(false);

    async function load() {
        const params = new URLSearchParams({ county, category, approvalStatus: approval, q });
        const [evRes, metaRes] = await Promise.all([
            autoRequest<{ data: any[] }>('/events?' + params.toString()),
            fetch('/api/automation/meta').then(r => r.json())
        ]);
        setEvents(evRes.data || []);
        setMeta(metaRes);
    }

    useEffect(() => { void load().catch(e => setMsg(e.message)); }, [county, category, approval]);

    async function updateEvent(id: string, patch: object, label: string) {
        setBusy(true);
        try {
            await autoRequest('/events/' + id, 'PATCH', patch);
            setMsg(label);
            await load();
        } catch (e: any) { setMsg(e.message); }
        finally { setBusy(false); }
    }

    return <div className="publishing-lobby">
        {msg && <p className="notice" role="status">{msg}</p>}
        <section className="panel">
            <div className="lobby-toolbar">
                <div><h2>Automated Event Discovery (47 Counties of Kenya)</h2><p>{events.length} upcoming events in view</p></div>
                <div className="actions">
                    <button className="primary" disabled={busy} onClick={async () => {
                        setBusy(true);
                        try { await autoRequest('/jobs/run', 'POST', { kind: 'events' }); setMsg('Event discovery job started in background.'); setTimeout(() => void load(), 3000); }
                        catch (e: any) { setMsg(e.message); } finally { setBusy(false); }
                    }}>Scan 47 Counties Now</button>
                    <button disabled={busy} onClick={async () => {
                        setBusy(true);
                        try { const r = await autoRequest<{ removedCount: number }>('/events/cleanup-expired', 'POST', {}); setMsg(`Removed ${r.removedCount} expired listings.`); await load(); }
                        catch (e: any) { setMsg(e.message); } finally { setBusy(false); }
                    }}>Remove Expired</button>
                </div>
            </div>
            <div className="actions" style={{ marginTop: 12 }}>
                <input placeholder="Search event, venue, source…" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && void load()} />
                <button onClick={() => void load()}>Search</button>
                <select value={county} onChange={e => setCounty(e.target.value)}>
                    <option value="all">All 47 Counties</option>
                    {meta.counties.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <select value={category} onChange={e => setCategory(e.target.value)}>
                    <option value="all">All 11 Categories</option>
                    {meta.eventCategories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <select value={approval} onChange={e => setApproval(e.target.value)}>
                    <option value="all">All Approvals</option>
                    <option value="pending">Pending</option>
                    <option value="approved">Approved</option>
                    <option value="rejected">Rejected</option>
                </select>
            </div>
        </section>
        <section className="discovery-grid">
            {events.map(ev => <article className="panel discovery-card" key={ev._id}>
                <div className="discovery-media">
                    <img src={ev.image?.url || '/assets/real/DzLV4G9UWo-1790859483.jpg'} alt={ev.name} loading="lazy"
                        onError={e => { (e.currentTarget as HTMLImageElement).src = '/assets/real/DzLV4G9UWo-1790859483.jpg'; }} />
                    <span className="discovery-badge">{ev.county} · {ev.approvalStatus}</span>
                    <span className="discovery-price-mode" data-mode={ev.priceType === 'verified' ? 'live' : 'estimated'}>
                        {ev.priceType === 'verified' ? 'Verified Price' : 'Estimated Price'}
                    </span>
                </div>
                <div className="discovery-body">
                    <h3>{ev.name}</h3>
                    <p className="discovery-meta">{ev.category} · {ev.venue}, {ev.county}</p>
                    <p className="discovery-meta">{dateFmt(ev.startsAt)} · Source: {ev.discoverySource}</p>
                    <p className="discovery-meta">Image: {ev.image?.kind?.replace('_', ' ')} ({ev.image?.license || 'Official'})</p>
                    <p className="discovery-meta">
                        <strong>{ev.confirmedPriceKes != null ? money(ev.confirmedPriceKes) : (ev.estimatedPriceKes != null ? `Est. ${money(ev.estimatedPriceKes)}` : 'Pending')}</strong>
                        {ev.originalUrl && <> · <a href={ev.originalUrl} target="_blank" rel="noreferrer">Source URL</a></>}
                    </p>
                    <div className="actions">
                        {ev.approvalStatus !== 'approved' && <button className="primary" disabled={busy} onClick={() => void updateEvent(ev._id, { approvalStatus: 'approved' }, 'Event approved.')}>Approve</button>}
                        {ev.approvalStatus !== 'rejected' && <button disabled={busy} onClick={() => void updateEvent(ev._id, { approvalStatus: 'rejected' }, 'Event rejected.')}>Reject</button>}
                        <button disabled={busy} onClick={() => void updateEvent(ev._id, { authorizedToSell: !ev.authorizedToSell }, ev.authorizedToSell ? 'Ticketing authorization revoked.' : 'Authorized for PDF ticket generation.')}>
                            {ev.authorizedToSell ? 'Authorized to Sell ✓' : 'Authorize Ticketing'}
                        </button>
                    </div>
                </div>
            </article>)}
            {!events.length && <p className="panel">No discovered events match this filter. Click "Scan 47 Counties Now" to discover events.</p>}
        </section>
    </div>;
}

export function TicketManagementPanel() {
    const [tickets, setTickets] = useState<any[]>([]);
    const [events, setEvents] = useState<any[]>([]);
    const [form, setForm] = useState({ eventId: '', customerName: '', customerEmail: '', customerPhone: '', category: 'Regular', customCategory: '', priceKes: '' });
    const [verifyToken, setVerifyToken] = useState('');
    const [verifyResult, setVerifyResult] = useState<string>('');
    const [msg, setMsg] = useState('');
    const [busy, setBusy] = useState(false);

    async function load() {
        const [tRes, eRes] = await Promise.all([
            autoRequest<{ data: any[] }>('/tickets'),
            autoRequest<{ data: any[] }>('/events?approvalStatus=approved')
        ]);
        setTickets(tRes.data || []);
        const authEvents = (eRes.data || []).filter((e: any) => e.authorizedToSell);
        setEvents(authEvents);
        if (!form.eventId && authEvents[0]) setForm(f => ({ ...f, eventId: authEvents[0].externalId, priceKes: String(authEvents[0].confirmedPriceKes || authEvents[0].estimatedPriceKes || 1500) }));
    }

    useEffect(() => { void load().catch(e => setMsg(e.message)); }, []);

    async function generate(e: React.FormEvent) {
        e.preventDefault();
        setBusy(true);
        setMsg('');
        try {
            const category = form.category === 'Custom' ? (form.customCategory || 'Custom') : form.category;
            const res = await autoRequest<{ data: any }>('/tickets', 'POST', {
                eventId: form.eventId,
                customerName: form.customerName,
                customerEmail: form.customerEmail,
                customerPhone: form.customerPhone,
                category,
                priceKes: Number(form.priceKes)
            });
            setMsg(`Ticket ${res.data.ticketNumber} generated! You can now download the PDF or share via WhatsApp.`);
            setForm(f => ({ ...f, customerName: '', customerEmail: '', customerPhone: '' }));
            await load();
        } catch (err: any) { setMsg(err.message); }
        finally { setBusy(false); }
    }

    async function verifyOrRedeem(redeem: boolean) {
        if (!verifyToken.trim()) return;
        try {
            const url = `/api/automation/tickets/${redeem ? 'redeem' : 'verify'}/${encodeURIComponent(verifyToken.trim())}`;
            const res = await fetch(url, {
                method: redeem ? 'POST' : 'GET',
                credentials: 'same-origin',
                headers: redeem ? { 'Content-Type': 'application/json' } : undefined,
                body: redeem ? JSON.stringify({ gate: 'Gate A' }) : undefined
            });
            const data = await res.json();
            setVerifyResult(res.ok ? `${data.status}: ${data.ticketNumber || data.ticket?.ticketNumber} (${data.ticket?.customerName || 'Redeemed'})` : (data.message || 'Verification failed'));
            if (redeem) await load();
        } catch (e: any) { setVerifyResult(e.message); }
    }

    return <div className="publishing-lobby">
        {msg && <p className="notice" role="status">{msg}</p>}
        <section className="panel">
            <h2>Generate Printable PDF Ticket (Authorized Events Only)</h2>
            <form className="form-grid" onSubmit={generate}>
                <select required value={form.eventId} onChange={e => {
                    const ev = events.find(x => x.externalId === e.target.value);
                    setForm({ ...form, eventId: e.target.value, priceKes: String(ev?.confirmedPriceKes || ev?.estimatedPriceKes || 1500) });
                }}>
                    <option value="">Select authorized event…</option>
                    {events.map(ev => <option key={ev._id} value={ev.externalId}>{ev.name} ({ev.county})</option>)}
                </select>
                <input required placeholder="Customer Full Name" value={form.customerName} onChange={e => setForm({ ...form, customerName: e.target.value })} />
                <input type="email" placeholder="Customer Email (for delivery)" value={form.customerEmail} onChange={e => setForm({ ...form, customerEmail: e.target.value })} />
                <input placeholder="Customer Phone (WhatsApp)" value={form.customerPhone} onChange={e => setForm({ ...form, customerPhone: e.target.value })} />
                <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                    {['Regular', 'VIP', 'VVIP', 'Early Bird', 'Student', 'Group', 'Custom'].map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                {form.category === 'Custom' && <input placeholder="Custom Category Name" value={form.customCategory} onChange={e => setForm({ ...form, customCategory: e.target.value })} />}
                <input required type="number" min="0" placeholder="Price (KES)" value={form.priceKes} onChange={e => setForm({ ...form, priceKes: e.target.value })} />
                <button className="primary" type="submit" disabled={busy || !form.eventId}>{busy ? 'Generating…' : 'Generate Ticket & QR'}</button>
            </form>
        </section>
        <section className="panel">
            <h2>QR Code Validation &amp; Duplicate-Entry Prevention</h2>
            <div className="actions">
                <input placeholder="Enter Ticket Number or QR Token (e.g. TKT-...)" value={verifyToken} onChange={e => setVerifyToken(e.target.value)} />
                <button onClick={() => void verifyOrRedeem(false)}>Verify QR</button>
                <button className="primary" onClick={() => void verifyOrRedeem(true)}>Scan &amp; Redeem at Gate A</button>
            </div>
            {verifyResult && <p className="notice">{verifyResult}</p>}
        </section>
        <section className="panel">
            <h2>Generated Tickets ({tickets.length})</h2>
            <div className="scroll"><table>
                <thead><tr><th>Ticket #</th><th>Event</th><th>Customer</th><th>Category</th><th>Price</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>{tickets.map(t => {
                    const waText = encodeURIComponent(`Ticketsasa Ticket ${t.ticketNumber} for ${t.eventName} (${t.category}) - Verify: ${t.verificationUrl}`);
                    return <tr key={t._id}>
                        <td><strong>{t.ticketNumber}</strong><small>{t.bookingRef}</small></td>
                        <td>{t.eventName}<small>{t.venue}</small></td>
                        <td>{t.customerName}<small>{t.customerEmail || t.customerPhone}</small></td>
                        <td>{t.category}</td>
                        <td>{money(t.priceKes)}</td>
                        <td><span className="payment-badge" data-status={t.status === 'VALID' ? 'COMPLETED' : 'FAILED'}>{t.status}</span></td>
                        <td className="actions">
                            <a className="primary" href={`/api/admin/automation/tickets/${t._id}/pdf`} target="_blank" rel="noreferrer">PDF / Print</a>
                            <a href={`https://wa.me/${String(t.customerPhone || '').replace(/\D/g, '')}?text=${waText}`} target="_blank" rel="noreferrer">WhatsApp</a>
                            {t.customerEmail && <button onClick={async () => {
                                try { await autoRequest(`/tickets/${t._id}/email`, 'POST', {}); setMsg(`Ticket emailed to ${t.customerEmail}`); }
                                catch (e: any) { setMsg(e.message); }
                            }}>Email</button>}
                        </td>
                    </tr>;
                })}</tbody>
            </table></div>
        </section>
    </div>;
}

export function FlightManagementPanel({ mode }: { mode: 'discovery' | 'manage' }) {
    const [flights, setFlights] = useState<any[]>([]);
    const [airports, setAirports] = useState<any[]>([]);
    const [origin, setOrigin] = useState('all');
    const [dest, setDest] = useState('all');
    const [msg, setMsg] = useState('');
    const [form, setForm] = useState({ airline: 'Kenya Airways', flightNumber: '', originCode: 'NBO', destinationCode: 'MBA', departureTime: '', arrivalTime: '', duration: '1h 00m', priceKes: '', baggageAllowance: '23kg Checked + 10kg Cabin', bookingUrl: '' });

    async function load() {
        const res = await autoRequest<{ data: any[]; airports: any[] }>(`/flights?origin=${origin}&destination=${dest}`);
        setFlights(res.data || []);
        setAirports(res.airports || []);
    }
    useEffect(() => { void load().catch(e => setMsg(e.message)); }, [origin, dest]);

    async function addFlight(e: React.FormEvent) {
        e.preventDefault();
        try {
            await autoRequest('/flights', 'POST', { ...form, priceKes: Number(form.priceKes) });
            setMsg('Flight listing imported.');
            setForm(f => ({ ...f, flightNumber: '', priceKes: '', bookingUrl: '' }));
            await load();
        } catch (err: any) { setMsg(err.message); }
    }

    return <div className="publishing-lobby">
        {msg && <p className="notice">{msg}</p>}
        <section className="panel">
            <div className="lobby-toolbar">
                <div><h2>{mode === 'discovery' ? 'Flight Discovery (All 7 Kenyan Airports)' : 'Flight Management'}</h2><p>Never invents schedules or prices. Connects to live feeds or admin-verified manual imports.</p></div>
                <button className="primary" onClick={async () => { await autoRequest('/jobs/run', 'POST', { kind: 'flights' }); setMsg('Flight discovery job started.'); setTimeout(() => void load(), 2500); }}>Run Flight Sync</button>
            </div>
            <div className="actions" style={{ marginTop: 12 }}>
                <select value={origin} onChange={e => setOrigin(e.target.value)}><option value="all">All Origins</option>{airports.map(a => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}</select>
                <select value={dest} onChange={e => setDest(e.target.value)}><option value="all">All Destinations</option>{airports.map(a => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}</select>
            </div>
        </section>
        <section className="panel">
            <h3>Manual Flight Import / External Booking Link</h3>
            <form className="form-grid" onSubmit={addFlight}>
                <input required placeholder="Airline (e.g. Kenya Airways)" value={form.airline} onChange={e => setForm({ ...form, airline: e.target.value })} />
                <input required placeholder="Flight # (e.g. KQ 604)" value={form.flightNumber} onChange={e => setForm({ ...form, flightNumber: e.target.value })} />
                <select value={form.originCode} onChange={e => setForm({ ...form, originCode: e.target.value })}>{airports.map(a => <option key={a.code} value={a.code}>{a.code} ({a.city})</option>)}</select>
                <select value={form.destinationCode} onChange={e => setForm({ ...form, destinationCode: e.target.value })}>{airports.map(a => <option key={a.code} value={a.code}>{a.code} ({a.city})</option>)}</select>
                <input required type="datetime-local" value={form.departureTime} onChange={e => setForm({ ...form, departureTime: e.target.value })} />
                <input required type="datetime-local" value={form.arrivalTime} onChange={e => setForm({ ...form, arrivalTime: e.target.value })} />
                <input required type="number" placeholder="Verified Price (KES)" value={form.priceKes} onChange={e => setForm({ ...form, priceKes: e.target.value })} />
                <input placeholder="Baggage Allowance" value={form.baggageAllowance} onChange={e => setForm({ ...form, baggageAllowance: e.target.value })} />
                <input placeholder="External Booking URL (https://...)" value={form.bookingUrl} onChange={e => setForm({ ...form, bookingUrl: e.target.value })} />
                <button className="primary" type="submit">Add Flight</button>
            </form>
        </section>
        <section className="panel">
            <h3>Flights ({flights.length})</h3>
            <div className="scroll"><table>
                <thead><tr><th>Airline &amp; Flight</th><th>Route</th><th>Departure</th><th>Price</th><th>Baggage</th><th>Booking</th><th></th></tr></thead>
                <tbody>{flights.map(f => <tr key={f._id}>
                    <td><strong>{f.airline}</strong> {f.flightNumber}<small>{f.source}</small></td>
                    <td>{f.originCode} → {f.destinationCode}</td>
                    <td>{f.departureTime ? dateFmt(f.departureTime) : 'Verified Route (See Booking Link)'}</td>
                    <td>{f.priceKes == null ? 'Price on Request' : money(f.priceKes)}</td>
                    <td>{f.baggageAllowance}</td>
                    <td>{f.bookingUrl ? <a href={f.bookingUrl} target="_blank" rel="noreferrer">Book External</a> : 'Direct'}</td>
                    <td><button onClick={async () => { await autoRequest('/flights/' + f._id, 'DELETE'); await load(); }}>Delete</button></td>
                </tr>)}</tbody>
            </table></div>
        </section>
    </div>;
}

export function HolidayPackagesPanel() {
    const [packages, setPackages] = useState<any[]>([]);
    const [rates, setRates] = useState<any>();
    const [categories, setCategories] = useState<string[]>([]);
    const [destinations, setDestinations] = useState<string[]>([]);
    const [msg, setMsg] = useState('');
    const [form, setForm] = useState({ title: '', category: 'Beach Holidays', destination: 'Diani', country: 'Kenya', accommodation: '', nights: '3', activities: '', transport: 'Return SGR / Flight Transfers', meals: 'All-Inclusive', pricePerPerson: '', currency: 'KES', travelDates: 'Flexible Dates', provider: 'Ticketsasa Holidays', bookingUrl: '', imageUrl: '/assets/real/lheAq1Zpc0-1794303741.jpg' });

    async function load() {
        const res = await autoRequest<any>('/holidays');
        setPackages(res.data || []);
        setRates(res.exchangeRates);
        setCategories(res.categories || []);
        setDestinations(res.destinations || []);
    }
    useEffect(() => { void load().catch(e => setMsg(e.message)); }, []);

    async function createPackage(e: React.FormEvent) {
        e.preventDefault();
        try {
            await autoRequest('/holidays', 'POST', { ...form, nights: Number(form.nights), pricePerPerson: Number(form.pricePerPerson) });
            setMsg('Holiday package saved with live exchange-rate conversion.');
            setForm(f => ({ ...f, title: '', accommodation: '', pricePerPerson: '' }));
            await load();
        } catch (err: any) { setMsg(err.message); }
    }

    return <div className="publishing-lobby">
        {msg && <p className="notice">{msg}</p>}
        <section className="panel">
            <div className="lobby-toolbar">
                <div>
                    <h2>Holiday &amp; Travel Packages (Kenya &amp; International)</h2>
                    <p>Live FX ({rates?.status || 'loading'}): 1 USD ≈ {rates?.rates?.USD ? (1 / rates.rates.USD).toFixed(2) : '—'} KES · 1 EUR ≈ {rates?.rates?.EUR ? (1 / rates.rates.EUR).toFixed(2) : '—'} KES {rates?.updatedAt ? `· Updated ${dateFmt(rates.updatedAt)}` : ''}</p>
                </div>
                <button className="primary" onClick={async () => { await autoRequest('/jobs/run', 'POST', { kind: 'holidays' }); setMsg('Holiday discovery job started.'); setTimeout(() => void load(), 2500); }}>Sync Holiday Feeds</button>
            </div>
        </section>
        <section className="panel">
            <h3>Create Custom Holiday Package</h3>
            <form className="form-grid" onSubmit={createPackage}>
                <input required placeholder="Package Title" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
                <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>{categories.map(c => <option key={c} value={c}>{c}</option>)}</select>
                <input required list="holiday-dest-list" placeholder="Destination (e.g. Diani, Maasai Mara, Dubai)" value={form.destination} onChange={e => setForm({ ...form, destination: e.target.value })} />
                <datalist id="holiday-dest-list">{destinations.map(d => <option key={d} value={d} />)}</datalist>
                <input placeholder="Hotel / Accommodation" value={form.accommodation} onChange={e => setForm({ ...form, accommodation: e.target.value })} />
                <input type="number" min="1" placeholder="Nights" value={form.nights} onChange={e => setForm({ ...form, nights: e.target.value })} />
                <input required type="number" min="1" placeholder="Price per Person" value={form.pricePerPerson} onChange={e => setForm({ ...form, pricePerPerson: e.target.value })} />
                <select value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })}><option value="KES">KES</option><option value="USD">USD</option><option value="EUR">EUR</option><option value="GBP">GBP</option></select>
                <input placeholder="Activities (comma separated)" value={form.activities} onChange={e => setForm({ ...form, activities: e.target.value })} />
                <input placeholder="Meals (e.g. All-Inclusive)" value={form.meals} onChange={e => setForm({ ...form, meals: e.target.value })} />
                <input placeholder="Booking URL (optional)" value={form.bookingUrl} onChange={e => setForm({ ...form, bookingUrl: e.target.value })} />
                <button className="primary" type="submit">Save Holiday Package</button>
            </form>
        </section>
        <section className="discovery-grid">
            {packages.map(p => <article className="panel discovery-card" key={p._id}>
                <div className="discovery-media">
                    <img src={p.images?.[0]?.url || '/assets/real/lheAq1Zpc0-1794303741.jpg'} alt={p.title} />
                    <span className="discovery-badge">{p.destination} · {p.nights} Nights</span>
                </div>
                <div className="discovery-body">
                    <h3>{p.title}</h3>
                    <p className="discovery-meta">{p.category} · {p.accommodation || p.provider}</p>
                    <p className="discovery-meta">{p.meals} · {p.transport}</p>
                    <p className="discovery-meta"><strong>{p.priceKes == null ? 'Price on Request' : money(p.priceKes)}</strong> {p.pricePerPerson != null ? `(${p.currency} ${p.pricePerPerson})` : ''}</p>
                    <div className="actions">
                        {p.bookingUrl && <a className="primary" href={p.bookingUrl} target="_blank" rel="noreferrer">Booking URL</a>}
                        <button onClick={async () => { await autoRequest('/holidays/' + p._id, 'DELETE'); await load(); }}>Delete</button>
                    </div>
                </div>
            </article>)}
        </section>
    </div>;
}

export function PendingDepositsPanel({ onAcknowledge }: { onAcknowledge: (id: string) => Promise<void> }) {
    const [deposits, setDeposits] = useState<any[]>([]);
    async function load() {
        const res = await autoRequest<{ data: any[] }>('/deposits');
        setDeposits(res.data || []);
    }
    useEffect(() => {
        void load();
        const t = window.setInterval(() => { if (!document.hidden) void load(); }, 5000);
        return () => window.clearInterval(t);
    }, []);

    return <section className="panel">
        <div className="lobby-toolbar">
            <div><h2>Pending &amp; Recent Deposit Requests</h2><p>Plays a short alert chime when a deposit is initiated and a confirmation chime when payment succeeds (both stop automatically). Wallets are only credited after independent M-Pesa verification.</p></div>
            <button onClick={() => void load()}>Refresh</button>
        </div>
        <div className="scroll"><table>
            <thead><tr><th>Reference</th><th>Customer</th><th>Amount</th><th>Method</th><th>Status &amp; Reason</th><th>Wallet Credited</th><th>Initiated</th><th>Action</th></tr></thead>
            <tbody>{deposits.map(d => <tr key={d._id}>
                <td><strong>{d.reference}</strong><small>{d.orderReference}</small></td>
                <td>{d.customerName}<small>{d.customerPhone}</small></td>
                <td><strong>{money(d.amountKes)}</strong></td>
                <td>{d.method}</td>
                <td>
                    <span className="payment-badge" data-status={d.status}>{d.status}</span>
                    {d.status === 'FAILED' && (
                        <small style={{ display: 'block', color: '#b91c1c', fontWeight: 600, marginTop: 4 }}>
                            {d.failureReason || 'Payment failed or cancelled'}{d.failureCode ? ` (Code ${d.failureCode})` : ''}
                        </small>
                    )}
                </td>
                <td>{d.walletCredited ? 'Verified & Credited' : d.status === 'FAILED' ? 'Not Credited (Failed)' : 'Pending Verification'}</td>
                <td>{dateFmt(d.initiatedAt)}</td>
                <td>{!d.acknowledged ? <button className="primary" onClick={async () => { await onAcknowledge(d._id); await load(); }}>Acknowledge &amp; Stop Sound</button> : <span>Acknowledged</span>}</td>
            </tr>)}</tbody>
        </table></div>
        {!deposits.length && <p>No deposit requests recorded yet.</p>}
    </section>;
}

export function NotificationsPanel({ onAcknowledgeAll }: { onAcknowledgeAll: () => Promise<void> }) {
    const [items, setItems] = useState<any[]>([]);
    async function load() {
        const res = await autoRequest<{ data: any[] }>('/notifications');
        setItems(res.data || []);
    }
    useEffect(() => { void load(); }, []);
    return <section className="panel">
        <div className="lobby-toolbar">
            <h2>Persistent Admin Notifications ({items.length})</h2>
            <button className="primary" onClick={async () => { await onAcknowledgeAll(); await load(); }}>Acknowledge &amp; Mark All Read</button>
        </div>
        <div className="scroll"><table>
            <thead><tr><th>Time</th><th>Title</th><th>Message</th><th>Status</th><th></th></tr></thead>
            <tbody>{items.map(n => <tr key={n._id}>
                <td>{dateFmt(n.createdAt)}</td>
                <td><strong>{n.title}</strong></td>
                <td>{n.message}</td>
                <td>{n.read ? 'Read' : 'Unread'}</td>
                <td>{!n.read && <button onClick={async () => { await autoRequest(`/notifications/${n._id}/read`, 'POST', {}); await load(); }}>Mark read</button>}</td>
            </tr>)}</tbody>
        </table></div>
    </section>;
}

export function DataSourcesPanel() {
    const [sources, setSources] = useState<any[]>([]);
    const [form, setForm] = useState({ name: '', type: 'event', adapter: 'rss', url: '' });
    const [msg, setMsg] = useState('');
    async function load() { setSources((await autoRequest<{ data: any[] }>('/sources')).data || []); }
    useEffect(() => { void load(); }, []);

    return <div className="publishing-lobby">
        {msg && <p className="notice">{msg}</p>}
        <section className="panel">
            <h2>Add Data Source</h2>
            <form className="form-grid" onSubmit={async e => {
                e.preventDefault();
                try { await autoRequest('/sources', 'POST', form); setForm({ name: '', type: 'event', adapter: 'rss', url: '' }); setMsg('Data source added.'); await load(); }
                catch (err: any) { setMsg(err.message); }
            }}>
                <input required placeholder="Source Name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
                <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}><option value="event">Event</option><option value="flight">Flight</option><option value="holiday">Holiday</option></select>
                <input required placeholder="Adapter (e.g. rss, quicket, tkt)" value={form.adapter} onChange={e => setForm({ ...form, adapter: e.target.value })} />
                <input placeholder="Source URL (https://...)" value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} />
                <button className="primary" type="submit">Add Source</button>
            </form>
        </section>
        <section className="panel">
            <h2>Configured Data Sources ({sources.length})</h2>
            <div className="scroll"><table>
                <thead><tr><th>Name</th><th>Type</th><th>Adapter</th><th>Status</th><th>Last Run</th><th>Actions</th></tr></thead>
                <tbody>{sources.map(s => <tr key={s._id}>
                    <td><strong>{s.name}</strong><small>{s.url}</small></td>
                    <td>{s.type}</td>
                    <td>{s.adapter}</td>
                    <td><span className="sync-badge" data-state={s.lastStatus}>{s.lastStatus}</span>{s.lastError && <small>{s.lastError}</small>}</td>
                    <td>{dateFmt(s.lastRunAt)}</td>
                    <td className="actions">
                        <button onClick={async () => { await autoRequest('/sources/' + s._id, 'PATCH', { enabled: !s.enabled }); await load(); }}>{s.enabled ? 'Disable' : 'Enable'}</button>
                        <button onClick={async () => { await autoRequest('/sources/' + s._id, 'DELETE'); await load(); }}>Remove</button>
                    </td>
                </tr>)}</tbody>
            </table></div>
        </section>
    </div>;
}

export function AutomationSettingsPanel() {
    const [settings, setSettings] = useState<any>();
    const [meta, setMeta] = useState<any>();
    const [msg, setMsg] = useState('');
    useEffect(() => {
        void autoRequest<any>('/settings').then(r => { setSettings(r.settings); setMeta(r.meta); });
    }, []);
    if (!settings) return <p className="panel">Loading automation settings…</p>;

    async function save(patch: any) {
        try {
            const r = await autoRequest<any>('/settings', 'PUT', patch);
            setSettings(r.settings);
            setMsg('Automation settings saved and background schedules updated.');
        } catch (e: any) { setMsg(e.message); }
    }

    return <div className="publishing-lobby">
        {msg && <p className="notice">{msg}</p>}
        <section className="panel">
            <div className="lobby-toolbar">
                <div><h2>Automation Center</h2><p>Control background discovery schedules and active counties.</p></div>
                <button className="primary" onClick={() => void save({ discoveryEnabled: !settings.discoveryEnabled })}>
                    {settings.discoveryEnabled ? 'Pause Automatic Discovery' : 'Start Automatic Discovery'}
                </button>
            </div>
            <div className="form-grid" style={{ marginTop: 14 }}>
                <label>Events Schedule (hours)
                    <input type="number" min="1" max="168" value={settings.schedules?.eventsHours ?? 6} onChange={e => setSettings({ ...settings, schedules: { ...settings.schedules, eventsHours: Number(e.target.value) } })} />
                </label>
                <label>Flights Schedule (hours)
                    <input type="number" min="1" max="168" value={settings.schedules?.flightsHours ?? 3} onChange={e => setSettings({ ...settings, schedules: { ...settings.schedules, flightsHours: Number(e.target.value) } })} />
                </label>
                <label>Holidays Schedule (hours)
                    <input type="number" min="1" max="168" value={settings.schedules?.holidaysHours ?? 12} onChange={e => setSettings({ ...settings, schedules: { ...settings.schedules, holidaysHours: Number(e.target.value) } })} />
                </label>
                <button className="primary" onClick={() => void save({ schedules: settings.schedules })}>Save Schedules</button>
            </div>
        </section>
        <section className="panel">
            <div className="lobby-toolbar">
                <h3>Active Kenyan Counties ({settings.enabledCounties?.length || 0} / 47)</h3>
                <div className="actions">
                    <button onClick={() => void save({ enabledCounties: meta.counties })}>Select All 47</button>
                    <button onClick={() => void save({ enabledCounties: ['Nairobi', 'Mombasa', 'Kilifi', 'Kwale', 'Nakuru', 'Kisumu', 'Uasin Gishu'] })}>Major Hubs Only</button>
                </div>
            </div>
            <div className="chip-grid">
                {(meta?.counties || []).map((c: string) => {
                    const active = (settings.enabledCounties || []).includes(c);
                    return <button key={c} className={active ? 'chip active' : 'chip'} onClick={() => {
                        const next = active ? settings.enabledCounties.filter((x: string) => x !== c) : [...(settings.enabledCounties || []), c];
                        void save({ enabledCounties: next });
                    }}>{c}</button>;
                })}
            </div>
        </section>
    </div>;
}

export function ReportsPanel() {
    const [rep, setRep] = useState<any>();
    useEffect(() => { void autoRequest('/reports').then(setRep); }, []);
    if (!rep) return <p className="panel">Loading reports…</p>;
    return <div className="charts-grid">
        <BarChart title="Events by County" rows={(rep.eventsByCounty || []).map((x: any) => ({ label: x._id || 'Other', value: x.count }))} />
        <BarChart title="Events by Category" rows={(rep.eventsByCategory || []).map((x: any) => ({ label: x._id || 'Other', value: x.count }))} />
        <BarChart title="Deposits by Status (KES)" rows={(rep.depositsByStatus || []).map((x: any) => ({ label: `${x._id} (${x.count})`, value: x.totalKes }))} valueSuffix=" KES" />
    </div>;
}

export function SystemLogsPanel({ audit }: { audit: { action: string; target: string; timestamp: string }[] }) {
    const [jobs, setJobs] = useState<any[]>([]);
    useEffect(() => { void autoRequest<{ data: any[] }>('/jobs').then(r => setJobs(r.data || [])); }, []);
    return <div className="publishing-lobby">
        <section className="panel">
            <h2>Background Discovery Job Logs</h2>
            <div className="scroll"><table>
                <thead><tr><th>Started</th><th>Kind</th><th>Trigger</th><th>Status</th><th>Found / Created / Updated</th><th>Expired</th></tr></thead>
                <tbody>{jobs.map(j => <tr key={j._id}>
                    <td>{dateFmt(j.startedAt)}</td><td>{j.kind}</td><td>{j.trigger}</td><td>{j.status}</td>
                    <td>{j.foundCount} / +{j.createdCount} / ~{j.updatedCount}</td><td>{j.expiredRemovedCount}</td>
                </tr>)}</tbody>
            </table></div>
        </section>
        <section className="panel">
            <h2>Admin Audit Log</h2>
            <div className="scroll"><table>
                <thead><tr><th>Time</th><th>Action</th><th>Target</th></tr></thead>
                <tbody>{audit.map((a, idx) => <tr key={idx}><td>{dateFmt(a.timestamp)}</td><td>{a.action}</td><td>{a.target}</td></tr>)}</tbody>
            </table></div>
        </section>
    </div>;
}
