import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { createPracticeMiddleware } from './middleware.mjs';

const api = createPracticeMiddleware();
const dist = resolve('dist');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/practice/')) {
      await api.middleware(req, res, () => { res.writeHead(404); res.end('Not found'); });
      return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
    if (url.pathname === '/' || url.pathname === '/calls') { res.writeHead(302, { Location: '/calls/' }); res.end(); return; }
    if (!url.pathname.startsWith('/calls/')) { res.writeHead(404); res.end('Not found'); return; }
    const path = resolve(dist, decodeURIComponent(url.pathname.slice('/calls/'.length)) || 'index.html');
    if (!path.startsWith(dist + sep)) { res.writeHead(403); res.end(); return; }
    const data = await readFile(path);
    res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch { res.writeHead(404); res.end('Not found'); }
});
server.requestTimeout = 30000;
server.listen(Number(process.env.PORT || 8787), process.env.HOST || '127.0.0.1', () => {
  console.log(`Practice server listening on port ${process.env.PORT || 8787}.`);
  if (!process.env.OPENAI_API_KEY) console.log('Set OPENAI_API_KEY in .env.local to enable AI practice.');
});
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { server.close(); await api.close(); process.exit(0); });
