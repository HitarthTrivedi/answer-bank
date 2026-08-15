import { Link } from 'react-router-dom'
import { useAuth } from '../auth'
import Wordmark from '../components/Wordmark'

const FEATURES = [
  ['One question at a time', 'Dumping 40 questions into a chatbot ruins answers 25–40. Prism solves each question individually, so the last answer is as strong as the first.'],
  ['Routed to the right AI', 'A routing agent classifies every question — numericals, code, graphs, diagrams, theory — and sends it to the model that is best at that type.'],
  ['Verified numericals', 'Numerical answers are re-computed with a symbolic math engine. If the working doesn\'t match the final value, you see a warning, not a wrong answer.'],
  ['Real figures, not ASCII', 'Graphs are rendered as actual plots, diagrams as clean flowcharts, math as proper notation — on screen and in the exported document.'],
  ['Explain-me mode', 'Every answer has a beginner\'s explanation one click away — plain words, small steps, a way to remember it.'],
  ['Works with zero API keys', 'No keys? Assist mode crafts the perfect per-question prompt for your own ChatGPT/Claude tab and formats whatever you paste back.'],
]

export default function Landing() {
  const { user } = useAuth()
  return (
    <div className="min-h-screen">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div>
          <Wordmark size="lg" tagline />
        </div>
        <Link
          to={user ? '/app' : '/auth'}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium hover:bg-indigo-500"
        >
          {user ? 'Open dashboard' : 'Sign in'}
        </Link>
      </nav>

      <header className="mx-auto max-w-4xl px-6 pb-16 pt-20 text-center">
        <p className="mb-4 text-sm font-medium uppercase tracking-widest text-indigo-400">
          For students drowning in question banks
        </p>
        <h1 className="text-4xl font-bold leading-tight sm:text-5xl">
          Question bank in.
          <br />
          <span className="text-indigo-400">Exam-ready answer doc out.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-400">
          Upload a question bank from any source. Prism answers it one question at a
          time — each routed to the AI best suited for it — then hands you a polished
          document with working, code, graphs and diagrams.
        </p>
        <Link
          to={user ? '/app' : '/auth'}
          className="mt-8 inline-block rounded-xl bg-indigo-600 px-8 py-3 text-base font-semibold hover:bg-indigo-500"
        >
          Start free
        </Link>
        <p className="mt-3 text-xs text-slate-500">No API keys required · works with your own AI subscriptions</p>
      </header>

      <section className="mx-auto grid max-w-6xl gap-4 px-6 pb-24 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map(([title, body]) => (
          <div key={title} className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
            <h3 className="mb-2 font-semibold text-slate-100">{title}</h3>
            <p className="text-sm leading-relaxed text-slate-400">{body}</p>
          </div>
        ))}
      </section>

      <footer className="border-t border-slate-800 py-6 text-center text-xs text-slate-600">
        Prism · answers are AI-generated study aids — verify before you rely on them
      </footer>
    </div>
  )
}
