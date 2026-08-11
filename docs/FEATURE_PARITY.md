# 功能一致性表

状态枚举：尚未研究、尚未开发、开发中、已实现、已测试、部分实现、被公开技术限制、被私有服务阻塞、不适用。

“已实现”只表示存在真实闭环；“已测试”还要求自动测试或实际运行证据。当前为研究基线，不以页面或按钮替代功能。

| 领域 | 功能 | 状态 | 验证/限制 |
|---|---|---|---|
| 桌面基础 | macOS 应用启动 | 已测试 | Electron 43 开发 E2E、目录包及只读挂载 DMG 真机启动；包内 Codex 0.147.0 ready |
| 桌面基础 | Windows 应用启动 | 部分实现 | NSIS/图标/包内 runtime/packaged E2E 与 Windows 2025 workflow 已实现；目标系统首次运行待验证 |
| 桌面基础 | 单实例、深链接、窗口状态恢复 | 部分实现 | 单实例与 SQLite bounds/最大化/全屏安全恢复已测试；`aster-code://project/<uuid>` 与项目关联任务深链接具备严格解析、双重关联校验、冷启动队列、单实例 Electron E2E 和 macOS 包元数据验证；Windows/macOS 外部应用真实唤起待目标系统发布回归 |
| 桌面基础 | 自动更新 | 部分实现 | electron-updater 6.8.9 状态机、30 秒/6 小时检查、显式下载、退出/重启安装、进度/错误 UI、HTTPS 发布构建和真实 app-update/latest-mac SHA-512 元数据已测试；仓库尚无真实发布域名、macOS/Windows 签名身份，故跨版本安装为外部发布阻塞 |
| 桌面基础 | 深色/浅色/跟随系统 | 已测试 | system/light/dark 偏好、matchMedia 实时变化、重载恢复和深浅 E2E |
| 导航 | 项目、任务、计划任务、安全、设置导航 | 已测试 | 项目/任务、计划任务（含未读徽标）、五页安全工作台与提供商/MCP/技能/配置/应用五页设置工作台均经 Electron 回归 |
| 项目 | 打开真实本地目录 | 已实现 | 系统目录对话框、realpath 校验、SQLite 写入 |
| 项目 | 最近项目和固定项目 | 已测试 | 最近项目恢复/去重、SQLite 固定、固定优先排序和 Renderer 重载恢复均通过自动测试与 Electron E2E |
| 项目 | 多项目并存 | 已实现 | SQLite 项目列表与侧栏选择 |
| 项目 | 项目信任 | 已测试 | 默认不信任、SQLite 持久化、外部技能根目录信任门；单元与 Electron UI 通过 |
| 项目 | 项目指令 AGENTS.md | 已测试 | 安全预览 + app-server 原生解析；真实 turn 按临时仓库指令返回 `ASTER_INSTRUCTIONS_OK` |
| 对话 | 新建、读取、继续、重命名、固定、归档 | 已测试 | 真实 app-server 生命周期；重命名、活动/归档双视图、SQLite 固定与首屏补读、重载恢复均通过自动测试和 Electron E2E |
| 对话 | 删除任务 | 已测试 | 明确二次确认、活动 turn/挂起审批失败关闭、SQLite 关联清理和删除后列表重同步；官方 app-server 集成与 Electron E2E 通过 |
| 对话 | 对话搜索和分页 | 已测试 | `thread/list` cwd/searchTerm/opaque cursor、游标失效保护、分页合并和侧栏搜索/加载更多均通过自动测试 |
| 对话 | 分叉任务 | 已测试 | `thread/fork`、来源关联、项目关联、历史 hydration 和新任务选择；官方 0.147.0 集成与 Electron E2E 通过 |
| 对话 | 长上下文压缩 | 已测试 | `thread/compact/start`、活动 turn 保护和确认 UI 经协议替身/Electron E2E；真实模型压缩内容待账户恢复后复验 |
| 对话 | 重启后状态恢复 | 部分实现 | 项目→thread 关联持久化、thread/list/resume 与已完成历史 hydration 自动测试通过；真实进程重启 E2E 因账户使用量耗尽待复验 |
| 智能体 | Codex app-server stdio 生命周期 | 已测试 | 开发与打包 Electron 均真实自动启动；发布包优先使用官方 `@openai/codex` 0.147.0，而非 ChatGPT 私有安装 |
| 智能体 | 协议握手和版本匹配类型 | 已测试 | 真实握手；929 个生成文件和哈希 manifest |
| 智能体 | app-server 崩溃检测与恢复 | 已测试 | 真实子进程 JSONL 替身注入 exit 23：空闲连接恢复 ready，活动 turn 失败关闭且不重启/重放 |
| 智能体 | 流式文本、推理和活动时间线 | 已测试 | 真实在线 Codex 文本流 E2E；reducer 27 项测试覆盖乱序 delta 与 1 MiB 截断 |
| 智能体 | 命令、文件修改、工具调用活动 | 已测试 | 真实 `sleep` 命令、结构化 command 活动、apply_patch 文件落盘与内容断言 E2E 通过 |
| 智能体 | 追加指令/steer | 已测试 | 真实运行中命令接收 steer，最终返回 `ASTER_STEER_OK` |
| 智能体 | 停止/中断 | 已测试 | 真实 `sleep 20` turn 被 UI 中断，禁止的最终文本未产生；悬空 item 归一为 interrupted |
| 智能体 | 目标与长期任务状态 | 已测试 | 稳定 `thread/goal/set|get|clear`、updated/cleared 通知、目标/状态/token 预算/用量 UI；官方 Codex 0.147.0 集成与 Electron E2E 通过 |
| 智能体 | 多智能体/子任务显示 | 部分实现 | 领域事件与活动卡已实现；真实协作回归待补 |
| 审批 | 命令执行审批 | 部分实现 | 双向 request 挂起、IPC 决策与拒绝/一次/会话 UI 已测试；真实命令待验证 |
| 审批 | 文件修改审批 | 已测试 | read-only 沙箱真实触发审批，UI 明确允许后 apply_patch 落盘且内容精确匹配 |
| 审批 | MCP/应用工具审批 | 部分实现 | 直接工具调用显式确认、MCP elicitation 与 permissions 挂起/取消已测试；应用专属审批待公开稳定接口 |
| 审批 | 用户输入请求 | 已测试 | `item/tool/requestUserInput` 挂起、选项/自由文本/秘密输入与退出取消有自动测试 |
| 沙箱 | 只读/工作区写入/完整访问 | 部分实现 | workspace-write 和 read-only 已真实验证；danger-full-access 与设置 UI 待补 |
| 沙箱 | 网络与路径权限 | 已测试 | 官方 0.147.0 `permissionProfile/list` 真实集成；网络/文件读写/path/glob 权限反向审批、逐项子集、turn/session、拒绝与伪造 ID 失败关闭均经单元和 Electron E2E |
| 模型 | OpenAI API Key 登录 | 已测试 | 官方 0.147.0 隔离 login/read/logout、主进程脱敏状态机和 Electron 登录/退出闭环；Key 不进入 Aster 持久化、快照或日志，真实计费请求沿用既有 OpenAI 在线回归证据 |
| 模型 | ChatGPT 浏览器/设备码登录 | 已测试 | 官方浏览器 start/cancel 与在线设备码 URL/code/cancel 已验证；HTTPS 域白名单、主进程 loginId、completed/updated、重开/取消和令牌刷新有自动测试，最终用户授权仪式需用户本人完成 |
| 模型 | 模型列表与推理强度 | 已测试 | 真实 model/list、模型/effort 选择器及在线任务 E2E 通过 |
| 模型 | 自定义 Responses provider | 已测试 | 进程级 `-c` provider 注册，不污染用户全局配置；DeepSeek 真实闭环通过 |
| DeepSeek | 一级提供商配置 | 已测试 | 模型选择、provider 路由、设置状态和 app-server Responses 真实运行 |
| DeepSeek | 安全保存 API Key | 已测试 | Electron safeStorage + 0600 原子文件；renderer 不可读回；环境密钥优先 |
| DeepSeek | 官方 Responses API 流式连接 | 已测试 | 桌面经 app-server 真实收到 reasoning、工具和最终文本事件 |
| DeepSeek | 工具调用与文件修改闭环 | 已测试 | custom apply_patch 创建文件，精确断言 `DEEPSEEK_TOOL_OK\n` |
| DeepSeek | 推理能力/强度映射 | 已测试 | none/low/high/max 能力注册；真实 low reasoning 活动通过，不宣称 summary |
| DeepSeek | 图片、网络能力展示 | 部分实现 | 设置页明确图片/文件否、Web Search 是；搜索逐调用 UI 与真实回归待补 |
| DeepSeek | 错误、限流、重试和取消 | 部分实现 | 通用 turn 错误/取消路径可用；provider 专属限流分类和重试 UI 待补 |
| Git | 状态、分支、远端 | 已测试 | porcelain v2 NUL、branch/upstream/ahead/behind/remotes；真实仓库与桌面 UI 通过 |
| Git | stage/unstage/revert 文件和区块 | 部分实现 | 文件 stage/unstage、区块 stage/unstage/revert 已真实测试；整文件 recoverable discard 待文件工作台 |
| Git | commit/push | 已测试 | 桌面真实 commit；本地 bare remote 真实 push/set-upstream 测试 |
| Git | 创建 PR | 已测试 | GitHub CLI 登录/远端/fork-upstream 预检、显式 push、Draft/正式 PR、结构化 URL 回读、重复创建幂等和 960×640 Electron 闭环通过；真实线上仓库将在首个私有远端创建后验证 |
| Git | 大型仓库增量刷新 | 部分实现 | 单次状态有 8 MiB 边界和手动刷新；文件监听/增量策略待性能阶段 |
| 工作树 | 创建托管 detached 工作树 | 已测试 | 仓库外 userData 托管根、默认 detached、可选显式分支；真实仓库/E2E 通过 |
| 工作树 | 本地与工作树 Handoff | 部分实现 | Local/Worktree composer 上下文切换和新任务 cwd 已实现；已有 turn/未提交修改 Handoff 待补 |
| 工作树 | 分支占用冲突检测 | 已测试 | 显式分支被其他 worktree 占用时真实 Git 拒绝，错误返回 UI |
| 工作树 | `.worktreeinclude` | 已测试 | 仅 ignored+glob 匹配+普通文件；排除规则、10/100 MiB 边界与路径约束 |
| 工作树 | 快照、恢复和清理策略 | 部分实现 | SQLite 恢复、missing、lock/unlock、安全 remove 已实现；未提交快照/Handoff 待补 |
| 差异 | 文件树和 unified/split diff | 已测试 | working/staged、准确新旧行号、unified/split 及浅色真实桌面截图通过 |
| 差异 | 大 diff 虚拟化 | 部分实现 | 200 文件、2 MiB/文件、16 MiB 总量、截断禁用操作与离屏 hunk `content-visibility`；单个超长 hunk 行窗口待性能阶段 |
| 差异 | 行内评论并发送给智能体 | 已测试 | E2E 选择新增行，携带文件/行号/hunk/代码上下文真实追加并收到 `ASTER_REVIEW_OK` |
| 差异 | 区块 stage/revert | 已测试 | 主进程不透明快照、`git apply --check`、单次失效；真实 stage/unstage/revert 与桌面 hunk stage 通过 |
| 终端 | 每任务 PTY 终端 | 已测试 | app-server `command/exec` PTY，按项目/工作树/任务绑定；xterm 真实键盘 E2E |
| 终端 | 输入、调整尺寸、中断、退出 | 已测试 | write/resize/terminate/close 真实桌面回归；不依赖 node-pty 原生 ABI |
| 终端 | 输出环形缓冲和脱敏 | 已测试 | main/renderer 各 4 MiB、10k scrollback、跨分片 UTF-8；共享上下文移除 ANSI/OSC/C0 |
| 终端 | app-server 读取当前终端输出 | 已测试 | 用户显式共享最近 32 KiB，真实 `turn/start` 后收到 `ASTER_TERMINAL_CONTEXT_OK`；不静默泄露输出 |
| 文件 | 文件树、文本与代码预览 | 已测试 | 项目/worktree 根绑定、500 项目录、2 MiB UTF-8、无扩展名检测；单元及真实文本 E2E |
| 文件 | 图片、音频、视频、PDF 预览 | 部分实现 | 图片自定义协议真实解码；音视频/PDF UI、MIME、Range/HEAD/206/416 已测试，真实格式矩阵待最终回归 |
| 文件 | 产物链接和外部打开 | 已测试 | fileChange 直达真实文本产物；确认式系统打开、可执行/脚本拒绝和路径边界单测 |
| 浏览器 | 本地网页预览 | 已测试 | 独立临时 WebContentsView、无 preload/Node、loopback 顶级与子资源策略；真实 HTTP E2E |
| 浏览器 | 导航、刷新、开发日志 | 已测试 | 地址/前后退/刷新/停止/外部打开、标题/加载/错误、500 条控制台；真实导航/后退/console 回归 |
| 浏览器 | 通用 Computer Use | 被私有服务阻塞 | 只采用公开可调用能力，不伪造 |
| MCP | 服务器列表、状态、启停 | 部分实现 | 真实 app-server inventory/reload、工具/资源展示已测试；启停需受控 MCP 配置编辑 |
| MCP | OAuth 登录和重认证 | 已实现 | OAuth URL 协议校验、外部打开与完成通知；真实账户登录等待外部服务器 |
| MCP | 工具审批和 elicitation | 已测试 | server/thread/tool inventory 约束、显式确认、真实 `node_repl` 调用；elicitation 替身闭环 |
| 技能 | 按项目发现、刷新、详情 | 已测试 | skills/list/changed/config/write、作用域/依赖/错误、额外根目录与信任门 |
| 插件 | 市场、安装、卸载和详情 | 被公开技术限制 | 当前官方 app-server 明确标注相关生产 API under development / 不应由生产客户端调用 |
| 设置 | 模型、推理、权限、外观 | 部分实现 | 工作台覆盖 OpenAI/ChatGPT/DeepSeek、MCP、技能、审批/沙箱/Web Search，并真实展示账户用量与权限 profile；快捷键重映射待补 |
| 设置 | 配置层级和原始 TOML | 部分实现 | 用户/项目/系统/托管层和 requirements 已测试；只开放枚举化原子写入，不提供任意 TOML 覆盖 |
| 设置 | 快捷键和命令面板 | 部分实现 | 平台化核心快捷键、搜索/键盘命令面板与真实动作 E2E；用户自定义重映射待补 |
| 计划任务 | 创建、编辑、暂停、删除 | 已测试 | SQLite 持久化、运行中删除保护、删除保留历史；单元与 UI 创建回归通过 |
| 计划任务 | RRULE/间隔和时区 | 已测试 | `rrule` 2.8.1、IANA 墙上时间换算、无效规则/时区边界；Asia/Shanghai 自动测试 |
| 计划任务 | 本地/隔离工作树执行 | 部分实现 | Local 真实 app-server E2E 通过；托管 worktree 与计划执行均已接入，专属在线组合回归待补 |
| 计划任务 | 运行历史、未读、重试 | 已测试 | 收件箱、成功/失败/取消/跳过、未读、1–4 次退避、敏感错误脱敏和崩溃不重放 |
| 安全 | 安全总览 | 已测试 | 总览/扫描/漏洞/仓库/设置五页工作台；Electron 浅色 1320×840 真机截图通过 |
| 安全 | 普通仓库/路径扫描 | 部分实现 | 官方 SDK 真实进入 discovery；本次受 $2 硬预算中断，未把部分产物标记完成；sealed 成功/失败由自动替身覆盖 |
| 安全 | 深度扫描 | 部分实现 | SDK deep 参数、目标约束和 UI 已接入；真实 deep 扫描尚受模型费用约束 |
| 安全 | commit/工作区 diff 扫描 | 部分实现 | `DiffTarget.refs/workingTree` 已接入且深度模式本地拒绝；真实在线 diff 扫描待有界验证 |
| 安全 | 预检、预算、取消、进度 | 已测试 | 真实 SDK preflight、Python/账户诊断和 $2 cost-limit 终止；AbortSignal/进度/费用/Trusted Access 回调自动测试 |
| 安全 | 漏洞证据、严重程度、攻击路径 | 已测试 | sealed findings 映射、证据/位置/验证/攻击路径 UI 与持久化自动测试；真实扫描未完成所以当前没有伪造漏洞 |
| 安全 | 验证、修复、修复验证、误报 | 部分实现 | 官方 CLI validate/patch/false-positive 安全参数数组适配与显式确认已实现；需真实 completed finding 做在线闭环，修复验证可重扫 |
| 安全 | 历史、报告、JSON、CSV、SARIF 导出 | 已测试 | SQLite 独立历史、固定产物路径、2 MiB 预览、CLI JSON/CSV 与 SDK SARIF；自动测试通过 |
| 安全 | 无权限时可诊断降级 | 已测试 | 区分认证、插件/Python、Security access、Trusted Access、cost limit；失败不产生 completed/result |
| 安全 | 依赖、IPC、预览与子进程环境加固 | 已测试 | 生产 audit 0 漏洞；PDF.js 高危已覆盖修复；非主 Renderer IPC 对抗、文件身份绑定和环境白名单回归通过 |
| 可观测性 | 结构化日志与敏感信息脱敏 | 已测试 | 递归脱敏 7 项单测；有界轮转已测试 |
| 可观测性 | 崩溃报告与诊断包 | 已测试 | main/Renderer/utility 异常退出本地有界记录；用户明确导出私有 ZIP，只含版本摘要、100 条内崩溃元数据和 1 MiB 二次脱敏日志；不自动上传、不包含对话/项目/密钥/绝对路径 |
| 性能 | 首屏加载和代码分割 | 已测试 | 首屏 JS 由 1,204.97 kB 降至 643.29 kB；终端与六个低频工作台按需加载，生产 bundle 预算进入 CI |
| 性能 | 长活动、计划历史和有界缓存 | 已测试 | 5,000 活动/2,000 delta 与 3,000 SQLite 运行基准通过；离屏活动跳过布局，终端/日志/diff 均保持硬预算 |
| 性能 | 冷启动和进程内存 | 已测试 | Intel macOS 全新 profile 实测首屏 2.15 s、DOMContentLoaded 345 ms、4 进程总工作集 307.1 MiB |
| 测试 | 单元、集成、E2E、桌面冒烟 | 部分实现 | 33 个测试文件 152 项及 V8 全局门槛；官方 Codex 0.147.0 无模型 account/thread/goal/permission-profile 集成、离线 Electron 生命周期/固定/深链接/更新/崩溃诊断/权限审批/账户、配置渠道与普通目录包、挂载 DMG E2E 通过；Windows CI/真机与在线账户恢复待执行 |
| 发布 | macOS 打包/签名/公证流程 | 部分实现 | 独立图标、hardened runtime、entitlements、DMG/ZIP、CRC/解压/SHA-256 与挂载启动已测试；main-only immutable SHA + protected environment + pinned Actions 已加固；Developer ID 与公证凭据外部阻塞 |
| 发布 | Windows 打包/签名流程 | 部分实现 | x64/arm64 Codex optional 包、交互式 per-user NSIS、签名 secrets 守门、Authenticode 验证和 Windows 2025 workflow 已实现；真机、证书与 SmartScreen 待外部验证 |
