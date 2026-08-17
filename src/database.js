const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const DB_PATH = path.join(dataDir, 'miki.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');

// Cashier users table
db.exec(`
  CREATE TABLE IF NOT EXISTS cashier_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cashier_name TEXT UNIQUE NOT NULL,
    telegram_id TEXT,
    telegram_username TEXT,
    is_taken INTEGER DEFAULT 0,
    registered_at DATETIME
  );
`);

// Check if cashier_users has UNIQUE on telegram_id, migrate if so
const cashierUserSql = db.prepare(`SELECT sql FROM sqlite_master WHERE name = 'cashier_users'`).get()?.sql || '';
if (cashierUserSql.includes('telegram_id TEXT UNIQUE')) {
  console.log('🔄 Migrating cashier_users to allow multiple cashiers per telegram user...');
  db.transaction(() => {
    db.exec(`
      CREATE TABLE cashier_users_temp (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cashier_name TEXT UNIQUE NOT NULL,
        telegram_id TEXT,
        telegram_username TEXT,
        is_taken INTEGER DEFAULT 0,
        registered_at DATETIME
      );
      INSERT INTO cashier_users_temp (id, cashier_name, telegram_id, telegram_username, is_taken, registered_at)
      SELECT id, cashier_name, telegram_id, telegram_username, is_taken, registered_at FROM cashier_users;
      DROP TABLE cashier_users;
      ALTER TABLE cashier_users_temp RENAME TO cashier_users;
    `);
  })();
  console.log('✅ cashier_users migrated successfully!');
}

// Payment methods table
db.exec(`
  CREATE TABLE IF NOT EXISTS payment_methods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT NOT NULL,
    cashier_name TEXT NOT NULL,
    method TEXT NOT NULL,
    full_name TEXT,
    account_number TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(telegram_id, method)
  );
`);

// Withdrawals table
db.exec(`
  CREATE TABLE IF NOT EXISTS withdrawals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT NOT NULL,
    cashier_name TEXT NOT NULL,
    amount REAL NOT NULL,
    status TEXT DEFAULT 'pending',
    admin_message_id TEXT,
    group_message_id TEXT,
    acceptor_telegram_id TEXT,
    acceptor_username TEXT,
    transaction_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    resolved_at DATETIME
  );
`);

// Migrate existing withdrawals table — add missing columns if they don't exist
const existingCols = db.prepare(`PRAGMA table_info(withdrawals)`).all().map(c => c.name);
const colsToAdd = [
  { name: 'group_message_id',      def: 'TEXT' },
  { name: 'acceptor_telegram_id',  def: 'TEXT' },
  { name: 'acceptor_username',     def: 'TEXT' },
  { name: 'transaction_id',        def: 'TEXT' },
  { name: 'fulfilled_amount',      def: 'REAL DEFAULT 0' },
  { name: 'accepted_amount',       def: 'REAL DEFAULT 0' },
];
for (const col of colsToAdd) {
  if (!existingCols.includes(col.name)) {
    db.exec(`ALTER TABLE withdrawals ADD COLUMN ${col.name} ${col.def}`);
    console.log(`✅ Migrated: added column ${col.name} to withdrawals`);
  }
}

// Admin config table (contact info, admin accounts)
db.exec(`
  CREATE TABLE IF NOT EXISTS admin_config (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

// Per-cashier limits table
db.exec(`
  CREATE TABLE IF NOT EXISTS cashier_limits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cashier_name TEXT UNIQUE NOT NULL,
    min_amount REAL,
    max_amount REAL,
    limit_type TEXT DEFAULT 'both'
  );
`);

// Posts table (admin withdrawal posts)
db.exec(`
  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    amount REAL NOT NULL,
    remaining REAL NOT NULL,
    full_name TEXT NOT NULL,
    account_cbe TEXT,
    account_telebirr TEXT,
    group_msg_id TEXT,
    locked INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Post takers table (transactions per post)
db.exec(`
  CREATE TABLE IF NOT EXISTS post_takers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    username TEXT,
    amount REAL NOT NULL,
    txn_id TEXT,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(post_id) REFERENCES posts(id)
  );
`);

// Seed cashier1 to cashier20 if not already seeded
const count = db.prepare('SELECT COUNT(*) as count FROM cashier_users').get();
if (count.count === 0) {
  const insert = db.prepare('INSERT OR IGNORE INTO cashier_users (cashier_name) VALUES (?)');
  const seedMany = db.transaction(() => {
    for (let i = 1; i <= 20; i++) insert.run(`cashier${i}`);
  });
  seedMany();
  console.log('✅ Seeded cashier1 to cashier20');
}

module.exports = db;
