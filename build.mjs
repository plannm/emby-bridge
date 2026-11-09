/* Build the single-file, dependency-free index.html from src/. */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const read = p => readFileSync(join(root, p), 'utf8');

const html = read('src/template.html')
  .replace('/*__STYLE__*/', () => read('src/style.css'))
  .replace('/*__CORE__*/', () => read('src/core.js'))
  .replace('/*__APP__*/', () => read('src/app.js'));

writeFileSync(join(root, 'index.html'), html, 'utf8');
console.log('built index.html:', (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1) + ' KiB');
