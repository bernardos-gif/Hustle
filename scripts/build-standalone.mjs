// Builds the game, then inlines the JS bundle into a single self-contained HTML file that runs
// offline by double-clicking it — no server needed.
// Usage: node scripts/build-standalone.mjs [output.html]   (default: hustle-rt-v2.html)
// hustle-rt.html is the frozen v1 baseline release and is never overwritten by default.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

execSync('npx vite build', { stdio: 'inherit' });
let html = readFileSync('dist/index.html', 'utf8');
const js = readdirSync('dist/assets').find((f) => f.endsWith('.js'));
const code = readFileSync(`dist/assets/${js}`, 'utf8').replace(/<\/script/gi, '<\\/script');
const tag = /<script type="module" crossorigin src="[^"]+"><\/script>/;
if (!tag.test(html)) throw new Error('bundle script tag not found in dist/index.html');
html = html.replace(tag, () => `<script type="module">\n${code}\n</script>`);
const out = process.argv[2] ?? 'hustle-rt-v2.html';
if (out === 'hustle-rt.html' && !process.env.OVERWRITE_BASELINE) throw new Error('hustle-rt.html is the frozen v1 baseline; set OVERWRITE_BASELINE=1 to replace it');
writeFileSync(out, html);
console.log(`wrote ${out} (${(html.length / 1024).toFixed(0)} KB)`);
