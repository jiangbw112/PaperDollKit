import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react') || id.includes('node_modules/lucide-react')) {
            return 'vendor-react';
          }
          if (
            id.includes('node_modules/ag-psd') ||
            id.includes('node_modules/fflate') ||
            id.includes('packages/importers')
          ) {
            return 'pdk-importers';
          }
          if (id.includes('packages/exporters')) {
            return 'pdk-exporters';
          }
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    host: true,
    allowedHosts: true,
  },
  preview: {
    port: 5173,
    host: true,
    allowedHosts: true,
  },
});
