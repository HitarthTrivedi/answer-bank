import { Link } from 'react-router-dom'
import { useAuth } from '../auth'
import Wordmark from '../components/Wordmark'
import { Eyebrow } from '../components/ui'

// Three claims. A student deciding whether to upload a paper needs to know what goes in,
// what comes out, and what it costs — everything else is for the README.
const POINTS = [
  ['One question, one screen',
   'Each question is answered on its own, in its own fresh chat. Dumping forty questions ' +
   'into a chatbot ruins the last twenty; this way the final answer is as good as the first.'],
  ['It reads the paper, figures and all',
   'Graphs, circuits, tables, scanned pages. Your AI is handed the original file and asked ' +
   'for one question at a time, so it reads the picture the question actually refers to.'],
  ['Your own AI does the work',
   'It runs in the ChatGPT, Claude or Gemini tab you are already signed into — spread across ' +
   'all of them so none runs out. Answering is free; the finished document is ₹20.'],
]

export default function Landing() {
  const { user } = useAuth()
  const cta = user ? 'Open your banks' : 'Start free'

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex h-16 w-full max-w-3xl items-center justify-between px-6">
        <Wordmark tagline />
        <Link to={user ? '/app' : '/auth'} className="text-[13px] text-neutral-500 hover:text-neutral-900">
          {user ? 'Dashboard' : 'Sign in'}
        </Link>
      </header>

      <main className="mx-auto w-full max-w-3xl px-6">
        <section className="py-24 sm:py-32">
          <Eyebrow>Question bank in · answer document out</Eyebrow>
          <h1 className="mt-6 max-w-2xl text-[38px] font-medium leading-[1.1] tracking-[-0.025em] sm:text-[52px]">
            Answer the whole
            <br />
            question bank.
          </h1>
          <p className="mt-7 max-w-lg text-[17px] leading-relaxed text-neutral-500">
            Upload your paper in any format. Prism splits it into questions, sends each one
            to whichever AI you're signed into handles it best, and hands the answers back
            one screen at a time.
          </p>
          <Link
            to={user ? '/app' : '/auth'}
            className="mt-10 inline-flex h-12 items-center rounded-lg bg-neutral-900 px-7 text-[15px] font-medium text-white transition hover:bg-neutral-700"
          >
            {cta}
          </Link>
          <p className="mt-4 text-[13px] text-neutral-400">
            No API keys. Runs on the AI subscriptions you already have.
          </p>
        </section>

        <section className="border-t border-neutral-200">
          {POINTS.map(([title, body], i) => (
            <div key={title} className="grid gap-2 border-b border-neutral-200 py-10 sm:grid-cols-[3rem_1fr] sm:gap-8">
              <span className="text-[13px] tabular-nums text-neutral-300">0{i + 1}</span>
              <div>
                <h2 className="text-[17px] font-medium tracking-[-0.01em]">{title}</h2>
                <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-neutral-500">{body}</p>
              </div>
            </div>
          ))}
        </section>

        <footer className="py-14 text-[12px] text-neutral-400">
          Answers are AI-generated study aids — read them before you rely on them.
        </footer>
      </main>
    </div>
  )
}
