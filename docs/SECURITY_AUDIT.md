# 安全审计与加固记录

审计日期：2026-08-10。范围为当前仓库生产源码、Electron 配置、IPC、文件/浏览器边界、子进程、凭据与生产依赖。

## 方法与限制

- 执行 `pnpm audit --prod --audit-level low`，并在修复后复扫。
- 逐项追踪 Renderer → preload → IPC → 主进程敏感操作，以及仓库/模型/MCP/app-server → 文件、进程、网络和持久化的路径。
- 运行定向单元/集成测试和一个不调用模型的 Electron 对抗测试。
- Codex Security 标准扫描技能要求的桌面 direct-start/finalize 工具在当前工具面不可用；独立子代理也受当前协作规则禁止。在线 SDK 又因账户使用量耗尽无法完成 sealed 扫描。因此本文件不是伪造的 Codex Security sealed 报告，完整在线扫描仍列为外部待验证。

## 已验证并修复

### 高：Codex Security 的 PDF.js 传递依赖漏洞

`@openai/codex-security@0.1.8` 固定 `pdfjs-dist@5.6.205`，命中 GHSA-hq66-cqwq-w95j（恶意 PDF 任意 JavaScript 执行）。工作区使用 pnpm override 固定到已修复的 `6.2.108`；Node 24 满足其引擎要求。复扫结果为 `No known vulnerabilities found`，SDK 服务测试、构建与本地预检路径继续通过。

### 中：IPC handler 未统一验证调用 WebContents

所有 payload 已有 Zod 校验，但过去任何能获得 `ipcRenderer` 的同应用 WebContents 都可调用主进程 handler。现在每个 handler 先验证调用者恰为当前主窗口顶层 frame。离线 Electron 对抗测试创建故意开启 Node 的第二 Renderer：主窗口 bootstrap 成功，第二 Renderer 被 `Unauthorized IPC sender` 拒绝。

### 中：媒体预览令牌存在文件替换竞态

预览令牌过去绑定路径，签发后到 Range 读取前可发生文件或目录替换。现在令牌绑定签发时的 device/inode；协议使用 `O_NOFOLLOW` 打开实际句柄后以 `fstat` 再次校验身份，再把该句柄交给流。替换文件会使令牌立即失效。

### 中：app-server 继承无关环境变量

app-server 过去继承 Electron 的整个 `process.env`，可能无意携带 CI、Git 或其他服务密钥。现在只传递跨平台系统运行、区域、代理/证书、Codex/OpenAI 认证变量和显式 provider 环境。定向测试证明未授权的 `GITHUB_TOKEN`/任意秘密不会进入子进程；真实 app-server 仍完成 initialize/model-list 并达到 ready。

## 未发现可报告问题的已审计控制

- 主 Renderer CSP、sandbox/contextIsolation、无 Node，且阻止非当前 URL 导航。
- 本地网页预览独立内存 partition、仅 loopback、无 preload/Node、拒绝权限/下载/弹窗。
- Git/工作树/差异使用参数数组、路径根约束、快照令牌、输出和超时预算。
- OS safeStorage 密文、0600 原子文件、日志递归脱敏和有界轮转。
- Security 产物在仓库外、realpath 约束、只有 completed sealed 结果可读取或执行 finding 操作。
- app-server JSONL 大小/超时/背压、活动 turn 崩溃不重放、终端输出与共享上下文有界。

## 许可证

生产依赖许可证扫描只发现 MIT、Apache-2.0、ISC、BSD-2-Clause、BSD-3-Clause 和 0BSD；没有 GPL/AGPL/SSPL 或未知许可证。发布阶段仍需随包生成完整 third-party notices。
