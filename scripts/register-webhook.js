import 'dotenv/config';

const shop = process.env.SHOPIFY_SHOP;
const token = process.env.SHOPIFY_ACCESS_TOKEN;
const apiVersion = process.env.SHOPIFY_API_VERSION || '2026-01';
const baseUrl = process.env.BASE_URL;

if (!shop || !token || !baseUrl) {
  console.error('Missing SHOPIFY_SHOP, SHOPIFY_ACCESS_TOKEN, or BASE_URL in .env');
  process.exit(1);
}

const query = `
  mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
    webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
      webhookSubscription {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const response = await fetch(`https://${shop}/admin/api/${apiVersion}/graphql.json`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Shopify-Access-Token': token
  },
  body: JSON.stringify({
    query,
    variables: {
      topic: 'ORDERS_PAID',
      webhookSubscription: {
        callbackUrl: `${baseUrl}/webhooks/orders_paid`,
        format: 'JSON'
      }
    }
  })
});

const data = await response.json();
console.log(JSON.stringify(data, null, 2));
