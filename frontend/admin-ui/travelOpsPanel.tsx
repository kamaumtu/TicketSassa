import React, { useEffect, useState } from 'react';
import { autoRequest } from './automationPanels';

type FulfillmentItem = {
    orderReference: string;
    reservationRef?: string;
    kind: string;
    title: string;
    supplier?: string;
    paymentStatus: string;
    paymentMethod?: string;
    status: string;
    fulfillmentStatus?: string;
    supplierPnr?: string;
    confirmationCode?: string;
    fulfillmentNotes?: string;
    totalKes: number;
    startsAt?: string;
    endsAt?: string;
    adults?: number;
    children?: number;
    infants?: number;
    tripType?: string;
    bundledFlight?: { label: string; airline: string; totalFlightKes: number } | null;
    promoCode?: string | null;
    sourceUrl?: string;
    customer?: { name?: string; email?: string; phone?: string };
    createdAt?: string;
};

type CustomPromo = {
    code: string;
    discountPercent: number;
    appliesTo: 'all' | 'flight' | 'holiday' | 'bundle' | 'event';
    label: string;
    active: boolean;
    builtIn?: boolean;
};

type PricingState = {
    flightMarkupPercent: number;
    flightFlatFeeKes: number;
    holidayMarkupPercent: number;
    holidayFlatFeeKes: number;
    customPromos: CustomPromo[];
};

type NotificationLogItem = {
    channel: string;
    to: string;
    status: string;
    orderReference?: string;
    kind?: string;
    message?: string;
    createdAt?: string;
};

type PricingResponse = { pricing?: PricingState; promos?: CustomPromo[];
    messaging?: { whatsappConfigured: boolean; smsConfigured: boolean };
    cardGateway?: { configured: boolean; provider: string } };

const money = (v: number) => 'KES ' + Number(v || 0).toLocaleString('en-KE');

