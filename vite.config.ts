import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset URLs so the same build loads from a web server and from file:// in Electron.
  base: './',
  server: { port: 5173, host: '127.0.0.1' },
  build: { target: 'es2022', assetsInlineLimit: 0 },
});
