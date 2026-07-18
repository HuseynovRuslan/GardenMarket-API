const express = require('express');
const { getDB } = require('../db/database');
const router = express.Router();

const FULFILLMENT_TYPES = ['pickup', 'delivery'];

router.post('/', (req, res) => {
  const { items, total, currency, fulfillment_type, delivery_address, customer_phone, notes } = req.body;
  if (!items || !items.length) return res.status(400).json({ error: 'No items' });

  const fulfillment = FULFILLMENT_TYPES.includes(fulfillment_type) ? fulfillment_type : 'pickup';
  const address = fulfillment === 'delivery' ? (delivery_address || '').trim() : '';
  if (fulfillment === 'delivery' && !address) {
    return res.status(400).json({ error: 'Delivery address is required for delivery orders' });
  }

  const db = getDB();
  const result = db.prepare('INSERT INTO orders (items, total, currency, fulfillment_type, delivery_address, customer_phone, notes) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(JSON.stringify(items), total, currency || 'AZN', fulfillment, address || null, customer_phone || null, notes || null);

  const { broadcast } = require('../index');
  broadcast({
    type: 'new_order',
    order: {
      id: result.lastInsertRowid,
      items,
      total,
      currency: currency || 'AZN',
      fulfillment_type: fulfillment,
      delivery_address: address || null,
      customer_phone: customer_phone || null,
      notes: notes || null,
      created_at: new Date().toISOString(),
    },
  });

  res.json({ id: result.lastInsertRowid });
});

module.exports = router;
