# 安全审计与加固记录

审计日期：2026-08-11，生产依赖复审于 2026-08-13。范围为当前仓库生产源码、Electron 配置、IPC、文件/浏览器边界、子进程、凭据、生产依赖和发布流水线。

## 方法与限制

- 执行 `pnpm audit --prod --audit-level low`，并在修复后复扫。
- 逐项追踪 Renderer → preload → IPC → 主进程敏感操作，以及仓库/模型/MCP/app-server → 文件、进程、网络和持久化的路径。
- 运行定向单元/集成测试和一个不调用模型的 Electron 对抗测试。
- 使用 Codex Security plugin 0.1.18 对 Stage 20 working-tree diff 完成七个安全相关文件的 discovery、候选验证和攻击路径校准；两个 release workflow 问题 survives validation，修复见下文。
- 扫描的 unsealed `scan-manifest.json`、`findings.json`、`coverage.json` 和全部逐文件收据已生成，但 finalizer 拒绝 macOS `/var` 符号链接形式的扫描目录（要求 canonical non-symlink directory）。按扫描流程的单次 finalization 规则未重试，因此本文件不把该次扫描称为 sealed。在线 SDK sealed 扫描仍受账户使用量/费用限制。

## 已验证并修复

### 中：任意 dispatch ref 可使用发布签名凭据

手动发布 workflow 原先没有 ref 守门或 protected environment，`workflow_dispatch` 可让具有仓库写权限的账号选择未审阅 ref，并让该 ref 的 `package:*` 脚本继承 macOS/Windows 签名凭据。攻击路径把普通写权限提升为发行者签名/公证身份使用权，校准为中危/P2。

现在 package job 只允许 `refs/heads/main`，checkout 明确绑定触发时的 `github.sha` 并关闭凭据持久化；job 使用 `release` environment，发布文档要求独立 reviewer、禁止 self-review 和仅允许受保护 main。`require_signing=false` 时签名变量显式为空，Windows signed build 还会逐 installer 验证 Authenticode。

### 低：GitHub Actions 使用可变 major 标签

发布与 CI 原先使用 `actions/checkout@v7` 等可移动标签。若上游 publisher/tag 被控制，前置 Action 可持久化修改 runner 后在签名步骤取密，上传 Action 也可控制本地校验后的 artifact；需上游控制和合法 manual dispatch，因此校准为低危/P3，不声称任何当前上游已被攻破。

所有 checkout、pnpm setup、Node setup 和 artifact upload callsite 现固定到经上游 tag 解析的完整 40 位提交 SHA。`scripts/check-workflows.mjs` 进入本地与 CI 质量门，自动拒绝浮动 Action ref，并守护 main/ref/environment/签名验证配置。

### 高：Codex Security 的 PDF.js 传递依赖漏洞

`@openai/codex-security@0.1.8` 固定 `pdfjs-dist@5.6.205`，命中 GHSA-hq66-cqwq-w95j（恶意 PDF 任意 JavaScript 执行）。工作区使用 pnpm override 固定到已修复的 `6.2.108`；Node 24 满足其引擎要求。复扫结果为 `No known vulnerabilities found`，SDK 服务测试、构建与本地预检路径继续通过。

### 高：Codex Security 的 extract-zip 传递依赖漏洞

2026-08-13 npm 审计新增 GHSA-jmr9-qjv8-65gv：`@openai/codex-security@0.1.8` 固定的 `extract-zip@2.0.1` 对符号链接目标缺少完整验证，恶意 ZIP 可在解压根外写入。公告把修复版标为 `2.0.2`，但 npm registry 当时尚未发布该版本；项目没有降低审计阈值，而是用 pnpm alias 精确替换为 Electron 官方、带 npm provenance 的兼容实现 `@electron-internal/extract-zip@1.0.5`。生产审计恢复为 `No known vulnerabilities found`，Codex Security 0.1.8 真实 preflight、169 项回归与 macOS/Windows CI 作为兼容性守门。

