# 02 Web 前端实现

[返回手册](<README.md>) · [上一章：整体设计](<01-architecture.md>) · [下一章：API 与数据](<03-api-and-data.md>)

当前用户入口是 React SPA：注册/登录后提交需求、浏览历史任务、查看服务端保存的版本和审查结果、在隔离 iframe 中预览 HTML，并继续修改。浏览器负责交互和服务端状态缓存；模型执行、账号权限、任务排队、版本保存均在后端。当前预览不是运行中的 Next.js 服务，Reviewer 结果也不代表真实 install/build/test 或产品浏览器验收，能力边界见 [STATUS](../STATUS.md)。

## 1. 先从装配和托管理解入口

### 1.1 浏览器装配顺序

[HTML 入口](../../apps/web/index.html) 提供 `#root`、中文语言与 viewport。模块脚本进入 [main.tsx](../../apps/web/src/main.tsx)，校验根节点后以 `StrictMode` 渲染 `App`，并加载全局 CSS。开发时检查副作用要考虑 StrictMode；不能假设 effect 只初始化一次。

[App](../../apps/web/src/app/App.tsx) 的顺序是：

```text
ThemeProvider(theme) + CssBaseline
  AppErrorBoundary
    QueryClientProvider（useState(createQueryClient)，每个 App 实例一个 client）
      AuthProvider
        BrowserRouter
          Routes → AppLayout → 公开/受保护页面
```

因此页面可以共享 MUI 主题、QueryClient 和认证上下文；`AuthProvider` 本身不依赖 Router。需要路由的登录返回、导航和页面恢复放在其下层。渲染异常由 [AppErrorBoundary](../../apps/web/src/app/AppErrorBoundary.tsx) 显示恢复界面，按钮通过 `window.location.assign('/')` 重新打开应用；它不会恢复尚未提交的表单草稿，也不是异步请求错误的统一处理器。API/Query 错误另有页面反馈。

### 1.2 路由、认证门与详情加载

定义在 [App](../../apps/web/src/app/App.tsx)，行为集中在 [routes.tsx](../../apps/web/src/app/routes.tsx)：

| URL | 组件/稳定符号 | 行为 |
|---|---|---|
| `/login` | `AuthPage mode="login"` | 公开账号密码登录，已登录则跳转安全返回路径 |
| `/register` | `AuthPage mode="register"` | 公开注册，注册成功即登录 |
| `/` | `ProtectedRoute` → `HomePage` | 新建任务 |
| `/tasks` | `ProtectedRoute` → `HistoryPage` | 服务端历史任务分页 |
| `/tasks/:taskId` | `ProtectedRoute` → `TaskRoute` → `TaskPage` | URL 中 ID 直接请求服务端，支持深链接和刷新 |
| 其他路径 | `NotFoundPage` | 页面不存在的恢复界面 |

`AppLayout` 始终渲染页头和 `Outlet`，路径改变时滚动到顶部并设置统一标题。页头退出失败会出现 6 秒 Snackbar。`ProtectedRoute` 依次处理会话加载、无用户时的会话请求错误、未登录跳转、已登录内容；跳转时把完整 `pathname + search + hash` 存入 Router state 的 `from`。它以 `auth.user.id` 为 `Outlet` 的 key，账号改变会重建受保护子树和其中临时状态。

`TaskRoute` 不依赖“刚从首页创建”的内存记录。它用 `useTask(taskId)` 请求数据库投影：首次加载显示 `LoadingState`；首次失败显示 `RecoveryState`；404 同时覆盖任务不存在与不属于当前用户，不提供详情重试按钮；其他错误可 `refetch`。已有详情后的重新获取失败保留 `TaskPage`，另加警告。任务切换用 `query.data.id` 作为 `TaskPage` key，避免把上个任务草稿带入另一个任务。

### 1.3 开发与生产不是两个业务后端

[开发托管](../../apps/platform-server/src/dev.ts) 的 `startDevelopmentServer` 先创建应用资源，再把 Vite 作为 middleware 装进 API 的 HTTP server；HMR websocket 也用同一个 server。默认地址为 `127.0.0.1:8787`，受 `HOST`/`PORT` 配置影响。Vite 设置 `appType: 'custom'`，由自定义 fallback 转换入口 HTML；不存在的 `/assets/`、`/src/` 和带扩展名资源不会被误当成 SPA 页面。

