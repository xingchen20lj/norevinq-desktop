# Git 工作流

## 安全边界

- renderer 只提交已登记的 projectId；主进程从 SQLite 解析 canonical project path。
- 只使用 `execFile("git", args)` 参数数组，不拼接 shell 字符串。
- 文件操作必须提供项目相对路径；拒绝绝对路径、NUL、`..` 逃逸和空路径，并在参数前插入 `--`。
- remote/branch 使用保守 ref 字符集并拒绝 option-like 值。
- 子进程设置 `GIT_TERMINAL_PROMPT=0`，不会在后台挂起等待凭据输入。
- 普通命令 30 秒、commit/push 120 秒，stdout/stderr 最大 8 MiB；返回 UI 的错误最多 4,000 字符。
- 当前没有实现 discard/revert，因此不会以“撤销”名义不可恢复地删除用户未提交内容。

## 已实现闭环

- 识别非仓库并可初始化 `main` 分支。
- 解析 porcelain v2 NUL 格式，包括 unborn/detached、upstream、ahead/behind、普通/rename/unmerged/untracked 路径和含空格文件名。
- 读取 fetch/push remote URL。
- 按文件 stage 与 unstage。
- 使用显式消息 commit。
- 对已有 remote push，并可设置 upstream。
- 顶栏展示分支与变更数量；Git 面板支持刷新、分组状态、暂存、取消暂存、提交和显式推送。

## 验证证据

- 单元/集成测试在临时真实仓库执行 init、空格路径、stage、unstage、两次 commit。
- 创建本地 bare remote，真实 push `main` 并断言 `origin/main`、remote fetch/push URL。
- Electron E2E 中 OpenAI/DeepSeek 智能体真实创建文件；Git 面板刷新后逐文件暂存并真实 commit，最终工作区干净。
