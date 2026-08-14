# MCP、技能与配置集成

最后更新：2026-08-10。

## 上游依据

- [Codex app-server](https://learn.chatgpt.com/docs/app-server)：`mcpServerStatus/list`、OAuth、资源读取、直接工具调用、`skills/list`、技能启停、配置分层和反向交互请求。
- [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp)：Codex 用户配置中的 MCP 传输与认证模型。
- [Codex skills](https://learn.chatgpt.com/docs/build-skills)：`SKILL.md`、作用域和依赖声明。
- [Codex config basics](https://learn.chatgpt.com/docs/config-file/config-basic)：用户、项目、系统与托管配置层。
- [Codex AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md)：项目根到当前目录的指令链和 override 优先级。

实现以仓库中由当前 Codex 二进制生成的 stable TypeScript/JSON Schema 为编译基线；渲染器不导入上游协议类型。

## 主进程边界

`IntegrationService` 是唯一与 app-server 集成 RPC 直接通信的领域层：

- MCP 状态最多读取 10 页、500 个服务器条目；工具、资源和模板转换为稳定展示模型。
- OAuth 仅接受 HTTPS，或本机 loopback HTTP 开发回调；最终外部打开仍由 Electron 主进程策略拦截。
- 资源必须出现在当前服务器 inventory 中；单次返回最多保留 1 MiB 和 32 个 content item。
- 直接工具调用必须满足项目→thread 归属、服务器/工具 inventory 匹配、256 KiB 参数预算和用户显式确认；返回最多 2 MiB。
- `skills/changed` 和 MCP startup/OAuth 通知触发失效刷新。
- 技能启停按 app-server 返回的精确路径执行，不能由 renderer 构造未知技能路径。
- 额外技能根目录只能通过系统目录选择器添加，要求项目已信任，最多 8 个，并且仅在当前 app-server 进程有效。
- 配置写入只暴露经过枚举的 `config/value/write`：审批、沙箱、Web Search、推理强度和输出详细度。没有任意路径或任意 TOML 文本写入口。
- `config/read(includeLayers=true)` 与 `configRequirements/read` 同时展示有效值、来源、项目层、托管要求和覆盖状态。

## 反向交互

`mcpServer/elicitation/request` 和 `item/tool/requestUserInput` 是 server→client request，而不是普通通知。主进程保持 request pending，直到用户明确提交、拒绝或取消；应用退出时统一安全取消。

- MCP form/openai-form：用户提交有界 JSON。
- MCP URL：只显示 HTTPS 或本机 loopback HTTP 地址。
- 用户问题：最多 3 项；支持选项、自由文本和密码输入。
- 密码答案不进入持久化状态、日志或项目数据库。

## 项目信任与指令

项目首次打开默认为未信任。信任状态保存在本地 SQLite，仅控制 Norevinq 的扩展能力边界，不伪装成 Codex 上游的策略字段。

设置工作台只读预览项目根的 `AGENTS.override.md` 或 `AGENTS.md`（拒绝符号链接和越界 realpath，预览上限 128 KiB）。真正的指令合并、大小限制和逐层覆盖仍由 Codex app-server 执行。

## 验证

- 单元测试覆盖 MCP/技能/配置归一、项目和 thread 归属、信任门、外部根目录、参数预算、资源与工具结果，以及两类反向请求的挂起/决策。
- Electron E2E 通过真实 app-server 读取当前 MCP、技能和配置，持久化项目信任，并展示临时仓库 `AGENTS.md`。
- 同一 E2E 的真实 Codex turn 只收到 `instruction proof`，依据项目指令回复 `NOREVINQ_INSTRUCTIONS_OK`。
- 当前环境配置的 `node_repl` MCP 通过 `mcpServer/tool/call` 执行无副作用表达式 `1 + 1`，结果不是错误。

OAuth 完成通知、资源读取和具有副作用的第三方工具不能在没有相应外部服务器/账户的环境中进行统一在线回归；协议与错误路径由替身测试覆盖，界面不会伪造登录或工具结果。
