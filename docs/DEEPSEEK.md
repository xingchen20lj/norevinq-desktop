# DeepSeek 一级提供商

## 运行方式

Aster 使用独立的 `userData/codex-home`，不读取或修改官方客户端的 `~/.codex/config.toml`。启动 app-server 时使用进程级 `-c` 参数注册 `model_providers.deepseek`：

- `base_url="https://api.deepseek.com"`
- `env_key="DEEPSEEK_API_KEY"`
- `wire_api="responses"`
- `supports_websockets=false`

密钥优先从启动环境读取；用户也可在“设置 → DeepSeek Responses”中保存。保存值经 Electron `safeStorage` 交给操作系统加密，仓库外文件以 `0600` 原子写入。renderer 只能写入新密钥和读取布尔状态/来源，永远无法读回密钥。provider 重配置期间若存在活动 turn 会拒绝重启。

## 当前能力

| 能力 | `deepseek-v4-flash` | `deepseek-v4-pro` | 说明 |
|---|---:|---:|---|
| Responses API | 是 | 是 | 正式 wire API |
| 文本输入 | 是 | 是 | 1M context；客户端仍限制单次 composer 输入 |
| 函数工具 | 是 | 是 | Responses 工具回传 |
| custom `apply_patch` | 是 | 是 | Codex 文件修改工具 |
| 推理 | 是 | 是 | none/low/high/max；不宣称 reasoning summary |
| Web Search | 是 | 是 | 服务端工具；每个 search call 独立检查状态 |
| 图片/文件输入 | 否 | 否 | UI 明确说明，不发送占位降级 |
| MCP/Code Interpreter/Computer Use | 否 | 否 | 不支持且不静默忽略 |
| Stateful/Background Responses | 否 | 否 | 客户端保存并回放完整历史 |
| WebSocket Responses | 否 | 否 | 使用 SSE |

`deepseek-v4-pro` 在 2026-08-10 的首次探测中仍返回 HTTP 400；截至 2026-08-13，官方 Responses reference 和 Codex catalog 已将 Pro 列为支持模型，当前账户的最小非流式请求也真实返回 `completed` 和精确输出 `ASTER_PRO_OK`。Aster 因此正式显示 Flash 与 Pro 两个可选模型，不切换到 Chat Completions。

## 验证证据

- 官方 API 的非流式、SSE、函数工具回传和服务端 Web Search 已用现有安全凭据验证。
- `deepseek-v4-pro` 已用当前安全环境凭据真实验证 Responses 非流式完成；专属 Electron E2E 又经随应用固定的官方 Codex 0.147.0 完成真实 `apply_patch` 闭环，耗时 47.9 秒。
- Electron E2E 真实选择 `modelProvider=deepseek`、`model=deepseek-v4-flash`、`effort=low`。
- 模型产生 reasoning 活动并调用 custom `apply_patch`；app-server 可能将该 custom tool 归一为 commandExecution 或 fileChange，UI 均以结构化活动展示。
- 临时项目最终存在 `aster-deepseek-proof.txt`，内容精确为 `DEEPSEEK_TOOL_OK\n`，最终 agent 消息精确为 `ASTER_DEEPSEEK_OK`。
- Pro 临时项目最终存在 `aster-deepseek-pro-proof.txt`，内容精确为 `DEEPSEEK_PRO_TOOL_OK\n`，最终 agent 消息精确为 `ASTER_DEEPSEEK_PRO_OK`；活动时间线真实出现文件修改/命令结构化卡片。
- credential store、环境优先级、provider 热重启参数和无明文持久化有自动测试。
- [DeepSeek Responses API Reference](https://api-docs.deepseek.com/api/create-response/)
- [DeepSeek 官方 Codex 集成](https://api-docs.deepseek.com/quick_start/agent_integrations/codex/)
