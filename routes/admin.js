const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
// Optional: if the native binary is unavailable on this platform, uploads still
// work — they just skip optimisation instead of taking /api/admin/* down.
let sharp = null;
try {
  sharp = require('sharp');
} catch (err) {
  console.warn('[upload] sharp unavailable, storing images as-is:', err.message);
}
const { getDB, UNITS } = require('../db/database');
const { adminAuth } = require('../middleware/auth');
const cloudinary = require('../cloudinary');
const router = express.Router();

// Buffer uploads in memory so we can push them straight to Cloudinary; if
// Cloudinary isn't configured (or fails) we fall back to writing /uploads.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const uploadsDir = path.join(__dirname, '../uploads');

// Phone cameras and design exports produce multi-megabyte PNGs; a product card
// renders them at ~180-400px. Downscale to a sane max edge and re-encode as
// JPEG so a catalogue page costs kilobytes, not megabytes. Returns the original
// buffer unchanged if the file isn't a decodable image (sharp throws) — the
// caller still stores it rather than losing the admin's upload.
// 700px covers every place a photo is shown: the widest card is ~239 CSS px
// (4-up on a 1024px grid) and the modal is 448 CSS px, so this still has
// headroom on a 2x display. Going to 1000px only doubled the bytes.
const MAX_EDGE = 700;
async function optimizeImage(buffer, originalname) {
  if (!sharp) return { buffer, ext: null };
  try {
    const img = sharp(buffer, { failOn: 'none' }).rotate(); // honour EXIF orientation
    const meta = await img.metadata();
    // Preserve transparency (logos/PNG cut-outs) — flattening them onto white
    // would wreck a transparent logo; those stay PNG, just resized.
    const keepPng = meta.hasAlpha === true;
    const pipeline = img.resize({
      width: MAX_EDGE,
      height: MAX_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    });
    const out = keepPng
      ? await pipeline.png({ compressionLevel: 9, palette: true }).toBuffer()
      : await pipeline.jpeg({ quality: 82, mozjpeg: true }).toBuffer();
    // A tiny already-optimised file can come out bigger — keep the smaller one.
    if (out.length >= buffer.length) return { buffer, ext: null };
    return { buffer: out, ext: keepPng ? '.png' : '.jpg' };
  } catch (err) {
    console.error('[upload] optimize skipped for', originalname, '-', err.message);
    return { buffer, ext: null };
  }
}

// Persist an uploaded file and return the URL stored in the DB.
// Prefers Cloudinary (folder "gardenmarket"); falls back to local /uploads on failure.
async function persistImage(file) {
  if (!file) return null;
  const { buffer, ext } = await optimizeImage(file.buffer, file.originalname);
  const baseName = file.originalname.replace(/\s/g, '_');
  // When re-encoded, swap the extension so the file name matches its bytes.
  const filename = ext ? baseName.replace(/\.[^.]+$/, '') + ext : baseName;

  if (cloudinary.isConfigured) {
    try {
      const publicId = filename.replace(/\.[^.]+$/, '') + '-' + Date.now();
      return await cloudinary.uploadImage(buffer, publicId);
    } catch (err) {
      console.error('Cloudinary upload failed, falling back to local disk:', err.message);
    }
  }
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  const stored = `${Date.now()}-${filename}`;
  fs.writeFileSync(path.join(uploadsDir, stored), buffer);
  return `/uploads/${stored}`;
}

// Is this image URL still used anywhere? A product's variant rows (`sizes`)
// can carry their own photo — e.g. one "Sunflower oil" product whose thyme /
// dill / rosemary variants each show their own bottle — so the same file can be
// referenced from several places. Call this AFTER the row change has been
// written, so it reflects the state the file would be orphaned in.
function isImageReferenced(image) {
  const db = getDB();
  const like = `%${JSON.stringify(image).slice(1, -1)}%`; // as it appears inside the sizes JSON
  return !!(
    db.prepare('SELECT 1 FROM dishes WHERE image = ? OR sizes LIKE ? LIMIT 1').get(image, like) ||
    db.prepare('SELECT 1 FROM promotions WHERE image = ? LIMIT 1').get(image) ||
    db.prepare('SELECT 1 FROM categories WHERE icon_url = ? LIMIT 1').get(image) ||
    db.prepare('SELECT 1 FROM settings WHERE value = ? LIMIT 1').get(image)
  );
}

