import 'dotenv/config';

const shop = process.env.SHOPIFY_SHOP;
const clientId = process.env.SHOPIFY_API_KEY;
const clientSecret = process.env.SHOPIFY_API_SECRET;
const scopes = process.env.SHOPIFY_SCOPES || 'read_orders';

if (!shop || !clientId || !clientSecret) {
  console.error('Missing SHOPIFY_SHOP, SHOPIFY_API_KEY, or SHOPIFY_API_SECRET in .env');
  process.exit(1);
}

const url = `https://${shop}/admin/oauth/access_token`;

const response = await fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'client_credentials',
    scope: scopes
  })
});

if (!response.ok) {
  console.error('Failed to get access token', response.status, await response.text());
  process.exit(1);
}

const data = await response.json();
console.log('Access token:', data.access_token);
