const test = require('node:test');
const assert = require('node:assert/strict');
const { collection } = require('../src/services/commerceDb');
const { createEventCatalog } = require('../src/config/eventCatalog');

test('organizer-published future events appear in /api/events/kenya catalog and respect unpublish & cache invalidation', async () => {
    const futureStart = new Date(Date.now() + 7 * 86400000).toISOString();
    const pastStart = new Date(Date.now() - 2 * 86400000).toISOString();
    const openAt = new Date(Date.now() - 3600000).toISOString();

    const liveId = 'org-test-live-1';
    const unpubId = 'org-test-unpub-1';
    const pastId = 'org-test-past-1';

    await collection('commerce_events').insertMany([
        {
            _id: liveId,
            id: liveId,
            title: 'Tupatane Outsyde Kakuma',
            venue: 'Kakuma Grounds',
            description: 'Live concert in Kakuma',
            status: 'published',
            salesOpen: openAt,
            salesClose: futureStart,
            startsAt: futureStart,
            image: null,
            tiers: [{ tierKey: liveId + '-1', title: 'Regular', priceKes: 500, remainingAllocation: 100, published: true }]
        },
        {
            _id: unpubId,
            id: unpubId,
            title: 'Hidden Draft Event',
            venue: 'Nairobi',
            description: 'Draft',
            status: 'unpublished',
            salesOpen: openAt,
            salesClose: futureStart,
            startsAt: futureStart,
            tiers: [{ tierKey: unpubId + '-1', title: 'Regular', priceKes: 500, remainingAllocation: 100, published: true }]
        },
        {
            _id: pastId,
            id: pastId,
            title: 'Expired Past Event',
            venue: 'Kakuma',
            description: 'Past',
            status: 'published',
            salesOpen: openAt,
            salesClose: pastStart,
            startsAt: pastStart,
            tiers: [{ tierKey: pastId + '-1', title: 'Regular', priceKes: 500, remainingAllocation: 100, published: true }]
        }
    ]);

    const catalog = createEventCatalog({ providers: [] });
    const first = await catalog.get();
    const foundLive = first.events.find(e => e.id === liveId);
    assert.ok(foundLive, 'Published future organizer event must be included in catalog');
    assert.equal(foundLive.title, 'Tupatane Outsyde Kakuma');
    assert.equal(foundLive.startingPrice, 500);
    assert.equal(foundLive.onSale, true);
    assert.equal(first.events.find(e => e.id === unpubId), undefined, 'Unpublished event must be excluded');
    assert.equal(first.events.find(e => e.id === pastId), undefined, 'Expired event must be excluded');

    // Unpublish and invalidate cache -> disappears immediately
    await collection('commerce_events').updateOne({ _id: liveId }, { $set: { status: 'unpublished' } });
    catalog.invalidateCache();
    const second = await catalog.get();
    assert.equal(second.events.find(e => e.id === liveId), undefined, 'Unpublished event must disappear after invalidateCache');

    // Clean up fallback store
    await collection('commerce_events').deleteMany({ _id: liveId });
    await collection('commerce_events').deleteMany({ _id: unpubId });
    await collection('commerce_events').deleteMany({ _id: pastId });
});
