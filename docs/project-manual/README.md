# Atoms Builder V1 项目说明手册

本目录集中说明项目的整体设计、各模块实现、开发方式和故障定位：先了解运行链路，再按模块查看实现，最后通过功能扩展表和故障表定位修改位置。实际运行与部署验证范围见 [验收记录](<../INTEGRATION-STATUS.md>)。

## 阅读顺序

| 章节 | 回答的问题 |
|---|---|
| [01 整体设计与运行链路](<01-architecture.md>) | 产品做什么？各进程如何配合？哪些能力还没实现？ |
| [02 Web 前端实现](<02-web.md>) | 路由、认证、任务状态、预览和页面分别在哪里？ |
| [03 HTTP API 与数据持久化](<03-api-and-data.md>) | 请求如何授权、排队、恢复？数据和版本存在哪？ |
| [04 构建、模型与执行引擎](<04-build-engine.md>) | Builder/Reviewer 如何协作？失败怎么修复？模型如何接入？ |
| [05 公共包与契约](<05-packages-and-contracts.md>) | 每个包负责什么？当前网站有哪些活动模块？ |
| [06 开发、测试与部署](<06-development-and-operations.md>) | 如何启动、验证、更新和备份？配置有哪些？ |
| [07 功能扩展与故障定位](<07-extension-and-troubleshooting.md>) | 具体需求从哪改？某个现象该沿哪条链路排查？ |

首次阅读建议依次看 01、03、04，再按 06 运行本地流程；前端开发先读 02，涉及公共包时读 05。日常可直接从 07 查需求和故障。每章包含源码和测试链接，可以按需查阅。

## 核心设计要点

1. 界面里的“任务”是一个持续存在的 `Project`，每次构建或修改是新的 `Run`；不是每点一次提交就创建新项目。
2. PostgreSQL 是账号、会话、任务、运行和完整源码版本的唯一产品数据源。刷新页面或重启应用不会依赖浏览器恢复源码。
3. HTTP API 只负责校验、认证、授权和事务排队；模型调用在独立 Worker 中发生。
4. 当前预览是独立 HTML 的隔离 iframe，不是生成的 Next.js 服务；宿主不执行生成项目的 install/build/test。
5. 新一轮失败时，任务阶段可以是 `failed`，但预览和主审核仍来自上次成功版本。这是保留成功作品的设计，需结合本轮运行记录读状态。
6. 仓库同时保留执行/领域 v0 契约与 Application HTTP v1。当前网站走 v1 和 PostgreSQL；未装配的发布与事件投影接口不等于网站已经有对应能力。

## 本手册与其他文档的关系

项目说明内容集中在本目录；源码、运行时 Prompt、迁移和部署配置仍放在原位置，通过链接定位。本目录不复制可执行配置，不放凭据或用户数据。

- 当前能力与长期缺口以 [STATUS](<../STATUS.md>) 为持续维护入口，实际验收证据见 [INTEGRATION-STATUS](<../INTEGRATION-STATUS.md>)。
- 日常快速导航见 [CODEBASE-MAP](<../CODEBASE-MAP.md>)；约束见 [ARCHITECTURE](<../ARCHITECTURE.md>)，接口状态见 [INTERFACES](<../INTERFACES.md>)。
- 参与开发遵循 [AGENTS](<../../AGENTS.md>) 和 [CONTRIBUTING-AGENTS](<../CONTRIBUTING-AGENTS.md>)，任务记录在 [TASK-BOARD](<../TASK-BOARD.md>)。
- 原设计和旧批次在 [历史归档](<../archive/bootstrap/>)。历史目标和 ADR 的 Accepted 状态不能当作已接入网站的证据。

后续改功能时，同步更新本目录受影响章节，特别是调用链、扩展入口、配置与故障表；不要只更新历史规划。源码与文档冲突时，先核对源码、测试及实际运行，再修正文档。
