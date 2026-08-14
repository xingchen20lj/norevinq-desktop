# 公开发布检查表

本文区分“公开源码”和“公开安装包”。源码可以先公开；正式安装包必须在签名、公证和目标平台安装验证完成后再发布。

## 当前结论

- 源码工程质量：满足公开预览要求；
- 许可证与社区文件：已准备 Apache-2.0、NOTICE、贡献/支持/行为准则及 Issue/PR 模板；
- 依赖安全：发布前必须保持 `pnpm audit:dependencies` 与 `pnpm verify:ci` 通过；
- macOS 内部包：无签名 DMG/ZIP 已验证；
- 正式 macOS 包：仍需要 Developer ID 和 Apple 公证权限；
- Windows 包：构建配置和 CI 路径已建立，仍需要 Windows 真机安装、SmartScreen 和签名验证；
- 自动更新：需要发布者控制的 HTTPS 下载地址和稳定签名身份；
- Codex Security OpenAI 模式受外部账户 Security/Trusted Access 权限约束；DeepSeek 模式使用用户自己的 API Key，不要求 OpenAI 登录。这些在线条件都不影响普通源码公开。

## 公开前（保持仓库 Private）

- [ ] 合并开源准备 PR，并确认 `main` CI 全绿；
- [x] 再运行一次历史密钥检查，确认命中项仅为明确的测试占位符；
- [x] 确认 README、截图、生成清单和文档不含个人绝对路径、真实凭据或私人仓库内容；
- [x] 运行 `pnpm install --frozen-lockfile`、`pnpm audit:dependencies`、`pnpm verify:ci`；
- [x] 在 macOS 重新生成无签名内部 DMG，并运行 packaged E2E；
- [x] 在 GitHub 仓库设置中确认描述、主题和默认分支；
- [ ] 备份私有仓库和本地签名/发布资料，凭据不得进入 Git。

建议仓库主题：`electron`、`react`、`typescript`、`codex`、`deepseek`、`coding-agent`、`desktop-app`、`git-worktree`。

## 切换为 Public 后立即完成

- [ ] 启用 GitHub Private Vulnerability Reporting；
- [ ] 启用 Secret Scanning、Push Protection 和 Dependabot Alerts；
- [ ] 创建 `main` ruleset：禁止 force push/删除，合并前要求 `Verify (macos-15)` 与 `Verify (windows-2025)`；
- [ ] 要求 PR 审阅后合并，并限制发布工作流只使用受保护的 `main`；
- [ ] 为 `release` environment 配置 required reviewer，发布者不能自批；
- [ ] 验证 README 的 CI/License badge、Issue 模板和 Security Advisory 入口；
- [ ] 检查公开仓库的 Actions 日志和 artifact，确认没有环境变量、签名资料或本地路径泄漏。

私有免费仓库当前无法配置 ruleset/classic branch protection；公开后应立即执行以上设置，避免 `main` 长时间处于未保护状态。

## 首个源码预览版本

- [ ] 将 `package.json` 从开发版本更新为确定的预览版本；
- [ ] 把 CHANGELOG 中对应版本从 `Unreleased` 改为发布日期；
- [x] 运行完整质量门和依赖审计；
- [ ] 创建带注释的 Git tag；
- [ ] 发布源码归档、变更说明和已知限制；
- [ ] 如果平台签名尚未完成，不上传容易被误认为正式稳定版的无签名安装包。

## 首个公开安装包

- [ ] macOS：签名、notarize、staple，并通过 `codesign`、`stapler` 和 `spctl`；
- [ ] Windows：签名 NSIS EXE，在 Windows x64/arm64 目标上验证安装、启动、升级和卸载；
- [ ] 运行 packaged E2E，确认包内 Codex 稳定版本、模型目录和 app-server ready；
- [ ] 上传安装包、blockmap、SHA-256 和 latest metadata；
- [ ] 从上一版本验证自动更新下载、签名检查、重启安装和用户数据保留；
- [ ] 最后再发布 `latest*.yml`，避免客户端看到不完整更新。

## 不得公开的内容

- API Key、ChatGPT/GitHub token、签名证书和密码；
- Electron `userData`、Aster `agent-home`、SQLite、日志或安全扫描未密封产物；
- 私人项目源代码、用户目录截图或无关个人信息；
- 未验证的漏洞细节、攻击代码或第三方私密报告；
- 使用真实外部服务产生但未经脱敏和授权的测试数据。

## 2026-08-14 验证证据

- Gitleaks 8.30.1 扫描全部既有历史提交：0 泄漏；旧测试占位符使用规则 ID、精确行与精确路径限定的 allowlist；
- `pnpm audit --prod --audit-level high`：0 已知漏洞；生产依赖许可证清单：93 个包；
- `pnpm verify:ci`：40 个测试文件，205 项通过、1 项需要显式在线环境的测试跳过；覆盖率 statements 81.30%、branches 70.18%、functions 86.32%、lines 88.22%；
- 真实 Electron 主流程 E2E：1 项通过；packaged app runtime E2E：1 项通过；
- Intel x64 与 Apple Silicon arm64 DMG 均通过 `hdiutil verify`，包内 Electron 与 Codex 架构匹配；
- 四张 README 产品截图由上述真实 Electron E2E 生成并人工检查，无用户目录、真实凭据或私人项目内容。
