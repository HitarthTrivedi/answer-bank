// Rendered AI answer (DOM) -> the markdown dialect Prism's exporter understands.
//
// This is the quality-critical piece. A naive innerText scrape loses exactly the things
// that make an answer document worth paying for: LaTeX becomes unicode soup, code loses
// its fences and language, tables collapse into runs of words.
//
// The important trick is KaTeX/MathJax: both keep the ORIGINAL LaTeX inside the DOM
// (<annotation encoding="application/x-tex">). We read that and throw away the rendered
// glyphs entirely, so $$\int_0^1 x^2 dx$$ survives the round trip intact.

const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'BUTTON', 'SVG', 'PATH', 'TEXTAREA', 'SELECT', 'INPUT',
])

// toolbars/badges the sites bolt onto their own messages
const SKIP_SELECTORS = [
  '[data-testid*="copy"]', '[aria-label*="Copy"]', '[class*="sr-only"]',
  '.absolute', 'mat-icon', '[role="toolbar"]', '[data-state="closed"] > svg',
]

function isSkippable(el) {
  if (SKIP_TAGS.has(el.tagName.toUpperCase())) return true
  if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return true
  for (const sel of SKIP_SELECTORS) {
    try { if (el.matches(sel)) return true } catch { /* bad selector on this engine */ }
  }
  return false
}

// ---------------------------------------------------------------- math

function latexOf(el) {
  const ann = el.querySelector('annotation[encoding="application/x-tex"]')
  if (ann) return ann.textContent.trim()
  if (el.dataset && el.dataset.latex) return el.dataset.latex.trim()
  const mjx = el.querySelector('[data-latex]')
  return mjx ? mjx.getAttribute('data-latex').trim() : ''
}

function mathNode(el) {
  // returns markdown for a math element, or null if this isn't one
  const isKatex = el.classList && (el.classList.contains('katex') || el.classList.contains('katex-display'))
  const isMathJax = el.tagName.toLowerCase() === 'mjx-container'
  if (!isKatex && !isMathJax) return null
  const tex = latexOf(el)
  if (!tex) return null
  const display =
    (el.classList && el.classList.contains('katex-display')) ||
    el.closest('.katex-display') !== null ||
    el.getAttribute('display') === 'true'
  return display ? `\n\n$$${tex}$$\n\n` : `$${tex}$`
}

// ---------------------------------------------------------------- code

