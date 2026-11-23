const { isConnected } = require('../../config/db');
const { AdminSetting, DiscoveredEvent, FlightListing, HolidayPackage } = require('../../models/automation');
const { ensureDiscoveryDefaults, runPublicDiscovery, activeRuns } = require('./DiscoveryEngine');
const { unpublishExpiredListings } = require('./AutoPublisher');

let timers = [];
let eventCatalogRef = null;
let paused = false;
let started = false;
let nextRunSchedule = { eventsAt: null, flightsAt: null, holidaysAt: null };

function clearTimers() {
    for (const t of timers) clearInterval(t);
    timers = [];
}

async function rescheduleWorker() {
    clearTimers();
    const settings = await ensureDiscoveryDefaults();
    if (!settings) return;
    paused = Boolean(settings.discoveryPaused || !settings.discoveryEnabled);
    if (paused) {
        nextRunSchedule = { eventsAt: null, flightsAt: null, holidaysAt: null };
        return;
    }

    const evMs = Math.max(1, settings.schedules?.eventsHours || 6) * 3600000;
    const flMs = Math.max(1, settings.schedules?.flightsHours || 3) * 3600000;
    const hoMs = Math.max(1, settings.schedules?.holidaysHours || 12) * 3600000;
    const expMs = Math.max(1, settings.schedules?.expirationCheckHours || 1) * 3600000;

    nextRunSchedule = {
        eventsAt: new Date(Date.now() + evMs).toISOString(),
        flightsAt: new Date(Date.now() + flMs).toISOString(),
        holidaysAt: new Date(Date.now() + hoMs).toISOString()
    };

    if (isConnected()) {
        void unpublishExpiredListings().catch(() => {});
    }

    timers.push(
        setInterval(() => {
            if (!paused) {
                nextRunSchedule.eventsAt = new Date(Date.now() + evMs).toISOString();
                void runPublicDiscovery('events', 'scheduled', { eventCatalogRef });
            }
        }, evMs).unref(),
        setInterval(() => {
            if (!paused) {
                nextRunSchedule.flightsAt = new Date(Date.now() + flMs).toISOString();
                void runPublicDiscovery('flights', 'scheduled', { eventCatalogRef });
            }
        }, flMs).unref(),
        setInterval(() => {
            if (!paused) {
                nextRunSchedule.holidaysAt = new Date(Date.now() + hoMs).toISOString();
                void runPublicDiscovery('holidays', 'scheduled', { eventCatalogRef });
            }
        }, hoMs).unref(),
        setInterval(() => {
            if (!paused && isConnected()) void unpublishExpiredListings().catch(() => {});
        }, expMs).unref()
    );
}

function triggerNow(kind = 'all') {
    if (!isConnected()) return false;
    setImmediate(() => {
        void runPublicDiscovery(kind, 'manual', { eventCatalogRef });
    });
    return true;
}

async function pauseWorker() {
    paused = true;
    clearTimers();
    await AdminSetting.findByIdAndUpdate('global', { $set: { discoveryPaused: true } }, { upsert: true }).catch(() => {});
    return getWorkerStatus();
}

async function resumeWorker() {
    paused = false;
    await AdminSetting.findByIdAndUpdate('global', { $set: { discoveryPaused: false, discoveryEnabled: true } }, { upsert: true }).catch(() => {});
    await rescheduleWorker();
    return getWorkerStatus();
}

async function stopWorker() {
    paused = true;
    started = false;
    clearTimers();
    await AdminSetting.findByIdAndUpdate('global', { $set: { discoveryEnabled: false, discoveryPaused: true } }, { upsert: true }).catch(() => {});
    return getWorkerStatus();
}

function getWorkerStatus() {
    return {
        started,
        paused,
        status: !started ? 'stopped' : paused ? 'paused' : (activeRuns.size ? 'running' : 'idle'),
        activeKinds: [...activeRuns],
        nextRunSchedule
    };
}

function startWorker(catalog) {
    if (catalog) eventCatalogRef = catalog;
    started = true;
    setTimeout(async () => {
        if (!isConnected()) return;
        await rescheduleWorker().catch(() => {});
        const [evCount, flCount, hoCount] = await Promise.all([
            DiscoveredEvent.countDocuments().catch(() => 0),
            FlightListing.countDocuments().catch(() => 0),
            HolidayPackage.countDocuments().catch(() => 0)
        ]);
        if (!paused && (evCount === 0 || flCount === 0 || hoCount === 0)) {
            void runPublicDiscovery('all', 'scheduled', { eventCatalogRef });
        }
    }, 6000).unref();
}

module.exports = {
    startWorker,
    pauseWorker,
    resumeWorker,
    stopWorker,
    rescheduleWorker,
    triggerNow,
    getWorkerStatus
};