[生产托管](../../apps/platform-server/src/frontend.ts) 的 `createStaticFrontend` 读取 Web 构建输出，供 GET/HEAD 访问。无扩展名页面路径回退到入口 HTML，使刷新 `/tasks/:taskId` 仍能装配 Router；API 路径始终不回退。不存在资源应返回 404，缺少 Web 构建则显示 503 构建提示。静态路径有解码、点路径/反斜杠拒绝、根目录和 realpath 检查。匹配命名规则的 hash 资源使用一年 immutable 缓存，入口和其他文件为 `no-cache`；API JSON 是 `no-store`。页面刷新问题应先分辨托管 fallback、JS 资源缓存和 API 权限三个层次。

[Vite 配置](../../apps/web/vite.config.ts) 输出 `dist`、目标 ES2022、不生成 sourcemap，并按 material、query、react 拆 vendor chunk。[Web 包脚本](../../apps/web/package.json) 的 `build` 先 `tsc -b` 再 `vite build`；开发脚本委托本地 Web 服务。日常统一从仓库根运行 [根脚本](../../package.json)，完整启动步骤见 [本地开发](../LOCAL-DEVELOPMENT.md)，不要只启动一个与 API 不同源的 Vite 站点后假定 Cookie/HMR 已接通。

## 2. 状态归属与认证缓存隔离

### 2.1 哪些状态可以放在前端

- 服务端数据：用户会话、任务摘要、详情、版本、运行历史。由 TanStack Query 缓存，经 API 恢复；没有浏览器持久化任务仓库。
- 短期 UI 状态：登录表单、需求/HTML 编辑草稿、提交锁、当前幂等键、预览页签/dialog 展开和重载计数。放在 React state/ref，卸载或刷新可能丢失。
- 身份权限：Cookie 由服务端维护，前端不读取 token，也不通过请求体声明 `userId`。路由保护是用户体验；后端才是授权边界。

缓存 key 定义于 [query-client.ts](../../apps/web/src/app/query-client.ts) 的 `queryKeys`：`session = ['session']`，任务总前缀 `['tasks']`，列表 `['tasks', 'list', page]`，详情 `['tasks', 'detail', id]`。这些 key **不包含用户 ID**，所以所有认证变化时的取消与清理是正确性条件，不能在重构时省略。默认查询新鲜期为 10 秒，窗口聚焦可重新获取；带 HTTP status 且 status 小于 500 的 `ApiError` 不自动重试（包括 2xx 的 schema 错误），无状态网络错误或 5xx 等其他查询错误最多重试一次；mutation 不自动重试。

### 2.2 会话加载、切换与退出

[AuthProvider](../../apps/web/src/features/auth/AuthProvider.tsx) 使用 `GET /api/auth/me`，会话查询不自动重试，新鲜期 30 秒，`refetchOnWindowFocus: 'always'`。即使会话仍新鲜，重新聚焦也会识别另一个标签页可能切换的账号；当前没有 BroadcastChannel 或即时跨标签通知。

`me` 的查询函数在收到新会话后对比缓存中的前用户 ID；若变化，先取消任务查询、移除任务缓存、清空 mutation cache，再提交新会话。认证成功后的 `authenticate` 则取消全部查询、清空任务与 mutation cache，并写入认证响应。全局 `sessionEvents` 的 `expired` 事件也取消查询、清空任务/mutation，并写 `{ user: null }`。

`logout` 在 `finally` 执行本地取消、清理和置空，无论网络请求是否成功都让当前页面退出；401 被视为已经失效，其他失败继续抛给布局的 Snackbar。**本地退出不等于网络失败时服务器已撤销 Cookie 会话**：需要结合请求结果判断，重新加载后服务器仍可能识别会话。此处文案已提示“退出请求未确认”。

[auth-context.ts](../../apps/web/src/features/auth/auth-context.ts) 提供 `AuthState`、`AuthContext`、`useAuth`。`safeReturnPath` 只接收以 `/` 开始、非 `//`、不含反斜杠、非登录/注册前缀的字符串，其他值回到 `/`。它保留合法站内 query/hash，防止外站跳转和认证循环。[AuthPage](../../apps/web/src/pages/AuthPage.tsx) 在登录/注册互跳时继续传递该 `from`。

后端 [server.ts](../../apps/platform-server/src/server.ts) 的 `cookie` 使用 `atoms_session`、HttpOnly、SameSite=Lax、Path=/、30 天 Max-Age；Secure 取决于 `COOKIE_SECURE`。`me` 在无会话时返回 200 `{ user: null }`，受保护任务接口返回 401；不要把这两种响应混为一谈。修改类请求检查 Origin，部署反代时需核对 `APP_ORIGIN` 和 Secure 配置。

## 3. HTTP 客户端与公共 schema

### 3.1 唯一 API 入口

