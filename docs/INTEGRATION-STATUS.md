# 集成状态

本文记录当前代码的可复核验证入口和边界。确定性测试适配器只证明模块行为；真实模型、真实隔离执行和生产发布分别需要对应环境证据。

## TASK-043 香港 CVM 更新至 `dd50c06`（2026-11-12，已完成）

GitHub `origin/main` 的 `dd50c06 feat: 支持产物源码编辑` 已归档上传到香港 CVM `/home/ubuntu/atoms-builder-v1`，构建新 `atoms-builder:hk` 镜像并重建 API/Worker。PostgreSQL、Caddy、域名证书和服务器 `.env` 保持不变；本 commit 没有数据库迁移文件或公共 Interface 变化。

| 命令 / 检查 | 结果与范围 |
|---|---|
| `git fetch origin main`、`git log origin/main` | 最新 commit 为 `dd50c06` |
| `docker compose build --pull api` | Docker npm ci（402 packages）及后端/Web TypeScript/Vite 生产编译通过 |
| `docker compose up -d --wait api worker` | API、Worker 重建并 healthy；PostgreSQL、Caddy 未重建 |
| 外部 `curl -I https://wangyue57.ltd/`、深路由 `/tasks/latest` | 分别返回 200、200 |
| 外部 `/healthz`、`dig +short A wangyue57.ltd @8.8.8.8` | `status=ok`、`mode=deepseek`、`modelConfigured=true`；A=`43.134.220.179` |
| 新机 `select count(*) from application_migrations` | 2；未发生数据库迁移 |

本轮完成生产更新，未重跑完整付费模型建站或生产浏览器回归；CodeMirror/源码编辑器的本地测试与浏览器证据见 TASK-042。

## TASK-042 CodeMirror 6 源码编辑器（2026-11-12）

源码编辑使用本地打包的 CodeMirror 6，HTML 语言扩展同时处理内嵌 CSS/JavaScript；接入行号、高亮、折叠、补全、Tab/Shift+Tab 两空格缩进、搜索替换与撤销重做，工具栏提供鼠标入口。首次代码页签才加载编辑器 chunk，之后保留实例、选区与编辑历史；外部恢复源码或载入新版本会重置历史，避免撤销跨越版本。代码仍作为文本编辑，自动预览使用原有隔离 iframe/CSP，未放宽执行权限。

| 命令 / 检查 | 结果与范围 |
|---|---|
| `npm run check:web`、`npm run build:web`、`npm run typecheck` | 严格类型、ESLint、Prettier、生产构建及根类型通过 |
| `npm run test:web` | 4 文件、16/16 通过 |
| `npm run test:local` | 18/18 通过，独立真实 PostgreSQL 测试库 |
| `npm run test:e2e -- tests/e2e/interaction.spec.ts` | 真实 Chrome HTTP fixture 11/11 通过；完全拦截 API，无付费模型调用或业务库写入 |
| `COMPOSE_PROJECT_NAME=atoms-builder-v1 docker compose build api` | 完整镜像构建成功，Node 22/npm 10 环境中 npm ci 和后端/Web 编译通过 |
| `COMPOSE_PROJECT_NAME=atoms-builder-v1 docker compose up -d --no-deps --wait api` | 本机 Web/API 已更新并 healthy；运行配置仅在进程环境中保留，Worker 与 PostgreSQL 未重启 |
| `LOCAL_WEB_URL=http://127.0.0.1:8787 npm run test:e2e -- tests/e2e/interaction.spec.ts` | 更新服务后真实 Chrome 复验 11/11 通过 |
| 8787 页面、healthz、构建资源及编辑器懒加载 chunk | 全部 200，URL/hash 与最新本地构建一致，healthz status=ok / mode=deepseek / modelConfigured=true |

新增浏览器用例真实操作 CodeMirror：打开代码页签前无实例/编辑器资源请求，首次打开只加载一次；高亮和可见行号、折叠展开、补全选择、快捷键撤销/工具栏重做、Tab 缩进、Esc→Tab 移焦、中文查找全部替换、切换预览后继续撤销均通过。既有用例继续验证自动预览、空草稿恢复、新服务端版本草稿保护、聊天滚动、全屏和 sandbox；320/390px 源码编辑及桌面搜索截图已检查。

