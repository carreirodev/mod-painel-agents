import { atom, read, update } from 'claude-code'
import type {
  AgentInfo,
  EngineInterface,
  Register,
  StateDollar,
  TurnCompleteReason,
  TurnUsage,
} from 'claude-code'

import type { AgentRow, RowStatus, ShellRow, Tokens } from '../types'

const PANE = 'agents'
const TITLE = 'Agentes'
const MAIN = 'main'
// Width the dock opens at; a width the person drags it to wins
const COLUMNS = 46
// Redraws every second so the clock, the stopwatches and the spinner move
const TICK_MS = 1000
// Finished subagents kept in the list, the oldest dropped first
const KEEP_FINISHED = 30
// Finished shells kept in the list, the oldest dropped first
const KEEP_FINISHED_SHELLS = 10

const agents = atom({ plugin: 'agents-panel', key: 'agents' } as const, [])
const sessionStartedAt = atom({ plugin: 'agents-panel', key: 'sessionStartedAt' } as const, null)
const shells = atom({ plugin: 'agents-panel', key: 'shells' } as const, [])

const INK = '#0b0b0b' // text over a colored badge
const FRAME = '#64748b'
const HEADING = '#e2e8f0'
const CLOCK = '#67e8f9'
const LABEL = '#6b7280'
const VALUE = '#e5e7eb'
const TOKENS_IN = '#38bdf8'
const TOKENS_OUT = '#f87171'
const CACHE = '#a3e635'
const FADED = '#4b5563'

const TOOL_COLORS: Record<string, string> = {
  Bash: '#facc15',
  PowerShell: '#facc15',
  Read: '#67e8f9',
  Grep: '#4ade80',
  Glob: '#4ade80',
  Edit: '#fb923c',
  Write: '#fb923c',
  NotebookEdit: '#fb923c',
  WebFetch: '#60a5fa',
  WebSearch: '#60a5fa',
  Agent: '#b0bec5',
  Skill: '#b0bec5',
}
const OTHER_TOOL = '#cbd5e1'

// The argument that says what a call works on, by the first one it carries
const TARGET_KEYS = ['command', 'file_path', 'notebook_path', 'pattern', 'url', 'query', 'description', 'skill']

const FAMILY_COLORS: Record<string, string> = {
  opus: '#b0bec5',
  sonnet: '#60a5fa',
  haiku: '#34d399',
  fable: '#fbbf24',
}
const OTHER_MODEL = '#94a3b8'

const EFFORT_COLORS: Record<string, string> = {
  low: '#94a3b8',
  medium: '#22d3ee',
  high: '#facc15',
  xhigh: '#fb923c',
  max: '#f43f5e',
}
const OTHER_EFFORT = '#cbd5e1'

const STATUS: Record<RowStatus, { icon: string; word: string; color: string }> = {
  running: { icon: '●', word: 'ATIVO', color: '#22c55e' },
  idle: { icon: '◌', word: 'OCIOSO', color: '#64748b' },
  done: { icon: '✓', word: 'FEITO', color: '#14b8a6' },
  stopped: { icon: '■', word: 'PARADO', color: '#f59e0b' },
  failed: { icon: '✗', word: 'ERRO', color: '#ef4444' },
}

const SPINNER = ['◐', '◓', '◑', '◒']

const emptyTokens = (): Tokens => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })

const mainRow = (): AgentRow => ({
  id: MAIN,
  label: 'Principal',
  kind: MAIN,
  model: null,
  effort: null,
  status: 'idle',
  isTeammate: false,
  workedMs: 0,
  runningSince: null,
  tokens: emptyTokens(),
  tool: null,
  target: null,
  toolCount: 0,
})

// A subagent first seen by one of its events: it is working
const subRow = (id: string, now: number): AgentRow => ({
  ...mainRow(),
  id,
  label: 'Subagente',
  kind: 'agent',
  status: 'running',
  runningSince: now,
})

const seedFor = (id: string, now: number) => () => (id === MAIN ? mainRow() : subRow(id, now))

const start = (row: AgentRow, now: number): AgentRow => ({
  ...row,
  status: 'running',
  runningSince: row.runningSince ?? now,
})

const stop = (row: AgentRow, now: number, status: RowStatus): AgentRow => ({
  ...row,
  status,
  workedMs: row.workedMs + (row.runningSince === null ? 0 : now - row.runningSince),
  runningSince: null,
})

