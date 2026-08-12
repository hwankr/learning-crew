import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // 로컬 풀스택 개발: vite dev(5173) → wrangler dev(8787)로 API 프록시
    proxy: { '/api': 'http://localhost:8787' },
  },
});
