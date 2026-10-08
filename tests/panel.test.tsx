import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { AgentInfo, On, TurnCompleteReason, TurnStepInput, TurnUsage } from 'claude-code'

import type { AgentRow } from '../types'

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

// The engine beneath the plugin, answering as a session would
function engine(on: On, options: { agents?: () => AgentInfo[] } = {}) {
  const beneath = {
    opened: [] as { id: string; title?: string; columns?: number }[],
    commands: [] as string[],
    usage: null as TurnUsage | null,
    // What each tool answers, by name; a tool with none is denied
    records: {} as Record<string, unknown>,
    clock: mock.clock(on, { now: NOW }),
  }
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
  on('prompt.submit', ($, e) => ({ text: e.text }))
  // No tool runs in a test: the call ends here, after the plugin noted it,
  // with the record the test gave the tool, or denied
  on('tool.call', ($, e) => {
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

test('the main agent works, counts its tokens, and its stopwatch stops when the turn ends', async ($, on) => {
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
  await beneath.clock.advance(90_000)

  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  const all = await texts(ui)
  expect(all).toContain('sessão 0:00 · 0 ativos · 1 agente')
  expect(all).toContain('Nenhum subagente ainda.')
  expect(all).not.toContain('◇ Antes do clear')
  expect(all).not.toContain('SHELLS')
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
