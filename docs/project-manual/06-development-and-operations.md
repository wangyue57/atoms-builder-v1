# 06 开发、测试与部署

[返回手册](<README.md>) · [下一章：扩展与排障](<07-extension-and-troubleshooting.md>)

## 1. 首次运行和日常开发

需要 Node.js 22.12+、npm、Docker Compose 和已启动的 Docker daemon。下面命令都在仓库根目录执行，脚本定义见 [package.json](<../../package.json>)。

```sh
npm ci
npm run setup
npm run dev
```

浏览器打开 http://localhost:8787 并自行注册账号。`setup` 的实际步骤来自 [database.mjs](<../../scripts/database.mjs>) 和 [environment.mjs](<../../scripts/environment.mjs>)：

1. 缺少本地环境文件时生成随机应用/管理员数据库凭据，权限0600；已有文件不覆盖，也不输出密码。
2. Compose 只启动 PostgreSQL 并等待就绪，数据存入命名卷。
3. 用管理员连接创建独立测试库，校验它与应用库不是同 host/path。
4. 编译后端依赖和应用，执行数据库迁移。

`npm run dev` 先确认数据库启动并编译后端，再由 [application.mjs](<../../scripts/application.mjs>) 同时启动开发 API/Vite 和独立 Worker。开发 [dev.ts](<../../apps/platform-server/src/dev.ts>) 用 Vite middleware 将 API、SPA fallback 和 HMR websocket 共享同一端口；不要另开 Vite 服务器替代当前应用。

修改前端源码通常由 HMR 更新；后端应用源码由 tsx watch 重启。watch 已排除前端和 node_modules，避免 Vite 临时缓存导致循环重启。公共 packages 的导出指向构建产物，修改包源码后要重新 `npm run build:backend`，必要时重启 API/Worker，不能假设热更新会自动编译所有包。

## 2. 三种运行方式

| 模式 | 命令 | API/Worker 在哪运行 | 数据 |
|---|---|---|---|
| 源码开发 | `npm run dev` | 宿主 tsx/Vite 与独立 Worker | 同一 PostgreSQL |
| 宿主生产 | `npm run build`，`npm start` | 宿主编译后的 main/worker | 同一 PostgreSQL |
| 完整容器 | `docker compose up -d --build` | 同一镜像的两个服务 | Compose 持久卷 PostgreSQL |

三者不要同时抢占8787。容器切换源码模式先 `docker compose stop api worker`；切换前确认没有重要的 active Run。`application.mjs` 管理两个子进程，一个退出就停止另一进程；Compose 模式则分别由 restart policy 管理。

单独启动 `main.js` 只有 API，没有构建消费者；服务能打开但任务持续 queued 时先检查 Worker。API/Worker 每次启动都检查迁移。

## 3. 配置项与传播路径

环境文件由 [environment.mjs](<../../scripts/environment.mjs>) 加载，生成规则不包含模型密钥。不要把凭据值复制进文档、截图或版本。以下只列变量名及用途。

| 配置 | 当前用途与默认 |
|---|---|
| `DATABASE_URL` | 宿主 API/Worker 的必需连接串；缺失直接失败，无内存回退 |
| `TEST_DATABASE_URL` | 测试专用数据库，不能指向应用库 |
| `ADMIN_DATABASE_URL` | 测试库初始化可选管理员连接；未配置则用管理员密码构造连接 |
| `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD` | Compose 应用库、应用角色与凭据；生成器默认库/用户 atoms |
| `POSTGRES_ADMIN_PASSWORD` | Compose 初始化管理员 atoms_admin；应用不应使用此身份 |
| `POSTGRES_PORT` | 宿主数据库端口，默认54329，loopback绑定 |
| `HOST` / `PORT` | 宿主 API 监听，默认127.0.0.1:8787；容器内0.0.0.0:8787 |
| `APP_PORT` | Compose 的宿主 API 端口，默认8787 |
| `APP_ORIGIN` | 允许的写请求 Origin；默认本地地址，HTTPS 时设置实际站点 |
| `COOKIE_SECURE` | 字符串 true 时加 Secure 并使用 HTTPS Origin 判断 |
| `DSKEY` | Worker 调用 DeepSeek 的必需密钥；未配置时任务明确失败 |
| `DEEPSEEK_MODEL` | 默认 deepseek-flash |
| `DEEPSEEK_ENDPOINT` | 默认 DeepSeek chat completions 地址 |
| `MODEL_TIMEOUT_MS` | 单模型调用默认120000，允许1000–300000毫秒 |
| `WORKER_LEASE_SECONDS` | 默认60，整数且至少3秒 |
| `WORKER_POLL_MS` | 空队列轮询默认1000，整数且至少50毫秒 |
| `APP_IMAGE` | API/Worker 共用镜像标签，默认 atoms-builder:local |
| `APP_DOMAIN` | 可选 Caddy HTTPS 域名 |
| `PLAYWRIGHT_CHANNEL` | 浏览器测试默认 chrome；CI 为 chromium |
| `LOCAL_WEB_URL` | 可让 E2E 访问已有验收服务；测试会真实注册/创建任务 |

