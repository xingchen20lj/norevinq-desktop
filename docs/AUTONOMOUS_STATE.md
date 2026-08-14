# 无人值守开发状态

最后更新：2026-08-14（Asia/Shanghai）

## 当前阶段

阶段 20：桌面打包和发布准备（完成）；正在执行开源发布准备、最终功能一致性逐项审计与体验缺口修复。

## 当前任务

- 完成开源许可证、社区治理、公开文档、隐私清理和可复现 Codex schema 生成的完整质量门。
- 随后继续逐项审计提供商错误体验、Web Search 活动和剩余“部分实现”功能。

## 已完成任务

- 新增 macOS 完全卸载说明，覆盖独立 userData、Aster Codex home、Security 扫描产物、托管工作树元数据、偏好、缓存、深链接、TCC 和 `safeStorage` 钥匙串项目，并明确系统日志/备份不属于应用可保证清除的边界。
- 使用 Codex Security plugin 0.1.19 完成并密封标准单次部分覆盖扫描；确认默认 Aster Codex/Security 路径不与官方 `~/.codex` 冲突，同时将当前无签名 DMG 限定为可信项目内部体验包。扫描发现 3 项中等和 5 项低风险待修复问题，利用细节不写入未来公开仓库。

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
- 记录 `deepseek-v4-pro` 在 2026-08-10 仍不能调用 Responses API；2026-08-13 复核官方 reference/Codex catalog 后确认已开放，当前账户最小真实请求返回 `completed`、模型 `deepseek-v4-pro` 和精确输出 `ASTER_PRO_OK`。
- 完成 `deepseek-v4-pro` 模型目录、能力注册、设置状态和专属在线 Electron E2E；随应用固定的官方 Codex 0.147.0 经 app-server 在 47.9 秒内真实调用 `apply_patch`，创建 `DEEPSEEK_PRO_TOOL_OK\n` 文件并返回 `ASTER_DEEPSEEK_PRO_OK`。
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
- 设置页显示 DeepSeek 配置来源、Flash/Pro 两个 Responses 模型及统一的显式能力限制。
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
- 完成本地 RFC 5545 RRULE/IANA 时区调度器、SQLite 任务/运行队列和应用启动恢复。
- 完成创建、编辑、暂停、恢复、删除、立即运行、错过运行 run-once/skip、1–4 次重试和单任务防重叠。
- 计划任务使用真实 app-server thread/turn，支持 Local、托管 worktree、每次新对话或 Local 继续同一对话。
- 无人值守执行强制 `approvalPolicy=never`，保留沙箱选择；运行错误脱敏，崩溃后的 active run 标失败且不盲目重放。
- 完成计划任务工作台、运行收件箱、未读徽标、取消/已读和完整编辑器。
- 单元/集成测试增至 21 个文件 93 项；Electron E2E 创建并执行真实 Local/只读计划任务，返回 `ASTER_SCHEDULED_OK`。
- 实际检查 1320×840 浅色计划任务收件箱截图，未见溢出、错位或不可读状态。
- 完成项目/worktree 绑定文件树、每目录 500 项预算、2 MiB 文本截断和无扩展名文本/二进制样本检测。
- 完成图片、音频、视频和 PDF 预览领域层，图片 50 MiB、PDF 100 MiB 上限；音视频使用流式 byte range。
- 建立 15 分钟/128 个不透明 `aster-file` token，自定义协议支持 GET/HEAD、206/416、no-store、nosniff 和响应 CSP。
- 路径解析逐段拒绝符号链接、绝对路径、NUL 与 `..`，再用 realpath 确认项目根；Renderer URL 不包含本地路径。
- 完成文件与产物工作台、目录面包屑、文本/图片/媒体/PDF UI、智能体 fileChange 直达和确认式系统打开。
- 系统打开拒绝执行位或常见脚本/可执行扩展名；符号链接仅显示但不能遍历。
- 单元/集成测试增至 23 个文件 101 项；Electron E2E 真实打开 `ASTER_APPROVAL_OK` 文本并经自定义协议解码 1×1 PNG。
- 实际检查 1320×840 浅色文本与图片预览截图，未见文件树、标题或预览区域溢出。
- 完成 Electron 原生 WebContentsView 本地网页预览；使用独立内存 session，网页无 Node、preload 或 Aster IPC。
- 内嵌导航与 HTTP(S)/WebSocket 子资源只允许 localhost、`.localhost`、127/8 和 ::1；公共 URL 仅可确认后系统打开。
- 默认拒绝所有网页权限、下载和 `window.open`；渲染进程崩溃只进入可解释错误状态。
- 完成地址、前进/后退、刷新/停止、外部打开、标题/加载/错误同步和 500 条有界开发控制台。
- 单元/集成测试增至 24 个文件 104 项；Electron E2E 启动真实 loopback HTTP 服务，验证标题、console、导航、后退、公共 URL 拒绝和关闭销毁。
- Playwright Renderer 截图不合成原生 WebContentsView 子表面；未把 slot 占位画面伪装为网页像素验证，实际 WebContents 加载状态为自动证据。
- 完成平台化命令面板与快捷键：⌘/Ctrl+K、⌘/Ctrl+N、⌘/Ctrl+`、Escape；12 项命令均调用真实现有能力。
- 完成 system/light/dark 主题偏好，首次跟随系统并监听 matchMedia 实时变化；Renderer 重载后保持。
- 完成 64 px 侧栏折叠，composer/审批联动重排和全局高对比 focus-visible。
- SQLite migration v6 持久化窗口 normal bounds、最大化和全屏；恢复前校验最小尺寸、有限数值和显示器交集。
- E2E 验证命令搜索/Escape、960×640 折叠/展开、深色紧凑布局、主题重载和应用关闭后的窗口状态落库。
- 实际检查 960×640 深色折叠截图，侧栏图标、活动时间线、命令状态和 composer 无明显溢出。
- 新增隔离 app-server 崩溃替身测试：空闲进程退出后只重启一次并恢复 ready；活动 turn 退出后失败关闭且不自动重启/重放。
- 引入 `@vitest/coverage-v8` 4.1.10；首次完整覆盖率基线为 statements 80.16%、branches 68.14%、functions 83.97%、lines 87.33%，25 个文件 106 项通过。
- 草拟覆盖率门槛（78/65/80/85）和 macOS 15、Windows 2025 GitHub Actions 验证矩阵；恢复后仍需执行 lint/typecheck/CI 配置校验后才能提交。
- `pnpm verify:ci` 完整通过：25 个测试文件 107 项、全局覆盖率门槛、严格类型、ESLint、脚本语法和生产构建。
- 审批拒绝与退出取消、历史 thread hydration 增加自动回归；拒绝决策不会被复用，关闭服务会把所有挂起审批解析为 cancel。
- 建立 `docs/TESTING.md` 与 GitHub Actions macOS 15/Windows 2025 验证矩阵；Actions 官方版本按 2026-08-10 最新稳定 major 配置。
- 尝试完整 Electron 在线回归时，真实 app-server 返回账户使用量已耗尽（恢复时间 2026-08-16 11:32）；测试准确失败，未伪装为通过，尚未验证的 E2E 扩展已撤回。
- 阶段 17 提交 `9e22537`：覆盖率质量门、崩溃恢复、审批拒绝、CI 与测试文档。
- 生产依赖审计发现 `@openai/codex-security` 间接固定的 PDF.js 高危漏洞；通过 pnpm override 升级至修复版本 6.2.108，复扫为 0 已知漏洞。
- 为所有 IPC handler 加入当前主窗口顶层 frame 授权；离线 Electron 创建恶意 Node Renderer，真实证明非主窗口调用被拒绝。
- 媒体预览令牌绑定 device/inode，协议以 `O_NOFOLLOW` 打开并对实际文件句柄 `fstat`，消除路径签发后的文件替换越界读取。
- app-server 子进程从继承全部环境变量改为跨平台最小白名单；任意/GitHub 密钥不再泄漏，真实 Codex initialize/model-list 仍达到 ready。
- 创建根 `SECURITY.md` 与 `docs/SECURITY_AUDIT.md`，生产许可证均为 MIT/Apache-2.0/ISC/BSD/0BSD。
- Codex Security SDK 在加固后的依赖树上真实 preflight 通过；正式 sealed 标准扫描因桌面 direct-start 工具不可用及账户使用量限制待外部恢复。
- 阶段 18 最终 `verify:ci`：26 个测试文件 111 项通过，覆盖率 80.23/68.39/84.21/87.23，类型、规范、构建通过；离线 Electron IPC 对抗通过。
- 将 xterm、设置、安全、计划任务、文件、浏览器和命令面板拆为按需 chunk；首屏 JS 从 1,204.97 kB 降至 643.29 kB（-46.6%），xterm 411.70 kB 不再阻塞首屏。
- 建立生产 bundle 守门：首屏 JS 700 KiB、首屏 CSS 80 KiB、Renderer 全资产 1.4 MiB；`verify` 和 `verify:ci` 均执行真实 HTML 入口检查。
- 流式活动查找改为最近项优先，活动卡启用离屏布局跳过；5,000 条历史/2,000 delta 基准为 15.8–139.0 ms。
- SQLite migration v7 增加项目/计划运行排序索引，“全部已读”改为单条原子 SQL；3,000 条运行历史基准读取与批量已读为 20.9–22.7 ms。
- 真实 Electron 全新 profile 冷启动基线：首屏可见 2.15 s、DOMContentLoaded 345 ms、4 个进程工作集总计 307.1 MiB。
- 离线 Electron 回归真实打开全部 lazy 工作台并再次验证恶意 Renderer IPC 拒绝；性能测试不调用在线模型。
- 阶段 19 最终质量门：26 个单元/集成测试文件 111 项、2 项性能基准、类型、规范、脚本、覆盖率、生产构建和 bundle 预算通过；覆盖率 80.14/68.32/84.24/87.09。
- 将公开 `@openai/codex` 0.147.0 固定为随应用发布的主 runtime；发现优先级为显式配置、`CODEX_BINARY`、包内版本、PATH、ChatGPT bundle，不复制或依赖本机 ChatGPT 私有安装。
- 为 macOS/Windows x64/arm64 显式声明官方平台 optional package，避免 pnpm 11 在目标 runner 漏装传递型原生依赖。
- 完成独立 Aster Code SVG/PNG/ICNS/ICO 图标、macOS hardened runtime/entitlements、公证配置和 Windows 交互式 per-user NSIS 配置。
- 生产包明确去除 Codex Security pnpm 嵌套图中的重复原生二进制；主包只保留一份 0.147.0。Security 0.1.8 声明的 0.144.6 打包兼容性保留为 sealed 扫描复验项，不伪称完成。
- 完成包内 runtime 审计脚本和 packaged E2E；真实目录包与只读挂载 DMG 均启动，包内 app-server 0.147.0 达到 ready、模型目录非空。
- Intel macOS 无签名产物实测：App 697 MiB、DMG 259 MiB、ZIP 273 MiB；DMG CRC、ZIP 全文件测试通过，最终 SHA-256 为 DMG `1d88ba25...e653`、ZIP `c5bd6b35...417e`。
- 建立 macOS 15/Windows 2025 手动发布 workflow：默认缺签名/公证凭据即失败，完成质量门、许可证、平台打包、packaged E2E、签名验证、校验和与 artifact 上传。
- 从锁定生产依赖图生成 90 包 `THIRD_PARTY_NOTICES.md`，并加入 CI 漂移守门。
- 使用 Codex Security plugin 0.1.18 完成 Stage 20 working-tree diff 的七文件 discovery、两项候选独立验证和攻击路径校准；finalizer 因 macOS `/var` 非 canonical 路径硬约束未 sealed，未伪称完成。
- 修复 release workflow 任意 ref 使用签名凭据（中危/P2）与 GitHub Actions 可变标签（低危/P3）：main-only、immutable checkout SHA、protected `release` environment、无签名模式空凭据、完整 Action SHA 和 Windows Authenticode 验证。
- 建立 `check:workflows` 回归守门；notice 生成器改为绝对 pinned pnpm 入口、普通文件替换和 HTTP(S) 链接，并用 symlink victim 测试验证不越界写入。
- 阶段 20 最终质量门：27 个测试文件 114 项、2 项性能基准、覆盖率门槛、类型、规范、workflow 守门、许可证、构建、bundle、生产漏洞审计和 packaged E2E 全部通过。
- 完成 `thread/list` 搜索与不透明游标分页、失效游标拒绝、分页合并，以及侧栏搜索、加载更多和活动/归档视图切换。
- 完成任务重命名、分叉、上下文压缩、归档、恢复和永久删除；破坏性操作在活动 turn 或挂起审批时失败关闭，删除同步移除 SQLite 关联。
- 归档、恢复和删除后自动从当前筛选视图第一页重新同步，避免当前页清空时隐藏服务端仍存在的其他任务。
- 直接启动随依赖固定的官方 `@openai/codex` 0.147.0 app-server，在隔离 `CODEX_HOME` 中真实验证命名、读取、搜索请求、分叉、归档、恢复和删除；测试不调用模型或消耗在线额度。
- 离线 Electron E2E 完成搜索、分页、原生重命名对话框、分叉、压缩确认、归档/恢复和删除确认的完整 UI 闭环；1320×840 浅色截图无溢出或错位。
- 本阶段 `verify:ci`：28 个测试文件 118 项、覆盖率 80.53/68.56/84.80/87.50、2 项性能基准、类型、规范、脚本、workflow、许可证、构建和 bundle 预算全部通过。
- SQLite migration v8 为项目与项目–任务关联增加固定元数据；固定项目优先于最近项目，固定任务优先于更新时间，重启后保持。
- 固定任务为本地桌面偏好，不篡改上游 Codex thread；首屏会用 `thread/read` 补齐未落在第一页的固定任务，单项目上限 20，避免无界启动请求。
- 完成项目/任务固定 IPC 与侧栏交互；Electron Renderer 重载后真实恢复固定图标和任务排序，1320×840 浅色截图无错位。
- 固定阶段 `verify:ci`：28 个测试文件 121 项、覆盖率 80.57/68.67/85.15/87.66、2 项性能基准、类型、规范、脚本、workflow、许可证、构建和 bundle 预算全部通过。
- 接入稳定 `thread/goal/set|get|clear` 及 `thread/goal/updated|cleared`，Renderer 不依赖生成协议类型；跨客户端通知作为目标状态真源。
- 完成长期目标编辑、进行中/暂停/受阻/受限/完成状态、可选 token 预算、已用 token 与耗时卡片、清除确认；输入和数值均有 IPC 与领域双重边界。
- 官方 `@openai/codex` 0.147.0 隔离集成真实执行目标 set/get/clear，不调用模型；离线 Electron E2E 完成创建、暂停、显示和清除，1320×840 截图无溢出。
- 长期目标阶段 `verify:ci`：28 个测试文件 122 项、覆盖率 80.53/68.53/85.35/87.66、2 项性能基准、类型、规范、脚本、workflow、许可证、构建和 bundle 预算全部通过。
- 完成 `aster-code://project/<uuid>` 与项目关联任务深链接：拒绝路径、命令、凭据、未知参数、片段、超长输入和跨项目任务伪造；主进程、IPC 和 AgentService 三层保持数据库关联校验。
- 完成 macOS `open-url`、Windows/Linux `second-instance`、冷启动 argv 队列和最多 8 项去重边界；离线 Electron 真实发出单实例事件并恢复关联任务。
- electron-builder 注册 `aster-code`，目录包 `Info.plist` 实际含 URL scheme；`check:package` 将协议元数据与官方 Codex 0.147.0 runtime 一并作为发布守门。
- 深链接阶段 `verify:ci`：29 个测试文件 126 项、覆盖率 80.65/68.87/85.50/87.70、2 项性能基准、类型、规范、脚本、workflow、许可证、构建和 bundle 预算全部通过；任务生命周期 Electron E2E 与重新打包后的官方 Codex 0.147.0 packaged E2E 通过。
- 集成 electron-updater 6.8.9；仅签名且包含 `app-update.yml` 的 macOS/Windows 包启用，开发构建与普通内部包给出明确禁用原因。
- 完成更新检查/可用/下载进度/已下载/最新/取消/错误状态机、30 秒首检、6 小时间隔、用户确认下载、正常退出或立即重启安装；预发布、降级与 NSIS web installer 默认禁用。
- 设置增加应用更新页；开发 Electron E2E 与配置渠道 packaged E2E 分别验证禁用/启用状态，1320×840 浅色截图未见溢出。
- 完成只接受安全 HTTPS base URL 的 `package:update`；真实生成 macOS DMG、ZIP、blockmap、`app-update.yml` 与含 SHA-512 的 `latest-mac.yml`，测试 URL 使用保留 `.invalid` 域且未发布。
- 发布 workflow 只为要求签名的构建生成更新元数据；无签名内部构建保持无渠道，避免不可验证的升级产物。生产依赖审计为 0 已知漏洞，third-party notices 更新为 104 包。
- 自动更新阶段 `verify:ci`：31 个测试文件 137 项、覆盖率 80.81/69.35/85.41/87.77、2 项性能基准、类型、规范、脚本、workflow、notices、构建和 bundle 预算全部通过；配置渠道与普通无渠道两种目录包均通过 packaged E2E。
- 复核 Codex Security 发布链报告：报告来自旧提交 `685dc51` 的扫描快照；当前基线已用 40 位 SHA 固定所有远程 Action，并由 main-only、不可变 `github.sha`、禁用 checkout credential 与受保护 `release` environment 关闭手工发布越权路径；`check:workflows` 对这些不变量持续守门，当前无需追加修复。
- 实现 main `uncaughtExceptionMonitor`、Electron Renderer/utility 异常退出的 best-effort 本地记录；不改变默认崩溃退出语义，clean exit 不记录。
- 诊断 journal 限 256 KiB + 1 个轮转文件，内存与导出最多 100 条；用户通过系统保存对话框显式导出 0600 ZIP，Renderer 不能提供路径。
- ZIP 包含 manifest/SHA-256、崩溃元数据与最近 1 MiB 运行日志；字段密钥、自由文本密钥和绝对路径再次脱敏，不包含对话/项目文件，不自动上传。
- 诊断阶段 `verify:ci`：32 个测试文件 142 项、覆盖率 80.74/69.47/85.23/87.61、2 项性能基准、类型、规范、workflow、105 包 notices、构建和 bundle 预算全部通过；Electron 真实模拟 Renderer crash 计数，普通目录包与官方 Codex 0.147.0 packaged E2E 通过。
- 接入稳定 `permissionProfile/list`，直接启动随应用固定的官方 Codex 0.147.0 app-server，在隔离配置中真实取得非空 profile 目录及允许状态。
- 完成 `item/permissions/requestApproval` 反向请求闭环：有界解析网络、文件读写和路径/glob/special 条目，Renderer 只持有不透明选项 ID，主进程按原请求重建授权子集。
- 权限面板支持逐项选择、本回合/本会话范围和拒绝；伪造或未请求 ID 会失败关闭且保持原请求挂起，退出时返回协议有效的空授权。
- 离线 Electron E2E 真实展示网络与超长路径权限，取消一项文件读取后精确断言 app-server 仅收到其余授权；1320×840 界面无溢出。
- 权限阶段 `verify:ci`：32 个测试文件 144 项、覆盖率 80.83/69.21/85.37/87.69、2 项性能基准、类型、规范、脚本、workflow、105 包 notices、构建和 bundle 预算全部通过。
- 建立独立账户领域层，接入稳定 `account/read`、`account/login/start|cancel`、`account/logout`、`account/rateLimits/read` 及 updated/completed 通知；运行时重启会使未完成登录失败关闭。
- OpenAI API Key 只经最小 IPC 进入 app-server，不写入 Aster SQLite、快照或日志；错误即使回显原 Key 也会再次脱敏，Renderer 没有凭据读回能力。
- ChatGPT 浏览器与设备码 URL 仅允许 OpenAI/ChatGPT HTTPS 域；loginId 只保留在主进程，Renderer 不能伪造取消目标或任意外链；实验性外部 token 注入明确未启用。
- 直接启动随应用固定的官方 Codex 0.147.0，在隔离 `CODEX_HOME` 中真实完成假测试 Key 的 login/read/logout、浏览器登录 start/cancel；设备码在线取得官方 URL/代码并立即 cancel，未调用模型或污染用户凭据。
- 设置页完成账户状态、API Key、浏览器/设备码、取消/重开、退出、令牌刷新和 ChatGPT 用量窗口；离线 Electron E2E 验证 API Key 登录/退出及替身日志脱敏，1320×840 浅色截图无溢出。
- 认证阶段 `verify:ci`：33 个测试文件 152 项、覆盖率 80.48/69.11/84.96/87.22、2 项性能基准、类型、规范、脚本、workflow、105 包 notices、构建和 bundle 预算全部通过。
- 建立独立 GitHub 领域服务：从数据库项目根读取 Git 状态，解析 HTTPS/SSH GitHub 或 Enterprise 远端，分别建模 fork head 与 upstream base，并通过 `gh auth status`/`repo view`/`pr list --json` 完成只读预检。
- PR 创建必须由 UI 二次确认；主进程先用现有 Git 服务显式 push/set-upstream，再以完整 `--repo/--base/--head/--title/--body-file -` 无提示参数创建，正文只走 stdin，不出现在进程参数。
- 创建后不信任 `gh pr create` 文本输出，而重新读取结构化 PR 并校验 HTTPS host、owner/repository、编号和分支；同项目并发操作合并，重复调用返回既有 PR，不重复创建。
- `gh` 子进程环境收紧到系统、代理/证书和 GitHub 认证白名单；DeepSeek/OpenAI/任意环境密钥不会继承，CLI 输出限 1 MiB，普通操作 30 秒、创建 120 秒且错误脱敏。
- Git remote 快照在进入共享领域层前清除 URL userinfo、query 与 fragment；旧仓库即使把 token 写入远端 URL也不会向 Renderer 暴露。
- 单元测试覆盖 GitHub 登录、fork/upstream、恶意 PR URL、密钥脱敏、stdin、超时与输出边界；Electron E2E 用真实临时 Git 仓库、本地 bare remote 和 CLI 替身完成 Draft PR 闭环及重复调用，未访问真实 GitHub。
- 视觉检查覆盖 1320×840 完成态和 960×640 表单态；远端、登录、目标分支和 PR 卡片无明显溢出。
- GitHub PR 线上修复后最终 `verify:ci`：34 个测试文件 159 项、覆盖率 80.62/69.16/85.40/87.45、2 项性能基准、类型、规范、脚本、workflow、105 包 notices、构建和 bundle 预算全部通过；定向 Electron E2E 与生产依赖审计（0 已知漏洞）通过。
- 仓库级 Git 身份使用维护者的 GitHub noreply 地址；提交作者身份已核对一致，无需重写历史。
- 按用户授权创建独立 GitHub 仓库并首次推送完整 `main`；本地与远端提交一致。
- 首次真实桌面 PR 测试准确发现 GUI 最小 PATH 无法定位用户级 `gh`；已增加跨平台 CLI 发现（显式绝对路径、PATH、用户 bin、Homebrew、Windows 标准位置）并保留命令名回退。
- 第二次真实桌面测试已由 Aster 成功推送 `codex/github-pr-validation` 并创建 Draft PR #1，但创建后验证错误使用 `gh pr list --head owner:branch` 而未识别结果；改为纯分支过滤并严格匹配 `headRepositoryOwner.login`，避免重复创建和 fork 同名分支误认。
- 第三次真实 Electron 回归通过 Aster 自身重新读取测试 Draft PR，精确验证目标仓库、head/base、Draft 状态和同源 URL；重复创建在线返回 `created=false/pushed=false`，没有产生第二个 PR。
- 实际检查真实 PR 完成态截图：GitHub 登录、origin head/base、Draft 卡片和“在 GitHub 打开”在 1320×840 浅色界面无明显溢出或错位。
- 首次 GitHub Actions 远端运行准确暴露跨平台 notices 漂移：pnpm 将 Codex 与 `@napi-rs/canvas` 原生 alias 报告为不同的 `darwin-*`/`win32-*` 名称或版本，Windows checkout 还会物化 CRLF；生成器现规范化相同上游组件并以逻辑换行比较，macOS/Windows 输出保持确定性。
- CI 的 feature branch `push` 与 `pull_request` 双触发已收敛为仅 `main` push + PR，单次 PR 更新不再重复执行两组矩阵并发送重复通知；本地完整 `verify:ci` 再次通过。
- Windows PR runner 继续暴露出目标平台路径解析、工作树路径大小写、Codex launcher 子进程锁、CRLF、POSIX mode 断言和大小写环境变量等 7 类跨平台问题；产品代码与测试夹具已逐项修复，定向 21 项和本地完整 159 项回归通过。
- 私有免费仓库的 `main` ruleset/classic branch protection API 返回 GitHub 403；公开后必须立即建立主分支保护，步骤已写入开源发布检查表。
- Windows 远端 34 个测试文件已全部通过；随后性能夹具暴露出逐条造 3,000 条历史在 Windows 文件系统耗时约 58 秒，而实际查询/批量已读仅 418.5 ms。状态库现提供原子事务批量写入，新增回归后本地 160 项通过，3,000 条夹具与被测操作合计约 105 ms。
- 事务批量写入后的 Windows 远端 160 项、性能和生产构建通过；Electron 冒烟准确打开安全工作台，但测试定位器同时命中总览卡片与弹窗同名标题，现按语义 dialog 范围限定安全/计划任务断言。
- PR #1 最终 macOS/Windows 检查及合并后的 `main` 检查均通过；主分支运行 `31462134036` 两个平台为绿色，重复 PR workflow 邮件问题已关闭。
- 完成已有任务在 Local/托管 worktree 间的显式 Handoff：SQLite migration v9 持久化任务上下文，后续 `turn/start` 从主进程解析目标 cwd，Renderer 不能提交任意路径。
- Handoff 使用真实 Git stash OID 迁移已暂存、未暂存和未跟踪修改；目标必须干净，冲突时硬恢复原本干净的目标并把源修改还原，无法删除仍被任务引用的 worktree。
- 真实仓库自动测试完成 Local→worktree→Local、staged/unstaged/untracked 保真和冲突回滚；离线 Electron E2E 通过确认 UI 将已有任务与真实未提交修改交接到 detached worktree。
- Handoff 阶段本地完整回归为 34 个测试文件 166 项，覆盖率 80.76/69.13/85.28/87.78，类型、规范、workflow、许可证、性能、生产构建与 bundle 守门通过；定向生命周期 Electron E2E 通过。
- 所有本地/内部打包入口在构建前安全重建 `release`，避免旧包的更新元数据或其他产物污染新包；即使 `release` 被替换为符号链接，也只移除链接本身而不修改外部目标。
- 默认打包显式禁用 electron-builder 从 Git remote 推断发布渠道；只有 `package:update` 能在受控 HTTPS URL 校验通过后生成 generic 更新元数据，普通体验包保持无更新渠道。
- 2026-08-13 最新 Intel macOS 隔离体验包 `ba33d79` 真实验证：内置官方开源 `@openai/codex` 0.147.0，目录包与只读挂载 DMG 均通过 packaged E2E，私有 `codex-home` 为真实 `0700` 目录，DMG CRC 与 ZIP 全文件校验通过；DMG 为 263 MiB，SHA-256 `fb8e35f4199155432ee001d7a36c41e66ed215afeb9c58057dc66e2a73fbaa79`。
- Codex home 隔离后完整 `verify:ci`：36 个测试文件 172 项、2 项性能基准、覆盖率 80.95/69.46/85.46/87.95，类型、规范、脚本、workflow、许可证、生产构建和 bundle 预算全部通过。
- GitHub CI 于 2026-08-13 首次发现 GHSA-jmr9-qjv8-65gv：Codex Security 固定的 `extract-zip@2.0.1` 存在高危符号链接越界写入；公告所列 2.0.2 尚未发布，因此以 pnpm alias 替换为 Electron 官方兼容实现 `@electron-internal/extract-zip@1.0.5`，生产审计恢复 0 已知漏洞且 SDK 真实 preflight 通过。
- 将 Aster app-server 的 `CODEX_HOME` 固定到独立 Electron `userData/codex-home`（macOS 实际为 `~/Library/Application Support/aster-code/codex-home`）；登录、thread、MCP/技能用户配置不再与官方 Codex 桌面 `~/.codex` 联动，DeepSeek 热重载也不能覆盖该边界。
- 完成整文件可恢复丢弃：staged/unstaged/untracked/rename 内容与 index 保真，恢复点存入 `refs/aster/discards/<uuid>`、最多 32 个，跨应用重启保持，不占用或删除用户已有 stash；目标出现新修改时失败关闭。
- 完成 Git 面板丢弃确认、恢复历史与专属离线 Electron E2E；真实仓库跨重启恢复文件，单元测试覆盖用户 stash、rename 和占用目标。
- 修复内嵌浏览器覆盖任务和输入框：宽屏改为可拖动/键盘缩放的右侧分栏，窄屏自动底部停靠；1200×760 与 800×640 Electron 布局断言和截图通过。
- 本阶段完整 `verify:ci`：36 个测试文件 175 项、2 项性能基准，覆盖率 81.05/69.54/85.73/88.11，类型、规范、脚本、workflow、93 个生产组件声明、构建和 bundle 预算全部通过；Git/浏览器两项专属 Electron E2E 通过。
- PR #5 首轮 macOS 15 全绿；Windows 2025 准确发现 runner 全局 `core.autocrlf` 使恢复后的测试文本按平台转换为 CRLF，并因断言提前失败导致 SQLite 句柄阻塞临时目录清理。测试仓库现固定 `core.autocrlf=false` 验证字节保真，清理增加 Windows 有界重试；产品仍尊重用户仓库配置。
- 用户在试用 DMG 打开普通非 Git 文件夹时准确发现 `worktree:list` 冒泡 `fatal: not a git repository`；实地只读复核确认目标路径没有 `.git`。
- 工作树服务现将普通文件夹建模为 Local-only：列表返回空状态、创建给出可操作提示，普通 Codex 任务不受影响；真实非 Git Electron E2E 与截图不再出现红色错误。
- 完成工作树基线目录与选择器：最多 500 个 HEAD/本地分支/远端分支/标签，annotated tag 解析到 commit；UI 显示类型/ref/短 OID，创建时再次解析并匹配 expected OID，ref 移动失败关闭。
- SQLite migration v10 持久化所选 `base_ref` 与实际 `base_oid`；真实仓库从非当前 `release/base` 创建 detached worktree，实际 HEAD、旧版本文件和 UI 闭环均经自动测试。
- 本阶段完整 `verify:ci`：36 个测试文件 177 项、2 项性能基准，覆盖率 81.00/69.56/85.50/88.22，类型、规范、脚本、workflow、93 个生产组件声明、构建与 bundle 预算全部通过；两项专属 Electron E2E 与生产依赖审计（0 已知漏洞）通过。
- SQLite migration v11 增加持久化工作树交接事务；事务保存源/目标上下文、HEAD、工作树 tree、index tree、独立 `refs/aster/handoffs/<uuid>` 与阶段，不依赖或占用用户 stash 栈。
- Handoff 修改只有在任务→工作树关联落库成功后才清理恢复 ref；进程重启依据真实任务关联决定回滚源端或提交清理，不盲目重复 apply。
- 恢复前逐项核对源/目标 HEAD、工作树 tree 与 index tree；崩溃后的人工修改进入 `needsAttention`，保留恢复 ref、阻止工作树移除并在工作树面板提供安全重试，不执行破坏性清理。
- 真实 Git 测试覆盖 stash marker 尚未固化、目标已 apply 但任务仍在源端、目标在崩溃后又被人工修改三类窗口；Electron E2E 与 1320×840 截图验证恢复提示和重试不删除人工文件。
- 建立 Apache-2.0 `LICENSE`、NOTICE、贡献/支持/行为准则、Issue/PR 模板、CODEOWNERS、新手构建指南与公开发布检查表；README 加入真实且无个人路径的产品截图。
- Codex schema 同步默认改用锁定的 `@openai/codex` 0.147.0 项目依赖，生成清单不再记录本机路径或时间戳；稳定 schema/bindings 已重新生成并通过类型检查。
- 新增 `check:open-source` CI 守门，检查 21 项公共文件、协议版本、打包法律资源、个人绝对路径和测试目录外凭据形状值。
- 开源准备质量门：冻结安装、生产依赖审计（0 已知漏洞）、36 个测试文件 181 项、覆盖率 80.92/69.48/85.99/87.79、性能、类型、规范、构建、bundle、目录包与 packaged E2E 全部通过；真实 `.app` 内回读 LICENSE/NOTICE/第三方清单和官方 Codex 0.147.0 ready。