依赖使用公共 npm registry，Web 声明与根锁文件同步，Docker 的 npm ci 成功；CodeMirror 编辑器 chunk 约 570 kB、gzip 196 kB，构建有通用大 chunk 提示，但仅首次代码页签请求，无 CDN 运行依赖。

改动文件：`apps/web/package.json`、`package-lock.json`、`apps/web/src/components/{SourceEditor,PreviewPanel}.tsx`、`apps/web/src/components/preview-panel.css`、`tests/e2e/interaction.spec.ts`。同步文档：`apps/web/README.md`、`docs/{STATUS,CODEBASE-MAP,ARCHITECTURE,LOCAL-DEVELOPMENT,TASK-BOARD,INTEGRATION-STATUS}.md`、`docs/project-manual/02-web.md`。

无数据库迁移或公共 Interface/Contracts 变化。源码仍仅本页 HTML 草稿，离开/刷新丢失，不进入数据库或后续模型上下文；未接入完整 Next.js 项目编辑/编译、真实生成项目沙箱或发布。未运行付费模型、完整 verify、重启持久化或远端部署验收。

## TASK-041 预览源码编辑与多轮聊天（2026-11-12）

右侧提供「预览 / 代码」页签，编辑实际 `public/preview.html`，内联 HTML/CSS/JavaScript 经 250ms 防抖自动进入同一隔离 iframe；服务端保存版本切换不使用旧 HTML。草稿保留基准版本，后台新版本到达时不覆盖编辑，确认载入才替换；恢复源码、空草稿、未产出禁用代码页签均有对应交互。左侧按时间呈现每轮需求与真实结果，底部固定输入，阅读历史时状态刷新不抢滚动位置；审查关联所属 Run。

| 命令 / 检查 | 结果与范围 |
|---|---|
| `npm run check:web`、`npm run build:web`、`npm run typecheck` | TypeScript、ESLint、Prettier、生产构建与根类型检查通过 |
| `npm run test:web` | 4 文件，16/16 通过 |
| `npm run test:local` | 18/18 通过，真实独立 PostgreSQL 测试库 |
| `npm run test:e2e -- tests/e2e/interaction.spec.ts` | 真实 Chrome HTTP fixture 10/10 通过；完全拦截 API，无模型调用或业务数据写入 |
| `COMPOSE_PROJECT_NAME=atoms-builder-v1 docker compose build api` | 完整镜像构建通过，包含最新 Web 与后端编译 |
| `COMPOSE_PROJECT_NAME=atoms-builder-v1 docker compose up -d --no-deps --wait api` | 本机 Web/API 已更新并 healthy；现有 API 模型/入口配置仅在进程环境中保留，未打印或写入文档；Worker 与 PostgreSQL 未重启 |
| `LOCAL_WEB_URL=http://127.0.0.1:8787 npm run test:e2e -- tests/e2e/interaction.spec.ts` | 更新服务后真实 Chrome 再验 10/10 通过，包含最终版本切换实现 |
| `http://127.0.0.1:8787/`、`/healthz`、构建资源检查 | 页面/healthz 200，status=ok、mode=deepseek、modelConfigured=true；5 个资源 URL 与本地最新构建一致且均 200 |

Chrome 验证覆盖代码修改后的 HTML 文本/CSS、隐藏预览的自动更新、切换页签保留交互、恢复/取消恢复、清空代码、新版本草稿保护、对话顺序/初始定位/阅读位置，以及原有输入键盘/失败重试/全屏/Esc/重载/sandbox 和账号交互。桌面及 320/390px 截图位于 `test-results/interaction-*`，已人工检查源码编辑、聊天和手机布局。初次新增测试使用可访问性 role 查询隐藏 iframe 标题，因隐藏节点被排除而失败；改为检查隐藏文档的实际 h1，并保留可见状态断言后通过，未放宽产品行为要求。

