import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiTarget = process.env.POCKET_SETTINGS_API ?? 'http://127.0.0.1:8090';

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': apiTarget } },
  preview: { proxy: { '/api': apiTarget } },
});
