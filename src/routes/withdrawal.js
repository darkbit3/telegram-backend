const express = require('express');
const router = express.Router();
const db = require('../database');

// ─── Amount validation ────────────────────────────────────────────────────────
const AMOUNT_MIN = 5000;
const AMOUNT_MAX = 100000;
const AMOUNT_STEP = 5000;

function isValidAmount(n) {
  return !isNaN(n) && n >= AMOUNT_MIN && n <= AMOUNT_MAX && n % AMOUNT_STEP === 0;
}

// ─── IMPORTANT: specific routes MUST come before /:id ─────────────────────────

// Get pending/active withdrawals
router.get('/list/pending', (req, res) => {
  const withdrawals = db.prepare(`
    SELECT * FROM withdrawals WHERE status NOT IN ('done','rejected') ORDER BY created_at DESC
  `).all();
  res.json({ success: true, withdrawals });
});

// Get transaction-submitted withdrawals
router.get('/list/transactions', (req, res) => {
  const withdrawals = db.prepare(`
    SELECT * FROM withdrawals WHERE status = 'transaction_submitted' ORDER BY created_at DESC
  `).all();
  res.json({ success: true, withdrawals });
});

// Get all withdrawals (admin)
router.get('/list/all', (req, res) => {
  const withdrawals = db.prepare('SELECT * FROM withdrawals ORDER BY created_at DESC').all();
  res.json({ success: true, withdrawals });
});

// ─── Create a new withdrawal request ─────────────────────────────────────────
router.post('/', (req, res) => {
  const { telegram_id, cashier_name, amount } = req.body;

  if (!telegram_id || !cashier_name || !amount) {
    return res.status(400).json({ error: 'telegram_id, cashier_name and amount are required' });
  }

  const n = Number(amount);
  if (!isValidAmount(n)) {
    return res.status(400).json({
      error: 'invalid_amount',
      message: `Amount must be between ${AMOUNT_MIN.toLocaleString()} and ${AMOUNT_MAX.toLocaleString()} ETB, in multiples of ${AMOUNT_STEP.toLocaleString()} ETB.`
    });
  }

  // One pending withdrawal allowed per cashier (not per telegram_id globally)
  const pending = db.prepare(`
    SELECT * FROM withdrawals WHERE telegram_id = ? AND cashier_name = ? AND status NOT IN ('done','rejected')
  `).get(String(telegram_id), cashier_name);

  if (pending) {
    return res.status(409).json({ error: 'pending_exists', withdrawal_id: pending.id, cashier_name, message: `*${cashier_name}* already has a pending withdrawal request.` });
  }

  const result = db.prepare(`
    INSERT INTO withdrawals (telegram_id, cashier_name, amount, status)
    VALUES (?, ?, ?, 'pending')
  `).run(String(telegram_id), cashier_name, n);

  const withdrawal = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(result.lastInsertRowid);
  return res.status(201).json({ success: true, withdrawal });
});

// ─── Save admin message ID ────────────────────────────────────────────────────
router.patch('/:id/admin-message', (req, res) => {
  const { admin_message_id } = req.body;
  db.prepare('UPDATE withdrawals SET admin_message_id = ? WHERE id = ?')
    .run(String(admin_message_id), req.params.id);
  res.json({ success: true });
});

// ─── Save group message ID ────────────────────────────────────────────────────
router.patch('/:id/group-message', (req, res) => {
  const { group_message_id } = req.body;
  db.prepare('UPDATE withdrawals SET group_message_id = ? WHERE id = ?')
    .run(String(group_message_id), req.params.id);
  res.json({ success: true });
});

// ─── Accept: lock to first acceptor ──────────────────────────────────────────
router.patch('/:id/accept', (req, res) => {
  const { acceptor_telegram_id, acceptor_username, accepted_amount } = req.body;

  if (!accepted_amount || isNaN(accepted_amount) || Number(accepted_amount) <= 0) {
    return res.status(400).json({ error: 'accepted_amount must be a positive number' });
  }

  const withdrawal = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(req.params.id);
  if (!withdrawal) return res.status(404).json({ error: 'Withdrawal not found' });
  if (withdrawal.acceptor_telegram_id) {
    return res.status(409).json({ error: 'already_accepted', message: 'Already accepted by another user.' });
  }

  const remaining = withdrawal.amount - (withdrawal.fulfilled_amount || 0);
  const acceptAmt = Math.min(Number(accepted_amount), remaining);

  db.prepare(`
    UPDATE withdrawals
    SET acceptor_telegram_id = ?, acceptor_username = ?, accepted_amount = ?, status = 'accepted'
    WHERE id = ? AND acceptor_telegram_id IS NULL
  `).run(String(acceptor_telegram_id), acceptor_username || null, acceptAmt, req.params.id);

  const updated = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(req.params.id);

  // Race condition guard — verify this person actually won the lock
  if (updated.acceptor_telegram_id !== String(acceptor_telegram_id)) {
    return res.status(409).json({ error: 'already_accepted', message: 'Already accepted by another user.' });
  }

  return res.json({ success: true, withdrawal: updated });
});