Compose 中 DATABASE_URL 是服务配置按 PostgreSQL 参数生成的内部 `postgres:5432` 地址，不使用宿主的127.0.0.1连接串。Compose 没有显式转发 Worker timing 两变量，若要在容器覆盖，必须同步更新服务环境映射；在终端 export 并不保证容器收到。

模型密钥要在启动进程/执行 Compose 的环境中提供。更新终端环境不会自动改变已运行 Worker，需要重建相应容器或重启进程。`/healthz` 的 mode 固定为 deepseek，modelConfigured 来自 API 环境，若 API/Worker 配置不一致会误导判断；它不测试模型有效性。

更多环境规则见 [LOCAL-DEVELOPMENT](<../LOCAL-DEVELOPMENT.md>)，不要通过输出完整环境或展开的 Compose 配置来共享诊断信息。

## 4. 构建和静态站点

根 `build:backend` 按 domain → contracts → workspace → model-gateway → agent-runtime → persistence → platform-server 顺序构建。Web 单独由 `build:web` 输出 Vite 静态产物；根 `build` 最后做全局 typecheck。

生产 [frontend.ts](<../../apps/platform-server/src/frontend.ts>) 只服务构建好的 Web：

- 无扩展名页面路由回退到 SPA shell，支持直接打开任务详情。
- `/api` 和缺失 assets 不返回 HTML，保持404。
- Web 未构建返回503；hashed assets 长期 immutable，shell no-cache。
- 路径与 realpath 双重限制在输出目录内，拒绝隐藏路径、反斜杠、空字节和越界 symlink。

若页面显示旧逻辑，先判断是源码 HMR 还是镜像/宿主生产模式。生产模式需重新 build 和部署相同产物，浏览器刷新无法编译源码。

## 5. 验证命令如何选

```sh
npm run verify
```

完整 verify 依次准备数据库和测试库、完整构建、Web类型/lint/格式、前端单测、契约、模型网关、真实PG API、部署静态检查、真实浏览器和应用重启恢复。依赖和具体顺序以 [根脚本](<../../package.json>) 为准，不把测试数量写成长期承诺。

| 修改范围 | 常用命令 / 证据入口 |
|---|---|
| Web 页面和状态 | `npm run check:web`、`npm run test:web`、按需 `npm run test:e2e` |
| 当前 API/数据库/Worker | `npm run build:backend`、`npm run test:local`、按需 `npm run test:restart` |
| 公共输入输出 | `npm run test:contract`，并检查双方调用和PG测试 |
| Provider/结构化输出 | `npm run test:model`，必要时 Agent runtime 测试 |
| Workspace/Agent/跨包链路 | 对应包 `npm test --prefix packages/...`，需要跨包验证时运行 `npm run build` 和对应集成命令 |
| 部署配置 | `npm run test:deploy-config`，另做部署现场健康/用户路径验收 |
| 当前活动包 | `npm run test:all`，含契约、Workspace、Agent、Model Gateway、evals 和部署配置 |
| 仅文档 | 源码事实、相对链接、引用与 `git diff --check`；无需重跑产品测试 |

`npm test` 默认只跑 contract，并非全套。`test:all` 也不代替当前网站的 verify；例如 domain 自身状态机单测需按改动显式运行。verify 通过不证明真实生成项目构建、产品 Reviewer 浏览器或线上发布完成。

[测试包装器](<../../scripts/test-database.mjs>) 把 DATABASE_URL 替换为 TEST_DATABASE_URL；需要模型的浏览器和重启测试由调用方显式提供 DSKEY，不会注入模型服务。不要直接运行会写库的底层测试命令连接应用库；不要仅看0退出而忽略 skip。该包装器比较连接串是否相同，独立测试库初始化还会比 host/path；配置时仍应人工确保不是同一个实际数据库。

