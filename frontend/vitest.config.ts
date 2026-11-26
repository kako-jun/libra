import { defineConfig } from 'vitest/config'
import solidPlugin from 'vite-plugin-solid'

export default defineConfig({
  plugins: [solidPlugin()],
  test: {
    environment: 'jsdom',
    globals: false,
    // 外部への通信を既定で止める(Issue #118 の利用回数の取得が、テストから本番の API を叩かないようにする)
    setupFiles: ['./src/test-setup.ts'],
  },
  resolve: {
    // solid-js は test 用に client 版のエクスポート条件を要求する
    conditions: ['development', 'browser'],
  },
})
