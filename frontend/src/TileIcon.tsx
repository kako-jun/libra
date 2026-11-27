// パネルとボタンのラベルに併記する線画アイコン(Issue #115・#155)。文字だけでなく印象からも意味をつかめるようにする。
// - 色は文字色(currentColor。アイコンは赤くしない)。緊急入口は色や面で装飾しない(Issue #36)。赤みのある面になるのは
//   押すと伝達欄が赤くなるパネルだけで(Issue #136)、アイコンでは区別しない
// - 表示専用。読み上げ・スキャン順・aria-label には含めない(aria-hidden)。文字のラベルは必ず残す
// - 同じ操作には同じアイコンを使う
// - パネルは、決まった操作のもの(ホームの項目・戻る・緊急・緊急の解除・1字消す・確定)だけに付ける。
//   介助者が編集できるフレーズや、伝える内容を選ぶパネルには付けない

import type { JSX } from 'solid-js'
import type { MenuItem } from './lib/menus'

const ICONS: Record<string, () => JSX.Element> = {
  // 緊急: 呼び鈴
  emergency: () => (
    <>
      <path d="M6 17V11a6 6 0 0 1 12 0v6" />
      <path d="M4 17h16" />
      <path d="M10 20.5h4" />
      <path d="M12 2.5V5" />
    </>
  ),
  // もう一度: 一周して戻る矢印
  repeat: () => (
    <>
      <path d="M19.5 12a7.5 7.5 0 1 1-2.6-5.7" />
      <path d="M20 3.5V7.5H16" />
    </>
  ),
  // はい: まる
  yes: () => <circle cx="12" cy="12" r="8" />,
  // いいえ: ばつ
  no: () => (
    <>
      <path d="M5.5 5.5 18.5 18.5" />
      <path d="M18.5 5.5 5.5 18.5" />
    </>
  ),
  // 快: 笑顔
  'comfort-nav': () => (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 9.5v.5M15.5 9.5v.5" />
      <path d="M7.5 14a5 5 0 0 0 9 0" />
    </>
  ),
  // 不快: つらい顔
  'discomfort-nav': () => (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 9.5v.5M15.5 9.5v.5" />
      <path d="M7.5 16.5a5 5 0 0 1 9 0" />
    </>
  ),
  // 要望: 吹き出し
  'requests-nav': () => (
    <>
      <path d="M4 5h16v11H11l-5 4v-4H4z" />
      <path d="M8.5 10.5h.5M12 10.5h.5M15.5 10.5h.5" />
    </>
  ),
  // 文字盤: 文字の並んだ盤
  'letters-nav': () => (
    <>
      <rect x="3" y="4" width="18" height="16" rx="1.5" />
      <path d="M3 9.5h18M3 14.5h18M9 4v16M15 4v16" />
    </>
  ),
  // モールス: 短点と長点
  'morse-nav': () => (
    <>
      <circle cx="4.5" cy="12" r="1.6" fill="currentColor" />
      <path d="M10.5 12h10" stroke-width="3.2" />
    </>
  ),
  // 戻る: 左向きの矢印
  back: () => (
    <>
      <path d="M11 5 4 12l7 7" />
      <path d="M4 12h16" />
    </>
  ),
  // 緊急の解除: 斜線を引いた呼び鈴
  release: () => (
    <>
      <path d="M6 17V11a6 6 0 0 1 12 0v6" />
      <path d="M4 17h16" />
      <path d="M10 20.5h4" />
      <path d="M3.5 3.5 20.5 20.5" />
    </>
  ),
  // 1字消す: 後退キー
  backspace: () => (
    <>
      <path d="M8.5 5.5H21v13H8.5L3 12z" />
      <path d="m11.5 9.5 5 5M16.5 9.5l-5 5" />
    </>
  ),
  // 確定: チェック
  commit: () => <path d="M4 12.5 9.5 18 20 6.5" />,
  // 介助者用: 歯車(設定)
  caregiver: () => (
    <>
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
      <path d="M12 2.5V6M12 18v3.5M2.5 12H6M18 12h3.5M5.3 5.3l2.5 2.5M16.2 16.2l2.5 2.5M18.7 5.3l-2.5 2.5M7.8 16.2l-2.5 2.5" />
    </>
  ),
  // 閉じる・やめる: ばつ
  close: () => <path d="M6 6l12 12M18 6 6 18" />,
  // 上へ・下へ
  up: () => <path d="M12 20V4M5 11l7-7 7 7" />,
  down: () => <path d="M12 4v16M5 13l7 7 7-7" />,
  // 削除・画像を消す: ゴミ箱
  delete: () => (
    <>
      <path d="M4 6.5h16M9.5 6.5v-3h5v3" />
      <path d="M6 6.5 7 20.5h10l1-14" />
      <path d="M10 10.5v6M14 10.5v6" />
    </>
  ),
  // 追加: プラス
  add: () => <path d="M12 4.5v15M4.5 12h15" />,
  // 書き出し: 箱から外へ出る矢印
  export: () => (
    <>
      <path d="M4 14v6h16v-6" />
      <path d="M12 15V4M7.5 8.5 12 4l4.5 4.5" />
    </>
  ),
  // 取り込み: 箱の中へ入る矢印
  import: () => (
    <>
      <path d="M4 14v6h16v-6" />
      <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5" />
    </>
  ),
  // 初期値に戻す: 戻る曲がり矢印
  reset: () => (
    <>
      <path d="M8.5 4 4 8.5 8.5 13" />
      <path d="M4 8.5h10a5.5 5.5 0 0 1 0 11H9" />
    </>
  ),
  // 画像を選ぶ・変える: 写真
  photo: () => (
    <>
      <rect x="3" y="5" width="18" height="14" rx="1.5" />
      <circle cx="8.5" cy="10" r="1.5" />
      <path d="m5 18 5.5-5 3.5 3 2.5-2.5 4 4" />
    </>
  ),
  // アプリをインストール: 端末に入る矢印
  install: () => (
    <>
      <rect x="6" y="2.5" width="12" height="19" rx="2" />
      <path d="M12 7v8M8.5 11.5 12 15l3.5-3.5M10 18.5h4" />
    </>
  ),
}

