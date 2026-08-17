// Where you are in the bank, in two rows.
//
// The split is the useful part. Questions built on a diagram, graph, table or image are
// the ones worth checking — a misread figure produces a confident wrong answer rather
// than an obvious blank — so they get their own row instead of being scattered through
// thirty theory questions. Fill = answered, hollow = not yet, tall bar = you. Click to jump.

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

  const visual = []
  const theory = []
  questions.forEach((q, i) => (q.visual ? visual : theory).push({ q, i }))

  // A bank with no figures shouldn't grow a "Theory" label it can't be contrasted with.
  if (!visual.length || !theory.length) {
    return (
      <div className="py-1">
        <Row items={questions.map((q, i) => ({ q, i }))}
             current={current} activeIdx={activeIdx} onJump={onJump} />
      </div>
    )
  }

  return (
    <div className="space-y-1 py-1">
      <Group label="Diagrams & figures" items={visual}
             current={current} activeIdx={activeIdx} onJump={onJump} />
      <Group label="Theory" items={theory}
             current={current} activeIdx={activeIdx} onJump={onJump} />
    </div>
  )
}

function Group({ label, items, current, activeIdx, onJump }) {
  const done = items.filter(({ q }) => q.status === 'answered').length
  const here = items.some(({ i }) => i === current)

  return (
    <div className="flex items-center gap-3">
      <span
        className={`w-32 shrink-0 truncate text-right text-[10px] uppercase tracking-[0.12em] transition
                    ${here ? 'text-neutral-600' : 'text-neutral-300'}`}
        title={`${done} of ${items.length} answered`}
      >
        {label}
      </span>
      <Row items={items} current={current} activeIdx={activeIdx} onJump={onJump} />
      <span className="w-9 shrink-0 text-[10px] tabular-nums text-neutral-300">
        {done}/{items.length}
      </span>
    </div>
  )
}

function Row({ items, current, activeIdx, onJump }) {
  return (
    <nav aria-label="Questions" className="flex h-3 flex-1 items-start gap-px">
      {items.map(({ q, i }) => {
        const state = railState(q, activeIdx)
        const here = i === current
        return (
          <button
            key={q.id ?? i}
            onClick={() => onJump(i)}
            title={`Question ${i + 1}${state === 'answered' ? ' · answered' : ''}`}
            aria-label={`Go to question ${i + 1}`}
            aria-current={here ? 'true' : undefined}
            className="group h-3 min-w-[3px] flex-1"
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
