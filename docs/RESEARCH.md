# 官方上游研究基线

调查日期：2026-08-10。所有动态能力必须在运行时再次探测；本文只作为首个实现和回归基线。

## OpenAI Codex

- 当前稳定上游：`rust-v0.147.0`（2026-08-07）。
- 本机 ChatGPT/Codex 包含：`codex-cli 0.147.0-alpha.6.5`，路径发现只用于开发，不作为发布时硬编码路径。
- app-server 默认使用 stdio JSONL；协议语义为省略 `jsonrpc` 字段的双向 JSON-RPC 2.0。
- 每条连接必须完成 `initialize` 请求并等待响应，再发送 `initialized` 通知。
- 官方没有独立协议 semver。客户端必须组合 `codex --version`、initialize 返回的 `userAgent`、同一二进制生成的 stable TypeScript/JSON Schema 与兼容测试判断支持范围。
- 新实现只采用 v2。渲染器不导入上游原始类型，而消费内部领域事件。
- 审批是 app-server 发给客户端的带 id 请求，客户端必须使用 request id 和 thread/turn/item 上下文关联后返回结果。
- 运行中 app-server 崩溃不能盲目重放 turn，避免重复执行副作用；活动 turn 标记失败并允许显式恢复，空闲连接才自动重建订阅。

来源：

- [Codex 0.147.0 release](https://github.com/openai/codex/releases/tag/rust-v0.147.0)
- [Codex App Server 官方文档](https://learn.chatgpt.com/docs/app-server)
- [app-server README](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)
- [app-server protocol v2](https://github.com/openai/codex/tree/main/codex-rs/app-server-protocol/src/protocol/v2)
- [提交的 JSON schemas](https://github.com/openai/codex/tree/main/codex-rs/app-server-protocol/schema/json)

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

## 本机开发环境

- macOS 15.7.9，Intel x86_64，16 GiB 内存。
- Git 2.39.5；GitHub CLI 2.97.0；Git LFS 未安装。
- Codex 工作区运行时：Node 24.14.0、pnpm 11.16.0。
- Swift 6.1.2、Apple clang 17；没有完整 Xcode。
- Rust/Cargo、CMake、Ninja 不存在，因此当前选择 Electron 而非 Tauri 也减少了额外工具链阻塞。
- 当前环境不能做 Windows 真机测试；后续用 CI 做 Windows 构建和自动测试，并明确保留真机验证项。
