// Builds the game, then inlines the JS bundle into a single self-contained HTML file
// (hustle-rt.html) that runs offline by double-clicking it — no server needed.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

execSync('npx vite build', { stdio: 'inherit' });
let html = readFileSync('dist/index.html', 'utf8');
const js = readdirSync('dist/assets').find((f) => f.endsWith('.js'));
const code = readFileSync(`dist/assets/${js}`, 'utf8').replace(/<\/script/gi, '<\\/script');
const tag = /<script type="module" crossorigin src="[^"]+"><\/script>/;
if (!tag.test(html)) throw new Error('bundle script tag not found in dist/index.html');
html = html.replace(tag, () => `<script type="module">\n${code}\n</script>`);
writeFileSync('hustle-rt.html', html);
console.log(`wrote hustle-rt.html (${(html.length / 1024).toFixed(0)} KB)`);