[client.ts](../../apps/web/src/api/client.ts) 的 `createApplicationClient(fetcher, onUnauthorized)` 支持注入 fetch 与未授权回调，正式使用单例 `applicationClient`。请求统一相对同源 URL，`credentials: 'same-origin'`。GET 会传递 Query 提供的 `AbortSignal`；POST 使用 JSON，请求体只包含允许的输入。

| 方法 | HTTP | 成功数据/用途 |
|---|---|---|
| `me` | `GET /api/auth/me` | 可空用户会话 |
| `login` / `register` | `POST /api/auth/login`、`/api/auth/register` | 必须有用户的会话；后端分别 200/201 |
| `logout` | `POST /api/auth/logout` | 204 无正文，不执行 JSON 解析 |
| `tasks` | `GET /api/tasks?page=…&pageSize=20` | 当前用户任务摘要和分页信息 |
| `task` | `GET /api/tasks/:id` | 完整任务；ID 通过 `encodeURIComponent` |
| `createTask` | `POST /api/tasks` | 后端 202，已排队任务 |
| `modifyTask` | `POST /api/tasks/:id/runs` | 后端 202，新增运行后的任务 |

客户端使用 `response.ok` 接受成功状态，再检查响应 schema，不硬编码只能 200。成功写入返回后只说明已保存排队；不表示 Worker 已完成。旧匿名 `/api/runs` 在服务端返回 410，前端不再调用。

### 3.2 schema 的边界和兼容

公共事实源为 [Application HTTP v1](../../packages/contracts/src/application-v1.ts)，前端 [types.ts](../../apps/web/src/api/types.ts) 重导出公共类型，仅补充 `sessionSchema` 与 `authenticatedSessionSchema` 两个会话包裹对象，不复制任务 DTO。

- `accountInputSchema`：用户名 trim、3–32 位字母/数字/下划线并转小写；密码 8–128 位且不 trim；输入对象 strict。`AuthPage` 提交前用此 schema 校验，后端再校验一次。
- `applicationCreateTaskSchema`：需求 trim 后 1–10,000 字符；`idempotencyKey` 长度 8–128；strict。不能额外发送旧 `previousHtml` 或客户端声明的用户身份。
- `applicationTaskSummarySchema`：`phase` 只有 `queued`、`running`、`succeeded`、`failed`；包含标题、最后需求、错误、当前成功版本 ID 和时间。
- `applicationTaskSchema`：在摘要上增加可空 `result`、字符串 `previewHtml`、运行摘要数组 `runs`。
- `applicationRunSummarySchema` 的状态是 `queued/running/completed/failed`；与任务层 `succeeded` 不同。渲染时不要拿其中一套枚举替代另一套。
- `applicationRunResultSchema` 的 `mode` 固定为 deepseek，`status` 为 completed/awaiting_fix_decision/failed/blocked；包含版本、修复次数和审查摘要。它与 review 子对象使用 passthrough，允许保留扩展证据/模型记录，所以详情的原始 JSON 可展示 schema 未逐项声明的数据。
- 时间戳要求 datetime。列表包含 `tasks/total/page/pageSize`，客户端固定请求每页 20 条，服务端支持范围更宽不等于 UI 已提供页大小选择。

前端展示的 `currentVersionId`、HTML 与审查结果不一定属于最新一次失败运行。[ApplicationRepository](../../packages/persistence/src/application.ts) 的 `task` 投影以最新运行给出 phase/lastRequest/error，但有成功版本时读取上次成功版本的 HTML/result，失败的新运行单独列在 `runs`。因此“任务需要处理 + 旧作品仍可预览 + 审查结果仍是通过”可以是正常保留行为，应先核对版本与运行，再判断是否显示错乱。

### 3.3 错误处理

`ApiError` 携带 message、可选 HTTP status、可选 code。网络中断转成可读中文；原生 AbortError 原样传出。204 仅在预期无 schema 的成功响应直接返回。其他响应尝试 JSON，解析失败显示无法解析的服务响应；非 2xx 优先用 `{ error, code }`，否则用 401/409/通用状态文案；2xx schema 校验失败为 `INVALID_PAYLOAD`。

除登录/注册外，401 会在解析正文前触发全局 `expired`。错误密码留在认证表单，不清空全局会话。注意当前服务端 `ApplicationError` 仅返回 `{ error }`，`ApiError.code` 的通用支持不意味着服务端每种错误都有结构化 code；`INVALID_PAYLOAD` 是前端自己生成的 code。原始 Provider/数据库异常不应通过页面透传。

## 4. 任务轮询、幂等与晚到响应

### 4.1 轮询何时开始、停止

