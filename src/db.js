import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const DB_PATH = path.resolve('ebook-delivery-app', 'storage', 'ebook-delivery.sqlite');

export function initDb() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY,
      customer_id INTEGER,
      email TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS downloads (
      token TEXT PRIMARY KEY,
      order_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      file_name TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(order_id) REFERENCES orders(id)
    );
  `);

  return db;
}

export function saveOrder(db, order) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO orders (id, customer_id, email, created_at)
    VALUES (@id, @customer_id, @email, @created_at)
  `);
  stmt.run(order);
}

export function saveDownload(db, download) {
  const stmt = db.prepare(`
    INSERT INTO downloads (token, order_id, product_id, file_name, expires_at, used_at, created_at)
    VALUES (@token, @order_id, @product_id, @file_name, @expires_at, @used_at, @created_at)
  `);
  stmt.run(download);
}

export function markDownloadUsed(db, token, usedAt) {
  const stmt = db.prepare(`
    UPDATE downloads SET used_at = @used_at WHERE token = @token
  `);
  stmt.run({ token, used_at: usedAt });
}

export function findDownload(db, token) {
  const stmt = db.prepare(`
    SELECT * FROM downloads WHERE token = @token
  `);
  return stmt.get({ token });
}

export function findOrder(db, orderId) {
  const stmt = db.prepare(`
    SELECT * FROM orders WHERE id = @id
  `);
  return stmt.get({ id: orderId });
}

export function listDownloadsForOrder(db, orderId) {
  const stmt = db.prepare(`
    SELECT * FROM downloads WHERE order_id = @order_id
  `);
  return stmt.all({ order_id: orderId });
}
