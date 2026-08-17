const express = require('express');
const router = express.Router();
const db = require('../database');

// ─── Get all config ───────────────────────────────────────────────────────────
router.get('/config', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM admin_config').all();
  const config = {};
  for (const r of rows) config[r.key] = r.value;
  res.json({ success: true, config });
});

// ─── Set a config value ───────────────────────────────────────────────────────
router.post('/config', (req, res) => {
  const { key, value } = req.body;
  if (!key) return res.status(400).json({ error: 'key is required' });
  db.prepare('INSERT INTO admin_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value || '');
  res.json({ success: true });
});

// ─── Get cashier limits ───────────────────────────────────────────────────────
router.get('/limits', (req, res) => {
  const rows = db.prepare('SELECT * FROM cashier_limits').all();
  res.json({ success: true, limits: rows });
});

router.get('/limits/:cashier_name', (req, res) => {
  const row = db.prepare('SELECT * FROM cashier_limits WHERE cashier_name = ?').get(req.params.cashier_name);
  res.json({ success: true, limit: row || null });
});

// ─── Set cashier limit ────────────────────────────────────────────────────────
router.post('/limits', (req, res) => {
  const { cashier_name, min_amount, max_amount, limit_type } = req.body;
  if (!cashier_name) return res.status(400).json({ error: 'cashier_name is required' });
  db.prepare(`
    INSERT INTO cashier_limits (cashier_name, min_amount, max_amount, limit_type)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(cashier_name) DO UPDATE SET
      min_amount = excluded.min_amount,
      max_amount = excluded.max_amount,
      limit_type = excluded.limit_type
  `).run(cashier_name, min_amount || null, max_amount || null, limit_type || 'both');
  res.json({ success: true });
});

// ─── Delete cashier limit ─────────────────────────────────────────────────────
router.delete('/limits/:cashier_name', (req, res) => {
  db.prepare('DELETE FROM cashier_limits WHERE cashier_name = ?').run(req.params.cashier_name);
  res.json({ success: true });
});

module.exports = router;
