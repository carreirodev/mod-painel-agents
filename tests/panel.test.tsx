import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { AgentInfo, On, RegisteredToolSpec, TurnCompleteReason, TurnStepInput, TurnUsage } from 'claude-code'

import { cellsText, readCells } from '../hooks/track'
import type { AgentRow, Plan } from '../types'

const PLUGIN = 'agents-panel'

// 2026-10-07 15:00:00 in São Paulo
const NOW = Date.UTC(2026, 9, 7, 18, 0, 0)

const PANE = {
  component: 'Pane' as const,
  requestId: 'agents',
  props: {
    title: 'Agentes',
    isFocused: false,
    bodyColumns: 44,
    placement: 'dock' as const,
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
}

const SURFACES = ['terminal', 'desktop'] as const

const usageOf = (input: number, output: number, cacheRead = 0): TurnUsage => ({
  model: 'claude-test',
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: cacheRead,
  cache_creation_input_tokens: 0,
})

type EngineOptions = {
  agents?: () => AgentInfo[]
  // false: the plan tool never reaches the session (127.0.0.1 blocked)
  hasTool?: boolean
  env?: Record<string, string>
  store?: Record<string, unknown>
  // the store's file cannot be read: every get is refused
  isStoreBroken?: boolean
  // the session's id as the engine answers it now
  sessionId?: () => string
  // the files that exist, for $.fs.stat
  files?: string[]
}

// The engine beneath the plugin, answering as a session would
function engine(on: On, options: EngineOptions = {}) {
  const beneath = {
    opened: [] as { id: string; title?: string; columns?: number }[],
    commands: [] as string[],
    tools: [] as RegisteredToolSpec[],
    logs: [] as string[],
    toasts: [] as string[],
    // what each prompt carried down as context
    contexts: [] as (readonly string[])[],
    // the plans' states while each question was open
    whileAsking: [] as string[][],
    // the plans as the plugin last wrote them
    plans: [] as readonly Plan[],
    // the plugin's store, in its key order
    store: new Map(Object.entries(options.store ?? {})),
    // the paths the plugin looked up
    statted: [] as string[],
    usage: null as TurnUsage | null,
    // What each tool answers, by name; a tool with none is denied
    records: {} as Record<string, unknown>,
    clock: mock.clock(on, { now: NOW }),
  }
  mock.env(on, options.env ?? {})
  on('state.set', { plugin: PLUGIN, key: 'plans' }, ($, e, next) => {
    beneath.plans = e.value
    return next(e)
  })
  on('store.get', ($, e) =>
    options.isStoreBroken === true ? { deny: 'the store file is cut short' } : { value: beneath.store.get(e.key) },
  )
  on('store.set', ($, e) => {
    beneath.store.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.delete', ($, e) => {
    beneath.store.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...beneath.store.keys()] }))
  on('tool.register', ($, e) => {
    beneath.tools.push(e)
    return { value: { tool: `mcp__${PLUGIN}__${e.name}` } }
  })
  on('tool.list', () => ({
    value:
      options.hasTool === false
        ? []
        : beneath.tools.map(t => ({ name: `mcp__${PLUGIN}__${t.name}`, description: t.description, mcp: false })),
  }))
  on('session.id', () => ({ value: (options.sessionId ?? (() => 's1'))() }))
  on('ui.log', ($, e) => {
    beneath.logs.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', ($, e) => {
    beneath.toasts.push(e.text)
    return { value: undefined }
  })
  // the engine hands the path on in the host's own spelling (C:\home\dev\... on Windows)
  on('fs.stat', ($, e) => {
    const path = e.path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')
    beneath.statted.push(path)
    return (options.files ?? []).includes(path)
      ? { value: { kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false } }
      : { deny: `no such file: ${e.path}` }
  })
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('command.register', ($, e) => {
    beneath.commands.push(e.name)
    return { value: { command: e.name } }
  })
  on('ui.open', ($, e) => {
    beneath.opened.push({ id: e.id, title: e.title, columns: e.columns })
    return { value: { isPlaced: true } }
  })
  on('agent.list', () => ({ value: (options.agents ?? (() => []))() }))
  on('agent.spawn', ($, e) => ({ model: 'claude-sonnet-5-5', agentId: e.name ?? 'a1' }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('prompt.submit', ($, e) => {
    beneath.contexts.push(e.context ?? [])
    return { text: e.text }
  })
  on('classic.Stop', () => ({}))
  // No tool runs in a test: the call ends here, after the plugin noted it,
  // with the record the test gave the tool, or denied. A question notes the
  // plans' states while it is open
  on('tool.call', ($, e) => {
    if (e.tool === 'AskUserQuestion' || e.tool === 'ExitPlanMode') {
      beneath.whileAsking.push(beneath.plans.map(p => p.state))
    }
    const record = beneath.records[e.tool]
    return record === undefined ? { deny: 'not run in tests' } : { result: record, text: '' }
  })
  on('turn.step', async function* ($, e) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: 'end_turn' as const,
      usage: beneath.usage,
    }
  })
  return beneath
}

const begin = ($: Engine) =>
  $.session.start({ cwd: 'C:\\Users\\dev', surface: 'terminal', isInteractive: true })

// One model request of the main loop (no agentId) or of a subagent
async function step($: Engine, beneath: { usage: TurnUsage | null }, usage: TurnUsage | null, input: Partial<TurnStepInput> = {}) {
  beneath.usage = usage
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1, ...input })
  for await (const _ of stream) {
    // drains the response
  }
}

// The model's Agent call, as the engine raises it; the engine beneath answers
// the call's name as the subagent's id
const spawn = ($: Engine, id: string, description: string, subagentType = 'Explore') =>
  $.agent.spawn({
    tool_use_id: `toolu_${id}`,
    prompt: 'faça',
    description,
    subagentType,
    name: id,
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-opus-5-5',
    background: false,
    fork: false,
  })

const complete = ($: Engine, reason: Exclude<TurnCompleteReason, 'refusal'>, agentId?: string) =>
  $.turn.complete({
    answer: 'pronto',
    durationMs: 0,
    isAborted: reason === 'aborted',
    turnId: 't1',
    reason,
    ...(agentId === undefined ? {} : { agentId }),
  })

