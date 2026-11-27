// 画面に組み込んだ部分の結合テスト(lib の単体は photo.test.ts / appInfo.test.ts / settings.test.ts)。
//   Issue #122 好きな画像   | 表示・未設定・壊れた保存値 / 選ぶ(成功・読めない・保存できない) / 消す / 表示タブの初期値に戻す / 触れても何も伝えない / 書き出しに入らない
//   Issue #118 このアプリ   | リンク(別画面・noopener) / 利用回数(失敗=取得できません・成功=桁区切り) / 取得は起動時 1 回だけ・本番以外は get / バージョン(日付だけ #146) / 使い方の本文は無い(#149)
//   Issue #112 開いた直後   | 開いたタップの click が「閉じる」に届いても閉じない。別のポインター・次のタップ・キーボードの click は閉じる
//   Issue #113 / #115 アイコン | パンくず先頭「ホーム」の家アイコン / ホームの全項目・戻るのアイコン / フレーズ項目には無い / 読み上げ名・文字は変えない
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, waitFor } from '@solidjs/testing-library'
import App from '../App'
import * as photoModule from '../lib/photo'
import { PHOTO_STORAGE_KEY } from '../lib/photo'
import { AUTHOR_SITE_URL, FEEDBACK_BBS_URL, FONT_LICENSE_URL, USER_GUIDE_URL } from '../lib/appInfo'
import { exportSettingsJson, loadSettings } from '../lib/settings'
import {
  buttonByText,
  closeCaregiverMenu,
  menuOpen,
  openCaregiverMenu,
  pointerClick,
  selectCaregiverTab,
  setupApp,
  shownMessage,
  spoken,
  tap,
  teardownApp,
  tile,
  tileLabels,
  vibrations,
} from './appTestKit'

const PHOTO = 'data:image/webp;base64,UklGRg=='
const guidePhoto = (c: HTMLElement) => c.querySelector<HTMLImageElement>('.guide-photo')
const photoStatus = (c: HTMLElement) =>
  c.querySelector('.caregiver-tabpanel .caregiver-status[role="status"]')?.textContent ?? ''

/** 表示タブのファイル選択に、ファイルを 1 つ選んだことにする */
async function chooseFile(c: HTMLElement) {
  const input = c.querySelector('.caregiver-tabpanel input.photo-input') as HTMLInputElement
  const file = new File(['x'], 'cat.png', { type: 'image/png' })
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  fireEvent.change(input)
  // fileToPhotoDataUrl は非同期(偽の時計でもマイクロタスクは進む)
  await Promise.resolve()
  await Promise.resolve()
}

