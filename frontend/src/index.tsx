/* @refresh reload */
import { render } from 'solid-js/web'
import App from './App'
import { initInstallCapture } from './lib/install'
// BIZ UDGothic(全字)を同梱してオフラインでも動くようにする（requirements.md §8、Issue #156）。
import './styles/fonts.css'
import './styles/globals.css'

// Issue #158: beforeinstallprompt は起動直後に 1 回出て、取り直せないので、描画より前に預かる
initInstallCapture()

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