// ─── Save transaction ID ──────────────────────────────────────────────────────
router.patch('/:id/transaction', (req, res) => {
  const { transaction_id } = req.body;
  if (!transaction_id) return res.status(400).json({ error: 'transaction_id is required' });

  db.prepare('UPDATE withdrawals SET transaction_id = ?, status = ? WHERE id = ?')
    .run(String(transaction_id).trim(), 'transaction_submitted', req.params.id);

  const updated = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(req.params.id);
  res.json({ success: true, withdrawal: updated });
});

// ─── Resolve ──────────────────────────────────────────────────────────────────
router.patch('/:id/resolve', (req, res) => {
  const { status } = req.body;
  const validStatuses = ['accepted', 'rejected', 'done'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${validStatuses.join(', ')}` });
  }

  const withdrawal = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(req.params.id);
  if (!withdrawal) return res.status(404).json({ error: 'Withdrawal not found' });
  if (withdrawal.status === 'done' || withdrawal.status === 'rejected') {
    return res.status(409).json({ error: 'Withdrawal already resolved' });
  }

  if (status === 'done') {
    const newFulfilled = (withdrawal.fulfilled_amount || 0) + (withdrawal.accepted_amount || 0);
    const remaining = withdrawal.amount - newFulfilled;

    if (remaining <= 0) {
      db.prepare(`
        UPDATE withdrawals SET status = 'done', fulfilled_amount = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ?
      `).run(newFulfilled, req.params.id);
    } else {
      // Partially paid — reset acceptor fields for next round
      db.prepare(`
        UPDATE withdrawals
        SET status = 'partial', fulfilled_amount = ?,
            acceptor_telegram_id = NULL, acceptor_username = NULL,
            accepted_amount = 0, transaction_id = NULL
        WHERE id = ?
      `).run(newFulfilled, req.params.id);
    }

    const updated = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(req.params.id);
    return res.json({ success: true, withdrawal: updated, remaining: Math.max(0, remaining) });
  }

  db.prepare(`UPDATE withdrawals SET status = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(status, req.params.id);

  const updated = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(req.params.id);
  return res.json({ success: true, withdrawal: updated, remaining: 0 });
});

// ─── Reset withdrawal for repost (clear acceptor, back to pending/partial) ────
router.patch('/:id/reset-acceptor', (req, res) => {
  const { telegram_id } = req.body;
  const withdrawal = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(req.params.id);
  if (!withdrawal) return res.status(404).json({ error: 'Withdrawal not found' });
  if (withdrawal.telegram_id !== String(telegram_id)) return res.status(403).json({ error: 'Not your withdrawal' });
  if (withdrawal.status === 'done' || withdrawal.status === 'rejected') {
    return res.status(409).json({ error: 'Withdrawal already resolved' });
  }

  // Reset back to pending (or partial if partial payment already done)
  const newStatus = (withdrawal.fulfilled_amount || 0) > 0 ? 'partial' : 'pending';
  db.prepare(`
    UPDATE withdrawals
    SET status = ?, acceptor_telegram_id = NULL, acceptor_username = NULL,
        accepted_amount = 0, transaction_id = NULL
    WHERE id = ?
  `).run(newStatus, req.params.id);

  const updated = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(req.params.id);
  res.json({ success: true, withdrawal: updated });
});

// ─── Cancel by withdrawal user (only when pending) ───────────────────────────
router.patch('/:id/cancel', (req, res) => {
  const { telegram_id } = req.body;
  const withdrawal = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(req.params.id);
  if (!withdrawal) return res.status(404).json({ error: 'Withdrawal not found' });
  if (withdrawal.telegram_id !== String(telegram_id)) return res.status(403).json({ error: 'Not your withdrawal' });

  // Allow cancel when pending OR partial with no active acceptor
  const isCancellable =
    withdrawal.status === 'pending' ||
    (withdrawal.status === 'partial' && !withdrawal.acceptor_telegram_id);

  if (!isCancellable) {
    return res.status(409).json({ error: 'Cannot cancel — withdrawal is already being processed.' });
  }
  db.prepare(`UPDATE withdrawals SET status = 'rejected', resolved_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(req.params.id);
  res.json({ success: true, message: 'Withdrawal cancelled.' });
});

// ─── Cancel acceptance (by the acceptor) ─────────────────────────────────────
router.patch('/:id/cancel-accept', (req, res) => {
  const { telegram_id } = req.body;
  const withdrawal = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(req.params.id);
  if (!withdrawal) return res.status(404).json({ error: 'Withdrawal not found' });
  if (withdrawal.acceptor_telegram_id !== String(telegram_id)) return res.status(403).json({ error: 'You did not accept this withdrawal' });
  if (withdrawal.status !== 'accepted') {
    return res.status(409).json({ error: 'Cannot cancel — status is not accepted.' });
  }

  // Fix: also reset accepted_amount to 0
  db.prepare(`
    UPDATE withdrawals
    SET status = 'pending', acceptor_telegram_id = NULL, acceptor_username = NULL, accepted_amount = 0
    WHERE id = ?
  `).run(req.params.id);

  res.json({ success: true, message: 'Acceptance cancelled. Withdrawal is back to pending.' });
});

// ─── Get by ID (must come AFTER all specific routes) ─────────────────────────
router.get('/:id', (req, res) => {
  const withdrawal = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(req.params.id);
  if (!withdrawal) return res.status(404).json({ error: 'Withdrawal not found' });
  res.json({ success: true, withdrawal });
});

module.exports = router;
