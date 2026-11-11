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

// A plan's steps, as plan-progress's plan_progress tool takes them
export type StepStatus = 'pending' | 'active' | 'done' | 'error' | 'skipped'
export type PlanSubstep = { title: string; status: StepStatus }
// doneAt: when the step was finished, so the pane can tell how long it took
export type PlanStep = { title: string; status: StepStatus; substeps: PlanSubstep[]; doneAt?: number }
export type PlanStage = { name: string; steps: PlanStep[] }
export type PlanState = 'running' | 'needs_input' | 'error' | 'done'

export type Plan = {
  id: string
  title: string
  kind: 'plan' | 'todo'
  stages: PlanStage[]
  state: PlanState
  note: string | null
  startedAt: number
  // When the plan was finished, for the time it took
  endedAt: number | null
  // The subagent that created it; absent, the main conversation did
  madeBy?: string
  // The subagent that moves it now, in whose frame it shows; absent, the main conversation's
  byAgent?: string
}

// What the person closed with an X: each subagent, by its own frame or by
// CONCLUÍDOS, keyed to what it had done then (it shows again once that
// changes), and the shells the SHELLS frame held
export type ClosedFrames = {
  agents: Record<string, string>
  shells: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'agents-panel': {
      agents: AgentRow[]
      sessionStartedAt: number | null
      shells: ShellRow[]
      plans: Plan[]
      closed: ClosedFrames
    }
  }
}
