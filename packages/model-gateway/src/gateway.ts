import type {
  ModelGateway,
  ModelRequest,
  ModelResponse,
} from "@atoms-builder/contracts"

export type TransportRequest = {
  model: string
  prompt: string
  maxOutputTokens?: number
  systemPrompt?: string
  signal: AbortSignal
  /** Prior invalid answer and feedback are sent as separate conversation turns. */
  correction?: { responseText: string; feedback: string }
}

export type TransportResponse = {
  output: unknown
  inputTokens: number
  outputTokens: number
}

export type TransportChunk = { delta: string; done?: boolean }

export interface ModelTransport {
  generate(request: TransportRequest): Promise<TransportResponse>
  stream?(request: TransportRequest): AsyncIterable<TransportChunk>
}

export type ModelPricing = {
  inputPer1kUsd: number
  outputPer1kUsd: number
}

export type OutputFailureReason = "INVALID_JSON" | "MISSING_CONTENT" | "INVALID_RESPONSE" | "OUTPUT_TRUNCATED" | "SCHEMA_MISMATCH"

/** Raw answer stays in memory for correction; never put it in user errors or records. */
export class ModelOutputError extends Error {
  readonly code = "INVALID_OUTPUT"
  readonly retryable = false
  constructor(message: string, readonly details: {
    reason: OutputFailureReason
    responseText?: string
    inputTokens?: number
    outputTokens?: number
  }) { super(message) }
}

export type ModelCallRecord = {
  provider: string
  model: string
  promptVersion: string
  inputTokens: number
  outputTokens: number
  costUsd: number
  latencyMs: number
  attempts: number
  status: "success" | "error"
  errorCode?: ModelGatewayErrorCode
  outputFailure?: OutputFailureReason
  invalidFields?: string[]
}

export type ModelGatewayErrorCode =
  | "ABORTED"
  | "TIMEOUT"
  | "TRANSPORT"
  | "RATE_LIMITED"
  | "PROVIDER"
  | "INVALID_OUTPUT"

export class ModelGatewayError extends Error {
  promptVersion?: string
  outputFailure?: OutputFailureReason
  invalidFields?: string[]
  constructor(
    message: string,
    readonly code: ModelGatewayErrorCode,
    readonly retryable: boolean,
    readonly attempts = 1,
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = "ModelGatewayError"
  }
}

export type ModelGatewayOptions = {
  provider: string
  transport: ModelTransport
  pricing?: Readonly<Record<string, ModelPricing>>
  defaultPricing?: ModelPricing
  timeoutMs?: number
  maxRetries?: number
  retryDelayMs?: number
  retryInvalidOutput?: boolean
  onRecord?: (record: ModelCallRecord) => void
}

type RequestWithSignal<T> = ModelRequest<T> & { signal?: AbortSignal }

function positiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new ModelGatewayError(`Provider returned invalid ${field}`, "PROVIDER", false)
  }
  return value
}

function errorFromUnknown(error: unknown): ModelGatewayError {
  if (error instanceof ModelGatewayError) return error
  if (error instanceof DOMException && error.name === "AbortError") {
    return new ModelGatewayError("Model request was aborted", "ABORTED", false, 1, { cause: error })
  }
  if (error instanceof Error) {
    const candidate = error as Error & { status?: number; retryable?: boolean; code?: string }
    if (candidate.code === "INVALID_OUTPUT") {
      return new ModelGatewayError(error.message, "INVALID_OUTPUT", false, 1, { cause: error })
    }
    if (candidate.code === "ABORT_ERR") {
      return new ModelGatewayError("Model request was aborted", "ABORTED", false, 1, { cause: error })
    }
    if (candidate.status === 429) {
      return new ModelGatewayError(error.message, "RATE_LIMITED", true, 1, { cause: error })
    }
    if (candidate.status !== undefined && candidate.status >= 500) {
      return new ModelGatewayError(error.message, "TRANSPORT", true, 1, { cause: error })
    }
    return new ModelGatewayError(error.message, candidate.retryable === true ? "TRANSPORT" : "PROVIDER", candidate.retryable === true, 1, { cause: error })
  }
  return new ModelGatewayError("Unknown model transport error", "TRANSPORT", true, 1, { cause: error })
}

