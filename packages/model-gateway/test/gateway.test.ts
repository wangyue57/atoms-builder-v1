import assert from "node:assert/strict"
import test from "node:test"
import { z } from "zod"
import {
  ModelGatewayError,
  StructuredModelGateway,
  type ModelTransport,
  type TransportRequest,
} from "../src/gateway.js"

const schema = z.object({ answer: z.string() })
const request = {
  schema,
  prompt: "Return a short answer",
  model: "test-model",
  promptVersion: "builder",
  maxOutputTokens: 100,
}

test("validates structured output, calculates cost, and records metadata", async () => {
  const records: unknown[] = []
  const gateway = new StructuredModelGateway({
    provider: "test-provider",
    transport: {
      async generate() {
        return { output: { answer: "ok" }, inputTokens: 100, outputTokens: 50 }
      },
    },
    pricing: { "test-model": { inputPer1kUsd: 1, outputPer1kUsd: 2 } },
    onRecord: (record) => records.push(record),
  })
  const response = await gateway.generate(request)
  assert.deepEqual(response.output, { answer: "ok" })
  assert.equal(response.provider, "test-provider")
  assert.equal(response.promptVersion, "builder")
  assert.equal(response.costUsd, 0.2)
  assert.equal(gateway.callRecords[0]?.status, "success")
  assert.equal(records.length, 1)
})

test("retries a rate limit with a finite retry budget", async () => {
  let attempts = 0
  const gateway = new StructuredModelGateway({
    provider: "test-provider",
    maxRetries: 1,
    transport: {
      async generate() {
        attempts += 1
        if (attempts === 1) {
          const error = new Error("busy") as Error & { status: number }
          error.status = 429
          throw error
        }
        return { output: { answer: "ok" }, inputTokens: 1, outputTokens: 1 }
      },
    },
  })
  const response = await gateway.generate(request)
  assert.equal(response.output.answer, "ok")
  assert.equal(attempts, 2)
  assert.equal(gateway.callRecords[0]?.attempts, 2)
})

test("does not retry invalid structured output", async () => {
  let attempts = 0
  const gateway = new StructuredModelGateway({
    provider: "test-provider",
    maxRetries: 3,
    transport: {
      async generate() {
        attempts += 1
        return { output: { wrong: true }, inputTokens: 1, outputTokens: 1 }
      },
    },
  })
  await assert.rejects(
    gateway.generate(request),
    (error: unknown) => error instanceof ModelGatewayError && error.code === "INVALID_OUTPUT" && error.retryable === false,
  )
  assert.equal(attempts, 1)
  assert.equal(gateway.callRecords[0]?.errorCode, "INVALID_OUTPUT")
})

test("aborts a timed out transport and exposes an error record", async () => {
  const transport: ModelTransport = {
    async generate({ signal }: TransportRequest) {
      await new Promise<void>((resolve) => {
        if (signal.aborted) return resolve()
        signal.addEventListener("abort", () => resolve(), { once: true })
      })
      throw Object.assign(new Error("aborted"), { code: "ABORT_ERR" })
    },
  }
  const gateway = new StructuredModelGateway({ provider: "test-provider", transport, timeoutMs: 10, maxRetries: 0 })
  await assert.rejects(
    gateway.generate(request),
    (error: unknown) => error instanceof ModelGatewayError && error.code === "TIMEOUT",
  )
  assert.equal(gateway.callRecords[0]?.status, "error")
})

test("estimates input and output cost and supports stream fallback", async () => {
  const gateway = new StructuredModelGateway({
    provider: "test-provider",
    defaultPricing: { inputPer1kUsd: 1, outputPer1kUsd: 2 },
    transport: {
      async generate() {
        return { output: { answer: "ok" }, inputTokens: 1, outputTokens: 1 }
      },
    },
  })
  const estimate = await gateway.estimateCost({ ...request, prompt: "1234", maxOutputTokens: 100 })
  assert.equal(estimate.amount, 0.201)
  const chunks: string[] = []
  for await (const chunk of gateway.stream(request)) chunks.push(chunk.delta)
  assert.equal(chunks[0], JSON.stringify({ answer: "ok" }))
})


test("opt-in structured-output recovery supplies feedback and accounts for all returned tokens", async () => {
  const prompts: string[] = []
  const gateway = new StructuredModelGateway({
    provider: "test-provider", maxRetries: 1, retryInvalidOutput: true,
    defaultPricing: { inputPer1kUsd: 1, outputPer1kUsd: 2 },
    transport: { async generate(input) {
      prompts.push(input.correction?.feedback ?? input.prompt)
      return { output: prompts.length === 1 ? { wrong: true } : { answer: "corrected" }, inputTokens: 10, outputTokens: 5 }
    } },
  })
  const response = await gateway.generate(request)
  assert.equal(response.output.answer, "corrected")
  assert.match(prompts[1]!, /Validation feedback/)
  assert.equal(response.inputTokens, 20)
  assert.equal(response.outputTokens, 10)
  assert.equal(response.costUsd, 0.04)
  assert.equal(gateway.callRecords[0]?.attempts, 2)
})

test("structured-output recovery stops at the configured budget", async () => {
  let attempts = 0
  const gateway = new StructuredModelGateway({ provider: "test-provider", maxRetries: 1, retryInvalidOutput: true,
    transport: { async generate() { attempts++; return { output: {}, inputTokens: 1, outputTokens: 1 } } },
  })
  await assert.rejects(gateway.generate(request), error => error instanceof ModelGatewayError && error.code === "INVALID_OUTPUT" && error.attempts === 2)
  assert.equal(attempts, 2)
  assert.equal(gateway.callRecords[0]?.inputTokens, 2)
})
