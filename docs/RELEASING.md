# 桌面构建与发布

最后更新：2026-08-11。

## 发布基线

- Node.js 24.14.0、pnpm 11.16.0、Electron 43.3.0、electron-builder 26.15.3；
- 主 Codex runtime 固定为公开 `@openai/codex` 0.147.0，并随平台包内置；
- Codex Security SDK 固定 0.1.8，其 SDK 元数据声明 Codex SDK/runtime 0.144.6；发布包为控制体积只保留主 Codex 0.147.0，因此 Security 的打包兼容性必须通过目标账户 sealed 扫描复验；
- macOS 目标为 DMG + ZIP，Windows 目标为交互式 per-user NSIS；
- 构建不会自动发布，所有 builder 命令显式使用 `--publish never`。

官方 OpenAI 文档说明 `codex app-server` 默认使用 stdio/JSONL，并且生成的 schema 与运行的 Codex 版本严格对应。Aster Code 因此直接固定并发现包内 0.147.0，而不是依赖用户 PATH 或 ChatGPT 安装。显式配置和 `CODEX_BINARY` 仍可覆盖包内版本用于诊断。

## 本地构建

```bash
pnpm install --frozen-lockfile
pnpm audit:dependencies
pnpm audit:licenses
pnpm notices:check
pnpm verify:ci
pnpm package:dir
pnpm test:e2e:packaged
```

平台安装产物：

```bash
# 只能在 macOS 生成并验证 macOS 产物
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm package:mac

# 应在 Windows x64 runner 生成，确保安装对应的 Codex 平台 optional dependency
pnpm package:win
```

`test:e2e:packaged` 不是普通开发构建冒烟：它直接启动 `release/mac/Aster Code.app` 或 `release/win-unpacked/Aster Code.exe`，要求 runtime 路径来自 `app.asar.unpacked`、版本精确为稳定版 0.147.0（预发布后缀不通过）、模型目录非空并达到 ready。

2026-08-11 本机 Intel macOS 无签名实测：目录包 697 MiB，DMG 259 MiB，ZIP 273 MiB；DMG CRC、ZIP 全文件校验、目录包启动和只读挂载 DMG 启动均通过。体积主要由 Electron、Codex 0.147.0 原生运行时和 Codex Security 依赖组成。files 规则明确去除 pnpm 嵌套图中重复的平台二进制，但保留根平台 runtime。完整生产依赖许可证元数据见根目录 `THIRD_PARTY_NOTICES.md`。

## macOS 签名和公证

发布机需要完整 Xcode、Developer ID Application 证书和 Apple 公证权限。配置 electron-builder 支持的环境变量：

- `CSC_LINK`：证书文件路径、HTTPS 地址或 base64；
- `CSC_KEY_PASSWORD`：证书密码；
- `APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`：公证凭据。

随后运行：

```bash
pnpm package:mac
codesign --verify --deep --strict --verbose=2 "release/mac/Aster Code.app"
xcrun stapler validate "release/mac/Aster Code.app"
spctl --assess --type execute --verbose=4 "release/mac/Aster Code.app"
```

项目启用 hardened runtime，并只声明 Electron JIT/unsigned executable memory 与动态库校验所需 entitlement。当前环境没有证书，因此只能验证明确未签名的包，不能宣称已签名或公证。

## Windows 签名与安装

在 Windows 2025/x64 runner 中设置 `CSC_LINK` 和 `CSC_KEY_PASSWORD`，然后运行 `pnpm package:win`。NSIS 安装器默认：

- 非 one-click，允许用户选择目录；
- per-user 安装，必要时允许提权；
- 创建开始菜单和桌面快捷方式；
- 卸载不删除用户任务、凭据和历史数据。

Windows CI 会直接启动 `win-unpacked` 应用，验证随包 `codex.exe`。当前仓库所在 Intel macOS 不能替代 Windows 真机安装、SmartScreen、卸载与签名证书验证。

## GitHub Actions

“Desktop release artifacts” 是手动 workflow，只允许从 `main` 执行，并把 checkout 绑定到触发时的不可变 `github.sha`。默认 `require_signing=true`，缺任一平台凭据会失败，不会静默发布未签名包。仅用于内部验证时可显式选择 false，此时签名变量被显式置空，产物仍只保留为 Actions artifact，不创建 GitHub Release。

首次启用前必须在 GitHub 创建受保护的 `release` environment：

- 设置至少一名独立 required reviewer，并禁止发起人自行批准；
- deployment branches 只允许受保护的 `main`；
- 下列签名凭据只存为该 environment 的 secrets，不存为普通 repository secrets；
- 保留 workflow 的 `github.ref == 'refs/heads/main'` 源码守门，不以环境配置替代源码约束。

所有第三方 Actions 固定到已审阅的完整提交 SHA，版本号仅作为行尾注释。升级 Action 时必须审阅上游 release/commit 后同时更新 SHA 和注释。

所需 secrets：

- macOS：`MAC_CSC_LINK`、`MAC_CSC_KEY_PASSWORD`、`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`；
- Windows：`WIN_CSC_LINK`、`WIN_CSC_KEY_PASSWORD`。

每个平台依次执行生产依赖审计、完整质量门、平台打包、包内 Codex 启动冒烟、签名/公证验证（要求签名时）、SHA-256 和 artifact 上传。将 artifact 发布到公开渠道仍需发布者审阅版本、third-party notices、功能一致性和已知限制。

## 发布清单

1. 更新版本号、CHANGELOG、自主状态和功能一致性表。
2. 同步并审阅 Codex schema；确认 package runtime 与 schema 版本。
3. 运行 `pnpm verify:ci`、`pnpm audit:dependencies` 和平台 packaged E2E。
4. 在目标系统安装产物，验证项目、任务、终端、Git、文件预览、DeepSeek 和安全诊断。
5. 验证签名、公证/SmartScreen、安装、升级、卸载和用户数据保留。
6. 记录产物 SHA-256；人工批准后再发布。
