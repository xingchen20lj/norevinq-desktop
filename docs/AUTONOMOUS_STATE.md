# 无人值守开发状态

最后更新：2026-08-10（Asia/Shanghai）

## 当前阶段

阶段 3/4：项目、对话与流式智能体活动。

## 当前任务

- 用真实项目调用 `thread/start`、`thread/read/list/resume` 并持久化任务关联。
- 实现 turn/start、结构化 item reducer、流式消息与活动时间线。
- 建立命令、文件变更、推理、计划和错误事件的领域适配。
- 为审批、steer 和 interrupt 建立状态机与 IPC 契约。

## 已完成任务

- 初始化空 Git 仓库，默认分支为 `main`。
- 获取 2026-08-10 当前 OpenAI Codex 官方手册。
- 确认 Codex app-server 以省略 `jsonrpc` 字段的 JSON-RPC 2.0 工作，默认 stdio/JSONL，并要求 `initialize` → `initialized` 握手。
- 确认 app-server 提供线程、轮次、流式 item、审批、中断、模型、技能、MCP、配置、认证、命令执行等公开接口，并能生成版本匹配的 TypeScript/JSON Schema。
- 确认 `@openai/codex-security` 是公开 ESM SDK，要求 Node.js 22.13+ 与 Python 3.10+；扫描还要求账户拥有 Codex Security 权限。
- 确认 Codex 自定义模型提供商当前以 Responses API 为正式 wire API，支持通过环境变量提供密钥。
- 确认本机可用 Codex 内置 Node.js 24.14.0 与 pnpm 11.16.0。
- 选择 Electron + React + TypeScript 作为初始桌面架构，并记录 ADR。
- 完成 OpenAI Codex 0.147.0、Codex Security 0.1.8 和 DeepSeek Responses 官方上游调查，详见 `docs/RESEARCH.md`。
- 使用已有安全凭据真实验证 `deepseek-v4-flash` 的非流式、SSE、函数调用回传和 Web Search；未记录或输出密钥。
- 真实确认 `deepseek-v4-pro` 截至 2026-08-10 仍不能调用 Responses API。
- 创建 Electron 43 + React 19 + TypeScript 6 的主进程、CJS 预加载桥、渲染器和共享领域层。
- 创建 SQLite schema migration、最近项目去重/恢复和真实系统目录选择入口。
- 完成独立品牌的响应式桌面外壳，包含项目、任务、安全、计划任务、设置和 composer 信息架构。
- 在实际 Electron 43 运行时验证 `node:sqlite` 可用。
- 通过 TypeScript 严格检查、ESLint、单元测试、生产构建和 Playwright Electron 冒烟测试。
- E2E 确认渲染器没有 `require`/`process`，只暴露最小 `window.aster` IPC 桥。
- 实际检查 1320×840 浅色界面截图；未发现文本溢出或面板错位。
- 实现 JSONL 双向 RPC 内核，覆盖 Codex 省略 `jsonrpc` header、请求/通知/反向请求、超时、EOF、最大消息和写背压。
- 实现 Codex 二进制发现、版本探测与 stable schema 原子同步；真实生成 642 个 TS 类型和 285 个 JSON Schema。
- 实现 app-server supervisor、自动启动、initialize/initialized、模型目录、异常退出检测和空闲指数退避恢复。
- 明确禁止活动 turn 崩溃后自动重放，避免重复命令/文件副作用。
- 实现类型化运行时 IPC、状态订阅、重启入口和 UI 连接状态。
- 实现递归敏感信息脱敏、0600 JSONL 日志和 2 MiB/3 份轮转。
- Electron E2E 真实验证 app-server 达到 ready、版本为本机 `0.147.0-alpha.6.5` 且返回 6 个模型。

## 下一任务

1. 完成 thread start/list/read/resume 和任务持久化。
2. 完成 turn start、item/delta reducer 和流式活动 UI。
3. 完成真实 Codex 文本任务的在线闭环。
4. 接入审批、追加指令、中断与崩溃恢复 UX。

## 已做技术决策

- 产品工作名：Aster Code；不复制 OpenAI 专有品牌资产。
- 桌面容器：Electron 43；目标渲染器保持 `contextIsolation: true`、`sandbox: true`、禁用 Node 集成。
- UI：React 19 + TypeScript；所有原始 app-server 消息在主进程转换为稳定领域事件，渲染器不直接依赖上游协议。
- 包管理：pnpm，锁定依赖；使用仓库脚本统一调用测试与构建。
- 持久化：优先使用 Electron 所带 Node 的 `node:sqlite`，启动时执行显式 schema migration；若 Electron 运行时验证不满足再改用经过审计的 SQLite 绑定。
- 秘钥：系统凭据保险库；开发期仅允许从环境变量注入，绝不写入数据库、日志或 Git。
- Codex：正式运行协议只使用 app-server stdio，不解析 TUI 文本。
- DeepSeek：优先通过 Codex 自定义 Responses provider 形成完整智能体闭环；同时保留独立能力探测与直接连接诊断层，不静默假设模型能力。
- Git：所有命令使用参数数组且限制 cwd；工作树使用 detached HEAD 起步，并保存可恢复快照元数据。
- 安全扫描输出必须位于被扫描工作树之外，并使用私有权限目录。

## 当前失败测试

暂无。最近一次结果：8 个单元测试文件共 30 项通过；1 个 Electron E2E 通过；类型、规范、脚本语法和生产构建通过。

## 已知问题

- 本机 Codex 是预发布构建 `0.147.0-alpha.6.5`，会与稳定 0.147.0 schema 做兼容测试。
- Windows 只能在 CI 中构建验证，当前 macOS 环境不能完成 Windows 真机运行验证。
- 当前渲染器生产主包约 574 kB，后续按工作台路由做代码分割。

## 当前阻塞

无项目级阻塞。

## 外部依赖

- OpenAI/ChatGPT 凭据：在线 Codex 实测需要；缺失时使用协议测试替身。
- DeepSeek API Key：真实在线验证需要；缺失时使用本地 SSE 测试服务器。
- Codex Security 权限：真实扫描需要 Trusted Access/账户授权；SDK 集成与错误路径不依赖权限。
- Apple/Windows 代码签名证书：仅影响最终签名、公证与商店发布。

## 待验证问题

- DeepSeek 经 app-server 完整执行文件修改的闭环仍待桌面运行时验证。
- app-server 崩溃后 persisted thread 的重新 resume 与订阅恢复语义。
- Codex Security SDK 当前安装包是否能在 Electron 主进程直接加载，或需要隔离 Node worker。