## 下一任务

1. 完成本轮工作树 Handoff 恢复的完整质量门与跨平台 CI。
2. 完善 DeepSeek/provider 专属限流、重试和 Web Search 活动展示。
3. 账户使用量恢复后补在线 E2E 和 Codex Security sealed 扫描。

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
- GitHub：CLI 只在主进程运行；head/base 远端由登记仓库状态重建，PR 描述走 stdin，显式 push 和用户确认后才允许外部写入，创建结果必须结构化回读验证且保持幂等。
- 安全扫描输出必须位于被扫描工作树之外，并使用私有权限目录。
- Codex Security 只接受 completed + sealed SDK 结果；cost limit、中断和 contract 失败保留失败状态，不展示部分 finding。
- Security validate/patch/false-positive/export 使用官方 CLI 参数数组；patch 必须显式确认，renderer 不能提交路径或命令。
- 计划任务由 Electron 主进程本地调度；不安装后台守护进程，也不伪装成 app-server/CLI 的计划任务 API。
- 计划任务崩溃后不重放活动 turn；应用重新启动只按 run-once/skip 策略处理下一次到期，避免重复副作用。
- 文件与媒体预览只接受项目相对路径；符号链接失败关闭，流式 token 短时有效且不泄露本地绝对路径。
- 本地网页使用独立临时 WebContentsView；只允许 loopback 导航/资源，权限、下载和弹窗失败关闭。
- 窗口状态只由主进程内部写入，恢复前必须验证显示器交集；Renderer 不能任意读写 app_settings。
- 深链接只承载数据库 UUID，不承载文件路径、命令或凭据；项目–任务关联在接收 URL 和执行打开动作时分别校验。
- 更新 URL 只在受保护发布构建时注入并固化进签名包；Renderer 无权读写 feed URL，未签名内部包不生成更新渠道。
- 诊断默认本地优先；不引入自动遥测、不保存内存 dump，只在用户明确导出时产生二次脱敏的有界 ZIP。
- 权限授权采用“原请求白名单 + Renderer 不透明 ID + 主进程重建”模式；UI 不能提交任意路径或扩大 app-server 请求，未选择项按协议视为拒绝。
- OpenAI/ChatGPT 凭据生命周期只委托稳定 app-server 账户 API；Aster 不自建 OAuth token 库、不启用内部 external-token 模式，loginId 与受信认证 URL 保留在主进程。

