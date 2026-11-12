# 文档索引：维护与增量开发

适用阶段：现有 localhost 基线上的优化、修复和新增功能。原始零到一方案尚未全部实现；当前可用范围和未完成项统一看 [STATUS](STATUS.md)。

## 项目说明手册

[项目说明手册](project-manual/README.md) 集中放在独立目录，按整体设计、Web 前端、API 与数据、构建引擎、公共包与契约、开发测试部署、功能扩展与故障定位分章说明。各章链接具体源码和测试，可顺序阅读或按问题查阅。

## 日常最短阅读路径

[项目入口](../README.md) → [当前能力](STATUS.md) → [代码地图](CODEBASE-MAP.md) → 对应源码/测试。Agent 另遵循 [AGENTS](../AGENTS.md)，任务写入 [维护任务板](TASK-BOARD.md)。

行为/架构改动按需读 [当前架构](ARCHITECTURE.md)；涉及启动、Interface 或验收时再读对应文档，不要求全文阅读历史设计。

## 文档分层与取舍

| 层级 | 保留文件 | 用途与更新时机 |
|---|---|---|
| 日常入口 | [根 README](../README.md)、[AGENTS](../AGENTS.md)、本文 | 启动、定位、维护规则；入口变化时更新 |
| 当前事实 | [STATUS](STATUS.md) | 实际可用能力和原目标差距；能力/限制变化时更新 |
| 代码导航 | [CODEBASE-MAP](CODEBASE-MAP.md) | 实际模块、调用链、需求改哪里；结构变化时更新 |
| 当前架构 | [ARCHITECTURE](ARCHITECTURE.md) | 从旧方案提炼的有效约束与当前结构；行为/架构变化时更新 |
| 日常开发 | [LOCAL-DEVELOPMENT](LOCAL-DEVELOPMENT.md)、[CONTRIBUTING-AGENTS](CONTRIBUTING-AGENTS.md) | 运行、验证、协作和改后文档更新矩阵 |
| 当前工作 | [TASK-BOARD](TASK-BOARD.md) | 维护任务、Owner、范围和验收；不保留完整零到一批次作为活跃计划 |
| 验收证据 | [INTEGRATION-STATUS](INTEGRATION-STATUS.md) | 实际验证命令、环境前置条件与结果；不是第二份状态清单 |
| 按需约束 | [CONTEXT](../CONTEXT.md)、[INTERFACES](INTERFACES.md)、[ADR](adr/) | 领域语言、跨模块契约、长期决策；相应概念/Interface/取舍变化才更新 |
| 按需部署计划 | [DEPLOYMENT-SINGLE-CVM](DEPLOYMENT-SINGLE-CVM.md)、[deploy README](../deploy/README.md) | 未来 CVM 方案与配置前置条件，尚不是已验证生产操作手册；部署任务再读 |
| 历史参考 | [完整建设设计](archive/bootstrap/DESIGN.md) | 保留最初产品目标、未实施方案和验收定义；不再作为日常开发主文档 |
| 历史参考 | [旧团队执行方案](archive/bootstrap/TEAM-EXECUTION.md) | 固定多 Agent 分工和建站批次已不适用；有效协作规则已移入 AGENTS/CONTRIBUTING |
| 历史参考 | [TASK-001 至 TASK-018](archive/bootstrap/TASK-BOARD.md) | 完成/未完成状态快照，保留追溯，不继续驱动当前任务 |

原 ADR 保留在原位置，Accepted 只代表选择过的方向，落地程度见当前架构和 STATUS；归档旧设计不意味着撤销安全、版本或审批约束。

## 不再需要作为日常流程的内容

- 每轮重新跑从零创建仓库、契约先行到全部模块的固定批次。
- 每轮启动固定数量和角色的开发 Agent。
- 在历史完整设计和当前代码地图中重复维护同一套实现现状。
- 不管改什么都机械改三份状态文档；按 [更新矩阵](CONTRIBUTING-AGENTS.md) 更新受影响内容即可。

这些内容已经归档或改写成维护规则，当前文档只描述活动代码和现存边界。

## 不属于可归档说明文档的文件

[Builder prompt](../prompts/builder.md) 和 [Reviewer prompt](../prompts/reviewer.md) 会被运行时代码加载，不能因为扩展名是 Markdown 就移动或删除。模块测试、SQL 迁移、Compose/Caddy 同样属于可执行资产或配置，不在本次文档归档范围。