[queries.ts](../../apps/web/src/features/tasks/queries.ts) 的 `isTaskActive` 只认 queued/running。`useTask(id)` 在 ID 非空时运行，详情缓存处于 active phase 时每 1,500 毫秒重新获取，succeeded/failed 停止固定间隔轮询。[HistoryPage](../../apps/web/src/pages/HistoryPage.tsx) 只在**当前页**至少一个摘要 queued/running 时每 3,000 毫秒更新；其他分页的 active 任务不会触发本页轮询。窗口聚焦、缓存失效、挂载时的过期数据还可能引发额外 GET，不要用“网络请求次数恰好等于定时器次数”断言产品行为。

没有 SSE、WebSocket 任务流、前端取消运行或中间步骤进度。详情 LinearProgress 是不定进度条，不能据此推断运行百分比。页面卸载/查询取消只中断浏览器等待，既不取消数据库任务，也不撤销已经提交的 POST。

### 4.2 提交流程与身份生命周期

`useTaskSubmission(taskId?)` 同时支撑首页新建和详情修改：

1. `submit` 检查 ref 锁、空白需求和原始字符串长度大于 10,000；不通过返回 `null`。ref 锁在第一次 await 之前设置，防止连续点击绕过一次渲染周期里的 pending 状态。
2. 需求 trim 后传给 `SubmissionIdentity.forRequest`。同一待确认字符串复用 `crypto.randomUUID()` 生成的 key；换成另一字符串立即换 key。
3. 没有 taskId 调用 create，有则 modify，只发 `{ request, idempotencyKey }`。
4. 响应回来后，再核对提交时 `ownerId` 与 session cache 的当前用户；已退出/换号则抛 401，不允许写入任务缓存。
5. 成功清除 identity，直接写 detail cache，把 tasks 前缀置为失效并以 `refetchType: 'inactive'` 重新获取非活动查询。该调用不是“立即重拉每一个正在显示的列表”。
6. 4xx 当作确定答复清除 identity；网络失败、5xx、成功状态但无法解析/校验的响应保留 identity，供用户重试。modify 的 409 另使详情失效以重新同步服务端忙碌状态。
7. `finally` 释放提交锁，mutation 自身不自动重试。保留草稿由页面组件负责。

幂等保护的范围是**当前 hook 实例里尚未确认的同一需求**，不是跨刷新或跨标签页的草稿提交历史。刷新、离开页面、任务切换、账号切换可能销毁该实例。更改 A→B→A 也不会恢复最早 A 的 key。收到成功响应后再次提交同样文字会使用新 key，属于新的迭代。重试是否真的只产生一个运行，还依赖后端 `createTask/modifyTask` 的事务、同 key 同输入校验和单项目 active 约束，不能只靠按钮 disabled。

[服务器集成测试](../../apps/platform-server/test/server.test.ts) 检查并发相同 key 复用、同 key 不同输入 409、并发修改只有一个 active 运行；[前端 hook 测试](../../apps/web/src/features/tasks/queries.test.tsx) 检查网络失败重用 key、锁住重复提交、换号后丢弃晚到响应和 409 失效详情。两层证据的职责不同。

## 5. 页面、组件与样式修改入口

| 模块 | 当前职责与维护注意点 |
|---|---|
| [AuthPage](../../apps/web/src/pages/AuthPage.tsx) | 登录/注册共用页面，mode 决定文案和 autocomplete；本地 pending 防重复；先公共 schema 再网络请求；用户名/密码只在表单 state 中；成功返回安全内部 URL |
| [HomePage](../../apps/web/src/pages/HomePage.tsx) | 新建草稿与三个示例需求；方向按钮仅填充并聚焦输入，不提交；创建响应到达后导航详情；异常保留草稿 |
| [HistoryPage](../../apps/web/src/pages/HistoryPage.tsx) | query string 的 page 驱动 Query key、分页组件与摘要列表；页码仅接受正的安全整数；空的高页码可回第一页；首次错误可重试，后台重取失败保留列表并提示 |
| [TaskPage](../../apps/web/src/pages/TaskPage.tsx) | 桌面双栏/移动页签，左边逐轮聊天记录与折叠审查、底部输入，右边预览/代码页签；active 允许写草稿但不能发送，提交期间锁定输入；提交成功清空、失败保留草稿；失败时用 lastRequest 预填且不覆盖非空草稿 |
| [AppHeader](../../apps/web/src/components/AppHeader.tsx) | 站点入口、当前导航、账号头像菜单与退出；移动端保留头像及可用导航 |
| [StatusPanel](../../apps/web/src/components/StatusPanel.tsx)、[TaskStatus](../../apps/web/src/components/TaskStatus.tsx) | 服务端 phase 映射到等待/构建中/完成/需要处理；阶段条与 Run.createdAt 起算的提交后时长，不显示伪造百分比或模型阶段；长任务与离开页面有明确提示 |
| [ReviewPanel](../../apps/web/src/components/ReviewPanel.tsx) | 显示审查状态、分数、mustFix、risks；明确源码审查不等于生产验收 |
| [PageState](../../apps/web/src/components/PageState.tsx) | `LoadingState` 的 role=status；`RecoveryState` 提供可选重试和回首页；另有 `ErrorNotice`，当前主要页面也直接使用 Alert |
| [RequestComposer](../../apps/web/src/components/RequestComposer.tsx) | 首页与继续修改共享表单；键盘、IME、空白与处理中保护，错误反馈与字数上限 |
| [formatTaskDate](../../apps/web/src/features/tasks/format-task-date.ts) | `Intl.DateTimeFormat('zh-CN')` 格式化月日时分，使用浏览器本地时区，不主动固定 UTC/上海时区，也不显示年份 |

