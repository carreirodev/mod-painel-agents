// Where the plans live: the session's $.state, saved per session in $.store so a
// session opened again finds the Principal's plans where it left them, and the
// frames that move a working plan's bar between the pane's redraws

import { atom, read, update } from 'claude-code'
import type { EngineInterface, StateDollar } from 'claude-code'

import type { AgentRow, Plan } from '../types'
import { isSavedPlan, placePlan } from './plan'
import { trackCells } from './track'

export const plans = atom({ plugin: 'agents-panel', key: 'plans' } as const, [])

// Builds a plan from the latest stored one inside update(), so back-to-back calls
// never work from a stale copy; make returns a string to refuse, and the list stays
export async function editPlan(
  $: StateDollar,
  id: string,
  make: (prev: Plan | null) => Plan | string,
): Promise<Plan | string> {
  let made: Plan | string = ''
  await update($, plans, list => {
    made = make(list.find(p => p.id === id) ?? null)
    return typeof made === 'string' ? [...list] : placePlan(list, made)
  })
  return made
}

// ---------- saved per session ----------

const SAVED = 'plans:'
const KEEP_SESSIONS = 20

// The session whose plans $.state holds, the only one they are saved under. A
// /clear or a /resume inside a running app goes on under another id with no
// session.start; between session.end and the new id the state is nobody's
let shownSession = ''
let endedSession = ''
// What was saved last, as text: only the content tells a change
let lastSaved = ''

// The Principal's plans are the ones saved: a subagent does not outlive the process that ran it
const savedOf = (list: readonly Plan[]) => list.filter(p => p.byAgent === undefined)

async function savePlans($: EngineInterface, list: Plan[], text: string) {
  const key = SAVED + shownSession
  lastSaved = text
  if (list.length === 0) {
    await $.store.delete(key)
    return
  }
  // set keeps a key where it first went in the store's order, so the session goes
  // to the end anew: the sessions trimmed are the ones left alone longest
  await $.store.delete(key)
  await $.store.set(key, list)
  const keys = (await $.store.keys()).filter(k => k.startsWith(SAVED) && k !== key)
  for (const old of keys.slice(0, Math.max(0, keys.length - (KEEP_SESSIONS - 1)))) await $.store.delete(old)
}

// Saves the session's plans when they changed since the last save. A store the
// host cannot write costs this save, not the plans on screen: it is logged and
// tried again on the next tick
export async function saveIfChanged($: EngineInterface) {
  if (shownSession === '') return
  const list = savedOf(await read($, plans))
  const text = JSON.stringify(list)
  if (text === lastSaved) return
  try {
    await savePlans($, list, text)
  } catch (err) {
    lastSaved = ''
    $.ui.log(`agents-panel: the plans of this session were not saved: ${err instanceof Error ? err.message : String(err)}`)
  }
}

// Brings back the plans saved under the session id. A store that cannot be read
// (cut short by a crash) costs the saved plans, never the session's start
export async function restorePlans($: EngineInterface, id: string) {
  shownSession = id
  lastSaved = '[]'
  let saved: unknown
  try {
    saved = await $.store.get(SAVED + id)
  } catch (err) {
    $.ui.log(`agents-panel: the saved plans could not be read: ${err instanceof Error ? err.message : String(err)}`)
    return
  }
  if (!Array.isArray(saved)) return
  const list = saved.filter(isSavedPlan).map(p => ({ ...p, byAgent: undefined }))
  if (list.length === 0) return
  // plans the session made before the switch was noticed stay, after the restored ones
  await update($, plans, shown => [...list.filter(p => !shown.some(s => s.id === p.id)), ...shown])
  lastSaved = JSON.stringify(savedOf(await read($, plans)))
}

// session.start: a session opened again (an app restart, a resume) finds its
// plans; one whose state already holds plans (a reload of the mod) keeps them
export async function startPlans($: EngineInterface) {
  const id = await $.session.id()
  if ((await read($, plans)).length === 0) {
    await restorePlans($, id)
  } else {
    shownSession = id
  }
}

// The 1 s tick: the session changed under the mod (a /clear, a /resume), so its
// plans are loaded here, as no session.start comes; then the latest plans are saved
export async function tickPlans($: EngineInterface) {
  const id = await $.session.id()
  if (id !== shownSession && id !== endedSession) await restorePlans($, id)
  await saveIfChanged($)
}

// session.end: the plans as they are now are the session's last save, and the
// tick keeps off the state until the next session's id shows
export async function endPlans($: EngineInterface, sessionId: string) {
  try {
    if (sessionId === shownSession) await saveIfChanged($)
  } finally {
    endedSession = sessionId
    shownSession = ''
  }
}

// ---------- the frames that move a bar ----------

// Whether the main conversation's turn is running
let isTurnLive = false
export const setTurnLive = (isLive: boolean) => {
  isTurnLive = isLive
}

// Claude works on the plan, and it runs: the Principal's turn for its plans, the
// subagent at work for its own
export function isMoving(p: Plan, rows: readonly AgentRow[]): boolean {
  if (p.state !== 'running') return false
  if (p.byAgent === undefined) return isTurnLive
  return rows.some(row => row.id === p.byAgent && row.status === 'running')
}

// What the terminal's pane last drew the bars at: the pane, its bars' width and
// whether its terminal draws round ends; null while no terminal shows it
export type Drawn = { requestId: string; columns: number; hasRoundEnds: boolean }
let drawn: Drawn | null = null
export const setDrawn = (next: Drawn | null) => {
  drawn = next
}

const FRAME_MS = 33
let frames: { cancel: () => void } | null = null
let isFrameBusy = false

async function frame($: EngineInterface) {
  const at = drawn
  if (!at || isFrameBusy) return
  isFrameBusy = true
  try {
    const [list, rows, now] = await Promise.all([read($, plans), read($, { plugin: 'agents-panel', key: 'agents' } as const), $.clock.now()])
    const moving = list.filter(p => isMoving(p, rows ?? []))
    const answers = await Promise.all(
      moving.map(p =>
        $.ui.blit({
          requestId: at.requestId,
          key: `bar-${p.id}`,
          cells: trackCells(p, at.columns, { now, isMoving: true, hasRoundEnds: at.hasRoundEnds }),
          columns: at.columns,
          rows: 1,
        }),
      ),
    )
    // refused: the pane is hidden or was drawn anew at another size; the next redraw sets it again
    if (answers.some(a => 'deny' in a)) drawn = null
  } finally {
    isFrameBusy = false
  }
}

// Runs the 30 fps frames only while a terminal shows the pane and a bar moves
export async function syncFrames($: EngineInterface) {
  const [list, rows] = await Promise.all([read($, plans), read($, { plugin: 'agents-panel', key: 'agents' } as const)])
  const isWanted = drawn !== null && list.some(p => isMoving(p, rows ?? []))
  if (isWanted && !frames) {
    frames = $.clock.every(FRAME_MS, () => {
      frame($).catch((err: unknown) => {
        $.ui.log(`agents-panel: a frame of the plan bars failed: ${err instanceof Error ? err.message : String(err)}`)
      })
    })
  }
  if (!isWanted && frames) {
    frames.cancel()
    frames = null
  }
}
