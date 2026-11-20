const {
    ensureDiscoveryDefaults,
    runPublicDiscovery,
    getDiscoveryOverview
} = require('../discovery/DiscoveryEngine');
const {
    startWorker,
    pauseWorker,
    resumeWorker,
    stopWorker,
    rescheduleWorker,
    getWorkerStatus,
    triggerNow
} = require('../discovery/ScheduledDiscoveryWorker');

let catalogRef = null;

function ensureDefaults() {
    return ensureDiscoveryDefaults();
}

function runEventDiscovery(trigger = 'manual') {
    return runPublicDiscovery('events', trigger, { eventCatalogRef: catalogRef });
}

function runTravelDiscovery(kind = 'flights', trigger = 'manual') {
    return runPublicDiscovery(kind, trigger, { eventCatalogRef: catalogRef });
}

function rescheduleJobs() {
    return rescheduleWorker();
}

function startAutomationEngine(eventCatalog) {
    catalogRef = eventCatalog;
    startWorker(eventCatalog);
}

module.exports = {
    ensureDefaults,
    runEventDiscovery,
    runTravelDiscovery,
    rescheduleJobs,
    startAutomationEngine,
    getDiscoveryOverview,
    pauseWorker,
    resumeWorker,
    stopWorker,
    getWorkerStatus,
    triggerNow
};