const texts = async (ui: { findAll: (q: { type: string }) => Promise<{ text: string }[]> }) =>
  (await ui.findAll({ type: 'Text' })).map(t => t.text)

// A Bash or PowerShell record for a command the engine moved to the background
const background = (id: string, extra: Record<string, unknown> = {}) => ({
  stdout: '',
  stderr: '',
  interrupted: false,
  backgroundTaskId: id,
  ...extra,
})

// A background task's notification, as the engine writes it
const notification = (id: string, status: string) =>
  [
    '<task-notification>',
    `<task-id>${id}</task-id>`,
    '<tool-use-id>toolu_x</tool-use-id>',
    `<output-file>C:\\Temp\\tasks\\${id}.output</output-file>`,
    `<status>${status}</status>`,
    `<summary>Background command "x" ${status}</summary>`,
    '</task-notification>',
  ].join('\n')

// A tool call inside a subagent's loop: the engine stamps its agentId, which
// the call's own input type leaves out
const inAgent = <const T extends object>(agentId: string, input: T) => ({ ...input, agentId })

const notify = ($: Engine, text: string, kind: 'task-notification' | 'composer' = 'task-notification') =>
  $.prompt.submit({ text, wait: false, origin: { kind } })

const PLAN_TOOL = `mcp__${PLUGIN}__plan_progress`

// The Principal's plan of the mockup: three stages of two steps
const FIX_LOGIN = {
  id: 'fix-login',
  title: 'Corrigir login com SSO',
  stages: [
    { name: 'Investigar', steps: [{ title: 'Ler o fluxo' }, { title: 'Reproduzir o bug' }] },
    { name: 'Corrigir', steps: [{ title: 'Ajustar o callback' }, { title: 'Validar o token' }] },
    { name: 'Verificar', steps: [{ title: 'Rodar os testes' }, { title: 'Revisar o diff' }] },
  ],
}

// A subagent's plan of one stage
const ROUTES = {
  id: 'rotas',
  title: 'Mapa das rotas',
  stages: [{ name: 'Mapear', steps: [{ title: 'Rotas de auth' }, { title: 'Uso do redirect' }, { title: 'Resumo' }] }],
}

// One plan_progress call, by the main conversation or by a subagent
const plan = ($: Engine, input: Record<string, unknown>, agentId?: string) =>
  $.tool.call({ tool: PLAN_TOOL, ...input, ...(agentId === undefined ? {} : { agentId }) })

// The characters of the plan bar keyed bar-<id>, a cell at a time
// Where the pill reading label sits on the bar keyed bar-<id>, and the background colours under it
async function pillOf(
  ui: { find: (q: { key: string }) => Promise<{ props: Record<string, unknown> } | undefined> },
  id: string,
  label: string,
) {
  const raw = (await ui.find({ key: `bar-${id}` }))?.props.cells
  const cells = typeof raw === 'string' ? readCells(raw) : []
  const from = cells.map(c => c.ch).join('').indexOf(label)
  const under = from < 0 ? [] : cells.slice(from, from + [...label].length)
  return { from, to: from + [...label].length, colors: [...new Set(under.map(c => c.bg))] }
}

async function barOf(ui: { find: (q: { key: string }) => Promise<{ props: Record<string, unknown> } | undefined> }, id: string) {
  const cells = (await ui.find({ key: `bar-${id}` }))?.props.cells
  return typeof cells === 'string' ? cellsText(cells) : ''
}

// One field of a record, whatever shape it has
const fieldOf = (record: unknown, key: string): unknown =>
  typeof record === 'object' && record !== null ? Object.entries(record).find(([name]) => name === key)?.[1] : undefined

// The props of the first Text that shows exactly text
async function propsOf(ui: { findAll: (q: { type: string }) => Promise<{ text: string; props: Record<string, unknown> }[]> }, text: string) {
  return (await ui.findAll({ type: 'Text' })).find(t => t.text === text)?.props
}

test('opens as a side pane when the session starts, and /painel-agentes opens it again', async ($, on) => {
  const beneath = engine(on)
  await begin($)

  expect(beneath.commands).toEqual(['painel-agentes'])
  expect(beneath.opened).toEqual([{ id: 'agents', title: 'Agentes', columns: 46 }])

  const ran = await $.command.run({
    command: 'painel-agentes',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 160 },
  })

  expect(ran.text).toBe('Painel de agentes aberto.')
  expect(beneath.opened).toHaveLength(2)
})

test('before any turn: the clock, the main agent idle on the session model, no subagent', async ($, on) => {
  engine(on)
  await begin($)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    const all = await texts(ui)

    expect(all).toContain('✦ AGENTES')
    expect(all).toContain('◷ 15:00:00')
    expect(all).toContain('sessão 0:00 · 0 ativos · 1 agente')
    expect(all).toContain('◆ Principal')
    expect(all).toContain(' ◌ OCIOSO ')
    expect(all).toContain(' Opus 5.5 ')
    expect(all).toContain('nenhuma ferramenta')
    expect(all).toContain('Nenhum subagente ainda.')
    await ui.unmount()
  }
})

// An hour on the mocked clock is 3,600 ticks, each redrawing the mounted pane: it
// took 4.96 s of the default 5 s before the plans, so it gets room of its own
test('the main agent works, counts its tokens, and its stopwatch stops when the turn ends', { timeoutMs: 20_000 }, async ($, on) => {
  const beneath = engine(on)
  await begin($)
  await $.turn.start({ text: 'oi', turnId: 't1' })
  await step($, beneath, usageOf(1200, 300, 8800), { effort: 'high' })
  await beneath.clock.advance(75_000)

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  const working = await texts(ui)
  expect(working).toContain('◔ 1:15')
  expect(working).toContain('↑ 10k entrada  ↓ 300 saída  ↻ 88% cache')
  expect(working).toContain('sessão 1:15 · 1 ativo · 1 agente')
  expect(working).toContain('▸ pensando…')
  expect(working.some(text => / ATIVO $/.test(text))).toBe(true)

  const found = await ui.findAll({ type: 'Text' })
  const propsOf = (text: string) => found.find(t => t.text === text)?.props
  expect(propsOf(' Opus 5.5 ')?.backgroundColor).toBe('#b0bec5')
  expect(propsOf(' high')?.color).toBe('#facc15')

  await complete($, 'answer')
  await beneath.clock.advance(3_600_000)

  const resting = await texts(ui)
  expect(resting).toContain('◔ 1:15')
  expect(resting).toContain(' ◌ OCIOSO ')
  expect(resting).toContain('sessão 1:01:15 · 0 ativos · 1 agente')
})

