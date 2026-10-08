// What the pane says of an agent: working, waiting for a prompt or a message,
// or finished, by how its last turn ended
export type RowStatus = 'running' | 'idle' | 'done' | 'stopped' | 'failed'

// Token counts summed over every model request the agent made
export type Tokens = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export type AgentRow = {
  // 'main' for the main loop, else the subagent's id
  id: string
  label: string
  // 'main', or the subagent type (Explore, general-purpose, fork...)
  kind: string
  model: string | null
  effort: string | null
  status: RowStatus
  isTeammate: boolean
  // Time spent working in earlier runs, and when the current run began
  workedMs: number
  runningSince: number | null
  tokens: Tokens
  // The latest tool call (its name, and the file, command or pattern it took)
  // and how many the agent made
  tool: string | null
  target: string | null
  toolCount: number
}

// A command the model or the person moved to the background, open until its
// notification says how it ended
export type ShellRow = {
  // The background task's id, as the tool's result and the notification name it
  id: string
  // 'Bash' or 'PowerShell'
  tool: string
  // The command's first line
  command: string
  // 'main', or the id of the subagent that started it
  agentId: string
  status: Exclude<RowStatus, 'idle'>
  startedAt: number
  endedAt: number | null
  // The engine ends it at its subagent's final answer (a synchronous subagent's command)
  endsWithAgent: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'agents-panel': {
      agents: AgentRow[]
      sessionStartedAt: number | null
      shells: ShellRow[]
    }
  }
}