export function TravelOpsPanel() {
    const [queue, setQueue] = useState<FulfillmentItem[]>([]);
    const [pricing, setPricing] = useState<PricingState>({
        flightMarkupPercent: 0,
        flightFlatFeeKes: 0,
        holidayMarkupPercent: 0,
        holidayFlatFeeKes: 0,
        customPromos: []
    });
    const [allPromos, setAllPromos] = useState<CustomPromo[]>([]);
    const [messagingStatus, setMessagingStatus] = useState({ whatsappConfigured: false, smsConfigured: false });
    const [cardStatus, setCardStatus] = useState({ configured: false, provider: 'demo_card' });
    const [logs, setLogs] = useState<NotificationLogItem[]>([]);
    const [pnrDrafts, setPnrDrafts] = useState<Record<string, string>>({});
    const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
    const [newPromo, setNewPromo] = useState<{ code: string; discountPercent: number; appliesTo: CustomPromo['appliesTo']; label: string }>({
        code: '',
        discountPercent: 10,
        appliesTo: 'all',
        label: ''
    });
    const [statusMsg, setStatusMsg] = useState('');
    const [busy, setBusy] = useState(false);

    async function load() {
        try {
            const [fRes, pRes, lRes] = await Promise.all([
                autoRequest<{ data: FulfillmentItem[] }>('/fulfillment'),
                autoRequest<PricingResponse>('/travel-pricing'),
                autoRequest<{ data: NotificationLogItem[] }>('/notifications-log')
            ]);
            setQueue(fRes.data || []);
            if (pRes.pricing) setPricing(pRes.pricing);
            setAllPromos(pRes.promos || []);
            if (pRes.messaging) setMessagingStatus(pRes.messaging);
            if (pRes.cardGateway) setCardStatus(pRes.cardGateway);
            setLogs(lRes.data || []);
        } catch (err: any) {
            setStatusMsg(err?.message || 'Could not load travel operations data.');
        }
    }

    useEffect(() => { void load(); }, []);

    async function confirmFulfillment(item: FulfillmentItem) {
        const pnr = (pnrDrafts[item.orderReference] ?? item.supplierPnr ?? '').trim();
        const notes = (noteDrafts[item.orderReference] ?? item.fulfillmentNotes ?? '').trim();
        if (!pnr) {
            setStatusMsg('Enter the airline PNR or hotel confirmation code first.');
            return;
        }
        setBusy(true);
        setStatusMsg('');
        try {
            await autoRequest(`/fulfillment/${encodeURIComponent(item.orderReference)}/confirm`, 'POST', {
                supplierPnr: pnr,
                notes
            });
            setStatusMsg(`Saved PNR ${pnr} for ${item.orderReference} and triggered WhatsApp/SMS confirmation.`);
            await load();
        } catch (err: any) {
            setStatusMsg(err?.message || 'Failed to save confirmation.');
        } finally {
            setBusy(false);
        }
    }

    async function savePricing(next: PricingState) {
        setBusy(true);
        setStatusMsg('');
        try {
            const res = await autoRequest<PricingResponse>('/travel-pricing', 'PUT', next);
            if (res.pricing) setPricing(res.pricing);
            setAllPromos(res.promos || []);
            setStatusMsg('Travel markup & promo settings saved. Storefront prices updated immediately.');
        } catch (err: any) {
            setStatusMsg(err?.message || 'Could not save pricing settings.');
        } finally {
            setBusy(false);
        }
    }

    async function addPromo() {
        const code = newPromo.code.trim().toUpperCase();
        if (code.length < 3) {
            setStatusMsg('Promo code must be at least 3 characters.');
            return;
        }
        const nextPromos = [
            ...pricing.customPromos.filter(p => p.code !== code),
            {
                code,
                discountPercent: Number(newPromo.discountPercent) || 10,
                appliesTo: newPromo.appliesTo,
                label: newPromo.label.trim() || `${newPromo.discountPercent}% Off Travel`,
                active: true
            }
        ];
        await savePricing({ ...pricing, customPromos: nextPromos });
        setNewPromo({ code: '', discountPercent: 10, appliesTo: 'all', label: '' });
    }

    async function removePromo(code: string) {
        const nextPromos = pricing.customPromos.filter(p => p.code !== code);
        await savePricing({ ...pricing, customPromos: nextPromos });
    }

    return (
        <div style={{ display: 'grid', gap: '1rem' }}>
            {statusMsg && <p className="notice" role="status">{statusMsg}</p>}

            <section className="panel">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <div>
                        <h2>Travel Fulfillment Queue (Synced Flights &amp; Holidays)</h2>
                        <p className="muted">Enter airline PNR / hotel confirmation numbers for paid bookings. Internal supplier links are visible only to admins.</p>
                    </div>
                    <button onClick={() => void load()} disabled={busy}>Refresh Queue</button>
                </div>

                <div className="scroll">
                    <table>
                        <thead>
                            <tr>
                                <th>#</th>
                                <th>Order / Ref</th>
                                <th>Type &amp; Trip</th>
                                <th>Customer</th>
                                <th>Payment</th>
                                <th>Supplier Link (Admin Only)</th>
                                <th>PNR / Hotel Confirmation</th>
                            </tr>
                        </thead>
                        <tbody>
                            {queue.map((item, idx) => (
                                <tr key={item.orderReference}>
                                    <td><strong>#{idx + 1}</strong></td>
                                    <td>
                                        <strong>{item.orderReference}</strong>
                                        <div className="muted">{item.reservationRef || ''} · {money(item.totalKes)}</div>
                                        {item.promoCode && <div className="muted">Promo: {item.promoCode}</div>}
                                    </td>
                                    <td>
                                        <strong>[{item.kind.toUpperCase()}] {item.title}</strong>
                                        <div className="muted">{item.startsAt || ''}{item.endsAt && item.endsAt !== item.startsAt ? ` → ${item.endsAt}` : ''}</div>
                                        {item.bundledFlight && <div className="muted">+ Flight Bundle: {item.bundledFlight.label}</div>}
                                    </td>
                                    <td>
                                        <div>{item.customer?.name || 'Guest'}</div>
                                        <div className="muted">{item.customer?.email || ''}</div>
                                        <div className="muted">{item.customer?.phone || ''}</div>
                                    </td>
                                    <td>
                                        <strong>{item.paymentStatus}</strong>
                                        <div className="muted">{item.paymentMethod || 'MPESA'} · {item.fulfillmentStatus || item.status}</div>
                                    </td>
                                    <td>
                                        {item.sourceUrl
                                            ? <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer">Open Supplier ↗</a>
                                            : <span className="muted">Curated / Direct</span>}
                                    </td>
                                    <td>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', minWidth: 210 }}>
                                            <input
                                                placeholder="Airline PNR / Voucher #"
                                                value={pnrDrafts[item.orderReference] ?? item.supplierPnr ?? item.confirmationCode ?? ''}
                                                onChange={e => setPnrDrafts(prev => ({ ...prev, [item.orderReference]: e.target.value }))}
                                            />
                                            <input
                                                placeholder="Optional note to customer"
                                                value={noteDrafts[item.orderReference] ?? item.fulfillmentNotes ?? ''}
                                                onChange={e => setNoteDrafts(prev => ({ ...prev, [item.orderReference]: e.target.value }))}
                                            />
                                            <button className="primary" disabled={busy} onClick={() => void confirmFulfillment(item)}>
                                                Save PNR &amp; Notify Customer
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {!queue.length && <p className="muted">No travel bookings yet.</p>}
                </div>
            </section>

            <section className="panel">
                <h2>Travel Markup, Margins &amp; Promo Codes</h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem', marginBottom: '0.75rem' }}>
                    <label>
                        Flight Markup (%)
                        <input type="number" min={0} max={50} step={0.5} value={pricing.flightMarkupPercent}
                            onChange={e => setPricing({ ...pricing, flightMarkupPercent: Number(e.target.value) || 0 })} />
                    </label>
                    <label>
                        Flight Flat Service Fee (KES)
                        <input type="number" min={0} max={50000} step={50} value={pricing.flightFlatFeeKes}
                            onChange={e => setPricing({ ...pricing, flightFlatFeeKes: Number(e.target.value) || 0 })} />
                    </label>
                    <label>
                        Holiday Markup (%)
                        <input type="number" min={0} max={50} step={0.5} value={pricing.holidayMarkupPercent}
                            onChange={e => setPricing({ ...pricing, holidayMarkupPercent: Number(e.target.value) || 0 })} />
                    </label>
                    <label>
                        Holiday Flat Service Fee (KES)
                        <input type="number" min={0} max={100000} step={100} value={pricing.holidayFlatFeeKes}
                            onChange={e => setPricing({ ...pricing, holidayFlatFeeKes: Number(e.target.value) || 0 })} />
                    </label>
                </div>
                <button className="primary" disabled={busy} onClick={() => void savePricing(pricing)}>Save Markup Settings</button>

                <hr style={{ margin: '1rem 0', opacity: 0.2 }} />
                <h3>Promo Codes</h3>
                <div className="actions" style={{ flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                    <input placeholder="Code (e.g. DIANI20)" value={newPromo.code} onChange={e => setNewPromo({ ...newPromo, code: e.target.value.toUpperCase() })} />
                    <input type="number" min={1} max={50} style={{ width: 90 }} value={newPromo.discountPercent} onChange={e => setNewPromo({ ...newPromo, discountPercent: Number(e.target.value) || 10 })} />
                    <select value={newPromo.appliesTo} onChange={e => setNewPromo({ ...newPromo, appliesTo: e.target.value as CustomPromo['appliesTo'] })}>
                        <option value="all">All Bookings</option>
                        <option value="flight">Flights Only</option>
                        <option value="holiday">Holidays Only</option>
                        <option value="bundle">Flight + Holiday Bundles</option>
                    </select>
                    <input placeholder="Label" value={newPromo.label} onChange={e => setNewPromo({ ...newPromo, label: e.target.value })} />
                    <button className="primary" disabled={busy} onClick={() => void addPromo()}>Add Promo Code</button>
                </div>
                <div className="scroll">
                    <table>
                        <thead><tr><th>Code</th><th>Discount</th><th>Applies To</th><th>Label</th><th>Action</th></tr></thead>
                        <tbody>
                            {allPromos.map(p => (
                                <tr key={p.code}>
                                    <td><strong>{p.code}</strong></td>
                                    <td>{p.discountPercent}%</td>
                                    <td>{p.appliesTo}</td>
                                    <td>{p.label}</td>
                                    <td>{p.builtIn ? <span className="muted">Built-in</span> : <button disabled={busy} onClick={() => void removePromo(p.code)}>Remove</button>}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>

            <section className="panel">
                <h2>WhatsApp / SMS &amp; Card Gateway Status</h2>
                <div className="actions" style={{ flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                    <span>WhatsApp Cloud API: <strong>{messagingStatus.whatsappConfigured ? 'Connected' : 'Ready (set WHATSAPP_ACCESS_TOKEN & WHATSAPP_PHONE_NUMBER_ID)'}</strong></span>
                    <span>Africa&apos;s Talking SMS: <strong>{messagingStatus.smsConfigured ? 'Connected' : 'Ready (set AT_API_KEY & AT_USERNAME)'}</strong></span>
                    <span>Card Gateway: <strong>{cardStatus.configured ? `Live (${cardStatus.provider})` : 'Demo Card Mode (set PAYSTACK_SECRET_KEY or FLUTTERWAVE_SECRET_KEY)'}</strong></span>
                </div>
                <div className="scroll">
                    <table>
                        <thead><tr><th>Channel</th><th>Recipient</th><th>Order</th><th>Status</th><th>Preview</th></tr></thead>
                        <tbody>
                            {logs.slice(0, 20).map((item, idx) => (
                                <tr key={idx}>
                                    <td>{item.channel.toUpperCase()}</td>
                                    <td>{item.to}</td>
                                    <td>{item.orderReference || '—'}</td>
                                    <td>{item.status}</td>
                                    <td style={{ maxWidth: 320, whiteSpace: 'pre-wrap', fontSize: 11 }}>{item.message || ''}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {!logs.length && <p className="muted">No WhatsApp/SMS notifications logged yet.</p>}
                </div>
            </section>
        </div>
    );
}
