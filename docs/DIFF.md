# 代码差异审阅

## 当前实现

- 分别读取 working 与 staged 快照。
- tracked 文件由 `git diff --no-ext-diff --no-color --unified=3` 产生；staged 增加 `--cached`。
- untracked 文本由主进程生成明确的 `/dev/null → b/path` 新文件 patch；包含 NUL 的文件只标记为二进制，不解码。
- 每个文件统计 additions/deletions，保留 rename oldPath 与 Git XY 状态。
- Git 面板可从未暂存/已暂存状态进入 unified diff，再返回做 stage/unstage/commit。

## 资源边界

- 每次最多 200 个文件。
- 单文件 patch 最多 2 MiB，超出后标记 truncated。
- 总 patch 最多 16 MiB，超出后停止装载后续内容并显示全局提示。
- Git 子进程无 pager、无外部 diff、无颜色、30 秒超时、无交互式凭据提示。

## 验证

- 真实仓库覆盖 tracked 修改、untracked 含空格路径、untracked 二进制和 staged 快照。
- Electron E2E 打开智能体真实创建的 `aster-approval-proof.txt`，同时断言文件名和 `ASTER_APPROVAL_OK` 新增内容，随后暂存并 commit。

区块 stage/unstage/revert、split view、虚拟化和行内评论仍属于阶段 9 后续，不以当前 unified viewer 冒充完成。