### 中：IPC handler 未统一验证调用 WebContents

所有 payload 已有 Zod 校验，但过去任何能获得 `ipcRenderer` 的同应用 WebContents 都可调用主进程 handler。现在每个 handler 先验证调用者恰为当前主窗口顶层 frame。离线 Electron 对抗测试创建故意开启 Node 的第二 Renderer：主窗口 bootstrap 成功，第二 Renderer 被 `Unauthorized IPC sender` 拒绝。

### 中：媒体预览令牌存在文件替换竞态

预览令牌过去绑定路径，签发后到 Range 读取前可发生文件或目录替换。现在令牌绑定签发时的 device/inode；协议使用 `O_NOFOLLOW` 打开实际句柄后以 `fstat` 再次校验身份，再把该句柄交给流。替换文件会使令牌立即失效。

### 中：app-server 继承无关环境变量

app-server 过去继承 Electron 的整个 `process.env`，可能无意携带 CI、Git 或其他服务密钥。现在只传递跨平台系统运行、区域、代理/证书、Codex/OpenAI 认证变量和显式 provider 环境。定向测试证明未授权的 `GITHUB_TOKEN`/任意秘密不会进入子进程；真实 app-server 仍完成 initialize/model-list 并达到 ready。

### 防御性：GitHub CLI 外部写入与环境隔离

PR 工作流不允许 Renderer 提交 cwd、命令或 URL；主进程从 SQLite 与 Git 状态重建项目、head/base 远端和分支。创建前二次确认并显式 push，正文通过 `--body-file -` 走 stdin；完成后只接受同一 HTTPS GitHub host、owner/repository 和数字 PR 路径的结构化回读。`gh` 只继承系统运行、代理/证书、SSH agent 与 GitHub 专属认证变量，1 MiB 输出和超时均失败关闭。Electron 替身记录证明任意、DeepSeek 和 OpenAI 密钥均未进入 `gh`。

Git 状态历史上会原样返回 `git remote -v` URL；若旧仓库把 token 放在 HTTPS userinfo 或 query，可能进入 Renderer 快照。当前在主进程统一清除 username/password/query/fragment，解析失败的 scheme URL直接替换为脱敏占位；定向真实仓库测试证明快照不含测试凭据。

### 防御性：notice 生成器信任 PATH 和最终符号链接

该脚本只在受信任的 Aster 源码构建中使用，因此独立攻击路径被判定为非报告项；仍完成前瞻加固：子进程通过当前 pinned pnpm 暴露的绝对 `npm_execpath` 运行，不再二次搜索项目 `PATH`；生成目标必须是普通文件并通过同目录临时文件替换，拒绝符号链接；homepage 只允许 HTTP(S)。自动测试确认外部 symlink victim 内容保持不变。

## 未发现可报告问题的已审计控制

- 主 Renderer CSP、sandbox/contextIsolation、无 Node，且阻止非当前 URL 导航。
- 本地网页预览独立内存 partition、仅 loopback、无 preload/Node、拒绝权限/下载/弹窗。
- Git/工作树/差异使用参数数组、路径根约束、快照令牌、输出和超时预算。
- OS safeStorage 密文、0600 原子文件、日志递归脱敏和有界轮转。
- Security 产物在仓库外、realpath 约束、只有 completed sealed 结果可读取或执行 finding 操作。
- app-server JSONL 大小/超时/背压、活动 turn 崩溃不重放、终端输出与共享上下文有界。
- 发布 workflow 只从 main 的不可变触发 SHA 进入受保护 environment；第三方 Actions 全部固定提交 SHA，未签名构建不接收签名变量。

## 许可证

生产依赖许可证扫描只发现 MIT、Apache-2.0、ISC、BSD-2-Clause、BSD-3-Clause 和 0BSD；没有 GPL/AGPL/SSPL 或未知许可证。发布阶段仍需随包生成完整 third-party notices。
