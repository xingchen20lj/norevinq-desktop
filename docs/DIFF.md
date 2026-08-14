# 代码差异审阅

## 当前实现

- 分别读取 working 与 staged 快照。
- tracked 文件由 `git diff --no-ext-diff --no-color --unified=3` 产生；staged 增加 `--cached`。
- untracked 文本由主进程生成明确的 `/dev/null → b/path` 新文件 patch；包含 NUL 的文件只标记为二进制，不解码。
- untracked 预览拒绝符号链接、非普通文件、仓库逃逸和控制字符路径；保留可执行位与“末尾无换行”语义。
- 每个文件统计 additions/deletions，保留 rename oldPath 与 Git XY 状态。
- Git 面板可在 unified/split 两种视图间切换；新增、删除、上下文行携带准确的新旧行号。
- 每个结构化 hunk 都有主进程生成的随机标识。renderer 只能引用短期快照 ID 与 hunk ID，不能通过 IPC 提交任意 patch。
- working hunk 支持 stage 和显式确认后的反向 revert；staged hunk 支持 unstage。每次操作先执行 `git apply --check`，再从 stdin 应用同一份主进程缓存 patch。
- 快照五分钟过期且单次使用；应用后强制刷新 diff 与仓库状态，避免陈旧 patch 或重复副作用。
- 选择任意可评论行后可附带文件、旧/新行号、hunk header 和受限代码上下文，真实调用 `turn/start` 或运行中 `turn/steer` 追加给当前智能体任务。

## 资源边界

- 每次最多 200 个文件。
- 单文件 patch 最多 2 MiB，超出后标记 truncated。
- 总 patch 最多 16 MiB，超出后停止装载后续内容并显示全局提示。
- 截断文件不解析 hunk，也不开放区块操作。
- 最多缓存 64 个短期快照；离屏 hunk 使用 Chromium `content-visibility` 跳过布局与绘制。
- Git 子进程无 pager、无外部 diff、无颜色、30 秒超时、无交互式凭据提示。

## 验证

- 真实仓库覆盖两个相距较远的 tracked hunk，并逐项验证 stage、unstage、revert 只作用于选中区块。
- 覆盖过期快照拒绝、untracked revert 拒绝、带空格且末尾无换行的新文件精确暂存，以及外部符号链接不跟随。
- Electron E2E 打开智能体真实创建的文件，切换 split view、选择新增行、把评论真实追加给 Codex 并收到 `NOREVINQ_REVIEW_OK`，再按区块暂存并 commit。
- 实际检查 1320×840 浅色 split 截图，未见面板溢出、对齐或对比度问题。
