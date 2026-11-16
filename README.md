# TALANTA × TICKETSASA LIVE (Full Stack Ecosystem)

A full-stack, enterprise-grade event ticketing and arena management ecosystem combining:
1. **Ticketsasa Event Engine**: [Time Attack - The Last Lap](https://ticketsasa.com/events/time-attack-the-last-lap) (Motorsport sprint ticketing, tiered pricing, fast checkout, live countdown, DMSC Season Finale).
2. **Talanta Sports City**: [Official Stadium Portal](https://talantasportscity.com/) (Interactive 60,000-seater Raila Odinga International Stadium blueprint, trackside viewing angle preview, zone telemetry, gate logistics, luxury suites).
3. **Ticketsasa Editorial & The Hype**: [Konshens Live in Kenya](https://bookings.ticketsasa.com/blog/events/150-jamaican-dancehall-star-konshens-back-in-kenya-for-the-hype) (Editorial magazine layout, artist interview quotes, lineup itinerary, stadium audio acoustics simulator, social buzz).

---

## Architecture Overview

```text
traffic/
├── backend/                  # Node.js + Express + MongoDB Atlas Backend API
│   ├── src/
│   │   ├── config/db.js      # MongoDB Atlas Mongoose connection & graceful fallback
│   │   ├── models/           # Mongoose schemas (Event, StadiumZone, TicketTier, Order, DigitalPass)
│   │   ├── controllers/      # Business logic & server-side demo checkout
│   │   ├── routes/           # REST endpoints (/api/events, /api/zones, /api/tickets, /api/orders, /api/payments)
│   │   ├── seed.js           # Database seeder for MongoDB Atlas
│   │   └── server.js         # Express server running on port 5000
│   ├── .env                  # MongoDB Atlas URI & configuration
│   └── package.json
│
├── frontend-angular/         # Angular 19 Client Application
│   ├── src/
│   │   ├── app/
│   │   │   ├── services/api.service.ts  # Angular HttpClient connected to Node.js backend
│   │   │   ├── app.component.ts         # Reactive state, cart, zone inspection, M-Pesa modal
│   │   │   └── app.component.html       # Modern UI with responsive stadium telemetry & ticketing
│   │   ├── index.html
│   │   ├── main.ts
│   │   └── styles.css
│   ├── angular.json
│   ├── tsconfig.json
│   └── package.json
│
├── index.html                # Standalone Interactive Client (Runs directly on http://localhost:8000)
├── app.js                    # Client-side engine with SVG QR generator & Web Audio API
└── styles.css                # Glassmorphism, animations & print stylesheet for digital passes
```

---

## 1. Node.js & MongoDB Atlas Backend (`backend/`)

### Endpoints
* `GET /api/health` — API health check and status.
* `GET /api/events/featured` — Get Time Attack & Konshens Live event specs.
* `GET /api/zones` — Get Talanta Sports City stadium zones (North Stand, South Stand, Pit Lane, VVIP Suite).
* `GET /api/tickets` — Get live ticket tiers and remaining allocations.
* `POST /api/orders` creates a validated demo order using server prices.
* `POST /api/payments/mpesa/stkpush` prepares a local demo payment.
* `POST /api/payments/demo/confirm` completes a demo payment and issues one pass per ticket.
* `POST /api/orders/lookup` retrieves an order and its passes using its reference and checkout email.
* `GET /api/passes/verify/:qrToken` checks the current status of a pass.
* `POST /api/passes/redeem/:qrToken` redeems a pass at the specified gate. Requires the bearer token configured in `PASS_SCANNER_KEY`.

### Run the standalone app and backend

Use Node.js 22.13 or later. From the project root:

```bash
cd backend
npm ci
npm start
```

Open http://localhost:8000. The backend serves the standalone app and its API
on the same address. Copy `backend/.env.example` to `backend/.env` if needed.

Set `MONGODB_URI` in `backend/.env` to a MongoDB Atlas cluster or a replica
set. Event imports, orders, inventory holds, passes, and admin history are
stored in MongoDB. Checkout requires MongoDB transactions.

For a local payment simulation, set `PAYMENT_MODE=demo` outside production.
Use `PAYMENT_MODE=live` only with the production payment settings below.

To preserve records from an older SQLite installation, stop the old server
and run `node src/migrateCommerce.js` from `backend` before starting the new
server against the target database. The optional first argument specifies a
different SQLite file. The migration reads the old file without modifying it.

---

## 2. Angular Application (`frontend-angular/`)

The Angular client utilizes Angular 19 with standalone components and Angular's `HttpClient` to communicate with the Node.js backend.

### Running Angular:
```bash
cd frontend-angular
npm install
npm start
```
The Angular application will launch on `http://localhost:4200`.

---

## 3. Standalone Client (`index.html`)

Open **[http://localhost:8000](http://localhost:8000)** after starting the backend.

## Automatic Kenya event listings

The backend refreshes upcoming Kenyan listings from
[SoldOut Africa](https://soldoutafrica.com/events) at startup and every
15 minutes. It caches the last successful result in MongoDB. A failed
refresh leaves the previous listings available with a stale label.

### Tickets.dev discovery

Set `TICKETS_DEV_KEY` in the server environment to add Tickets.dev results to
the Kenya event catalog. `TICKETS_DEV_QUERIES` is a comma-separated list of
search terms, defaulting to Nairobi and Talanta Sports City. The importer
keeps upcoming events with a Kenyan venue and caches results in MongoDB.
Use `tk_test_sandbox` for development with provider fixtures. Discovery
does not create inventory or enable checkout for a listing.

Set `TICKETMASTER_API_KEY` to also import Ticketmaster Discovery events.
The importer requests Kenyan venues and saves a separate MongoDB snapshot.
Ticketmaster listings also require an authorized allocation or booking
integration before checkout can be offered.

### Quicket discovery

Set `QUICKET_API_KEY` in the backend environment to import upcoming Kenyan
events from Quicket. The importer checks up to three pages of recently
modified public listings. Set `QUICKET_EVENT_IDS` to a comma-separated list
of numeric event IDs from Quicket URLs to import those specific events
instead. Results are cached in MongoDB. Public listings do not enable
checkout or grant permission to sell tickets.

### Automatic checkout for imported events

Public listings describe events and advertised prices. Configure a separate
authorized, dedicated allocation feed to supply inventory this site can sell
and issue passes for. Set `EVENT_ALLOCATION_FEED_URL` to its HTTPS URL and
`EVENT_ALLOCATION_FEED_TOKEN` to its bearer token. The supplier can return this
format directly or expose an adapter with the same contract:

```json
{
  "validUntil": "2027-01-01T10:30:00+03:00",
  "events": [{
    "eventId": "soldoutafrica:/events/example",
    "salesOpen": "2026-12-01T09:00:00+03:00",
    "salesClose": "2027-01-02T18:00:00+03:00",
    "tiers": [{
      "id": "east-stand",
      "title": "East Stand",
      "priceKes": 2500,
      "capacity": 120,
      "gate": "Gate A"
    }]
  }]
}
```

Use an exact ID from `GET /api/events/kenya` and keep tier IDs stable.
Capacity is the total allocation dedicated to this site, including any
units already bought through this site. Supply a fresh `validUntil` within
one hour on each refresh. Sales close when an allocation is removed or
expires. Events with active allocations link to checkout automatically.
Talanta listings with an allocation also appear in the stadium ticket picker.
Use `/organizer` for events outside the feed.

## Event checkout and inventory holds

The demo sells general-admission tiers for Talanta Open Day. Ticket tiers can
carry an event ID and title. The server stores the event title on order lines and
issued passes.

Creating an order holds its ticket and merchandise quantities for ten minutes.
Expired holds become available automatically. A completed payment converts the
hold into a sale and issues one QR pass per ticket. Customers can recover the
passes through My tickets using the order reference and checkout email.

## Staff gate check-in

Set a private `PASS_SCANNER_KEY` on the backend and restart it. Staff can open
`/staff/check-in`, enter the key, select their assigned gate, and scan or type
a pass code. A successful check-in marks the pass used. Serve the staff page
over HTTPS in production.

## Publish an event

Set a private `ORGANIZER_KEY` on the server, restart the backend, and open
`/organizer`. Dates entered there use East Africa Time. The published event
appears on the Events page with its own ticket tiers during the sales window.
Set the venue to Talanta Sports City or Raila Odinga International Stadium
to list the event on the Talanta page too. Both pages sell from the same ticket
inventory and use the same checkout.

### Live M-Pesa checkout

Set `PAYMENT_MODE=live` on the backend after supplying production Daraja
Express credentials in the server environment. Set `MPESA_CONSUMER_KEY`,
`MPESA_CONSUMER_SECRET`, `MPESA_SHORTCODE` and `MPESA_PASSKEY`. For a Buy Goods
integration also set `MPESA_TILL_NUMBER` to the destination till number.
`MPESA_CALLBACK_URL` must point to the public HTTPS
`/api/payments/mpesa/callback` endpoint on the backend serving checkout.

PayHero and Nexus Pay are alternate M-Pesa providers. Configure the merchant
settings for the provider you use from `backend/.env.example` and set
`PAYMENT_MODE=live`. The checkout uses the first configured provider in this
order: Daraja, PayHero, Nexus Pay. The server verifies payment directly with
the configured provider before issuing passes.

Live checkout accepts KES for organizer-published and authorized imported ticket tiers. The backend
uses the provider status API to confirm payment before issuing passes.
Customers can check pending orders in **My tickets** using their reference and
email. If a request
times out before Daraja returns a checkout ID, the order stays pending and its
stock remains reserved. Reconcile the order against the merchant account before
releasing that stock or requesting another payment.

Open admin pages by direct URL. Sign in as admin with the corresponding
server key as the password. Use HTTPS outside localhost. The forms use
the same keys for their API requests.

## Administration dashboard

Build the dashboard with `npm ci` followed by `npm run build` in `admin-ui`.
Restart the backend and open `/admin`. Sign in as `admin` with the private
`ORGANIZER_KEY` from the backend environment.

The dashboard reads event, commerce and SoldOut Africa catalog data from MongoDB. It includes event publication status, ticket inventory, customer
order history, transaction CSV export, manual source refresh and an event
status audit log. Admin reports include orders explicitly marked live. Demo orders and local
fallback event listings are excluded.

## Verify an Atlas connection

Set the Atlas Drivers connection string as `MONGODB_URI` in `backend/.env`.
From `backend`, run `npm run check:atlas`. This checks the connection without
seeding collections or printing credentials.

### Individual gate scanner credentials

Set `PASS_SCANNER_ACCOUNTS` to a JSON array of records containing `id`, `gate`
(e.g. `GATE A`), `enabled`, and `keyHash` (the SHA-256 hex digest of a long
random per-person secret). Restart the backend after changing the accounts.
Staff use username `admin` and their own secret on the check-in page and form.
Setting this array disables the shared scanner key. Each redemption records
the scanner ID. Use HTTPS outside localhost.

### Individual organizer accounts

Set `ORGANIZER_ACCOUNTS` to a JSON array of records with `id`, `enabled` and
`keyHash`, the SHA-256 hex digest of a unique, long random secret. Use the
record ID as the browser username and the secret as the password. Restart to
apply account changes. When configured, the array replaces shared-key access.
Publishing and event status changes record the organizer ID in the audit log.
Use HTTPS outside localhost.
