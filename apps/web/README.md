# Web application

React + TypeScript SPA，使用 Vite 构建、React Router 管理 URL，MUI / Emotion 提供统一蓝白主题与交互组件。任务和账号的业务真相只在 PostgreSQL 后端，浏览器不使用 localStorage、sessionStorage 或内存任务仓库恢复业务数据。

## 目录与职责

```text
src/
  app/                 主题、QueryClient、路由、错误恢复和应用装配
  pages/               登录注册、首页、历史任务与详情
  components/          统一需求输入、状态、审核、预览及通用反馈 UI
  features/
    auth/              Cookie 会话、登录/注册/退出、缓存隔离
    tasks/             服务端任务加载、轮询、幂等提交与冲突恢复
    preview/           生成 HTML 隔离策略（保存版本与本页草稿共用）
  api/                 Application HTTP v1 客户端与 Zod 响应校验
  styles/              最小全局基础样式；组件主题在 app/theme.ts
```

依赖从 `app → pages/components → features/api` 向内。`@atoms-builder/contracts` 中的 Application v1 schema/type 是客户端和服务端的共同契约，前端不能另建不一致的 DTO。服务端返回的任务数据由 TanStack Query 统一缓存；UI 草稿、dialog 展开等临时交互状态可以使用 React state，不能把它们当成任务记录。

## 认证与账号隔离

- `/login`、`/register` 为公开表单；首页、`/tasks`、`/tasks/:taskId` 为受保护路由。
- 启动请求 `GET /api/auth/me`；登录/注册成功返回用户，注册即登录。密码只用于当前请求，不写日志或浏览器持久存储。
- 后端用 opaque HttpOnly Cookie 管理会话；客户端只用同源 credentials，不读取 Cookie、不存 token。
- 受保护路径登录后返回原内部 URL，拒绝外站地址与登录页循环。
- 退出、会话 401、登录/账号切换会取消查询并清理所有任务和 mutation cache。晚到的任务提交响应会核对原用户身份，不能把上一个账号的作品塞入新账号缓存。

## 持久化任务

- 首页 `POST /api/tasks` 立即获得 202 queued 任务并导航详情；`GET /api/tasks/:id` 加载详情，queued/running 每 1.5 秒轮询，完成后停止。
- 页面卸载只取消查询等待，不调用后台取消 API；刷新或另开任务链接从数据库重新加载。
- 修改使用 `POST /api/tasks/:id/runs`，只发需求和幂等键；历史上下文从后端数据库恢复，不发送 previousHtml。
- 同一需求提交在网络结果不确定时复用 idempotencyKey；获得确定成功后生成下一个键。任务运行时禁用修改，409 明确提示并重新加载当前任务。
- 历史页 `GET /api/tasks?page=…&pageSize=20` 分页加载，只展示当前用户数据；错误、空态和加载态都有明确反馈。
- 首页与详情共用 `RequestComposer`：Enter 发送、Shift+Enter 换行，兼容 Ctrl/⌘+Enter；IME composition/keyCode 229 与长按重复键不提交，空白禁用；请求成功清空修改草稿，失败保留草稿和未确认提交的幂等键。
- 任务详情桌面为可独立滚动的需求/进展侧栏与预览双栏，移动端为「需求与进展 / 作品预览」页签，切换不卸载 iframe。输入固定在侧栏底部，运行中可先写草稿，完成后再发送。
- 进展按服务端 queued/running/succeeded/failed 展示；时长从本次 Run.createdAt 计算，标记为「提交已过」，不是模型运行时长。没有细分生成/审查事件或百分比；后台中断连接时显示最近状态并提示重连。
- `ConversationPanel` 按时间展示每轮用户需求和真实处理状态；初始化/新增轮次滚动到最新，阅读历史时状态更新不抢滚动位置。源码审查在所属轮次按需展开；版本 ID 放在审查详情。失败/修改中保留旧预览，并明确标注上次完成版本。历史任务采用摘要列表，后台更新失败仍保留上次加载的列表。

## 预览约束

生成 HTML 只能进入隔离 iframe 的 `srcDoc`，不得注入应用 DOM。CSP 禁止网络、外部资源和表单提交；sandbox 只允许脚本，不允许 same-origin。全屏由原生 dialog 管理焦点和 Esc，稳定 portal 复用唯一 iframe。支持原子 DOM 移动的浏览器可在展开/退出时保留预览交互状态。

预览区提供「预览 / 代码」页签，`SourceEditor` 封装 CodeMirror 6，编辑实际交付的 `public/preview.html`（内联 HTML/CSS/JavaScript），支持语法高亮、行号、折叠、补全、两空格缩进、中文查找替换和撤销重做；首次代码页签才加载本地独立 chunk，之后保留编辑器实例/选区/历史，250ms 防抖自动进入同一隔离 iframe。页签切换保留草稿和 iframe 状态，恢复原始代码需确认；清空源码显示可恢复空态。草稿仅 React state 本页有效，刷新/离开后丢失，不写数据库或下一轮模型上下文；有修改时浏览器刷新/关闭触发原生离开提示。新版本到达保留原草稿，显式载入后才替换。Tab 缩进，Esc 后紧接 Tab 可移出编辑器；外部恢复/载入版本会重置撤销历史，避免撤销回到旧版本。当前不提供完整 Next.js 源码树、编译或草稿保存接口，源码审查始终属于已保存版本。

## 开发与检查

在根目录统一安装，不在子目录维护锁文件或单独安装。后端连接 PostgreSQL 与 worker 的启动配置以仓库开发说明为准。

```sh
npm run dev
npm run check:web
npm run test:web
npm run build
npm run test:e2e
```

`check:web` 运行严格 TypeScript、ESLint 和 Prettier；`test:web` 覆盖 HTTP 契约/204/401/409、认证缓存清理、详情加载、幂等重试和晚到响应隔离。根 Playwright 的 `workspace.spec.ts` 执行真实 PG 注册/登录/创建/刷新/历史与跨账号验收；`interaction.spec.ts` 全量拦截 API，以确定性 HTTP fixture 验证键盘、进展、错误恢复、预览与响应式，不调用模型；前端单测不代替真实后端、模型或生产验收。变更前端后先格式化 `npm run format --workspace @atoms-builder/web`。
