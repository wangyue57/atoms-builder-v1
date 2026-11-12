# 当前能力与已知缺口

最近核对：2026-11-12（TASK-043）。当前已交付账号与持久化的 AI Web 构建应用，并已将最新产物源码编辑功能部署到中国香港单机 CVM，通过公网 HTTPS 提供服务；原始生产目标仍有明确未完成范围。验收证据见 [INTEGRATION-STATUS](INTEGRATION-STATUS.md)，入口见 [代码地图](CODEBASE-MAP.md)，运行见 [LOCAL-DEVELOPMENT](LOCAL-DEVELOPMENT.md)。

## 当前可用能力

- React + TypeScript + MUI 界面，提供账号密码注册/登录、历史任务分页、详情直接访问、刷新恢复和继续修改；账号只支持用户名密码，不提供邮件/社交登录。首页、账号、历史和详情采用统一蓝白界面；需求输入支持 Enter 发送、Shift+Enter 换行与中文输入法保护。详情为桌面双栏/移动页签工作台，左侧按时间展示每轮需求与真实处理结果，输入固定在底部；显示实际排队/生成与审查/完成或失败状态、提交后经过时长与自动刷新提示；运行中可先写下次草稿，成功提交清空、失败保留。旧预览有明确版本提示。当前没有细分 Agent 步骤流或真实百分比。
- PostgreSQL 是唯一产品数据源，保存用户、登录会话、项目、每次运行、完整源码/manifest、审核与 HTML 产物。浏览器只缓存服务器状态，退出后清理缓存，其他用户不能读取或修改你的任务。
- 注册创建个人组织与成员关系；随机盐 scrypt 保存密码，随机会话 token 仅摘要入库，HttpOnly/SameSite Cookie，登出撤销会话，数据库记录登录失败节流。
- HTTP API 事务落库排队，独立 Worker 消费同一 PostgreSQL 队列；刷新/关闭页面不取消运行，queued 可重启继续，过期 running 租约标记失败并支持重试，不自动重复付费模型调用。
- 本机与服务器使用同一 Compose、迁移、Repository、API 和 Worker；香港 CVM 已部署 PostgreSQL、API、Worker 和 Caddy，数据库从旧机备份恢复，DNS、Let’s Encrypt、公网 HTTPS、账号链路和一次真实 DeepSeek 任务均通过。原中国内地 CVM 的 ICP 拦截不再是当前公网入口依赖。模型密钥曾在历史部署交互中回显，建议后续轮换。
- 后端只通过 `DSKEY` 使用 DeepSeek Flash；缺少密钥时任务明确失败，不再生成未经模型确认的演示作品。调用失败显示密钥无效、余额不足、限流、超时等受控原因；格式错误进一步区分页面生成/源码审核、输出截断、JSON解析和字段结构，并使用原答案进行一次有界纠正。模型测试使用命名清晰的确定性适配器；真实模型测试需要显式 DSKEY。
- Worker 从保存的完整快照继续构建，真实 Builder/Reviewer 通过多轮 action→Workspace observation→action loop 协作，Reviewer 同时收到原始用户请求；失败保留上次成功作品与独立失败记录。版本使用持久化唯一 ID，源码/审查/预览绑定版本；历史版本不可覆盖。
- HTML 使用 sandbox/CSP 隔离 iframe，支持「预览 / 代码」页签、全窗口与独立重载；首次打开代码页签按需加载本地打包的 CodeMirror 6，提供 HTML/CSS/JavaScript 高亮、行号、折叠、补全、缩进、搜索替换和撤销重做；可直接编辑实际 `public/preview.html`（含内联 CSS/JavaScript），250ms 防抖自动更新隔离预览。编辑为本页草稿，切换页签保留，刷新或离开页面后丢失，不保存到数据库，也不进入下一轮模型上下文；新版本到达不会覆盖未恢复的草稿。代码页签不提供完整 Next.js 项目文件编辑/编译；平台宿主不执行生成代码。非空HTML、基础可见内容及独立资源交付有静态硬门禁，源码审查通过但没有可用预览时不能升级为成功版本。TASK-023另用指定账号完成4个真实DeepSeek项目及继续修改/交互验收，结果与任务链接见 [真实案例记录](verification/TASK-023-live-cases.md)。

## 原始生产目标核对

| 目标 | 当前事实 | 仍保留的缺口 |
|---|---|---|
| 注册和权限 | 真实账号、数据库会话、个人组织、任务用户隔离 | 没有组织管理/邀请、团队角色 UI、密码重置或多因素认证 |
| 创建并持续修改项目 | PostgreSQL 项目、运行、完整源码版本与产物，可跨刷新/重启继续 | 无显式版本恢复、ZIP/GitHub 导出 |
| 运行恢复 | 数据库排队、独立 Worker、事务/幂等、单项目 active 约束、lease | 无真实 SSE、Temporal、中间步骤恢复、产品取消/审批等待；中断需明确重试 |
| 构建与测试生成的项目 | 可生成 Next.js 源码与独立 HTML，Reviewer 真实源码审查 | 生产隔离执行 Adapter 未接入，install/build/test 与产品浏览器检查仍为模拟 |
| 预览 | 版本绑定的隔离 HTML，可全窗口 | 不是运行中的 Next.js 服务，workspace 模拟 URL 不对外使用 |
| 审批/发布/回滚 | Contracts 仍定义接口，但当前网站未装配发布路径 | 没有真实部署 Provider 或发布闭环 |
| 持久化与用量 | 0001+0002 真实迁移、Postgres ApplicationRepository、保存 modelRecords | 未实现原生产 UsageLedger、全量审计与监控；旧 Memory Repository 仅保留原模块测试，不用于当前网站 |
| 服务器部署 | 同一 API/Worker 镜像、Compose、Postgres 持久卷；香港 CVM 已恢复旧机数据，DNS、Let’s Encrypt 证书、公网 HTTPS、注册/会话和一次真实模型任务已验证 | 密钥轮换、定期备份策略、完整生产浏览器回归与真实生成项目沙箱验收仍未完成 |

当前迁移不继续部署没有被调用的 Redis/Temporal 等服务；确定性测试结果不作为真实执行证据。架构取舍见 [PostgreSQL 与会话 ADR](adr/0006-postgres-accounts-and-task-history.md)。

后续工作由 [TASK-BOARD](TASK-BOARD.md) 按实际需求选择，不自动重跑历史建设批次；历史原始任务状态仍保存在 [归档任务板](archive/bootstrap/TASK-BOARD.md)。
