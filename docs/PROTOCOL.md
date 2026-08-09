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

1. 发现并探测 Codex 二进制。
2. 启动 `codex app-server --listen stdio://`。
3. 完成 initialize/initialized。
4. 读取 `model/list` 并转换为稳定领域模型。
5. 发布 `ready` snapshot 到类型化 IPC 和 UI。

空闲状态异常退出时最多指数退避重启三次。运行中 turn 异常退出时不自动重放，因为命令或文件修改可能已经产生副作用；客户端显示失败并等待显式恢复。

## 日志

stderr 与生命周期事件写入用户数据目录的 `logs/runtime.jsonl`。日志在序列化前递归脱敏 Authorization、Bearer、API key、JWT、Cookie、私钥、URL query secret 和敏感字段；单文件 2 MiB，保留三个轮转文件，权限为 `0600`。

## 验证证据

- JSONL/RPC 单元测试覆盖分帧、超时、反向请求、错误、EOF、最大行、写背压和 Codex 省略 header 方言。
- 二进制发现单元测试覆盖优先级、去重和失败路径。
- 2026-08-10 Playwright Electron E2E 真实启动 app-server，断言 phase 为 `ready`、版本包含 `codex-cli` 且模型目录非空（实际 6 个模型）。
