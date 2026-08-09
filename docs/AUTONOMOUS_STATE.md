# 无人值守开发状态

最后更新：2026-08-10（Asia/Shanghai）

## 当前阶段

阶段 9：代码差异审阅。

## 当前任务

- 实现工作区/已暂存 diff 读取、文件列表、统计和二进制检测。
- 接入 unified/split 代码差异面板和大型 diff 边界。
- 实现按区块 stage/unstage、显式 revert 与行内评论上下文。
- 将评论/选中 diff 安全追加给当前智能体任务。

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
- 完成 thread/start/list/read/resume 与项目→thread SQLite 关联，任务在应用重启后可由 app-server 历史恢复。
- 完成 turn/start、turn/steer、turn/interrupt 的类型化主进程服务与最小 IPC 桥。
- 完成稳定活动领域模型与不可变 reducer，覆盖消息、推理、命令、文件、MCP、动态工具、搜索、协作、计划、错误和未知协议项。
- 完成 server→client 命令/文件审批挂起状态机，只有明确 UI 决策才响应，关闭时统一 cancel。
- 完成真实任务列表、流式活动时间线、模型/推理选择、发送/追加/停止和审批 UI。
- 使用临时真实项目与已配置 ChatGPT 登录完成在线 Codex 流式 E2E，最终消息为 `ASTER_RUNTIME_OK` 且未调用工具。
- 实际检查 1320×840 浅色和 960×640 深色任务界面，消息、侧栏、输入区无明显溢出。
- 在 read-only 沙箱真实触发 fileChange 审批，UI 允许后 apply_patch 创建文件并精确验证内容。
- 真实执行 `sleep 8` 命令并在运行中 steer，最终收到 `ASTER_STEER_OK`。
- 真实中断 `sleep 20` turn，确认未产生 `INTERRUPT_FAILED` 最终消息；修复了中断时上游省略 item/completed 导致活动卡滞留 inProgress 的问题。
- 以 app-server 进程级配置接入 DeepSeek，不修改用户 `~/.codex/config.toml`。
- 完成 Electron safeStorage 凭据保险库、0600 原子写入、环境优先级与不可读回 IPC。
- 设置页显示 DeepSeek 配置来源、能力限制与 V4 Pro Responses HTTP 400 阻塞原因。
- 真实 `deepseek-v4-flash` Responses 产生 reasoning 和 custom apply_patch，创建文件内容精确为 `DEEPSEEK_TOOL_OK\n`，最终消息为 `ASTER_DEEPSEEK_OK`。
- 完成项目根约束、参数数组、相对路径校验、无凭据提示、超时与 8 MiB 输出边界的 Git 服务。
- 完成 porcelain v2 NUL 状态、branch/upstream/ahead/behind、remote、stage/unstage、commit/push。
- 真实临时仓库执行两次 commit 和本地 bare remote push；Electron E2E 将智能体文件通过 Git 面板暂存并提交至干净状态。
- 完成仓库外 managed root、detached 默认、显式分支、SQLite 恢复、missing、lock/unlock/remove。
- 完成 `.worktreeinclude` ignored 候选、glob/排除、普通文件、路径和 10/100 MiB 边界。
- Electron E2E 创建、锁定/解锁、选择 worktree 作为真实 Codex cwd，任务完成后移除并恢复 Local。

## 下一任务

1. 建立安全 diff runner 与结构化文件/区块模型。
2. 实现工作区/已暂存 diff 读取和真实仓库测试。
3. 接入 diff panel 与行内评论。
4. 实现区块操作和回归测试。

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

暂无。最近一次结果：16 个单元/集成测试文件共 75 项通过；Electron E2E 另覆盖真实 managed worktree 生命周期与 Codex 上下文；类型、规范、脚本语法和生产构建通过。

## 已知问题

- 本机 Codex 是预发布构建 `0.147.0-alpha.6.5`，会与稳定 0.147.0 schema 做兼容测试。
- Windows 只能在 CI 中构建验证，当前 macOS 环境不能完成 Windows 真机运行验证。
- 当前渲染器生产主包约 608 kB，后续按工作台路由做代码分割。
- 首个 thread 的自动标题依赖上游异步 metadata；已监听名称通知并在 turn 完成后刷新 thread/read。

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