function wait(delayMs: number): Promise<void> {
  if (delayMs <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}

async function withTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  parentSignal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController()
  let parentAbort: (() => void) | undefined
  if (parentSignal) {
    if (parentSignal.aborted) {
      controller.abort(parentSignal.reason)
    } else {
      parentAbort = () => controller.abort(parentSignal.reason)
      parentSignal.addEventListener("abort", parentAbort, { once: true })
    }
  }

  let timeout: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort(new Error("model request timed out"))
      reject(new ModelGatewayError(`Model request timed out after ${timeoutMs}ms`, "TIMEOUT", true))
    }, timeoutMs)
  })
  try {
    return await Promise.race([operation(controller.signal), timedOut])
  } finally {
    if (timeout) clearTimeout(timeout)
    if (parentSignal && parentAbort) parentSignal.removeEventListener("abort", parentAbort)
  }
}

export class StructuredModelGateway implements ModelGateway {
  private readonly records: ModelCallRecord[] = []
  private readonly options: Required<Pick<ModelGatewayOptions, "timeoutMs" | "maxRetries" | "retryDelayMs">> & ModelGatewayOptions

  constructor(options: ModelGatewayOptions) {
    if (!options.provider) throw new Error("Model provider is required")
    this.options = {
      timeoutMs: 30_000,
      maxRetries: 2,
      retryDelayMs: 0,
      ...options,
    }
    if (this.options.timeoutMs <= 0 || this.options.maxRetries < 0 || this.options.retryDelayMs < 0) {
      throw new Error("Invalid model gateway retry or timeout configuration")
    }
  }

  get callRecords(): readonly ModelCallRecord[] {
    return this.records.map((record) => ({ ...record }))
  }

  async generate<T>(request: ModelRequest<T>): Promise<ModelResponse<T>> {
    const signal = (request as RequestWithSignal<T>).signal
    const startedAt = Date.now()
    let attempts = 0
    let lastError: ModelGatewayError | undefined
    let correction: TransportRequest["correction"]
    let outputFailure: OutputFailureReason | undefined
    let invalidFields: string[] | undefined
    let totalInputTokens = 0
    let totalOutputTokens = 0
    while (attempts <= this.options.maxRetries) {
      attempts += 1
      let responseText: string | undefined
      outputFailure = undefined
      invalidFields = undefined
      try {
        const response = await withTimeout(
          (signal) => this.options.transport.generate({
            model: request.model,
            prompt: request.prompt,
            ...(request.systemPrompt ? { systemPrompt: request.systemPrompt } : {}),
            ...(correction ? { correction } : {}),
            ...(request.maxOutputTokens !== undefined ? { maxOutputTokens: request.maxOutputTokens } : {}),
            signal,
          }),
          this.options.timeoutMs,
          signal,
        )
        const inputTokens = positiveInteger(response.inputTokens, "inputTokens")
        const outputTokens = positiveInteger(response.outputTokens, "outputTokens")
        totalInputTokens += inputTokens
        totalOutputTokens += outputTokens
        responseText = JSON.stringify(response.output)
        const parsed = request.schema.safeParse(response.output)
        if (!parsed.success) {
          outputFailure = "SCHEMA_MISMATCH"
          invalidFields = parsed.error.issues.slice(0, 20).map(issue => issue.path.join("."))
          throw new ModelGatewayError(`Provider returned invalid structured output: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`, "INVALID_OUTPUT", false, attempts, { cause: parsed.error })
        }
        const costUsd = this.costFor(request.model, totalInputTokens, totalOutputTokens)
        const result: ModelResponse<T> = {
          output: parsed.data,
          provider: this.options.provider,
          model: request.model,
          promptVersion: request.promptVersion,
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          costUsd,
          latencyMs: Date.now() - startedAt,
        }
        this.record({
          provider: this.options.provider,
          model: request.model,
          promptVersion: request.promptVersion,
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          costUsd,
          latencyMs: result.latencyMs,
          attempts,
          status: "success",
        })
        return result
      } catch (error) {
        if (error instanceof ModelOutputError) {
          responseText = error.details.responseText
          outputFailure = error.details.reason
          invalidFields = undefined
          totalInputTokens += error.details.inputTokens ?? 0
          totalOutputTokens += error.details.outputTokens ?? 0
        }
        const normalized = errorFromUnknown(error)
        lastError = new ModelGatewayError(normalized.message, normalized.code, normalized.retryable, attempts, { cause: normalized })
        const correctOutput = this.options.retryInvalidOutput === true && normalized.code === "INVALID_OUTPUT"
        if ((!normalized.retryable && !correctOutput) || attempts > this.options.maxRetries) break
        if (correctOutput) correction = {
          responseText: responseText ?? "",
          feedback: `The previous answer failed JSON validation. Correct that answer and return the complete JSON object only, without Markdown or prose. Preserve the requested behavior and all required fields. Escape quotes, backslashes and newlines in code strings. Validation feedback: ${normalized.message.slice(0, 3000)}`,
        }
        await wait(this.options.retryDelayMs)
      }
    }

    const error = lastError ?? new ModelGatewayError("Model request failed", "TRANSPORT", true, attempts)
    error.promptVersion = request.promptVersion
    error.outputFailure = outputFailure
    error.invalidFields = invalidFields
    this.record({
      provider: this.options.provider,
      model: request.model,
      promptVersion: request.promptVersion,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      costUsd: this.costFor(request.model, totalInputTokens, totalOutputTokens),
      latencyMs: Date.now() - startedAt,
      attempts,
      status: "error",
      errorCode: error.code,
      ...(outputFailure ? { outputFailure } : {}),
      ...(invalidFields ? { invalidFields } : {}),
    })
    throw error
  }

