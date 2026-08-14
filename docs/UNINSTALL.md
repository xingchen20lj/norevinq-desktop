# Aster Code macOS 完全卸载说明

本说明适用于 Aster Code `0.1.x` 的 macOS DMG 体验版。以下步骤会删除应用、任务历史、设置、日志、模型登录状态、加密凭据、安全扫描结果、缓存和 Aster 托管工作树。

> **先备份工作。** 删除 `~/Library/Application Support/aster-code/worktrees` 会永久删除其中尚未提交的修改。卸载前应在 Aster Code 中逐个提交、迁移或移除托管工作树，并确认原仓库的 `git worktree list` 不再列出需要保留的目录。

## Aster Code 实际保存的位置

macOS 正式包的 Bundle ID 是 `dev.astercode.desktop`，当前版本使用以下独立目录：

| 内容 | 路径 |
| --- | --- |
| 应用 | `/Applications/Aster Code.app` |
| 全部主要用户数据 | `~/Library/Application Support/aster-code` |
| Aster 专用智能体目录 | `~/Library/Application Support/aster-code/agent-home` |
| 旧版智能体目录 | `~/Library/Application Support/aster-code/codex-home`（升级后会迁移；卸载整个主要用户数据目录时一并删除） |
| Security SDK 状态 | `~/Library/Application Support/aster-code/security/sdk-state` |
| Security 扫描产物 | `~/Library/Application Support/aster-code/security/scans` |
| SQLite、凭据密文、日志、缓存 | 均在 `~/Library/Application Support/aster-code` 内 |
| macOS 偏好 | `~/Library/Preferences/dev.astercode.desktop.plist` |
| safeStorage 钥匙串项目 | 服务 `aster-code Safe Storage`，账户 `aster-code Key` |

Aster 不安装 LaunchAgent、LaunchDaemon、内核扩展或常驻后台服务；计划任务仅在 Aster Code 主程序运行时执行。应用本体已经不在 `/Applications` 并不代表完全卸载：主要用户数据和 LaunchServices 的 `aster-code://` 登记可能仍然存在。

## 推荐卸载步骤

### 1. 处理 Git 工作树

1. 在 Aster Code 中检查每个托管工作树，提交、迁移或备份需要保留的修改。
2. 使用应用的工作树界面移除所有托管工作树。
3. 在每个曾经使用过工作树的原仓库中检查：

```bash
git -C "/你的/仓库路径" worktree list
```

若应用目录已经被删除，确认列出的缺失工作树确实不再需要后，再执行：

```bash
git -C "/你的/仓库路径" worktree prune --expire now
```

该操作只清理 Git 对已经不存在工作树的登记，不会删除普通分支或提交。

### 2. 退出应用

```bash
osascript -e 'tell application "Aster Code" to quit'
sleep 2
```

如果活动监视器中仍有 Aster Code 进程，先正常结束它们。确实无法退出时，可以只终止路径以 `/Applications/Aster Code.app/Contents/` 开头的进程：

```bash
pkill -f '^/Applications/Aster Code\.app/Contents/' || true
```

不要终止名称为 `codex` 的所有进程；那样可能同时关闭官方 Codex 或其他正在运行的任务。

### 3. 删除应用和主要用户数据

推荐在 Finder 中把下面两个项目移到废纸篓：

- `/Applications/Aster Code.app`
- `~/Library/Application Support/aster-code`

若应用安装在当前用户的“应用程序”目录，也删除 `~/Applications/Aster Code.app`。确认工作树和扫描报告都已备份后，再删除废纸篓中名称为 `Aster Code.app` 的项目；不要为了卸载 Aster 而清空含有其他文件的整个废纸篓。

需要使用终端永久删除时，只运行以下精确路径命令：

```bash
sudo rm -rf -- "/Applications/Aster Code.app"
rm -rf -- "$HOME/Applications/Aster Code.app"
rm -rf -- "$HOME/Library/Application Support/aster-code"
```

