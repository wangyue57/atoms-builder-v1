# 本地开发与持久化运行

本机与服务器共用 PostgreSQL、迁移、Repository、账号会话、任务接口和 Worker。区别仅在进程运行位置、数据库地址及 HTTPS/Cookie 环境配置；浏览器缓存不是数据源。

源码编辑器为本地打包的 CodeMirror 6，随根目录 `npm ci` 按 `package-lock.json` 安装，首次代码页签才请求编辑器资源；无需额外 CDN、Worker 服务或运行配置。

## 首次启动

需要 Node.js 22.12+、npm、Docker/Compose，先启动 Docker daemon：

```sh
npm ci
npm run setup
npm run dev
```

`setup` 在缺少 `.env` 时生成随机数据库应用/管理员凭据（文件权限 0600，已忽略，不输出凭据），启动 `postgres:16-alpine` 的持久卷、创建独立 `atoms_test` 测试库、编译并执行带 checksum/advisory lock 的迁移。已有 `.env` 不会被覆盖。不要删除数据库卷来解决代码问题。

默认 http://localhost:8787 ，PostgreSQL 仅绑定 `127.0.0.1:54329`。`npm run dev` 确保数据库启动并编译本地包，然后并行启动 Node/Vite API 和独立 Worker。前端 HMR 共用 8787，后端 watch 排除 Vite 缓存；包源码修改仍需重新编译。完整容器模式见 [部署手册](../deploy/README.md)。

```sh
npm run db:up          # 只启动/确认 PostgreSQL
npm run db:migrate     # 对 DATABASE_URL 执行同一迁移器
npm run build
npm start              # 宿主生产 API + Worker，同一数据库逻辑
```

前端源码见 [Web 工程](../apps/web/README.md)，生产输出 `apps/web/dist`。缺构建返回 503；深路由返回 SPA shell，API 与缺失静态资源保持 404。Web 与 platform-server 使用根 npm workspace/锁文件。

## 账号与任务

- `/register` 创建个人账号与工作区并登录；`/login` 仅账号密码登录，账号名 3–32 位字母/数字/下划线，不区分大小写，密码 8–128 位。
- 密码采用随机盐 scrypt；数据库会话只存随机令牌摘要，浏览器使用 HttpOnly/SameSite=Lax Cookie。登出撤销服务端会话。
- `/` 描述需求创建任务，`/tasks` 分页查看历史，`/tasks/:taskId` 刷新直接从数据库恢复；每次构建/修改都是独立运行，完整源码、审核、产物与版本关联保存。
- API 在数据库排队成功后返回，独立 Worker 执行；关闭/刷新页面不取消后台任务。服务器异常中断后，queued 任务仍会被取走，过期 running lease 明确失败并允许重试，不自动重复付费调用。
- 修改由服务端读取上一成功源码快照，浏览器不发送 previousHtml；审核或执行失败保留上次成功作品，并在本轮运行历史记录错误。
- 同一任务最多一个 queued/running；服务端幂等与事务控制并发，跨用户资源查询/修改返回 404。
- 预览仍为带 sandbox/CSP 的 HTML iframe，不在宿主执行生成代码；全窗口支持 Esc/按钮和焦点管理。

## DeepSeek

密钥仅由后端环境读取，不写入页面、版本、日志或仓库：

```sh
source ~/.zshrc
export DSKEY
npm run dev
# 或使用同一 Compose 部署容器
# docker compose up -d
```

产品只调用 DeepSeek。无 `DSKEY` 时 Worker 将运行标记失败并提示 MISSING_API_KEY；密钥无效、余额不足、限流等显示对应 HTTP 原因，不会生成演示作品。应用模型调用默认超时120秒（`MODEL_TIMEOUT_MS`，范围1000–300000毫秒），传输或结构化输出错误最多追加一次调用；格式错误带反馈纠正，失败返回受控原因码，后台不记录异常原文。预览缺失/外部依赖等静态交付问题进入最多三轮修复，不能把空HTML保存为成功版本。默认 `deepseek-flash`，可用 `DEEPSEEK_MODEL` / `DEEPSEEK_ENDPOINT` 覆盖。价格估算沿用 input $0.30/百万、output $1.20/百万，账单以 Provider 为准。

## 验证与测试数据库

```sh
npm run verify
```

该命令确认数据库、准备独立测试库，执行完整构建、Web 严格 TS/ESLint/Prettier、前端单测、契约、持久化/API/部署静态测试、真实浏览器和应用重启恢复检查。`scripts/test-database.mjs` 将测试进程的 DATABASE_URL 指向 TEST_DATABASE_URL 并始终使用 TEST_DATABASE_URL。需要模型的浏览器和重启测试必须由调用方显式提供 DSKEY；没有密钥时不会伪造成功。

Playwright 默认使用本机 Chrome，CI 使用安装后的 Chromium（`PLAYWRIGHT_CHANNEL=chromium`），自动管理独立 8790 API/Worker，失败保留 trace/截图。`LOCAL_WEB_URL` 可改为已有服务，但此时测试会真实注册账号/创建任务，应只指定验收环境。测试使用真实账号与数据库流程；模型调用是否执行取决于 DSKEY。

`npm run test:restart` 验证应用重启后 Cookie 会话、历史、源码和继续修改仍可用；手动加 `-- --restart-database` 还会重启本机 PostgreSQL，执行前应确认没有其他人的进行中运行。`npm run test:all` 只运行当前活动包、契约、评估和部署配置测试。

当前尚未接入真实沙箱 Next.js 构建、产品 Reviewer 浏览器执行、线上发布和 Temporal；不能把本轮数据库能力与源码审查验收当作这些目标已完成。详见 [STATUS](STATUS.md)。

仅验证界面交互可运行 `npm run test:e2e -- tests/e2e/interaction.spec.ts`。该套件在真实 Chrome 中拦截所有 Application API，不调用模型、不写任务数据库；默认测试服务仍按 Playwright 配置启动，不能把此结果作为真实任务执行验收。
