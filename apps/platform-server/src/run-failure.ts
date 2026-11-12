import {
  DeepSeekHttpError,
  ModelGatewayError,
} from "@atoms-builder/model-gateway";
import { ApplicationError } from "@atoms-builder/persistence";
import { PreviewArtifactError } from "./preview-artifact.js";

export class ModelConfigurationError extends Error {
  constructor(readonly code: "MISSING_API_KEY" | "INVALID_TIMEOUT") {
    super(code);
    this.name = "ModelConfigurationError";
  }
}

/** Only controlled categories leave the worker; never log provider messages or source. */
export function runFailureDetails(error: unknown): {
  code: string;
  attempts: number;
  message: string;
} {
  if (error instanceof PreviewArtifactError) {
    return { code: "PREVIEW_ARTIFACT", attempts: 1, message: error.message };
  }
  if (error instanceof ApplicationError && error.status === 422) {
    return {
      code: "PREVIEW_ARTIFACT",
      attempts: 1,
      message: "本轮预览产物缺失或与源码快照不一致，未保存为成功版本。",
    };
  }
  if (error instanceof ModelConfigurationError) {
    return {
      code: error.code,
      attempts: 0,
      message:
        error.code === "MISSING_API_KEY"
          ? "DeepSeek 未配置：后台 Worker 缺少 DSKEY，请配置密钥并重启服务后重试。（MISSING_API_KEY）"
          : "DeepSeek 超时配置无效：MODEL_TIMEOUT_MS 需为 1000–300000 毫秒。（INVALID_TIMEOUT）",
    };
  }
  if (error instanceof ModelGatewayError) {
    // Inspect typed causes only; provider response bodies may contain private data.
    let cause: unknown = error;
    for (let depth = 0; depth < 8 && cause instanceof Error; depth++) {
      if (cause instanceof DeepSeekHttpError) {
        const reasons: Record<number, string> = {
          400: "请求参数无效，请检查模型名称和服务配置",
          401: "密钥无效或已失效，请检查 DSKEY",
          402: "账户余额不足，请充值后重试",
          403: "当前密钥没有访问权限",
          404: "模型或接口地址不存在，请检查模型名称和接口地址",
          429: "请求过于频繁或额度受限，请稍后重试",
          500: "模型服务内部错误，请稍后重试",
          502: "模型服务网关异常，请稍后重试",
          503: "模型服务暂时不可用，请稍后重试",
        };
        return {
          code: `DEEPSEEK_HTTP_${cause.status}`,
          attempts: error.attempts,
          message: `DeepSeek 调用失败：${reasons[cause.status] ?? "模型服务返回异常，请检查服务配置后重试"}。（HTTP ${cause.status}）`,
        };
      }
      cause = cause.cause;
    }
    if (error.code === "INVALID_OUTPUT" && error.outputFailure) {
      const stage = error.promptVersion?.startsWith("reviewer")
        ? "源码审核"
        : "页面生成";
      const reason = {
        OUTPUT_TRUNCATED: "模型输出超出长度限制，被提前截断",
        INVALID_JSON: "模型返回了无法解析的 JSON",
        MISSING_CONTENT: "模型返回了空内容",
        INVALID_RESPONSE: "模型服务返回的数据无法解析",
        SCHEMA_MISMATCH: "模型返回的字段或检查项结构不符合约定",
      }[error.outputFailure];
      return {
        code: error.code,
        attempts: error.attempts,
        message: `${stage}失败：${reason}，自动纠正后仍未通过。上次成功版本已保留，请重试。（INVALID_OUTPUT）`,
      };
    }
    const messages = {
      TIMEOUT: "模型生成超时，本次没有交付新版本。请稍后重新提交。",
      INVALID_OUTPUT:
        "模型返回的生成或审核结果格式不完整，本次没有交付新版本。请重试。",
      RATE_LIMITED: "模型服务限流，请稍后重试。",
      TRANSPORT: "模型服务连接失败，请稍后重试。",
      PROVIDER: "模型服务返回异常，请检查模型配置后重试。",
      ABORTED: "模型请求已中断，请重新提交。",
    };
    return {
      code: error.code,
      attempts: error.attempts,
      message: `${messages[error.code]}（${error.code}）`,
    };
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    /^[0-9A-Z]{5}$/.test(error.code)
  ) {
    return {
      code: `DATABASE_${error.code}`,
      attempts: 1,
      message: "保存构建结果失败，请稍后重试。",
    };
  }
  return {
    code: "INTERNAL",
    attempts: 1,
    message: "构建服务暂时不可用，请重新提交修改要求。（INTERNAL）",
  };
}
