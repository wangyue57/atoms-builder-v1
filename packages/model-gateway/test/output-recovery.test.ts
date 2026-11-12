import assert from "node:assert/strict"
import test from "node:test"
import { z } from "zod"
import { builderResultSchema, reviewReportSchema } from "@atoms-builder/contracts"
import { DeepSeekModelTransport } from "../src/deepseek.js"
import { ModelGatewayError, StructuredModelGateway } from "../src/gateway.js"

const builder = { status: "completed", versionId: "candidate", changedFiles: ["app/page.tsx"], checksRequested: [{ name: "lint", timeoutSeconds: 300 }], assumptions: [], remainingRisks: [] }
const report = { status: "pass", score: 80, checks: [], failures: [], evidence: [], mustFix: [], shouldFix: [], risks: [] }

for (const scenario of [
  { name: "builder check strings", schema: builderResultSchema, invalid: { ...builder, checksRequested: ["lint", "build"] }, valid: builder, field: "checksRequested", phase: "builder" },
  { name: "reviewer invalid status", schema: reviewReportSchema, invalid: { ...report, status: "passed" }, valid: report, field: "status", phase: "reviewer" },
]) {
  test(`corrects the actual prior answer for ${scenario.name}`, async () => {
    const calls: Array<{ messages: Array<{role: string; content: string}> }> = []
    const transport = new DeepSeekModelTransport({ apiKey: "test-only", fetch: async (_url, init) => {
      calls.push(JSON.parse(String(init?.body)))
      return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(calls.length === 1 ? scenario.invalid : scenario.valid) } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }))
    } })
    const gateway = new StructuredModelGateway({ provider: "deepseek", transport, maxRetries: 1, retryInvalidOutput: true })
    const output = await gateway.generate({ schema: scenario.schema as z.ZodType<unknown>, prompt: "Return required JSON", model: "test", promptVersion: scenario.phase, maxOutputTokens: 100 })
    assert.deepEqual(output.output, scenario.valid)
    assert.equal(calls[1]!.messages[0]!.content, "Return required JSON")
    assert.deepEqual(calls[1]!.messages[1], { role: "assistant", content: JSON.stringify(scenario.invalid) })
    assert.match(calls[1]!.messages[2]!.content, new RegExp(scenario.field))
    assert.equal(output.outputTokens, 10)
    assert.equal(gateway.callRecords[0]!.attempts, 2)
  })
}

test("malformed JSON is corrected in context and its tokens remain accounted", async () => {
  let calls = 0
  const bad = '{"answer":"unescaped "code""}'
  const transport = new DeepSeekModelTransport({ apiKey: "test-only", fetch: async (_url, init) => {
    calls++
    const body = JSON.parse(String(init?.body))
    if (calls === 2) assert.equal(body.messages[1].content, bad)
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: calls === 1 ? bad : '{"answer":"correct"}' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }))
  } })
  const gateway = new StructuredModelGateway({ provider: "deepseek", transport, maxRetries: 1, retryInvalidOutput: true })
  const result = await gateway.generate({ schema: z.object({ answer: z.string() }), prompt: "JSON", promptVersion: "builder", model: "test", maxOutputTokens: 100 })
  assert.equal(result.inputTokens, 20)
  assert.equal(result.outputTokens, 10)
  assert.equal(result.output.answer, "correct")
})

test("truncation is explicit even if the partial answer is syntactically valid", async () => {
  const transport = new DeepSeekModelTransport({ apiKey: "test-only", fetch: async () => new Response(JSON.stringify({ choices: [{ finish_reason: "length", message: { content: "{}" } }], usage: { prompt_tokens: 10, completion_tokens: 100 } })) })
  const gateway = new StructuredModelGateway({ provider: "deepseek", transport, maxRetries: 1, retryInvalidOutput: true })
  await assert.rejects(gateway.generate({ schema: z.object({}), prompt: "JSON", promptVersion: "builder", model: "test", maxOutputTokens: 100 }), (error: unknown) => {
    assert.ok(error instanceof ModelGatewayError)
    assert.equal(error.outputFailure, "OUTPUT_TRUNCATED")
    assert.equal(error.promptVersion, "builder")
    assert.equal(error.attempts, 2)
    return true
  })
  assert.equal(gateway.callRecords[0]!.outputTokens, 200)
  assert.equal(gateway.callRecords[0]!.outputFailure, "OUTPUT_TRUNCATED")
  assert.ok(!JSON.stringify(gateway.callRecords).includes('responseText'))
})

test("schema failure exposes only phase and field diagnostics in call records", async () => {
  const gateway = new StructuredModelGateway({ provider: "deepseek", maxRetries: 0, transport: { async generate() { return { output: { secretSource: "private source" }, inputTokens: 1, outputTokens: 1 } } } })
  await assert.rejects(gateway.generate({ schema: reviewReportSchema, prompt: "JSON", model: "test", promptVersion: "reviewer", maxOutputTokens: 100 }), (error: unknown) => error instanceof ModelGatewayError && error.outputFailure === "SCHEMA_MISMATCH")
  const record = gateway.callRecords[0]!
  assert.equal(record.outputFailure, "SCHEMA_MISMATCH")
  assert.ok(record.invalidFields?.includes("checks"))
  assert.ok(!JSON.stringify(record).includes("private source"))
})
