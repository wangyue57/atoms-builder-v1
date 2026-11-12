import assert from "node:assert/strict"
import test from "node:test"
import {
  DEFAULT_DEEPSEEK_BASE_URL,
  DEFAULT_DEEPSEEK_MODEL,
  DeepSeekHttpError,
  DeepSeekModelTransport,
  DeepSeekResponseError,
} from "../src/deepseek.js"
import type { TransportRequest } from "../src/gateway.js"

function request(overrides: Partial<TransportRequest> = {}): TransportRequest {
  return {
    model: DEFAULT_DEEPSEEK_MODEL,
    prompt: "Return JSON",
    maxOutputTokens: 128,
    signal: new AbortController().signal,
    ...overrides,
  }
}

function response(body: unknown, init: { ok?: boolean; status?: number; statusText?: string } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: init.statusText ?? "OK",
    json: async () => body,
  } as Response
}

test("calls DeepSeek with JSON response format and returns parsed output and usage", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const transport = new DeepSeekModelTransport({
    apiKey: "secret-key",
    fetch: async (url, init) => {
      calls.push({ url: String(url), init })
      return response({
        choices: [{ message: { content: '{"ok":true}' } }],
        usage: { prompt_tokens: 11, completion_tokens: 7 },
      })
    },
  })

  const result = await transport.generate(request())
  assert.deepEqual(result, { output: { ok: true }, inputTokens: 11, outputTokens: 7 })
  assert.equal(calls[0]?.url, DEFAULT_DEEPSEEK_BASE_URL)
  assert.equal(calls[0]?.init.method, "POST")
  assert.equal((calls[0]?.init.headers as Record<string, string>).Authorization, "Bearer secret-key")
  assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), {
    model: DEFAULT_DEEPSEEK_MODEL,
    messages: [{ role: "user", content: "Return JSON" }],
    max_tokens: 128,
    thinking: { type: "disabled" },
    response_format: { type: "json_object" },
  })
})

test("uses a custom endpoint and forwards the request AbortSignal", async () => {
  const controller = new AbortController()
  let receivedSignal: AbortSignal | undefined
  const transport = new DeepSeekModelTransport({
    apiKey: "secret-key",
    endpoint: "https://example.test/v1/chat/completions",
    fetch: async (_url, init) => {
      receivedSignal = init.signal as AbortSignal
      return response({ choices: [{ message: { content: "{}" } }] })
    },
  })

  await transport.generate(request({ signal: controller.signal }))
  assert.equal(receivedSignal, controller.signal)
})

test("uses the system message and leaves the provider output cap unset when omitted", async () => {
  let body: Record<string, unknown> | undefined
  const transport = new DeepSeekModelTransport({
    apiKey: "secret-key",
    fetch: async (_url, init) => {
      body = JSON.parse(String(init.body)) as Record<string, unknown>
      return response({ choices: [{ message: { content: "{}" } }] })
    },
  })
  await transport.generate(request({ maxOutputTokens: undefined, systemPrompt: "Follow the contract." }))
  assert.deepEqual(body?.messages, [
    { role: "system", content: "Follow the contract." },
    { role: "user", content: "Return JSON" },
  ])
  assert.equal("max_tokens" in (body ?? {}), false)
})

test("maps HTTP failures without exposing the API key", async () => {
  const apiKey = "secret-key"
  const transport = new DeepSeekModelTransport({
    apiKey,
    fetch: async () => response({ error: { message: "bad" } }, { ok: false, status: 429, statusText: "Too Many Requests" }),
  })

  await assert.rejects(
    transport.generate(request()),
    (error: unknown) => {
      assert.ok(error instanceof DeepSeekHttpError)
      assert.equal(error.status, 429)
      assert.equal(error.retryable, true)
      assert.equal(error.message.includes(apiKey), false)
      return true
    },
  )
})

test("rejects malformed provider JSON and missing content", async () => {
  const malformed = new DeepSeekModelTransport({
    apiKey: "secret-key",
    fetch: async () => response({ choices: [{ message: { content: "not-json" } }] }),
  })
  await assert.rejects(malformed.generate(request()), DeepSeekResponseError)

  const missing = new DeepSeekModelTransport({
    apiKey: "secret-key",
    fetch: async () => response({ choices: [] }),
  })
  await assert.rejects(missing.generate(request()), DeepSeekResponseError)
})

test("does not swallow abort errors from fetch", async () => {
  const controller = new AbortController()
  const abortError = new DOMException("aborted", "AbortError")
  const transport = new DeepSeekModelTransport({
    apiKey: "secret-key",
    fetch: async (_url, init) => {
      assert.equal(init.signal, controller.signal)
      throw abortError
    },
  })

  await assert.rejects(transport.generate(request({ signal: controller.signal })), (error) => error === abortError)
})

test("requires an API key", () => {
  assert.throws(() => new DeepSeekModelTransport({ apiKey: "" }), /apiKey is required/)
})
