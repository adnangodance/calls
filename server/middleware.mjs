import { createPracticeHandler } from './practice.mjs';

// Share the HTTP boundary between Vite and the standalone production server.
export function createPracticeMiddleware(options) {
  const api = createPracticeHandler(options);
  async function middleware(req, res, next) {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (!url.pathname.startsWith('/api/practice/')) { next(); return; }
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 65536) {
          res.writeHead(413, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify({ error: 'This practice conversation is too long. Start a new attempt.' }));
          return;
        }
        chunks.push(chunk);
      }
      const request = new Request(url, {
        method: req.method, headers: req.headers,
        ...(['GET', 'HEAD'].includes(req.method) ? {} : { body: Buffer.concat(chunks) }),
      });
      // Do not trust arbitrary forwarded IP headers. Behind a proxy, limits are shared.
      const response = await api.handle(request, req.socket.remoteAddress);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: 'Practice could not complete this request. Please try again.' }));
    }
  }
  return { middleware, close: api.close };
}
