# Automated holidays and flights

The admin travel lobby is `/admin/travel`. It shows supplier setup, last refresh results, publishing decisions and seven days of sync history. Both feeds refresh every 15 minutes and when MongoDB reconnects. Offers and reservations use MongoDB only. The existing itinerary ideas are separate from purchasable supplier offers.

## Connect a supplier

Configure these backend environment variables with a contracted supplier or a supplier adapter implementing the protocol below. These are Ticketsassa adapter settings, not endpoints that arbitrary airline or hotel APIs already implement.

```
FLIGHT_OFFERS_URL=https://your-adapter.example/flights/offers
FLIGHT_BOOKING_URL=https://your-adapter.example/flights/bookings
FLIGHT_SUPPLIER_TOKEN=
HOLIDAY_OFFERS_URL=https://your-adapter.example/holidays/offers
HOLIDAY_BOOKING_URL=https://your-adapter.example/holidays/bookings
HOLIDAY_SUPPLIER_TOKEN=
```

URLs must use HTTPS. Tokens remain on the backend and are sent as Bearer authorization. No supplier adapter or commercial travel account is bundled. Amadeus credentials alone do not implement this adapter or enable ticket issuance.

## Offer feed

GET the offers URL returns a full snapshot, with at most 1,000 offers. Each offer describes a fixed trip and its total price for the described travellers, room occupancy and inclusions. Use ISO dates with explicit timezone offsets. IDs must be stable. Amounts are positive integer KES.

```json
{"offers":[{"id":"supplier-offer-123","title":"A fixed trip for one adult","description":"Exact itinerary, baggage or room, inclusions, taxes and cancellation terms","supplier":"Supplier name","origin":"NBO","destination":"MBA","priceBasis":"total for one adult","currency":"KES","priceKes":8500,"available":2,"bookable":true,"startsAt":"2027-03-10T09:00:00+03:00","endsAt":"2027-03-10T10:00:00+03:00","expiresAt":"2027-03-01T10:00:00+03:00"}]}
```

This example is a schema fixture, not live inventory. Include required passenger-document or guest eligibility collection in the adapter before accepting a hold. Missing booking configuration produces a listing only. Old offers are withdrawn on a successful snapshot. Invalid snapshots do not erase prior offers. Expired and past-departure offers are hidden even if the supplier cannot be reached. Quotes last no longer than 30 minutes between refreshes.

## Booking adapter

POST the booking URL supports two actions and must enforce idempotency per action and `idempotencyKey`.

1. `hold` receives `offerId`, `expectedPriceKes`, `currency`, `quantity: 1`, fixed dates and customer name, email and phone. Reprice and reserve real inventory. Only respond with `{"status":"HELD","reservationRef":"supplier-reference","priceKes":8500,"currency":"KES","expiresAt":"ISO timestamp"}` after a successful supplier hold. The hold must leave more than two minutes to pay. Price changes and failed holds stop checkout before M-Pesa. Release unpaid holds on expiry. A hold may remain unused if the database write fails.
2. `confirm` receives `reservationRef`, `orderReference`, `receipt`, and the same idempotency key. Issue the actual airline ticket or accommodation voucher and return `{"status":"CONFIRMED","confirmationCode":"actual supplier code"}`. The adapter must independently authenticate/reconcile the payment with Ticketsassa before issuing anything based on this action. Network failures stay `AWAITING_SUPPLIER` and retry every minute. Retries must return the original confirmation and never issue duplicate travel documents. This adapter protocol returns a confirmation reference; travel document delivery is the supplier's responsibility.

Customers choose an offer, enter contact details, receive a real hold, and pay through the gateway selected in admin. Booking lookup requires the order reference and customer email. No locally generated airline ticket numbers or hotel voucher confirmations are used by this workflow.

## Validation

Run `node --test test/travel.test.cjs` from `backend`. These tests use isolated supplier and database fixtures, do not connect to Atlas, and never request payment. They cover malformed feeds, expiry, price changes, withdrawals, idempotency, pending confirmation, and database outages. Real supplier fulfillment, Atlas and gateway credentials must also be verified before public sales.
