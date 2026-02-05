import fs from 'node:fs';
import path from 'node:path';

const CONFIG_PATH = path.resolve('ebook-delivery-app', 'config', 'ebooks.json');

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
