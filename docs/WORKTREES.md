# 托管工作树

## 生命周期

- worktree 位于 Electron userData 下的 `worktrees/<project-id>/<worktree-id>`，不污染源仓库目录。
- 默认执行 `git worktree add --detach <path> HEAD`；只有用户填写分支时才执行 `-b <branch>`。
- SQLite 保存 id、projectId、canonical path、base ref、可选 branch、创建时间和 include 复制计数。应用重启后从数据库与 `git worktree list --porcelain` 交叉恢复状态。
- lock/unlock/remove 只接受数据库登记的 UUID；执行前再次确认 path 位于该 project 的托管根内。
- 普通 remove 不使用 `--force`，有未提交修改时由 Git 拒绝。强制移除仅保留在显式 API，不由当前 UI 暴露。

## `.worktreeinclude`

如果源仓库根存在 `.worktreeinclude`，创建后执行以下受限流程：

1. 读取非空、非注释模式，支持按顺序的 `!` 排除。
2. 从 `git ls-files --others --ignored --exclude-standard -z` 获取被 Git 忽略的候选文件。
3. 只复制相对路径、匹配模式、非 symlink 的普通文件。
4. 单文件最多 10 MiB，总计最多 100 MiB。
5. 目标路径始终位于新 worktree 内；不会复制未忽略文件或遍历 `..`。

这允许用户显式带入本地构建配置，同时避免把整个 ignored 目录、凭据 symlink 或无界缓存隐式复制到每个任务。

## 验证证据

- 真实仓库创建 detached worktree，断言 HEAD 为 detached、tracked 文件存在。
- 显式创建 `codex/worktree-test` 分支，并验证再次占用同分支由 Git 拒绝。
- `.worktreeinclude` 只复制 `config/local.txt`，排除 `config/skip.txt` 与未匹配的 `private.secret`。
- lock、unlock、服务重建后的 SQLite 恢复、普通/force remove 均有真实测试。
- Electron E2E 从 Local 创建 detached worktree、锁定/解锁、选择为 composer 上下文；后续真实 Codex turn 使用 worktreeId 解析 cwd，完成后移除并回到 Local。