改动文件：`apps/web/src/pages/TaskPage.tsx`、`components/{ConversationPanel,PreviewPanel,SourceEditor}.tsx`、`components/preview-panel.css`、`styles/global.css`、`tests/e2e/interaction.spec.ts`。文档更新：`apps/web/README.md`、`docs/{STATUS,CODEBASE-MAP,ARCHITECTURE,TASK-BOARD,INTEGRATION-STATUS}.md`、`docs/project-manual/02-web.md`。

无数据库迁移或公共 Interface/Contracts 变化。编辑只在本页 React state 有效，刷新或离开后丢失，不保存到数据库，也不带入后续模型上下文；代码页签不提供完整 Next.js 项目文件树或编译。未执行付费模型建站、完整 verify、重启持久化测试或远端部署；生产隔离执行、产品 Reviewer 浏览器、真实发布与旧浏览器无 moveBefore 的全屏保态缺口保持。

## TASK-040 香港 CVM 迁移与公网验收（2026-11-12，已完成）

生产栈已从中国内地 CVM `106.54.250.219` 迁移到中国香港 CVM `43.134.220.179`。代码通过 Git 归档上传，构建 `atoms-builder:hk`；PostgreSQL、API、Worker 和 Caddy 均由统一 Compose 管理。旧机数据库导出后以 sha256 `5df946135b4dcf4f26d2a6d4109946a6c83010ce3992af27265a3c14772cf2bb` 校验，备份大小 153834 bytes；恢复后 users/projects/runs 各 4 条，未删除旧机数据卷。

| 命令 / 检查 | 结果与范围 |
|---|---|
| 香港服务器预检与基础依赖安装 | Ubuntu 24.04.4 LTS，2 vCPU、1.9 GiB RAM、40 GiB 根盘；Docker 29.1.3、Compose 2.40.3；数据库/API loopback 绑定 |
| `docker compose build --pull api`、`docker compose --profile https up -d --wait` | 镜像构建通过；PostgreSQL、API、Worker、Caddy running/healthy |
| `dig +short A wangyue57.ltd`、DNSPod 权威 NS、8.8.8.8/1.1.1.1 | 均返回 `43.134.220.179` |
| 外部 `curl -I https://wangyue57.ltd/`、`curl https://wangyue57.ltd/healthz` | HTTPS 200；Let’s Encrypt 证书有效；healthz 为 `status=ok`、`mode=deepseek`、`modelConfigured=true` |
| 外部注册 → Secure Cookie `/api/auth/me` | 注册 201，会话恢复 200 |
| 服务器内部真实 DeepSeek 任务 | 注册、创建任务 202，任务进入 `succeeded`，run 数 1，版本存在并保存预览 |

本轮无数据库 Schema 迁移、无公共 Interface/Contracts 变化；未开放数据库/API 宿主端口，未把生成代码放到宿主执行。真实生成项目 install/build/test、Reviewer 浏览器和发布闭环仍未接入。

## TASK-039 腾讯云 HTTPS 文档核对（2026-11-12）

用户提供的官方文档 `https://cloud.tencent.com/document/product/1207/47027` 为 WordPress/Nginx 手动证书安装教程。当前 Compose 使用 Caddy 2.9、开放 80/443 并持久化证书数据，Caddyfile 为域名反代配置；TASK-037 已记录证书申请和服务器内部 HTTPS 成功。本轮未重新安装 Nginx 或替换证书。

公网 `curl -Iv https://wangyue57.ltd` 仍在 TLS ClientHello 后被重置（exit 35）；HTTP 复测仍为腾讯云备案页 302，DescribeDomainIcpStatus 的 GovStatus/LandedStatus/AuditTicket/Ban 均 false（查询脚本 exit 0）。通过密码 SSH 已核实服务器本机 Caddy、Let’s Encrypt 证书和 HTTPS 页面均正常，因此不是证书配置错误。根因是中国内地 CVM 对未完成 ICP 备案/接入备案的域名执行云侧阻断；后续依赖完成备案，或迁移到中国香港/境外服务器。仅文档修改，无数据库迁移或公共 Interface 变化，未运行产品测试。

