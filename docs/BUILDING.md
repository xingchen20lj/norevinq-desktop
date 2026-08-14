# 新手构建指南

本指南用于从一份全新 Git clone 运行和打包 Aster Code。建议在需要发布的平台上构建：macOS 产物在 macOS 构建，Windows 产物在 Windows 构建。

## 1. 准备环境

必需工具：

- Git；
- Node.js 24.14.0（仓库的 `.node-version` 为版本管理器提供固定版本）；
- pnpm 11.16.0（`package.json` 的 `packageManager` 已固定）；
- 可访问 npm registry 和 GitHub release assets 的网络；
- 至少 5 GiB 可用磁盘空间。

验证环境：

```bash
git --version
node --version
pnpm --version
```

如果 Node 已安装但没有 pnpm，可优先使用 Node 自带的 Corepack：

```bash
corepack enable
corepack prepare pnpm@11.16.0 --activate
```

若系统发行版没有 Corepack，可运行 `npm install --global pnpm@11.16.0`。

推荐结果分别包含 Node `v24.14.0` 和 pnpm `11.16.0`。如果只看到 `pnpm` 而 `node` 报找不到，任何构建都会失败；请先完成 Node 安装并重新打开终端。

项目不依赖本机 ChatGPT 或 Codex 安装。`pnpm install` 会按照 lockfile 下载公开的 `@openai/codex` 及当前平台运行时。

## 2. 克隆与安装

```bash
git clone https://github.com/xingchen20lj/aster-code-desktop.git
cd aster-code-desktop
pnpm install --frozen-lockfile
```

不要把 `node_modules/`、`.env`、`release/`、日志或本地用户数据提交到 Git；它们均已在 `.gitignore` 中排除。

## 3. 开发运行

```bash
pnpm dev
```

应用第一次启动时会创建独立数据目录。在线模型需要在应用内登录或配置相应 Key；编译、离线测试和打包本身不需要模型凭据。

## 4. 构建前验证

快速验证：

```bash
pnpm verify
```

发布前完整验证：

```bash
pnpm audit:dependencies
pnpm verify:ci
```

`verify:ci` 会运行类型检查、ESLint、脚本/工作流检查、许可证清单检查、覆盖率测试、性能基准、生产构建和 bundle 预算。

## 5. 本机打包

### macOS

生成明确无签名的内部测试包：

```bash
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm package:mac
```

输出包括：

```text
release/Aster Code-<version>-mac-<arch>.dmg
release/Aster Code-<version>-mac-<arch>.zip
```

无签名 DMG 可能触发 Gatekeeper 警告，只适合开发验证。公开分发需要 Developer ID Application 证书与 Apple 公证权限。

### Windows

在 Windows PowerShell 运行：

```powershell
pnpm package:win
```

输出为 `release/Aster Code-<version>-win-<arch>.exe`。未签名安装器可能触发 SmartScreen；公开分发需要代码签名证书。

### 只生成应用目录

```bash
pnpm package:dir
pnpm check:package
```

该命令适合快速检查打包内容，但不会生成可分发安装器。

## 6. GitHub Actions 打包

仓库包含两个工作流：

- `CI`：push/PR 时在 macOS 和 Windows 验证源码；
- `Desktop release artifacts`：手动生成平台安装产物。

在 GitHub 的 Actions 页面选择 `Desktop release artifacts`。内部测试可将 `require_signing` 设为 `false`；正式发布必须保持 `true`，并在受保护的 `release` environment 配置签名凭据和 HTTPS 更新地址。工作流只上传 Actions Artifact，不会自动创建 GitHub Release。

## 7. 常见问题

### `node: not found`

Node 没有安装或不在 `PATH`。先确认 `node --version`，不要只检查 pnpm。

### 依赖下载超时

确认 npm registry、GitHub assets 和代理设置。若使用系统代理，请在同一终端确认 `HTTP_PROXY`、`HTTPS_PROXY` 或包管理器代理配置确实生效。不要把代理账号或 Key 写入仓库。

### Codex 平台包缺失

删除不完整的 `node_modules` 后重新执行 `pnpm install --frozen-lockfile`。应在目标操作系统上安装依赖和打包，避免复用另一平台复制过来的 `node_modules`。

### Codex Security 不可用

这不影响普通构建。真实扫描另外需要 Python 3.10+、账户认证以及 Codex Security/Trusted Access 权限。

### 在线测试失败

`pnpm verify:ci` 不要求在线模型。完整 Electron 在线 E2E 需要单独配置凭据和外部账户权限，不能把缺少凭据误判为编译失败。

## 8. 正式发布

版本更新、第三方许可证、签名、公证、自动更新、校验和与目标系统安装验证见[发布指南](RELEASING.md)。开源前的仓库设置见[公开发布检查表](OPEN_SOURCE_RELEASE_CHECKLIST.md)。