test('a subagent shows its type, model and effort, then moves to the finished list', async ($, on) => {
  const beneath = engine(on)
  await begin($)
  await $.turn.start({ text: 'oi', turnId: 't1' })
  await step($, beneath, usageOf(6000, 1000), { effort: 'high' })
  await spawn($, 'a1', 'Ler tipos do motor')
  await step($, beneath, usageOf(2000, 1000), { agentId: 'a1', model: 'claude-sonnet-5-5', effort: 'medium' })

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  const working = await texts(ui)
  expect(working).toContain('◇ Ler tipos do motor')
  expect(working).toContain('Explore ·  Sonnet 5.5  medium')
  expect(working).toContain('sessão 0:00 · 2 ativos · 2 agentes')

  await beneath.clock.advance(42_000)
  await complete($, 'answer', 'a1')

  const done = await texts(ui)
  expect(done).toContain('CONCLUÍDOS')
  expect(done).toContain('✓ Ler tipos do motor')
  expect(done).toContain('Sonnet 5.5 medium · ↑2k ↓1k')
  expect(done).toContain('◔ 0:42')
  expect(done).toContain('sessão 0:42 · 1 ativo · 2 agentes')
  expect(done).not.toContain('◇ Ler tipos do motor')
})

test('shows the latest tool each agent called, what it took, and how many it made', async ($, on) => {
  const beneath = engine(on)
  await begin($)
  await $.turn.start({ text: 'oi', turnId: 't1' })
  await spawn($, 'a1', 'Ler a documentação')
  await step($, beneath, null, { agentId: 'a1', model: 'claude-sonnet-5-5' })
  await $.tool.call({ tool: 'Bash', command: '  npm   test\n# segunda linha' })
  await $.tool.call(inAgent('a1', { tool: 'Read', file_path: 'C:\\Users\\dev\\planilha.py' }))
  await $.tool.call(inAgent('a1', { tool: 'WebFetch', url: 'https://docs.railway.com/guides/x?y=1', prompt: 'resuma' }))

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  const working = await texts(ui)
  expect(working).toContain('▸ Bash  npm test')
  expect(working).toContain('1 ferramenta')
  expect(working).toContain('▸ WebFetch  docs.railway.com')
  expect(working).toContain('2 ferramentas')
  const found = await ui.findAll({ type: 'Text' })
  expect(found.find(t => t.text === 'Bash')?.props.color).toBe('#facc15')
  expect(found.find(t => t.text === 'WebFetch')?.props.color).toBe('#60a5fa')

  await $.tool.call({ tool: 'mcp__plugin_linear_linear__get_issue', id: 'WPC-136' })
  await complete($, 'answer', 'a1')

  const done = await texts(ui)
  expect(done).toContain('▸ get_issue')
  expect(done).toContain('2 ferramentas')
  expect(done).toContain('última: WebFetch  docs.railway.com')
})

test('rows an earlier version wrote gain the tool fields when the module reloads', async ($, on) => {
  engine(on)
  // Until the reload, the rows reach the store as the version without tool fields wrote them
  let isEarlier = true
  on('state.set', { plugin: PLUGIN, key: 'agents' }, ($, e, next) =>
    next(
      isEarlier
        ? { ...e, value: e.value.map(({ tool, target, toolCount, ...earlier }) => earlier as AgentRow) }
        : e,
    ),
  )
  await begin($)

  isEarlier = false
  // A reload runs session.start again
  await begin($)
  await $.tool.call({ tool: 'Bash', command: 'ls' })

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  const all = await texts(ui)
  expect(all).toContain('última: Bash  ls')
  expect(all).toContain('1 ferramenta')
})

test('an interrupted subagent shows PARADO and one that died on an error shows ERRO', async ($, on) => {
  const beneath = engine(on)
  await begin($)
  await spawn($, 'a1', 'Varredura')
  await spawn($, 'a2', 'Revisão')
  await step($, beneath, null, { agentId: 'a1' })
  await step($, beneath, null, { agentId: 'a2' })
  await complete($, 'aborted', 'a1')
  await complete($, 'error', 'a2')

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  const all = await texts(ui)
  expect(all).toContain('■ Varredura')
  expect(all).toContain('✗ Revisão')
})

test('a subagent spawned before the mod loaded is named from the engine list', async ($, on) => {
  const beneath = engine(on, {
    agents: () => [{ id: 'b7', description: 'Revisar diff', type: 'general-purpose', status: 'running' }],
  })
  await begin($)
  await step($, beneath, usageOf(100, 10), { agentId: 'b7', model: 'claude-haiku-4-5-20251001' })

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  const all = await texts(ui)
  expect(all).toContain('◇ Revisar diff')
  expect(all).toContain('general-purpose ·  Haiku 4.5 ')
})

test('a subagent the engine stopped without a turn end is closed on the next tick', async ($, on) => {
  let status: AgentInfo['status'] = 'running'
  const beneath = engine(on, {
    agents: () => [{ id: 'c3', description: 'Busca longa', type: 'Explore', status }],
  })
  await begin($)
  await spawn($, 'c3', 'Busca longa')
  await step($, beneath, null, { agentId: 'c3' })
  await beneath.clock.advance(5_000)

  status = 'killed'
  await beneath.clock.advance(1_000)

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  const all = await texts(ui)
  expect(all).toContain('■ Busca longa')
  expect(all).toContain('◔ 0:06')
})