  async *stream<T>(request: ModelRequest<T>): AsyncIterable<{ delta: string; done: boolean }> {
    if (!this.options.transport.stream) {
      const response = await this.generate(request)
      yield { delta: JSON.stringify(response.output), done: true }
      return
    }
    const controller = new AbortController()
    const signal = (request as RequestWithSignal<T>).signal
    const parentAbort = signal ? () => controller.abort(signal.reason) : undefined
    if (signal && parentAbort) {
      if (signal.aborted) controller.abort(signal.reason)
      else signal.addEventListener("abort", parentAbort, { once: true })
    }
    const timeout = setTimeout(() => controller.abort(new Error("model stream timed out")), this.options.timeoutMs)
    try {
      for await (const chunk of this.options.transport.stream({
        model: request.model,
        prompt: request.prompt,
        ...(request.systemPrompt ? { systemPrompt: request.systemPrompt } : {}),
        ...(request.maxOutputTokens !== undefined ? { maxOutputTokens: request.maxOutputTokens } : {}),
        signal: controller.signal,
      })) {
        yield { delta: chunk.delta, done: chunk.done ?? false }
      }
    } finally {
      clearTimeout(timeout)
      if (signal && parentAbort) signal.removeEventListener("abort", parentAbort)
    }
  }

  async estimateCost(request: ModelRequest<unknown>): Promise<{ currency: "USD"; amount: number }> {
    const estimatedInputTokens = Math.max(1, Math.ceil(request.prompt.length / 4))
    return {
      currency: "USD",
      amount: this.costFor(request.model, estimatedInputTokens, request.maxOutputTokens ?? 0),
    }
  }

  private pricingFor(model: string): ModelPricing {
    return this.options.pricing?.[model] ?? this.options.defaultPricing ?? { inputPer1kUsd: 0, outputPer1kUsd: 0 }
  }

  private costFor(model: string, inputTokens: number, outputTokens: number): number {
    const pricing = this.pricingFor(model)
    return (inputTokens / 1_000) * pricing.inputPer1kUsd + (outputTokens / 1_000) * pricing.outputPer1kUsd
  }

  private record(record: ModelCallRecord): void {
    this.records.push(record)
    this.options.onRecord?.({ ...record })
  }
}

export class HttpModelGateway extends StructuredModelGateway {}
