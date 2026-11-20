const mongoose = require('mongoose');
const { KENYA_47_COUNTIES, EVENT_CATEGORIES, HOLIDAY_DESTINATIONS } = require('../../services/automation/kenyaCounties');

const DiscoveredEventSchema = new mongoose.Schema({
    externalId: { type: String, required: true, unique: true, index: true },
    dedupeKey: { type: String, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    category: { type: String, default: 'Concerts & Music Festivals', index: true },
    startsAt: { type: Date, required: true, index: true },
    county: { type: String, default: 'Nairobi', index: true },
    town: { type: String, default: '' },
    venue: { type: String, default: '' },
    organizer: { type: String, default: '' },
    originalUrl: { type: String, default: '' },
    ticketPurchaseUrl: { type: String, default: '' },
    ticketCategories: [{
        name: String,
        priceKes: Number,
        priceType: { type: String, enum: ['verified', 'estimated'], default: 'estimated' },
        capacity: { type: Number, default: 0 }
    }],
    confirmedPriceKes: { type: Number, default: null },
    estimatedPriceKes: { type: Number, default: null },
    priceType: { type: String, enum: ['verified', 'estimated'], default: 'estimated' },
    image: {
        url: String,
        source: String,
        attribution: String,
        license: String,
        kind: { type: String, enum: ['official_poster', 'organizer_photo', 'venue_image', 'licensed_stock', 'category_placeholder'], default: 'category_placeholder' }
    },
    discoverySource: { type: String, default: 'Manual' },
    approvalStatus: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
    authorizedToSell: { type: Boolean, default: false },
    availabilityStatus: { type: String, enum: ['available', 'sold_out', 'pending_verification', 'external_booking'], default: 'pending_verification' },
    lastVerifiedAt: { type: Date, default: Date.now },
    expired: { type: Boolean, default: false, index: true }
}, { timestamps: true });

const EventSourceSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    type: { type: String, enum: ['event', 'flight', 'holiday'], required: true, index: true },
    adapter: { type: String, required: true },
    url: { type: String, default: '' },
    enabled: { type: Boolean, default: true },
    lastRunAt: { type: Date, default: null },
    lastStatus: { type: String, enum: ['idle', 'live', 'stale', 'failed', 'unconfigured'], default: 'idle' },
    lastError: { type: String, default: '' },
    itemCount: { type: Number, default: 0 }
}, { timestamps: true });

const GeneratedTicketSchema = new mongoose.Schema({
    ticketNumber: { type: String, required: true, unique: true, index: true },
    qrToken: { type: String, required: true, unique: true, index: true },
    bookingRef: { type: String, required: true, index: true },
    eventId: { type: String, required: true, index: true },
    eventName: { type: String, required: true },
    eventPosterUrl: { type: String, default: '' },
    venue: { type: String, default: '' },
    eventDate: { type: Date, required: true },
    customerName: { type: String, required: true },
    customerEmail: { type: String, default: '' },
    customerPhone: { type: String, default: '' },
    category: { type: String, required: true },
    priceKes: { type: Number, required: true },
    priceType: { type: String, enum: ['verified', 'estimated'], default: 'verified' },
    verificationUrl: { type: String, required: true },
    status: { type: String, enum: ['VALID', 'USED', 'CANCELLED'], default: 'VALID', index: true },
    scannedAt: { type: Date, default: null },
    scannedGate: { type: String, default: '' },
    createdBy: { type: String, default: 'admin' }
}, { timestamps: true });

const FlightListingSchema = new mongoose.Schema({
    externalId: { type: String, required: true, unique: true, index: true },
    airline: { type: String, required: true },
    airlineLogo: { type: String, default: '/assets/airlines/kenya-airways.svg' },
    flightNumber: { type: String, required: true },
    originCode: { type: String, required: true, index: true },
    originName: { type: String, default: '' },
    destinationCode: { type: String, required: true, index: true },
    destinationName: { type: String, default: '' },
    departureTime: { type: Date, required: true, index: true },
    arrivalTime: { type: Date, required: true },
    duration: { type: String, default: '' },
    priceKes: { type: Number, required: true },
    currency: { type: String, default: 'KES' },
    priceType: { type: String, enum: ['verified', 'estimated'], default: 'verified' },
    baggageAllowance: { type: String, default: '23kg Checked + 10kg Cabin' },
    bookingUrl: { type: String, default: '' },
    source: { type: String, default: 'Manual Import' },
    dataMode: { type: String, enum: ['live', 'manual', 'external'], default: 'manual' },
    approvalStatus: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'approved', index: true },
    lastVerifiedAt: { type: Date, default: Date.now }
}, { timestamps: true });

const HolidayPackageSchema = new mongoose.Schema({
    externalId: { type: String, required: true, unique: true, index: true },
    title: { type: String, required: true },
    category: { type: String, default: 'Beach Holidays', index: true },
    destination: { type: String, required: true, index: true },
    country: { type: String, default: 'Kenya' },
    images: [{ url: String, attribution: String, license: String }],
    accommodation: { type: String, default: '' },
    nights: { type: Number, default: 2 },
    activities: [String],
    transport: { type: String, default: '' },
    meals: { type: String, default: 'Half Board' },
    pricePerPerson: { type: Number, required: true },
    currency: { type: String, default: 'KES' },
    priceKes: { type: Number, required: true },
    exchangeRateUsed: { type: Number, default: 1 },
    exchangeRateTimestamp: { type: Date, default: Date.now },
    priceType: { type: String, enum: ['verified', 'estimated'], default: 'verified' },
    availability: { type: String, enum: ['available', 'sold_out', 'pending_verification'], default: 'available' },
    travelDates: { type: String, default: '' },
    provider: { type: String, default: 'Ticketsasa Holidays' },
    bookingUrl: { type: String, default: '' },
    approvalStatus: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'approved', index: true },
    lastVerifiedAt: { type: Date, default: Date.now }
}, { timestamps: true });