test('/clear starts the list over', async ($, on) => {
  const beneath = engine(on)
  await begin($)
  await spawn($, 'a1', 'Antes do clear')
  await step($, beneath, usageOf(500, 50), { agentId: 'a1' })
  beneath.records.Bash = background('b9')
  await $.tool.call({ tool: 'Bash', command: 'npm run dev', run_in_background: true })
  await plan($, FIX_LOGIN)
  await beneath.clock.advance(90_000)

  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  const all = await texts(ui)
  expect(all).toContain('sessão 0:00 · 0 ativos · 1 agente')
  expect(all).toContain('Nenhum subagente ainda.')
  expect(all).not.toContain('◇ Antes do clear')
  expect(all).not.toContain('SHELLS')
  expect(all.some(text => text.startsWith('▤'))).toBe(false)
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
})

test('a command moved to the background is an open shell until its notification arrives', async ($, on) => {
  const beneath = engine(on)
  await begin($)
  beneath.records.Bash = background('b1')
  await $.tool.call({ tool: 'Bash', command: 'npm run dev', run_in_background: true })
  await beneath.clock.advance(150_000)

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  const open = await texts(ui)
  expect(open).toContain('SHELLS')
  expect(open).toContain('1 aberto')
  expect(open.some(text => /^[◐◓◑◒] npm run dev$/.test(text))).toBe(true)
  expect(open).toContain('◔ 2:30')
  expect(open).toContain('Bash · Principal · b1')

  await notify($, notification('b1', 'completed'))
  await beneath.clock.advance(60_000)

  const closed = await texts(ui)
  expect(closed).toContain('0 abertos')
  expect(closed).toContain('✓ npm run dev')
  expect(closed).toContain('◔ 2:30')
})

test('a foreground command opens no shell, and a notification the person typed closes none', async ($, on) => {
  const beneath = engine(on)
  await begin($)
  beneath.records.Bash = { stdout: 'a.txt', stderr: '', interrupted: false }
  await $.tool.call({ tool: 'Bash', command: 'ls' })

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  expect(await texts(ui)).not.toContain('SHELLS')

  beneath.records.PowerShell = background('p1')
  await $.tool.call({ tool: 'PowerShell', command: 'npm test' })
  await notify($, notification('p1', 'completed'), 'composer')

  const typed = await texts(ui)
  expect(typed).toContain('1 aberto')
  expect(typed).toContain('PowerShell · Principal · p1')
})

test('a shell that failed shows ERRO and one Claude stopped shows PARADO', async ($, on) => {
  const beneath = engine(on)
  await begin($)
  beneath.records.PowerShell = background('p1')
  await $.tool.call({ tool: 'PowerShell', command: 'npm test' })
  beneath.records.Bash = background('b2')
  await $.tool.call({ tool: 'Bash', command: 'sleep 600' })

  await notify($, notification('p1', 'failed'))
  beneath.records.TaskStop = { message: 'Stopped', task_id: 'b2', task_type: 'local_bash' }
  await $.tool.call({ tool: 'TaskStop', task_id: 'b2' })

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  const all = await texts(ui)
  expect(all).toContain('0 abertos')
  expect(all).toContain('✗ npm test')
  expect(all).toContain('■ sleep 600')
})

test("a synchronous subagent's background command ends with its answer, a lasting one stays open", async ($, on) => {
  const beneath = engine(on)
  await begin($)
  await spawn($, 'a1', 'Rodar testes')
  await step($, beneath, null, { agentId: 'a1' })
  beneath.records.Bash = background('b3', { backgroundEndsWithFinalResponse: true })
  await $.tool.call(inAgent('a1', { tool: 'Bash', command: 'pytest -q' }))
  beneath.records.Bash = background('b4')
  await $.tool.call(inAgent('a1', { tool: 'Bash', command: 'npm run watch' }))

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  const working = await texts(ui)
  expect(working).toContain('2 abertos')
  expect(working).toContain('Bash · Rodar testes · b3')

  await complete($, 'answer', 'a1')

  const done = await texts(ui)
  expect(done).toContain('1 aberto')
  expect(done).toContain('■ pytest -q')
  expect(done.some(text => /^[◐◓◑◒] npm run watch$/.test(text))).toBe(true)
})

test('keeps the 10 most recent finished shells', async ($, on) => {
  const beneath = engine(on)
  await begin($)
  for (let i = 0; i < 12; i++) {
    beneath.records.Bash = background(`b${i}`)
    await $.tool.call({ tool: 'Bash', command: `job ${i}` })
    await beneath.clock.advance(1_000)
    await notify($, notification(`b${i}`, 'completed'))
  }

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  const lines = (await texts(ui)).filter(text => text.startsWith('✓ job'))
  expect(lines).toHaveLength(10)
  expect(lines[0]).toBe('✓ job 11')
  expect(lines).not.toContain('✓ job 1')
  expect(lines).not.toContain('✓ job 0')
})

test('keeps the 30 most recent finished subagents', async ($, on) => {
  engine(on)
  await begin($)
  for (let i = 0; i < 32; i++) {
    await spawn($, `a${i}`, `Tarefa ${i}`)
    await complete($, 'answer', `a${i}`)
  }

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  const lines = (await texts(ui)).filter(text => text.startsWith('✓ Tarefa'))
  expect(lines).toHaveLength(30)
  expect(lines[0]).toBe('✓ Tarefa 31')
  expect(lines).not.toContain('✓ Tarefa 1')
  expect(lines).not.toContain('✓ Tarefa 0')
})

test('shortens big numbers the Brazilian way', async ($, on) => {
  const beneath = engine(on)
  await begin($)
  await step($, beneath, usageOf(1_234_567, 99_960))
  await step($, beneath, usageOf(950, 0))

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  expect(await texts(ui)).toContain('↑ 1,2M entrada  ↓ 100k saída  ↻ 0% cache')
})

// ---------- WPC-501: the gap between frames and the plans inside them ----------

test('the frames have one blank line between them', async ($, on) => {
  const beneath = engine(on)
  await begin($)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    expect(await ui.drawn()).toMatchObject({ type: 'Box', props: { flexDirection: 'column', gap: 1 } })
    await ui.unmount()
  }
})

