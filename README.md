# Ebook Delivery Custom App

This app provides secure, expiring download links for ebook products and lets customers regenerate links from their account page.

## What It Does
- Listens to `orders/paid` webhooks.
- Generates one-time download links that expire after a set number of minutes.
- Sends a delivery email with the download link(s).
- Provides an app-proxy endpoint so a logged-in customer can regenerate links from their account page.

## Project Structure
- `src/server.js` - webhook handler, download endpoint, app proxy endpoint
- `src/db.js` - JSON file storage for orders + download tokens
- `config/ebooks.json` - product ID -> file mapping
- `storage/ebooks/` - place your ebook files here
- `scripts/get-access-token.js` - get a short-lived Admin API token
- `scripts/register-webhook.js` - register the `orders/paid` webhook

## Setup Steps
1. Create a custom app in Shopify Dev Dashboard and generate API credentials.
2. Add required scopes in the app:
   - `read_orders`
   - `read_products`
   - `write_app_proxy`
3. Configure the app proxy:
   - Prefix: `apps`
   - Subpath: `ebook-delivery`
   - Proxy URL: `https://your-app-domain.com/proxy`
4. Install the app on your store.

## Local/Server Configuration
1. Copy `.env.example` to `.env` and fill values.
2. Map your product ID to a file in `config/ebooks.json`.
3. Put the ebook file in `storage/ebooks/`.

## Register Webhook
1. Get a short-lived access token using:
   - `npm run get-access-token`
2. Set `SHOPIFY_ACCESS_TOKEN` in `.env`.
3. Register the webhook:
   - `npm run register-webhook`

## How Regenerate Works
The theme link points to:
```
/apps/ebook-delivery/regenerate?order_id={{ order.id }}
```
Shopify app proxy signs the request so the app can verify the customer and order before regenerating.

## Notes
- Webhook HMAC verification is required for security.
- Tokens expire after `EBOOK_EXPIRY_MINUTES` and can be single-use.
- This version avoids native SQLite dependencies so it runs on hosts without Python/build tools.
