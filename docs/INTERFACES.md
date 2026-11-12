# 公共接口状态

状态：**执行/领域 v0 已冻结（TASK-002）；Application HTTP v1 已新增（TASK-022）**

本文是实现 Agent 的接口索引。正式类型和 Zod Schema 实现于 `packages/contracts`，领域实体和状态机实现于 `packages/domain`。

## 领域接口

```text
ProjectRepository
RunRepository
VersionRepository
EventStore
UsageLedger
ApprovalRepository
```

## 执行接口

```text
AgentRuntime
ModelGateway
Workspace
SandboxAdapter
PreviewService
DeploymentAdapter
IntegrationAdapter
```

`packages/contracts` 当前导出：

- API 输入输出：创建项目、创建 Run、审批/拒绝、版本、部署和事件查询 Schema。
- 事件：`RunEvent` 和 SSE 事件 Schema；事件序号必须为正整数，消费端使用 `(runId, sequence)` 去重。
- Agent：`BuilderResult`、`ReviewReport`、检查规格、证据引用和 Tool Grant。
- 执行：`AgentRuntime`、`ModelGateway`、`Workspace`、`DeploymentAdapter` 和 `IntegrationAdapter`。
- 错误：结构化错误码、`retryable` 和可选证据引用。

## 必须保持的约束

- `ProjectVersion` 不可变。
- `RunEvent` 通过 `(runId, sequence)` 去重；正式事件类型以 [Contracts events](../packages/contracts/src/events.ts) 和 [Domain types](../packages/domain/src/types.ts) 为准，历史设计仅用于追溯。
- `Run` 创建和额度预留必须支持 Idempotency-Key。
- `Reviewer Agent` 没有写工作区的 Tool Grant。
- `DeploymentAdapter` 必须接收明确的 `versionId`。
- `WorkspaceAdapter` 不得依赖 Studio 或具体 Agent Prompt。
- `Control API` 不得执行 shell、模型调用或生成代码。

## v0 冻结范围

- `ProjectVersion` 不可变，修改只能创建候选版本。
- `CreateRunInput`、`BuilderInput` 和 `DeploymentRequest` 必须绑定明确的版本引用；首次构建也必须先创建模板版本。
- 所有写请求携带 `idempotencyKey`，最少 8 个字符。
- Reviewer Tool Grant 只允许 `reviewer.read`、`reviewer.check` 和 `reviewer.browser`；不能获得 `builder.write`。
- `DeploymentAdapter.deploy` 接收 `projectId`、明确的 `versionId`、构建产物和幂等键。
- `Control API` 不执行 shell、模型调用或生成代码。

## 接口冻结规则

Domain Agent 提交接口后，由 Lead 和相关 Owner 审核。接口冻结后：

1. 修改必须增加版本号。
2. 调用方不能私自兼容两个不一致的接口。
3. 所有变更必须补充 Contract Test。
4. 变更必须更新 `INTEGRATION-STATUS.md`。

## Model Gateway 内部传输扩展（TASK-032）

执行 v0 与 Application v1 Schema 不变。[Gateway](../packages/model-gateway/src/gateway.ts) 的 `TransportRequest` 新增可选 `correction`（原答案文本、字段反馈），由 [DeepSeek Transport](../packages/model-gateway/src/deepseek.ts) 转成 assistant/user 两个纠错轮次；仅在调用方显式启用格式纠错时使用，仍受 maxRetries 限制。`ModelCallRecord` 新增可选 `outputFailure`、`invalidFields`，只记录受控分类和字段路径，不包含原答案；解析失败但有usage的响应仍累计tokens。模型失败错误可携带promptVersion与同样的受控分类供Worker生成阶段明确的提示。测试见 [output-recovery](../packages/model-gateway/test/output-recovery.test.ts)。

## Application HTTP v1（TASK-022）

新增 [application-v1.ts](../packages/contracts/src/application-v1.ts) 从 Contracts index 导出，与原执行/领域 v0 并行保留兼容；这是当前网站与 PostgreSQL ApplicationRepository 的契约，不再沿用匿名 `/api/runs` 的页面 profile。

| 接口 | 结果与约束 |
|---|---|
| `POST /api/auth/register` | `{username,password}` → 201 `{user}` 并设置会话 Cookie；注册事务创建个人组织/成员关系 |
| `POST /api/auth/login` | 相同输入 → 200 `{user}` 并设置 Cookie；无效凭据 401，重复失败 429 |
| `GET /api/auth/me` | 200 `{user: ApplicationUser|null}`，只公开 ID/账号名/创建时间 |
| `POST /api/auth/logout` | 204，撤销数据库会话并清除 Cookie |
| `GET /api/tasks?page=1&pageSize=20` | `ApplicationTaskList`，仅当前用户 summary 分页；pageSize 最大100 |
| `POST /api/tasks` | `{request,idempotencyKey}` → 202 `ApplicationTask`（queued 已落库） |
| `GET /api/tasks/:id` | 完整任务、当前成功产物、运行历史；刷新/重新登录可恢复 |
| `POST /api/tasks/:id/runs` | 相同写入结构 → 202，服务端读取上次完整快照继续；已有 active 运行 409 |

`ApplicationTask` 的 id 是持久化 Project ID，phase 包含 queued/running/succeeded/failed；每次提交有独立 Run ID，结果与预览绑定持久化 Project Version ID。失败不覆盖先前成功作品，旧版本审查与本轮错误分别展示；不将浏览器 ID 或旧审核报告伪装成本次运行结果。首个 build 也绑定持久化模板 input_version_id。

Task 写请求严格拒绝客户端 userId/previousHtml，必须提供幂等键；重用相同键但不同请求返回409。同一项目只有一个 queued/running；原子 claim/lease 确保运行不会被双重执行。未登录任务接口401，跨用户资源404，旧匿名运行接口410。

数据库新增迁移 [0002](../migrations/0002_application.sql)，不改0001；扩展 Project/Run/Version 并新增账户/会话/限流及迁移记录。ApplicationRepository 不实现为 Memory/SQLite/localStorage，开发与部署使用同一 Postgres 实现。版本内容相同可按不同运行保存不可变快照，版本与 created_by_run_id 唯一绑定，内容hash用于校验与索引；取舍见 [ADR-0006](adr/0006-postgres-accounts-and-task-history.md)。

## Model Gateway 请求扩展（TASK-033）

`ModelRequest` 的 `maxOutputTokens` 现在是可选字段；调用方不设置时，DeepSeek transport 省略 `max_tokens`，使用 Provider 默认输出预算。`systemPrompt` 是可选的稳定指令层，DeepSeek 将其作为 `system` message 发送，业务数据仍位于 user message。该扩展不改变 Application HTTP v1 或数据库结构。