[E2E 配置](<../../playwright.config.ts>) 默认起8790 API/Worker，用一个测试 Worker串行访问真实账号/数据库流程；trace/截图在失败时保留。使用已有 LOCAL_WEB_URL 时不会启动隔离服务，应只指定验收环境。真实链路代码在 [workspace.spec.ts](<../../tests/e2e/workspace.spec.ts>)，优先使用 `npm run test:e2e`。仅界面回归可运行 `npm run test:e2e -- tests/e2e/interaction.spec.ts`；[interaction.spec.ts](../../tests/e2e/interaction.spec.ts) 在 Chrome 中完整拦截 API，不调用模型或写入任务数据，不能代替真实后端链路验收。

[重启检查](<../../tests/application-restart.mjs>) 使用8792，验证 Cookie、历史、完整源码与继续修改；`npm run test:restart -- --restart-database` 还会重启 PostgreSQL，应确保没有他人的进行中运行。

[CI](<../../.github/workflows/web.yml>) 在 PR 和 main/master push 执行 npm ci、安装 Chromium、setup、verify，失败上传浏览器证据。配置存在不等于当前分支已在远端跑过；实际结果看流水线。

## 6. 容器部署与更新

[Dockerfile](<../../Dockerfile>) 用 Node22 多阶段构建，运行层使用 node 用户，复制后端、Web产物、运行时 Prompt 和迁移；API/Worker 共用镜像。[Compose](<../../docker-compose.yml>) 含 PostgreSQL、API、Worker，可选 Caddy。数据库和 API 宿主端口只绑 loopback，只有 HTTPS profile 的80/443对外。

本地首次完整栈：

```sh
npm ci
npm run setup
docker compose up -d --build
```

服务器使用不可变 APP_IMAGE；先设置环境和准备镜像，再运行：

```sh
docker compose pull api
docker compose up -d --wait postgres
docker compose run --rm --no-deps api node apps/platform-server/dist/migrate.js
docker compose --profile https up -d --no-build
```

Worker 的 `pull_policy: never` 依赖 API 已拉取/构建同一镜像。仅更新一个角色会产生版本不一致；迁移也要同时兼容两个进程。应用升级前检查 active Run，停止期间 queued 会保留，running 超过租约后按失败处理，不提供步骤级续跑。

HTTPS 要同时设置 APP_DOMAIN、APP_ORIGIN=https://实际域名、COOKIE_SECURE=true，并检查 DNS、安全组和证书。不要开放数据库或挂载 Docker socket 到公共/生成项目。没有使用到的 Redis/Temporal 不应为遵循历史规划而启动。

当前生产入口 `wangyue57.ltd` 运行在中国香港 CVM `43.134.220.179`。2026-11-12 的迁移已恢复旧机 PostgreSQL 数据，并通过 Caddy 自动签发 Let’s Encrypt 证书；公网 443、API 健康检查、注册/会话和一次真实 DeepSeek 任务均已验证。旧机数据卷仍保留，后续升级前继续按备份、迁移、启动顺序操作。

具体部署操作见 [deploy README](<../../deploy/README.md>) 与 [单CVM方案](<../DEPLOYMENT-SINGLE-CVM.md>)。已有任务板可能记录单项服务器操作，但不能据此推导域名、证书、发布、备份恢复等全部验收通过；服务器部署和各项能力的验收范围以 [验收记录](<../INTEGRATION-STATUS.md>) 及对应部署任务为准。

## 7. 备份、恢复与日志

账号、会话、完整源码和 HTML 都在 PostgreSQL，正常更新保留卷。`npm run db:down` 实际只 stop postgres，不删除数据。不要通过 `docker compose down -v` 处理启动错误。

受限权限目录下备份应用数据库（此操作由实际部署维护者执行）：

```sh
docker compose exec -T postgres sh -c 'exec pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > atoms-backup.sql
```

备份含密码哈希和会话摘要，不能提交仓库。先在独立数据库恢复演练，再用同一应用镜像连接验证；应用镜像回退不能自动撤销已经应用的数据库迁移。

常用只读诊断：

```sh
docker compose ps
docker compose logs --since 10m api worker
curl -fsS http://localhost:8787/healthz
```

日志中 `model.call` 带 runId 和模型调用元数据，`application.run.failed` 带受控 code/attempts。API 的未分类异常被统一隐藏，Worker 外层启动失败也只有受控提示，暂无完整结构化日志/指标平台；必要诊断应在受控环境增加经过脱敏的分类，不将整段异常或源码返回用户。

已记录的依赖审计、浏览器环境和真实执行限制见 [验收记录](<../INTEGRATION-STATUS.md>)；部署与备份恢复结果应单独记录。
