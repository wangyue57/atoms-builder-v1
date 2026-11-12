import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

export const PAGE_KINDS = ["marketing", "portfolio", "dashboard", "internal_tool", "saas"] as const
export type GoldenPageKind = (typeof PAGE_KINDS)[number]

export type GoldenTask = {
  id: string
  userRequest: string
  expectedPageKind: GoldenPageKind
  acceptanceChecks: string[]
}

const FIXTURE_URL = new URL("../fixtures/golden-tasks.json", import.meta.url)

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function isPageKind(value: unknown): value is GoldenPageKind {
  return typeof value === "string" && (PAGE_KINDS as readonly string[]).includes(value)
}

function requiredCategory(checks: readonly string[], category: string): boolean {
  return checks.some((check) => check.toLowerCase().startsWith(`${category}:`))
}

export function validateGoldenTasks(input: unknown): GoldenTask[] {
  if (!Array.isArray(input)) throw new Error("Golden task fixture must be an array")
  const ids = new Set<string>()
  return input.map((raw, index) => {
    if (!isRecord(raw)) throw new Error(`Golden task ${index} must be an object`)
    const { id, userRequest, expectedPageKind, acceptanceChecks } = raw
    if (typeof id !== "string" || id.trim() === "") throw new Error(`Golden task ${index} has an invalid id`)
    if (ids.has(id)) throw new Error(`Duplicate golden task id: ${id}`)
    ids.add(id)
    if (typeof userRequest !== "string" || userRequest.trim().length < 20) {
      throw new Error(`Golden task ${id} needs a substantive userRequest`)
    }
    if (!isPageKind(expectedPageKind)) throw new Error(`Golden task ${id} has an unsupported page kind`)
    if (!Array.isArray(acceptanceChecks) || acceptanceChecks.length < 4 || acceptanceChecks.some((check) => typeof check !== "string" || check.trim() === "")) {
      throw new Error(`Golden task ${id} needs at least four non-empty acceptance checks`)
    }
    const checks = acceptanceChecks.map((check) => check.trim())
    for (const category of ["browser", "responsive", "security"]) {
      if (!requiredCategory(checks, category)) throw new Error(`Golden task ${id} is missing a ${category} check`)
    }
    return { id, userRequest: userRequest.trim(), expectedPageKind, acceptanceChecks: checks }
  })
}

export function loadGoldenTasks(): GoldenTask[] {
  const raw = JSON.parse(readFileSync(fileURLToPath(FIXTURE_URL), "utf8")) as unknown
  return validateGoldenTasks(raw)
}
