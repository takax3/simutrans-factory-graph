import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  test: {
    environment: 'jsdom',
    setupFiles: ['./ui/test-setup.ts'],
    include: ['ui/**/*.test.{ts,tsx}'],
  },
});
