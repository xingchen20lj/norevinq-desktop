# Git 工作流

## 安全边界

- renderer 只提交已登记的 projectId；主进程从 SQLite 解析 canonical project path。
- 只使用 `execFile("git", args)` 参数数组，不拼接 shell 字符串。
- 文件操作必须提供项目相对路径；拒绝绝对路径、NUL、`..` 逃逸和空路径，并在参数前插入 `--`。
- remote/branch 使用保守 ref 字符集并拒绝 option-like 值。
- 子进程设置 `GIT_TERMINAL_PROMPT=0`，不会在后台挂起等待凭据输入。
- 普通命令 30 秒、commit/push 120 秒，stdout/stderr 最大 8 MiB；返回 UI 的错误最多 4,000 字符。
- 整文件 discard 使用专用可恢复 Git ref，逐 hunk revert 需要显式确认；两者都在执行前验证快照、路径与目标状态。
- GitHub CLI 仅由主进程启动；只继承系统、代理/证书、SSH agent 和 GitHub 专属认证变量，错误统一脱敏，输出限制为 1 MiB。
- Electron GUI 不假定继承登录 shell PATH；按显式 `GH_BINARY`、绝对 PATH、`~/bin`、`~/.local/bin`、Homebrew 与 Windows GitHub CLI 标准位置发现可执行文件，发布包不硬编码本机路径。
- PR body 通过 stdin 提交，head/base 从登记远端重建；URL 和 JSON 结果必须匹配认证主机与目标仓库。
- `git remote -v` 进入共享状态前移除 URL userinfo、query 和 fragment；即使旧仓库把 token 写进远端 URL，Renderer 也不会读到它。

## 已实现闭环

- 识别非仓库并可初始化 `main` 分支。
- 解析 porcelain v2 NUL 格式，包括 unborn/detached、upstream、ahead/behind、普通/rename/unmerged/untracked 路径和含空格文件名。
- 读取 fetch/push remote URL。
- 按文件 stage 与 unstage。
- 使用显式消息 commit。
- 对已有 remote push，并可设置 upstream。
- 顶栏展示分支与变更数量；Git 面板支持刷新、分组状态、暂存、取消暂存、提交和显式推送。
- Git 面板支持 GitHub CLI 登录/仓库预检、fork head/upstream base 选择、Draft/正式 PR、显式 push 二次确认和已存在 PR 直达。

## 验证证据

- 单元/集成测试在临时真实仓库执行 init、空格路径、stage、unstage、两次 commit。
- 创建本地 bare remote，真实 push `main` 并断言 `origin/main`、remote fetch/push URL。
- Electron E2E 中 OpenAI/DeepSeek 智能体真实创建文件；Git 面板刷新后逐文件暂存并真实 commit，最终工作区干净。
- GitHub PR Electron E2E 对真实临时仓库执行 feature 分支 push 到本地 bare remote；确定性 `gh` 替身验证正文 stdin、Draft #42、结构化回读、重复调用不创建第二个 PR，以及无关密钥不进入子进程。
- Norevinq 桌面真实发现用户级 `gh`，向受控测试远端推送 feature 分支并创建 Draft PR；修正 list/create 的 head 参数差异后，在线结构化回读和重复创建幂等均通过。

## GitHub CLI 公开协议基线

- `gh pr create` 在分支未推送时可能提示或 fork，因此 Norevinq 始终先显式 push，并传入 `--head` 禁止隐式推送/fork行为。
- 标题、body、base/head 均传显式参数；body 使用官方支持的 `--body-file -` 从 stdin 读取。
- `--dry-run` 官方说明仍可能 push，Norevinq 不把它用于无副作用预检。
- 是否已存在 PR 使用 `gh pr list --state open --json ...`，创建后再次读取并验证，而不信任命令打印的 URL。
- `gh pr list --head` 使用纯分支名过滤，再用结构化 `headRepositoryOwner.login` 精确匹配 head owner；不能沿用 `pr create` 接受的 `owner:branch` 语法。

来源：[gh pr create](https://cli.github.com/manual/gh_pr_create)、[gh pr list](https://cli.github.com/manual/gh_pr_list)、[gh repo view](https://cli.github.com/manual/gh_repo_view)、[gh auth status](https://cli.github.com/manual/gh_auth_status)。
