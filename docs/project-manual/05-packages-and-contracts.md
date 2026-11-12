# 05 公共包与契约

目录：[项目说明目录](README.md) · [04 构建、模型与执行引擎](04-build-engine.md) · [03 API 与数据](03-api-and-data.md)

本文按当前源码说明模块职责。历史纵向切片和未装配接口不作为当前网站能力。

## 包与依赖关系

根项目使用 npm workspace 管理 [apps/web](../../apps/web) 与 [apps/platform-server](../../apps/platform-server)。后端构建顺序是 domain → contracts → workspace → model-gateway → agent-runtime → persistence → platform-server；前端由 `build:web` 构建。模型、账号和版本内容均由后端处理，浏览器不持有业务持久化状态。

- `packages/domain`：领域实体与状态机。
- `packages/contracts`：Zod Schema、Agent/Model/Workspace/执行接口和 Application HTTP v1。
- `packages/model-gateway`：结构化 ModelGateway、DeepSeek transport、超时/重试/纠错与调用记录。
- `packages/agent-runtime`：真实 Builder/Reviewer loop。Builder 可写 Workspace，Reviewer 只读。
- `packages/workspace`：不可变本地快照及隔离容器策略；生产 executor 尚未装配。
- `packages/persistence`：PostgreSQL ApplicationRepository、连接池和迁移器。
- `apps/platform-server`：HTTP API、Worker、Workflow、预览门禁和静态前端托管。
- `apps/web`：React/MUI 前端。
- `evals`：静态 golden task 数据校验，不执行生成项目。
- `deploy`：Compose/Caddy 配置检查。

## Contracts

`packages/contracts/src/agents.ts` 定义 `BuilderInput`、`BuilderResult`、`ReviewReport`、检查规格、证据和 `ModelGateway`。`ModelRequest.maxOutputTokens` 与 `systemPrompt` 都是可选字段：调用方省略输出上限时，Provider 自己决定默认值；系统消息由 transport 支持时单独发送。Reviewer grant 只有 `reviewer.read`、`reviewer.check`、`reviewer.browser`。

`application-v1.ts` 定义账号、任务、运行结果和分页契约。运行结果的 `mode` 固定为 `deepseek`；请求只接受 request 与 idempotencyKey，服务端从数据库快照恢复上下文。

版本不可变、写请求使用幂等键、Reviewer 不得写 Workspace、Control API 不执行模型或生成代码，这些约束由契约、Repository 和测试共同维护。数据库迁移只追加，已应用 checksum 不可修改。

## 数据与执行边界

`ApplicationRepository` 保存用户、会话、Project、Run、完整 source snapshot、manifest、preview 和审查结果。Worker 从 PG claim 后在 `workflow.ts` 中创建 `LocalWorkspaceAdapter`，调用 DeepSeek Builder/Reviewer，成功时写入新版本；失败不会覆盖上一个成功版本。

`RealBuilderAgent` 每轮收到源码、manifest、原始需求和最近 observation，返回 patch/check/finish/blocked 之一。`RealReviewerAgent` 每轮收到同一用户需求和只读源码上下文，默认请求检查与预览，之后可继续要求 browser/check，直到 finish 或达到 12 轮安全上限。模型可以发挥，但系统只保留 loop 次数上限和 Workspace 路径保护。

当前本地 Workspace 的检查和预览是确定性 seam；真实 install/build/test、隔离预览、产品 Reviewer 浏览器和生成项目发布仍未接入。不要以本地 adapter 通过推断生产执行已完成。

## 验证入口

- `npm run test:contract`：Application/Agent 权限契约。
- `npm run test:model`：DeepSeek request body、结构化输出、重试和敏感信息脱敏。
- `npm test --prefix packages/agent-runtime`：Builder/Reviewer loop。
- `npm run test:local`：PostgreSQL API/Worker 测试；不会注入模型替身。
- `npm run test:all`：当前仍包含 evals、部署配置和各活动包测试，不包含已删除的旧 Workflow/Studio/Deployment 包。
