import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const server = 'http://127.0.0.1:3000';

export default defineConfig({
  plugins: [
    {
      // Game URLs are /g/<token>; in development, serve them the game page like the server does.
      name: 'game-route',
      configureServer(dev) {
        dev.middlewares.use((req, _res, next) => {
          if (req.url?.startsWith('/g/')) req.url = '/game.html';
          next();
        });
      },
    },
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': server,
      '/join': server,
      '/ws': { target: server, ws: true },
    },
  },
  build: {
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
        game: resolve(import.meta.dirname, 'game.html'),
      },
    },
  },
});