test("registers plan_progress with plan-progress's input", async ($, on) => {
  const beneath = engine(on)
  await begin($)
  const tool = beneath.tools.find(t => t.name === 'plan_progress')
  expect(tool?.isDeferred).toBe(false)
  expect(Object.keys(fieldOf(tool?.inputSchema, 'properties') ?? {})).toEqual([
    'id',
    'title',
    'kind',
    'stages',
    'next',
    'done',
    'active',
    'failed',
    'state',
    'note',
  ])
  expect(tool?.description).not.toMatch(/above the prompt/i)
})

test("the Principal's plan shows in its frame and the tool answers its place", async ($, on) => {
  const beneath = engine(on)
  await begin($)
  const answer = await plan($, FIX_LOGIN)
  expect(answer.result).toBe('fix-login: 0/6, running, active "Ler o fluxo"')

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  const all = await texts(ui)
  const title = all.indexOf('▤ Corrigir login com SSO')
  expect(title).toBeGreaterThan(all.indexOf('◆ Principal'))
  expect(title).toBeLessThan(all.indexOf('Nenhum subagente ainda.'))
})

test('an unknown step and an id without a letter or digit are refused', async ($, on) => {
  const beneath = engine(on)
  await begin($)
  await plan($, FIX_LOGIN)

  const unknown = await plan($, { id: 'fix-login', done: ['Deploy'] })
  expect(unknown.deny).toBe(
    'plan_progress: "fix-login" has no step "Deploy". Its steps: Ler o fluxo, Reproduzir o bug, Ajustar o callback, Validar o token, Rodar os testes, Revisar o diff',
  )
  const noId = await plan($, { id: '🙂!!', stages: FIX_LOGIN.stages })
  expect(noId.deny).toBe('plan_progress: the id needs a letter or a digit, like "fix-login".')
})

test('the rules go into the system prompt under the new tool name', async ($, on) => {
  on('prompt.compose', () => ({ sections: [] }))
  const beneath = engine(on)
  await begin($)
  const composed = await $.prompt.compose({
    model: 'claude-opus-5-5',
    promptModel: 'claude-opus-5-5',
    surfaces: ['terminal'],
    tools: [],
    outputStyle: null,
    traits: [],
  })
  const rules = composed.sections.find(s => s.id === 'agents-panel:rules')
  expect(rules?.scope).toBe('session')
  expect(rules?.text).toContain(
    'Tasks needing more than ~3 edits or commands get a bar via mcp__agents-panel__plan_progress: create it once',
  )
  expect(rules?.text).toContain('then move it with short calls: {id, next:true}')
  expect(rules?.text).not.toMatch(/above the prompt/i)
})

test("a person's message carries the open plans", async ($, on) => {
  const beneath = engine(on)
  await begin($)
  await notify($, 'oi', 'composer')
  expect(beneath.contexts.at(-1)).toEqual([])

  await plan($, FIX_LOGIN)
  await notify($, 'e agora?', 'composer')
  expect(beneath.contexts.at(-1)).toEqual(['agents-panel open plans: fix-login (Investigar 1/2)'])
})

const edit = ($: Engine, i: number) =>
  $.tool.call({ tool: 'Edit', file_path: `C:\\src\\f${i}.ts`, old_string: 'a', new_string: 'b' })

test('the 4th edit without a plan is refused once', async ($, on) => {
  const beneath = engine(on)
  await begin($)
  await $.turn.start({ text: 'oi', turnId: 't1' })
  beneath.records.Edit = { filePath: 'a.ts' }
  const denials = []
  for (let i = 0; i < 5; i++) {
    denials.push((await edit($, i)).deny)
  }
  expect(denials).toEqual([
    undefined,
    undefined,
    undefined,
    'agents-panel: several changes ahead. Create a plan with mcp__agents-panel__plan_progress first, then retry.',
    undefined,
  ])
})

test('six edits without an update bring a reminder', async ($, on) => {
  const beneath = engine(on)
  await begin($)
  await $.turn.start({ text: 'oi', turnId: 't1' })
  await plan($, FIX_LOGIN)
  beneath.records.Edit = { filePath: 'a.ts' }
  const contexts = []
  for (let i = 0; i < 6; i++) {
    contexts.push((await edit($, i)).context ?? [])
  }
  expect(contexts.slice(0, 5).every(c => c.length === 0)).toBe(true)
  expect(contexts[5]).toEqual([
    'agents-panel: fix-login not updated for a while; send {id, next:true} or {id, done, active}.',
  ])
})

test('a turn that leaves a plan open is sent back, a question waits instead', async ($, on) => {
  const beneath = engine(on)
  await begin($)
  await $.turn.start({ text: 'oi', turnId: 't1' })
  await plan($, FIX_LOGIN)
  beneath.records.Edit = { filePath: 'a.ts' }
  await edit($, 0)

  const sent = await $.classic.Stop({ stop_hook_active: false, last_assistant_message: 'Pronto, ajustei o callback.' })
  expect(sent.block).toBe(
    'agents-panel: fix-login still open. Update each with mcp__agents-panel__plan_progress: {id, next:true}, or state "done", "needs_input" or "error" with a note.',
  )
  const again = await $.classic.Stop({ stop_hook_active: true, last_assistant_message: 'Pronto.' })
  expect(again.block).toBeUndefined()

  const asked = await $.classic.Stop({ stop_hook_active: false, last_assistant_message: 'Posso seguir com o **deploy**?' })
  expect(asked.block).toBeUndefined()
  expect(beneath.plans.map(p => p.state)).toEqual(['needs_input'])
})

test('the plan waits while the Principal asks', async ($, on) => {
  const beneath = engine(on)
  await begin($)
  await plan($, FIX_LOGIN)
  beneath.records.AskUserQuestion = { answers: {} }
  beneath.records.ExitPlanMode = { plan: '' }

  await $.tool.call({ tool: 'AskUserQuestion', questions: [] })
  await $.tool.call({ tool: 'ExitPlanMode' })

  expect(beneath.whileAsking).toEqual([['needs_input'], ['needs_input']])
  expect(beneath.plans.map(p => p.state)).toEqual(['running'])

  // amber while it waits
  await plan($, { id: 'fix-login', state: 'needs_input', note: 'Qual provedor?' })
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  expect((await propsOf(ui, ' ? 0:00 '))?.backgroundColor).toBe('#f59e0b')
})

