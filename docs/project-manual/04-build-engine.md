# 04 构建、模型与执行引擎

目录：[项目说明目录](README.md) · [03 API 与数据](03-api-and-data.md) · [05 公共包与契约](05-packages-and-contracts.md)

本文只描述当前源码已经实现的构建链。网站后端入口位于 [apps/platform-server](../../apps/platform-server/)，使用 Application HTTP v1；模型调用和生成工作只在独立 Worker 中进行。源码、测试与运行状态冲突时，以源码和测试为准；确定性检查和注入式执行器不能证明生产隔离执行已经接入。

## 先看哪里

- API 启动与数据库装配：[apps/platform-server/src/main.ts](../../apps/platform-server/src/main.ts)、[apps/platform-server/src/dev.ts](../../apps/platform-server/src/dev.ts)、[apps/platform-server/src/bootstrap.ts](../../apps/platform-server/src/bootstrap.ts)。`createApplicationResources` 创建 PostgreSQL Pool，先执行迁移，再创建唯一 `ApplicationRepository`；`DATABASE_URL` 缺失时明确失败，没有内存回退。
- API 边界：[apps/platform-server/src/server.ts](../../apps/platform-server/src/server.ts)。它解析 Cookie、做同源和登录校验、校验 Application v1、把任务事务写成 `queued`，不调用模型、不执行生成代码。匿名旧入口 `POST /api/runs` 返回 410。
- Worker：[apps/platform-server/src/worker.ts](../../apps/platform-server/src/worker.ts)。循环恢复过期 lease、`claimRun`、执行一次构建并终结；心跳约每个 lease 的三分之一续租。失去 lease 时不写结果并抛出错误，过期的付费工作被标记失败，不自动重排队。
- 编排：[apps/platform-server/src/workflow.ts](../../apps/platform-server/src/workflow.ts) 的 `executeApplicationRun`。它从 `ClaimedRun` 的完整输入版本建立 `LocalWorkspaceAdapter`，只调用 DeepSeek（缺少密钥明确失败），构建、审查、最多三轮修复，最后返回完整文件和 manifest hash。

一次当前网站操作是：登录 Cookie → API 事务创建 Project、模板版本和 queued Run → Worker 从 PostgreSQL claim → 从保存的 `source_files` 恢复 Workspace → 模型 Builder → 静态预览门禁与 Reviewer → 事务保存不可变版本、HTML、审查和 Run result → 浏览器轮询任务详情。历史调用链与约束见 [当前架构](../ARCHITECTURE.md) 和 [代码地图](../CODEBASE-MAP.md)。

## Platform server Workflow、Worker 与版本快照

`ApplicationRepository.createTask` 首次创建一个模板版本：`app/page.tsx` 返回空内容，`public/preview.html` 为空；Run 的 `input_version_id` 指向该模板。`modifyTask` 则读取项目上次成功版本（没有时使用 current/template），同一项目存在 queued/running 时返回 409。请求必须带至少 8 字符的幂等键；相同键与不同 request 冲突。

`claimRun` 在事务中按创建顺序 `FOR UPDATE SKIP LOCKED` 领取 queued Run，写入 `running`、owner 和 lease，并从对应版本读取完整 `source_files`。没有完整非空快照就失败。`recoverExpiredLeases` 将 lease 已过期的 running Run 置为 failed，保留“执行进程中断，请重新提交修改要求”的受控错误。Worker 的 `processClaimedRun` 只在 lease 仍有效时调用 `finishRun` 或 `failRun`；丢失 lease 会跳过结果写入并在执行返回后抛错，但当前代码不会主动 Abort 正在进行的模型请求，因此模型调用可能继续到 transport 自然结束。

`finishRun` 为本次 Run 生成新的 UUID 版本；通过且审查 `pass` 才写 `current`，并把旧 current 标为 `superseded`、更新项目的 `current_version_id` 与 `last_successful_version_id`。失败候选仍写入 `project_versions`，状态为 `failed`，Run 历史保留；失败不覆盖上次成功作品。版本行保存完整 `source_files`、manifest、HTML、review 和 created-by-run 关系，版本内容不能覆盖。