上述主要用户数据目录同时包含新版 `agent-home` 和仍未迁移的旧版 `codex-home`，不需要再删除官方 `~/.codex`。Aster 的默认目录与官方客户端隔离。

### 4. 注销深链接和旧测试包登记

macOS 的 LaunchServices 可能继续记录已经删除或推出的应用。实际测试中，旧 DMG、临时打包目录和废纸篓可以留下多个相同 Bundle ID 的记录；因此只注销 `/Applications` 中的应用并不总是足够。

先注销常见的两个安装位置并让 LaunchServices 清理失效节点：

```bash
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"

"$LSREGISTER" -u "/Applications/Aster Code.app" 2>/dev/null || true
"$LSREGISTER" -u "$HOME/Applications/Aster Code.app" 2>/dev/null || true
"$LSREGISTER" -gc 2>/dev/null || true
```

再只读列出仍登记为 Aster Code 的路径：

```bash
"$LSREGISTER" -dump 2>/dev/null | awk '
  /^path:[[:space:]]/ {
    line = $0
    sub(/^path:[[:space:]]+/, "", line)
    sub(/ \(0x[0-9a-f]+\)$/, "", line)
    path = line
  }
  /^identifier:[[:space:]]+dev\.astercode\.desktop$/ { print path }
'
```

若这里仍输出 `/Volumes/.../Aster Code.app`、`/private/tmp/.../Aster Code.app`、源码仓库 `release/.../Aster Code.app` 或 `~/.Trash/Aster Code.app`，确认路径确实属于 Aster 后，逐条把完整路径传给 `"$LSREGISTER" -u "完整路径"`，最后再执行一次 `"$LSREGISTER" -gc`。同一路径存在重复记录时可能需要重复注销。

不要使用 `lsregister -kill` 或 `lsregister -delete`：它们会重置整个用户的 LaunchServices 数据库，而不是只清理 Aster。

### 5. 删除偏好、缓存、崩溃报告和系统权限记录

```bash
defaults delete dev.astercode.desktop 2>/dev/null || true

rm -f -- "$HOME/Library/Preferences/dev.astercode.desktop.plist"
rm -rf -- "$HOME/Library/Saved Application State/dev.astercode.desktop.savedState"
rm -rf -- "$HOME/Library/Caches/aster-code"
rm -rf -- "$HOME/Library/Caches/dev.astercode.desktop"
rm -rf -- "$HOME/Library/Logs/aster-code"
rm -rf -- "$HOME/Library/HTTPStorages/dev.astercode.desktop"
rm -rf -- "$HOME/Library/WebKit/dev.astercode.desktop"
rm -f -- "$HOME/Library/Cookies/dev.astercode.desktop.binarycookies"

find "$HOME/Library/Preferences/ByHost" -maxdepth 1 -type f \
  -name 'dev.astercode.desktop.*.plist' -delete 2>/dev/null || true
find "$HOME/Library/Logs/DiagnosticReports" -maxdepth 1 -type f \
  \( -name 'Aster Code*.ips' -o -name 'Aster Code*.crash' \) -delete 2>/dev/null || true

tccutil reset All dev.astercode.desktop 2>/dev/null || true
killall cfprefsd 2>/dev/null || true
```

### 6. 删除系统钥匙串中的加密主密钥

Aster 使用 Electron `safeStorage`。删除用户数据目录会删除凭据密文，但要完整移除，还应删除对应的 macOS 钥匙串项目：

```bash
security delete-generic-password \
  -a "aster-code Key" \
  -s "aster-code Safe Storage" \
  "$HOME/Library/Keychains/login.keychain-db" 2>/dev/null || true
```

该命令不会删除官方 Codex、ChatGPT 或其他应用的钥匙串项目。

### 7. 删除安装镜像和外部环境变量（可选）