// Remove a previously stored image (local /uploads file or Cloudinary asset) —
// unless another row still points at it.
function deleteUpload(image) {
  if (!image) return;
  if (isImageReferenced(image)) return;
  if (image.startsWith('/uploads/')) {
    fs.promises.unlink(path.join(__dirname, '..', image)).catch(() => {});
  } else if (image.includes('res.cloudinary.com')) {
    cloudinary.deleteImage(image).catch(() => {});
  }
}

router.use(adminAuth);

// Branding images (logo / hero) — upload a file, store its hosted URL in the
// matching settings key. Uses the same Cloudinary-or-local persistImage as the
// product photos. The plain PUT /api/settings is JSON-only, so image setting
// values need this multipart endpoint.
const SETTINGS_IMAGE_KEYS = new Set(['logo_image', 'hero_image']);
router.post('/settings-image', upload.single('image'), async (req, res) => {
  const key = SETTINGS_IMAGE_KEYS.has(req.body.key) ? req.body.key : 'logo_image';
  const url = await persistImage(req.file);
  if (!url) return res.status(400).json({ error: 'No file uploaded' });
  const db = getDB();
  const existing = db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value;
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, url);
  if (existing && existing !== url) deleteUpload(existing); // best-effort cleanup of the replaced image
  res.json({ key, value: url });
});

// Categories
router.get('/categories', (req, res) => {
  res.json(getDB().prepare('SELECT * FROM categories ORDER BY sort_order').all());
});
router.post('/categories', upload.single('iconFile'), async (req, res) => {
  const db = getDB();
  const { name, icon, icon_type, icon_key, sort_order } = req.body;
  const icon_url = req.file ? await persistImage(req.file) : (req.body.icon_url || null);
  const result = db.prepare("INSERT INTO categories (name, icon, icon_type, icon_key, icon_url, sort_order) VALUES (?, ?, ?, ?, ?, ?)")
    .run(name, icon || '🍽️', icon_type || 'svg', icon_key || null, icon_url, sort_order || 0);
  res.json({ id: result.lastInsertRowid });
});
router.put('/categories/:id', upload.single('iconFile'), async (req, res) => {
  const db = getDB();
  const { name, icon, icon_type, icon_key, sort_order, is_active } = req.body;
  const existing = db.prepare('SELECT icon_url FROM categories WHERE id=?').get(req.params.id);
  // icon_url resolution: new upload > explicit value (empty string = removed) > keep existing
  let icon_url;
  if (req.file) icon_url = await persistImage(req.file);
  else if (req.body.icon_url !== undefined) icon_url = req.body.icon_url || null;
  else icon_url = existing?.icon_url || null;
  db.prepare('UPDATE categories SET name=?, icon=?, icon_type=?, icon_key=?, icon_url=?, sort_order=?, is_active=? WHERE id=?')
    .run(name, icon, icon_type || 'svg', icon_key || null, icon_url, sort_order, is_active, req.params.id);
  // after the write, so the reference check doesn't see this row's old value
  if (existing?.icon_url && existing.icon_url !== icon_url) deleteUpload(existing.icon_url);
  res.json({ ok: true });
});
router.delete('/categories/:id', (req, res) => {
  const db = getDB();
  const existing = db.prepare('SELECT icon_url FROM categories WHERE id=?').get(req.params.id);
  db.prepare('DELETE FROM categories WHERE id=?').run(req.params.id);
  if (existing?.icon_url) deleteUpload(existing.icon_url);
  res.json({ ok: true });
});