`executeApplicationRun` 仍保留历史 Run budget 字段，但当前真实 Agent loop 不把它当作模型发挥限制；Agent 内部只保留 12 轮安全上限，避免模型异常时无限调用。`RealBuilderAgent` 每轮返回一个 action：宿主应用 patch、运行 check，并把新版本和观察结果带回下一轮；只有模型明确 `finish` 才形成 BuilderResult。每轮最多接受 100 个 patch，路径和受保护文件仍由 Workspace 校验。DeepSeek 路径初始构建后执行 `reviewCandidate`；修复从当前候选版本重新读取源码，最多三次。三次仍失败时状态是 `awaiting_fix_decision`；模型调用或未知错误由 Worker 转成失败记录。

### 预览产物门禁

[apps/platform-server/src/preview-artifact.ts](../../apps/platform-server/src/preview-artifact.ts) 的 `previewArtifactIssues` 只解析 HTML，不执行脚本。它要求非空、长度不超过 200,000 个 JavaScript UTF-16 代码单元（使用 `html.length`，不是字节数）、包含 `html`/`body`、正文有可见内容；拒绝外部脚本/样式/媒体资源、CSS `@import` 和非 data/hash 资源，也拒绝 Babel/JSX 或带 import 的 module script。`previewFailureReview` 把问题放入 `mustFix`，并明确这是静态检查而不是浏览器验收。

DeepSeek 编排额外要求每轮都更新 `public/preview.html`，生成完整自包含页面，禁止 CDN、导入、JSX/Babel 和浏览器存储。审查通过仍必须在最终返回时再次跑静态门禁。Persistence 的 `finishRun` 还检查成功结果的 `preview.html` 非空，并且与保存到 `source_files` 的内容完全相同；否则抛出 422，不升级为成功版本。

### 失败分类与日志

[apps/platform-server/src/run-failure.ts](../../apps/platform-server/src/run-failure.ts) 将预览、数据库、模型网关和内部错误转为受控 `code/attempts/message`。模型错误码包括 `TIMEOUT`、`INVALID_OUTPUT`、`RATE_LIMITED`、`TRANSPORT`、`PROVIDER`、`ABORTED`；用户只看到中文可操作提示，Provider 原文、凭据和生成源码不进入 API 错误或后台日志。Worker 日志仅写 `application.run.failed`、runId、受控 code 和 attempts；Application Run 持久化的是 error 文案，没有独立的 code 列。需要排查时先看 Run error 文案、Worker lease 和模型调用元数据，不要把异常原文当成用户可见契约。

## Agent Runtime、模型 Gateway 与配置

[packages/agent-runtime/src/real.ts](../../packages/agent-runtime/src/real.ts) 的 `RealBuilderAgent` 读取 [Builder Prompt](../../prompts/builder.md)，校验每轮 BuilderStep，将 patch 路径交给 `toSafePath` 后写入 Workspace，并把 Workspace 观察结果带回下一轮。`RealReviewerAgent` 读取按优先级选择的源码上下文，默认执行 install/lint/typecheck/test/build/preview_health，再通过 loop 允许模型请求额外检查和 browser action；Reviewer 同时收到原始用户请求，最终才返回 ReviewReport。Prompt 上下文最多 80 个文件、单文件 50,000 字符、总计 600,000 字符，并显式列出省略或截断文件。Reviewer 工具固定为 `reviewer.read`、`reviewer.check`、`reviewer.browser`，构造函数会调用 `assertReviewerToolGrants`；它没有写 Workspace 的 grant。

`checksAreSimulated` 为 true 时，会把命令/浏览器相关 check 标为 `skipped`，追加“Local trial”风险，不伪造通过。当前 platform-server DeepSeek 选项明确设置为 true，因此“真实模型”只证明模型传输与源码审查路径，不能证明生成项目的真实 install/build/test 或产品 Reviewer 浏览器流程。

