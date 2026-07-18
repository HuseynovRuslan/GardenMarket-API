const { getDB } = require('../db/database');

function adminAuth(req, res, next) {
  const password = req.headers['x-admin-password'] || req.body?.password;
  const db = getDB();
  const setting = db.prepare('SELECT value FROM settings WHERE key = ?').get('admin_password');
  if (setting && password === setting.value) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

module.exports = { adminAuth };
