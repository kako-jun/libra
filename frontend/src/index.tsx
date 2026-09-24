/* @refresh reload */
import { render } from 'solid-js/web'
import App from './App'
// BIZ UDPGothic を同梱してオフラインでも動くようにする（requirements.md §8）。
// 日本語+ラテンの unicode-range 分割版のみを読み込み、他言語の字形サブセットは含めない。
import '@fontsource/biz-udpgothic/japanese-400.css'
import '@fontsource/biz-udpgothic/japanese-700.css'
import '@fontsource/biz-udpgothic/latin-400.css'
import '@fontsource/biz-udpgothic/latin-700.css'
import './styles/globals.css'

// Issue #5: iOS Safari はピンチ拡大を touch-action だけでは抑止できないため、
// gesturestart(非標準だが Safari 系のみが発火する)を止める。他ブラウザには存在しないイベントで
// 実害はないため常時登録してよい
window.addEventListener('gesturestart', (event) => event.preventDefault())

// Issue #5: Service Worker はアプリ本体をキャッシュしてオフライン動作を成り立たせる。
// dev サーバーでは古いビルドのキャッシュに悩まされるため、本番ビルドでのみ登録する
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((error: unknown) => {
    console.error('Service Worker registration failed:', error)
  })
}

const root = document.getElementById('app')

if (!root) {
  throw new Error('Root element #app not found')
}

render(() => <App />, root)