const worked = (row: AgentRow, now: number) =>
  row.workedMs + (row.runningSince === null ? 0 : now - row.runningSince)

const plus = (tokens: Tokens, usage: TurnUsage): Tokens => ({
  input: tokens.input + usage.input_tokens,
  output: tokens.output + usage.output_tokens,
  cacheRead: tokens.cacheRead + usage.cache_read_input_tokens,
  cacheWrite: tokens.cacheWrite + usage.cache_creation_input_tokens,
})

// Every input token the requests carried, cached or not
const tokensIn = (tokens: Tokens) => tokens.input + tokens.cacheRead + tokens.cacheWrite

// "mcp__plugin_linear_linear__get_issue" -> "get_issue"
const toolName = (tool: string) => tool.replace(/^mcp__.*__/, '')

// What a call works on: a file by its name, a site by its host, a command by
// its first line, anything else as given
function targetOf(args: Readonly<Record<string, unknown>>): string | null {
  for (const key of TARGET_KEYS) {
    const value = args[key]
    if (typeof value !== 'string' || value.trim() === '') {
      continue
    }
    if (key === 'file_path' || key === 'notebook_path') {
      return value.replace(/[\\/]+$/, '').replace(/.*[\\/]/, '')
    }
    if (key === 'url') {
      return value.replace(/^[a-z]+:\/\//i, '').replace(/[/?#].*$/, '')
    }
    return (value.trim().split('\n')[0] ?? '').replace(/\s+/g, ' ')
  }
  return null
}

const toolColor = (tool: string) => TOOL_COLORS[tool] ?? OTHER_TOOL

const isFinished = (row: AgentRow) =>
  row.status === 'done' || row.status === 'stopped' || row.status === 'failed'

// Main idles between prompts and a teammate between messages; any other
// subagent is over once its turn ends
function ended(row: AgentRow, reason: TurnCompleteReason): RowStatus {
  if (row.id === MAIN || (row.isTeammate && reason === 'answer')) {
    return 'idle'
  }
  return reason === 'answer' ? 'done' : reason === 'aborted' ? 'stopped' : 'failed'
}

const describe = (info: AgentInfo) => ({
  label: info.description || info.name || info.type,
  kind: info.type,
  isTeammate: info.teammateId !== undefined,
})

function prune(rows: AgentRow[]): AgentRow[] {
  const finished = rows.filter(isFinished)
  if (finished.length <= KEEP_FINISHED) {
    return rows
  }
  const dropped = new Set(finished.slice(0, finished.length - KEEP_FINISHED).map(row => row.id))
  return rows.filter(row => !dropped.has(row.id))
}

// Applies change to the row of id, made from seed when the list has none
const patch = ($: StateDollar, id: string, change: (row: AgentRow) => AgentRow, seed: () => AgentRow) =>
  update($, agents, rows => {
    const found = rows.find(row => row.id === id)
    const changed = change(found ?? seed())
    return prune(found ? rows.map(row => (row.id === id ? changed : row)) : [...rows, changed])
  })

// The tools whose commands can move to the background
const SHELL_TOOLS = new Set(['Bash', 'PowerShell'])

// How a notification says a background task ended
const SHELL_ENDS: Record<string, ShellRow['status']> = {
  completed: 'done',
  failed: 'failed',
  killed: 'stopped',
}

// One field of a tool's record, whatever shape the record has
const fieldOf = (record: unknown, key: string): unknown =>
  typeof record === 'object' && record !== null
    ? Object.entries(record).find(([name]) => name === key)?.[1]
    : undefined

// "<task-notification>\n<task-id>b1</task-id>\n...<status>completed</status>..."
// -> b1 => completed, for every notification the text carries
function notifiedEnds(text: string): Map<string, string> {
  const ends = new Map<string, string>()
  for (const block of text.split('<task-notification>').slice(1)) {
    const id = /<task-id>([^<]+)<\/task-id>/.exec(block)?.[1]?.trim()
    const status = /<status>([^<]+)<\/status>/.exec(block)?.[1]?.trim()
    if (id && status) {
      ends.set(id, status)
    }
  }
  return ends
}

function pruneShells(rows: ShellRow[]): ShellRow[] {
  const finished = rows.filter(row => row.status !== 'running')
  if (finished.length <= KEEP_FINISHED_SHELLS) {
    return rows
  }
  const dropped = new Set(finished.slice(0, finished.length - KEEP_FINISHED_SHELLS).map(row => row.id))
  return rows.filter(row => !dropped.has(row.id))
}

// Ends each open shell pick gives a status to
const closeShells = ($: StateDollar, now: number, pick: (shell: ShellRow) => ShellRow['status'] | undefined) =>
  update($, shells, rows =>
    pruneShells(
      rows.map(shell => {
        const status = shell.status === 'running' ? pick(shell) : undefined
        return status === undefined ? shell : { ...shell, status, endedAt: now }
      }),
    ),
  )

const LIST_STATUS: Partial<Record<AgentInfo['status'], RowStatus>> = {
  completed: 'done',
  failed: 'failed',
  killed: 'stopped',
}

// Closes the rows of subagents the engine ended without a turn.complete
// reaching this plugin (a stopped task, say)
async function reconcile($: EngineInterface) {
  const rows = await read($, agents)
  if (!rows.some(row => row.id !== MAIN && row.status === 'running')) {
    return
  }
  const [list, now] = await Promise.all([$.agent.list(), $.clock.now()])
  const over = new Map<string, RowStatus>()
  for (const info of list) {
    const status = LIST_STATUS[info.status]
    if (status !== undefined) {
      over.set(info.id, status)
    }
  }
  if (!rows.some(row => row.status === 'running' && over.has(row.id))) {
    return
  }
  await update($, agents, current =>
    current.map(row => {
      const status = row.status === 'running' ? over.get(row.id) : undefined
      return status === undefined ? row : stop(row, now, status)
    }),
  )
}

const pad = (n: number) => String(n).padStart(2, '0')

// 75_000 -> "1:15", 3_725_000 -> "1:02:05"
function stopwatch(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds % 60)}`
    : `${minutes}:${pad(seconds % 60)}`
}

function clockOf(now: number): string {
  const date = new Date(now)
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

// 950 -> "950", 12_340 -> "12,3k", 3_400_000 -> "3,4M" (Brazilian decimal comma)
function compact(n: number): string {
  if (n < 1000) {
    return String(n)
  }
  const [value, unit] = n < 999_500 ? [n / 1000, 'k'] : [n / 1_000_000, 'M']
  const shown = value < 99.95 ? value.toFixed(1) : value.toFixed(0)
  return `${shown.replace(/\.0$/, '').replace('.', ',')}${unit}`
}

const percent = (share: number) => `${Math.round(share * 100)}%`

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

const capitalize = (word: string) => word.charAt(0).toUpperCase() + word.slice(1)

// "claude-opus-5-5[1m]" -> "Opus 5.5 1M", "sonnet" -> "Sonnet"
function shortModel(model: string): string {
  const id = /^claude-([a-z]+)-(\d+(?:-\d{1,2})*)(?:-\d{8})?(\[1m\])?$/i.exec(model)
  if (id) {
    const [, family = '', version = '', long] = id
    return `${capitalize(family)} ${version.replace(/-/g, '.')}${long ? ' 1M' : ''}`
  }
  const alias = /^([a-z]+)(\[1m\])?$/.exec(model)
  if (alias) {
    const [, name = '', long] = alias
    return `${capitalize(name)}${long ? ' 1M' : ''}`
  }
  return model
}

function familyColor(model: string | null): string {
  const family = model === null ? undefined : /opus|sonnet|haiku|fable/i.exec(model)?.[0]
  return (family === undefined ? undefined : FAMILY_COLORS[family.toLowerCase()]) ?? OTHER_MODEL
}

const effortColor = (effort: string) => EFFORT_COLORS[effort] ?? OTHER_EFFORT

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'painel-agentes', description: 'Abre o painel lateral dos agentes' })
    const [now, model] = await Promise.all([$.clock.now(), $.session.model()])
    await update($, sessionStartedAt, at => at ?? now)
    // A reload keeps the rows an earlier version of this module wrote, without the newer fields
    await update($, agents, rows =>
      rows.map(row => ({
        ...row,
        tool: row.tool ?? null,
        target: row.target ?? null,
        toolCount: row.toolCount ?? 0,
      })),
    )
    await patch($, MAIN, row => ({ ...row, model: row.model ?? model }), mainRow)
    $.clock.every(TICK_MS, () => {
      void reconcile($)
      $.ui.invalidate('ui.render')
    })
    void $.ui.open({ id: PANE, title: TITLE, columns: COLUMNS })
    return next(e)
  })

  on('command.run', { command: 'painel-agentes' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE, columns: COLUMNS })
    return { text: 'Painel de agentes aberto.' }
  })

  on('session.end', async ($, e, next) => {
    // A /clear starts the session over with no session.start
    if (e.reason === 'clear') {
      const now = await $.clock.now()
      await update($, agents, rows => [
        { ...mainRow(), model: rows.find(row => row.id === MAIN)?.model ?? null },
      ])
      await update($, sessionStartedAt, () => now)
      await update($, shells, () => [])
    }
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    const now = await $.clock.now()
    await patch($, MAIN, row => start(row, now), mainRow)
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    const id = spawned.agentId
    if (id !== undefined) {
      const now = await $.clock.now()
      await patch(
        $,
        id,
        row => ({
          ...row,
          label: e.description || e.name || e.subagentType,
          kind: e.subagentType,
          isTeammate: e.isTeammate === true,
          model: row.model ?? spawned.model,
        }),
        () => subRow(id, now),
      )
    }
    return spawned
  })

  on('turn.step', async function* ($, e, next) {
    const id = e.agentId ?? MAIN
    const now = await $.clock.now()
    const effort = e.effort === undefined ? null : String(e.effort)
    // A subagent spawned before this module loaded is known by the engine alone
    const isKnown = (await read($, agents)).some(row => row.id === id)
    const info = isKnown || id === MAIN ? undefined : (await $.agent.list()).find(one => one.id === id)
    await patch(
      $,
      id,
      row => ({ ...start(row, now), model: e.model, effort, ...(info ? describe(info) : {}) }),
      seedFor(id, now),
    )

    const response = yield* next(e)

    const usage = response.usage
    if (usage !== null) {
      await patch($, id, row => ({ ...row, tokens: plus(row.tokens, usage) }), seedFor(id, now))
    }
    return response
  })

  on('turn.complete', async ($, e, next) => {
    const id = e.agentId ?? MAIN
    const now = await $.clock.now()
    await patch($, id, row => stop(row, now, ended(row, e.reason)), seedFor(id, now))
    // A synchronous subagent's background commands end with its final answer
    if (e.agentId !== undefined) {
      await closeShells($, now, shell => (shell.agentId === id && shell.endsWithAgent ? 'stopped' : undefined))
    }
    return next(e)
  })

  // Noted as the call starts, so the pane shows what each agent is doing now
  on('tool.call', async ($, e, next) => {
    const id = e.agentId ?? MAIN
    const now = await $.clock.now()
    const tool = toolName(e.tool)
    const target = targetOf(e)
    await patch($, id, row => ({ ...row, tool, target, toolCount: row.toolCount + 1 }), seedFor(id, now))
    const answer = await next(e)
    if (answer.deny !== undefined || answer.isError === true) {
      return answer
    }
    // A command moved to the background: by run_in_background, Ctrl+B or its timeout
    const taskId = SHELL_TOOLS.has(e.tool) ? fieldOf(answer.result, 'backgroundTaskId') : undefined
    if (typeof taskId === 'string' && taskId !== '') {
      const shell: ShellRow = {
        id: taskId,
        tool,
        command: target ?? '',
        agentId: id,
        status: 'running',
        startedAt: now,
        endedAt: null,
        endsWithAgent: fieldOf(answer.result, 'backgroundEndsWithFinalResponse') === true,
      }
      await update($, shells, rows => [...rows.filter(row => row.id !== taskId), shell])
    }
    if (e.tool === 'TaskStop') {
      const stopped = fieldOf(answer.result, 'task_id')
      await closeShells($, await $.clock.now(), shell => (shell.id === stopped ? 'stopped' : undefined))
    }
    return answer
  })

  // A background task's notification says how a shell ended; only the
  // engine's own notifications count, never a prompt the person typed
  on('prompt.submit', async ($, e, next) => {
    const ends = e.origin.kind === 'task-notification' ? notifiedEnds(e.text) : new Map<string, string>()
    if (ends.size > 0) {
      const now = await $.clock.now()
      await closeShells($, now, shell => {
        const word = ends.get(shell.id)
        return word === undefined ? undefined : (SHELL_ENDS[word] ?? 'done')
      })
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const [rows, startedAt, shellRows, now] = await Promise.all([
      read($, agents),
      read($, sessionStartedAt),
      read($, shells),
      $.clock.now(),
    ])

    const main = rows.find(row => row.id === MAIN) ?? mainRow()
    const subagents = rows.filter(row => row.id !== MAIN)
    const active = subagents.filter(row => !isFinished(row))
    const finished = subagents.filter(isFinished).reverse()
    const running = rows.filter(row => row.status === 'running').length
    const sumIn = rows.reduce((sum, row) => sum + tokensIn(row.tokens), 0)
    const sumOut = rows.reduce((sum, row) => sum + row.tokens.output, 0)
    const spinner = SPINNER[Math.floor(now / TICK_MS) % SPINNER.length] ?? STATUS.running.icon
    const openShells = shellRows.filter(shell => shell.status === 'running')
    const closedShells = shellRows
      .filter(shell => shell.status !== 'running')
      .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))

    // The latest tool call, bright while the agent works and grey after
    const activity = (row: AgentRow) => {
      const isRunning = row.status === 'running'
      return (
        <Box justifyContent="space-between">
          <Box flexShrink={1} marginRight={1}>
            <Text wrap="truncate-end">
              {row.tool === null && (
                <Text color={LABEL}>{isRunning ? '▸ pensando…' : 'nenhuma ferramenta'}</Text>
              )}
              {row.tool !== null && (
                <Text color={isRunning ? STATUS.running.color : LABEL}>{isRunning ? '▸ ' : 'última: '}</Text>
              )}
              {row.tool !== null && (
                <Text color={isRunning ? toolColor(row.tool) : LABEL} bold={isRunning}>
                  {row.tool}
                </Text>
              )}
              {row.target !== null && <Text color={isRunning ? VALUE : LABEL}>  {row.target}</Text>}
            </Text>
          </Box>
          {row.toolCount > 0 && (
            <Box flexShrink={0}>
              <Text color={LABEL}>{plural(row.toolCount, 'ferramenta', 'ferramentas')}</Text>
            </Box>
          )}
        </Box>
      )
    }

    const timer = (row: AgentRow) => (
      <Box flexShrink={0}>
        <Text color={CLOCK}>◔ {stopwatch(worked(row, now))}</Text>
      </Box>
    )

    const badge = (row: AgentRow) => {
      const status = STATUS[row.status]
      const icon = row.status === 'running' ? spinner : status.icon
      return (
        <Box flexShrink={0}>
          <Text backgroundColor={status.color} color={INK} bold>
            {` ${icon} ${status.word} `}
          </Text>
        </Box>
      )
    }

    const card = (row: AgentRow) => {
      const isMain = row.id === MAIN
      const color = familyColor(row.model)
      const cacheShare = tokensIn(row.tokens) === 0 ? 0 : row.tokens.cacheRead / tokensIn(row.tokens)
      return (
        <Box flexDirection="column" borderStyle={isMain ? 'double' : 'round'} borderColor={color} paddingX={1}>
          <Box justifyContent="space-between">
            <Box flexShrink={1} marginRight={1}>
              <Text bold color={color} wrap="truncate-end">
                {isMain ? '◆' : '◇'} {row.label}
              </Text>
            </Box>
            {badge(row)}
          </Box>
          <Box justifyContent="space-between">
            <Box flexShrink={1} marginRight={1}>
              <Text wrap="truncate-end">
                {!isMain && <Text color={LABEL}>{row.kind} · </Text>}
                <Text backgroundColor={color} color={INK} bold>
                  {` ${row.model === null ? '…' : shortModel(row.model)} `}
                </Text>
                {row.effort !== null && (
                  <Text color={effortColor(row.effort)} bold>
                    {' '}
                    {row.effort}
                  </Text>
                )}
              </Text>
            </Box>
            {timer(row)}
          </Box>
          <Text wrap="truncate-end">
            <Text color={TOKENS_IN}>↑ </Text>
            <Text color={VALUE}>{compact(tokensIn(row.tokens))}</Text>
            <Text color={LABEL}> entrada  </Text>
            <Text color={TOKENS_OUT}>↓ </Text>
            <Text color={VALUE}>{compact(row.tokens.output)}</Text>
            <Text color={LABEL}> saída  </Text>
            <Text color={CACHE}>↻ </Text>
            <Text color={VALUE}>{percent(cacheShare)}</Text>
            <Text color={LABEL}> cache</Text>
          </Text>
          {activity(row)}
        </Box>
      )
    }

    const line = (row: AgentRow) => {
      const status = STATUS[row.status]
      return (
        <Box flexDirection="column">
          <Box justifyContent="space-between">
            <Box flexShrink={1} marginRight={1}>
              <Text wrap="truncate-end">
                <Text color={status.color} bold>
                  {status.icon}{' '}
                </Text>
                <Text color={VALUE}>{row.label}</Text>
              </Text>
            </Box>
            {timer(row)}
          </Box>
          <Box paddingLeft={2}>
            <Text wrap="truncate-end">
              <Text color={familyColor(row.model)}>{row.model === null ? '…' : shortModel(row.model)}</Text>
              {row.effort !== null && <Text color={effortColor(row.effort)}> {row.effort}</Text>}
              <Text color={LABEL}> · </Text>
              <Text color={TOKENS_IN}>↑{compact(tokensIn(row.tokens))}</Text>
              <Text color={TOKENS_OUT}> ↓{compact(row.tokens.output)}</Text>
            </Text>
          </Box>
          <Box paddingLeft={2}>{activity(row)}</Box>
        </Box>
      )
    }

    const ownerOf = (shell: ShellRow) =>
      shell.agentId === MAIN ? 'Principal' : (rows.find(row => row.id === shell.agentId)?.label ?? 'Subagente')

    const shellLine = (shell: ShellRow) => {
      const isOpen = shell.status === 'running'
      const status = STATUS[shell.status]
      return (
        <Box flexDirection="column">
          <Box justifyContent="space-between">
            <Box flexShrink={1} marginRight={1}>
              <Text wrap="truncate-end">
                <Text color={status.color} bold>
                  {isOpen ? spinner : status.icon}{' '}
                </Text>
                <Text color={isOpen ? VALUE : LABEL}>{shell.command}</Text>
              </Text>
            </Box>
            <Box flexShrink={0}>
              <Text color={CLOCK}>◔ {stopwatch((shell.endedAt ?? now) - shell.startedAt)}</Text>
            </Box>
          </Box>
          <Box paddingLeft={2}>
            <Text wrap="truncate-end" color={LABEL}>
              {shell.tool} · {ownerOf(shell)} · {shell.id}
            </Text>
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Box flexDirection="column" borderStyle="round" borderColor={FRAME} paddingX={1}>
          <Box justifyContent="space-between">
            <Text bold color={HEADING}>
              ✦ AGENTES
            </Text>
            <Text bold color={CLOCK}>
              ◷ {clockOf(now)}
            </Text>
          </Box>
          <Text wrap="truncate-end">
            <Text color={LABEL}>sessão </Text>
            <Text color={VALUE}>{stopwatch(now - (startedAt ?? now))}</Text>
            <Text color={LABEL}> · </Text>
            <Text color={STATUS.running.color} bold>
              {plural(running, 'ativo', 'ativos')}
            </Text>
            <Text color={LABEL}> · </Text>
            <Text color={VALUE}>{plural(rows.length, 'agente', 'agentes')}</Text>
          </Text>
          <Text wrap="truncate-end">
            <Text color={TOKENS_IN}>↑ </Text>
            <Text color={VALUE}>{compact(sumIn)}</Text>
            <Text color={LABEL}> entrada  </Text>
            <Text color={TOKENS_OUT}>↓ </Text>
            <Text color={VALUE}>{compact(sumOut)}</Text>
            <Text color={LABEL}> saída</Text>
          </Text>
        </Box>
        {card(main)}
        {active.map(card)}
        {active.length === 0 && finished.length === 0 && (
          <Box borderStyle="round" borderColor={FADED} paddingX={1}>
            <Text color={LABEL}>Nenhum subagente ainda.</Text>
          </Box>
        )}
        {shellRows.length > 0 && (
          <Box
            flexDirection="column"
            borderStyle="round"
            borderColor={openShells.length > 0 ? FRAME : FADED}
            paddingX={1}
          >
            <Box justifyContent="space-between">
              <Text bold color={openShells.length > 0 ? HEADING : LABEL}>
                SHELLS
              </Text>
              <Text color={openShells.length > 0 ? STATUS.running.color : LABEL}>
                {plural(openShells.length, 'aberto', 'abertos')}
              </Text>
            </Box>
            {openShells.map(shellLine)}
            {closedShells.map(shellLine)}
          </Box>
        )}
        {finished.length > 0 && (
          <Box flexDirection="column" borderStyle="round" borderColor={FADED} paddingX={1}>
            <Text bold color={LABEL}>
              CONCLUÍDOS
            </Text>
            {finished.map(line)}
          </Box>
        )}
      </Box>
    )
  })
}
