# GardenMarket — QR Storefront API

Backend for **GardenMarket**, a QR-based online grocery storefront. Shoppers scan a QR code → a mobile-first product catalog opens with vegetables, fruit, meat & poultry, dairy, greens, bakery and pantry goods; multi-language support; a cart; an AI shopping assistant; and WhatsApp checkout with pickup or delivery.

Forked from a coffee-shop QR menu, so the `dishes` table/route names live on internally — they hold grocery **products** here. Built with **Express 5** + **better-sqlite3**. The storefront lives in the separate **GardenMarket-React** repo and talks to this API cross-origin.

## Features

- 🥬 **Product catalog** — categories, per-unit pricing (kg / piece / pack / bunch), stock tracking, SKU codes
- 🤖 **AI shopping assistant** — Groq Llama-3.3-70B answers about products and recommends items (degrades gracefully to offline when no key is set)
- 🌍 **4 languages** — EN, RU, AZ, TR (all product content stored as multilingual JSON)
- 💱 **Multi-currency** — prices stored in AZN, converted on the fly
- 💬 **WhatsApp checkout** — cart builds a formatted message and opens `wa.me`; the order is saved to the DB with pickup/delivery + address
- 🚚 **Pickup or delivery** — configurable delivery fee and free-delivery threshold
- 📡 **Real-time orders** — new orders broadcast over WebSocket (`/ws`) to the admin panel
- 🛠 **Admin API** — products, categories, promotions, orders, settings, QR-code generation
- 📖 **Swagger UI** — interactive API docs

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Express 5 (CommonJS), better-sqlite3, ws |
| AI | Groq Llama-3.3-70B via OpenAI-compatible REST API (native `fetch`) |
| Images | Cloudinary (optional) with local `/uploads` fallback |
| Docs | swagger-jsdoc + swagger-ui-express |

## Getting Started

### Prerequisites

- Node.js 18+ (or Bun)

### Install

```bash
npm install     # or: bun install
```

### Configure

```bash
cp .env.example .env
```

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3100` | Backend port |
| `NODE_ENV` | `development` | — |
| `DB_PATH` | `db/market.db` | SQLite file location |
| `GROQ_API_KEY` | — | Groq API key (required for AI chat) |
| `GROQ_MODEL` | `llama-3.3-70b-versatile` | Groq model used by the AI chat |
| `GROQ_BASE_URL` | `https://api.groq.com/openai/v1` | Groq OpenAI-compatible API base URL |
| `CLOUDINARY_CLOUD_NAME` | — | Cloudinary cloud name (for hosted product/promo images) |
| `CLOUDINARY_API_KEY` | — | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | — | Cloudinary API secret |
| `CLOUDINARY_FOLDER` | `gardenmarket` | Cloudinary folder for uploads |

Image hosting is optional: when the `CLOUDINARY_*` vars are set, uploaded product/promotion photos go to Cloudinary; otherwise they fall back to local `/uploads`. Seeded demo products carry **no** photos — the storefront renders the category icon instead — so there is no broken-image hazard on a fresh install.

Env files load in order — `.env` first, then `.env.local` **overrides** it. Keep shared defaults in `.env` and per-machine secrets in `.env.local` (both gitignored).

### Run (development)

```bash
npm run dev     # node --watch index.js, port 3100
```

The database is created and seeded automatically on first start (7 categories, ~27 demo products).

### Run (production / Docker)

```bash
docker compose up --build
```

`docker-compose.yml` persists the SQLite database in the `db-data` volume via `DB_PATH=/data/market.db` — the file lives **outside** the container layer, so redeploys don't wipe orders. Set `GROQ_API_KEY` and the `CLOUDINARY_*` vars in the environment (or a `.env`) before deploying.

## Data Model Notes

The `dishes` table doubles as the products table. Grocery-specific columns added on top of the inherited schema:

| Column | Meaning |
|---|---|
| `unit` | `kg` \| `piece` \| `pack` \| `bunch` — how one quantity step is sold and priced |
| `stock_qty` | units in stock; `NULL` = not tracked, `0` = out of stock |
| `sku` | internal article code / barcode |
| `sizes` | JSON `[{label, price}]` pack variants (e.g. rice `1 kq` / `5 kq`) |

Orders carry `fulfillment_type` (`pickup` \| `delivery`) and `delivery_address` instead of a dine-in table number. Order statuses: `new → picking → done` (plus `ready`, `cancelled`).

## API Documentation

With the backend running:

- Swagger UI: **http://localhost:3100/api-docs**
- Raw OpenAPI JSON: `GET /api-docs.json`

To test admin endpoints, click **Authorize** in Swagger UI and enter the admin password (default **`admin123`**).

## Project Structure

```
index.js            ← Entry point: initializes DB, mounts routes, /ws WebSocket
swagger.js          ← OpenAPI 3.0 spec
cloudinary.js       ← Cloudinary SDK config + upload/delete helpers
db/database.js      ← SQLite schema + grocery seed data
routes/
  menu.js           ← Public catalog (categories, products, promotions)
  orders.js         ← Place orders (pickup/delivery)
  ai.js             ← AI chat + recommendations
  settings.js       ← Public/admin settings + QR-code generation
  admin.js          ← Admin CRUD (products, categories, promotions, orders)
middleware/auth.js  ← Admin password check (x-admin-password header)
scripts/            ← Cloudinary upload helpers
```

## License

ISC
