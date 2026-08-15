# Codex Security 工作台

## 运行时边界

Norevinq 固定使用公开 `@openai/codex-security` 0.1.11。该包内置 Codex SDK/可执行文件 0.144.6，并和桌面任务所用的 app-server 0.147.x 分开运行，避免协议与依赖提升互相影响。

上游 0.1.11 的外部提供商白名单只包含 OpenRouter、Fireworks 和 Bedrock，即使 `codexOverrides` 接受 `model_providers`，运行时也会删除其他 provider。Norevinq 因此在 Apache-2.0 许可范围内应用最小公开补丁 `patches/@openai__codex-security@0.1.11.patch`：加入固定 DeepSeek Responses 定义、实例级环境隔离和只读 token usage 回调，并确保传给 Python workbench 的环境继续剔除模型 API Key。补丁不改变技能、sealed contract、finding schema、沙箱或产物校验；仅在 Deep Scan 提示中增加 fail-closed 约束：缺少官方协调工具时必须立即停止，不能用手工 discovery 或手写 canonical 产物代替。该差异由 lockfile、NOTICE、自动测试和开源检查共同审计，不能描述为上游原生未修改能力。

SDK 官方运行 profile 必须保留 `:root=read`、`:workspace_roots=write`：前者让扫描智能体读取用户选择的本地仓库，后者只允许向 SDK 选定的私有扫描工作目录写入 draft/sealed 产物。2026-08-15 曾发现 Norevinq 补丁误把两者改为 `:minimal=read`、`:workspace_roots=read`，导致模型只能尝试公共网络回退且无法创建 `scan-manifest.json`、`findings.json`、`coverage.json`。该覆盖已删除，并由安装依赖权限单测和全新上游 tarball 补丁重放检查防止复发。此处恢复的是上游官方权限边界，不是给模型增加任意本机写权限。

SDK state、凭据 home 和扫描产物均位于 Electron `userData/security` 下。目录在 macOS/Linux 强制为 `0700`，扫描输出固定为 `security/scans/<scan-id>`，不会写入被扫描仓库。

macOS 正式包的实际默认路径如下：

- Norevinq 主智能体目录：`~/Library/Application Support/norevinq/agent-home`；
- Security SDK state：`~/Library/Application Support/norevinq/security/sdk-state`；
- Security 扫描产物：`~/Library/Application Support/norevinq/security/scans/<scan-id>`。

发布包把 SDK 的 `_bundled_plugin` 显式复制到 `app.asar.unpacked/node_modules/@openai/codex-security/_bundled_plugin`，因为 SDK 会对插件根执行 `realpath`，不能从 ASAR 虚拟目录运行。包内审计会验证该目录不是符号链接、没有越过 resources 边界，并回读 `.codex-plugin/plugin.json`；主进程只向 SDK 传入这一精确路径。

Finder/启动台启动的桌面应用不保证系统 `PATH` 中存在裸命令 `node`，而官方 plugin 0.1.19 的 `.mcp.json` 正是以该命令启动深度扫描协调器。Norevinq 启动时把官方插件复制到私有 `security/sdk-state/plugin-runtime`，只做两项可审计的发布适配：将 MCP command 固定为当前应用内置的 Electron Node 可执行文件，并将 `DEEPSEEK_API_KEY` 加入 MCP 显式转交白名单，使协调器创建的 discovery worker 能读取本次 SDK 实例的凭据。适配后的本地插件版本标记为 `0.1.19-norevinq.1`，不会修改签名应用包或冒充上游原版。Deep Scan 在进入 SDK 模型调用前还会真实执行 MCP initialize + tools/list；若 `start_codex_security_deep_scan` 不存在，扫描以 `deep_mcp_unavailable` 失败，并明确保证尚未产生模型费用。

Norevinq 启动主 app-server 时把独立 `agent-home` 作为上游兼容变量 `CODEX_HOME`，启动 Security SDK 时设置独立 `CODEX_SECURITY_STATE_DIR`。默认配置不会读取、覆盖或清理官方 Codex 常用的 `~/.codex`，主 app-server 与 Security SDK 的 Codex 版本也在不同进程和依赖树中。不要手动把 `NOREVINQ_AGENT_HOME` 指向 `~/.codex`，否则会主动取消这层隔离。

路径隔离不代表可以同时修改同一工作区：Norevinq、官方 Codex 或其他 Git 工具若并发操作同一个真实仓库，仍可能产生普通的文件、索引、分支或锁冲突。项目内 `.codex` 和 `AGENTS.md` 也是仓库内容，会被两个客户端共同看到。建议并行任务使用不同托管工作树，不要在同一工作树同时执行两个写入型智能体。

## 工作流

1. “诊断运行时”解析 SDK/插件/Codex 版本、Python 3.10+ 和隔离账户状态；不读取或回传凭据。
2. “本地预检”只验证仓库、目标、模式、认证选择、模型和输出目录，不启动模型或产生扫描历史。
3. 普通扫描支持仓库、相对路径、working tree 和 refs；深度扫描仅允许仓库或路径。
4. 扫描回调持续记录 phase、文件进度、活动、费用和 Trusted Access；同一应用实例只允许一个扫描，避免费用和资源并发失控。
5. 取消使用 `AbortSignal`。cost limit、认证、Security access、Python、插件、contract 和输出目录错误分别分类。
6. 只有 SDK 返回完整 `ScanResult` 且 sealed contract 验证通过后，才保存 finding/coverage/report/SARIF 元数据。
7. 扫描前可选择中文或英文报告语言；语言指令在扫描开始前传入，不会在 sealed 后改写产物。完成结果可经系统保存对话框导出报告、JSON、CSV 或 SARIF，Renderer 不能自行指定任意写入路径。

