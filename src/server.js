import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import morgan from 'morgan';

import {
  initDb,
  saveOrder,
  saveDownload,
  markDownloadUsed,
  findDownload,
  findOrder,
  listDownloadsForOrder,
  addEvent,
  listEvents
} from './db.js';
import { findEbookByProductId } from './ebooks.js';
import { sendDownloadEmail } from './email.js';

const app = express();
const db = initDb();

const PORT = Number(process.env.PORT || 3007);
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const EXPIRY_MINUTES = Number(process.env.EBOOK_EXPIRY_MINUTES || 5);
const EXPIRE_AFTER_DOWNLOAD = String(process.env.EBOOK_EXPIRE_AFTER_DOWNLOAD || 'true') === 'true';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

app.use(morgan('dev'));
app.use('/health', (_, res) => res.status(200).send('ok'));
app.get('/', (req, res) => {
  if (ADMIN_PASSWORD && req.query.key !== ADMIN_PASSWORD) {
    return res.status(401).send('Unauthorized');
  }

  const events = listEvents(db).slice().reverse();
  const orders = listOrdersWithDownloads();
  const html = renderDashboard({ events, orders });
  return res.status(200).send(html);
});

app.post('/webhooks/orders_paid', express.raw({ type: 'application/json' }), async (req, res) => {
  const hmac = req.get('X-Shopify-Hmac-Sha256');
  const digest = crypto
    .createHmac('sha256', process.env.WEBHOOK_SHARED_SECRET || '')
    .update(req.body)
    .digest('base64');

  if (!hmac || hmac !== digest) {
    addEvent(db, {
      type: 'webhook_invalid',
      order_id: null,
      message: 'Invalid webhook signature',
      created_at: new Date().toISOString()
    });
    return res.status(401).send('Invalid webhook signature');
  }

  const payload = JSON.parse(req.body.toString('utf8'));
  const orderId = payload.id;
  const customerId = payload.customer ? payload.customer.id : null;
  const email = payload.email;

  if (!orderId || !email) {
    addEvent(db, {
      type: 'webhook_skipped',
      order_id: orderId || null,
      message: 'No order email',
      created_at: new Date().toISOString()
    });
    return res.status(200).send('No order email');
  }

  const ebooks = [];
  for (const lineItem of payload.line_items || []) {
    const match = findEbookByProductId(lineItem.product_id);
    if (match) {
      ebooks.push({
        product_id: lineItem.product_id,
        title: match.title || lineItem.title,
        file_name: match.file_name
      });
    }
  }

  if (ebooks.length === 0) {
    addEvent(db, {
      type: 'webhook_skipped',
      order_id: orderId,
      message: 'No ebook items',
      created_at: new Date().toISOString()
    });
    return res.status(200).send('No ebook items');
  }

  saveOrder(db, {
    id: orderId,
    customer_id: customerId,
    email,
    created_at: new Date().toISOString()
  });

  const links = ebooks.map((ebook) => {
    const token = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + EXPIRY_MINUTES * 60 * 1000).toISOString();
    saveDownload(db, {
      token,
      order_id: orderId,
      product_id: ebook.product_id,
      file_name: ebook.file_name,
      expires_at: expiresAt,
      used_at: null,
      created_at: new Date().toISOString()
    });
    return {
      title: ebook.title,
      url: `${BASE_URL}/download/${token}`,
      expires_at: expiresAt
    };
  });

  const htmlLinks = links
    .map((link) => `<li><a href="${link.url}">${link.title}</a> (expires ${link.expires_at})</li>`)
    .join('');

  const textLinks = links
    .map((link) => `${link.title}: ${link.url} (expires ${link.expires_at})`)
    .join('\n');

  try {
    await sendDownloadEmail({
      to: email,
      subject: 'Your ebook download link',
      html: `<p>Thanks for your purchase.</p><ul>${htmlLinks}</ul>`,
      text: `Thanks for your purchase.\n${textLinks}`
    });
    addEvent(db, {
      type: 'email_sent',
      order_id: orderId,
      message: `Sent ${links.length} link(s) to ${email}`,
      created_at: new Date().toISOString()
    });
  } catch (error) {
    addEvent(db, {
      type: 'email_failed',
      order_id: orderId,
      message: `Email failed: ${error.message || 'unknown error'}`,
      created_at: new Date().toISOString()
    });
  }

  res.status(200).send('ok');
});