const PLAN_MD = [
  '# Corrigir login',
  '',
  '## Investigar',
  '- Ler o fluxo',
  '- Reproduzir o bug',
  '',
  '## Corrigir',
  '- Ajustar o callback',
].join('\n')

test("an approved plan-mode plan becomes plan 'plan', a revision keeps finished steps", async ($, on) => {
  const beneath = engine(on)
  await begin($)
  beneath.records.ExitPlanMode = { plan: PLAN_MD }
  const approved = await $.tool.call({ tool: 'ExitPlanMode' })
  expect(approved.context).toEqual([
    'agents-panel: plan "plan" shows this plan; move it with {id:"plan", next:true} as steps finish.',
  ])
  const [made] = beneath.plans
  expect(made?.id).toBe('plan')
  expect(made?.title).toBe('Corrigir login')
  expect(made?.stages.map(s => s.name)).toEqual(['Investigar', 'Corrigir'])

  await plan($, { id: 'plan', next: true })
  beneath.records.ExitPlanMode = { plan: `${PLAN_MD}\n- Testar o callback` }
  await $.tool.call({ tool: 'ExitPlanMode' })
  const [revised] = beneath.plans
  expect(revised?.stages.flatMap(s => s.steps.map(st => `${st.title}:${st.status}`))).toEqual([
    'Ler o fluxo:done',
    'Reproduzir o bug:active',
    'Ajustar o callback:pending',
    'Testar o callback:pending',
  ])

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  expect(await texts(ui)).toContain('▤ Corrigir login')
})

test('without the tool in the session: one warning, no refusal, no reminder', async ($, on) => {
  const beneath = engine(on, { hasTool: false })
  await begin($)
  await $.turn.start({ text: 'oi', turnId: 't1' })
  await $.turn.start({ text: 'de novo', turnId: 't2' })
  expect(beneath.logs.filter(l => l.includes('did not reach this session'))).toHaveLength(1)
  expect(beneath.toasts).toHaveLength(1)

  // no refusal: four edits with no plan all go through
  beneath.records.Edit = { filePath: 'a.ts' }
  const denials = []
  for (let i = 0; i < 4; i++) {
    denials.push((await edit($, i)).deny)
  }
  expect(denials).toEqual([undefined, undefined, undefined, undefined])

  // a plan open and six edits since it moved: no reminder
  await plan($, FIX_LOGIN)
  const contexts = []
  for (let i = 0; i < 6; i++) {
    contexts.push((await edit($, i)).context ?? [])
  }
  expect(contexts.every(c => c.length === 0)).toBe(true)
  // a turn that worked and left it open is not sent back
  const stop = await $.classic.Stop({ stop_hook_active: false, last_assistant_message: 'Feito.' })
  expect(stop.block).toBeUndefined()
  // the person's message carries no open-plans line
  await notify($, 'e agora?', 'composer')
  expect(beneath.contexts.at(-1)).toEqual([])
  // an approved plan-mode plan brings no line about moving it
  beneath.records.ExitPlanMode = { plan: PLAN_MD }
  expect((await $.tool.call({ tool: 'ExitPlanMode' })).context ?? []).toEqual([])
})

test('the plan block: dashed rule, title, badge by state', async ($, on) => {
  const beneath = engine(on)
  await begin($)
  await plan($, FIX_LOGIN)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })

  expect((await propsOf(ui, '╌'.repeat(40)))?.color).toBe('#b0bec5')
  expect(await texts(ui)).toContain('▤ Corrigir login com SSO')
  const running = (await ui.findAll({ type: 'Text' })).find(t => /^ [◐◓◑◒] 0:00 $/.test(t.text))
  expect(running?.props.backgroundColor).toBe('#22c55e')

  const cases = [
    { input: { state: 'needs_input', note: 'Qual provedor?' }, icon: '?', color: '#f59e0b', note: 'Qual provedor?' },
    { input: { failed: 'Ler o fluxo', note: 'O token expirado passa' }, icon: '✗', color: '#ef4444', note: 'O token expirado passa' },
    { input: { state: 'done' }, icon: '✓', color: '#14b8a6', note: null },
  ]
  for (const one of cases) {
    await plan($, { id: 'fix-login', ...one.input })
    expect((await propsOf(ui, ` ${one.icon} 0:00 `))?.backgroundColor).toBe(one.color)
    if (one.note !== null) {
      expect((await propsOf(ui, one.note))?.color).toBe(one.color)
    }
  }
})

test("the bar's pill names the stage, the step and the percent", async ($, on) => {
  const beneath = engine(on)
  await begin($)
  await plan($, FIX_LOGIN)
  await plan($, { id: 'fix-login', next: true })
  await plan($, { id: 'fix-login', next: true })
  await plan($, ROUTES)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })

  const bar = await barOf(ui, 'fix-login')
  expect([...bar]).toHaveLength(40)
  expect(bar).toContain(' Corrigir 1/2 · 33% ')
  expect(await barOf(ui, 'rotas')).toContain(' Mapear 1/3 · 0% ')
  // no percent outside the bar but the cache's
  expect((await texts(ui)).some(text => text.includes('%') && !text.includes('cache') && text !== '0%')).toBe(false)

  // the pill in the state's colour, riding the head: 2 of 6 steps on 40 columns put it at column 13
  const pill = await pillOf(ui, 'fix-login', ' Corrigir 1/2 · 33% ')
  expect(pill.colors).toEqual(['#22c55e'])
  expect(pill.from).toBeLessThanOrEqual(13)
  expect(pill.to).toBeGreaterThan(13)

  await plan($, { id: 'fix-login', state: 'done' })
  await plan($, { id: 'rotas', state: 'done' })
  expect(await barOf(ui, 'rotas')).toContain(' ✓ Concluído · 100% ')
  expect((await pillOf(ui, 'rotas', ' ✓ Concluído · 100% ')).colors).toEqual(['#14b8a6'])
})

