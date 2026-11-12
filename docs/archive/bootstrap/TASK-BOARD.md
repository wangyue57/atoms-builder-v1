# 历史任务看板（TASK-001 至 TASK-018）

> 2026-11-11 冻结归档（TASK-019）。保留原始状态与依赖，不再驱动维护顺序；原 TASK-012/014/015 尚未全部验收，并未因归档变为 done。能力差距已转录至 [STATUS](../../STATUS.md)，当前任务见 [维护任务板](../../TASK-BOARD.md)。


> 勘误（2026-11-11）：原 TASK-004 对 migrations 的描述不准确；[六表 SQL 基线](../../../migrations/0001_control_plane.sql) 已存在，未接入的是 Postgres Adapter、完整迁移执行及实际控制面。保留下方原记录，不将其误读为完整数据库功能。

状态定义：

- `planned`：已定义但未开始。
- `ready`：依赖已满足，可以分派。
- `in_progress`：已有 Agent 执行。
- `blocked`：等待接口、环境或决策。
- `review`：实现完成，等待 QA 或 Lead 审核。
- `done`：验收标准和集成测试均通过。

当前阶段：Phase 2，Fake/Contract 垂直切片完成，真实执行与部署处于 review。

| ID | Owner | 任务 | 依赖 | 状态 | 验收摘要 |
|---|---|---|---|---|---|
| TASK-001 | Domain | 定义领域类型和状态机 | 无 | done | 非法状态跳转有测试 |
| TASK-002 | Domain | 定义公共接口和事件 Schema | TASK-001 | done | Contracts 可编译并可校验 JSON |
| TASK-003 | QA | 建立 Contract Test 框架 | TASK-001 | done | Fake Adapter 可运行 |
| TASK-004 | Control Plane | Memory Repository 和租户隔离契约 | TASK-002 | done | 项目与 Run CRUD、租户隔离、幂等和不可变版本测试通过；Postgres/migrations/API 未实现 |
| TASK-005 | Workspace | Local Workspace Adapter | TASK-002, TASK-003 | done | 文件、补丁、版本和检查可用 |
| TASK-006 | Runtime | Fake Model 和 Fake Agent Loop | TASK-002 | done | Builder → Reviewer → Repair |
| TASK-007 | Studio | Fake API 和事件 projection | TASK-002 | done | 能从事件展示 Fake Run 状态、版本和预览；真实 Next.js Studio UI 未实现 |
| TASK-008 | Lead | Fake Run 端到端集成 | TASK-004..007 | done | 新建到预览闭环通过 |
| TASK-009 | Workspace | 自托管 Sandbox 安全策略 Adapter | TASK-005, TASK-008 | done | 受限 rootless profile、命令/路径/资源策略和注入式 executor seam 通过；生产 Docker/Podman executor 未实现 |
| TASK-010 | Runtime | 结构化 Model Gateway seam | TASK-006, TASK-009 | done | 结构化输出、成本、超时和重试通过；真实 Model Provider 由 TASK-017 接入 DeepSeek Flash |
| TASK-011 | QA | Builder/Reviewer 黄金任务集 | TASK-006, TASK-007 | done | 至少 30 个固定任务 |
| TASK-012 | Runtime | 真实 Builder 和 Reviewer | TASK-009..011 | review | Real Builder/Reviewer 代码已实现并通过注入式 Fake 验证；真实 DeepSeek Provider 已由 TASK-017 接入，生产 Sandbox 和浏览器验收未完成 |
| TASK-013 | Deploy | Fake Deployment Adapter | TASK-002, TASK-003 | done | Fake Provider 的版本发布、审批、幂等和回滚契约通过；生产 Provider 未实现 |
| TASK-014 | Deploy | CVM Docker Compose 部署 | TASK-008, TASK-013 | review | Compose/Caddy 静态验证通过，等待真实 CVM smoke |
| TASK-015 | Lead | 审批、发布和回滚集成 | TASK-012, TASK-014 | planned | 线上版本可更新和恢复 |
| TASK-016 | Lead | 完善 Git 忽略规则并清理暂存的构建产物 | 无 | done | `.gitignore` 覆盖依赖、构建、缓存、环境配置及测试报告；21 个忽略正例和 16 个保留反例通过；128 个 dist 产物移出索引且本地保留 |
| TASK-017 | Lead | localhost 试用工作台和 DeepSeek Flash | TASK-008, TASK-010 | done | 49 个已有回归 + 4 个本地 API 测试；真实首次生成/继续修改通过；Chrome 验证预览、报告、修改和隔离；生产 Gate 2/3 保持未通过 |
| TASK-018 | Lead | Agent 代码地图和文档维护体系 | TASK-017 | done | 实际模块/调用链/需求导航、按需阅读与更新矩阵已建立；102 个本地链接和 11 个关键符号核对通过；仅文档改动 |

> 说明：TASK-004、009、010、013 的 `done` 仅表示其 Memory/Fake/Contract 或安全 seam 验收通过。真实 PostgreSQL/migrations、Control API、Temporal Worker、生产 Sandbox Executor、真实 Next.js Studio UI 和生产 Deployment Provider 仍需后续任务拆分与验收。DeepSeek Provider 与本地试用工作台由 TASK-017 接入。

## 当前并行批次

### Batch 0：契约批次

- TASK-001：Domain Agent，`done`。
- TASK-002：Domain Agent，`done`。
- TASK-003：QA Agent，`done`。

### Batch 1：Fake 垂直切片（done）

- TASK-004、TASK-005、TASK-006、TASK-007 和 TASK-008 已完成。

### Batch 2：真实执行（review）

- TASK-009、TASK-010、TASK-011 的 Fake/Contract 或安全 seam 验收已完成；TASK-012 的代码路径和 DeepSeek 本机生成/源码审查已实现，但等待可执行 Sandbox 和真实浏览器流程验收。

### Batch 3：发布（blocked by review gates）

- TASK-013：Fake Deployment 已完成。
- TASK-014：Compose/Caddy 拓扑和静态安全校验处于 review，等待真实 CVM smoke；Compose 使用尚未构建的外部服务镜像。
- TASK-015：必须等 TASK-012 和 TASK-014 通过后再启动。

## 任务操作规则

- 一个任务只有一个 Owner。
- 公共类型、事件 Schema 和历史迁移必须由 Lead 串行合并。
- Agent 不得修改任务的 `Allowed paths` 之外的文件。
- 任务完成必须附验证命令和结果。
- `done` 只能由 Lead 根据验收标准确认。