app.get('/download/:token', async (req, res) => {
  const token = req.params.token;
  const record = findDownload(db, token);

  if (!record) {
    addEvent(db, {
      type: 'download_failed',
      order_id: null,
      message: 'Link not found',
      created_at: new Date().toISOString()
    });
    return res.status(404).send('Link not found.');
  }

  const now = new Date();
  const expiresAt = new Date(record.expires_at);
  if (now > expiresAt) {
    addEvent(db, {
      type: 'download_failed',
      order_id: record.order_id,
      message: 'Link expired',
      created_at: new Date().toISOString()
    });
    return res.status(410).send('Link expired.');
  }

  if (record.used_at && EXPIRE_AFTER_DOWNLOAD) {
    addEvent(db, {
      type: 'download_failed',
      order_id: record.order_id,
      message: 'Link already used',
      created_at: new Date().toISOString()
    });
    return res.status(410).send('Link already used.');
  }

  const filePath = path.resolve('ebook-delivery-app', 'storage', 'ebooks', record.file_name);
  if (!fs.existsSync(filePath)) {
    addEvent(db, {
      type: 'download_failed',
      order_id: record.order_id,
      message: 'File missing',
      created_at: new Date().toISOString()
    });
    return res.status(404).send('File missing.');
  }

  if (EXPIRE_AFTER_DOWNLOAD) {
    markDownloadUsed(db, token, new Date().toISOString());
  }

  addEvent(db, {
    type: 'download_success',
    order_id: record.order_id,
    message: `Downloaded ${record.file_name}`,
    created_at: new Date().toISOString()
  });

  res.download(filePath);
});

app.get('/proxy/regenerate', (req, res) => {
  const isValid = verifyProxySignature(req.query, process.env.SHOPIFY_API_SECRET || '');
  if (!isValid) {
    addEvent(db, {
      type: 'regen_failed',
      order_id: null,
      message: 'Invalid proxy signature',
      created_at: new Date().toISOString()
    });
    return res.status(401).send('Invalid proxy signature.');
  }

  const orderId = Number(req.query.order_id);
  const customerId = Number(req.query.logged_in_customer_id);
  if (!orderId || !customerId) {
    addEvent(db, {
      type: 'regen_failed',
      order_id: orderId || null,
      message: 'Missing order_id or customer id',
      created_at: new Date().toISOString()
    });
    return res.status(400).send('Missing order_id or customer id.');
  }

  const order = findOrder(db, orderId);
  if (!order || Number(order.customer_id) !== customerId) {
    addEvent(db, {
      type: 'regen_failed',
      order_id: orderId,
      message: 'Order not found for this customer',
      created_at: new Date().toISOString()
    });
    return res.status(403).send('Order not found for this customer.');
  }

  const previous = listDownloadsForOrder(db, orderId);
  if (previous.length === 0) {
    addEvent(db, {
      type: 'regen_failed',
      order_id: orderId,
      message: 'No ebook records found',
      created_at: new Date().toISOString()
    });
    return res.status(404).send('No ebook records found.');
  }

  const links = previous.map((item) => {
    const token = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + EXPIRY_MINUTES * 60 * 1000).toISOString();
    saveDownload(db, {
      token,
      order_id: orderId,
      product_id: item.product_id,
      file_name: item.file_name,
      expires_at: expiresAt,
      used_at: null,
      created_at: new Date().toISOString()
    });
    return {
      title: item.file_name,
      url: `${BASE_URL}/download/${token}`,
      expires_at: expiresAt
    };
  });

  const htmlLinks = links
    .map((link) => `<li><a href="${link.url}">${link.title}</a> (expires ${link.expires_at})</li>`)
    .join('');

  const textLinks = links
    .map((link) => `${link.title}: ${link.url} (expires ${link.expires_at})`)
    .join('\n');

  sendDownloadEmail({
    to: order.email,
    subject: 'Your regenerated ebook link',
    html: `<p>Your link has been regenerated.</p><ul>${htmlLinks}</ul>`,
    text: `Your link has been regenerated.\n${textLinks}`
  })
    .then(() => {
      addEvent(db, {
        type: 'email_sent',
        order_id: orderId,
        message: `Regenerated ${links.length} link(s) for ${order.email}`,
        created_at: new Date().toISOString()
      });
    })
    .catch((error) => {
      addEvent(db, {
        type: 'email_failed',
        order_id: orderId,
        message: `Regenerate email failed: ${error.message || 'unknown error'}`,
        created_at: new Date().toISOString()
      });
    });

  return res.status(200).send('A new download link has been emailed to you.');
});

