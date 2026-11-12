# 07 功能扩展与故障定位

[返回手册](<README.md>) · [开发与部署](<06-development-and-operations.md>)

## 1. 按功能定位修改入口

表内“验证”是推荐范围，命令说明见 [开发章节](<06-development-and-operations.md>)。公共 Interface 变化还应更新 [接口状态](<../INTERFACES.md>) 和契约测试；数据库只追加迁移。

| 需求 | 主要修改入口 | 需要同时考虑 | 验证 |
|---|---|---|---|
| 调整首页、历史或任务详情 | [pages](<../../apps/web/src/pages/>)、[components](<../../apps/web/src/components/>)、[theme](<../../apps/web/src/app/theme.ts>) | 不把服务器状态变成本地持久化；详情直接访问和手机布局 | check:web、test:web，交互变化做 E2E |
| 新增页面/路由 | [App.tsx](<../../apps/web/src/app/App.tsx>)、页面与导航组件 | 是否受保护、登录后跳转、SPA深路由、未知路由 | Web 单测、E2E直接访问与刷新 |
| 新增任务字段 | [application-v1](<../../packages/contracts/src/application-v1.ts>) → [Repository](<../../packages/persistence/src/application.ts>) → [server](<../../apps/platform-server/src/server.ts>) → [client](<../../apps/web/src/api/client.ts>) 与 UI | 先确定字段属于 Project、Run 还是 Version；列表用summary | contract、local、Web，必要时restart |
| 增加历史搜索/筛选 | [listTasks](<../../packages/persistence/src/application.ts>)、[server](<../../apps/platform-server/src/server.ts>)、[HistoryPage](<../../apps/web/src/pages/HistoryPage.tsx>)、[queryKeys](<../../apps/web/src/app/query-client.ts>) | owner过滤、分页总数、稳定排序、queryKey需带筛选条件；按需追加索引 | PG权限/分页测试、Web测试 |
| 改注册登录/会话 | [account Schema](<../../packages/contracts/src/application-v1.ts>)、[server](<../../apps/platform-server/src/server.ts>)、[Repository](<../../packages/persistence/src/application.ts>)、[AuthProvider](<../../apps/web/src/features/auth/AuthProvider.tsx>) | Cookie生命周期、失败节流、退出缓存清理、错误不泄露凭据 | contract、真实PG、Web/E2E |
| 团队共享/组织角色 | Repository所有项目读写、组织成员模型、HTTP契约和UI | 当前只有owner隔离，不能只加组织选择器；跨用户404语义需重新设计 | PG授权矩阵、契约、跨账号E2E |
| 改生成效果/模型提示词 | [Builder Prompt](<../../prompts/builder.md>)、[Reviewer Prompt](<../../prompts/reviewer.md>)、[real agents](<../../packages/agent-runtime/src/real.ts>)、[workflow](<../../apps/platform-server/src/workflow.ts>) | 多轮 action→Workspace observation→action、原始需求上下文、每轮同步独立HTML、只读审查、输出Schema | agent-runtime、model测试；质量改动单独评估真实模型 |
| 切模型/新增Provider | [gateway](<../../packages/model-gateway/src/gateway.ts>)、[DeepSeek transport](<../../packages/model-gateway/src/deepseek.ts>)、Workflow装配 | transport与结构化重试区分、超时、用量、密钥与错误脱敏；无密钥时明确失败 | model、agent-runtime、Workflow集成 |
| 调整自动修复次数/策略 | [workflow](<../../apps/platform-server/src/workflow.ts>) | 应用 loop 上限由 Agent Runtime 管理；付费次数和失败语义 | 相关Workflow/Agent测试，按需PG集成 |
| 修改预览支持范围 | [preview-artifact](<../../apps/platform-server/src/preview-artifact.ts>)、[preview-document](<../../apps/web/src/features/preview/preview-document.ts>)、[PreviewPanel](<../../apps/web/src/components/PreviewPanel.tsx>)、Workflow要求 | 静态门禁、CSP、sandbox和模型要求必须一致；保持版本绑定 | preview-artifact、Web预览测试与浏览器 |
| 加入真实构建/浏览器审核 | [self-hosted seam](<../../packages/workspace/src/self-hosted.ts>)、[执行Contracts](<../../packages/contracts/src/execution.ts>)、RealReviewer/Workflow装配 | 实现并接入隔离Executor、产物/证据/超时/资源清理；不可在宿主执行 | Adapter确定性测试 + 隔离环境真实执行验收 |
| 加入取消/步骤进度 | server、Application契约、Repository、Worker、Gateway及UI | 目前只有轮询终态；需定义状态、取消传播、租约、费用与并发，不能只停止前端轮询 | 契约、PG竞态、模型中断、E2E |
| 恢复历史版本 | Project Version、Repository、Application API和UI | 保持快照不可覆盖；明确创建restore Run还是变更引用，审核/预览需一致 | 版本不变量、权限和持久化恢复测试 |
| 加 ZIP/Git 导出 | Repository完整快照读取、新API及UI | 当前没有导出接口；版本所有权、路径校验、文件大小/数量、私密数据 | 契约、PG权限、打包内容检查 |
| 发布生成项目 | [deployment契约](<../../packages/contracts/src/deployment.ts>)、API/Worker新路径 | 当前没有网站发布路径；真实Provider、显式版本、审批、幂等、审计与回滚 | Adapter + 审批/发布集成 + 真实Provider现场验收 |
| 平台镜像/服务器升级 | [Dockerfile](<../../Dockerfile>)、[Compose](<../../docker-compose.yml>)、[deploy](<../../deploy/README.md>) | API/Worker同镜像、迁移兼容、active Run、卷和备份 | deploy-config、健康检查、真实账号任务验收 |

