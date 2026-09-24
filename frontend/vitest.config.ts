import { defineConfig } from 'vitest/config'
import solidPlugin from 'vite-plugin-solid'

export default defineConfig({
  plugins: [solidPlugin()],
  test: {
    environment: 'jsdom',
    globals: false,
  },
  resolve: {
    // solid-js は test 用に client 版のエクスポート条件を要求する
    conditions: ['development', 'browser'],
  },
})