## TASK-038 公网域名访问异常诊断（2026-11-12）

当前公网复测发现腾讯云备案入口拦截，TASK-037 部署时的 HTTPS 成功记录不能代表当前持续可访问。

| 命令 / 检查 | 结果与范围 |
|---|---|
| `dig wangyue57.ltd A +noall +answer` | 解析为目标 CVM `106.54.250.219` |
| `curl -sS -D - http://wangyue57.ltd/` | HTTP 302，Location 为 `https://dnspod.qcloud.com/static/webblock.html?d=wangyue57.ltd` |
| `curl -Iv https://wangyue57.ltd` | TCP 443 可连，TLS ClientHello 后 Connection reset by peer，curl 退出码 35 |
| `curl -sS -D - http://106.54.250.219/` | Caddy 返回 308 HTTPS 跳转，只证明服务器 HTTP 入口有响应 |
| 拦截页使用的 `DescribeDomainIcpStatus` 只读查询 | GovStatus=false、LandedStatus=false、AuditTicket=false、Ban=false；页面配置对应“您的网站未完成备案；使用腾讯云中国境内云资源，需在腾讯云完成备案后，方可访问” |

结论：当前域名请求在云侧备案入口被拦截。未观察用户普通浏览器的网络请求，不能确认其仍可访问是缓存、连接复用、代理或协议差异中的哪一种。未修改服务器、DNS、安全组或产品代码，未触发模型调用，未重复产品测试；后续需完成备案或另行决定部署区域迁移。无数据库迁移或公共 Interface 变化。

## TASK-037 单机 Compose 部署（2026-11-12，已完成）

GitHub `main` 提交 `6d01ef4` 已构建并在目标 CVM 启动 PostgreSQL、API、Worker 和 Caddy。公网 HTTPS、账号链路和一次真实 DeepSeek 任务均已通过。

| 命令 / 检查 | 结果与范围 |
|---|---|
| `docker compose --profile https up -d --build --wait` | 通过；PostgreSQL、API、Worker、Caddy 均 healthy；数据库与 API 宿主映射保持 loopback |
| 服务器 `curl http://127.0.0.1:8787/healthz` | 200，`mode=deepseek`、`modelConfigured=true` |
| 服务器内部 `curl --resolve wangyue57.ltd:443:127.0.0.1 https://wangyue57.ltd/` | 200；Caddy 申请 Let’s Encrypt 证书成功，SPA HTML 可读取 |
| 服务器内部注册 → `/api/auth/me` → `/api/tasks` → 登出 | 201/200/200/204；测试账号已登出，未触发模型调用 |
| 外部 `http://wangyue57.ltd` | 80 可达，返回 308 HTTPS 跳转 |
| 外部 `https://wangyue57.ltd` | 200；Let’s Encrypt 证书和 Caddy 代理正常 |

| 外部真实任务 | 创建任务 `605cd339-3cd8-4e4c-a5da-6c51bab91872` 后进入 `succeeded`；版本和预览 HTML 均存在 |

本轮提交修复了公开部署所需的 package-lock registry 地址（`a2b03a3`）和 Caddy 2.9 自动 HTTPS 配置（`6d01ef4`）。无数据库迁移或公共 Interface 变化；尚未执行完整浏览器公网回归和真实生成项目沙箱验收。一次部署交互曾在终端回显模型密钥，用户决定继续使用原密钥，建议后续轮换。

## TASK-036 域名解析与入口连通性预检（2026-11-12）

`wangyue57.ltd` 已完成 DNS 绑定检查，但应用入口尚未上线。

| 命令 / 检查 | 结果与范围 |
|---|---|
| `dig +short A wangyue57.ltd`；公共 resolver `8.8.8.8`、`223.5.5.5` | 均解析为 `106.54.250.219`；权威 DNSPod NS 为 `octahedron.dnspod.net`、`genevieve.dnspod.net` |
| 关闭本机代理后直连 `http://wangyue57.ltd` | 80 端口 `Connection refused` |
| 关闭本机代理后直连 `https://wangyue57.ltd` | 443 端口连接超时 |
| 服务器端 `ss -lntup` | 仅 SSH 22 监听；没有 API 8787、HTTP 80 或 HTTPS 443 |

