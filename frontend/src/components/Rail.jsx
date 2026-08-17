// One bar per question, across the top of the deck.
//
// It replaces the thing a scrolling list gave away for free: where you are and how much
// is left. Fill = answered, hollow = not yet, and the tall bar is you. Click any bar to
// jump straight to that question.

const FILL = {
  answered: 'bg-neutral-900',
  running: 'bg-neutral-400',
  error: 'bg-neutral-500',
  waiting: 'bg-neutral-200',
}

export function railState(q, activeIdx) {
  if (q.status === 'answered') return 'answered'
  if (q.status === 'error') return 'error'
  if (q.status === 'answering' || activeIdx.has(q.idx + 1)) return 'running'
  return 'waiting'
}

export default function Rail({ questions, current, active = [], onJump }) {
  const activeIdx = new Set(active.map((a) => a.idx))

  return (
    <nav aria-label="Questions" className="flex h-3 items-start gap-px">
      {questions.map((q, i) => {
        const state = railState(q, activeIdx)
        const here = i === current
        return (
          <button
            key={q.id ?? i}
            onClick={() => onJump(i)}
            title={`Question ${i + 1}${state === 'answered' ? ' · answered' : ''}`}
            aria-label={`Go to question ${i + 1}`}
            aria-current={here ? 'true' : undefined}
            className="group h-3 min-w-[3px] flex-1 pt-0"
          >
            <span
              className={`block w-full rounded-full transition-all duration-200 ${FILL[state]}
                ${here ? 'h-3' : 'h-1 group-hover:h-2'}
                ${state === 'running' ? 'animate-pulse' : ''}`}
            />
          </button>
        )
      })}
    </nav>
  )
}