describe('Issue #122: 好きな画像(本人画面・介助者用メニュー「表示」タブ)', () => {
  beforeEach(setupApp)
  afterEach(teardownApp)

  it('未設定なら本人画面に画像を出さない', () => {
    const { container } = render(() => <App />)
    expect(guidePhoto(container)).toBeNull()
  })

  it('保存済みの画像は、起動時から「介助者用」ボタンと同じ案内欄に出る(代替テキスト付き)', () => {
    window.localStorage.setItem(PHOTO_STORAGE_KEY, PHOTO)
    const { container } = render(() => <App />)
    const img = guidePhoto(container)
    expect(img?.getAttribute('src')).toBe(PHOTO)
    expect(img?.getAttribute('alt')).toBe('好きな画像')
    expect(img?.closest('.screen-guide')).toBe(container.querySelector('.screen-guide'))
    // ボタンより前(左)に置く
    const button = container.querySelector('.caregiver-button') as HTMLElement
    expect(
      (img as HTMLElement).compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('保存値が画像でない(壊れている)なら出さない', () => {
    window.localStorage.setItem(PHOTO_STORAGE_KEY, 'javascript:alert(1)')
    const { container } = render(() => <App />)
    expect(guidePhoto(container)).toBeNull()
  })

  it('画像はタイルではない: スキャン対象に入らず、触れても何も伝えない', () => {
    window.localStorage.setItem(PHOTO_STORAGE_KEY, PHOTO)
    const { container } = render(() => <App />)
    expect(tileLabels(container)).not.toContain('好きな画像')
    const img = guidePhoto(container) as HTMLElement
    vi.advanceTimersByTime(600)
    fireEvent.pointerDown(img, { pointerId: 3, pointerType: 'touch' })
    fireEvent.pointerUp(img, { pointerId: 3, pointerType: 'touch' })
    pointerClick(img, 3)
    expect(shownMessage(container)).toBeNull()
    expect(menuOpen(container)).toBe(false)
  })

  it('「画像を選ぶ」で選ぶと保存され、本人画面に出る。ボタンは「画像を変える」「画像を消す」になる', async () => {
    vi.spyOn(photoModule, 'fileToPhotoDataUrl').mockResolvedValue(PHOTO)
    const { container } = render(() => <App />)
    openCaregiverMenu(container)
    const panel = selectCaregiverTab(container, '表示')
    buttonByText(panel, '画像を選ぶ')
    await chooseFile(container)
    await waitFor(() => expect(window.localStorage.getItem(PHOTO_STORAGE_KEY)).toBe(PHOTO))
    expect(photoStatus(container)).toBe('画像を設定しました。')
    expect(container.querySelector('.photo-preview')?.getAttribute('src')).toBe(PHOTO)
    buttonByText(panel, '画像を変える')
    buttonByText(panel, '画像を消す')
    closeCaregiverMenu(container)
    expect(guidePhoto(container)?.getAttribute('src')).toBe(PHOTO)
  })

  it('読み込めない画像は、案内を出して何も変えない(前の画像は残る)', async () => {
    window.localStorage.setItem(PHOTO_STORAGE_KEY, PHOTO)
    vi.spyOn(photoModule, 'fileToPhotoDataUrl').mockRejectedValue(new Error('broken'))
    const { container } = render(() => <App />)
    openCaregiverMenu(container)
    selectCaregiverTab(container, '表示')
    await chooseFile(container)
    await waitFor(() =>
      expect(photoStatus(container)).toBe(
        'この画像は読み込めませんでした。別の画像を選んでください。',
      ),
    )
    expect(window.localStorage.getItem(PHOTO_STORAGE_KEY)).toBe(PHOTO)
    closeCaregiverMenu(container)
    expect(guidePhoto(container)?.getAttribute('src')).toBe(PHOTO)
  })

  it('保存できない(上限超え・容量不足)ときは、案内を出して表示を変えない', async () => {
    const tooLarge = `data:image/png;base64,${'A'.repeat(photoModule.PHOTO_MAX_CHARS)}`
    vi.spyOn(photoModule, 'fileToPhotoDataUrl').mockResolvedValue(tooLarge)
    const { container } = render(() => <App />)
    openCaregiverMenu(container)
    selectCaregiverTab(container, '表示')
    await chooseFile(container)
    await waitFor(() =>
      expect(photoStatus(container)).toBe(
        '保存できませんでした。もっと小さい画像を選んでください。',
      ),
    )
    expect(window.localStorage.getItem(PHOTO_STORAGE_KEY)).toBeNull()
    closeCaregiverMenu(container)
    expect(guidePhoto(container)).toBeNull()
  })

  it('「画像を消す」で端末からも消え、本人画面からも消える', () => {
    window.localStorage.setItem(PHOTO_STORAGE_KEY, PHOTO)
    const { container } = render(() => <App />)
    openCaregiverMenu(container)
    const panel = selectCaregiverTab(container, '表示')
    fireEvent.click(buttonByText(panel, '画像を消す'))
    expect(window.localStorage.getItem(PHOTO_STORAGE_KEY)).toBeNull()
    expect(photoStatus(container)).toBe('画像を消しました。')
    buttonByText(panel, '画像を選ぶ')
    closeCaregiverMenu(container)
    expect(guidePhoto(container)).toBeNull()
  })

  it('「表示」タブの初期値に戻すで画像も消える。ほかのタブの初期値に戻すでは消えない', () => {
    window.localStorage.setItem(PHOTO_STORAGE_KEY, PHOTO)
    const { container } = render(() => <App />)
    openCaregiverMenu(container)
    for (const tab of ['スキャン', 'モールス', '音と振動', 'フレーズ']) {
      selectCaregiverTab(container, tab)
      const reset = container.querySelector('.caregiver-reset-button') as HTMLElement
      fireEvent.click(reset)
      fireEvent.click(reset)
      expect(window.localStorage.getItem(PHOTO_STORAGE_KEY), tab).toBe(PHOTO)
    }
    selectCaregiverTab(container, '表示')
    const reset = container.querySelector('.caregiver-reset-button') as HTMLElement
    fireEvent.click(reset)
    expect(window.localStorage.getItem(PHOTO_STORAGE_KEY)).toBe(PHOTO) // 1 回目は確認だけ
    fireEvent.click(reset)
    expect(window.localStorage.getItem(PHOTO_STORAGE_KEY)).toBeNull()
    closeCaregiverMenu(container)
    expect(guidePhoto(container)).toBeNull()
  })

  it('画像は設定の書き出しに含まれない', () => {
    window.localStorage.setItem(PHOTO_STORAGE_KEY, PHOTO)
    window.localStorage.setItem('libra', JSON.stringify({ intervalMs: 3000 }))
    const json = exportSettingsJson(loadSettings())
    expect(json).not.toContain('data:image')
    expect(json).not.toContain('photo')
  })
})

describe('Issue #118: 「このアプリ」タブ', () => {
  beforeEach(setupApp)
  afterEach(teardownApp)

  const openAbout = (c: HTMLElement) => {
    openCaregiverMenu(c)
    return selectCaregiverTab(c, 'このアプリ')
  }

  it('タブ列の最後に「このアプリ」がある', () => {
    const { container } = render(() => <App />)
    openCaregiverMenu(container)
    const tabs = Array.from(container.querySelectorAll('[role="tab"]')).map((t) => t.textContent)
    expect(tabs.at(-1)).toBe('このアプリ')
  })

  it('4 つのリンクは仕様の行き先で、別の画面で開き、開いた先へ参照元を渡さない', () => {
    const { container } = render(() => <App />)
    const panel = openAbout(container)
    const links = Object.fromEntries(
      Array.from(panel.querySelectorAll('a')).map((a) => [a.textContent?.trim(), a]),
    )
    expect(Object.keys(links)).toEqual([
      '利用ガイド',
      'ご意見・ご感想の掲示板',
      '作者サイト',
      'フォントのライセンス',
    ])
    expect(links['利用ガイド']?.getAttribute('href')).toBe(USER_GUIDE_URL)
    expect(links['フォントのライセンス']?.getAttribute('href')).toBe(FONT_LICENSE_URL)
    expect(links['ご意見・ご感想の掲示板']?.getAttribute('href')).toBe(FEEDBACK_BBS_URL)
    expect(links['作者サイト']?.getAttribute('href')).toBe(AUTHOR_SITE_URL)
    for (const a of Object.values(links)) {
      expect(a.getAttribute('target')).toBe('_blank')
      expect(a.getAttribute('rel')?.split(' ')).toEqual(
        expect.arrayContaining(['noopener', 'noreferrer']),
      )
    }
  })

  // Issue #149: 使い方の本文はアプリ内に置かず、利用ガイドへのリンクだけにする
  it('使い方の本文・見出し・リンク下の注意書きは無い', () => {
    const { container } = render(() => <App />)
    const panel = openAbout(container)
    expect(panel.querySelector('h3, ul, ol, p')).toBeNull()
    for (const word of ['スイッチ', 'もう一度', '緊急を解除', '見終わったら']) {
      expect(panel.textContent).not.toContain(word)
    }
  })

  // 画面から外した注意(開いている間はスイッチと消灯防止が効かない)は、利用ガイドに書く
  it('リンク先を開いている間の注意は、利用ガイドに書いてある', async () => {
    // @ts-expect-error node:fs の型定義は無い(実行時には存在する)
    const fs = (await import('node:fs')) as { readFileSync: (path: string, enc: string) => string }
    const cwd = (globalThis as unknown as { process: { cwd: () => string } }).process.cwd()
    const guide = fs.readFileSync(`${cwd}/../docs/user-guide.md`, 'utf8')
    for (const words of [
      'リンク先を開いている間の注意',
      '本人のスイッチの操作も、画面が消えないようにする働きも効かない',
      '必ずアプリの画面に戻る',
    ]) {
      expect(guide).toContain(words)
    }
  })

  it('通信できない(既定で fetch が失敗する)ときは「取得できません」を出し、伝達はふつうに動く', async () => {
    const { container } = render(() => <App />)
    await Promise.resolve()
    const panel = openAbout(container)
    expect(panel.querySelector('.app-usage-count')?.textContent).toBe(
      '取得できません（通信がないときは表示されません）',
    )
    closeCaregiverMenu(container)
    tap(container, 'はい')
    expect(shownMessage(container)).toBe('はい。')
  })

  it('取得できたら桁区切りで回数を出す。取得は起動時の 1 回だけで、本番以外のホストでは get(数えない)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { total: 12345 } }),
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch
    const { container } = render(() => <App />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(String(fetchMock.mock.calls[0][0])).toContain('action=get')
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('increment')
    let panel = openAbout(container)
    await waitFor(() =>
      expect(panel.querySelector('.app-usage-count')?.textContent).toBe('12,345 回'),
    )
    // メニューを開き直しても取りに行かない
    closeCaregiverMenu(container)
    panel = openAbout(container)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('バージョンは日付だけを出す(単体テストでは埋め込みが無いので dev)', () => {
    const { container } = render(() => <App />)
    const panel = openAbout(container)
    expect(panel.querySelector('.app-version')?.textContent).toBe('dev')
  })

  it('「このアプリ」タブには初期値に戻すが無い', () => {
    const { container } = render(() => <App />)
    const panel = openAbout(container)
    expect(panel.querySelector('.caregiver-reset')).toBeNull()
  })
})

describe('Issue #112: 「介助者用」をタップして開いた直後に、同じタップの click で閉じない', () => {
  beforeEach(setupApp)
  afterEach(teardownApp)

  const caregiverButton = (c: HTMLElement) => c.querySelector('.caregiver-button') as HTMLElement
  const closeButton = (c: HTMLElement) => c.querySelector('.caregiver-close') as HTMLElement

  /** タッチで「介助者用」を押して離す(click はまだ届いていない) */
  function touchOpen(c: HTMLElement, pointerId: number) {
    fireEvent.pointerDown(caregiverButton(c), { pointerId, pointerType: 'touch' })
    expect(menuOpen(c)).toBe(true)
    fireEvent.pointerUp(document.body, { pointerId, pointerType: 'touch' })
  }

  it('開いたタップの click が、同じ位置の「閉じる」へ届いても閉じない', () => {
    const { container } = render(() => <App />)
    touchOpen(container, 7)
    pointerClick(closeButton(container), 7)
    expect(menuOpen(container)).toBe(true)
  })

  it('pointerId の無い click(古い環境)も、開いたタップの click として 1 回だけ止める', () => {
    const { container } = render(() => <App />)
    touchOpen(container, 7)
    fireEvent.click(closeButton(container))
    expect(menuOpen(container)).toBe(true)
    fireEvent.click(closeButton(container)) // 2 回目の click は止めない
    expect(menuOpen(container)).toBe(false)
  })

  it('止めるのは 1 回だけ: 次のタップ(押下 → click)の「閉じる」では閉じる', () => {
    const { container } = render(() => <App />)
    touchOpen(container, 7)
    pointerClick(closeButton(container), 7)
    fireEvent.pointerDown(closeButton(container), { pointerId: 8, pointerType: 'touch' })
    fireEvent.pointerUp(closeButton(container), { pointerId: 8, pointerType: 'touch' })
    pointerClick(closeButton(container), 8)
    expect(menuOpen(container)).toBe(false)
  })

  it('別のポインターの click は止めない(開いたタップとは別の操作)', () => {
    const { container } = render(() => <App />)
    touchOpen(container, 7)
    pointerClick(closeButton(container), 9)
    expect(menuOpen(container)).toBe(false)
  })

  it('キーボード・支援技術の click(押下なし)で開いたときは、次の「閉じる」で閉じる', () => {
    const { container } = render(() => <App />)
    openCaregiverMenu(container)
    fireEvent.click(closeButton(container))
    expect(menuOpen(container)).toBe(false)
  })

  it('開いたタップの click が止められても、タブの操作はそのまま効く', () => {
    const { container } = render(() => <App />)
    touchOpen(container, 7)
    pointerClick(closeButton(container), 7)
    selectCaregiverTab(container, 'スキャン')
    expect(
      Array.from(container.querySelectorAll('[role="tab"]')).find(
        (t) => t.getAttribute('aria-selected') === 'true',
      )?.textContent,
    ).toBe('スキャン')
  })
})

describe('Issue #113 / #115: パンくずの家アイコン・タイルのアイコン', () => {
  beforeEach(setupApp)
  afterEach(teardownApp)

  const homeCrumb = (c: HTMLElement) => c.querySelector('.screen-breadcrumb li') as HTMLElement

  it('ホームにいるとき、パンくず先頭「ホーム」に家アイコンが付き、読み上げの対象外。文字は「ホーム」のまま', () => {
    const { container } = render(() => <App />)
    const icon = homeCrumb(container).querySelector('svg.breadcrumb-home')
    expect(icon).not.toBeNull()
    expect(icon?.getAttribute('aria-hidden')).toBe('true')
    expect(homeCrumb(container).textContent).toBe('ホーム')
  })

  it('下位画面では、ホームへ戻るボタン(パンくず)に家アイコンが付く。現在地には付かない', () => {
    const { container } = render(() => <App />)
    tap(container, '快')
    const items = container.querySelectorAll('.screen-breadcrumb li')
    expect(items[0].querySelector('button.breadcrumb-link svg.breadcrumb-home')).not.toBeNull()
    expect(items[0].textContent).toBe('ホーム')
    expect(items[1].querySelector('svg.breadcrumb-home')).toBeNull()
  })

  it('ホームの全項目にアイコンが付く(モールスを含む)。aria-label と文字は変わらない', () => {
    window.localStorage.setItem('libra', JSON.stringify({ morseEnabled: true }))
    const { container } = render(() => <App />)
    const check = () => {
      for (const label of tileLabels(container)) {
        const t = tile(container, label)
        const icon = t.querySelector('svg.tile-icon')
        expect(icon, label).not.toBeNull()
        expect(icon?.getAttribute('aria-hidden'), label).toBe('true')
        expect(t.getAttribute('aria-label'), label).toBe(label)
      }
    }
    expect(tileLabels(container)).toContain('モールス')
    check()
    tap(container, 'はい')
    check()
  })

  it('下位画面では「戻る」にアイコンが付き、介助者が編集できるフレーズ項目には付かない', () => {
    const { container } = render(() => <App />)
    tap(container, '要望')
    expect(tile(container, '戻る').querySelector('svg.tile-icon')).not.toBeNull()
    const phraseLabels = tileLabels(container).filter((l) => l !== '戻る' && l !== '緊急')
    expect(phraseLabels.length).toBeGreaterThan(0)
    for (const label of phraseLabels) {
      expect(tile(container, label).querySelector('svg.tile-icon'), label).toBeNull()
    }
  })

  it('アイコンを付けても、選んだときの読み上げ・振動は変わらない', () => {
    window.localStorage.setItem('libra', JSON.stringify({ voiceMode: 'full' }))
    const { container } = render(() => <App />)
    tap(container, 'はい')
    expect(spoken()).toEqual(['はい。'])
    expect(vibrations().length).toBeGreaterThan(0)
  })
})
