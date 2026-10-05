// After `vite build`: add the Caddy deploy files to dist/ and precompress text assets
// (brotli + gzip) so the server never compresses the 47,360-box data on the fly.
import { readdirSync, statSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';

const DIST = 'dist';
copyFileSync('deploy/Dockerfile', join(DIST, 'Dockerfile'));
copyFileSync('deploy/Caddyfile', join(DIST, 'Caddyfile'));

const EXT = new Set(['.html', '.js', '.css', '.json', '.svg', '.txt', '.xml']);
let files = 0, raw = 0, br = 0;
const t0 = Date.now();
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) { walk(p); continue; }
    if (!EXT.has(extname(name)) || s.size < 1024) continue;
    const buf = readFileSync(p);
    const b = brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: buf.length > 2e6 ? 10 : 11, [constants.BROTLI_PARAM_SIZE_HINT]: buf.length } });
    writeFileSync(p + '.br', b);
    writeFileSync(p + '.gz', gzipSync(buf, { level: 9 }));
    files++; raw += buf.length; br += b.length;
  }
})(DIST);
console.log(`precompressed ${files} files: ${(raw / 1e6).toFixed(1)} MB → ${(br / 1e6).toFixed(1)} MB brotli in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
