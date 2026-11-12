# 代码地图

最近核对：2026-11-12（TASK-042）。维护任务见 [TASK-BOARD](TASK-BOARD.md)，当前能力见 [STATUS](STATUS.md)。

## 当前入口与调用链

- [apps/web](../apps/web/) 是 React/MUI 前端；[main.tsx](../apps/web/src/main.tsx)、[App.tsx](../apps/web/src/app/App.tsx) 装配认证、任务列表、任务详情和隔离预览。
- [apps/platform-server/src/main.ts](../apps/platform-server/src/main.ts) 启动 API/Worker；[server.ts](../apps/platform-server/src/server.ts) 处理认证、权限和排队，[frontend.ts](../apps/platform-server/src/frontend.ts) 托管前端静态资源。
- [apps/platform-server/src/worker.ts](../apps/platform-server/src/worker.ts) 从 PostgreSQL claim 运行；[workflow.ts](../apps/platform-server/src/workflow.ts) 装配 DeepSeek、Workspace 和 Builder/Reviewer loop。
- [packages/agent-runtime/src/real.ts](../packages/agent-runtime/src/real.ts) 加载 [builder prompt](../prompts/builder.md) 与 [reviewer prompt](../prompts/reviewer.md)，每轮执行 action、收集 Workspace observation，再决定下一轮。
- [packages/model-gateway/src/gateway.ts](../packages/model-gateway/src/gateway.ts) 负责超时、重试、结构化校验、纠错和用量；[deepseek.ts](../packages/model-gateway/src/deepseek.ts) 是唯一产品 Provider transport。系统消息可选，输出 token 上限未配置时交给 Provider 默认值。
- [packages/workspace/src/index.ts](../packages/workspace/src/index.ts) 提供不可变本地快照；[self-hosted.ts](../packages/workspace/src/self-hosted.ts) 提供隔离容器策略 seam，尚未装配真实 executor。
- [packages/persistence/src/application.ts](../packages/persistence/src/application.ts) 实现账号、会话、任务、版本和 Worker lease；[postgres.ts](../packages/persistence/src/postgres.ts) 执行追加迁移。
- [docker-compose.yml](../docker-compose.yml) 与 [Dockerfile](../Dockerfile) 是本机和服务器统一部署入口，默认 API 端口为 8787。

一次任务：Cookie 认证 → API 事务创建 queued Run → Worker 从 PostgreSQL claim → 从完整 source snapshot 恢复 Workspace → Builder loop → 静态预览门禁 → Reviewer loop → 保存不可变版本和结果 → 前端轮询详情。

## 当前模块

| 模块 | 入口 | 验证 |
|---|---|---|
| Domain | `packages/domain/src` | `npm test --prefix packages/domain` |
| Contracts | `packages/contracts/src` | `npm run test:contract` |
| Platform server | `apps/platform-server/src` | `npm run test:local` |
| Agent runtime | `packages/agent-runtime/src/real.ts` | `npm test --prefix packages/agent-runtime` |
| Model gateway | `packages/model-gateway/src` | `npm run test:model` |
| Workspace | `packages/workspace/src` | `npm test --prefix packages/workspace` |
| Persistence | `packages/persistence/src/application.ts`, `postgres.ts` | `npm run test:local` |
| Web | `apps/web/src` | `npm run check:web && npm run test:web` |
| Evals / deploy config | `evals/`, `deploy/` | `npm run test:evals && npm run test:deploy-config` |

未装配的领域发布、事件投影和真实生成项目部署接口不在当前产品调用链中；不要把契约类型推断成用户可用功能。

## 按需求定位

- 页面与主题：`apps/web/src/pages`、`app/theme.ts`、`styles/global.css`。`RequestComposer.tsx` 统一首页与详情输入/键盘；`TaskPage.tsx` 装配 `ConversationPanel.tsx` 的逐轮聊天记录、固定输入、移动页签与 `PreviewPanel.tsx`；`StatusPanel.tsx` 仅消费已有服务端状态。`PreviewPanel.tsx` 管理预览/代码页签、本页 HTML 草稿与版本冲突提示，`SourceEditor.tsx` 封装 CodeMirror 6 的创建/销毁、受控文档同步、撤销历史与编辑动作，首次进入代码页签由 React lazy 按需加载，之后保留实例；编辑不经过 API、不写入历史版本。交互回归为 `tests/e2e/interaction.spec.ts`（HTTP fixture）；真实账号/模型链路为 `tests/e2e/workspace.spec.ts`。
- 认证、权限、任务排队：`application-v1.ts` → `server.ts` → `ApplicationRepository`。
- Prompt、模型、修复轮次：`prompts/` → `real.ts` → `gateway.ts` → `deepseek.ts` → `workflow.ts`。
- 预览和安全：`preview-artifact.ts`、`preview-document.ts`、`PreviewPanel.tsx`。
- 部署：`Dockerfile`、`docker-compose.yml`、`deploy/`；生成项目发布能力尚未接入。

## 验证入口

常用本地验证为 `npm run build`、`npm run typecheck`、`npm run test:contract`、`npm run test:model`、`npm run test:local`、`npm run check:web` 和 `npm run test:web`。真实模型 E2E 与重启测试不再注入本机模型服务，需要调用方显式提供 `DSKEY`；没有密钥时只运行不需要 Provider 的测试。详细环境见 [LOCAL-DEVELOPMENT](LOCAL-DEVELOPMENT.md)，验收边界见 [INTEGRATION-STATUS](INTEGRATION-STATUS.md)。
