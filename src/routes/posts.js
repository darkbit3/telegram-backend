const express = require('express');
const router = express.Router();
const db = require('../database');

// ─── Create a post ────────────────────────────────────────────────────────────
router.post('/', (req, res) => {
  const { amount, full_name, account_cbe, account_telebirr } = req.body;
  if (!amount || !full_name) return res.status(400).json({ error: 'amount and full_name required' });
  const result = db.prepare(`
    INSERT INTO posts (amount, remaining, full_name, account_cbe, account_telebirr)
    VALUES (?, ?, ?, ?, ?)
  `).run(amount, amount, full_name, account_cbe || null, account_telebirr || null);
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ success: true, post });
});

// ─── Get all active posts ─────────────────────────────────────────────────────
router.get('/active', (req, res) => {
  const posts = db.prepare(`SELECT * FROM posts WHERE status = 'active' ORDER BY id DESC`).all();
  const result = posts.map(p => ({
    ...p,
    takers: db.prepare(`SELECT * FROM post_takers WHERE post_id = ? ORDER BY id ASC`).all(p.id)
  }));
  res.json({ success: true, posts: result });
});

// ─── Get a single post with takers ───────────────────────────────────────────
router.get('/:id', (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  const takers = db.prepare('SELECT * FROM post_takers WHERE post_id = ? ORDER BY id ASC').all(post.id);
  res.json({ success: true, post: { ...post, takers } });
});

// ─── Update group_msg_id ──────────────────────────────────────────────────────
router.patch('/:id/group-msg', (req, res) => {
  db.prepare('UPDATE posts SET group_msg_id = ? WHERE id = ?').run(String(req.body.group_msg_id), req.params.id);
  res.json({ success: true });
});

// ─── Lock / unlock a post ─────────────────────────────────────────────────────
router.patch('/:id/lock', (req, res) => {
  db.prepare('UPDATE posts SET locked = ? WHERE id = ?').run(req.body.locked ? 1 : 0, req.params.id);
  res.json({ success: true });
});

// ─── Update remaining ─────────────────────────────────────────────────────────
router.patch('/:id/remaining', (req, res) => {
  db.prepare('UPDATE posts SET remaining = ?, locked = 0 WHERE id = ?').run(req.body.remaining, req.params.id);
  res.json({ success: true });
});

// ─── Cancel / complete a post ─────────────────────────────────────────────────
router.patch('/:id/status', (req, res) => {
  const { status } = req.body; // 'active' | 'cancelled' | 'done'
  db.prepare('UPDATE posts SET status = ?, remaining = CASE WHEN ? != \'active\' THEN 0 ELSE remaining END WHERE id = ?')
    .run(status, status, req.params.id);
  res.json({ success: true });
});

// ─── Add a taker ─────────────────────────────────────────────────────────────
router.post('/:id/takers', (req, res) => {
  const { user_id, username, amount, txn_id } = req.body;
  if (!user_id || !amount) return res.status(400).json({ error: 'user_id and amount required' });
  const result = db.prepare(`
    INSERT INTO post_takers (post_id, user_id, username, amount, txn_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(req.params.id, String(user_id), username || null, amount, txn_id || null);
  const taker = db.prepare('SELECT * FROM post_takers WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ success: true, taker });
});

// ─── Update taker txn_id and status ──────────────────────────────────────────
router.patch('/takers/:taker_id', (req, res) => {
  const { txn_id, status } = req.body;
  if (txn_id !== undefined) db.prepare('UPDATE post_takers SET txn_id = ? WHERE id = ?').run(txn_id, req.params.taker_id);
  if (status !== undefined) db.prepare('UPDATE post_takers SET status = ? WHERE id = ?').run(status, req.params.taker_id);
  res.json({ success: true });
});

module.exports = router;