推出 Finder 中仍挂载的 `Aster Code` 磁盘映像，并删除不再需要的 DMG/ZIP。源码构建产生的仓库 `release/`、`node_modules/`、文档渲染目录和包管理器全局缓存不属于已安装应用，需要时逐个确认后在源码环境中另行清理；不要用宽泛通配符删除 `/private/tmp` 中的内容。

如果你曾自行在 shell 配置中写入 `DEEPSEEK_API_KEY`、`ASTER_AGENT_HOME`、`ASTER_AGENT_BINARY` 或 `ASTER_UPDATE_URL`，卸载程序不会擅自修改这些用户配置。旧版兼容变量 `ASTER_CODEX_HOME`、`CODEX_BINARY` 也应一并检查。先定位配置行：

```bash
rg -n 'DEEPSEEK_API_KEY|ASTER_AGENT_HOME|ASTER_AGENT_BINARY|ASTER_CODEX_HOME|CODEX_BINARY|ASTER_UPDATE_URL' \
  "$HOME/.zshrc" "$HOME/.zprofile" "$HOME/.bash_profile" "$HOME/.bashrc" 2>/dev/null
```

只在确认不再供其他程序使用后，手动删除对应的 `export` 行，并在当前终端执行：

```bash
unset DEEPSEEK_API_KEY ASTER_AGENT_HOME ASTER_AGENT_BINARY ASTER_CODEX_HOME CODEX_BINARY ASTER_UPDATE_URL
```

如果设置过 `ASTER_AGENT_HOME`（或旧版 `ASTER_CODEX_HOME`）指向默认目录之外，还需在确认路径和数据不再需要后，单独删除那个自定义目录。

卸载不会删除用户自行设置的 `DEEPSEEK_API_KEY`。另外，从 Finder、启动台或 Dock 启动的 macOS 图形应用通常不会自动继承交互式 shell 配置；重新安装后若设置页显示未配置，应该在 Aster 设置中重新安全保存密钥，而不是把密钥写进应用目录。

## 卸载结果验证

```bash
test ! -e "/Applications/Aster Code.app" && echo "应用已删除"
test ! -e "$HOME/Applications/Aster Code.app" && echo "用户应用副本已删除"
test ! -e "$HOME/Library/Application Support/aster-code" && echo "用户数据已删除"
test ! -e "$HOME/Library/Preferences/dev.astercode.desktop.plist" && echo "偏好已删除"

security find-generic-password \
  -a "aster-code Key" \
  -s "aster-code Safe Storage" \
  "$HOME/Library/Keychains/login.keychain-db" >/dev/null 2>&1 \
  || echo "Aster Code 钥匙串项目已删除"

pgrep -afil '^/Applications/Aster Code\.app/Contents/' \
  || echo "没有 Aster Code 进程"

mount | grep -i '/Volumes/Aster Code' \
  || echo "没有挂载的 Aster Code 磁盘映像"

LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
if "$LSREGISTER" -dump 2>/dev/null \
  | grep -q 'identifier:                 dev\.astercode\.desktop$'; then
  echo "LaunchServices 中仍有 Aster Code 登记，请回到第 4 步逐条注销"
else
  echo "Aster Code 深链接登记已删除"
fi
```

最后在曾使用工作树的原仓库运行 `git worktree list`，确认没有 Aster 托管目录的失效记录。

## “完全无残留”的边界

上述步骤会删除 Aster Code 自己创建并可识别的应用文件、用户数据、扫描产物、凭据密文、钥匙串主密钥、偏好、缓存、权限记录和深链接登记。它不会删除：

- Aster/Codex 对真实项目做出的代码修改、Git 提交、分支或远端内容；
- 用户主动导出的诊断包、安全报告、SARIF 或复制到其他位置的文件；
- 用户自行配置、且可能被其他程序共用的 API Key；
- macOS 统一日志、APFS 快照、Time Machine/企业备份等由操作系统或备份系统管理的数据。

因此，这是一份“应用层可识别残留清理”说明，而不是对磁盘取证级不可恢复的保证。需要取证级清除时，应另外处理备份、快照和组织设备管理策略。