## 2. 一项跨层功能的实施顺序

以“历史任务增加一个可筛选属性”为例：

1. 先决定它是项目属性还是某次运行属性，明确谁能修改、列表与详情如何显示、是否需要默认值。
2. 在 [迁移目录](<../../migrations/>) 追加SQL；在 `ApplicationRepository` 写入/读取并保留 owner 条件和分页语义。
3. 修改 Application Schema 和服务端输入校验，按冻结规则处理版本/兼容；不能让页面偷偷接受不一致响应。
4. 修改 API client、queryKey、失效刷新和页面；新筛选改变总数时检查空页行为。
5. 补充有意义的PG权限/过滤/并发用例，再验证UI；更新代码地图、接口文档和本手册受影响部分。

单纯主题样式不需要走全套数据库流程；改公共字段则不能停在页面。先看 [任务板](<../TASK-BOARD.md>) 的Owner和写入范围，避免并行修改相同公共文件。

## 3. 用标识贯穿排查

一次问题至少定位 taskId（Project ID）、runId、输入/输出 versionId、发生时间及运行模式。前端地址含taskId；任务响应包含最新Run摘要与成功版本；Worker日志用runId关联。主 result 可能属于旧成功Run，不能仅凭它判断本轮。

建议先回答四个问题：HTTP是否成功排队？数据库是否仍queued？Worker是否claim并持有有效租约？终态是否有新成功版本？再决定查看前端、API、队列、模型或保存层。

数据库诊断应使用只读连接；下面是逻辑排查查询，`:project_id`/`:run_id` 需要由数据库客户端绑定参数，不要直接拼接用户输入：

```sql
select id, owner_user_id, current_version_id, last_successful_version_id, updated_at
from projects where id = :project_id;

select id, kind, status, input_version_id, lease_owner, lease_until,
       error, created_at, finished_at
from runs where project_id = :project_id
order by created_at desc, id desc;

select id, parent_version_id, status, created_by_run_id,
       manifest_hash, octet_length(preview_html) as preview_bytes
from project_versions where project_id = :project_id
order by created_at desc;
```

不要为排障导出完整源码、用户密码字段或会话摘要到公共日志；需要核对文件时只读目标版本必要内容。

## 4. 故障症状 → 检查 → 实现位置