## 当前失败测试

当前无失败测试。工作树 Handoff 恢复阶段完整 `verify:ci` 通过：36 个测试文件 181 项、2 项性能基准，覆盖率 80.96/69.49/86.10/87.82，类型、规范、脚本、workflow、93 个生产组件声明、构建和 bundle 预算均通过；恢复/生命周期/非 Git 三项真实 Electron E2E 通过，生产依赖审计为 0 已知漏洞。上一 `main` 的 macOS 15/Windows 2025 CI 均绿色，本分支跨平台 CI 待提交后验证。

## 已知问题

- 开发环境仍可发现 ChatGPT 预发布 `0.147.0-alpha.6.5`，但发布包已固定并实际启动稳定 0.147.0；schema 继续按固定版本同步。
- Windows 只能在 CI 中构建验证，当前 macOS 环境不能完成 Windows 真机运行验证。
- 当前 bundle 预算基于 Intel macOS 构建；不同平台 chunk 哈希可不同，但 `check:bundle` 以生产 HTML 的真实入口资产计量。
- Codex Security 0.1.8 元数据固定 Codex SDK/runtime 0.144.6；发布包为避免额外约 270 MiB 原生副本统一使用 0.147.0，需在使用量/权限恢复后执行 packaged sealed 扫描确认兼容。
- 首个 thread 的自动标题依赖上游异步 metadata；已监听名称通知并在 turn 完成后刷新 thread/read。
- Codex Security standard 扫描即使仅 2 个目标文件也超过本次 $2 在线验证上限；提高预算前不能宣称真实 sealed 扫描完成。
- Stage 20 本地安全 diff 扫描完成源码、验证与攻击路径阶段，但 finalizer 拒绝 `/var` 符号链接形式扫描目录；按单次 finalization 规则保留为 unsealed 证据，不导入产品扫描历史。
- 自动更新尚无发布者实际控制的 HTTPS 源和平台签名证书；本机只验证元数据/状态机/包内启停，不能宣称真实跨版本升级完成。

