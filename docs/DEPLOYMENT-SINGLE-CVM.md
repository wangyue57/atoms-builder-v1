# 单 CVM 部署当前应用

当前可执行部署入口为 [统一 Compose](../docker-compose.yml) 和 [部署手册](../deploy/README.md)：PostgreSQL、API 与独立 Worker，API/Worker 共用一个镜像。TASK-040 已将生产栈迁移到中国香港 CVM `43.134.220.179`，TASK-043 已更新至 GitHub `origin/main` 的 `dd50c06`。

## 2026-11-12 香港服务器预检与迁移

腾讯云香港 CVM `43.134.220.179` 为 Ubuntu 24.04.4 LTS，2 vCPU、1.9 GiB 内存、1.9 GiB swap、根盘 40 GiB（可用约 33 GiB）。已安装 Docker 29.1.3、Compose 2.40.3、Git、curl、ca-certificates、jq、unzip、rsync 和 OpenSSL；Docker 服务已启用。SSH 使用原服务器账号登录，凭据未写入仓库或日志；UFW 未启用，应用仅通过 Compose 暴露 80/443，API 与数据库仍绑定 loopback。

从旧机 PostgreSQL 导出 153834 bytes 的 SQL 备份并校验 sha256 后传入新机。新机初始化 PostgreSQL 角色和数据库后恢复备份，users/projects/runs 各 4 条，与旧机一致。旧机数据卷未删除。

## 2026-11-12 应用栈与公网验收

代码归档上传到 `/home/ubuntu/atoms-builder-v1`，构建镜像 `atoms-builder:hk`，启动 PostgreSQL 16、API、Worker 和 Caddy。最新更新重建 API/Worker，PostgreSQL、Caddy、证书和 `.env` 保持不变。`wangyue57.ltd` 的 DNSPod 权威服务器和公共 DNS 已解析到 `43.134.220.179`；Caddy 成功取得 Let’s Encrypt 证书。

验证结果：外部 `https://wangyue57.ltd/` 返回 200，`/healthz` 返回 `{"status":"ok","mode":"deepseek","modelConfigured":true}`；公网注册返回 201，带 Secure Cookie 的 `/api/auth/me` 返回 200；服务器内部执行一次真实 DeepSeek 任务，进入 `succeeded` 并保存版本和预览。HTTP 80 自动跳转 HTTPS。数据库与 API 仍只绑定 loopback，公网仅有 Caddy 80/443。

## 本机与服务器保持一致

本机开发与服务器都使用同一 PostgreSQL Schema、迁移、认证会话、ApplicationRepository 和运行队列。开发可在宿主运行 Vite/Node/Worker，完整部署则运行同一镜像；数据库连接地址、站点 Origin、Secure Cookie 和 TLS 属于环境配置，没有另一个 Memory/SQLite 业务实现。

- PostgreSQL 使用持久卷和独立应用角色，管理员凭据只用于初始化/运维，不进入前端。
- HTTP 仅授权并事务排队，Worker 执行模型和源码审查；PG lease 控制双重执行及中断恢复。
- 用户、会话、Project、Run、完整源码版本、审核与产物均在数据库，应用容器无须保存浏览器任务上下文。
- 当前无需引入未被应用调用的 Redis/Temporal、占位 Studio/Control API 镜像或沙箱管理服务；这些未来能力不得冒充已有实现。

## 公网入口与隔离

服务器设置域名后启用 `https` profile，由 Caddy 代理同一 API/SPA。安全组应只开放 80/443 和受限 SSH；数据库与 API 的宿主映射仅绑定 127.0.0.1，不在安全组开放 54329/8787。

```text
APP_DOMAIN=builder.example.com
APP_ORIGIN=https://builder.example.com
COOKIE_SECURE=true
APP_IMAGE=registry.example.com/atoms-builder:immutable-tag
```

不要把 DSKEY、数据库凭据或会话信息烘焙到镜像。构建上下文排除 `.env`；由服务器环境/密钥管理器注入。TLS 实际证书、站点 Cookie 策略和反代 Origin 在上线现场检查。

## 更新与数据

在 CI 产出镜像并推送不可变标签，服务器使用同一 Compose 拉取该镜像，先备份数据库、执行同一迁移器，再启动 API/Worker。已应用的迁移保持不变，后续只追加；不要用删除卷重建数据来完成应用升级。

备份包含用户凭据哈希、会话摘要、源码和产物，需要受限权限和加密存储；先在独立数据库验证恢复，再替换应用连接配置。命令与注意事项见 [部署手册](../deploy/README.md)。

## 仍未交付的运行能力

当前生成代码只作为隔离 HTML iframe 或数据库源码数据使用。生成项目的真实 install/build/test 必须通过生产隔离执行 Adapter，不能放到 API、Worker 或宿主执行；没有完成该 Adapter 前，不将本栈称为完整 Next.js 沙箱构建平台。Reviewer 的真实浏览器、Temporal 中间步骤恢复、生成项目真实发布/回滚和完整用量审计仍是 [STATUS](STATUS.md) 中的缺口。
