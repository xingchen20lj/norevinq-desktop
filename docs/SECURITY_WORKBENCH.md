# Codex Security 工作台

## 运行时边界

Aster Code 固定使用公开 `@openai/codex-security` 0.1.8。该包内置 Codex SDK/可执行文件 0.144.6 与 plugin 0.1.15，和桌面任务所用的 app-server 0.147.x 分开运行，避免协议与依赖提升互相影响。

SDK state、凭据 home 和扫描产物均位于 Electron `userData/security` 下。目录在 macOS/Linux 强制为 `0700`，扫描输出固定为 `security/scans/<scan-id>`，不会写入被扫描仓库。

macOS 正式包的实际默认路径如下：

- Aster 主 Codex home：`~/Library/Application Support/aster-code/codex-home`；
- Security SDK state：`~/Library/Application Support/aster-code/security/sdk-state`；
- Security 扫描产物：`~/Library/Application Support/aster-code/security/scans/<scan-id>`。

Aster 启动主 app-server 时强制设置独立 `CODEX_HOME`，启动 Security SDK 时设置独立 `CODEX_SECURITY_STATE_DIR`。默认配置不会读取、覆盖或清理官方 Codex 常用的 `~/.codex`，主 app-server 与 Security SDK 的 Codex 版本也在不同进程和依赖树中。不要手动把 `ASTER_CODEX_HOME` 指向 `~/.codex`，否则会主动取消这层隔离。

路径隔离不代表可以同时修改同一工作区：Aster、官方 Codex 或其他 Git 工具若并发操作同一个真实仓库，仍可能产生普通的文件、索引、分支或锁冲突。项目内 `.codex` 和 `AGENTS.md` 也是仓库内容，会被两个客户端共同看到。建议并行任务使用不同托管工作树，不要在同一工作树同时执行两个写入型智能体。

## 工作流

1. “诊断运行时”解析 SDK/插件/Codex 版本、Python 3.10+ 和隔离账户状态；不读取或回传凭据。
2. “本地预检”只验证仓库、目标、模式、认证选择、模型和输出目录，不启动模型或产生扫描历史。
3. 普通扫描支持仓库、相对路径、working tree 和 refs；深度扫描仅允许仓库或路径。
4. 扫描回调持续记录 phase、文件进度、活动、费用和 Trusted Access；同一应用实例只允许一个扫描，避免费用和资源并发失控。
5. 取消使用 `AbortSignal`。cost limit、认证、Security access、Python、插件、contract 和输出目录错误分别分类。
6. 只有 SDK 返回完整 `ScanResult` 且 sealed contract 验证通过后，才保存 finding/coverage/report/SARIF 元数据。

## 漏洞与产物

- 漏洞页显示 SDK 结构化严重程度、置信度、CWE、位置、代码证据、验证、攻击路径、修复和预防控制。
- 报告、manifest、findings、coverage 和 SARIF 只能通过固定枚举读取；realpath 必须仍在对应 scan root 内。
- renderer 每次最多接收 2 MiB，超出时明确显示截断。
- JSON/CSV/SARIF 导出使用官方 CLI；validate、patch、false-positive 同样使用参数数组，不解析 TUI 文字作为运行协议。
- patch 会修改仓库，UI 必须二次确认；false-positive 必须提供原因。修复验证通过重新扫描形成新结果，不覆写旧 sealed 记录。

## 当前在线验证

- SDK metadata、Python 3.12、ChatGPT 登录与真实 repository/path preflight 已通过。
- 对 `src/main/security` 的真实 standard scan 成功进入 discovery，但因设置的 2 美元硬上限在估算 $2.010621 时中断。
- 中断产物没有 sealed，因此没有被导入、展示为漏洞或标记完成。这是预期的预算安全行为。
- completed finding 的 UI/持久化、取消、错误、报告和导出使用官方数据形状的自动测试覆盖；下一次在线完成扫描需要明确提高模型费用上限。
- `0.1.0` 仍是预览版。对不完全信任的仓库，正式的扫描沙箱与权限边界复验完成前，不应把安全工作台当作强隔离执行环境。
