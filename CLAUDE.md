# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Backend for **GardenMarket**, a QR-based online grocery store. Shoppers scan a QR code → a mobile-first product catalog opens (vegetables, fruit, meat & poultry, dairy & eggs, greens & herbs, bakery, pantry) with per-unit pricing, an AI shopping assistant, multi-language content (EN/RU/AZ/TR), a cart, and WhatsApp checkout with pickup or delivery. Built with Express 5 (CommonJS) + better-sqlite3.

**This repo was forked from a coffee-shop QR menu.** The `dishes` table and `/api/menu/dishes` route names are inherited and still in use — they hold grocery **products** here. When touching this code, keep that mapping in mind: "dish" in the schema/routes means "product" in the domain. The customer- and admin-facing wording all says "product".

The **storefront (React) lives in a separate repo, `GardenMarket-React`**, and talks to this API cross-origin (CORS is open). This backend does not serve the SPA in production.

## Commands

```bash
npm install                 # install deps (better-sqlite3 compiles natively)
npm run dev                 # node --watch index.js  (port 3100)
npm start                   # node index.js
docker compose up --build   # production container (persists db in a volume)
```

There is no test suite. Verify by hitting the API with curl or Swagger UI.

## Environment

Copy `.env.example` to `.env`. Key vars: `PORT` (3100), `DB_PATH` (`db/market.db`), `GROQ_API_KEY` (AI chat), `CLOUDINARY_*` (image hosting, optional — `CLOUDINARY_FOLDER` defaults to `gardenmarket`). `.env.local` overrides `.env`.

## Architecture

```
index.js            ← Entry point. initDB(), mounts /api/* routes, one WebSocketServer on /ws.
swagger.js          ← OpenAPI 3.0 spec (hand-written paths object, apis: []).
cloudinary.js       ← SDK config + uploadImage/deleteImage. FOLDER defaults to 'gardenmarket'.
db/database.js      ← SQLite schema, migrations, and the grocery seed. Exports getDB, initDB, UNITS.
routes/
  menu.js           ← GET categories / dishes (paginated) / dishes/:id / promotions.
  orders.js         ← POST orders. Validates fulfillment_type + requires an address for delivery.
  ai.js             ← POST /chat (Groq) + /recommend (pure SQLite). System prompt = grocery assistant.
  settings.js       ← public/admin settings, PUT settings, POST qrcode (STORE_SLUG = 'gardenmarket').
  admin.js          ← Admin CRUD. normalizeUnit/normalizeStock guard the new fields. ORDER_STATUSES.
middleware/auth.js  ← adminAuth: checks x-admin-password against the admin_password setting.
```

## Key Patterns

**Products (the `dishes` table)**: One products table, named `dishes` for fork continuity. Grocery columns on top of the inherited schema:
- `unit` — `kg` | `piece` | `pack` | `bunch` (see the `UNITS` export). Drives price rendering ("2.20 ₼/kq" vs plain "2.40 ₼") and what a quantity step means.
- `stock_qty` — `NULL` means *not tracked* (always available); `0` means *out of stock*; `>0` is the count. `normalizeStock()` in `routes/admin.js` enforces this: an empty form field stores `NULL`, not `0`.
- `sku` — free-text article code / barcode.
- `sizes` — inherited JSON `[{label, price}]`, repurposed as **pack variants** (e.g. rice `1 kq` / `5 kq`). `price` mirrors the smallest pack and is the card/fallback price.
Admin writes go through `normalizeUnit()` (unknown unit → `piece`) and `normalizeStock()`.

**Multilingual content**: All product names/descriptions/ingredients are JSON strings `{en, ru, az, tr}` in SQLite. Frontend resolves via `tl()`. `ingredients` is a JSON array per language and is `NULL` for raw produce.

**Orders & fulfillment**: `orders` has `fulfillment_type` (`pickup` | `delivery`) and `delivery_address` instead of the café's `table_number`. `POST /api/orders` rejects a delivery order with no address (400). Status vocabulary: `['new', 'picking', 'ready', 'done', 'cancelled']` — `picking` = staff gathering items. `PUT /api/admin/orders/:id/status` validates the status against this list.

**Seeding**: On an empty DB, `seedData()` inserts 7 categories and ~27 products. Unlike the café fork, **seeded products have no images** (`image` stays `NULL`, the storefront falls back to the category icon), so seeding is *not* gated on Cloudinary being configured — a fresh install always gets demo content.

**Category icons**: `categories.icon_key` names a built-in SVG rendered by the React app (`vegetables`, `fruit`, `meat`, `dairy`, `herbs`, `bakery`, `pantry`). The seed sets these; they must match the `ICON_OPTIONS` keys in `GardenMarket-React/src/categoryIcons.jsx`. Legacy emoji lives in `categories.icon` as a fallback.

**AI chat**: `POST /api/ai/chat` calls Groq's OpenAI-compatible Chat Completions API via native `fetch`. The system prompt is a **grocery-store assistant** (`routes/ai.js`) — it lists each product with its per-unit price and an OUT OF STOCK marker, and is instructed never to quote a per-kg price for a per-piece item. Returns `{ offline: true }` gracefully on auth/quota/network failure. `extractMentionedDishes()` scans the reply for product names (all languages) and returns matching rows so the frontend can show add-to-cart cards.

**Admin auth**: All `/api/admin/*` and `PUT /api/settings` require an `x-admin-password` header matching the `admin_password` setting (default `admin123`).

**QR code**: `POST /api/settings/qrcode` builds a QR pointing at `menu_url` + `/gardenmarket` (the `STORE_SLUG`) — e.g. `https://menyuqr.com/gardenmarket`. Unlike the café there is **no table parameter** — one QR opens the store.

**Images (Cloudinary)**: `cloudinary.js` uploads to the `gardenmarket` folder when configured; `routes/admin.js` `persistImage()` falls back to writing local `/uploads` otherwise. The DB stores the full URL either way, and the frontend uses `src={product.image}` directly.

**WhatsApp number**: Stored in the `whatsapp_number` setting and editable from the admin panel (unlike the café fork, where it was locked).

## Default settings (seeded)

`restaurant_name` (GardenMarket ×4 langs), `whatsapp_number`/`phone` (`+994519923208` — change these), `instagram`, `opening_hours` (09:00–21:00), `menu_url` (`https://menyuqr.com`), `admin_password` (`admin123`), `accent_color` (`#4C9A2A` green), `delivery_fee` (`3`), `free_delivery_over` (`50`), `currency_rates`, `address`.

## Deployment notes

- `DB_PATH` **must** point inside the mounted volume (`/data/market.db` in compose), or redeploys wipe the database.
- `.dockerignore` excludes `db/*.db*` (glob) so a local dev database is never baked into the image.
- The SPA is deployed separately (GardenMarket-React) under `menyuqr.com/gardenmarket` via Traefik with a StripPrefix rule; this API is a separate Coolify app on its own domain (set as the SPA's `VITE_API_BASE`).