test('a finished stage folds into one line, the current one lists its steps', async ($, on) => {
  const beneath = engine(on)
  await begin($)
  await plan($, FIX_LOGIN)
  await beneath.clock.advance(30_000)
  await plan($, { id: 'fix-login', next: true })
  await beneath.clock.advance(45_000)
  await plan($, { id: 'fix-login', next: true })
  await beneath.clock.advance(20_000)
  await plan($, { id: 'fix-login', next: true })
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  const all = await texts(ui)

  expect(all).toContain('✓ Investigar 2/2')
  expect(all).toContain('1:15')
  expect(all).not.toContain('✓ Ler o fluxo')
  expect(all).toContain('✓ Ajustar o callback')
  expect(all).toContain('0:20')
  expect(all).toContain('▸ Validar o token')
  expect((await propsOf(ui, 'Validar o token'))?.bold).toBe(true)
  expect(all).toContain('· Rodar os testes')
  expect((await propsOf(ui, 'Rodar os testes'))?.color).toBe('#4b5563')
})

test('a finished plan lists every step done, as the mockup draws it', async ($, on) => {
  const beneath = engine(on)
  await begin($)
  await plan($, FIX_LOGIN)
  await plan($, { id: 'fix-login', next: true })
  await plan($, { id: 'fix-login', next: true })
  // Claude closes it before the last steps
  await plan($, { id: 'fix-login', state: 'done' })
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  const all = await texts(ui)

  expect(all).not.toContain('✓ Investigar 2/2')
  expect(all).toContain('Investigar')
  for (const title of ['Ler o fluxo', 'Reproduzir o bug', 'Ajustar o callback', 'Validar o token', 'Rodar os testes', 'Revisar o diff']) {
    expect(all).toContain(`✓ ${title}`)
  }
  expect(all.some(text => text.startsWith('▸ ') || text.startsWith('· '))).toBe(false)
  expect(beneath.plans[0]?.state).toBe('done')
})

test('finished Principal plans are one line each under the current one', async ($, on) => {
  const beneath = engine(on)
  await begin($)
  await plan($, { ...ROUTES, id: 'readme', title: 'Atualizar o README' })
  await beneath.clock.advance(252_000)
  await plan($, { id: 'readme', state: 'done' })
  await plan($, FIX_LOGIN)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  const all = await texts(ui)

  expect(all).toContain('▤ Corrigir login com SSO')
  expect(all).not.toContain('▤ Atualizar o README')
  const line = all.indexOf('✓ Atualizar o README · 100%')
  expect(line).toBeGreaterThan(all.indexOf('▤ Corrigir login com SSO'))
  expect(all.slice(line)).toContain('◔ 4:12')
})

test("a plan with every step finished closes at the turn's end", async ($, on) => {
  const beneath = engine(on)
  await begin($)
  await $.turn.start({ text: 'oi', turnId: 't1' })
  await plan($, ROUTES)
  await plan($, { id: 'rotas', done: ['Rotas de auth', 'Uso do redirect', 'Resumo'], state: 'running' })
  expect(beneath.plans.map(p => p.state)).toEqual(['running'])

  await complete($, 'answer')
  const [closed] = beneath.plans
  expect(closed?.state).toBe('done')
  expect(closed?.endedAt).toBe(NOW)
})

test("the Principal's plans are saved and come back with the session", async ($, on) => {
  let session = 's1'
  const beneath = engine(on, { sessionId: () => session })
  await begin($)
  await spawn($, 'a1', 'Mapear rotas de login')
  await plan($, ROUTES, 'a1')
  await plan($, FIX_LOGIN)
  await beneath.clock.advance(5_000)
  // only the Principal's: a subagent does not outlive the process that ran it
  const stored = beneath.store.get('plans:s1')
  expect(Array.isArray(stored) ? stored.map(p => fieldOf(p, 'id')) : stored).toEqual(['fix-login'])

  // a /clear goes on under another session, and a /resume brings this one back
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  session = 's2'
  await beneath.clock.advance(5_000)
  expect(beneath.plans).toEqual([])
  await $.session.end({ reason: 'resume', sessionId: 's2', resume: { id: 's1' } })
  session = 's1'
  await beneath.clock.advance(5_000)
  expect(beneath.plans.map(p => p.id)).toEqual(['fix-login'])
})

test('saved plans come back when the session starts again', async ($, on) => {
  const saved = {
    id: 'fix-login',
    title: 'Corrigir login com SSO',
    kind: 'plan',
    state: 'running',
    note: null,
    startedAt: NOW,
    endedAt: null,
    stages: FIX_LOGIN.stages.map(s => ({
      name: s.name,
      steps: s.steps.map(st => ({ ...st, status: 'pending', substeps: [] })),
    })),
  }
  // a plan the drawing could not read is left out
  const beneath = engine(on, { store: { 'plans:s1': [saved, { broken: true }] } })
  await begin($)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  expect(await texts(ui)).toContain('▤ Corrigir login com SSO')
  expect(beneath.plans.map(p => p.id)).toEqual(['fix-login'])
})

test('an unreadable store does not stop the session from starting', async ($, on) => {
  const beneath = engine(on, { isStoreBroken: true })
  await begin($)
  expect(beneath.opened).toHaveLength(1)
  expect(beneath.logs.some(l => l.includes('the saved plans could not be read'))).toBe(true)
})

test("a subagent's plan shows in its own frame", async ($, on) => {
  const beneath = engine(on)
  await begin($)
  await spawn($, 'a1', 'Mapear rotas de login')
  await step($, beneath, null, { agentId: 'a1', model: 'claude-sonnet-5-5' })
  await spawn($, 'a2', 'Ler a documentação')
  await step($, beneath, null, { agentId: 'a2', model: 'claude-sonnet-5-5' })
  await plan($, ROUTES, 'a1')

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  const all = await texts(ui)
  const title = all.indexOf('▤ Mapa das rotas')
  expect(title).toBeGreaterThan(all.indexOf('◇ Mapear rotas de login'))
  expect(title).toBeLessThan(all.indexOf('◇ Ler a documentação'))
  // the card without a plan stays as it was: no rule after it
  expect(all.slice(all.indexOf('◇ Ler a documentação')).some(text => text.startsWith('╌'))).toBe(false)
  expect(beneath.plans[0]?.byAgent).toBe('a1')
})