function langOf(codeEl) {
  const cls = (codeEl && codeEl.className) || ''
  const m = /(?:language|lang)-([\w+#-]+)/.exec(cls)
  if (m) return m[1]
  // ChatGPT puts the language in a header div above the <code>
  const pre = codeEl && codeEl.closest('pre')
  const header = pre && pre.querySelector('div')
  const t = header && header.textContent.trim().toLowerCase()
  if (t && /^[\w+#-]{1,20}$/.test(t)) return t
  return ''
}

// Gemini renders every code block under a "Code snippet" header with no language class
// in the DOM, so a ```mermaid diagram would arrive as a bare ``` block and the deck
// would show a diagram as source code. The content gives the language away.
const MERMAID_START = /^\s*(?:%%\{.*?\}%%\s*)?(?:(?:flowchart|graph)\s+(?:TD|TB|BT|LR|RL)\b|sequenceDiagram|erDiagram|classDiagram|stateDiagram(?:-v2)?|gantt|pie|mindmap|journey|timeline)\b/i
const GRAPHSPEC_HINT = /^\s*\{[\s\S]*"(?:expressions|xrange)"/

function sniffLang(body) {
  if (MERMAID_START.test(body)) return 'mermaid'
  if (GRAPHSPEC_HINT.test(body)) return 'graphspec'
  return ''
}

function codeBlock(pre) {
  const codeEl = pre.querySelector('code') || pre
  const body = codeEl.textContent.replace(/\n+$/, '')
  const lang = langOf(codeEl) || sniffLang(body)
  return `\n\n\`\`\`${lang}\n${body}\n\`\`\`\n\n`
}

// ---------------------------------------------------------------- tables

function tableMd(table) {
  const rows = [...table.querySelectorAll('tr')].map((tr) =>
    [...tr.querySelectorAll('th,td')].map((c) => inline(c).replace(/\|/g, '\\|').replace(/\n+/g, ' ').trim()),
  ).filter((r) => r.length)
  if (!rows.length) return ''
  const width = Math.max(...rows.map((r) => r.length))
  const pad = (r) => { while (r.length < width) r.push(''); return r }
  const head = pad(rows[0])
  const rest = rows.slice(1).map(pad)
  const lines = [
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...rest.map((r) => `| ${r.join(' | ')} |`),
  ]
  return `\n\n${lines.join('\n')}\n\n`
}

// ---------------------------------------------------------------- lists

function listMd(list, depth) {
  const ordered = list.tagName.toUpperCase() === 'OL'
  const start = parseInt(list.getAttribute('start') || '1', 10)
  const indent = '  '.repeat(depth)
  const out = []
  let n = start
  for (const li of [...list.children].filter((c) => c.tagName.toUpperCase() === 'LI')) {
    const marker = ordered ? `${n++}. ` : '- '
    // nested lists render themselves; pull them out so they don't land inline
    const nested = []
    for (const child of [...li.children]) {
      const tag = child.tagName.toUpperCase()
      if (tag === 'UL' || tag === 'OL') {
        nested.push(listMd(child, depth + 1))
        child.setAttribute('data-ab-consumed', '1')
      }
    }
    const body = block(li).trim().replace(/\n{2,}/g, '\n')
    const first = body.split('\n')
    out.push(`${indent}${marker}${first[0] || ''}`)
    for (const extra of first.slice(1)) out.push(`${indent}  ${extra}`)
    for (const nest of nested) out.push(nest.replace(/^\n+|\n+$/g, ''))
  }
  return `\n\n${out.join('\n')}\n\n`
}

// ---------------------------------------------------------------- walkers

function inline(node) {
  return block(node).replace(/\n{2,}/g, ' ').trim()
}

function block(node) {
  let out = ''
  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      out += child.textContent.replace(/\s+/g, ' ')
      continue
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue
    const el = child
    if (el.getAttribute('data-ab-consumed')) continue
    if (isSkippable(el)) continue

    const math = mathNode(el)
    if (math !== null) { out += math; continue }

    const tag = el.tagName.toUpperCase()

    if (tag === 'IMG') {

      // a generated diagram/plot: keep the link. The URL is the site's own (often

      // expiring), so the chat link on the answer is what the student relies on.

      const src = el.currentSrc || el.getAttribute('src') || ''

      if (/^https?:/.test(src) && !/avatar|icon|emoji|logo/i.test(src + (el.alt || '')) &&

          (el.naturalWidth || el.width || 200) >= 120) {

        return `\n\n![${(el.alt || 'figure').replace(/[\[\]]/g, '')}](${src})\n\n`

      }

      return ''

    }
    switch (tag) {
      case 'PRE': out += codeBlock(el); break
      case 'CODE': out += `\`${el.textContent}\``; break
      case 'TABLE': out += tableMd(el); break
      case 'UL': case 'OL': out += listMd(el, 0); break
      case 'BR': out += '\n'; break
      case 'HR': out += '\n\n---\n\n'; break
      case 'H1': case 'H2': case 'H3': case 'H4': case 'H5': case 'H6':
        out += `\n\n${'#'.repeat(+tag[1])} ${inline(el)}\n\n`; break
      case 'STRONG': case 'B': {
        const t = inline(el); out += t ? `**${t}**` : ''; break
      }
      case 'EM': case 'I': {
        const t = inline(el); out += t ? `*${t}*` : ''; break
      }
      case 'A': {
        const t = inline(el), href = el.getAttribute('href') || ''
        out += href && t ? `[${t}](${href})` : t
        break
      }
      case 'BLOCKQUOTE':
        out += `\n\n${block(el).trim().split('\n').map((l) => `> ${l}`).join('\n')}\n\n`; break
      case 'P': case 'DIV': case 'SECTION': case 'ARTICLE': case 'LI':
        out += `\n\n${block(el).trim()}\n\n`; break
      default:
        out += block(el)
    }
  }
  return out
}

function htmlToMarkdown(root) {
  if (!root) return ''
  const clone = root.cloneNode(true)  // listMd tags consumed nodes — never touch the live DOM
  return block(clone)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s+|\s+$/g, '')
}

// exposed on the isolated-world global so driver.js can use it
self.htmlToMarkdown = htmlToMarkdown
