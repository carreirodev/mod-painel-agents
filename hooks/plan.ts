// The plans Claude reports through the plan_progress tool: what a call does to a
// plan, the plan-mode markdown read as one, and where a plan stands. Pure: no $.
// Ported from plan-progress 1.4.2 (hooks/register.tsx), its agent strips left out

import type { Plan, PlanStage, PlanState, PlanStep, StepStatus } from '../types'

export const TOOL_NAME = 'plan_progress'
export const TOOL = `mcp__agents-panel__${TOOL_NAME}`

// The bar an approved plan-mode plan lands on; a revised plan updates it instead of opening a second one
export const PLAN_ID = 'plan'

// Finished plans kept, the oldest dropped first: as many as the finished subagents the pane keeps
const KEEP_FINISHED_PLANS = 30

export const RULES = `# Progress bars
Tasks needing more than ~3 edits or commands get a bar via ${TOOL}: create it once with the full breakdown (2-7 stages of steps {title}, or kind "todo" for one flat list; titles of at most 4 words, in the user's language; the first open step becomes active), then move it with short calls: {id, next:true} when the active step is finished, or {id, done:[...], active:"..."}, {id, failed:"...", note}. When the plan changes, resend stages under the same id and title; steps sent without a status keep their done by title. Send state "needs_input" with a note before asking the user to decide. Never describe the bars to the user.`

const STATUSES: StepStatus[] = ['pending', 'active', 'done', 'error', 'skipped']

// Substeps are left out: the pane never draws them and short ops cannot reach them
const STEP_SCHEMA = {
  type: 'object',
  required: ['title'],
  properties: {
    title: { type: 'string' },
    status: { enum: STATUSES, description: 'Default pending' },
  },
}

export const TOOL_SPEC = {
  name: TOOL_NAME,
  description:
    'Live progress plan in the agents panel, one per id. Create with title + stages; update with short ops (next, done, active, failed) or state.',
  isDeferred: false,
  inputSchema: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', description: 'Bar id; reuse it for updates' },
      title: { type: 'string' },
      kind: { enum: ['plan', 'todo'] },
      stages: {
        type: 'array',
        description: 'Full breakdown: when creating, or resent under the same id when the plan changes',
        items: {
          type: 'object',
          required: ['name', 'steps'],
          properties: { name: { type: 'string' }, steps: { type: 'array', items: STEP_SCHEMA } },
        },
      },
      next: { type: 'boolean', description: 'Active step finished, start the next one' },
      done: { type: 'array', items: { type: 'string' }, description: 'Step titles now finished' },
      active: { type: 'string', description: 'Step title now in progress' },
      failed: { type: 'string', description: 'Step title that failed' },
      state: { enum: ['running', 'needs_input', 'error', 'done'] },
      note: { type: 'string', description: 'One line for needs_input or error' },
    },
  },
} as const

export type Raw = Readonly<Record<string, unknown>>

// One line of at most max characters. Control characters go first: an ESC or a
// C1 code would reach the terminal as a command, and U+FFFE/U+FFFF are no text.
// The cut drops half a character left at the edge (an emoji is two UTF-16 units)
export const str = (v: unknown, max = 120) =>
  typeof v === 'string'
    ? v
        .replace(/\s+/g, ' ')
        .replace(/[\u0000-\u001F\u007F-\u009F￾￿]/g, '')
        .trim()
        .slice(0, max)
        .replace(/[\uD800-\uDBFF]$/, '')
        .trimEnd()
    : ''

const statusOf = (v: unknown): StepStatus => STATUSES.find(s => s === v) ?? 'pending'
const objects = (v: unknown): Raw[] =>
  Array.isArray(v) ? v.filter((x): x is Raw => typeof x === 'object' && x !== null) : []
export const isFinished = (s: StepStatus) => s === 'done' || s === 'skipped'
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
const stepsOf = (stages: readonly PlanStage[]) => stages.flatMap(s => s.steps)

// "Corrigir login!" -> "corrigir-login"; '' for an id of emoji or punctuation alone
export const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-/, '')
    .slice(0, 40)
    .replace(/[\uD800-\uDBFF]$/, '')
    // after the cut, which can end on a separator
    .replace(/-$/, '')