// Products
// Multipart form fields arrive as strings, so normalize the numeric/enum ones
// before they hit SQLite — an empty stock field must store NULL ("untracked"),
// not 0 ("out of stock"), and an unknown unit must not silently persist.
function normalizeUnit(value) {
  return UNITS.includes(value) ? value : 'piece';
}
// `sizes` is a JSON array of variants. Each row is { label, price, image? }:
// `label` is either a plain string ("1 kq") or a per-language object
// ({ az: 'Kəklikotulu', en: 'Thyme', ... }) for named variants (flavours);
// `image` is an optional photo for that variant. Drop rows the storefront
// couldn't render and strip anything else so junk never reaches the DB.
function normalizeSizes(raw) {
  let arr;
  try { arr = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { arr = null; }
  if (!Array.isArray(arr)) return '[]';
  const out = [];
  for (const s of arr) {
    if (!s || typeof s !== 'object') continue;
    let label = s.label;
    if (typeof label === 'string') {
      label = label.trim();
    } else if (label && typeof label === 'object') {
      label = Object.fromEntries(
        Object.entries(label)
          .filter(([k, v]) => typeof v === 'string' && v.trim() && /^[a-z]{2}$/.test(k))
          .map(([k, v]) => [k, v.trim()]),
      );
      if (!Object.keys(label).length) label = '';
    } else {
      label = '';
    }
    const price = Number(s.price);
    if (!label || !Number.isFinite(price)) continue;
    const row = { label, price };
    if (typeof s.image === 'string' && s.image.trim()) row.image = s.image.trim();
    out.push(row);
  }
  return JSON.stringify(out);
}
function normalizeStock(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, n) : null;
}