[packages/model-gateway/src/gateway.ts](../../packages/model-gateway/src/gateway.ts) 的 `StructuredModelGateway` 负责超时、Abort、可重试错误、结构化 Zod 校验、可选的 INVALID_OUTPUT 纠错、token 累计、价格估算和 `ModelCallRecord`。通用 Gateway 默认 timeout 30 秒、最多重试 2 次、retryDelayMs 为 0（没有默认退避）；只有调用方传入正的 `retryDelayMs` 才会在重试前等待。超时、429、5xx/可重试 transport 可重试，普通 Provider、Abort 和 INVALID_OUTPUT 默认不重试；platform-server 显式开启一次 INVALID_OUTPUT 纠错。platform-server 使用 `MODEL_TIMEOUT_MS`（默认 120 秒，范围 1,000–300,000）、`maxRetries: 1`、500ms 间隔和一次结构化纠错。调用记录包含 provider/model/promptVersion、token、成本、延迟、attempts 和状态；当前保存到 Run result 的 `modelRecords`，不是完整 UsageLedger。Gateway 的 token/cost 统计用于响应与记录，不会把 workflow 的 maxSteps/maxInputTokens/maxOutputTokens/maxCostUsd/maxRuntimeSeconds 自动变成累计硬门禁。

[packages/model-gateway/src/deepseek.ts](../../packages/model-gateway/src/deepseek.ts) 默认 endpoint 为 `https://api.deepseek.com/chat/completions`，默认模型名为 `deepseek-flash`，也支持 `DEEPSEEK_ENDPOINT` 和 `DEEPSEEK_MODEL`。密钥只从 Worker 环境 `DSKEY` 读取；HTTP 请求使用 Bearer、JSON response format 和禁用 thinking，返回内容必须是 JSON。429/5xx 可重试，响应结构或 JSON 无效为 INVALID_OUTPUT。未设置 DSKEY 时 Workflow 明确失败（MISSING_API_KEY），产品没有替代模型分支。HTTP 401/402/429/5xx 等映射为受控中文原因，不输出 Provider 原文。单元测试使用脚本化 transport；需要真实模型的测试必须显式提供 DSKEY。

## Workspace、安全边界与真实/模拟边界

[packages/workspace/src/index.ts](../../packages/workspace/src/index.ts) 的 `LocalWorkspaceAdapter` 是确定性的内存适配器：保存不可变 Map 快照，按内容计算 SHA-256 manifest，`applyPatch` 要求 baseVersionId 匹配并为每次 patch 生成新版本。`toSafePath` 拒绝绝对路径、盘符、NUL、`..`、空/`.` 段；`.env`、锁文件和 `.env/` 目录不能被 patch。它的 check 总是 passed，preview URL 是 `https://preview.invalid/...`，截图/export 是 memory artifact，均为测试/本地编排 seam，不是真实容器或运行中的 Next.js。

[packages/workspace/src/self-hosted.ts](../../packages/workspace/src/self-hosted.ts) 是 `SelfHostedContainerAdapter` 的安全策略实现，要求注入 `ContainerExecutor`。它校验 rootless profile：network none、只挂载私有 workspace volume、read-only rootfs、no-new-privileges、drop ALL capabilities、用户 `1000:1000`；限制 CPU 2,000m、内存 4GiB、磁盘 5GiB、寿命 20 分钟和 256 进程。命令 binary 只允许 eslint/next/node/npm/npx/playwright/pnpm/tsc/vitest/yarn，拒绝 shell 元字符，要求 cwd 为 `/workspace` 或以 `/workspace/` 开头，并过滤敏感环境变量和 Docker socket。源码没有生产 Docker/Podman executor 装配；因此该模块证明的是可测试的 policy seam，不能声称生产 Sandbox 已接入。