| 症状 | 优先检查与判断 | 源码定位 / 处理方向 |
|---|---|---|
| 应用启动即退出 | Docker/PG是否就绪、DATABASE_URL/角色权限、迁移checksum；不要删除卷 | [bootstrap](<../../apps/platform-server/src/bootstrap.ts>)、[postgres](<../../packages/persistence/src/postgres.ts>)、[环境脚本](<../../scripts/environment.mjs>) |
| 首页503提示Web未构建 | 是否用生产入口而未构建前端；运行镜像是否包含产物 | [frontend](<../../apps/platform-server/src/frontend.ts>)；执行build:web或重建镜像 |
| 改了页面没有变化 | 当前是源码dev还是旧镜像；HMR是否连上；包源码是否重编译 | [dev](<../../apps/platform-server/src/dev.ts>)、[构建脚本](<../../package.json>)、[Dockerfile](<../../Dockerfile>) |
| 刷新详情404/白屏 | 区分服务器404、API404和前端未知路由；缺失assets不应返回HTML | frontend、[App](<../../apps/web/src/app/App.tsx>)、[TaskPage](<../../apps/web/src/pages/TaskPage.tsx>) |
| 注册409或登录401/429 | 账号归一化冲突、凭据错误、15分钟节流；不是模型问题 | Repository `register/login`、server；不要清库处理 |
| 登录后又回登录页 | Cookie是否被浏览器接受/发送，http与Secure、域名一致性、session过期 | server Cookie/Origin、Repository `sessionUser`、AuthProvider |
| 写接口403 | Origin与host/protocol/APP_ORIGIN是否匹配；代理HTTPS配置 | server `sameOrigin`、Compose环境 |
| 某任务404而列表正常 | 是否换账号、项目已非active、ID错误；跨用户404是预期保护 | Repository `task/modifyTask` 的owner条件 |
| POST返回400/413 | 请求是否strict含了多余字段、request/key长度、body字节数 | application-v1 Schema、server `readBody` |
| 重复提交409 | key是否用于不同文本、当前是否有queued/running | Repository `createTask/modifyTask`、任务queries；同次网络重试保留key |
| 任务一直queued | Worker是否启动/崩溃、API/Worker是否连同库、claim输入快照是否损坏 | worker `startWorker`、Repository `claimRun`；healthz不能证明Worker在线 |
| 任务一直running | lease是否仍未来、续约是否成功、模型是否等待/重试；无Worker时不会自动扫过期 | `processClaimedRun`、`recoverExpiredLeases`、模型网关；恢复Worker后过期任务会failed |
| 中断后不自动继续 | 过期运行按失败处理避免重复付费，queued才可重启继续 | Repository恢复方法；通过新Run显式重试，不直接改running为queued |
| 明明配了 key 却失败 | 运行中的Worker是否收到了环境、是否重启；API mode不是Worker证据 | Workflow mode、进程启动和Compose映射 |
| 模型TIMEOUT/INVALID_OUTPUT | 单次超时、输出结构、最大一次追加调用；查看runId的model.call，不输出Provider原文 | [gateway](<../../packages/model-gateway/src/gateway.ts>)、[transport](<../../packages/model-gateway/src/deepseek.ts>)、[run-failure](<../../apps/platform-server/src/run-failure.ts>) |
| 显示“审查未通过” | 本轮失败候选、静态预览问题或源码review mustFix；是否已耗尽三轮修复 | workflow、preview-artifact、RealReviewer、runs.error |
| 任务失败却仍能看旧作品 | 核对最新Run与主result版本；这是保留成功作品的投影 | Repository `task/finishRun`、TaskPage |
| 继续修改丢失之前功能 | 输入版本是否上次成功、source_files是否完整；模型是否覆盖了未改内容 | Repository `modifyTask/claimRun`、Workflow projectSpec、RealBuilder |
| Next源码变了但预览旧/空 | 本轮是否更新public/preview.html、HTML是否含可见内容与可用内联资源 | workflow reviewCandidate、preview-artifact、Repository `finishRun` |
| 预览样式/交互不工作 | 浏览器iframe错误、CSP拒绝的外部资源、JSX/import/storage等；静态检查不保证业务正确 | preview-document、PreviewPanel、生成的目标HTML；不通过放开sandbox规避 |
| 全窗口/退出丢交互状态 | 是否替换了iframe、key/version变了、浏览器moveBefore支持与fallback | PreviewPanel、预览测试；手动reload本就创建新上下文 |
| 保存失败 DATABASE_* | 按受控SQLSTATE查权限/约束/连接，核对事务是否回滚 | Repository `finishRun`、postgres、run-failure；不要吞异常标成功 |
| 页面提示无效服务端响应 | HTTP成功但Schema不匹配、旧前端/新后端版本不一致 | client parse、Application Schema、部署API/Worker/Web版本 |
| 测试通过但真实模型效果差 | 测试隔离真实DSKEY；本机模型替身不衡量生成质量 | test-database、evals与真实模型案例；分别记录测试和付费验证 |
| PG测试全skip | TEST_DATABASE_URL未设置或绕过包装器 | server.test的pgTest，按开发章节准备独立测试库 |

## 5. 暂未实现能力的入口与边界

出现下列需求时应新建明确的开发范围，不能把已有文件名当成产品已实现证明：

- **实时事件/SSE**：仓库已有事件Schema和旧Studio投影，但当前HTTP接口是任务轮询，当前Workflow未写完整EventStore。
- **真实沙箱**：已有路径/命令/资源策略与注入Executor seam，还缺生产执行器、装配和实际证据。
- **审批/发布/回滚**：Contracts 定义了发布接口，但网站没有外部发布闭环。
- **额度与审计**：模型调用元数据不等于完整UsageLedger、计费预留与审计平台。
- **团队/密码找回/导出**：当前账号和个人任务能力不能直接外推这些功能已经存在。

实现这些能力时，同步检查 [公共包章节](<05-packages-and-contracts.md>) 的可复用模块与 [当前缺口](<../STATUS.md>)，只有完成真实用户路径和相应验收后才能更新能力状态。

## 6. 修改完成后的文档与证据

[CONTRIBUTING-AGENTS](<../CONTRIBUTING-AGENTS.md>) 给出维护矩阵：能力变化更新STATUS，入口/调用链变化更新CODEBASE-MAP，契约变化更新INTERFACES，运行和配置变化更新开发/部署说明，实际验收更新INTEGRATION-STATUS。本目录同步更新相应章节，不机械重写所有文档。

结果记录应说明任务ID、修改位置、验证命令与范围、数据库迁移和公共接口影响、未解决问题。编译、确定性适配器测试、测试浏览器、真实数据库、真实模型、真实隔离执行和生产部署是不同证据，不能相互替代。
