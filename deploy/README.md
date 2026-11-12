# 同一 Compose 的本机与服务器部署

当前可运行栈为 PostgreSQL、API、独立 Worker，以及可选 HTTPS Caddy。API 和 Worker 使用同一个镜像，分别启动 `main.js` 和 `worker.js`；迁移、数据库 Schema、认证与任务业务实现完全相同。本机源码开发只是把 API/Worker 进程运行在宿主，仍连接该 PostgreSQL。

## 本机完整运行

```sh
npm ci
npm run setup
docker compose up -d --build
```

打开 http://localhost:8787 并注册账号。`setup` 生成随机凭据到忽略的 `.env`，创建独立测试库并运行迁移。数据库卷 `postgres_data` 保存账号、会话、项目/运行、完整源码版本、审核和 HTML。停止容器不会删卷；不要运行 `docker compose down -v` 来更新应用。

需要真实模型时，在执行 compose 的同一个终端导出 `DSKEY`；也可由服务器密钥管理器提供。未配置时只替换模型 Provider，所有数据仍写 PostgreSQL。`.env`、本地凭据和 node_modules 不进入镜像构建上下文。

本机源码 HMR：先停止容器 API/Worker 以释放 8787，再运行同一代码的开发模式：

```sh
docker compose stop api worker
npm run dev
```

两种进程运行方式不可同时抢占 8787；切换不丢数据。

## 服务器

建议在 CI 构建并标记不可变 `APP_IMAGE`，上传镜像仓库；服务器使用同一 Compose 拉取该标签。首次部署准备只在服务器保存的 `.env`，设置随机数据库管理员与应用凭据、DATABASE_URL、APP_DOMAIN、APP_ORIGIN 和 COOKIE_SECURE。专用应用数据库角色不应使用管理员密码。

```sh
# 在服务器设置好 APP_IMAGE=registry/...:immutable-tag 后
# 先准备数据库，镜像中同一迁移器会检查版本与 checksum
docker compose pull api
docker compose up -d --wait postgres
docker compose run --rm --no-deps api node apps/platform-server/dist/migrate.js
docker compose --profile https up -d --no-build
```

Worker 设置 `pull_policy: never`，共用 API 已构建/拉取的镜像，避免两个服务同时导出同一个标签。API/Worker 启动也会在 advisory lock 保护下检查迁移，重复启动不重复执行 SQL。已应用迁移不得修改，只追加下一个文件。

服务器 HTTPS：

```text
APP_DOMAIN=builder.example.com
APP_ORIGIN=https://builder.example.com
COOKIE_SECURE=true
```

Caddy 将同一站点代理到 API（同时托管 React SPA）；数据库与 API 的宿主端口始终只绑定 `127.0.0.1`，只有可选 Caddy 的 80/443 对外。安全组不开放数据库端口。当前不部署未被应用使用的 Redis/Temporal/沙箱占位服务，不挂载 Docker socket。

`sh scripts/deploy/migrate.sh` 使用当前镜像迁移；`APP_ORIGIN=https://... sh scripts/deploy/healthcheck.sh` 只检查数据库连接健康和 SPA 可访问，不代替账号/任务/模型/真实执行验收。

## 备份与恢复

更新应用前备份 PostgreSQL，备份包含密码哈希与会话摘要，应限制权限并加密存储：

```sh
# 路径由运维选择，不要把 dump 提交仓库
docker compose exec -T postgres sh -c 'exec pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > atoms-backup.sql
```

恢复应先在独立数据库演练，再将该库的 DATABASE_URL 配给同一个应用镜像；不要把旧备份直接覆盖正在被用户使用的数据库。正常应用升级保留命名卷，不默认删除、重建或清空应用数据。

## 验证范围

本机应执行 `npm run verify`：独立真实测试库、账号与权限、队列/幂等/租约、完整源码、浏览器刷新与继续修改、应用重启恢复。需要测试 PostgreSQL 容器重启时，确认无其他运行后执行 `npm run test:restart -- --restart-database`。

本机镜像、数据库和完整栈验证结果记录在 [INTEGRATION-STATUS](../docs/INTEGRATION-STATUS.md)。远端 CVM、镜像仓库、DNS/证书及备份恢复演练需要部署现场验收；真实生成项目的沙箱构建、产品浏览器审核和发布仍是单独缺口。
