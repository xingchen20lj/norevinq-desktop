# 集成终端

## 公开能力依据

- OpenAI 官方集成终端文档说明：每个任务的终端限定到当前项目或工作树，可从右上角入口或 `Ctrl`+`` 打开，并允许用户把当前终端输出提供给 Codex。
- 当前 Codex app-server 0.147 stable schema 公开 `command/exec`、`command/exec/outputDelta`、`command/exec/write`、`command/exec/resize` 与 `command/exec/terminate`。
- Aster 直接使用上述 PTY 协议，不解析 Codex TUI 文本，也不引入 `node-pty` 原生模块。
- 终端渲染使用 `@xterm/xterm` 6.0.0、`@xterm/addon-fit` 0.11.0 与 `@xterm/addon-search` 0.16.0；`pnpm peers check` 无冲突。

官方来源：

- <https://learn.chatgpt.com/docs/integrated-terminal>
- <https://learn.chatgpt.com/docs/app-server>
- <https://github.com/xtermjs/xterm.js/releases/tag/6.0.0>

## 运行架构

1. renderer 只请求创建一个绑定 `projectId`、可选 `worktreeId` 和可选 `threadId` 的会话，不能指定任意可执行文件或启动参数。
2. main 从 SQLite 重新解析项目/托管工作树 cwd；工作树必须属于同一项目且目录仍存在。
3. main 选择本机登录 shell，生成连接级随机 `processId`，以 `command/exec` 启动 `tty=true`、流式 stdin/stdout/stderr、无服务端超时的 PTY。
4. app-server 发送 base64 增量；main 校验尺寸和 base64 后用 `StringDecoder` 保证跨分片 UTF-8 正确，再通过类型化 IPC 发送领域事件。
5. xterm.js 渲染 ANSI/VT 输出，FitAddon 产生字符单元尺寸，SearchAddon 在本地滚动缓冲中查找。
6. 输入、调整尺寸、终止和关闭分别映射到 app-server 的 write/resize/terminate；终端长请求在 JSON-RPC 层显式无客户端超时，但连接关闭会拒绝并结束。

终端是用户直接控制的本地 shell，因此使用 app-server 的 `dangerFullAccess` sandbox policy；智能体不能借终端 UI 绕过其 turn 审批和沙箱。renderer 仍受 CSP、sandbox、context isolation 和运行时 IPC schema 约束。

## 资源与安全边界

- 最多同时打开 12 个会话。
- main 与 renderer 各只保留最近 4 MiB 输出；xterm scrollback 为 10,000 行。
- 单次输入最多 64 KiB；单个协议输出分片限制约 1 MiB 解码后数据。
- PTY 尺寸限定为 2–500 列、2–300 行。
- app-server 或连接异常时，会话标记为 failed，不自动重放 shell，避免重复副作用；空闲 app-server 仍可自行恢复。
- 切换 DeepSeek 凭据/重启 runtime 时若有终端或 turn 正在运行会被拒绝。
- 终端输出不会静默注入模型上下文。只有用户点击“共享输出给智能体”时，main 才移除 ANSI/OSC/C0 控制序列，并返回最近 32 KiB 纯文本，通过现有 `turn/start` 或 `turn/steer` 明确追加。
- 清屏同时发送 Form Feed 给 shell 并清除 Aster 缓冲；关闭运行中会话会先请求 terminate。

## 验证

- 单元测试覆盖无超时 JSON-RPC 请求、UTF-8 跨分片、ANSI 清理、输入 base64、resize、正常退出、连接失败、项目/工作树归属、4 MiB 环形边界和超大输入拒绝。
- Electron E2E 通过 xterm 的真实键盘输入执行 `printf` 与 `pwd`，断言输出和 cwd，使用搜索框定位 token。
- E2E 将当前终端输出显式共享给真实 Codex，收到 `ASTER_TERMINAL_CONTEXT_OK`；随后验证清屏、terminate、退出状态和关闭会话。
- 实际检查 1320×840 浅色终端截图：drawer、标签、工具栏、搜索浮层、ANSI 文本与光标没有明显溢出或错位。
