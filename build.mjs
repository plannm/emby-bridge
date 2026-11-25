/* Build the single-file, dependency-free index.html from src/. */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const read = p => readFileSync(join(root, p), 'utf8');
const logoMime = { png: 'image/png', svg: 'image/svg+xml', webp: 'image/webp' };
const inlineLogos = html => html.replace(/__LOGO:([a-z][a-z0-9-]*\.(png|svg|webp))__/g, (_, file, ext) => {
  const bytes = readFileSync(join(root, 'src/logos', file));
  return 'data:' + logoMime[ext] + ';base64,' + bytes.toString('base64');
});

const html = inlineLogos(read('src/template.html')
  .replace('/*__STYLE__*/', () => read('src/style.css'))
  .replace('/*__CORE__*/', () => read('src/core.js'))
  .replace('/*__APP__*/', () => read('src/app.js')));

for (const marker of ['/*__STYLE__*/', '/*__CORE__*/', '/*__APP__*/', '__LOGO:']) {
  if (html.includes(marker)) throw new Error('unreplaced placeholder: ' + marker);
}

writeFileSync(join(root, 'index.html'), html, 'utf8');
console.log('built index.html:', (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1) + ' KiB');