// Short updates: {next:true}, {done:[titles]}, {active:title}, {failed:title}
// against the stored plan; titles it cannot find come back in missing, so the
// call is refused instead of passing as a success
function applyOps(stages: PlanStage[], input: Raw, now: number): { stages: PlanStage[]; missing: string[] } {
  const next = stages.map(s => ({ ...s, steps: s.steps.map(st => ({ ...st })) }))
  const steps = stepsOf(next)
  const missing: string[] = []
  // a step finishing now remembers when, for the time it shows
  const finish = (st: PlanStep) => {
    if (!isFinished(st.status)) Object.assign(st, { status: 'done', doneAt: now })
  }
  // a step opened again forgets when it was finished, so it shows no stale time
  const reopen = (st: PlanStep, to: StepStatus) => {
    st.status = to
    delete st.doneAt
  }
  // a title used twice means the one still open
  const find = (title: string) => {
    const found =
      steps.find(st => same(st.title, title) && !isFinished(st.status)) ?? steps.find(st => same(st.title, title))
    if (!found) missing.push(title)
    return found
  }
  if (input.next === true) {
    const activeAt = steps.findIndex(st => st.status === 'active')
    const at = activeAt >= 0 ? activeAt : steps.findIndex(st => !isFinished(st.status))
    const cur = steps[at]
    if (cur) finish(cur)
    // past the last step, work goes back to one left open earlier; a call that
    // names the new step itself picks it, so a step jumped over is not finished
    const following = steps.slice(at + 1).find(st => st.status === 'pending') ?? steps.find(st => st.status === 'pending')
    if (following && typeof input.active !== 'string') following.status = 'active'
  }
  let lastDone = -1
  for (const t of Array.isArray(input.done) ? input.done : []) {
    const st = typeof t === 'string' ? find(t) : undefined
    if (st?.status === 'active') lastDone = steps.indexOf(st)
    if (st) finish(st)
  }
  // finishing the step in progress moves on, as next does, unless the call names the new one itself
  if (lastDone >= 0 && typeof input.active !== 'string' && !steps.some(st => st.status === 'active')) {
    const following =
      steps.slice(lastDone + 1).find(st => st.status === 'pending') ?? steps.find(st => st.status === 'pending')
    if (following) following.status = 'active'
  }
  const active = typeof input.active === 'string' ? find(input.active) : undefined
  if (active) {
    const at = steps.indexOf(active)
    steps.forEach((st, i) => {
      if (st.status === 'active' && i !== at) {
        if (i < at) finish(st)
        else st.status = 'pending'
      }
    })
    reopen(active, 'active')
  }
  const failed = typeof input.failed === 'string' ? find(input.failed) : undefined
  if (failed) reopen(failed, 'error')

  return { stages: next, missing }
}

// The plan a call makes of the stored one (prev), or the refusal for a call
// that names steps the plan does not have. Who made and moves it is the caller's
export function normalize(input: Raw, prev: Plan | null, now: number, id: string): Plan | string {
  const sent: PlanStage[] = objects(input.stages)
    .map(s => ({
      name: str(s.name, 80) || 'Stage',
      steps: objects(s.steps).map(st => ({
        title: str(st.title) || 'Step',
        status: statusOf(st.status),
        substeps: objects(st.substeps).map(sub => ({ title: str(sub.title) || '…', status: statusOf(sub.status) })),
      })),
    }))
    .filter(s => s.steps.length > 0)
  const isPartial = sent.length === 0 && prev !== null
  // the next task under a finished plan's id carries nothing of the last one over; the same plan grown by a step does
  const was = prev && !isPartial && isNextTask(prev, str(input.title, 400), sent) ? null : prev
  // a resent plan keeps what was finished; short ops sent along with it apply on top
  const base = isPartial && prev ? prev.stages : pointAt(was ? carryDone(sent, was.stages) : sent)
  const { stages, missing } = applyOps(base, input, now)
  if (missing.length > 0 && base.length > 0) {
    const titles = stepsOf(stages)
      .map(st => st.title)
      .join(', ')
    return `plan_progress: "${id}" has no step ${missing.map(t => `"${str(t, 60)}"`).join(', ')}. Its steps: ${str(titles, 400)}`
  }
  const title = str(input.title, 80) || prev?.title || 'Plan'
  const steps = stepsOf(stages)
  const isAllDone = steps.length > 0 && steps.every(s => isFinished(s.status))
  const asked = (['running', 'needs_input', 'error', 'done'] as const).find(s => s === input.state)
  const state: PlanState = asked ?? (isAllDone ? 'done' : typeof input.failed === 'string' ? 'error' : 'running')

  return {
    id,
    title,
    kind: input.kind === 'todo' || (isPartial && prev?.kind === 'todo') ? 'todo' : 'plan',
    stages,
    state,
    note: str(input.note, 160) || null,
    startedAt: was ? was.startedAt : now,
    endedAt: state === 'done' ? (was?.endedAt ?? now) : null,
  }
}