router.get('/dishes', (req, res) => {
  const db     = getDB();
  const page   = Math.max(1, parseInt(req.query.page  || 1));
  const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit || 20)));
  const offset = (page - 1) * limit;
  const total  = db.prepare('SELECT COUNT(*) as n FROM dishes').get().n;
  const items  = db.prepare('SELECT * FROM dishes ORDER BY category_id, sort_order, id LIMIT ? OFFSET ?').all(limit, offset);
  res.json({ items, total, page, totalPages: Math.ceil(total / limit) || 1, limit });
});
router.post('/dishes', upload.single('image'), async (req, res) => {
  const db = getDB();
  const d = req.body;
  const image = await persistImage(req.file);
  const result = db.prepare(`
    INSERT INTO dishes (category_id, name, description, ingredients, price, old_price, unit, stock_qty, sku, weight, calories, protein, fat, carbs, allergens, sizes, image, is_available, is_featured, is_vegetarian, is_vegan, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(d.category_id, d.name, d.description || null, d.ingredients || null, d.price, d.old_price || null, normalizeUnit(d.unit), normalizeStock(d.stock_qty), d.sku || null, d.weight || null, d.calories || null, d.protein || null, d.fat || null, d.carbs || null, d.allergens || '[]', normalizeSizes(d.sizes), image, d.is_available ?? 1, d.is_featured ?? 0, d.is_vegetarian ?? 0, d.is_vegan ?? 0, d.sort_order ?? 0);
  res.json({ id: result.lastInsertRowid });
});
router.put('/dishes/:id', upload.single('image'), async (req, res) => {
  const db = getDB();
  const d = req.body;
  const existing = db.prepare('SELECT image FROM dishes WHERE id=?').get(req.params.id);
  // image resolution: new upload > explicit value (empty string = removed) > keep existing
  let image;
  if (req.file) image = await persistImage(req.file);
  else if (d.image !== undefined) image = d.image || null;
  else image = existing?.image || null;
  db.prepare(`
    UPDATE dishes SET category_id=?, name=?, description=?, ingredients=?, price=?, old_price=?, unit=?, stock_qty=?, sku=?, weight=?, calories=?, protein=?, fat=?, carbs=?, allergens=?, sizes=?, image=?, is_available=?, is_featured=?, is_vegetarian=?, is_vegan=?, sort_order=? WHERE id=?
  `).run(d.category_id, d.name, d.description || null, d.ingredients || null, d.price, d.old_price || null, normalizeUnit(d.unit), normalizeStock(d.stock_qty), d.sku || null, d.weight || null, d.calories || null, d.protein || null, d.fat || null, d.carbs || null, d.allergens || '[]', normalizeSizes(d.sizes), image, d.is_available ?? 1, d.is_featured ?? 0, d.is_vegetarian ?? 0, d.is_vegan ?? 0, d.sort_order ?? 0, req.params.id);
  // Delete the replaced/removed file only after the row is written: a variant
  // of this or another product may still use it (see isImageReferenced).
  if (existing?.image && existing.image !== image) deleteUpload(existing.image);
  res.json({ ok: true });
});
router.delete('/dishes/:id', (req, res) => {
  const db = getDB();
  const existing = db.prepare('SELECT image, sizes FROM dishes WHERE id=?').get(req.params.id);
  db.prepare('DELETE FROM dishes WHERE id=?').run(req.params.id);
  if (existing?.image) deleteUpload(existing.image);
  // Variant photos go with the product too (unless shared).
  try {
    for (const s of JSON.parse(existing?.sizes || '[]')) if (s?.image) deleteUpload(s.image);
  } catch { /* malformed sizes — nothing to clean */ }
  res.json({ ok: true });
});

// Promotions
router.get('/promotions', (req, res) => {
  res.json(getDB().prepare('SELECT * FROM promotions ORDER BY sort_order').all());
});
router.post('/promotions', upload.single('image'), async (req, res) => {
  const d = req.body;
  const image = await persistImage(req.file);
  const result = getDB().prepare(`INSERT INTO promotions (title, description, discount_percent, dish_ids, category_id, image, start_date, end_date, is_active, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(d.title, d.description || null, d.discount_percent || 0, d.dish_ids || '[]', d.category_id || null, image, d.start_date || null, d.end_date || null, d.is_active ?? 1, d.sort_order ?? 0);
  res.json({ id: result.lastInsertRowid });
});
router.put('/promotions/:id', upload.single('image'), async (req, res) => {
  const d = req.body;
  const image = req.file ? await persistImage(req.file) : (d.image || null);
  getDB().prepare(`UPDATE promotions SET title=?, description=?, discount_percent=?, dish_ids=?, category_id=?, image=?, start_date=?, end_date=?, is_active=?, sort_order=? WHERE id=?`).run(d.title, d.description || null, d.discount_percent || 0, d.dish_ids || '[]', d.category_id || null, image, d.start_date || null, d.end_date || null, d.is_active ?? 1, d.sort_order ?? 0, req.params.id);
  res.json({ ok: true });
});
router.delete('/promotions/:id', (req, res) => {
  getDB().prepare('DELETE FROM promotions WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// Orders. 'picking' = staff are gathering the items off the shelves.
const ORDER_STATUSES = ['new', 'picking', 'ready', 'done', 'cancelled'];

// Build a SQL WHERE clause (+ params) from optional status / date query filters.
// `date` is one of today | yesterday | month; created_at is stored as a UTC
// CURRENT_TIMESTAMP, so we compare against localtime for the store's day.
function orderFilters({ status, date }) {
  const where = [];
  const params = [];
  if (ORDER_STATUSES.includes(status)) { where.push('status = ?'); params.push(status); }
  if (date === 'today') {
    where.push("date(created_at, 'localtime') = date('now', 'localtime')");
  } else if (date === 'yesterday') {
    where.push("date(created_at, 'localtime') = date('now', 'localtime', '-1 day')");
  } else if (date === 'month') {
    where.push("strftime('%Y-%m', created_at, 'localtime') = strftime('%Y-%m', 'now', 'localtime')");
  }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

router.get('/orders', (req, res) => {
  const db = getDB();
  const page   = Math.max(1, parseInt(req.query.page  || 1));
  const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit || 20)));
  const offset = (page - 1) * limit;
  const { sql, params } = orderFilters(req.query);
  const total  = db.prepare(`SELECT COUNT(*) AS c FROM orders ${sql}`).get(...params).c;
  const items  = db.prepare(`SELECT * FROM orders ${sql} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
  res.json({ items, total, page, totalPages: Math.ceil(total / limit) || 1, limit });
});

// Lightweight dashboard stats for the orders tab. Respects the same `date`
// filter so the numbers track the period the admin is viewing (defaults today).
router.get('/orders/stats', (req, res) => {
  const db = getDB();
  const date = ['today', 'yesterday', 'month'].includes(req.query.date) ? req.query.date : 'today';
  const { sql, params } = orderFilters({ date });
  const row = db.prepare(
    `SELECT COUNT(*) AS count,
            COALESCE(SUM(CASE WHEN status = 'done' THEN total ELSE 0 END), 0) AS revenue,
            COALESCE(SUM(CASE WHEN status NOT IN ('done', 'cancelled') THEN total ELSE 0 END), 0) AS expectedRevenue,
            COALESCE(SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END), 0) AS newCount,
            COALESCE(SUM(CASE WHEN status = 'picking' THEN 1 ELSE 0 END), 0) AS pickingCount,
            COALESCE(SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END), 0) AS deliveredCount
     FROM orders ${sql}`
  ).get(...params);
  const currency = db.prepare(`SELECT currency FROM orders ${sql} ORDER BY created_at DESC LIMIT 1`).get(...params)?.currency || 'AZN';
  res.json({
    date,
    count: row.count,
    revenue: row.revenue,
    expectedRevenue: row.expectedRevenue,
    newCount: row.newCount,
    pickingCount: row.pickingCount,
    deliveredCount: row.deliveredCount,
    currency,
  });
});
router.put('/orders/:id/status', (req, res) => {
  if (!ORDER_STATUSES.includes(req.body.status)) {
    return res.status(400).json({ error: `status must be one of: ${ORDER_STATUSES.join(', ')}` });
  }
  getDB().prepare('UPDATE orders SET status=? WHERE id=?').run(req.body.status, req.params.id);
  res.json({ ok: true });
});
router.delete('/orders/:id', (req, res) => {
  getDB().prepare('DELETE FROM orders WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});
// Bulk delete: DELETE /api/admin/orders  { ids: [1,2,3] }. Distinct route from
// /orders/:id above (no id segment), so both coexist without conflict.
router.delete('/orders', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : [];
  if (!ids.length) return res.status(400).json({ error: 'No ids provided' });
  const placeholders = ids.map(() => '?').join(',');
  const result = getDB().prepare(`DELETE FROM orders WHERE id IN (${placeholders})`).run(...ids);
  res.json({ ok: true, deleted: result.changes });
});

// CSV export (opens in Excel). `report=orders` (one row per order) or
// `report=products` (what we sold: qty + revenue per product). Honors the same
// date/status filters as the orders list, plus `lang` (az|ru|en|tr, matching the
// admin panel's language switcher) for headers and status/fulfillment labels.
// A UTF-8 BOM keeps non-ASCII letters correct in Excel; items inside a cell are
// separated by " / " to avoid clashing with the comma delimiter.
const EXPORT_I18N = {
  az: {
    orderHeaders: ['№', 'Tarix', 'Növ', 'Ünvan / Telefon', 'Məhsullar', 'Cəmi', 'Valyuta', 'Status'],
    productHeaders: ['Məhsul', 'Say', 'Gəlir'],
    pickup: 'Özü götürür', delivery: 'Çatdırılma',
    status: { new: 'Yeni', picking: 'Yığılır', ready: 'Hazır', done: 'Verildi', cancelled: 'Ləğv edildi' },
    filenames: { orders: 'sifarisler', products: 'satilanlar' },
  },
  ru: {
    orderHeaders: ['№', 'Дата', 'Тип', 'Адрес / Телефон', 'Товары', 'Итого', 'Валюта', 'Статус'],
    productHeaders: ['Товар', 'Кол-во', 'Выручка'],
    pickup: 'Самовывоз', delivery: 'Доставка',
    status: { new: 'Новый', picking: 'Собирается', ready: 'Готов', done: 'Выдан', cancelled: 'Отменён' },
    filenames: { orders: 'zakazy', products: 'prodazhi' },
  },
  en: {
    orderHeaders: ['No', 'Date', 'Type', 'Address / Phone', 'Products', 'Total', 'Currency', 'Status'],
    productHeaders: ['Product', 'Qty', 'Revenue'],
    pickup: 'Pickup', delivery: 'Delivery',
    status: { new: 'New', picking: 'Picking', ready: 'Ready', done: 'Done', cancelled: 'Cancelled' },
    filenames: { orders: 'orders', products: 'sold-products' },
  },
  tr: {
    orderHeaders: ['No', 'Tarih', 'Tür', 'Adres / Telefon', 'Ürünler', 'Toplam', 'Para Birimi', 'Durum'],
    productHeaders: ['Ürün', 'Adet', 'Gelir'],
    pickup: 'Mağazadan alım', delivery: 'Teslimat',
    status: { new: 'Yeni', picking: 'Toplanıyor', ready: 'Hazır', done: 'Teslim edildi', cancelled: 'İptal edildi' },
    filenames: { orders: 'siparisler', products: 'satislar' },
  },
};
function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function toCsv(header, rows) {
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}
router.get('/orders/export', (req, res) => {
  const db = getDB();
  const { sql, params } = orderFilters(req.query);
  const orders = db.prepare(`SELECT * FROM orders ${sql} ORDER BY created_at DESC`).all(...params);
  const parseItems = (o) => { try { return JSON.parse(o.items) || []; } catch { return []; } };
  const L = EXPORT_I18N[req.query.lang] || EXPORT_I18N.az;

  let filename, csv;
  if (req.query.report === 'products') {
    const agg = new Map(); // key -> { name, qty, revenue }
    for (const o of orders) {
      for (const it of parseItems(o)) {
        const key = it.id != null ? `id:${it.id}` : `n:${it.name}`;
        const cur = agg.get(key) || { name: it.name || '?', qty: 0, revenue: 0 };
        const q = Number(it.qty) || 0;
        cur.qty += q;
        cur.revenue += q * (Number(it.price) || 0);
        agg.set(key, cur);
      }
    }
    const rows = [...agg.values()].sort((a, b) => b.revenue - a.revenue)
      .map((r) => [r.name, r.qty, r.revenue.toFixed(2)]);
    csv = toCsv(L.productHeaders, rows);
    filename = L.filenames.products;
  } else {
    const rows = orders.map((o) => {
      const items = parseItems(o).map((it) => `${it.name}${it.size ? ` (${it.size})` : ''} ×${it.qty}`).join(' / ');
      const typeLabel = o.fulfillment_type === 'delivery' ? L.delivery : L.pickup;
      const contact = o.fulfillment_type === 'delivery' ? (o.delivery_address || '') : '';
      const statusLabel = L.status[o.status] || o.status;
      return [o.id, (o.created_at || '').replace('T', ' ').slice(0, 16), typeLabel,
        [contact, o.customer_phone].filter(Boolean).join(' '), items, o.total, o.currency, statusLabel];
    });
    csv = toCsv(L.orderHeaders, rows);
    filename = L.filenames.orders;
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
  res.send('﻿' + csv); // BOM so Excel reads UTF-8
});

module.exports = router;
