import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { practiceApiPlugin } from './server/vite-practice.mjs';

export default defineConfig({
  plugins: [react(), practiceApiPlugin()],
  base: '/calls/',
});
