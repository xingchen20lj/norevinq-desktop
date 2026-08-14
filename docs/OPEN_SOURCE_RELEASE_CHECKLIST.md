# 公开发布检查表

本仓库采用源码优先发布：GitHub 只提供源码、源码标签和构建说明，不提供预编译安装包。

## 当前结论

- 源码工程质量：满足公开预览要求；
- 安全复核：3 项中风险全部修复，5 项低风险中 4 项关闭、1 项以补偿控制明确接受；没有已知未处理的高严重程度漏洞；
- 许可证与社区文件：已准备 Apache-2.0、NOTICE、贡献/支持/行为准则及 Issue/PR 模板；
- 依赖安全：发布前必须保持 `pnpm audit:dependencies` 与 `pnpm verify:ci` 通过；
- 本地打包：macOS 无签名内部 DMG/ZIP 已验证，Windows 保留源码构建配置；
- GitHub 分发：不生成、不上传 DMG、ZIP、EXE、blockmap 或更新元数据；
- 第三方自行构建：必须使用自己的名称/签名身份并遵守许可证与品牌边界；
- Codex Security OpenAI 模式受外部账户 Security/Trusted Access 权限约束；DeepSeek 模式使用用户自己的 API Key，不要求 OpenAI 登录。这些在线条件都不影响普通源码公开。

## 公开前（保持仓库 Private）

- [x] 合并开源准备 PR，并确认 `main` CI 全绿；
- [x] 再运行一次历史密钥检查，确认命中项仅为明确的测试占位符；
- [x] 确认中英文 README、截图、生成清单和文档不含个人绝对路径、真实凭据或私人仓库内容；
- [x] 运行 `pnpm install --frozen-lockfile`、`pnpm audit:dependencies`、`pnpm verify:ci`；
- [x] 在 macOS 重新生成无签名内部 DMG，并运行 packaged E2E；
- [x] 在 GitHub 仓库设置中确认描述、主题和默认分支；
- [x] 生成并验证完整 Git bundle 私有备份；当前没有 Developer ID、Windows 签名证书或其他本地签名资料，凭据未进入 Git。

当前仓库主题：`electron`、`react`、`typescript`、`deepseek`、`coding-agent`、`desktop-app`、`git-worktree`、`local-first`、`security`。

## 切换为 Public 后立即完成

- [x] 启用 GitHub Private Vulnerability Reporting；
- [x] 启用 Secret Scanning、Push Protection、Dependabot Alerts 和自动安全更新；
- [x] 创建 `main` ruleset：禁止 force push/删除，合并前要求 `Verify (macos-15)` 与 `Verify (windows-2025)`；
- [x] 要求所有变更通过 PR 合并，并要求审阅对话全部解决；个人维护阶段不强制其他账户批准；
- [x] 验证 README 的 CI/License badge、Issue 模板和 Security Advisory 入口；
- [x] 检查公开仓库的 Actions 日志，确认没有环境变量、签名资料、本地路径或安装产物泄漏。

仓库已于 2026-08-15 切换为 Public；上述安全设置与 `Protect main` ruleset 已立即生效。

## 首个源码预览版本

- [x] 将 `package.json` 固定为首个源码预览版本 `0.1.0`；
- [x] 把 CHANGELOG 中 `0.1.0` 改为发布日期 2026-08-15；
- [x] 运行完整质量门和依赖审计；
- [x] 创建带注释的 Git tag `v0.1.0`；
- [x] 由 GitHub tag 自动提供源码归档，并发布变更说明和已知限制；
- [x] 确认 Release/Actions 中不存在预编译安装包。

## GitHub 之外如需提供正式安装包

- [ ] macOS：签名、notarize、staple，并通过 `codesign`、`stapler` 和 `spctl`；
- [ ] Windows：签名 NSIS EXE，在 Windows x64/arm64 目标上验证安装、启动、升级和卸载；
- [ ] 运行 packaged E2E，确认包内 Codex 稳定版本、模型目录和 app-server ready；
- [ ] 上传安装包、blockmap、SHA-256 和 latest metadata；
- [ ] 从上一版本验证自动更新下载、签名检查、重启安装和用户数据保留；
- [ ] 最后再发布 `latest*.yml`，避免客户端看到不完整更新。

## 不得公开的内容

- API Key、ChatGPT/GitHub token、签名证书和密码；
- Electron `userData`、Norevinq `agent-home`、SQLite、日志或安全扫描未密封产物；
- 私人项目源代码、用户目录截图或无关个人信息；
- 未验证的漏洞细节、攻击代码或第三方私密报告；
- 使用真实外部服务产生但未经脱敏和授权的测试数据。

## 2026-08-15 验证证据

- Gitleaks 8.30.1 扫描全部既有历史提交：0 泄漏；旧测试占位符使用规则 ID、精确行与精确路径限定的 allowlist；
- `pnpm audit --prod --audit-level high`：0 已知漏洞；生产依赖许可证清单：93 个包；
- `pnpm verify:ci`：42 个测试文件中 41 个通过、1 个需要显式在线环境的测试跳过；214 项通过、1 项跳过；覆盖率 statements 81.33%、branches 70.30%、functions 86.40%、lines 88.24%；
- 真实 Electron 主流程 E2E：1 项通过；packaged app runtime E2E：1 项通过；
- GitHub PR #11 的 macOS 15、Windows 2025 与离线 Electron smoke 均通过；
- GitHub Release `v0.1.0` 为源码预发布，资产列表为空；仅提供 GitHub 自动生成的源码归档；
- Intel x64 与 Apple Silicon arm64 DMG 均通过 `hdiutil verify`，包内 Electron 与 Codex 架构匹配；
- 四张 README 产品截图由上述真实 Electron E2E 生成并人工检查，无用户目录、真实凭据或私人项目内容。