const AutomationBookingSchema = new mongoose.Schema({
    bookingRef: { type: String, required: true, unique: true, index: true },
    kind: { type: String, enum: ['event', 'flight', 'holiday'], required: true },
    itemId: { type: String, required: true },
    itemTitle: { type: String, required: true },
    customerName: { type: String, required: true },
    customerEmail: { type: String, default: '' },
    customerPhone: { type: String, default: '' },
    quantity: { type: Number, default: 1 },
    totalKes: { type: Number, required: true },
    currency: { type: String, default: 'KES' },
    status: { type: String, enum: ['PENDING', 'CONFIRMED', 'CANCELLED'], default: 'PENDING' }
}, { timestamps: true });

const DepositRequestSchema = new mongoose.Schema({
    reference: { type: String, required: true, unique: true, index: true },
    orderReference: { type: String, index: true },
    customerName: { type: String, required: true },
    customerPhone: { type: String, required: true },
    customerEmail: { type: String, default: '' },
    amountKes: { type: Number, required: true },
    method: { type: String, default: 'M-PESA' },
    provider: { type: String, default: 'mpesa' },
    checkoutRequestId: { type: String, default: '', index: true },
    mpesaReceipt: { type: String, default: '' },
    status: { type: String, enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'], default: 'PENDING', index: true },
    walletCredited: { type: Boolean, default: false },
    acknowledged: { type: Boolean, default: false, index: true },
    acknowledgedBy: { type: String, default: '' },
    acknowledgedAt: { type: Date, default: null },
    initiatedAt: { type: Date, default: Date.now, index: true },
    verifiedAt: { type: Date, default: null }
}, { timestamps: true });

const AdminNotificationSchema = new mongoose.Schema({
    type: { type: String, enum: ['deposit_initiated', 'deposit_verified', 'discovery_run', 'system'], required: true, index: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    read: { type: Boolean, default: false, index: true },
    acknowledged: { type: Boolean, default: false, index: true },
    acknowledgedAt: { type: Date, default: null }
}, { timestamps: true });

const AdminSettingSchema = new mongoose.Schema({
    _id: { type: String, default: 'global' },
    discoveryEnabled: { type: Boolean, default: true },
    schedules: {
        eventsHours: { type: Number, default: 6, min: 1, max: 168 },
        flightsHours: { type: Number, default: 3, min: 1, max: 168 },
        holidaysHours: { type: Number, default: 12, min: 1, max: 168 }
    },
    enabledCounties: { type: [String], default: () => [...KENYA_47_COUNTIES] },
    enabledCategories: { type: [String], default: () => [...EVENT_CATEGORIES] },
    flightDestinations: { type: [String], default: () => ['NBO', 'WIL', 'MBA', 'KIS', 'EDL', 'MYD', 'UKA'] },
    holidayDestinations: { type: [String], default: () => [...HOLIDAY_DESTINATIONS] },
    defaultCurrency: { type: String, default: 'KES' }
}, { timestamps: true });

const DiscoveryJobSchema = new mongoose.Schema({
    kind: { type: String, enum: ['events', 'flights', 'holidays', 'all'], required: true },
    trigger: { type: String, enum: ['scheduled', 'manual'], default: 'manual' },
    status: { type: String, enum: ['running', 'completed', 'failed'], default: 'running' },
    startedAt: { type: Date, default: Date.now, index: true },
    finishedAt: { type: Date, default: null },
    foundCount: { type: Number, default: 0 },
    createdCount: { type: Number, default: 0 },
    updatedCount: { type: Number, default: 0 },
    expiredRemovedCount: { type: Number, default: 0 },
    errors: [String]
}, { timestamps: true });

const PriceHistorySchema = new mongoose.Schema({
    entityType: { type: String, enum: ['event', 'flight', 'holiday'], required: true, index: true },
    entityId: { type: String, required: true, index: true },
    category: { type: String, default: '' },
    priceKes: { type: Number, required: true },
    currency: { type: String, default: 'KES' },
    priceType: { type: String, enum: ['verified', 'estimated'], default: 'verified' },
    recordedAt: { type: Date, default: Date.now, index: true }
});

module.exports = {
    DiscoveredEvent: mongoose.models.DiscoveredEvent || mongoose.model('DiscoveredEvent', DiscoveredEventSchema),
    EventSource: mongoose.models.EventSource || mongoose.model('EventSource', EventSourceSchema),
    GeneratedTicket: mongoose.models.GeneratedTicket || mongoose.model('GeneratedTicket', GeneratedTicketSchema),
    FlightListing: mongoose.models.FlightListing || mongoose.model('FlightListing', FlightListingSchema),
    HolidayPackage: mongoose.models.HolidayPackage || mongoose.model('HolidayPackage', HolidayPackageSchema),
    AutomationBooking: mongoose.models.AutomationBooking || mongoose.model('AutomationBooking', AutomationBookingSchema),
    DepositRequest: mongoose.models.DepositRequest || mongoose.model('DepositRequest', DepositRequestSchema),
    AdminNotification: mongoose.models.AdminNotification || mongoose.model('AdminNotification', AdminNotificationSchema),
    AdminSetting: mongoose.models.AdminSetting || mongoose.model('AdminSetting', AdminSettingSchema),
    DiscoveryJob: mongoose.models.DiscoveryJob || mongoose.model('DiscoveryJob', DiscoveryJobSchema),
    PriceHistory: mongoose.models.PriceHistory || mongoose.model('PriceHistory', PriceHistorySchema)
};
