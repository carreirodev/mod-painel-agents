// The plan block an agent's card draws under a dashed rule in the card's colour,
// as the approved mockup lays it out: the title and a badge of the plan's state
// and time, the bar, the stages and their steps, Claude's note, and the plans
// already finished one line each. Also the line a finished subagent's plan
// keeps in CONCLUÍDOS

import type { BoxProps, ElementConstructor, RasterProps, RenderElement, TextProps } from 'claude-code'

import type { Plan, PlanState, PlanStep } from '../types'
import { FADED, HEADING, INK, LABEL, VALUE, plural, stopwatch } from './look'
import { isFinished, stepTimes } from './plan'
import { PLAN_COLORS, pillText, trackCells } from './track'

export type PlanElements = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  // The terminal's cell grid; null on a surface that has none, where the pill is drawn as text
  Raster: ElementConstructor<RasterProps> | null
}

export type PlanBlockOptions = {
  // The owner's plans, oldest first
  plans: readonly Plan[]
  // The card's colour, for the dashed rule
  color: string
  // The columns inside the card: the rule and the bar take them all
  columns: number
  now: number
  // The pane's spinner frame, for a running plan's badge
  spinner: string
  isMoving: (p: Plan) => boolean
  hasRoundEnds: boolean
}

const BAR_ICON: Record<Exclude<PlanState, 'running'>, string> = { needs_input: '?', error: '✗', done: '✓' }

const timeOf = (p: Plan, now: number) => (p.endedAt ?? now) - p.startedAt

// Every open plan in full; with none open, the latest finished one; every other
// finished plan as one line under them
export function framePlans(list: readonly Plan[]): { full: Plan[]; lines: Plan[] } {
  const open = list.filter(p => p.state !== 'done')
  const finished = list.filter(p => p.state === 'done')
  const full = open.length > 0 ? open : finished.slice(-1)
  return { full, lines: finished.filter(p => !full.includes(p)).reverse() }
}

export function planBlock(els: PlanElements, o: PlanBlockOptions): RenderElement | null {
  const { Box, Text, Raster } = els
  const { full, lines } = framePlans(o.plans)
  if (full.length === 0) return null

  const stepLine = (p: Plan, step: PlanStep, took: number | undefined) => {
    const isActive = step.status === 'active' && p.state !== 'done'
    const isDone = isFinished(step.status)
    const mark = isDone
      ? { icon: '✓', color: PLAN_COLORS.done }
      : step.status === 'error'
        ? { icon: '✗', color: PLAN_COLORS.error }
        : isActive && p.state !== 'running'
          ? { icon: BAR_ICON[p.state], color: PLAN_COLORS[p.state] }
          : isActive
            ? { icon: '▸', color: PLAN_COLORS.running }
            : { icon: '·', color: FADED }
    return (
      <Box justifyContent="space-between" paddingLeft={2}>
        <Box flexShrink={1} marginRight={1}>
          <Text wrap="truncate-end">
            <Text color={mark.color} bold>
              {mark.icon}{' '}
            </Text>
            <Text color={isActive ? VALUE : isDone ? LABEL : FADED} bold={isActive}>
              {step.title}
            </Text>
          </Text>
        </Box>
        {took !== undefined && (
          <Box flexShrink={0}>
            <Text color={LABEL}>{stopwatch(took)}</Text>
          </Box>
        )}
      </Box>
    )
  }

  const block = (p: Plan) => {
    const color = PLAN_COLORS[p.state]
    const icon = p.state === 'running' ? o.spinner : BAR_ICON[p.state]
    const times = stepTimes(p)
    return (
      <Box flexDirection="column">
        <Box justifyContent="space-between">
          <Box flexShrink={1} marginRight={1}>
            <Text wrap="truncate-end">
              <Text color={HEADING}>▤ </Text>
              <Text color={VALUE} bold>
                {p.title}
              </Text>
            </Text>
          </Box>
          <Box flexShrink={0}>
            <Text backgroundColor={color} color={INK} bold>
              {` ${icon} ${stopwatch(timeOf(p, o.now))} `}
            </Text>
          </Box>
        </Box>
        {Raster ? (
          <Raster
            key={`bar-${p.id}`}
            columns={o.columns}
            rows={1}
            cells={trackCells(p, o.columns, { now: o.now, isMoving: o.isMoving(p), hasRoundEnds: o.hasRoundEnds })}
          />
        ) : (
          <Text wrap="truncate-end">
            <Text backgroundColor={color} color={INK} bold>
              {` ${pillText(p, o.columns - 2)} `}
            </Text>
          </Text>
        )}
        {p.stages.map((stage, i) => {
          const isStageDone = stage.steps.every(st => isFinished(st.status))
          if (isStageDone) {
            const took = times.stages[i]
            return (
              <Box justifyContent="space-between">
                <Box flexShrink={1} marginRight={1}>
                  <Text wrap="truncate-end">
                    <Text color={PLAN_COLORS.done} bold>
                      ✓{' '}
                    </Text>
                    <Text color={LABEL} bold>
                      {stage.name}
                    </Text>
                    <Text color={LABEL}>
                      {' '}
                      {stage.steps.length}/{stage.steps.length}
                    </Text>
                  </Text>
                </Box>
                {took !== undefined && (
                  <Box flexShrink={0}>
                    <Text color={LABEL}>{stopwatch(took)}</Text>
                  </Box>
                )}
              </Box>
            )
          }
          return (
            <Box flexDirection="column">
              <Text bold color={HEADING} wrap="truncate-end">
                {stage.name}
              </Text>
              {stage.steps.map(step => stepLine(p, step, times.steps.get(step)))}
            </Box>
          )
        })}
        {p.note !== null && (p.state === 'needs_input' || p.state === 'error') && (
          <Box paddingLeft={2}>
            <Text color={color} wrap="truncate-end">
              {p.note}
            </Text>
          </Box>
        )}
      </Box>
    )
  }

  const finishedLine = (p: Plan) => (
    <Box justifyContent="space-between">
      <Box flexShrink={1} marginRight={1}>
        <Text wrap="truncate-end">
          <Text color={PLAN_COLORS.done} bold>
            ✓{' '}
          </Text>
          <Text color={LABEL}>{p.title}</Text>
          <Text color={LABEL}> · 100%</Text>
        </Text>
      </Box>
      <Box flexShrink={0}>
        <Text color={LABEL}>◔ {stopwatch(timeOf(p, o.now))}</Text>
      </Box>
    </Box>
  )

  return (
    <Box flexDirection="column">
      <Text color={o.color} wrap="truncate-end">
        {'╌'.repeat(Math.max(1, o.columns))}
      </Text>
      {full.map(block)}
      {lines.map(finishedLine)}
    </Box>
  )
}

// A finished subagent's finished plan, in CONCLUÍDOS: "▤ <title> · ✓ 100%" and its steps
export function finishedPlanLine(els: Pick<PlanElements, 'Box' | 'Text'>, p: Plan): RenderElement {
  const { Box, Text } = els
  const steps = p.stages.reduce((sum, s) => sum + s.steps.length, 0)
  return (
    <Box justifyContent="space-between" paddingLeft={2}>
      <Box flexShrink={1} marginRight={1}>
        <Text wrap="truncate-end">
          <Text color={LABEL}>▤ </Text>
          <Text color={LABEL}>{p.title}</Text>
          <Text color={PLAN_COLORS.done}> · ✓ 100%</Text>
        </Text>
      </Box>
      <Box flexShrink={0}>
        <Text color={LABEL}>{plural(steps, 'passo', 'passos')}</Text>
      </Box>
    </Box>
  )
}
