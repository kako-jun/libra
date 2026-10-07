// Issue #46 (S4): JSX 本文テキストの句読点規則を、描画結果とソースの静的走査の両方で検査する。
//
// デシジョンテーブル
//   対象                                         | 検査
//   PhraseEditor の注意書き(.phrase-note)         | 描画して、全て「。」で終わる(痛い場所の説明・「痛いです」なしの注意)
//   PhraseEditor の警告・理由の行(.caregiver-status)| 描画して、全て「。」で終わる(項目数超過・表示されない理由)
//   WAKE_LOCK_LABELS / OFFLINE_READY_LABELS 状態値 | 値が語 → 句読点なし / 値が文(「 — 」を含む) → 「。」で終わる
//   JSX の <p>/<li> の本文テキスト(App/PhraseEditor)| 最後が文字なら「。」で終わる(ラベル用クラスは除く)
//   JSX の <button>/<h2>/<h3> のテキスト            | 句読点で終わらない
//   変異(「。」を消す/状態値を文にして「。」なし)   | 上の検査が落ちること(下の「変異」テストで検出器自体を確認)
import { describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@solidjs/testing-library'
import ts from 'typescript'
import appSrc from '../App.tsx?raw'
import phraseEditorSrc from '../PhraseEditor.tsx?raw'
import PhraseEditor from '../PhraseEditor'
import { OFFLINE_READY_LABELS, WAKE_LOCK_LABELS } from '../App'
import { DEFAULT_SETTINGS, type Settings } from '../lib/settings'

const KUTEN_END = /。$/
const PUNCT_END = /[。、．，.,！!？?]$/
const HAS_JAPANESE = /[぀-ヿ一-鿿]/

/** 「項目名: 値」の値が語なら句読点なし、文(「 — 」で指示が続く)なら「。」で終わる、の違反を返す */
export function stateValueViolations(labels: Record<string, string>): string[] {
  const out: string[] = []
  for (const [key, label] of Object.entries(labels)) {
    const value = label.split(': ').slice(1).join(': ')
    const isSentence = value.includes(' — ')
    if (isSentence && !KUTEN_END.test(value)) out.push(`${key}: 文なのに句点がない (${label})`)
    if (!isSentence && PUNCT_END.test(value)) out.push(`${key}: 語なのに句読点がある (${label})`)
  }
  return out
}

const BODY_TAGS = new Set(['p', 'li'])
const LABEL_TAGS = new Set(['button', 'h2', 'h3'])
/** p/li でも見出し・ラベルとして使うクラス(句読点なし) */
const LABEL_CLASS = /label/

interface JsxFinding {
  file: string
  tag: string
  text: string
  kind: 'body' | 'label'
}

/** ソースの JSX を走査し、<p>/<li> と <button>/<h2>/<h3> の最後の文字列の終端を集める */
export function scanJsx(file: string, source: string): JsxFinding[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const findings: JsxFinding[] = []
  const classOf = (el: ts.JsxElement): string => {
    for (const attr of el.openingElement.attributes.properties) {
      if (ts.isJsxAttribute(attr) && attr.name.getText(sf) === 'class') {
        const init = attr.initializer
        if (init && ts.isStringLiteral(init)) return init.text
      }
    }
    return ''
  }
  const lastText = (el: ts.JsxElement): string | null => {
    const kids = el.children.filter((c) => !(ts.isJsxText(c) && c.getText(sf).trim() === ''))
    const last = kids[kids.length - 1]
    if (!last) return null
    if (ts.isJsxText(last)) return last.getText(sf).replace(/\s+/g, ' ').trim()
    if (
      ts.isJsxExpression(last) &&
      last.expression &&
      (ts.isStringLiteral(last.expression) || ts.isNoSubstitutionTemplateLiteral(last.expression))
    ) {
      return last.expression.text.trim()
    }
    return null // {式}・子要素で終わるものは対象外
  }
  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node)) {
      const tag = node.openingElement.tagName.getText(sf)
      const text = lastText(node)
      if (text !== null && HAS_JAPANESE.test(text)) {
        if (BODY_TAGS.has(tag)) {
          findings.push({
            file,
            tag,
            text,
            kind: LABEL_CLASS.test(classOf(node)) ? 'label' : 'body',
          })
        } else if (LABEL_TAGS.has(tag)) {
          findings.push({ file, tag, text, kind: 'label' })
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return findings
}

export function jsxViolations(findings: JsxFinding[]): string[] {
  return findings
    .filter((f) => (f.kind === 'body' ? !KUTEN_END.test(f.text) : PUNCT_END.test(f.text)))
    .map((f) => `${f.file} <${f.tag}> ${f.kind}: 「${f.text}」`)
}

const editorSettings = (phrases: Settings['phrases']): Settings => ({
  ...DEFAULT_SETTINGS,
  phrases,
})

describe('Issue #46 PhraseEditor の注意書きは全て句点で終わる(描画)', () => {
  const seven = Array.from({ length: 7 }, (_, i) => ({
    id: `c${i}`,
    label: `項目${i}`,
    text: `項目${i}です。`,
  }))

  it('痛い場所: 説明・「痛いです」なしの注意・項目数超過の警告・表示されない理由が全て「。」', () => {
    const { container } = render(() => (
      <PhraseEditor
        settings={editorSettings({
          painLocation: [
            ...seven,
            { id: 'nopain', label: '手', text: 'その他の場所です。' }, // 「痛いです」なし → 注意
            { id: 'empty', label: '', text: '' }, // 空 → 表示されない理由
            { id: 'reserved', label: 'はい。', text: 'x。' }, // 予約ラベル → 理由
          ],
        })}
        updateSettings={() => {}}
      />
    ))
    fireEvent.click(
      Array.from(container.querySelectorAll('button')).find((b) => b.textContent === '痛い場所')!,
    )
    const lines = Array.from(container.querySelectorAll('.phrase-note, .caregiver-status')).map(
      (e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim(),
    )
    // 説明 + 注意 + 警告 + 理由2件
    expect(lines.length).toBeGreaterThanOrEqual(5)
    for (const l of lines) expect(KUTEN_END.test(l), l).toBe(true)
    // 新しい composePainText の挙動(句点の前に入る)と注意書きが矛盾しない
    expect(lines.join('\n')).toContain('句点で終わる')
    cleanup()
  })
})

describe('Issue #46 状態値の規則(WAKE/OFFLINE)', () => {
  it('現行の状態値は規則に合う(語は句読点なし・文は句点あり)', () => {
    expect(stateValueViolations(WAKE_LOCK_LABELS)).toEqual([])
    expect(stateValueViolations(OFFLINE_READY_LABELS)).toEqual([])
  })

  it('変異: オフライン準備の値を文にして句点を付けないと検出される', () => {
    const mutated = {
      ...OFFLINE_READY_LABELS,
      'not-ready': 'オフライン準備: 未完了 — 再読み込みしてください',
    }
    expect(stateValueViolations(mutated).length).toBe(1)
    const fixed = {
      ...OFFLINE_READY_LABELS,
      'not-ready': 'オフライン準備: 未完了 — 再読み込みしてください。',
    }
    expect(stateValueViolations(fixed)).toEqual([])
  })

  it('変異: 語の値に句点を付けても検出される', () => {
    expect(stateValueViolations({ ready: 'オフライン準備: 完了。' }).length).toBe(1)
  })
})

describe('Issue #46 JSX テキストの静的走査(本文は句点・ラベルは句読点なし)', () => {
  const findings = [...scanJsx('App.tsx', appSrc), ...scanJsx('PhraseEditor.tsx', phraseEditorSrc)]

  it('走査が本文・ラベルの両方を実際に拾っている(空振りでない)', () => {
    expect(findings.filter((f) => f.kind === 'body').length).toBeGreaterThanOrEqual(10)
    expect(findings.filter((f) => f.kind === 'label').length).toBeGreaterThanOrEqual(5)
    // モールス凡例・PhraseEditor の注意書きを含む
    expect(findings.some((f) => f.tag === 'li' && f.text.includes('スキャンへ戻る'))).toBe(true)
    expect(findings.some((f) => f.tag === 'p' && f.text.includes('末尾に（とても）'))).toBe(true)
  })

  it('現行ソースに違反がない', () => {
    expect(jsxViolations(findings)).toEqual([])
  })

  it('変異: PhraseEditor の注意書き(:79 と :142 相当)の句点を消すと検出される', () => {
    const noKuten = phraseEditorSrc
      .replace('ここで編集できるのは下の定型文だけです。', 'ここで編集できるのは下の定型文だけです')
      .replace(
        '（句点で終わる文は句点の前、句点がない文は末尾）。',
        '（句点で終わる文は句点の前、句点がない文は末尾）',
      )
    expect(noKuten).not.toBe(phraseEditorSrc)
    const v = jsxViolations(scanJsx('PhraseEditor.tsx', noKuten))
    expect(v.length).toBeGreaterThanOrEqual(2)
  })

  it('変異: ボタンのラベルに句点を付けると検出される', () => {
    const mutated = phraseEditorSrc.replace('フレーズを追加', 'フレーズを追加。')
    expect(jsxViolations(scanJsx('PhraseEditor.tsx', mutated)).length).toBe(1)
  })
})