// A whole plan sent to a finished one: another task when it has another title
// or leaves out a step the last one finished. One that keeps the title and every
// finished step is the plan grown after it finished, which the rules tell Claude
// to resend under the same id. The same plan sent again with no statuses (at
// most its first step active), bringing no new step, is a new run of it
export function isNextTask(prev: Plan, title: string, stages: PlanStage[]): boolean {
  if (prev.state !== 'done') return false
  // a title is stored cut at 80, and a plan-mode one without its markdown: the same title either way is the same plan
  const sentAs = [str(title, 80), str(clean(title), 80)]
  const keptAs = [prev.title, clean(prev.title)]
  if (title && !sentAs.some(a => keptAs.some(b => same(a, b)))) return true
  const key = (st: PlanStep) => st.title.trim().toLowerCase()
  const steps = stepsOf(stages)
  const sent = new Set(steps.map(key))
  const finished = stepsOf(prev.stages).filter(st => isFinished(st.status))
  if (finished.length === 0 || finished.some(st => !sent.has(key(st)))) return true
  const left = new Map<string, number>()
  for (const st of stepsOf(prev.stages)) left.set(key(st), (left.get(key(st)) ?? 0) + 1)
  const isGrown = steps.some(st => {
    const n = left.get(key(st)) ?? 0
    left.set(key(st), n - 1)
    return n <= 0
  })
  return (
    !isGrown &&
    steps.length > 0 &&
    steps.every((st, i) => st.status === 'pending' || (st.status === 'active' && i === 0))
  )
}

// A resent plan keeps what is finished: a step sent as pending under a title
// that was done stays done; a title used twice carries over in order
export function carryDone(stages: PlanStage[], before: PlanStage[]): PlanStage[] {
  const finished = new Map<string, PlanStep[]>()
  for (const st of stepsOf(before).filter(st => isFinished(st.status))) {
    const key = st.title.trim().toLowerCase()
    finished.set(key, [...(finished.get(key) ?? []), st])
  }
  return stages.map(s => ({
    ...s,
    steps: s.steps.map(st => {
      const queue = finished.get(st.title.trim().toLowerCase())
      const was = queue?.[0]
      if (!queue || !was || !(st.status === 'pending' || st.status === was.status)) return st
      queue.shift()
      return was.doneAt === undefined ? { ...st, status: was.status } : { ...st, status: was.status, doneAt: was.doneAt }
    }),
  }))
}

// With nothing in progress, the first open step is the current one
export function pointAt(stages: PlanStage[]): PlanStage[] {
  const steps = stepsOf(stages)
  if (steps.some(st => st.status === 'active' || st.status === 'error')) return stages
  const first = steps.find(st => st.status === 'pending')
  return stages.map(s => ({
    ...s,
    steps: s.steps.map(st => (st === first ? { ...st, status: 'active' as const } : st)),
  }))
}

const clean = (s: string) =>
  s
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/^\s*(\d+[.)]|[-*+]|\[[ xX]\])\s+/, '')
    .replace(/^(\d+[.)]|\[[ xX]\])\s+/, '')
    .trim()

