const express = require('express');
const router = express.Router();
const db = require('../database');

// Claim a cashier name — allows 1 user to claim multiple cashier names
router.post('/claim', (req, res) => {
  const { telegram_id, cashier_name, telegram_username } = req.body;
  if (!telegram_id || !cashier_name) {
    return res.status(400).json({ error: 'telegram_id and cashier_name are required' });
  }

  const tid = String(telegram_id);
  const name = cashier_name.trim();

  const claim = db.transaction(() => {
    const cashier = db.prepare('SELECT * FROM cashier_users WHERE cashier_name = ?').get(name);
    if (!cashier) return { status: 404, error: 'invalid_name', message: `*${name}* is not a valid cashier name.` };

    // If already owned by THIS user
    if (cashier.is_taken === 1 && cashier.telegram_id === tid) {
      return { status: 200, success: true, cashier, already_owned: true };
    }

    // If taken by someone else
    if (cashier.is_taken === 1 || (cashier.telegram_id !== null && cashier.telegram_id !== tid)) {
      return { status: 409, error: 'cashier_taken', message: `The cashier name *${name}* is already taken by another user.` };
    }

    db.prepare(`
      UPDATE cashier_users SET telegram_id = ?, telegram_username = ?, is_taken = 1, registered_at = CURRENT_TIMESTAMP
      WHERE cashier_name = ? AND is_taken = 0
    `).run(tid, telegram_username || null, name);

    const claimed = db.prepare('SELECT * FROM cashier_users WHERE cashier_name = ? AND telegram_id = ?').get(name, tid);
    if (!claimed) return { status: 409, error: 'cashier_taken', message: `The cashier name *${name}* was just taken. Please try a different name.` };

    return { status: 200, success: true, cashier: claimed };
  });

  try {
    const result = claim();
    return res.status(result.status).json(result);
  } catch (err) {
    console.error('Claim error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Get available (unclaimed) cashiers
router.get('/available', (req, res) => {
  const available = db.prepare('SELECT cashier_name FROM cashier_users WHERE is_taken = 0 ORDER BY id ASC').all();
  res.json({ success: true, cashiers: available });
});

// Save a payment method for a cashier
router.post('/payment-method', (req, res) => {
  const { telegram_id, cashier_name, method, full_name, account_number } = req.body;
  if (!telegram_id || !method || !full_name || !account_number) {
    return res.status(400).json({ error: 'telegram_id, method, full_name and account_number are required' });
  }

  try {
    db.prepare(`
      INSERT INTO payment_methods (telegram_id, cashier_name, method, full_name, account_number)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(telegram_id, method) DO UPDATE SET full_name = excluded.full_name, account_number = excluded.account_number, cashier_name = excluded.cashier_name
    `).run(String(telegram_id), cashier_name || '', method, full_name, account_number);

    return res.json({ success: true });
  } catch (err) {
    console.error('Payment method error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all payment methods for a telegram user
router.get('/payment-methods/:telegram_id', (req, res) => {
  const methods = db.prepare('SELECT * FROM payment_methods WHERE telegram_id = ? ORDER BY id ASC').all(String(req.params.telegram_id));
  res.json({ success: true, methods });
});

// Get cashiers by telegram_id (supports multiple cashiers)
router.get('/by-telegram/:telegram_id', (req, res) => {
  const cashiers = db.prepare('SELECT * FROM cashier_users WHERE telegram_id = ? ORDER BY id ASC').all(String(req.params.telegram_id));
  if (!cashiers || cashiers.length === 0) return res.status(404).json({ error: 'No cashier linked to this Telegram account.' });
  res.json({ success: true, cashiers, cashier: cashiers[0] });
});

// Get all cashier users
router.get('/', (req, res) => {
  const cashiers = db.prepare('SELECT * FROM cashier_users ORDER BY id ASC').all();
  res.json({ success: true, cashiers });
});

// Reset a cashier (unlink telegram from cashier slot)
router.delete('/reset/:cashier_name', (req, res) => {
  const cashier = db.prepare('SELECT * FROM cashier_users WHERE cashier_name = ?').get(req.params.cashier_name);
  if (!cashier) return res.status(404).json({ error: 'Cashier not found' });

  const tid = cashier.telegram_id;

  db.prepare(`
    UPDATE cashier_users SET telegram_id = NULL, telegram_username = NULL, is_taken = 0, registered_at = NULL
    WHERE cashier_name = ?
  `).run(req.params.cashier_name);

  // Also remove their payment methods
  if (tid) db.prepare('DELETE FROM payment_methods WHERE telegram_id = ?').run(tid);

  res.json({ success: true, message: `Cashier ${req.params.cashier_name} has been reset.` });
});

module.exports = router;
