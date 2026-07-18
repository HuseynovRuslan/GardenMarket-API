const express = require('express');
const { getDB } = require('../db/database');
const router = express.Router();

router.get('/categories', (req, res) => {
  const db = getDB();
  const cats = db.prepare('SELECT * FROM categories WHERE is_active = 1 ORDER BY sort_order').all();
  res.json(cats);
});

router.get('/dishes', (req, res) => {
  const db = getDB();
  const { category_id, featured, search } = req.query;
  const page  = Math.max(1, parseInt(req.query.page  || 1));
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || 12)));
  const offset = (page - 1) * limit;

  let where = 'is_available = 1';
  const params = [];

  if (category_id) { where += ' AND category_id = ?'; params.push(category_id); }
  if (featured === '1') { where += ' AND is_featured = 1'; }
  if (search) {
    where += ' AND (name LIKE ? OR description LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }

  const total = db.prepare(`SELECT COUNT(*) AS c FROM dishes WHERE ${where}`).get(...params).c;
  const items = db.prepare(`SELECT * FROM dishes WHERE ${where} ORDER BY is_featured DESC, sort_order, id LIMIT ? OFFSET ?`).all(...params, limit, offset);

  res.json({ items, total, page, totalPages: Math.ceil(total / limit) || 1, limit });
});

router.get('/dishes/:id', (req, res) => {
  const db = getDB();
  const dish = db.prepare('SELECT * FROM dishes WHERE id = ?').get(req.params.id);
  if (!dish) return res.status(404).json({ error: 'Not found' });
  res.json(dish);
});

router.get('/promotions', (req, res) => {
  const db = getDB();
  const now = new Date().toISOString().split('T')[0];
  const promos = db.prepare(`
    SELECT * FROM promotions
    WHERE is_active = 1
      AND (start_date IS NULL OR start_date <= ?)
      AND (end_date IS NULL OR end_date >= ?)
    ORDER BY sort_order
  `).all(now, now);
  res.json(promos);
});

module.exports = router;
