import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base so the build works from any path (e.g. a GitHub Pages
// project site at /ViewTube/) without configuration.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { host: true },
});
