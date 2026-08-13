# Codex app-server 协议集成

## 当前基线

- 生成时间：2026-08-10
- 本机二进制：`codex-cli 0.147.0-alpha.6.5`
- Stable schema SHA-256：`6e12bb6cb94d3cd91011bc861c5944ba5db7fbeeb406399a3cb9b9e771c27999`
- TypeScript bindings SHA-256：`5f10c708c106231e983254987b980f4484a8bd654ba36a2226e6efd5be12cb8c`
- 生成产物：642 个 TypeScript 文件、285 个 JSON Schema 文件。

完整来源、二进制哈希和文件清单位于 `src/generated/codex/manifest.json`。重新同步：

```bash
pnpm schema:sync
```

工具按显式配置、`CODEX_BINARY`、`PATH`、ChatGPT macOS bundle 的顺序发现二进制；从同一个可执行文件读取版本并生成两类 schema。生成发生在临时目录，完成后原子替换，失败时保留原基线。

## Wire 约束

- stdio 每行一个 JSON 对象。
- 语义遵循 JSON-RPC 2.0，但 app-server wire 省略 `jsonrpc: "2.0"`。
- 客户端先请求 `initialize`，收到成功响应后再通知 `initialized`。
- `clientInfo.name` 固定为 `aster_code`；默认只启用 stable API。
- 每个请求有独立 id、超时和 pending entry；EOF/close/error 会拒绝全部未完成请求。
- 输入单行限制 16 MiB，写队列有界并尊重流背压。
- server→client 审批是 request，不是 notification；未知 request 返回 method-not-found，不伪造批准。

## 生命周期

1. 在 Electron `userData/codex-home` 创建私有 `0700` Codex home；开发/E2E 仅允许用绝对 `ASTER_CODEX_HOME` 显式覆盖。
2. 发现并探测 Codex 二进制。
3. 启动 `codex app-server --listen stdio://`。
4. 完成 initialize/initialized。
5. 读取 `model/list` 并转换为稳定领域模型。
6. 发布 `ready` snapshot 到类型化 IPC 和 UI。

Aster 不读取或写入官方客户端默认的 `~/.codex`。登录、thread、用户级 MCP/技能设置保存在 Aster 私有 home；项目仓库中的 `.codex` 与 `AGENTS.md` 仍按 Codex 公开层级规则生效。首次运行需要在 Aster 内单独登录，避免退出登录、任务列表或技能切换影响官方 Codex 桌面客户端。

空闲状态异常退出时最多指数退避重启三次。运行中 turn 异常退出时不自动重放，因为命令或文件修改可能已经产生副作用；客户端显示失败并等待显式恢复。

## 日志

stderr 与生命周期事件写入用户数据目录的 `logs/runtime.jsonl`。日志在序列化前递归脱敏 Authorization、Bearer、API key、JWT、Cookie、私钥、URL query secret 和敏感字段；单文件 2 MiB，保留三个轮转文件，权限为 `0600`。

## Thread、turn 与审批

- 项目打开后按规范化 `cwd` 调用 `thread/list`；选择历史任务使用 `thread/resume` 并从返回 turns 重建活动状态。
- 新任务依次执行 `thread/start` 和 `turn/start`。默认 `approvalPolicy=on-request`、`sandbox=workspace-write`，模型与推理强度来自真实 `model/list`。
- 所有 notification 进入不可变领域 reducer；渲染器不导入生成协议类型。文本、推理、命令、文件、MCP、动态工具、搜索、计划、协作和错误均有判别联合类型。
- 单活动文本上限 1 MiB，超限记录截断字符数；未知 item/event 保留以便诊断协议漂移。
- `turn/steer` 使用 `expectedTurnId` 防止追加到错误轮次；`turn/interrupt` 必须同时携带 threadId/turnId。
- 命令/文件审批按 request id 与 thread/turn/item 四级标识路由。server request Promise 保持挂起，直到用户选择允许一次、会话允许、拒绝或取消；没有默认批准路径。
- app-server 在活动 turn 中崩溃时不重放，以避免重复命令和文件副作用。

## 验证证据

- JSONL/RPC 单元测试覆盖分帧、超时、反向请求、错误、EOF、最大行、写背压和 Codex 省略 header 方言。
- 二进制发现单元测试覆盖优先级、去重和失败路径。
- 2026-08-10 Playwright Electron E2E 真实启动 app-server，断言 phase 为 `ready`、版本包含 `codex-cli` 且模型目录非空（实际 6 个模型）。
- 2026-08-10 Playwright Electron E2E 在临时真实项目中创建 thread/turn，使用现有 ChatGPT 登录完成在线 SSE 活动，并验证最终消息 `ASTER_RUNTIME_OK`、完成状态、深浅主题和 960×640 布局。
- 同一隔离 E2E 以 read-only 沙箱真实触发 fileChange 反向审批；用户允许后 `apply_patch` 创建文件并精确断言 `ASTER_APPROVAL_OK\n`。随后真实执行 `sleep 8`、在运行中 steer 至 `ASTER_STEER_OK`，并中断另一条 `sleep 20`，确认不产生被禁止的最终回复。
- agent service 协议替身测试覆盖 start/list/resume/steer/interrupt、项目关联持久化和显式反向审批；activity reducer 有 28 个场景并覆盖中断时缺失 item/completed 的归一化。