## 当前阻塞

无项目级阻塞。在线模型回归暂受账户使用量限制，但安全、性能、打包和离线测试可继续。

## 外部依赖

- OpenAI/ChatGPT 凭据：在线 Codex 实测需要；缺失时使用协议测试替身。
- 当前 ChatGPT/Codex 使用量已耗尽，服务端提示 2026-08-16 11:32 恢复；在此之前只保留既有在线证据并继续离线验证。
- DeepSeek API Key：真实在线验证需要；缺失时使用本地 SSE 测试服务器。
- Codex Security 权限与模型费用：当前认证/运行链路可进入 discovery；完整扫描仍需足够费用上限，受保护请求还可能需要 Trusted Access。
- Apple/Windows 代码签名证书：仅影响最终签名、公证与商店发布。
- 自动更新发布域名/对象存储：源码已有私有 GitHub 远端，但尚无实际 HTTPS 更新源；跨版本更新需发布者提供域名并以同一平台签名身份构建两个版本。
- GitHub 远端已建立并由系统 keyring 中的维护者账户验证；Aster 不保存或显示其 token。
- GitHub 主分支保护：私有免费仓库当前不能启用；仓库切换为 Public 后必须按 `docs/OPEN_SOURCE_RELEASE_CHECKLIST.md` 立即建立 ruleset。

## 待验证问题

- app-server 崩溃后 persisted thread 的真实进程重新 resume 与订阅恢复语义（替身层已测试）。
- DeepSeek V4 Pro 分支 macOS/Windows 远端 CI；本地完整质量门、最小 Responses 和真实 app-server 工具闭环已通过。