首页与详情均支持 Enter 发送、Shift+Enter 换行和 Ctrl/Cmd+Enter，经 `requestSubmit()` 保留原生校验；composition 状态、isComposing、keyCode 229 与重复按键不会误发。需求最大 10,000 字，两处均禁用空白提交。运行中可以先写草稿但不发送，提交确认后清空，网络失败保留草稿。

[theme](../../apps/web/src/app/theme.ts) 统一 palette、字体、字号、圆角和 MUI 组件默认风格，布局样式由页面 `sx` 与全局工作台样式共同管理。这是浅色主题，没有主题切换或国际化框架。[global.css](../../apps/web/src/styles/global.css) 设置 320px 最小 body 宽度、强制 hidden 属性、减少动态效果支持；不要据此承诺小于 320px 设备无横向滚动。预览保留独立 CSS，`body.preview-open` 的 overflow 规则目前在全局和预览 CSS 各出现一次。

`ConversationPanel` 将 `runs` 从服务端倒序转为时间正序，每轮包含右侧用户需求和左侧 Atoms 状态回复；最新轮次复用 `StatusPanel`，旧轮次显示真实完成或失败结果，不虚构工具调用或 Agent 消息。初次和新增轮次定位到底部；阅读旧消息时状态变化不抢滚动。源码审查用 `result.runId` 关联所属轮次。

## 6. 隔离 HTML、CSP 与全窗口预览

### 6.1 生成 HTML 唯一入口

[PreviewPanel](../../apps/web/src/components/PreviewPanel.tsx) 的 `html` 来自 `task.previewHtml`，代码页签也可通过 `SourceEditor` 修改本页 HTML 草稿；当前选择内容经过 250ms 防抖，非空时经 [buildPreviewDocument](../../apps/web/src/features/preview/preview-document.ts) 包装后只赋给 iframe `srcDoc`。生成页面不能进入应用 DOM；不要用 `dangerouslySetInnerHTML` 替换此路径。

`PREVIEW_CSP` 作为前置 meta 添加到原始 HTML 之前，内容为：

```text
default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';
img-src data:; form-action 'none'; base-uri 'none'
```

iframe 固定 `sandbox="allow-scripts"`，没有 allow-same-origin、allow-forms、allow-popups 或 top-navigation 权限。允许生成页面运行内联普通 JavaScript 和 CSS；网络连接、外部脚本/样式/字体/iframe 等资源受 CSP 限制，图片仅 data URI；表单提交禁止，base URL 禁止。sandbox 的 opaque origin 阻止生成代码直接读取父应用 DOM 和同源会话。**这是隔离执行，不是 HTML 消毒**：内联脚本本来就允许，CSP 也不能被描述成阻止一切可能的导航或所有资源消耗；未来放宽能力需按实际浏览器行为重新设计边界。

生成产物要求和 UI 限制要同步看 [previewArtifactIssues](../../apps/platform-server/src/preview-artifact.ts)：静态解析完整 HTML/body、非空与基础可见内容、外部资源、JSX/Babel/模块导入；该检查不执行代码，不保证运行时布局、交互或 CSP 零错误。页面需要外部 CDN、框架运行时或服务端接口时，当前独立 HTML 预览不提供这些能力。不要为了消除空白而直接补 allow-same-origin 或宽松 connect-src。

### 6.2 为什么展开不简单渲染第二个 iframe

`PreviewPanel` 创建一个稳定的 `.preview-frame-host` DOM 容器，并用同一个 React portal 持有 iframe。`useLayoutEffect` 将容器接入普通 stage 后才设 `hostAttached`，避免 iframe 先在脱离文档的容器中创建 browsing context。展开时：