// A plan-mode plan's markdown as a plan: the first # heading its title, the
// other headings its stages and their list items its steps
export function parsePlan(markdown: string, now: number): Plan | null {
  let title = ''
  const headed: PlanStage[] = []
  const heads: { level: number; isNumbered: boolean }[] = []
  const items: { depth: number; text: string; status: StepStatus }[] = []
  let fence = ''
  for (const line of markdown.split(/\r?\n/)) {
    // a code block's shell comments and diff lines only look like headings and list items;
    // a backtick run closed on its own line is inline code, not a fence
    const f = /^\s*(`{3,})([^`]*)$/.exec(line) ?? /^\s*(~{3,})(.*)$/.exec(line)
    const mark = f?.[1] ?? ''
    if (fence) {
      if (mark[0] === fence[0] && mark.length >= fence.length && !f?.[2]?.trim()) fence = ''
      continue
    }
    if (mark) {
      fence = mark
      continue
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line)
    if (h) {
      const text = str(clean(h[2] ?? ''))
      if (h[1] === '#' && !title) {
        title = str(text, 80)
      } else {
        headed.push({ name: text, steps: [] })
        heads.push({ level: (h[1] ?? '').length, isNumbered: /^(\d+[.):]|step\s+\d+[.):]?)\s/i.test(h[2] ?? '') })
      }
      continue
    }
    const li = /^(\s*)(\d+[.)]|[-*+])\s+(.*)$/.exec(line)
    if (!li) continue
    const depth = Math.floor((li[1] ?? '').replace(/\t/g, '  ').length / 2)
    const text = str(clean(li[3] ?? ''))
    if (!text) continue
    // a ticked box is a step the plan already counts as done
    const status: StepStatus = /^\[[xX]\]\s/.test(li[3] ?? '') ? 'done' : 'pending'
    items.push({ depth, text, status })
    const stage = headed[headed.length - 1]
    if (!stage) continue
    const step = stage.steps[stage.steps.length - 1]
    if (depth === 0 || !step) stage.steps.push({ title: text, status, substeps: [] })
    else step.substeps.push({ title: text, status })
  }
  // steps written as numbered headings with prose under them ("### 1. Add X")
  // have no list: when most of a section's numbered headings are such ones, they
  // become that section's steps, deepest first; a top level with no section gets "Steps"
  const folded = new Set<number>()
  const root: PlanStage = { name: 'Steps', steps: [] }
  let rootAt = -1
  for (let level = 4; level >= 1; level--) {
    for (let p = -1; p < headed.length; p++) {
      if (p >= 0 && (heads[p]?.level ?? 0) >= level) continue
      const kids: number[] = []
      for (let i = p + 1; i < headed.length && (heads[i]?.level ?? 0) >= level; i++) {
        if (heads[i]?.level === level && heads[i]?.isNumbered && !folded.has(i)) kids.push(i)
      }
      if (kids.filter(i => headed[i]?.steps.length === 0).length * 2 <= kids.length) continue
      if (p < 0 && rootAt < 0) rootAt = kids[0] ?? -1
      const into = headed[p] ?? root
      for (const i of kids) {
        const kid = headed[i]
        if (!kid) continue
        into.steps.push({
          title: kid.name,
          status: 'pending',
          substeps: kid.steps.map(s => ({ title: s.title, status: s.status })),
        })
        folded.add(i)
      }
    }
  }
  let stages = headed
    .flatMap((s, i) => (i === rootAt ? [root] : folded.has(i) ? [] : [s]))
    .filter(s => s.steps.length > 0)
  if (stages.length === 0) {
    if (items.some(i => i.depth > 0)) {
      for (const item of items) {
        const stage = stages[stages.length - 1]
        if (item.depth === 0 || !stage) stages.push({ name: item.text, steps: [] })
        else stage.steps.push({ title: item.text, status: item.status, substeps: [] })
      }
      stages = stages.map(s => (s.steps.length ? s : { ...s, steps: [{ title: s.name, status: 'pending', substeps: [] }] }))
    } else if (items.length > 0) {
      stages = [{ name: 'Tasks', steps: items.map(i => ({ title: i.text, status: i.status, substeps: [] })) }]
    }
  }
  if (stages.length === 0) return null

  return {
    id: PLAN_ID,
    title: title || 'Plan',
    kind: stages.length === 1 ? 'todo' : 'plan',
    stages,
    state: 'running',
    note: null,
    startedAt: now,
    endedAt: null,
  }
}

// What an approved plan-mode plan makes of the plan already under PLAN_ID: a
// revision keeps what was finished; one approved after the last finished is a new task
export function fromPlanMode(parsed: Plan, prev: Plan | null): Plan {
  if (prev && !isNextTask(prev, parsed.title, parsed.stages)) {
    return { ...parsed, stages: pointAt(carryDone(parsed.stages, prev.stages)), startedAt: prev.startedAt }
  }
  return { ...parsed, stages: pointAt(parsed.stages) }
}

export type Where = { pos: number; total: number; stage: number; step: number; stageSize: number }

// pos counts the finished steps wherever they are; the current step is the
// active one, else the first still open
export function where(p: Plan): Where {
  const steps = p.stages.flatMap((s, i) => s.steps.map((step, j) => ({ i, j, step })))
  const pos = p.state === 'done' ? steps.length : steps.filter(x => isFinished(x.step.status)).length
  const cur =
    p.state === 'done'
      ? undefined
      : (steps.find(x => x.step.status === 'active') ?? steps.find(x => !isFinished(x.step.status)))
  const stage = (cur ?? steps[steps.length - 1])?.i ?? 0
  return {
    pos,
    total: steps.length,
    stage,
    step: cur ? cur.j + 1 : (p.stages[stage]?.steps.length ?? 0),
    stageSize: p.stages[stage]?.steps.length ?? 0,
  }
}

