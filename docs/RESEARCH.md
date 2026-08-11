# 官方上游研究基线

调查日期：2026-08-11。所有动态能力必须在运行时再次探测；本文只作为首个实现和回归基线。

## OpenAI Codex

- 当前稳定上游：`rust-v0.147.0`（2026-08-07）。
- 本机 ChatGPT/Codex 包含：`codex-cli 0.147.0-alpha.6.5`，路径发现只用于开发，不作为发布时硬编码路径。
- app-server 默认使用 stdio JSONL；协议语义为省略 `jsonrpc` 字段的双向 JSON-RPC 2.0。
- 每条连接必须完成 `initialize` 请求并等待响应，再发送 `initialized` 通知。
- 官方没有独立协议 semver。客户端必须组合 `codex --version`、initialize 返回的 `userAgent`、同一二进制生成的 stable TypeScript/JSON Schema 与兼容测试判断支持范围。
- 新实现只采用 v2。渲染器不导入上游原始类型，而消费内部领域事件。
- 审批是 app-server 发给客户端的带 id 请求，客户端必须使用 request id 和 thread/turn/item 上下文关联后返回结果。
- 0.147.0 稳定协议提供 `permissionProfile/list` 与 `item/permissions/requestApproval`。请求可包含网络开关、文件系统读写根和 path/glob/special 条目；响应必须回传原请求权限的子集及 `turn` 或 `session` scope，省略项即拒绝。
- 权限 profile 是服务器/组织策略目录，不足以代替逐请求审批。客户端不得允许 Renderer 自行构造授权路径；应把请求映射为不透明选项 ID，并在可信主进程按原始请求重建响应。
- 运行中 app-server 崩溃不能盲目重放 turn，避免重复执行副作用；活动 turn 标记失败并允许显式恢复，空闲连接才自动重建订阅。

### 账户与登录

- `account/read` 返回当前账户和当前 provider 是否要求 OpenAI 认证；账户响应不包含可供客户端读回的 API Key 或 OAuth token。
- `account/login/start` 的稳定模式包括 `apiKey`、Codex 托管的 ChatGPT 浏览器 OAuth 和 `chatgptDeviceCode`；托管模式由 Codex 持久化并刷新 token。
- 浏览器/设备码成功或失败通过 `account/login/completed` 通知，账户切换通过 `account/updated`；托管登录可按主进程保存的 `loginId` 取消。
- `chatgptAuthTokens` 明确是实验性、面向已拥有 ChatGPT token 生命周期的宿主；Aster 不启用该模式，也不尝试从 ChatGPT 或本机其他应用提取 token。
- ChatGPT 账户可通过 `account/rateLimits/read` 与 updated 通知显示用量窗口；API Key 模式不应伪装成 ChatGPT 用量。

来源：