1. 原生 `<dialog>` 调用 `showModal()` 进入顶层模态层。
2. `moveContainer` 把同一宿主移到 fullscreen 内容区；容器已连接且浏览器支持 `HTMLElement.moveBefore` 时优先原子移动，否则 `append` 回退。
3. 给 body 加 `preview-open` 禁止背景滚动，并把焦点移至退出按钮。
4. 退出按钮设置 expanded=false；Esc 由原生 dialog 关闭并触发 `onClose`；effect 清理关闭 dialog、移除 body class、恢复展开按钮焦点，再把宿主移回 stage。
5. 组件卸载时移除稳定容器。

这是**浏览器内容区全窗口**，没有调用 Fullscreen API，不会隐藏浏览器地址栏。[preview-panel.css](../../apps/web/src/components/preview-panel.css) 用 `100vw × 100dvh` 铺满 dialog，预览区高度减去 60px 工具栏。支持原子移动的浏览器可保留 iframe 内部状态；fallback append 仍可能重载 browsing context，不能承诺所有旧浏览器都保留交互。

iframe 的 key 是 `${sourceVersionId ?? 'preview'}:${frameRevision}`：载入新版本 ID 使 iframe 重建；“重新加载预览”只增加 revision，不向后端提交新运行；展开/收起不改 key。`srcDoc` 用 html 的 memo 值，若 HTML 本身改变也会影响内容加载。尚无产物时按钮禁用，空态根据 queued/running/failed 显示文案；已有旧产物时即使新一次构建正在运行或失败，仍可查看旧版本。

### 6.3 本页源码编辑

