// Static server: /kapa-trader/* -> dist, unknown paths -> index.html (SPA)
const http = require('http'), fs = require('fs'), path = require('path');
const dist = process.argv[2], base = '/kapa-trader/';
const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.mp4': 'video/mp4', '.gif': 'image/gif', '.webp': 'image/webp' };
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (!u.pathname.startsWith(base)) { res.writeHead(404); return res.end('not found (outside /kapa-trader/)'); }
  let f = path.join(dist, decodeURIComponent(u.pathname.slice(base.length)));
  if (f.startsWith(dist) && fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html'); // like GitHub Pages
  if (!f.startsWith(dist) || !fs.existsSync(f)) f = path.join(dist, 'index.html');
  res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
}).listen(8770, () => console.log('serving on 8770'));
