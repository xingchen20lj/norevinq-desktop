# 测试策略

Aster Code 使用分层验证，避免以静态界面或模拟数据替代真实闭环。

## 本地命令

- `pnpm verify`：严格类型检查、ESLint、脚本语法、单元/集成测试和生产构建。
- `pnpm verify:ci`：在上述检查中启用 V8 覆盖率门槛。
- `pnpm test:coverage`：生成 `coverage/index.html`、LCOV 和 JSON summary。
- `pnpm test:performance`：运行长活动历史与真实 SQLite 大数据量基准。
- `pnpm test:e2e`：构建后运行真实 Electron 桌面回归；需要可用的 Codex app-server 和相应账户凭据。
- `pnpm test:e2e:offline`：不调用模型，验证 Electron 启动、主窗口 IPC 和非主 Renderer 拒绝；用于 macOS/Windows CI。
- `pnpm test:e2e:performance`：用全新 profile 测量真实 Electron 冷启动、DOMContentLoaded 和总工作集。
- `pnpm test:e2e:packaged`：直接启动打包后的 `.app`/`.exe`，验证包内 Codex 版本、路径、模型、ready 状态及更新渠道启用/禁用诊断。
- `ASTER_UPDATE_URL='https://updates.invalid/aster-code/' pnpm package:update`：仅用于本地生成元数据测试，验证 app-update/latest/blockmap/SHA-512；`.invalid` 构建不可发布。
- `pnpm exec playwright test tests/e2e/conversation-lifecycle.spec.ts`：不调用模型，以确定性 app-server 进程验证任务搜索、分页、重命名、分叉、压缩、归档、恢复、永久删除及单实例任务深链接的完整桌面流程。
- `pnpm check:bundle`：从生产 HTML 校验首屏 JS/CSS 与 Renderer 总资产预算。
- `pnpm check:workflows`：拒绝非完整提交 SHA 的远程 Action，并验证发布 workflow 的 main/ref/environment/签名守门。
- `pnpm audit:dependencies`：查询当前漏洞数据库并拒绝生产依赖的高严重度问题。
- `pnpm audit:licenses`：列出生产依赖许可证，发布前用于生成 third-party notices。
- `pnpm notices:generate` / `pnpm notices:check`：从锁定的生产依赖图生成或校验根目录 `THIRD_PARTY_NOTICES.md`。

覆盖率是回归缺口信号，不等同于功能完成。全局最低门槛为 statements 78%、branches 65%、functions 80%、lines 85%；关键安全边界仍要求针对性断言和真实运行证据。

## 自动化层级

1. 单元测试覆盖协议解析、领域 reducer、路径约束、日志脱敏和状态转换。
2. 集成测试使用真实临时 SQLite、Git 仓库和工作树；数据库覆盖 v7→v8 固定元数据迁移、排序、20 项任务补读上限和项目–任务深链接关联。任务生命周期还会直接启动随依赖固定的官方 `@openai/codex` 0.147.0 app-server，在隔离 `CODEX_HOME` 中验证命名、读取、搜索请求、分叉、归档、恢复、删除及长期目标 set/get/clear，不调用模型或消耗在线额度。
3. 崩溃注入测试验证空闲 app-server 自动恢复，而活动 turn 失败关闭且绝不自动重放副作用请求。
4. 构建脚本测试验证 notice 生成器使用 pinned package-manager 入口、仅生成 HTTP(S) 链接，并拒绝最终符号链接覆盖仓库外文件；更新发布配置拒绝非 HTTPS、凭据、query、fragment 与 localhost。诊断包测试解压真实 ZIP，核对 manifest/hash、0600 权限、路径/密钥脱敏与 symlink 拒绝。
5. Electron E2E 使用临时真实仓库，验证沙箱 Renderer、在线 Codex、DeepSeek（存在密钥时）、审批允许/拒绝、Git/diff/worktree、终端、文件预览、本地网页、计划任务、单实例深链接、更新设置和应用重启恢复；深链接只允许 UUID 目标并在主进程重新校验 SQLite 关联。
6. 性能层对 5,000 条活动、3,000 条计划运行和真实冷启动建立可重复基线；详见 [性能基线](PERFORMANCE.md)。
7. GitHub Actions 在 macOS 与 Windows 上执行 `verify:ci`、生产依赖审计和离线 Electron IPC 对抗测试。CI 构建通过不能替代 Windows 真机 UI、签名或安装程序验证。

## 外部依赖

在线 E2E 只在安全配置凭据的受控环境运行。缺少 DeepSeek Key 时跳过 DeepSeek 在线分支；缺少 Codex 登录时不得把协议替身结果宣称为在线模型验证。Codex Security 扫描受账户权限与费用预算约束，部分产物不作为成功结果导入。
