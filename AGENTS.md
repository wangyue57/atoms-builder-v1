# Agent 维护说明

你在维护 **Atoms Builder V1**。现有交付是 localhost 可用的 AI Web 构建试用入口；后续基于它优化、修复和新增能力。**维护模式不表示原始生产平台目标全部完成。** 不要根据聊天历史或历史规划猜测现状。

## 开始任务

1. 读 `README.md` 与 `docs/STATUS.md`，确认运行入口、实际能力和已知缺口。
2. 读 `docs/CODEBASE-MAP.md` 定位要改的模块、调用链、测试，再读对应源码。
3. 在 `docs/TASK-BOARD.md` 确认/记录当前任务、Owner、依赖、Allowed/Forbidden paths 与验收标准。
4. 行为或架构改动前读 `docs/ARCHITECTURE.md`；涉及领域术语时读 `CONTEXT.md`，涉及公共类型/事件时读 `docs/INTERFACES.md`。
5. 验证规则和文档更新规则见 `docs/CONTRIBUTING-AGENTS.md`；启动问题读 `docs/LOCAL-DEVELOPMENT.md`，验收证据读 `docs/INTEGRATION-STATUS.md`。

文档总索引见 `docs/README.md`。`docs/archive/bootstrap/` 是历史建设方案，不是日常必读项，不继续更新其中的批次/任务。需要追溯目标或决策时按链接查阅；部署问题按需读 `docs/DEPLOYMENT-SINGLE-CVM.md`，架构取舍读适用 ADR。

## 文档同步步骤

代码改动完成后，按以下顺序维护文档：

1. 用 `rg` 搜索被删除或重命名的路径、包名、导出符号、环境变量和旧能力描述，逐项处理活动文档中的引用。
2. 按影响范围更新文档：入口或调用链改动更新 `docs/CODEBASE-MAP.md`；能力、限制或默认行为改动更新 `docs/STATUS.md`；架构边界或模块职责改动更新 `docs/ARCHITECTURE.md` 和对应手册；公共类型、事件或 transport 改动更新 `docs/INTERFACES.md`；启动、测试或部署方式改动更新 `docs/LOCAL-DEVELOPMENT.md`、部署手册和 `docs/project-manual/06-development-and-operations.md`；验证结果更新 `docs/INTEGRATION-STATUS.md`；任务范围和验收条件更新 `docs/TASK-BOARD.md`。
3. 以源码、测试和实际启动方式为准重写现状段落，删除失效链接和已经不存在的旧模块说明，不追加“后来如何变化”的历史叙述；`docs/archive/` 只读。
4. 检查 Markdown 相对链接、代码路径和脚本名，运行 `git diff --check`；涉及公共接口或运行链路时再运行对应构建、类型和集成验证。
5. 结束任务时在交付说明中列出实际修改的文档、无迁移或接口变化的结论，以及仍未接入的能力边界。

## 实现与协作

- 从当前需求出发，不自动重跑建站批次，不因历史方案而强制引入未需要的服务/框架。
- 先核对既有 Interface 和 Adapter，再改实现。文档和源码冲突时以源码、测试和实际运行核对，修正对应文档。
- 小而集中的维护任务可直接实现；有独立可并行任务时再分派 subagent。每个任务唯一 Owner、明确允许/禁止路径和验收标准，写入范围不重叠。
- 公共 Contracts、历史数据库迁移和跨模块集成由 Lead 串行协调。测试新增 Adapter 时使用命名清晰的确定性测试适配器，再验收真实环境，明确是否已接入用户路径。
- 开发协作 Agent 与产品的 Builder/Reviewer 是不同层次；不要因为分工新增产品角色或模板。
- 运行相关模块/契约/编译检查；跨模块改动做集成验证。仅文档任务检查链接、引用和 `git diff --check`，无需重复跑产品测试。

## 不可违反的约束

- 密钥只从后端环境读取，不写入源码、页面、模型输入、日志或文档；DeepSeek 使用环境变量 `DSKEY`。
- 生成代码不能在平台 HTTP 进程、Worker 或宿主机直接执行；真实 install/build/test 必须通过隔离执行 Adapter。
- 不向公网接口或生成项目暴露 Docker Socket；Postgres、Redis、Temporal 和沙箱端口不得暴露公网。
- Reviewer 默认只读。模拟命令/浏览器检查不能冒充真实通过，审核不得编造证据。
- 不可变版本；预览、审查和发布绑定明确版本。发布等外部副作用需要审批、幂等和审计。
- 不把编译成功、确定性适配器测试或测试浏览器结果当成完整生产验收。当前缺口见 STATUS，不能因归档文档而关闭缺口。

## 结束任务

必须交付：改动文件、任务 ID、验证命令与结果、数据库迁移/公共 Interface 变化、未解决风险和后续依赖。

更新当前任务板；其他文档按 `docs/CONTRIBUTING-AGENTS.md` 的影响矩阵更新。入口/调用链变化更新代码地图，能力/限制变化更新 STATUS，验收结果更新 INTEGRATION-STATUS。不要求每个小修改无意义地重写所有状态文档；历史归档不再追加日常任务。