- [Codex 0.147.0 release](https://github.com/openai/codex/releases/tag/rust-v0.147.0)
- [Codex App Server 官方文档](https://learn.chatgpt.com/docs/app-server)
- [app-server README](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)
- [app-server protocol v2](https://github.com/openai/codex/tree/main/codex-rs/app-server-protocol/src/protocol/v2)
- [提交的 JSON schemas](https://github.com/openai/codex/tree/main/codex-rs/app-server-protocol/schema/json)
- [官方 Auth endpoints](https://learn.chatgpt.com/docs/app-server#auth-endpoints)

## DeepSeek Responses API

- 官方端点：`POST https://api.deepseek.com/responses`。
- 认证：`Authorization: Bearer $DEEPSEEK_API_KEY`。
- 截至调查日，Responses 可用模型为 `deepseek-v4-flash`；`deepseek-v4-pro` 虽在模型目录和 Chat Completions 可见，但真实 Responses 请求返回 HTTP 400。
- 已用当前环境安全配置的凭据完成最小在线验证：非流式响应、SSE、函数调用、`function_call_output` 第二轮闭环和服务端 Web Search。
- SSE 以语义事件传输，终态是 `response.completed`、`response.incomplete` 或 `response.failed`，没有 `[DONE]`。
- 支持 function tools、Codex 特例 `apply_patch` custom tool、推理和 server-side Web Search。
- 不支持图片/文件输入、MCP、Code Interpreter、Computer Use、后台任务和有状态 Responses；`previous_response_id`、`conversation` 与 `store` 不可用。
- 多个不支持参数会被服务端静默忽略，因此 UI/适配层必须本地拒绝不支持能力，不能把 HTTP 成功等同于功能支持。
- `web_search_call` 可能失败而顶层 response 仍为 completed，必须逐 item 检查状态。

首个能力注册：

| 能力 | `deepseek-v4-flash` |
|---|---|
| Responses | 是 |
| 文本输入 | 是 |
| function tools | 是 |
| `apply_patch` custom tool | 是 |
| 推理 | 是：none/low/high/max |
| 服务端 Web Search | 是，需检查子调用状态 |
| 图片/文件 | 否 |
| MCP/Code Interpreter/Computer Use | 否 |
| 有状态/后台 Responses | 否 |
| 推理摘要 | 否 |
| Responses WebSocket | 未公开，按否处理 |

来源：

- [Responses API 指南](https://api-docs.deepseek.com/guides/responses_api/)
- [Responses API Reference](https://api-docs.deepseek.com/api/create-response/)
- [模型与能力](https://api-docs.deepseek.com/quick_start/pricing/)
- [推理模式](https://api-docs.deepseek.com/guides/thinking_mode/)
- [Codex 集成](https://api-docs.deepseek.com/quick_start/agent_integrations/codex/)
- [DeepSeek 更新日志](https://api-docs.deepseek.com/updates/)

## Codex Security

- 当前稳定：`@openai/codex-security@0.1.8`，ESM，Node `^22.13 || ^24 || ^26`，扫描还要求 Python 3.10+。
- SDK 支持 repository/path/committed diff/working tree、standard/deep、preflight、预算、进度、取消和密封 artifacts。
- 0.1.8 的隔离运行时锁定 `@openai/codex`/SDK 0.144.6，必须与桌面主 app-server 0.147.0 分离。
- 历史、误报、部分导出、validate 和 patch 仍主要由 CLI 提供；不能直接绑定私有 workbench SQLite schema。
- SDK 公开可安装不代表账户拥有扫描权限；认证缺失、Security access 缺失和 Trusted Access 未授予是不同状态。
- 本机 SDK 真实诊断：Node 24、隔离 Python 3.12、ChatGPT 存储登录均可用；preflight 返回 `gpt-5.6-sol`/`xhigh` 且产物目录位于仓库外。
- 真实路径扫描已进入 discovery，说明认证、插件和模型链路可工作；以 `maxCostUsd=2` 运行时 SDK 在估算 $2.010621 后抛出 `ScanCostLimitExceededError`。该输出未 sealed，产品必须保留失败状态且不得导入其中的部分 finding。

来源：

- [Codex Security 0.1.8 release](https://github.com/openai/codex-security/releases/tag/npm-v0.1.8)
- [Codex Security SDK 官方文档](https://learn.chatgpt.com/docs/security/sdk)
- [TypeScript SDK 源码](https://github.com/openai/codex-security/tree/main/sdk/typescript)

## Codex 计划任务

- 官方桌面计划任务在本地运行，要求电脑开机且 Codex 桌面应用正在运行；公开文档没有提供由 app-server 管理计划任务的稳定 RPC。
- 任务可在 Local 或隔离 worktree 中运行；独立自动化每次创建新任务，也可从已有任务上下文创建继续型自动化。
- 高级调度使用 RFC 5545 RRULE；运行结果进入带未读状态的收件箱。
- 官方建议保留默认沙箱边界。无人值守运行不能在中途等待审批；组织策略不允许 `never` 时应明确失败，而非静默提升权限。
- 因此 Aster Code 在主进程实现本地 RRULE/SQLite 调度器，并把实际执行交给 app-server。它不伪装成 Codex CLI 的调度管理接口，也不声称应用退出后仍能后台运行。

来源：

- [Codex Scheduled Tasks](https://learn.chatgpt.com/docs/automations)

## Electron 自动更新

- 当前稳定 `electron-updater` 为 6.8.9；Aster Code 使用 electron-builder 26.15.3 生成同一套 `app-update.yml`、`latest-mac.yml`/`latest.yml`、SHA-512 和 blockmap。
- macOS 自动更新要求应用已签名，并需要 DMG 与 ZIP；Windows 使用现有 NSIS 目标。未签名内部包不生成更新渠道，避免把不可验证产物发布为升级版本。
- 运行时不接受 Renderer 或用户输入更新 URL，只读取签名包内的 `app-update.yml`。发布构建只接受无凭据、无 query/fragment 的 HTTPS base URL。
- 正式包在启动 30 秒后检查，并每 6 小时检查；发现新版本后由用户确认下载，下载完成可立即安装或在正常退出时安装。禁用预发布、降级和 NSIS web installer。
- electron-updater 校验 update metadata 的 SHA-512，并在 macOS/Windows 执行平台代码签名校验；真实跨版本更新仍必须用同一发布身份的两个签名版本在目标系统验证。

## 崩溃记录与诊断导出

- Electron `app` 稳定公开 `render-process-gone` 与 `child-process-gone`，后者不包含 Renderer；两者都给出 reason/exitCode，可区分 crash、OOM、killed、launch failure 和 clean exit。来源：[Electron app API](https://www.electronjs.org/docs/latest/api/app#event-render-process-gone)。
- Node `uncaughtExceptionMonitor` 在默认崩溃行为前触发，不会像 `uncaughtException` handler 那样改变退出语义；Aster 只做同步、best-effort 本地记录，绝不尝试在未定义进程状态中恢复。来源：[Node.js process API](https://nodejs.org/docs/latest-v24.x/api/process.html#event-uncaughtexceptionmonitor)。
- 不启用第三方自动遥测或隐式上传。崩溃 journal 最多保留 100 条，ZIP 只在用户选择保存位置后生成，对日志字段密钥、自由文本密钥与本地绝对路径再次脱敏。

来源：

- [electron-builder Auto Update](https://www.electron.build/docs/features/auto-update/)
- [electron-updater API](https://www.electron.build/docs/api/electron-updater/)
- [Electron autoUpdater 平台要求](https://www.electronjs.org/docs/latest/api/auto-updater)

## 本机开发环境

- macOS 15.7.9，Intel x86_64，16 GiB 内存。
- Git 2.39.5；GitHub CLI 2.97.0；Git LFS 未安装。
- Codex 工作区运行时：Node 24.14.0、pnpm 11.16.0。
- Swift 6.1.2、Apple clang 17；没有完整 Xcode。
- Rust/Cargo、CMake、Ninja 不存在，因此当前选择 Electron 而非 Tauri 也减少了额外工具链阻塞。
- 当前环境不能做 Windows 真机测试；后续用 CI 做 Windows 构建和自动测试，并明确保留真机验证项。
