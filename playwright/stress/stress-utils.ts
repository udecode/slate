import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import type {
  EditorSurfaceOptions,
  SlateBrowserRenderStateSnapshot,
  SlateBrowserScenarioReplay,
  SlateBrowserScenarioResult,
  SlateBrowserScenarioStep,
} from 'slate-browser/playwright'
import { createScenarioReplay } from 'slate-browser/playwright'

export type StressArtifactStatus = 'failed' | 'passed' | 'running'

export type StressArtifact = {
  baseURL: string | null
  contract?: StressFamilyContract
  createdAt: string
  error?: string
  family: string
  finalSnapshot?: StressFinalSnapshot
  id: string
  projectName: string
  reductionCandidates?: unknown[]
  replay: SlateBrowserScenarioReplay
  replayCommand: string
  resultPath?: string
  route: string
  seed: string
  surface?: EditorSurfaceOptions
  status: StressArtifactStatus
  steps: Record<string, unknown>[]
  traceSummary?: StressTraceSummary
  version: 1
}

export type StressFamilyContract = {
  assertions: readonly string[]
  family: string
  routes: readonly string[]
}

export type StressCase = {
  contract?: StressFamilyContract
  family: string
  id: string
  route: string
  seed: string
  surface?: EditorSurfaceOptions
  steps: SlateBrowserScenarioStep[]
}

export type StressFinalSnapshot = Pick<
  SlateBrowserRenderStateSnapshot,
  'domSelection' | 'focusOwner' | 'lastCommit' | 'renderCounts' | 'selection'
>

export type StressTraceSummary = {
  finalLabel: string | null
  stepCount: number
}

export const stressArtifactRoot = () =>
  resolve(
    process.cwd(),
    process.env.STRESS_ARTIFACT_DIR ?? 'tmp/stress-artifacts'
  )

const sanitizePathPart = (value: string) =>
  value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-|-$/g, '')

export const stressArtifactPath = (
  projectName: string,
  stressCase: Pick<StressCase, 'family' | 'id' | 'route'>
) =>
  resolve(
    stressArtifactRoot(),
    sanitizePathPart(projectName),
    sanitizePathPart(stressCase.route),
    `${sanitizePathPart(stressCase.id)}.json`
  )

export const stressResultPath = (artifactPath: string) =>
  artifactPath.replace(/\.json$/u, '.result.json')

const serializeError = (error: unknown) => {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}\n${error.stack ?? ''}`.trim()
  }

  return String(error)
}

export const createStressArtifact = ({
  artifactPath,
  error,
  finalSnapshot,
  projectName,
  reductionCandidates,
  result,
  resultPath,
  status,
  stressCase,
}: {
  artifactPath: string
  error?: unknown
  finalSnapshot?: StressFinalSnapshot
  projectName: string
  reductionCandidates?: unknown[]
  result?: SlateBrowserScenarioResult
  resultPath?: string
  status: StressArtifactStatus
  stressCase: StressCase
}): StressArtifact => {
  const replay = createScenarioReplay(stressCase.steps)
  const lastTraceEntry = result?.trace.at(-1) ?? null

  return {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? null,
    contract: stressCase.contract,
    createdAt: new Date().toISOString(),
    error: error === undefined ? undefined : serializeError(error),
    family: stressCase.family,
    finalSnapshot,
    id: stressCase.id,
    projectName,
    reductionCandidates,
    replay,
    replayCommand: `STRESS_REPLAY=${artifactPath} bun test:stress:replay`,
    resultPath,
    route: stressCase.route,
    seed: stressCase.seed,
    surface: stressCase.surface,
    status,
    steps: replay.steps.map((step) => step.value),
    traceSummary: result
      ? {
          finalLabel: lastTraceEntry?.label ?? null,
          stepCount: result.trace.length,
        }
      : undefined,
    version: 1,
  }
}

export const writeStressArtifact = (
  artifactPath: string,
  artifact: StressArtifact
) => {
  mkdirSync(dirname(artifactPath), { recursive: true })
  writeFileSync(artifactPath, JSON.stringify(artifact, null, 2))
}

export const readStressArtifact = (artifactPath: string): StressArtifact => {
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf8')) as unknown

  if (!artifact || typeof artifact !== 'object') {
    throw new Error(`Stress replay artifact is not an object: ${artifactPath}`)
  }

  const record = artifact as Partial<StressArtifact>

  if (
    record.version !== 1 ||
    typeof record.route !== 'string' ||
    typeof record.family !== 'string' ||
    !Array.isArray(record.steps)
  ) {
    throw new Error(
      `Stress replay artifact has an unsupported shape: ${artifactPath}`
    )
  }

  return record as StressArtifact
}

export const artifactStepsToScenarioSteps = (
  artifact: StressArtifact
): SlateBrowserScenarioStep[] => artifact.steps as SlateBrowserScenarioStep[]
