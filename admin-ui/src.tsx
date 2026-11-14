import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

type Tier = { tierKey: string; title: string; priceKes: number; remainingAllocation: number; sold: number };
type Event = { id: string; title: string; venue: string; startsAt: string; image?: string; status?: string; tiers: Tier[] };
type Order = { orderReference: string; customer: { name: string; email: string }; items: { title: string; quantity: number; kind: string }[]; totalTickets: number; totalKes: number; paymentStatus: string };
type Import = { id: string; title: string; venue: string; startsAt: string; source?: string };
type Audit = { action: string; target: string; timestamp: string };
type Data = { events: Event[]; orders: Order[]; imports: { events: Import[]; status: string; updatedAt: string | null } };

const sections = ['Overview', 'Events', 'Automatic imports', 'Tickets', 'Customers', 'Transactions', 'Audit log'] as const;
type Section = typeof sections[number];
const money = (value: number) => new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(value);
const date = (value: string) => new Intl.DateTimeFormat('en-KE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Nairobi' }).format(new Date(value));

async function request<T>(path: string, method = 'GET', body?: object): Promise<T> {
    const response = await fetch('/api/admin' + path, {
        method, credentials: 'same-origin',
        headers: method === 'GET' ? undefined : { 'Content-Type': 'application/json', 'X-Admin-Action': 'dashboard' },
        body: body ? JSON.stringify(body) : undefined
    });
    if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.message || ('Request failed (' + response.status + ')'));
    }
    return response.json();
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

function App() {
    const [section, setSection] = useState<Section>('Overview');
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

    async function load() {
        const [overview, logs] = await Promise.all([request<Data>('/overview'), request<{ data: Audit[] }>('/audit')]);
        setData(overview);
        setAudit(logs.data);
    }

    async function run(action: () => Promise<void>) {
        setBusy(true);
        setNotice('');
        try { await action(); } catch (error) { setNotice(error instanceof Error ? error.message : 'Request failed.'); }
        finally { setBusy(false); }
    }

    useEffect(() => { void run(load); }, []);

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
            <div className="brand"><strong>Ticketsasa</strong><span>Administration</span></div>
            <button className="menu" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed}>{collapsed ? 'Show menu' : 'Hide menu'}</button>
            <nav aria-label="Admin navigation">{sections.map(item => <button key={item} aria-current={section === item ? 'page' : undefined} onClick={() => {
                setSection(item); setQuery(''); setStatus('all'); setPage(0); setSelected(undefined);
            }}>{item}</button>)}</nav>
            <a href="/">Back to storefront</a>
        </aside>
        <main>
            <header><div><p className="eyebrow">Ticketing operations</p><h1>{section}</h1></div>
                <div className="actions"><button onClick={() => setDark(!dark)}>{dark ? 'Light mode' : 'Dark mode'}</button>
                <button disabled={busy} onClick={() => void run(load)}>Refresh</button>
                <a className="primary" href="/organizer">Publish an event</a></div>
            </header>
            {notice && <p className="notice" role="status">{notice}</p>}
            {!data && <p className="panel" role="status">{busy ? 'Loading dashboard…' : 'Dashboard data unavailable.'}</p>}
            {data && section === 'Overview' && <>
                <div className="metrics">{[
                    ['Organizer events', events.length],
                    ['Published events', events.filter(event => eventStatus(event) === 'published').length],
                    ['Upcoming events', events.filter(event => Date.parse(event.startsAt) > Date.now()).length],
                    ['Expired events', events.filter(event => Date.parse(event.startsAt) <= Date.now()).length],
                    ['Verified live tickets sold', completed.reduce((sum, order) => sum + order.totalTickets, 0)],
                    ['Verified live revenue', money(completed.reduce((sum, order) => sum + order.totalKes, 0))],
                    ['Customers with orders', customers.length],
                    ['Discovered events', data.imports.events.length]
                ].map(([label, value]) => <article key={label}><span>{label}</span><strong>{value}</strong></article>)}</div>
                <section className="panel"><h2>Recent orders</h2>{orders.length ? orders.slice(0, 5).map(order =>
                    <p key={order.orderReference}>{order.customer.name} · {money(order.totalKes)} · {order.paymentStatus}</p>)
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
            {data && section === 'Automatic imports' && <section className="panel"><div className="actions"><h2>SoldOut Africa</h2>
                <button disabled={busy} onClick={() => void run(async () => {
                    const result = await request<Data['imports']>('/imports/sync', 'POST', {}); setData({ ...data, imports: result });
                    setNotice(result.status === 'live' ? 'Listings refreshed.' : 'Source unavailable. Showing the last successful import if available.');
                })}>Sync now</button></div>
                <p>Status {data.imports.status} · Last success {data.imports.updatedAt ? date(data.imports.updatedAt) : 'Unavailable'}</p>
                <p>Discovery listings are informational.</p>
                {!data.imports.events.length && <p>No live-source listings available.</p>}
                <ul>{data.imports.events.map(event => <li key={event.id}>{event.title} · {event.venue} · {date(event.startsAt)}</li>)}</ul>
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
                    <tr key={order.orderReference}><td>{order.orderReference}</td><td>{order.customer.name}</td><td>{order.paymentStatus}</td>
                    <td>{money(order.totalKes)}</td><td><button onClick={() => setSelected(order)}>View order</button></td></tr>)}</tbody></table></div>
                {selected && <section className="detail"><h2>Order details</h2><p>{selected.customer.email}</p>
                    <ul>{selected.items.map((item, index) => <li key={index}>{item.quantity} × {item.title}</li>)}</ul><button onClick={() => setSelected(undefined)}>Close details</button></section>}
            </section>}
            {data && section === 'Audit log' && <section className="panel">{audit.length ? <div className="scroll"><table><thead><tr><th>Action</th><th>Event ID</th><th>Time</th></tr></thead><tbody>{audit.map((entry, index) =>
                <tr key={index}><td>{entry.action}</td><td>{entry.target}</td><td>{date(entry.timestamp)}</td></tr>)}</tbody></table></div> : <p>No event status changes recorded.</p>}</section>}
        </main>
    </div>;
}

createRoot(document.getElementById('root')!).render(<App />);
