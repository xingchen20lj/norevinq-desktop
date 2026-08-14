# 桌面构建与发布

最后更新：2026-08-14。

## 发布基线

- Node.js 24.14.0、pnpm 11.16.0、Electron 43.3.0、electron-builder 26.15.3、electron-updater 6.8.9；
- 主 Codex runtime 固定为公开 `@openai/codex` 0.147.0，并随平台包内置；
- Codex Security SDK 固定 0.1.11，其依赖元数据声明 Codex SDK/runtime 0.144.6；发布包为控制体积只保留主 Codex 0.147.0，DeepSeek Security 显式复用该二进制并已通过 Flash/Pro 标准 sealed 扫描；macOS Deep Scan 的官方外层沙箱兼容模式已完成一文件完整 sealed 对照；OpenAI 账户路径仍需签名目标包在线复验；
- macOS 目标为 DMG + ZIP，Windows 目标为交互式 per-user NSIS；
- 源码采用 Apache-2.0；安装包额外携带 `LICENSE.txt`、`NOTICE.txt` 和 `THIRD_PARTY_NOTICES.md`；
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

`test:e2e:packaged` 不是普通开发构建冒烟：它直接启动 `release/mac/Aster Code.app` 或 `release/win-unpacked/Aster Code.exe`，要求 runtime 路径来自 `app.asar.unpacked`、版本精确为稳定版 0.147.0（预发布后缀不通过）、模型目录非空并达到 ready；还会在真实临时 Git 仓库上执行 DeepSeek Security 本地预检。`afterPack` 必须把 Security `_bundled_plugin` 从已解析依赖路径复制到真实 `app.asar.unpacked` 目录，`check:package` 会拒绝缺失、符号链接、越界或 manifest 身份不匹配。

应用注册 `aster-code` 自定义协议，只接受 `aster-code://project/<project-uuid>` 与 `aster-code://thread/<thread-uuid>?project=<project-uuid>`。URL 不接受本地路径、命令、凭据、片段或额外参数；主进程只会打开 SQLite 已知项目及已关联任务。`check:package` 会在 macOS 实际产物的 `Info.plist` 中验证 URL scheme；Windows NSIS 的协议注册需在目标系统安装后用同一两类 URL 复验。

## 自动更新渠道

普通 `package:mac`/`package:win` 和无签名 CI 只生成内部安装包，不内置更新渠道。正式签名发布必须提供真实 HTTPS base URL：

```bash
ASTER_UPDATE_URL='https://downloads.example.org/aster-code/' pnpm package:update
pnpm check:package
```

`package:update` 不上传文件；它以 `--publish never` 生成平台安装包、blockmap、`app-update.yml` 和 `latest-mac.yml`/`latest.yml`。脚本拒绝 HTTP、localhost、凭据、query 和 fragment。`check:package` 会验证包内 URL 仍为安全 HTTPS generic provider。示例域名必须替换为发布者实际控制的服务，不能把示例构建当作公开更新渠道。

发布顺序：

1. 使用与旧版本相同的 Developer ID/Windows publisher 身份签名并完成平台验证。
2. 上传 DMG+ZIP（macOS）或 NSIS EXE（Windows）及全部 blockmap。
3. 验证远端文件大小和 SHA-512 与本地产物一致。
4. 最后原子发布 `latest-mac.yml`/`latest.yml`，避免客户端看到尚未完整上传的版本。
5. 用已安装的上一版本执行检查→下载进度→重启安装→用户数据保留回归。

正式包启动 30 秒后检查，之后每 6 小时检查。发现版本不会静默下载；用户确认下载后，electron-updater 执行 SHA-512 与平台签名验证，下载完成可立即重启或在正常退出时安装。macOS 没有签名时官方 updater 会拒绝工作。

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

“Desktop release artifacts” 是手动 workflow，只允许从 `main` 执行，并把 checkout 绑定到触发时的不可变 `github.sha`。默认 `require_signing=true`，此时还必须填写实际 `update_url`，缺平台凭据或安全 HTTPS 地址会失败。仅用于内部验证时可显式选择 false，此时签名变量被显式置空、使用普通 package 命令且不生成更新元数据；产物仍只保留为 Actions artifact，不创建 GitHub Release。

首次启用前必须在 GitHub 创建受保护的 `release` environment：

- 设置至少一名独立 required reviewer，并禁止发起人自行批准；
- deployment branches 只允许受保护的 `main`；
- 下列签名凭据只存为该 environment 的 secrets，不存为普通 repository secrets；
- 保留 workflow 的 `github.ref == 'refs/heads/main'` 源码守门，不以环境配置替代源码约束。

所有第三方 Actions 固定到已审阅的完整提交 SHA，版本号仅作为行尾注释。升级 Action 时必须审阅上游 release/commit 后同时更新 SHA 和注释。

所需 secrets：

- macOS：`MAC_CSC_LINK`、`MAC_CSC_KEY_PASSWORD`、`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`；
- Windows：`WIN_CSC_LINK`、`WIN_CSC_KEY_PASSWORD`。

每个平台依次执行生产依赖审计、完整质量门、平台打包、包内 Codex/更新配置冒烟、签名/公证验证（要求签名时）、SHA-256 和 artifact 上传。签名构建同时保留 latest metadata；Actions 不会向 `update_url` 上传，发布者必须按上述顺序部署。将 artifact 发布到公开渠道仍需审阅版本、third-party notices、功能一致性和已知限制。

## 发布清单

1. 更新版本号、CHANGELOG、自主状态和功能一致性表；公开源码前逐项完成 `OPEN_SOURCE_RELEASE_CHECKLIST.md`。
2. 同步并审阅 Codex schema；确认 package runtime 与 schema 版本。
3. 运行 `pnpm verify:ci`、`pnpm audit:dependencies` 和平台 packaged E2E。
4. 在目标系统安装产物，验证项目、任务、终端、Git、文件预览、DeepSeek 和安全诊断。
5. 从上一签名版本验证签名、公证/SmartScreen、安装、`aster-code` 外部唤起、自动更新下载/重启升级、卸载和用户数据保留。
6. 记录产物 SHA-256；人工批准后再发布。
