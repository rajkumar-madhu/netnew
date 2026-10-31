import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const target = process.env.NETNEW_SERVER || 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': target,
      '/install.sh': target,
      '/agent': target,
      '/ws': { target, ws: true },
    },
  },
});
