import fs from 'node:fs';
import path from 'node:path';

const DB_PATH = path.resolve('ebook-delivery-app', 'storage', 'db.json');

function ensureDb() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({ orders: [], downloads: [], events: [] }, null, 2));
  }
}

function readDb() {
  ensureDb();
  const raw = fs.readFileSync(DB_PATH, 'utf8');
  const data = JSON.parse(raw);
  if (!Array.isArray(data.events)) {
    data.events = [];
    writeDb(data);
  }
  return data;
}

function writeDb(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

export function initDb() {
  ensureDb();
  return true;
}

export function saveOrder(_, order) {
  const db = readDb();
  const exists = db.orders.find((item) => Number(item.id) === Number(order.id));
  if (!exists) {
    db.orders.push(order);
    writeDb(db);
  }
}

export function saveDownload(_, download) {
  const db = readDb();
  db.downloads.push(download);
  writeDb(db);
}

export function addEvent(_, event) {
  const db = readDb();
  db.events.push(event);
  if (db.events.length > 500) {
    db.events = db.events.slice(-500);
  }
  writeDb(db);
}

export function markDownloadUsed(_, token, usedAt) {
  const db = readDb();
  const record = db.downloads.find((item) => item.token === token);
  if (record) {
    record.used_at = usedAt;
    writeDb(db);
  }
}

export function findDownload(_, token) {
  const db = readDb();
  return db.downloads.find((item) => item.token === token);
}

export function findOrder(_, orderId) {
  const db = readDb();
  return db.orders.find((item) => Number(item.id) === Number(orderId));
}

export function listDownloadsForOrder(_, orderId) {
  const db = readDb();
  return db.downloads.filter((item) => Number(item.order_id) === Number(orderId));
}

export function listEvents(_) {
  const db = readDb();
  return db.events || [];
}
