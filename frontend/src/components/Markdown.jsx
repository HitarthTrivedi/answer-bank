// Answer markdown → rich UI. react-markdown never renders raw HTML (XSS-safe by
// construction); special fences are intercepted: mermaid → diagram, graphspec →
// server-rendered plot, verify → hidden (machine-check plumbing).
import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { GraphImage, MdCtx, Mermaid } from './figures'

function textOf(node) {
  if (node == null) return ''
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (node.props?.children) return textOf(node.props.children)
  return ''
}

function Pre({ children }) {
  const child = Array.isArray(children) ? children[0] : children
  const cls = child?.props?.className || ''
  const raw = textOf(child?.props?.children)
  if (cls.includes('language-mermaid')) return <Mermaid code={raw} />
  if (cls.includes('language-graphspec')) return <GraphImage spec={raw} />
  if (cls.includes('language-verify')) return null
  return <pre>{children}</pre>
}

export default function Markdown({ content, answerId }) {
  return (
    <MdCtx.Provider value={{ answerId }}>
      <div className="answer-md">
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex, [rehypeHighlight, { ignoreMissing: true, detect: false }]]}
          components={{ pre: Pre }}
        >
          {content}
        </ReactMarkdown>
      </div>
    </MdCtx.Provider>
  )
}