## DeepSeek 与费用

- 扫描页可选择 OpenAI/ChatGPT 或经 Norevinq 0.1.0 在线兼容性验证的 DeepSeek V4 Flash/V4 Pro。DeepSeek 只读取环境或系统加密保险库中的 `DEEPSEEK_API_KEY`，为每次预检/扫描创建独立 SDK 实例，不登录 OpenAI，也不把 Key 放入公共 config、SQLite、日志或 Renderer。Security 强制复用 Norevinq 已验证的 0.147.0 二进制；运行时未就绪时在产生费用前失败。
- SDK 的 DeepSeek 运行时固定为 `base_url=https://api.deepseek.com`、`wire_api=responses`、`supports_websockets=false`。任意自定义 URL 不向界面开放。
- 实时卡显示累计输入 token、缓存命中、缓存未命中、输出 token、其中的推理 token，以及美元/人民币估算。计费按 usage 增量累计，跨越计价时段时不会用新价格重算旧 token。
- 2026-08-16 16:00 UTC 前使用官方当前价格；之后按官方 01:00–04:00、06:00–10:00 UTC 高峰和其余非高峰价格自动选择。价格版本和时段显示在 UI。
- USD/CNY 每次扫描通过 Frankfurter 的 ECB 参考汇率只读接口获取，不发送仓库、模型请求或身份信息；5 秒不可用时使用带日期标识的最后验证备用值。金额是估算，最终以 DeepSeek 控制台实际账单为准。
- 上游 SDK 未提供 DeepSeek 价格表，故不能可靠执行其原生 `maxCostUsd` 硬中止。DeepSeek 模式明确禁用该输入，不把人民币估算伪装成强预算控制。
- 计费表来源：[DeepSeek 官方模型与计费](https://api-docs.deepseek.com/quick_start/pricing/)；汇率来源：[Frankfurter API](https://frankfurter.dev/)。

## 漏洞与产物

- 漏洞页显示 SDK 结构化严重程度、置信度、CWE、位置、代码证据、验证、攻击路径、修复和预防控制。
- 报告、manifest、findings、coverage 和 SARIF 只能通过固定枚举读取；realpath 必须仍在对应 scan root 内。
- renderer 每次最多接收 2 MiB，超出时明确显示截断。
- JSON/CSV/SARIF 生成使用官方 CLI；报告及所有结构化格式通过主进程固定枚举读取，再由系统保存对话框复制到用户选择的位置。validate、patch、false-positive 同样使用参数数组，不解析 TUI 文字作为运行协议。
- patch 会修改仓库，UI 必须二次确认；false-positive 必须提供原因。修复验证通过重新扫描形成新结果，不覆写旧 sealed 记录。

## 当前在线验证

- SDK metadata、Python 3.12、ChatGPT 登录与真实 repository/path preflight 已通过。
- 修复本地权限 profile 后，DeepSeek V4 Flash 对一文件真实 Git 仓库的 standard 扫描于 151.98 秒返回完整 `completed + sealed`；SDK 成功读取仓库、写入 draft 产物并完成最终密封。该测试不代表 2,117 文件仓库已重新付费扫描。
- 对 `src/main/security` 的真实 standard scan 成功进入 discovery，但因设置的 2 美元硬上限在估算 $2.010621 时中断。
- 中断产物没有 sealed，因此没有被导入、展示为漏洞或标记完成。这是预期的预算安全行为。
- completed finding 的 UI/持久化、取消、错误、报告和导出使用官方数据形状的自动测试覆盖；下一次在线完成扫描需要明确提高模型费用上限。
- Security SDK 自带的 Codex 0.144.6 已通过固定 provider 直接调用 DeepSeek V4 Pro Responses 并返回精确探测文本，未使用 OpenAI 登录或 OpenAI API Key。
- 同一 SDK、补丁和一文件仓库夹具的 V4 Pro standard 在线扫描在约 12 分钟内返回完整 `completed + sealed` 结果，token usage 回调非空。V4 Flash 在 SDK 内置 0.144.6/并发组合下的两次早期对照分别出现密封后修改 manifest、以及生成密封产物后未及时返回；这不能单独归因于模型。将运行时固定为 Norevinq 0.147.0、并发限制为 1 后，Flash 同一夹具在 160.9 秒完成并通过 SDK `completed + sealed` 校验，usage 非空。产品因此重新开放 Flash，但保持串行审计以规避已观察到的收敛竞态。
- 2026-08-15 的发布态故障复盘确认：深度扫描父智能体没有获得 `start_codex_security_deep_scan`，原因是 GUI 环境找不到插件清单中的裸 `node`；修复第一层后又发现协调器环境白名单未转交 `DEEPSEEK_API_KEY`。完成内置 Node 启动器、凭据白名单与零 token MCP 前置验证后，DeepSeek V4 Flash 对一文件仓库真实执行 discovery worker、dedup、父级报告和 SDK 密封，协调器清单为 `succeeded`，最终扫描为 `completed + sealed`，报告、findings、coverage、manifest 与 SARIF 均存在。该闭环用时约 338 秒。
- `0.1.x` 仍是预览版。对不完全信任的仓库，正式的扫描沙箱与权限边界复验完成前，不应把安全工作台当作强隔离执行环境。
