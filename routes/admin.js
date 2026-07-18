const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { getDB, UNITS } = require('../db/database');
const { adminAuth } = require('../middleware/auth');
const cloudinary = require('../cloudinary');
const router = express.Router();

// Buffer uploads in memory so we can push them straight to Cloudinary; if
// Cloudinary isn't configured (or fails) we fall back to writing /uploads.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const uploadsDir = path.join(__dirname, '../uploads');

// Persist an uploaded file and return the URL stored in the DB.
// Prefers Cloudinary (folder "gardenmarket"); falls back to local /uploads on failure.
async function persistImage(file) {
  if (!file) return null;
  if (cloudinary.isConfigured) {
    try {
      const publicId = file.originalname.replace(/\.[^.]+$/, '').replace(/\s/g, '_') + '-' + Date.now();
      return await cloudinary.uploadImage(file.buffer, publicId);
    } catch (err) {
      console.error('Cloudinary upload failed, falling back to local disk:', err.message);
    }
  }
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  const filename = `${Date.now()}-${file.originalname.replace(/\s/g, '_')}`;
  fs.writeFileSync(path.join(uploadsDir, filename), file.buffer);
  return `/uploads/${filename}`;
}

// Remove a previously stored image (local /uploads file or Cloudinary asset).
function deleteUpload(image) {
  if (!image) return;
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
  if (existing?.icon_url && existing.icon_url !== icon_url) deleteUpload(existing.icon_url);
  db.prepare('UPDATE categories SET name=?, icon=?, icon_type=?, icon_key=?, icon_url=?, sort_order=?, is_active=? WHERE id=?')
    .run(name, icon, icon_type || 'svg', icon_key || null, icon_url, sort_order, is_active, req.params.id);
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
  `).run(d.category_id, d.name, d.description || null, d.ingredients || null, d.price, d.old_price || null, normalizeUnit(d.unit), normalizeStock(d.stock_qty), d.sku || null, d.weight || null, d.calories || null, d.protein || null, d.fat || null, d.carbs || null, d.allergens || '[]', d.sizes || '[]', image, d.is_available ?? 1, d.is_featured ?? 0, d.is_vegetarian ?? 0, d.is_vegan ?? 0, d.sort_order ?? 0);
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
  // delete the old file when it is being replaced or removed
  if (existing?.image && existing.image !== image) deleteUpload(existing.image);
  db.prepare(`
    UPDATE dishes SET category_id=?, name=?, description=?, ingredients=?, price=?, old_price=?, unit=?, stock_qty=?, sku=?, weight=?, calories=?, protein=?, fat=?, carbs=?, allergens=?, sizes=?, image=?, is_available=?, is_featured=?, is_vegetarian=?, is_vegan=?, sort_order=? WHERE id=?
  `).run(d.category_id, d.name, d.description || null, d.ingredients || null, d.price, d.old_price || null, normalizeUnit(d.unit), normalizeStock(d.stock_qty), d.sku || null, d.weight || null, d.calories || null, d.protein || null, d.fat || null, d.carbs || null, d.allergens || '[]', d.sizes || '[]', image, d.is_available ?? 1, d.is_featured ?? 0, d.is_vegetarian ?? 0, d.is_vegan ?? 0, d.sort_order ?? 0, req.params.id);
  res.json({ ok: true });
});
router.delete('/dishes/:id', (req, res) => {
  const db = getDB();
  const existing = db.prepare('SELECT image FROM dishes WHERE id=?').get(req.params.id);
  db.prepare('DELETE FROM dishes WHERE id=?').run(req.params.id);
  if (existing?.image) deleteUpload(existing.image);
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

// CSV export (opens in Excel). `report=orders` (one row per order) or
// `report=products` (what we sold: qty + revenue per product). Honors the same
// date/status filters as the orders list. A UTF-8 BOM keeps Azerbaijani letters
// correct in Excel; items inside a cell are separated by " / " to avoid clashing
// with the comma delimiter.
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
    csv = toCsv(['Məhsul', 'Say', 'Gəlir'], rows);
    filename = 'satilanlar';
  } else {
    const rows = orders.map((o) => {
      const items = parseItems(o).map((it) => `${it.name}${it.size ? ` (${it.size})` : ''} ×${it.qty}`).join(' / ');
      const contact = o.fulfillment_type === 'delivery' ? (o.delivery_address || '') : 'Götürmə';
      return [o.id, (o.created_at || '').replace('T', ' ').slice(0, 16), o.fulfillment_type,
        [contact, o.customer_phone].filter(Boolean).join(' '), items, o.total, o.currency, o.status];
    });
    csv = toCsv(['№', 'Tarix', 'Növ', 'Ünvan / Telefon', 'Məhsullar', 'Cəmi', 'Valyuta', 'Status'], rows);
    filename = 'sifarisler';
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
  res.send('﻿' + csv); // BOM so Excel reads UTF-8
});

module.exports = router;
