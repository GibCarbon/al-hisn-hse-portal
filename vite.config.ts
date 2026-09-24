import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// NH HSE Portal — static SPA build (React + Firebase), deployed to GitHub Pages.
// base is set to the repo name so asset URLs resolve correctly under
// https://<user>.github.io/<repo>/ — change it if you rename the repo,
// or set it to '/' if you deploy to a custom domain at the root.
export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/al-hisn-hse-portal/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