「代码」页签仅提供实际产物 `public/preview.html`，其中 CSS/JavaScript 为内联代码；[SourceEditor](../../apps/web/src/components/SourceEditor.tsx) 使用 CodeMirror 6，提供 HTML 及内嵌 CSS/JavaScript 高亮、行号、折叠、补全、两空格缩进、搜索替换、撤销重做和语言/行数提示。编辑器依赖由 npm 和根锁文件本地打包，`PreviewPanel` 通过 React lazy/Suspense 在首次代码页签加载；此后通过 hidden 保留实例、选区与历史，显示时请求重新测量布局。CodeMirror 的 create/destroy 在 layout effect 成对管理，外部源码恢复/新版本载入创建新编辑历史，用户输入回传不会重建实例。工具栏支持撤销/重做与中文查找替换。Tab/Shift+Tab 缩进/减少缩进；为避免键盘焦点陷阱，按 Esc 后紧接 Tab 可移出编辑器（见 [CodeMirror 官方说明](https://codemirror.net/examples/tab/)）。代码输入始终作为文本，生成内容只进入隔离 iframe；切换页签不卸载 iframe。清空草稿显示空态，可确认恢复；恢复、页面刷新和离开不修改服务器版本。浏览器关闭/刷新在有修改时有原生提示，应用内部导航不会保留草稿。

`PreviewPanel` 保留草稿的 baseHtml/versionId；后台新版本到达时保留编辑内容并提供显式载入操作，避免轮询吞掉草稿。代码页脚明确仅本页有效；未修改时自动使用服务器最新版本。草稿不调用 API、不写入数据库或 Query 业务数据，也不传给下一轮模型；保存版本的审查不覆盖草稿。本功能不提供 Next.js 项目完整源码或编译运行，未来持久化编辑需新增授权/幂等/不可变候选版本契约。

## 7. 测试入口和证据边界

下面列出前端相关的验证入口。运行前需按 [开发章节](<06-development-and-operations.md>) 准备环境；历史结果见 [验收记录](<../INTEGRATION-STATUS.md>)。

| 命令（仓库根执行） | 入口与验证范围 |
|---|---|
| `npm run check:web` | [根脚本](../../package.json) 串行执行 Web typecheck、ESLint、Prettier；[tsconfig.app](../../apps/web/tsconfig.app.json) 启用 strict/noUncheckedIndexedAccess 等，[ESLint](../../apps/web/eslint.config.js) 检查 Hooks 和类型 import |
| `npm run test:web` | [Vite/Vitest 配置](../../apps/web/vite.config.ts) 的 jsdom，匹配前端 `*.test.ts/tsx`；不依赖真实 PG，不证明真实模型执行 |
| `npm run build:web` | Web TS 项目引用编译与 Vite 生产资源输出，不能代替真实浏览器/接口验证 |
| `npm run test:local` | [server.test.ts](../../apps/platform-server/test/server.test.ts) 覆盖 PG 认证、隔离、幂等、失败旧版本保留、lease 和静态托管；需独立测试数据库 |
| `npm run test:e2e` | [Playwright 配置](../../playwright.config.ts) + [workspace.spec.ts](../../tests/e2e/workspace.spec.ts)，真实浏览器/PG/API/Worker 用户链路，需要 DSKEY 才会调用真实模型 |
| `npm run test:restart` | [application-restart.mjs](../../tests/application-restart.mjs)，应用停止重启后会话、版本、完整源码与继续修改恢复；不是浏览器 UI 测试 |
| `npm run verify` | 完整构建、前端检查、各层测试、浏览器及重启门禁；需要 Docker、测试库等完整前置条件，见 [本地开发](../LOCAL-DEVELOPMENT.md) |

当前前端单测分四组：

- [client.test.ts](../../apps/web/src/api/client.test.ts)：6 个，覆盖同源凭据、202 schema、ID 编码/分页/signal、登录与 204、401 分流、409/非法响应、网络/JSON/AbortError。
- [queries.test.tsx](../../apps/web/src/features/tasks/queries.test.tsx)：5 个，覆盖深链接加载、active 判断、未确认重试 key、重复提交锁、晚到换号响应、409 详情失效和 identity 输入变化。
- [AuthProvider.test.tsx](../../apps/web/src/features/auth/AuthProvider.test.tsx)：4 个，覆盖加载 Cookie 会话、登出清缓存、expired 清缓存、聚焦发现换号、注册替换旧缓存。
- [auth-context.test.ts](../../apps/web/src/features/auth/auth-context.test.ts)：1 个，覆盖安全返回路径与拒绝外站/反斜杠/认证循环。

Playwright 包含真实后端 `workspace.spec.ts` 与完全拦截 API 的 `interaction.spec.ts`，串行单 worker，默认 Chrome channel、1280×900；CI 可重试一次，失败保留 trace/screenshot。默认由配置启动 8790 上的 `npm start`，指定 `LOCAL_WEB_URL` 则不启动 server，需自行确认目标是测试环境。[test-database.mjs](../../scripts/test-database.mjs) 只把进程切换到 TEST_DATABASE_URL；需要完整任务链时显式设置 DSKEY，优先使用根 npm 命令。

`interaction.spec.ts` 验证 Enter/换行/IME/重复键、失败幂等重试/草稿清理、实际状态切换、CodeMirror 按需加载/高亮/折叠/补全/缩进/查找替换/撤销历史、逐轮聊天顺序/阅读滚动、HTML 编辑自动预览/恢复/新版本草稿保留、预览保态、320/390px 源码编辑布局与账号表单；其 HTTP fixture 不代表真实模型验收。

`workspace.spec.ts` 浏览器测试覆盖注册→创建→等待 Worker→刷新→iframe sandbox/父 DOM 不可读→键盘交互→展开/Esc/退出状态保留→独立重载不新增运行→历史进入→继续修改→登出/重新登录；另测跨账号 404、HttpOnly Cookie、390px 认证/错误页和未知路由。测试对 opaque-origin iframe 用真实键盘输入，源码注释指出 headless Chrome 可能出现过时鼠标命中区域，排查时应区分输入事件问题与预览 JS 故障。

## 8. 功能扩展时的落点

| 扩展需求 | 建议入口与必须同步核对的约束 |
|---|---|
| 新的受保护页面 | `App` 添加子路由，沿用 `ProtectedRoute`；在 [routes](../../apps/web/src/app/routes.tsx) 与 [PageState](../../apps/web/src/components/PageState.tsx) 处理恢复，深链接需继续经过托管 fallback |
| 新的 API 字段/接口 | 先维护公共 [Application v1](../../packages/contracts/src/application-v1.ts)，再客户端方法、Query/hook、页面；增加响应校验与错误行为，不能前端独自定义另一份 DTO |
| 增加任务状态/取消/SSE | 同步公共状态枚举、服务端持久化与权限、`isTaskActive`、历史轮询、TaskStatus、运行历史文案；当前取消查询不是取消任务 |
| 新列表过滤/排序/分页 | Query key 必须包含所有影响结果的参数，URL 与请求参数一致；缓存仍需在账号切换清理；不要只改可见列表不改 key |
| 新示例或主题 | 首页 `examples`、[全局样式](../../apps/web/src/styles/global.css) 或 [theme](../../apps/web/src/app/theme.ts)；示例仍只是填充需求，不伪装为已构建模板 |
| 预览更多资源能力 | 同步前端 CSP/sandbox、后端 [预览交付检查](../../apps/platform-server/src/preview-artifact.ts)、生成要求和真实浏览器负向测试；模型输出未经可信执行证明不能提升权限 |
| 历史版本选择/恢复/导出 | 当前详情 API 不提供完整版本列表或源码下载，需先定义服务端权限和不可变版本契约；不要将 runs 数组误当可恢复源码版本集合 |
| 跨标签即时账号同步 | 可在现有认证清缓存机制之上设计通知；保留聚焦重查和晚到响应身份核对，不依赖通知替代服务器授权 |

## 9. 常见故障排查顺序

| 症状 | 先查事实 | 定位与解释 |
|---|---|---|
| 整页打不开/深链接刷新失败 | 入口 HTML/JS 是否 200，资源 MIME 是否正确，是否 503 或资源 404 | `createStaticFrontend` 与开发 fallback；生产缺构建用 `build:web`，不要把 `/api/*` 配成 HTML fallback |
| 登录后仍回登录或 Cookie 没发送 | 登录响应 Set-Cookie、`me` 返回、同源地址、Secure/Origin/APP_ORIGIN | [client](../../apps/web/src/api/client.ts) 不存 token；HTTP 开发误开 Secure 或使用不同 host/origin 会影响 Cookie |
| 退出后刷新又登录 | logout 网络状态与 Snackbar | `logout` 的 finally 只确保本地清理；服务端未收到撤销时不能推断会话已删除 |
| 切号后看到旧任务/旧草稿 | session ID、tasks/mutation cache、Outlet key、是否绕过 Provider | [AuthProvider](../../apps/web/src/features/auth/AuthProvider.tsx) 的取消/清理和提交后的 owner 核对不可删除 |
| 一直 queued/running | 直接 GET 的 phase、Worker 是否独立运行、数据库队列/lease | 前端只轮询，关闭页面不停止任务；API 202 不证明 Worker 已消费，不能靠更高轮询频率修复后台队列 |
| 任务运行时还能重复提交/409 | busy、提交锁、后端 active 约束、幂等键是否复用 | 页面禁用只减少误操作，后端冲突正常需要刷新详情；网络失败后应使用原需求原 key 重试 |
| 页面显示完成但预览空白 | `previewHtml`、版本 ID、iframe `srcDoc`、开发者控制台 CSP 错误 | 检查外部资源/模块导入/JSX、缺可见正文；静态交付检查不能保证全部运行时行为 |
| 显示失败但还能看旧作品 | phase/error、currentVersionId、result.versionId、runs[0] | 后端保留最后成功 HTML/result 是设计行为；最新失败与当前成功预览应分别理解 |
| 展开/退出丢交互或滚动锁未恢复 | 是否支持 moveBefore、是否版本/HTML/revision 变更、dialog open、body class | [PreviewPanel](../../apps/web/src/components/PreviewPanel.tsx) 的 portal 宿主搬移和 effect 清理；旧浏览器 append 可重载 |
| 点击重载后交互重置但无新运行 | frameRevision 与 runs/version 是否变化 | 预览重载是本地重建 iframe；这是正常行为，不应新增后端任务 |
| schema 报 INVALID_PAYLOAD | HTTP 成功正文、服务端与 Contracts 构建版本 | schema 使用共享包，检查新旧 bundle/API 是否同时部署；不要放宽解析以掩盖契约不一致 |
| 只有历史页网络抖动时列表消失 | 是否 query.error 且已有 query.data | 列表与详情都保留最近数据并提示重试；检查是否首次请求失败而非重取失败 |
| 日期相差数小时 | ISO 时间戳与浏览器时区 | `formatTaskDate` 用本地时区，没有固定上海时区；先判断产品预期，不能直接修改数据库时间 |

## 10. 行为边界与待完善项

以下行为来自当前实现，修改时应同时核对对应测试：

1. **全窗口保态有浏览器条件**：稳定 portal 并不足以保证所有浏览器不重载；`moveBefore` 不存在时走 append。当前 Chrome E2E 检查了交互状态保留，没有覆盖不支持该 API 的浏览器。
2. **测试名称不能扩大解释**：单测名称中的“rather than requiring a browser session”指不依赖浏览器内存任务数据；产品仍然要求 Cookie 认证。移动端 E2E 的受保护链接测试实际包含注册后手动再次访问，不足以单独证明每一种登录返回路径；`safeReturnPath` 单测证明路径筛选规则。
3. **安全/轮询验证仍有空白**：四组单测没有直接驱动定时器证明 1.5 秒/3 秒起停；UI fixture 验证详情轮询阶段切换，不覆盖全部轮询时序。E2E 检查 sandbox、父 DOM 隔离和交互，但未断言完整 CSP 文本、真实外网请求/表单被拒绝。现有静态安全策略和测试存在，不能据此宣称所有负向行为均已实测。
4. **API code 只是可选协议支持**：客户端可读取 `detail.code`，当前服务器大部分业务错误只返回 error 字符串；不要按未实现的统一 code 编写页面分支。服务端请求失败与任务运行失败的错误字段也在不同层。