平台宿主不会执行生成 HTML：预览由 Web 的 sandbox/CSP iframe 承载，生成代码不注入宿主 DOM。静态 HTML 检查、确定性 Workspace check、测试浏览器和注入式 `ContainerExecutor` 都属于模拟或策略验证；真实 Next.js install/build/test、运行中的隔离预览、产品 Reviewer 浏览器和真实发布仍未接入。相关缺口与最近证据见 [STATUS](../STATUS.md) 与 [INTEGRATION-STATUS](../INTEGRATION-STATUS.md)。

## 运行修复、迁移与排障入口

启动前确保 PostgreSQL 和 `DATABASE_URL` 可用。API 与 Worker 都走 `createApplicationResources`，启动时由 [packages/persistence/src/postgres.ts](../../packages/persistence/src/postgres.ts) 扫描根 [migrations](../../migrations/) 下所有匹配四位数字前缀的 SQL 文件，按文件名排序，用 advisory lock 串行执行并校验 checksum；已应用迁移被修改会直接失败。运行命令和环境变量入口见 [本地开发](../LOCAL-DEVELOPMENT.md)。

排障顺序：

1. `/healthz` 确认 API 能连接 PG，mode 固定为 `deepseek`，modelConfigured 表示 API 环境是否有密钥（不代表调用成功）；API 日志不提供模型异常原文。
2. 任务长期 queued 时检查 Worker 是否连接同一 `DATABASE_URL`、`WORKER_POLL_MS`（默认 1000，至少 50）和 `WORKER_LEASE_SECONDS`（默认 60，至少 3）。
3. running 后失败先看 Run 的受控 error 文案、Worker 日志中的 code 和 `application.run.failed` 记录及 lease；过期 lease 会失败，需用户重新提交，不会自动重复付费调用。
4. `PREVIEW_ARTIFACT` 检查模型是否更新 `public/preview.html`、是否有可见 body、内联资源和可直接执行脚本；不要通过放宽门禁解决问题。
5. 模型错误检查 `DSKEY`、endpoint、model、timeout 和 provider 限流；不要把 DSKEY 写入源码、prompt、页面或日志。
6. 结果写入 422 时核对 `result.previewHtml` 与 `source_files["public/preview.html"]` 是否一致；源码审查 pass 不会绕过数据库一致性门禁。

## 稳定模块与测试入口

构建链的稳定入口是 [workflow.ts](../../apps/platform-server/src/workflow.ts)、[worker.ts](../../apps/platform-server/src/worker.ts)、[real.ts](../../packages/agent-runtime/src/real.ts)、[gateway.ts](../../packages/model-gateway/src/gateway.ts)、[workspace/index.ts](../../packages/workspace/src/index.ts) 和 [application.ts](../../packages/persistence/src/application.ts)。相关验证可按范围运行：根 `npm run test:local` 覆盖 platform-server，`npm run test:model` 覆盖 Model Gateway，`npm run test:contract` 覆盖公共契约；当前 PostgreSQL ApplicationRepository 的主要集成测试在 `npm run test:local` 中；完整产品验证使用根 `npm run verify`。确定性 Workspace、注入式 sandbox policy 和测试浏览器的通过结果只证明各自测试范围，不能替代真实生产执行验收。

## 当前装配边界

- `RealReviewerAgent` 具备执行检查和 preview/browser 接口，但 platform-server 传入 `checksAreSimulated: true`；状态文档将其正确记录为模拟，不能从类存在推导生产能力。
- `LocalWorkspaceAdapter` 的 URL、check、screenshot/export 都是内存/invalid artifact；它与“workspace 可用”测试通过同时存在，不能当作真实沙箱。
- Domain/Contracts 定义了较完整的 planning、approval、publishing、events 和 UsageLedger，但当前 Application v1 网站只持久化 queued/running/completed/failed 这条 PG 队列路径；不要把 v0 状态机或旧事件投影写成网站已接入。