function verifyProxySignature(query, secret) {
  const { signature, hmac, ...rest } = query;
  const signatureValue = signature || hmac;
  if (!signatureValue) return false;

  const message = Object.keys(rest)
    .sort()
    .map((key) => `${key}=${Array.isArray(rest[key]) ? rest[key].join(',') : rest[key]}`)
    .join('');

  const digest = crypto.createHmac('sha256', secret).update(message).digest('hex');
  return digest === signatureValue;
}

app.listen(PORT, () => {
  console.log(`Ebook delivery app running at ${BASE_URL}`);
});

function listOrdersWithDownloads() {
  const events = listEvents(db);
  const orderMap = new Map();
  for (const event of events) {
    if (!event.order_id) continue;
    if (!orderMap.has(event.order_id)) {
      orderMap.set(event.order_id, { order_id: event.order_id, last_event_at: event.created_at });
    }
    const entry = orderMap.get(event.order_id);
    if (event.created_at > entry.last_event_at) {
      entry.last_event_at = event.created_at;
    }
  }
  return Array.from(orderMap.values()).sort((a, b) => (a.last_event_at < b.last_event_at ? 1 : -1));
}

function renderDashboard({ events, orders }) {
  const rows = events
    .map(
      (event) => `
        <tr>
          <td>${escapeHtml(event.created_at)}</td>
          <td><span class="tag tag--${escapeHtml(event.type)}">${escapeHtml(event.type)}</span></td>
          <td>${event.order_id || '-'}</td>
          <td>${escapeHtml(event.message || '')}</td>
        </tr>
      `
    )
    .join('');

  const ordersRows = orders
    .map(
      (order) => `
        <tr>
          <td>${order.order_id}</td>
          <td>${escapeHtml(order.last_event_at)}</td>
        </tr>
      `
    )
    .join('');

  return `
    <!doctype html>
    <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Ebook Delivery Dashboard</title>
      <style>
        :root {
          color-scheme: light;
          --bg: #f6f4ef;
          --card: #ffffff;
          --ink: #121212;
          --muted: #6b6b6b;
          --accent: #204b3a;
          --border: #e3ded3;
        }
        body {
          font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
          background: linear-gradient(180deg, #f6f4ef 0%, #ffffff 60%);
          color: var(--ink);
          margin: 0;
          padding: 28px;
        }
        header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 24px;
        }
        h1 {
          margin: 0;
          font-size: 24px;
        }
        .grid {
          display: grid;
          gap: 16px;
        }
        .grid.two {
          grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
        }
        .card {
          background: var(--card);
          border: 1px solid var(--border);
          border-radius: 14px;
          padding: 16px;
          box-shadow: 0 8px 18px rgba(0, 0, 0, 0.04);
        }
        table {
          width: 100%;
          border-collapse: collapse;
          font-size: 14px;
        }
        th, td {
          text-align: left;
          padding: 10px;
          border-bottom: 1px solid var(--border);
        }
        th {
          color: var(--muted);
          font-weight: 600;
        }
        .tag {
          display: inline-block;
          padding: 2px 8px;
          border-radius: 999px;
          font-size: 12px;
          background: #e8efe9;
          color: #1f4b3b;
        }
        .tag--email_failed, .tag--download_failed, .tag--regen_failed, .tag--webhook_invalid {
          background: #fde8e8;
          color: #a11d1d;
        }
        .tag--email_sent, .tag--download_success {
          background: #e9f6ef;
          color: #1a6a3f;
        }
      </style>
    </head>
    <body>
      <header>
        <div>
          <h1>Ebook Delivery Dashboard</h1>
          <p>Live status for webhook events, email delivery, and download activity.</p>
        </div>
      </header>
      <div class="grid two">
        <div class="card">
          <h2>Recent Orders</h2>
          <table>
            <thead>
              <tr>
                <th>Order ID</th>
                <th>Last Activity</th>
              </tr>
            </thead>
            <tbody>
              ${ordersRows || '<tr><td colspan="2">No orders yet.</td></tr>'}
            </tbody>
          </table>
        </div>
        <div class="card">
          <h2>Events</h2>
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Type</th>
                <th>Order</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              ${rows || '<tr><td colspan="4">No events yet.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </body>
    </html>
  `;
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
