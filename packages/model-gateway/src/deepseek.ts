import { ModelOutputError, type ModelTransport, type TransportRequest, type TransportResponse } from "./gateway.js"

export const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com/chat/completions"
export const DEFAULT_DEEPSEEK_MODEL = "deepseek-flash"

type DeepSeekUsage = {
  prompt_tokens?: unknown
  completion_tokens?: unknown
}

type DeepSeekResponse = {
  choices?: Array<{
    finish_reason?: string
    message?: {
      content?: unknown
    }
  }>
  usage?: DeepSeekUsage
}

export type DeepSeekFetch = typeof fetch

export type DeepSeekTransportOptions = {
  apiKey: string
  endpoint?: string
  fetch?: DeepSeekFetch
}

/** Error raised for a non-successful DeepSeek HTTP response. The API key is
 * deliberately excluded from the message and all exposed fields. */
export class DeepSeekHttpError extends Error {
  readonly status: number
  readonly retryable: boolean

  constructor(status: number, statusText?: string) {
    super(`DeepSeek request failed with HTTP ${status}${statusText ? ` ${statusText}` : ""}`)
    this.name = "DeepSeekHttpError"
    this.status = status
    this.retryable = status === 429 || status >= 500
  }
}

export class DeepSeekResponseError extends ModelOutputError {
  constructor(message: string, details: ConstructorParameters<typeof ModelOutputError>[1] = { reason: "INVALID_RESPONSE" }) {
    super(`DeepSeek returned an invalid response: ${message}`, details)
    this.name = "DeepSeekResponseError"
  }
}

function tokenCount(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0
}

export class DeepSeekModelTransport implements ModelTransport {
  private readonly apiKey: string
  private readonly endpoint: string
  private readonly fetchImpl: DeepSeekFetch

  constructor(options: DeepSeekTransportOptions) {
    if (typeof options.apiKey !== "string" || options.apiKey.length === 0) {
      throw new Error("DeepSeek apiKey is required")
    }
    if (options.endpoint !== undefined && (!options.endpoint || /[\r\n]/.test(options.endpoint))) {
      throw new Error("DeepSeek endpoint is invalid")
    }
    this.apiKey = options.apiKey
    this.endpoint = options.endpoint ?? DEFAULT_DEEPSEEK_BASE_URL
    this.fetchImpl = options.fetch ?? fetch
  }

  async generate(request: TransportRequest): Promise<TransportResponse> {
    const response = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: request.model || DEFAULT_DEEPSEEK_MODEL,
        messages: [
          ...(request.systemPrompt ? [{ role: "system", content: request.systemPrompt }] : []),
          { role: "user", content: request.prompt },
          ...(request.correction ? [
            ...(request.correction.responseText ? [{ role: "assistant", content: request.correction.responseText }] : []),
            { role: "user", content: request.correction.feedback },
          ] : []),
        ],
        ...(request.maxOutputTokens !== undefined ? { max_tokens: request.maxOutputTokens } : {}),
        thinking: { type: "disabled" },
        response_format: { type: "json_object" },
      }),
      signal: request.signal,
    })

    if (!response.ok) {
      throw new DeepSeekHttpError(response.status, response.statusText)
    }

    let payload: DeepSeekResponse
    try {
      payload = (await response.json()) as DeepSeekResponse
    } catch {
      throw new DeepSeekResponseError("response body is not valid JSON")
    }

    const content = payload.choices?.[0]?.message?.content
    const usage = { inputTokens: tokenCount(payload.usage?.prompt_tokens), outputTokens: tokenCount(payload.usage?.completion_tokens) }
    if (payload.choices?.[0]?.finish_reason === "length") {
      throw new DeepSeekResponseError("output token limit reached; return more concise code within the output budget", {
        reason: "OUTPUT_TRUNCATED", ...usage, responseText: typeof content === "string" ? content : undefined,
      })
    }
    if (typeof content !== "string" || content.length === 0) {
      throw new DeepSeekResponseError("choices[0].message.content is missing", { reason: "MISSING_CONTENT", ...usage })
    }

    let output: unknown
    try {
      output = JSON.parse(content)
    } catch {
      throw new DeepSeekResponseError("message.content is not valid JSON", { reason: "INVALID_JSON", responseText: content, ...usage })
    }

    return {
      output,
      inputTokens: tokenCount(payload.usage?.prompt_tokens),
      outputTokens: tokenCount(payload.usage?.completion_tokens),
    }
  }
}

export const DeepSeekTransport = DeepSeekModelTransport
