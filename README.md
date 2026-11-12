# Atoms Builder V1

持续维护的 AI Web 构建平台。React + TypeScript + MUI 提供账号密码注册登录、历史任务、需求构建、源码审查、隔离 HTML 预览与继续修改；账号、会话、任务、运行和完整源码版本统一保存在 PostgreSQL。本机和服务器使用同一套迁移、Repository、API 与独立 Worker。

## 本地运行

需要 Node.js 22.12+、npm、Docker/Compose 和已启动的 Docker daemon。

```sh
npm ci
npm run setup    # 生成忽略的 .env、启动 PostgreSQL、创建测试库、执行迁移
# 在此终端导出 DSKEY；产品只调用 DeepSeek，缺少密钥时任务明确失败
npm run dev
```

打开 http://localhost:8787 ，创建自己的账号后使用。历史任务在 `/tasks`，任务详情在 `/tasks/:taskId`；刷新、重新登录和重启应用后可继续之前的作品。开发 API、Vite HMR 共用 8787，Worker 独立处理数据库队列。密码为 8–128 位，账号名为 3–32 位字母、数字或下划线，不区分大小写。

## 与服务器一致的完整部署

```sh
docker compose up -d --build
```

同一 Compose 启动 PostgreSQL、API 和 Worker，API/Worker 共用一个镜像。数据库使用持久卷；数据库与应用端口仅绑定本机 loopback。服务器 HTTPS、备份与升级说明见 [部署手册](deploy/README.md)。本机源码开发也连接上述 PostgreSQL，没有浏览器存储或内存数据库业务分支。

`npm run build && npm start` 可在宿主运行同样的生产 API/Worker；`npm run verify` 执行完整 Web、数据库、接口、浏览器和应用重启验收。测试使用独立的 `TEST_DATABASE_URL`，模型相关测试使用确定性测试适配器；真实模型测试需显式提供 DSKEY。配置与命令见 [本地开发](docs/LOCAL-DEVELOPMENT.md)，前端职责见 [Web 工程](apps/web/README.md)。

真实 Next.js 沙箱构建、产品 Reviewer 浏览器执行和真实发布仍未接入，不能把当前源码审查和隔离 HTML 预览当成完整生产构建验收。当前范围见 [STATUS](docs/STATUS.md)。

## 维护入口

- [项目说明手册](docs/project-manual/README.md)：整体设计、模块实现、开发部署、功能扩展与故障定位
- [文档索引](docs/README.md)
- [当前能力与已知缺口](docs/STATUS.md)
- [代码地图](docs/CODEBASE-MAP.md)
- [当前架构](docs/ARCHITECTURE.md)
- [维护任务板](docs/TASK-BOARD.md)与[协作规则](docs/CONTRIBUTING-AGENTS.md)
- [接口状态](docs/INTERFACES.md)与[验收记录](docs/INTEGRATION-STATUS.md)

Agent 从 [AGENTS](AGENTS.md) 开始。历史零到一规划位于 [归档](docs/archive/bootstrap/)，不作为当前能力证明。
