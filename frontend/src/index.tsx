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

const root = document.getElementById('app')

if (!root) {
  throw new Error('Root element #app not found')
}

render(() => <App />, root)