结论：DNS 已通，Web/HTTPS 尚未部署；本次没有修改 DNS、服务器防火墙或应用服务。

## TASK-035 腾讯云单机部署前置预检（2026-11-12）

已通过 SSH 对目标 CVM 完成只读环境盘点、基础依赖安装和 Docker smoke。该结果只证明服务器具备开始部署的基础条件，不代表应用、数据库、域名、HTTPS、模型密钥或生产任务链路已上线。

| 命令 / 检查 | 结果与范围 |
|---|---|
| 远端系统、资源、权限与监听端口盘点 | Ubuntu 24.04.4 LTS；4 vCPU、3.6 GiB RAM、1.9 GiB swap、根盘 59 GiB/余 51 GiB；`ubuntu` 可免密 sudo 且在 `docker` 组；公网监听仅 SSH，UFW 未启用 |
| `apt-get update`；安装 `ca-certificates curl git jq unzip build-essential` | 通过；已有项保持最新，构建工具安装完成 |
| NodeSource Node.js 22 安装与版本检查 | Node.js 22.23.5、npm 10.9.9 |
| `docker info`、`docker compose version` | Docker 29.1.3、Compose 2.40.3、cgroup v2，daemon active |
| `docker run --rm hello-world` | 通过；临时容器和日志已清理 |

未执行应用源码上传、镜像构建、数据库初始化、Compose 启动、DSKEY 配置、DNS/HTTPS 或公网安全组变更。

## TASK-034 界面与交互验收（2026-11-12）