// What the bar's pill shows: the stage its place on the track falls in, so its
// name never runs ahead of the pill when steps finish out of order
export function atHead(p: Plan): Where {
  const w = where(p)
  if (p.state === 'done') return w
  let start = 0
  for (let i = 0; i < p.stages.length; i++) {
    const size = p.stages[i]?.steps.length ?? 0
    if (w.pos < start + size || i === p.stages.length - 1) {
      return { ...w, stage: i, step: Math.max(1, Math.min(size, w.pos - start + 1)), stageSize: size }
    }
    start += size
  }
  return w
}

// An unfinished plan stops at 99%: 199 of 200 steps would otherwise round up to 100%
export function percentOf(p: Plan): number {
  if (p.state === 'done') return 100
  const w = where(p)
  return Math.min(99, Math.round((Math.min(w.pos, w.total) / Math.max(1, w.total)) * 100))
}

// How long each finished step took (from the previous finish, or the plan's
// start), and each stage whose steps all finished
export function stepTimes(p: Plan): { steps: Map<PlanStep, number>; stages: (number | undefined)[] } {
  const ends = stepsOf(p.stages)
    .flatMap(st => (st.doneAt === undefined ? [] : [st.doneAt]))
    .sort((a, b) => a - b)
  const startOf = (at: number) => Math.max(p.startedAt, ...ends.filter(t => t < at))
  const steps = new Map<PlanStep, number>()
  const stages = p.stages.map(s => {
    for (const st of s.steps) if (st.doneAt !== undefined) steps.set(st, st.doneAt - startOf(st.doneAt))
    const done = s.steps.flatMap(st => (st.doneAt === undefined ? [] : [st.doneAt]))
    if (done.length < s.steps.length || done.length === 0) return undefined
    return Math.max(...done) - Math.min(...done.map(startOf))
  })
  return { steps, stages }
}

export const isAllFinished = (p: Plan) => {
  const steps = stepsOf(p.stages)
  return steps.length > 0 && steps.every(s => isFinished(s.status))
}

// A plan that still owes Claude's updates
export const isOpenPlan = (p: Plan) => p.state === 'running' && !isAllFinished(p)

// The person answered a plan waiting on them: back to work, or done when every step already was
export const answered = (p: Plan, now: number): Plan =>
  isAllFinished(p) ? { ...p, state: 'done', note: null, endedAt: now } : { ...p, state: 'running', note: null }

// The tool's answer: where the plan stands, as plan-progress answers it
export function answerOf(p: Plan): string {
  const w = where(p)
  const active = p.state === 'done' ? undefined : stepsOf(p.stages).find(st => st.status === 'active')
  return `${p.id}: ${Math.min(w.pos, w.total)}/${w.total}, ${p.state}${active ? `, active "${active.title}"` : ''}`
}

// The line a person's message carries while plans are open
export function openLine(list: readonly Plan[]): string | null {
  const open = list.filter(p => p.state !== 'done')
  if (open.length === 0) return null
  const parts = open.map(p => {
    const w = where(p)
    return `${p.id} (${p.stages[w.stage]?.name ?? ''} ${w.step}/${w.stageSize})`
  })
  return `agents-panel open plans: ${parts.join(', ')}`
}

// Adds or replaces one plan by id, keeping its place; keeps the newest
// KEEP_FINISHED_PLANS finished ones. Run inside update(), so concurrent writers
// (parallel agents) do not drop each other's plans
export function placePlan(list: readonly Plan[], next: Plan): Plan[] {
  const rest = list.some(p => p.id === next.id) ? list.map(p => (p.id === next.id ? next : p)) : [...list, next]
  const finished = rest.filter(p => p.state === 'done' && p.id !== next.id)
  if (finished.length <= KEEP_FINISHED_PLANS) return rest
  const dropped = new Set(finished.slice(0, finished.length - KEEP_FINISHED_PLANS))
  return rest.filter(p => !dropped.has(p))
}

// A saved plan as the store hands it back: a file cut short or written over by
// hand can hold anything, and one plan without the parts the drawing reads would
// fail every draw of the pane
export function isSavedPlan(v: unknown): v is Plan {
  if (typeof v !== 'object' || v === null) return false
  const p: Partial<Record<keyof Plan, unknown>> = v
  return (
    typeof p.id === 'string' &&
    typeof p.title === 'string' &&
    typeof p.state === 'string' &&
    typeof p.startedAt === 'number' &&
    Array.isArray(p.stages) &&
    p.stages.every(
      (s: unknown) =>
        typeof s === 'object' &&
        s !== null &&
        'steps' in s &&
        Array.isArray(s.steps) &&
        s.steps.every((t: unknown) => typeof t === 'object' && t !== null && 'title' in t && typeof t.title === 'string'),
    )
  )
}
