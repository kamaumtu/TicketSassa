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

Set `PAYMENT_MODE=demo` for local checkout. Demo checkout does not send a
phone prompt or charge money and is disabled in production. New demo orders,
ticket stock and passes are saved in `backend/data/commerce.sqlite`. Set
`COMMERCE_DB_PATH` to store the database elsewhere. Save the order reference
to recover passes from **My tickets** with the checkout email.

### Connecting to MongoDB
MongoDB is optional for the local demo. To use your own event and inventory catalog, start a local MongoDB instance on port 27017 or set `MONGODB_URI` in `backend/.env` to your Atlas connection string. Copy `backend/.env.example` to `backend/.env` if the file is missing.

From the project root:

```bash
cd backend
npm ci
npm run seed
npm start
```

The seed command replaces the event, stadium-zone, and ticket-tier collections. Run it against a development database. Check the API and database connection at http://localhost:8000/api/health.

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

The backend reads the structured event listings at https://soldoutafrica.com/events
on startup and every 15 minutes. Both clients check the backend every minute.
The catalog shows upcoming listings marked Kenya by the source, with posters
and the lowest in-stock KES price when supplied. Listings are informational.

If refresh fails, the catalog keeps the last successful result in memory and
marks it stale. Until a successful refresh, it shows upcoming saved entries
from `backend/src/config/localEvents.json`. No Ticketmaster key is required.

The local clients use `http://localhost:8000/api/events/kenya`. In a deployment,
route `/api/events/kenya` to the backend on the app's origin, or set the
`api-url` attribute on `<kenya-event-catalog>` to your backend endpoint.

## Event checkout and inventory holds

The demo sells general-admission tiers for Talanta Open Day. Ticket tiers can
carry an event ID and title. The server stores the event title on order lines and
issued passes. Discovery listings are informational.

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
Checkout uses the existing order and inventory-hold flow. The payment gateway
must be connected before the site can charge customers.

Open admin pages by direct URL. Sign in as admin with the corresponding
server key as the password. Use HTTPS outside localhost. The forms use
the same keys for their API requests.

## Administration dashboard

Build the dashboard with `npm ci` followed by `npm run build` in `admin-ui`.
Restart the backend and open `/admin`. Sign in as `admin` with the private
`ORGANIZER_KEY` from the backend environment.

The dashboard reads the existing commerce SQLite database and SoldOut Africa
catalog. It includes event publication status, ticket inventory, customer
order history, transaction CSV export, manual source refresh and an event
status audit log. Admin reports include orders explicitly marked live. Demo orders and local
fallback event listings are excluded.

## Verify an Atlas connection

Set the Atlas Drivers connection string as `MONGODB_URI` in `backend/.env`.
From `backend`, run `npm run check:atlas`. This checks the connection without
seeding collections or printing credentials. The dashboard commerce data still
uses SQLite and requires a separate migration.