/**
 * パネルに付けるアイコンの名前。付けないパネルは null。
 * 項目の id だけでは決めない。介助者のフレーズは id が自由で、決まった操作と同じ id になりうる
 * (既定の「背中腰」の id は back で、「戻る」と同じ)。操作の種類で決める
 */
export function tileIconName(item: Pick<MenuItem, 'id' | 'action'>): string | null {
  switch (item.action.type) {
    case 'emergency':
      return 'emergency'
    case 'repeat':
      return 'repeat'
    case 'back':
      return 'back'
    case 'navigate':
      if (item.id === 'emergency-release-nav') return 'release'
      return item.id in ICONS ? item.id : null
    case 'emergencyRelease':
      return 'release'
    case 'letterBackspace':
      return 'backspace'
    case 'letterCommit':
      return 'commit'
    case 'message':
      // ホームの固定の はい・いいえ だけ
      if (item.id === 'yes' && item.action.text === 'はい。') return 'yes'
      if (item.id === 'no' && item.action.text === 'いいえ。') return 'no'
      return null
    default:
      return null
  }
}

function Icon(props: { name: string; class: string }) {
  return (
    <svg class={props.class} data-icon={props.name} viewBox="0 0 24 24" aria-hidden="true">
      {ICONS[props.name]?.()}
    </svg>
  )
}

/** パネルのアイコン(大きさと位置は globals.css の .tile-icon) */
export default function TileIcon(props: { name: string }) {
  return <Icon name={props.name} class="tile-icon" />
}

/** ボタンのアイコン(Issue #155) */
export function ButtonIcon(props: { name: string }) {
  return <Icon name={props.name} class="button-icon" />
}
