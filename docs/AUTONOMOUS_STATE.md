# 无人值守开发状态

最后更新：2026-08-10（Asia/Shanghai）

## 当前阶段

阶段 13：计划任务。

## 当前任务

- 设计本地计划任务 schema、时区/RRULE 或间隔调度和错过运行策略。
- 实现创建、编辑、暂停、删除、立即运行和持久化恢复。
- 使用项目或隔离工作树启动真实 Codex turn，记录运行历史、未读与错误。
- 建立计划任务工作台、自动测试和桌面回归。

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
- 使用临时真实项目与已配置 ChatGPT 登录完成在线 Codex 流式 E2E，并验证项目 `AGENTS.md` 使最终消息为 `ASTER_INSTRUCTIONS_OK`。
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
- 完成 working/staged diff、tracked/untracked/binary 归一、增删统计和 200 文件/2 MiB/16 MiB 预算。
- Electron E2E 实际审阅智能体生成文件的 unified patch 后再暂存提交。
- 完成结构化 hunk、新旧行号、unified/split 视图与离屏 hunk 原生渲染跳过。
- 完成主进程随机快照/hunk 令牌、五分钟/64 快照边界、单次失效和截断禁用操作。
- 完成 `git apply --check` 后的 hunk stage/unstage/revert；拒绝 untracked 破坏性 revert、符号链接跟随与仓库路径逃逸。
- 真实仓库逐项验证远距离 hunk 单独 stage、unstage、revert、带空格无末尾换行文件和过期快照拒绝。
- Electron E2E 在 split view 选择新增行，将评论真实追加给 Codex 并收到 `ASTER_REVIEW_OK`，随后 hunk stage 和 commit。
- 实际检查 1320×840 浅色 split diff 截图，未见溢出、错位或对比度问题。
- 采用 app-server `command/exec` PTY，避免 node-pty 原生 ABI；接入 xterm 6、多会话、搜索、清屏、resize、terminate/close。
- 完成项目/工作树/任务 cwd 绑定、12 会话、4 MiB 双层缓冲、64 KiB 输入、尺寸和输出分片边界。
- 完成显式终端上下文桥：移除 ANSI/OSC/C0 后仅共享最近 32 KiB，不静默注入模型。
- Electron E2E 真实键盘运行 `printf`/`pwd`、搜索、输出→Codex (`ASTER_TERMINAL_CONTEXT_OK`)、清屏、终止与关闭会话。
- 实际检查 1320×840 浅色 xterm drawer 截图，标签、工具栏、搜索、ANSI 输出和光标无明显问题。
- 完成稳定 MCP/技能/配置领域层，支持分页 inventory、OAuth、reload、资源读取和显式直接工具调用。
- 完成 MCP 服务器/thread/工具归属校验、256 KiB 参数、2 MiB 结果和 1 MiB 资源预算。
- 完成 `mcpServer/elicitation/request` 与 `item/tool/requestUserInput` 挂起、提交/拒绝/取消及退出安全取消。
- 完成 skills/list/changed/config/write、作用域/依赖/错误、最多 8 个进程级额外根目录和项目信任门。
- 完成用户/项目/系统/托管配置层、requirements 和五项枚举化原子配置写入，不暴露任意 TOML 覆盖。
- 完成提供商、MCP、技能、配置四页设置工作台及空状态、错误、loading、OAuth 和结果预览。
- Electron E2E 真实读取 app-server MCP/技能/配置，持久化项目信任，并通过项目指令返回 `ASTER_INSTRUCTIONS_OK`。
- 当前环境 `node_repl` MCP 通过 app-server 直接工具调用执行无副作用表达式；elicitation 与用户输入由自动替身闭环覆盖。
- 集成公开 `@openai/codex-security` 0.1.8，并隔离其 Codex SDK/可执行文件 0.144.6 与 plugin 0.1.15。
- 完成 SDK/Python/账户诊断、repository/path/refs/working-tree/deep 参数、preflight、费用、进度、Trusted Access、取消和错误分类。
- 扫描输出固定在仓库外 `userData/security` 私有目录；只有 completed + sealed contract 的结果可导入。
- 完成安全总览、扫描、漏洞、仓库和设置五页工作台，支持报告、finding、coverage、JSON/CSV/SARIF 与 2 MiB 有界预览。
- 完成官方 CLI validate/patch/false-positive/export 适配；全部使用参数数组，patch 二次确认，误报必须填写原因。
- SQLite 持久化安全历史；错误或取消扫描不会产生完成结果，密钥形状错误文本会脱敏。
- 真实 SDK preflight 验证 Node 24、Python 3.12、ChatGPT 登录和仓库外输出；真实路径扫描进入 discovery。
- 真实扫描在估算 $2.010621 时按设定的 $2 上限抛出 `ScanCostLimitExceededError`；未 sealed 的部分产物未导入或伪装成漏洞。
- Electron E2E 再次通过 1 项约 1.5 分钟全回归，安全页 1320×840 浅色截图无溢出。

## 下一任务

1. 调查 Codex 计划任务公开行为并选定本地调度与时区语义。
2. 实现计划任务数据库、调度器、错过运行、重试和单实例并发控制。
3. 将调度执行连接到真实项目/工作树 Codex 任务并记录运行历史。
4. 建立计划任务 UI、回归、文档与阶段提交。

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
- Codex Security 只接受 completed + sealed SDK 结果；cost limit、中断和 contract 失败保留失败状态，不展示部分 finding。
- Security validate/patch/false-positive/export 使用官方 CLI 参数数组；patch 必须显式确认，renderer 不能提交路径或命令。

## 当前失败测试

暂无。最近一次结果：20 个单元/集成测试文件共 88 项通过；Electron E2E 1 项约 1.5 分钟通过，真实覆盖 Security SDK preflight、AGENTS.md、MCP/技能/配置、app-server PTY、终端输出→Codex，以及既有全功能回归；类型、规范、脚本语法和生产构建通过。

## 已知问题

- 本机 Codex 是预发布构建 `0.147.0-alpha.6.5`，会与稳定 0.147.0 schema 做兼容测试。
- Windows 只能在 CI 中构建验证，当前 macOS 环境不能完成 Windows 真机运行验证。
- 当前渲染器生产主包约 1.07 MiB（含 xterm），后续按工作台路由和终端动态导入做代码分割。
- 首个 thread 的自动标题依赖上游异步 metadata；已监听名称通知并在 turn 完成后刷新 thread/read。
- Codex Security standard 扫描即使仅 2 个目标文件也超过本次 $2 在线验证上限；提高预算前不能宣称真实 sealed 扫描完成。

## 当前阻塞

无项目级阻塞。

## 外部依赖

- OpenAI/ChatGPT 凭据：在线 Codex 实测需要；缺失时使用协议测试替身。
- DeepSeek API Key：真实在线验证需要；缺失时使用本地 SSE 测试服务器。
- Codex Security 权限与模型费用：当前认证/运行链路可进入 discovery；完整扫描仍需足够费用上限，受保护请求还可能需要 Trusted Access。
- Apple/Windows 代码签名证书：仅影响最终签名、公证与商店发布。

## 待验证问题

- app-server 崩溃后 persisted thread 的重新 resume 与订阅恢复语义。
- 计划任务在应用完全退出时采用“下次启动补跑”还是安装平台后台服务；阶段 13 先实现应用运行期间调度与可配置错过运行。
