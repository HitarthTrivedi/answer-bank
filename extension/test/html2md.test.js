// node --test test/html2md.test.js   (needs: npm i -D jsdom)
//
// The converter is the only part of the extension that decides answer *quality*, and
// it's aimed at DOM shapes owned by three companies who redesign without warning. These
// fixtures are lifted from what chatgpt.com / claude.ai / gemini actually render, so a
// selector refresh can be checked against them before shipping.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<body></body>')
globalThis.Node = dom.window.Node
globalThis.self = globalThis
new Function(readFileSync(new URL('../content/html2md.js', import.meta.url), 'utf8'))()
const { htmlToMarkdown } = globalThis

const frag = (html) => {
  const d = new JSDOM(`<div id="r">${html}</div>`)
  globalThis.Node = d.window.Node
  return d.window.document.getElementById('r')
}

test('keeps the original LaTeX instead of the rendered glyphs', () => {
  // KaTeX renders BOTH an mathml annotation (the source) and visual spans. Scraping the
  // visual half is what turns an integral into unicode soup.
  const md = htmlToMarkdown(frag(`
    <p>The area is
      <span class="katex"><span class="katex-mathml"><math><semantics>
        <annotation encoding="application/x-tex">\\int_0^1 x^2\\,dx</annotation>
      </semantics></math></span><span class="katex-html">∫01x2dx</span></span>
      exactly.</p>`))
  assert.match(md, /\$\\int_0\^1 x\^2\\,dx\$/)
  assert.doesNotMatch(md, /∫01x2dx/)
})

test('display math becomes a $$ block', () => {
  const md = htmlToMarkdown(frag(`
    <span class="katex-display"><span class="katex"><span class="katex-mathml"><math><semantics>
      <annotation encoding="application/x-tex">E = mc^2</annotation>
    </semantics></math></span></span></span>`))
  assert.match(md, /\$\$E = mc\^2\$\$/)
})

test('code blocks keep their language tag', () => {
  const md = htmlToMarkdown(frag(
    `<pre><div class="flex">python</div><code class="language-python">def f(x):\n    return x * 2</code></pre>`))
  assert.match(md, /```python\n/)
  assert.match(md, /return x \* 2/)
  assert.match(md, /\n```/)
})

test('tables survive as markdown tables', () => {
  const md = htmlToMarkdown(frag(
    `<table><thead><tr><th>Layer</th><th>Unit</th></tr></thead>
     <tbody><tr><td>Network</td><td>Packet</td></tr></tbody></table>`))
  const lines = md.trim().split('\n')
  assert.equal(lines[0], '| Layer | Unit |')
  assert.equal(lines[1], '| --- | --- |')
  assert.equal(lines[2], '| Network | Packet |')
})

test('nested lists keep their indentation', () => {
  const md = htmlToMarkdown(frag(
    `<ul><li>Outer<ul><li>Inner</li></ul></li><li>Second</li></ul>`))
  assert.match(md, /^- Outer$/m)
  assert.match(md, /^ {2}- Inner$/m)
  assert.match(md, /^- Second$/m)
})

test('ordered lists are numbered', () => {
  const md = htmlToMarkdown(frag(`<ol><li>First</li><li>Second</li></ol>`))
  assert.match(md, /^1\. First$/m)
  assert.match(md, /^2\. Second$/m)
})

test('headings, bold and inline code carry over', () => {
  const md = htmlToMarkdown(frag(
    `<h2>Approach</h2><p>Use <strong>dynamic programming</strong> with <code>dp[i]</code>.</p>`))
  assert.match(md, /^## Approach$/m)
  assert.match(md, /\*\*dynamic programming\*\*/)
  assert.match(md, /`dp\[i\]`/)
})

test('copy buttons and other chrome are dropped', () => {
  const md = htmlToMarkdown(frag(
    `<div><button data-testid="copy-turn-action-button">Copy</button><p>Real answer.</p>
     <span class="sr-only">screen reader noise</span></div>`))
  assert.match(md, /Real answer\./)
  assert.doesNotMatch(md, /Copy/)
  assert.doesNotMatch(md, /screen reader noise/)
})

test('the FINAL: line the verifier depends on is preserved', () => {
  const md = htmlToMarkdown(frag(`<p>FINAL: 48 m/s</p><pre><code class="language-verify">12 * 4</code></pre>`))
  assert.match(md, /FINAL: 48 m\/s/)
  assert.match(md, /```verify\n12 \* 4\n```/)
})

test('the live DOM is never mutated', () => {
  const el = frag(`<ul><li>A<ul><li>B</li></ul></li></ul>`)
  const before = el.innerHTML
  htmlToMarkdown(el)
  assert.equal(el.innerHTML, before)
})
