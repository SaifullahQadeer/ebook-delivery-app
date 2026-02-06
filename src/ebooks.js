import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, '..');

// Resolve relative to the app folder, not the current working directory.
const CONFIG_PATH = path.join(APP_ROOT, 'config', 'ebooks.json');

export function loadEbookConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    return { products: [] };
  }
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  return JSON.parse(raw);
}

export function findEbookByProductId(productId) {
  const config = loadEbookConfig();
  return config.products.find((product) => Number(product.product_id) === Number(productId));
}