首页参考 [DeepSeek 首页](https://www.deepseek.com/) 的蓝白、留白和聚焦输入设计，统一账号、历史列表与任务工作台。任务详情桌面双栏、移动页签；Enter/换行/IME 保护共享实现，草稿提交成功清空、失败保留，处理中可起草下一条需求。进度只展示实际服务端阶段和提交经过时间，旧作品与当前运行明确区分。

| 命令 / 检查 | 结果与范围 |
|---|---|
| `npm run check:web`、`npm run build:web`、`npm run typecheck` | 类型、lint、格式与前端生产构建通过 |
| `npm run test:web` | 4 文件，16/16 通过 |
| `npm run test:local` | 18/18 通过，真实独立 PostgreSQL 测试库 |
| `npm run test:e2e -- tests/e2e/interaction.spec.ts` | 真实 Chrome，7/7 通过；部署后以 `LOCAL_WEB_URL=http://127.0.0.1:8787` 再验 7/7；完全拦截 API 的 HTTP fixture，无模型调用或业务数据写入 |
| `npm run test:e2e -- tests/e2e/workspace.spec.ts --grep 'protected deep links'` | 1/1 通过，真实测试库账号注册、受保护路由与移动错误页面；不创建模型任务 |
| `COMPOSE_PROJECT_NAME=atoms-builder-v1 docker compose build api` | 完整镜像构建通过，包含后端包与新版 Web |
| `COMPOSE_PROJECT_NAME=atoms-builder-v1 docker compose up -d --no-deps --wait api` | 本机 API 更新并健康，既有 Worker 和数据库持续运行；8787 healthz 返回 ok / modelConfigured=true |
| `git diff --check`、活动文档相对链接与删除符号搜索 | 通过；9 份修改文档、133 个相对链接无断链 |

浏览器回归覆盖首页与修改输入的 Enter、Shift+Enter、composition/isComposing/229、长按、空白和同步提交锁；网络失败重试复用幂等键；处理中可写草稿、完成解锁；queued/running/succeeded/failed；旧预览保留、sandbox 父 DOM 隔离、全屏/Esc/焦点与独立重载；密码显隐和头像菜单登出。桌面 1280×900、手机 320/390×844 共 17 张截图位于 `test-results/interaction-*`，已人工检查导航、标题断行、进度、输入区域、预览和登录页。生成预览内容为明确的 UI fixture，不能当作真实模型作品或产品 Reviewer 浏览器验收。

改动文件：`apps/web/src/app/App.tsx`、`app/routes.tsx`、`app/theme.ts`、`pages/{HomePage,AuthPage,HistoryPage,TaskPage}.tsx`、`components/{AppHeader,RequestComposer,StatusPanel,ReviewPanel,PreviewPanel}.tsx`、`components/preview-panel.css`、`styles/global.css`；删除 `ExampleCard.tsx` 与 `example-card.css`；新增 `tests/e2e/interaction.spec.ts`，同步 `workspace.spec.ts` 的账号菜单定位和 `playwright.config.ts` 的套件说明。文档更新：Web README、STATUS、CODEBASE-MAP、ARCHITECTURE、LOCAL-DEVELOPMENT、本验收记录、TASK-BOARD、项目手册 02/06。

无数据库迁移、公共 Interface/Contracts 或后端行为变化。未重复完整 verify、付费 DeepSeek 建站或应用重启验收；真实隔离执行、细分 Agent 进度事件、SSE、取消、真实发布仍未接入。旧浏览器缺少 moveBefore 时全屏移动仍可能重载 iframe；本轮浏览器证据仅来自 Chrome。

## 当前验证矩阵

| 范围 | 命令 | 当前状态 |
|---|---|---|
| 全量构建与类型 | `npm run build`、`npm run typecheck` | 通过 |
| Agent loop | `npm test --prefix packages/agent-runtime` | 4/4 通过；覆盖 Builder patch/observation、Reviewer 只读与多轮 browser observation |
| Model Gateway | `npm run test:model` | 19/19 通过；覆盖 DeepSeek body、system message、可选输出上限、重试和错误脱敏 |
| Workspace | `npm test --prefix packages/workspace` | 7/7 通过 |
| 公共契约 | `npm run test:contract` | 6/6 通过 |
| PostgreSQL API/Worker | `npm run test:local` | 18/18 通过；使用独立 TEST_DATABASE_URL |
| Web | `npm run check:web`、`npm run test:web` | TypeScript/lint/format 通过；Web 4 文件、16/16 通过 |
| 浏览器 | `npm run test:e2e` | TASK-042 UI fixture 11/11（8790 与更新后 8787）；真实 PG 认证/路由基线为 TASK-034 1/1，完整真实模型链路基线为 TASK-033 3/3，本轮未重跑真实模型 |
| 应用重启 | `npm run test:restart` | 当前真实模型任务超过 180 秒等待，未通过；需要后续优化长任务/重启验收等待策略 |
| Compose 服务 | `COMPOSE_PROJECT_NAME=atoms-builder-v1 docker compose up -d --build --wait`、`curl http://127.0.0.1:8787/healthz` | 通过；API/Worker/PostgreSQL running，healthz 为 deepseek/modelConfigured=true |

Playwright/重启测试进程显式传入测试数据库与 DSKEY，真实模型链路允许多轮运行，断言检查预览结构与用户关键标识。UI fixture 套件不使用模型。

## 当前边界

- 产品 Worker 只装配 DeepSeek，密钥来自 `DSKEY`；没有模型替代路径。
- Builder 和 Reviewer 都是最多 12 轮的 action loop。模型输出由 Zod Schema 校验，Workspace 负责路径、版本和检查边界。
- `ModelRequest.maxOutputTokens` 省略时不向 DeepSeek 发送 `max_tokens`，由 Provider 默认值决定；应用仍保留一个很大的历史预算字段，实际 loop 只受轮次安全上限约束。
- `LocalWorkspaceAdapter` 的 check、preview 和 artifact 是确定性适配器；生产隔离 executor、运行中的生成项目预览、Reviewer 真实浏览器和生成项目发布没有接入。
- TASK-042 没有数据库迁移或公共 Interface 变化；既有 ModelRequest 的 `systemPrompt`、`maxOutputTokens` 为可选字段。
