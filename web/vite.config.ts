import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8080', ws: true, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    // index.html = aplikasi MIKROTAL; platform.html = halaman pendaftaran & admin MIKROTAL Cloud
    rollupOptions: { input: { main: 'index.html', platform: 'platform.html' } },
    chunkSizeWarningLimit: 1500,
  },
});
