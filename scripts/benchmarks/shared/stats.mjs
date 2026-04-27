import { mkdir, writeFile } from 'node:fs/promises'

export const round = (value) => Number(value.toFixed(2))

export const now = () => performance.now()

export const summarize = (samples) => {
  const sorted = [...samples].sort((left, right) => left - right)
  const mean =
    samples.reduce((total, sample) => total + sample, 0) / samples.length
  const middle = Math.floor(sorted.length / 2)
  const median =
    sorted.length % 2 === 0
      ? (sorted[middle - 1] + sorted[middle]) / 2
      : sorted[middle]

  return {
    samples: samples.map(round),
    mean: round(mean),
    median: round(median),
    min: round(sorted[0] ?? 0),
    max: round(sorted.at(-1) ?? 0),
  }
}

export const writeBenchmarkArtifact = async (path, summary) => {
  await mkdir('tmp', { recursive: true })
  await writeFile(path, `${JSON.stringify(summary, null, 2)}\n`)
}
