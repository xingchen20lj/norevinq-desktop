# 本地网页预览

Aster Code 使用 Electron `WebContentsView` 承载本地开发网页，不在主 Renderer 中使用拥有同一页面上下文的 iframe。网页渲染进程没有 Node 集成、预加载桥或 Aster IPC。

## 导航范围

内嵌顶级导航仅接受：

- `localhost` 与任意 `*.localhost`
- IPv4 loopback `127.0.0.0/8`
- IPv6 loopback `::1`
- HTTP 或 HTTPS，无 URL 用户名/密码

页面的 HTTP(S)/WebSocket 子资源也必须是 loopback/localhost；`data:` 和 `blob:` 仅用于页面内部资源。`file:`、公共网络、`javascript:`、0.0.0.0、凭据化 URL 和窗口弹出均拒绝。需要访问公共站点时，用户必须确认并使用系统浏览器。

## 隔离与权限

- 使用不带 `persist:` 前缀的独立内存 session partition。
- `sandbox=true`、`contextIsolation=true`、`nodeIntegration=false`、`webSecurity=true`。
- 摄像头、麦克风、地理位置、通知等所有权限检查和请求默认拒绝。
- 下载事件一律阻止；`window.open` 一律拒绝。
- 本地页崩溃只更新预览错误状态，不影响主应用 Renderer 或 app-server。

## 工作流

工具栏支持地址输入、打开、后退、前进、刷新、停止、系统浏览器打开和关闭。主进程同步标题、URL、加载状态、历史状态及加载错误。页面控制台最多保留 500 条，每条 4000 字符；来源 URL 去除 query、fragment 和内嵌凭据后再发往 Renderer。

网页可视区域由 `ResizeObserver` 将 CSS 像素矩形发送给主进程，主进程对数值和尺寸做边界校验后设置原生 view。关闭预览时移除并销毁 WebContents。

## 验证证据

- 单元测试覆盖 localhost、`.localhost`、127/8、::1、公共/凭据/非 Web URL 拒绝，以及外部子资源策略。
- Electron E2E 启动真实 `127.0.0.1` HTTP 服务，原生 view 加载页面并同步 `Aster Browser Proof` 标题，捕获 `ASTER_BROWSER_LOG`，验证 `/next` 导航与后退，以及公共 URL 拒绝和关闭销毁。
- Playwright 的 Renderer `page.screenshot()` 不合成 `WebContentsView` 的原生子表面，因此截图中的 slot 占位不作为网页像素证据；标题、控制台、历史和独立 WebContents 实际加载是当前自动验证依据。
- 通用 Computer Use 仍依赖非公开能力，本地预览不伪装为网页操作智能体。
