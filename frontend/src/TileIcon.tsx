// タイルのラベルに併記するアイコン(Issue #115)。文字だけでなく印象からも意味をつかめるようにする。
// - 色は文字色(currentColor。アイコンは赤くしない)。緊急入口は色や面で装飾しない(Issue #36)。赤みのある面になるのは
//   押すと伝達欄が赤くなるパネルだけで(Issue #136)、アイコンでは区別しない
// - 表示専用。読み上げ・スキャン順・aria-label には含めない(aria-hidden)
// - 対象は、ホームの項目と「戻る」(項目の id で決まる)。介助者が編集できるフレーズの項目には付けない

import type { JSX } from 'solid-js'

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
}

/** その項目にアイコンがあるか */
export function hasTileIcon(itemId: string): boolean {
  return itemId in ICONS
}

export default function TileIcon(props: { itemId: string }) {
  return (
    <svg class="tile-icon" viewBox="0 0 24 24" aria-hidden="true">
      {ICONS[props.itemId]?.()}
    </svg>
  )
}
