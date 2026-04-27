import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import type {
  SlateBrowserScenarioReplay,
  SlateBrowserScenarioStep,
} from 'slate-browser/playwright'
import { createScenarioReplay } from 'slate-browser/playwright'

export type StressArtifactStatus = 'failed' | 'passed' | 'running'

export type StressArtifact = {
  baseURL: string | null
  createdAt: string
  error?: string
  family: string
  id: string
  projectName: string
  reductionCandidates?: unknown[]
  replay: SlateBrowserScenarioReplay
  resultPath?: string
  route: string
  status: StressArtifactStatus
  steps: Record<string, unknown>[]
  version: 1
}

export type StressCase = {
  family: string
  id: string
  route: string
  steps: SlateBrowserScenarioStep[]
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
  error,
  projectName,
  reductionCandidates,
  resultPath,
  status,
  stressCase,
}: {
  error?: unknown
  projectName: string
  reductionCandidates?: unknown[]
  resultPath?: string
  status: StressArtifactStatus
  stressCase: StressCase
}): StressArtifact => {
  const replay = createScenarioReplay(stressCase.steps)

  return {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? null,
    createdAt: new Date().toISOString(),
    error: error === undefined ? undefined : serializeError(error),
    family: stressCase.family,
    id: stressCase.id,
    projectName,
    reductionCandidates,
    replay,
    resultPath,
    route: stressCase.route,
    status,
    steps: replay.steps.map((step) => step.value),
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
