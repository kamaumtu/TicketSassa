# TALANTA × TICKETSASA LIVE (Full Stack Ecosystem)

A full-stack, enterprise-grade event ticketing and arena management ecosystem combining:
1. **Ticketsasa Event Engine**: [Time Attack - The Last Lap](https://ticketsasa.com/events/time-attack-the-last-lap) (Motorsport sprint ticketing, tiered pricing, fast checkout, live countdown, DMSC Season Finale).
3. **Ticketsasa Editorial & The Hype**: [Konshens Live in Kenya](https://bookings.ticketsasa.com/blog/events/150-jamaican-dancehall-star-konshens-back-in-kenya-for-the-hype) (Editorial magazine layout, artist interview quotes, lineup itinerary, stadium audio acoustics simulator, social buzz).

---

## Architecture Overview

```text
traffic/
├── backend/                      # Express API, MongoDB, auth and payments
│   ├── src/
│   ├── test/
│   ├── .env                      # Private backend configuration
│   └── package.json
├── frontend/                     # All client applications and public files
│   ├── index.html                # Storefront served at http://localhost:8000
│   ├── app.js
│   ├── styles.css
│   ├── assets/
│   ├── admin-ui/                 # React admin dashboard
│   ├── frontend-angular/         # Optional Angular client
│   ├── android/                  # Android WebView wrapper
│   ├── scripts/                  # Frontend build helpers and legacy archive
│   ├── dist/                     # Optional downloadable APK output
│   └── package.json
├── package.json                  # Root convenience commands
├── Dockerfile
└── render.yaml
```

Run `npm run install:all` from the project root to install all application dependencies.
Run `npm start` to serve the API and frontend together on port 8000.
Run `npm run build` to build the storefront, admin dashboard and Angular client.
Backend secrets stay in `backend/.env`; never copy them into `frontend`.
Existing URLs such as `/admin`, `/assets` and `/api` remain unchanged.


---

## 1. Node.js & MongoDB Atlas Backend (`backend/`)

### Endpoints
* `GET /api/health` — API health check and status.
* `GET /api/events/featured` — Get Time Attack & Konshens Live event specs.
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

## 2. Angular Application (`frontend/frontend-angular/`)

The Angular client utilizes Angular 19 with standalone components and Angular's `HttpClient` to communicate with the Node.js backend.

### Running Angular:
```bash
cd frontend/frontend-angular
npm install
npm start
```
The Angular application will launch on `http://localhost:4200`.

---

## 3. Standalone Client (`index.html`)

Open **[http://localhost:8000](http://localhost:8000)** after starting the backend.

Customers can create an account, sign in, and sign out from **Log In**.
Accounts and expiring sessions require MongoDB. Use HTTPS for public
deployments. Ticket lookup continues to require the order reference and
checkout email.

- Set `AUTH_PUBLIC_ORIGIN` to the public HTTPS storefront origin
  (or `http://localhost:8000` for local testing).
- In Google Cloud, create a Web application OAuth client. Add
  `<AUTH_PUBLIC_ORIGIN>/api/auth/google/callback` as an authorized redirect URI
  and set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Google sign-in
  supports Gmail and Google Workspace accounts in a regular browser.
- To send confirmation email, set `RESEND_API_KEY` and `AUTH_EMAIL_FROM`
  using a verified sender domain. Customers confirm the email before signing
  in with a password. The sign-in screen can request a replacement link.

### Install the web app or distribute an APK

Serve the Express app and its API together at a public HTTPS origin. Visitors
can use **Install app** in a browser that supports the install prompt, or
**Add to Home Screen** from their browser menu. Localhost is suitable for
testing on this computer. Booking and wallet requests still need a connection.

The `frontend/android/` project packages the same HTTPS storefront. Build it with
JDK 17, Gradle 8.9, and Android SDK Platform 35. Set
`TICKETSASA_WEB_ORIGIN` to your deployed origin, with no path. For a local
Android smoke test run `gradle -p frontend/android :app:assembleDebug`. For release,
configure `TICKETSASA_KEYSTORE`, `TICKETSASA_STORE_PASSWORD`,
`TICKETSASA_KEY_ALIAS`, and `TICKETSASA_KEY_PASSWORD` in your build environment,
then run `gradle -p frontend/android :app:prepareDownload`. Keep the keystore and its
passwords outside the repository and reuse the signing key for updates.

Deploy `frontend/dist/ticketsasa.apk` with the backend. The server serves it at
`/downloads/ticketsasa.apk`, and the storefront displays **Android APK**
when the file is available.

## Automatic Kenya event listings

The backend refreshes upcoming Kenyan listings from
[SoldOut Africa](https://soldoutafrica.com/events) at startup and every
15 minutes. It caches the last successful result in MongoDB. A failed
refresh leaves the previous listings available with a stale label.

### Modular Event Providers & Automatic Synchronisation

Event imports are handled through provider adapters in `backend/src/services/providers/`:
- **TKT API** (`tktEvents.js`): Set `TKT_API_KEY` (and optional `TKT_API_BASE_URL`) to import TKT events, posters and descriptions.
- **eGotickets Partner API** (`egoticketsEvents.js`): Set `EGOTICKETS_API_KEY` (and optional `EGOTICKETS_BASE_URL`) to import East Africa partner events.
- **Quicket Kenya** (`quicketEvents.js`): Disabled by default; set `QUICKET_ENABLED=true` together with `QUICKET_API_KEY` (and optional `QUICKET_EVENT_IDS`) to enable.
- **Tickets.dev** (`ticketsDevEvents.js`): Set `TICKETS_DEV_KEY` and `TICKETS_DEV_QUERIES` (defaults to `Nairobi`) to import upcoming Kenyan discovery listings.
- **Direct Organiser Submissions** (`publishedEvents.js`): Organisers publish directly via `/organizer` or `/api/published-events`.

The sync engine (`eventSyncService.js`) runs on startup and every 15 minutes with duplicate detection, automatic poster/description/price updates, and cancellation detection. Only authorized, non-cancelled inventory is enabled for checkout.

### Automatic checkout for imported events

The catalog publishes advertised KES prices from event feeds and matching
public event pages. Each researched price carries its source and check time.
The publishing lobby shows the price lookup count separately from checkout status.
Configure a separate
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

The allocation feed can cover any synced provider. Use stable event IDs from
`GET /api/events/kenya` (such as `quicket:406815`) and keep tier IDs stable.
An optional `description` overrides the imported event description.
Capacity is the total allocation dedicated to this site, including any
units already bought through this site. Supply a fresh `validUntil` within
one hour on each refresh. Sales close when an allocation is removed or
expires. Events with active allocations link to checkout automatically.
Live checkout reads a fresh supplier snapshot when creating an imported-ticket
order and again before sending the M-Pesa prompt. Changed prices require the
customer to review the new quote and unavailable stock blocks payment.
Use `/organizer` for events outside the feed.

## Event checkout and inventory holds

Ticket tiers can
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

Build the dashboard with `npm ci` followed by `npm run build` in `frontend/admin-ui`.
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
