# 账号与任务采用统一 PostgreSQL，运行由独立 Worker 消费数据库队列

TASK-022 决定将产品界面的“任务”映射到既有 Project，每次提交映射到 Run，产物与完整源码保存为不可变 Project Version；账号、会话和上述实体在本机及服务器共用 PostgreSQL 迁移与 Repository。注册建立个人 Organization/Membership，当前只提供个人账号工作区，不由这一入口实现组织协作。

选择 HttpOnly Cookie + 数据库会话，使退出与过期可在服务端撤销；密码使用带随机盐的 scrypt，随机会话令牌只保存摘要。浏览器只缓存服务器状态，不承担持久化或权限判断。Application HTTP v1 为新增契约，原执行领域 v0 保留兼容。

HTTP 进程只校验、授权并将运行排队，独立 Worker 使用 PostgreSQL 行锁/租约处理队列；本轮不引入目前尚未接入的 Redis/Temporal，避免为了本地运行另建业务实现。代价是中断的模型执行不能从中间步骤恢复：过期租约被明确标记失败并允许用户重试，不自动重复可能收费的模型调用。原 Temporal ADR 仍代表未来更复杂工作流的参考，不视为已交付能力。

同一次运行提交版本与审核结果时在事务中绑定持久化版本 ID；相同源码经不同运行审查仍可形成不同的不可变版本，版本不再以内容 hash 独占唯一，运行 ID 的关联唯一。失败保留上次成功产物，运行历史单独记录失败和错误，不能将旧版的成功审核当成本轮通过。

部署使用同一 Compose 的 PostgreSQL、API 和 Worker，API/Worker 共用一个镜像；开发时可在宿主运行同一进程代码并连接该 PostgreSQL。数据库与应用端口只绑定 loopback，HTTPS 由可选 Caddy 入口提供，连接地址和 Cookie Secure 等只通过环境配置变化。实际验证范围记录在 INTEGRATION-STATUS。
