import { loadEnv } from 'vite';
import { createPracticeMiddleware } from './middleware.mjs';

// The API runs inside Vite: npm run dev needs no second process or fixed API port.
// These settings stay in Node; only VITE_ variables reach the browser as usual.
export function practiceApiPlugin({ fetchImpl } = {}) {
  let api;
  const close = () => api?.close();

  function install(server) {
    const env = loadEnv(server.config.mode, server.config.envDir, '');
    server.httpServer?.once('close', () => { void close(); });
    server.middlewares.use((req, res, next) => {
      if (!req.url?.startsWith('/api/practice/')) { next(); return; }
      if (!api) {
        const address = server.httpServer?.address();
        if (!address || typeof address === 'string') {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'The practice server is starting. Please try again.' }));
          return;
        }
        const loopback = ['127.0.0.1', '::1'].includes(address.address);
        const protocol = server.config.server.https ? 'https' : 'http';
        const localOrigins = ['127.0.0.1', 'localhost', '[::1]'].map(host => `${protocol}://${host}:${address.port}`);
        api = createPracticeMiddleware({
          fetchImpl,
          env: {
            ...env,
            // Local dev/preview may use production-mode frontend assets. Actual
            // network exposure decides whether production API protections apply.
            NODE_ENV: loopback ? 'development' : 'production',
            HOST: address.address,
            ALLOWED_ORIGINS: loopback ? [env.ALLOWED_ORIGINS, ...localOrigins].filter(Boolean).join(',') : env.ALLOWED_ORIGINS,
          },
        });
        if (!env.OPENAI_API_KEY) server.config.logger.warn('AI calls need OPENAI_API_KEY in .env.local. The practice API is running; the key is missing.');
      }
      void api.middleware(req, res, next);
    });
  }

  return {
    name: 'practice-api',
    configureServer: install,
    configurePreviewServer: install,
    closeBundle: close,
  };
}