test('a finished subagent takes its finished plan to CONCLUÍDOS', async ($, on) => {
  const beneath = engine(on)
  await begin($)
  await spawn($, 'a2', 'Ler a documentação')
  await complete($, 'answer', 'a2')
  await spawn($, 'a1', 'Mapear rotas de login')
  await step($, beneath, null, { agentId: 'a1' })
  await plan($, ROUTES, 'a1')
  await plan($, { id: 'rotas', state: 'done' }, 'a1')
  await complete($, 'answer', 'a1')

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  const all = await texts(ui)
  // under its own subagent's line, before the next finished subagent
  const line = all.indexOf('▤ Mapa das rotas · ✓ 100%')
  expect(line).toBeGreaterThan(all.indexOf('CONCLUÍDOS'))
  expect(line).toBeGreaterThan(all.indexOf('✓ Mapear rotas de login'))
  expect(line).toBeLessThan(all.indexOf('✓ Ler a documentação'))
  expect(all).toContain('3 passos')
  expect(all).not.toContain('▤ Mapa das rotas')
})

test('an open plan passes to the Principal and back to its subagent on resume', async ($, on) => {
  const beneath = engine(on)
  await begin($)
  await spawn($, 'a1', 'Mapear rotas de login')
  await step($, beneath, null, { agentId: 'a1' })
  await plan($, ROUTES, 'a1')
  await complete($, 'answer', 'a1')

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  const handed = await texts(ui)
  const title = handed.indexOf('▤ Mapa das rotas')
  expect(title).toBeGreaterThan(handed.indexOf('◆ Principal'))
  expect(title).toBeLessThan(handed.indexOf('CONCLUÍDOS'))
  expect(beneath.plans[0]?.byAgent).toBeUndefined()
  expect(beneath.plans[0]?.madeBy).toBe('a1')

  // resumed under the same id, it takes back the plan it made
  await step($, beneath, null, { agentId: 'a1' })
  await plan($, { id: 'rotas', next: true }, 'a1')
  expect(beneath.plans[0]?.byAgent).toBe('a1')
  const back = await texts(ui)
  expect(back.indexOf('▤ Mapa das rotas')).toBeGreaterThan(back.indexOf('◇ Mapear rotas de login'))
})

const WIDE = { ...PANE, props: { ...PANE.props, bodyColumns: 124 } }

const isBraille = (ch: string) => ch >= '\u2801' && ch <= '\u28ff'
const dotsIn = (ch: string) =>
  isBraille(ch) ? ((ch.codePointAt(0) ?? 0x2800) - 0x2800).toString(2).replace(/0/g, '').length : 0

test('the fill is braille, sparse to dense, with stage and step marks', async ($, on) => {
  const beneath = engine(on)
  await begin($)
  await plan($, FIX_LOGIN)
  await plan($, { id: 'fix-login', next: true })
  await plan($, { id: 'fix-login', next: true })
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...WIDE })
  const bar = [...(await barOf(ui, 'fix-login'))]
  expect(bar).toHaveLength(120)

  // 2 of 6 finished: the fill runs to column 40, the pill riding its head
  const sum = (from: number, to: number) => bar.slice(from, to).reduce((n, ch) => n + dotsIn(ch), 0)
  expect(bar.slice(0, 28).filter(isBraille).length).toBeGreaterThan(10)
  expect(sum(18, 28)).toBeGreaterThan(sum(0, 10))
  // ahead: the stage boundary at step 5 (column 80), steps 4 and 6 at 60 and 100
  expect(bar[80]).toBe('│')
  expect(bar[60]).toBe('·')
  expect(bar[100]).toBe('·')
  expect(bar.slice(81, 99).every(ch => ch === ' ')).toBe(true)
})

const TERMINALS: { name: string; env: Record<string, string>; files: string[]; isRound: boolean }[] = [
  { name: 'WezTerm', env: { TERM_PROGRAM: 'WezTerm' }, files: [], isRound: true },
  { name: 'Ghostty', env: { TERM: 'xterm-ghostty' }, files: [], isRound: true },
  { name: 'kitty', env: { KITTY_WINDOW_ID: '1' }, files: [], isRound: true },
  {
    name: 'an Omarchy theme',
    env: { HOME: '/home/dev' },
    files: ['/home/dev/.local/state/omarchy/current/theme/colors.toml'],
    isRound: true,
  },
  { name: 'Windows Terminal', env: { WT_SESSION: '1', HOME: '/home/dev' }, files: [], isRound: false },
]

for (const terminal of TERMINALS) {
  test(`round ends only where the terminal draws them: ${terminal.name}`, async ($, on) => {
    engine(on, { env: terminal.env, files: terminal.files })
    await begin($)
    await plan($, FIX_LOGIN)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
    const bar = [...(await barOf(ui, 'fix-login'))]
    expect(bar[0] === '\uE0B6').toBe(terminal.isRound)
    expect(bar.at(-1) === '\uE0B4').toBe(terminal.isRound)
  })
}

test('the bar moves only while Claude works on a running plan', async ($, on) => {
  const beneath = engine(on)
  await begin($)
  await $.turn.start({ text: 'oi', turnId: 't1' })
  await plan($, FIX_LOGIN)
  await plan($, { id: 'fix-login', next: true })
  await plan($, { id: 'fix-login', next: true })
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...WIDE })

  const frames = new Set<string>()
  for (let i = 0; i < 4; i++) {
    frames.add(await barOf(ui, 'fix-login'))
    await beneath.clock.advance(1_000)
  }
  expect(frames.size).toBeGreaterThan(1)

  await complete($, 'answer')
  const standing = await barOf(ui, 'fix-login')
  await beneath.clock.advance(1_000)
  expect(await barOf(ui, 'fix-login')).toBe(standing)
  await beneath.clock.advance(1_000)
  expect(await barOf(ui, 'fix-login')).toBe(standing)

  // waiting on the person, it stands too, even in a live turn
  await $.turn.start({ text: 'segue', turnId: 't2' })
  await plan($, { id: 'fix-login', state: 'needs_input', note: 'Qual?' })
  const waiting = await barOf(ui, 'fix-login')
  await beneath.clock.advance(1_000)
  expect(await barOf(ui, 'fix-login')).toBe(waiting)
})
