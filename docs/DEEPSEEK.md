# DeepSeek 一级提供商

## 运行方式

Aster 不修改用户的全局 `~/.codex/config.toml`。启动 app-server 时使用进程级 `-c` 参数注册 `model_providers.deepseek`：

- `base_url="https://api.deepseek.com"`
- `env_key="DEEPSEEK_API_KEY"`
- `wire_api="responses"`
- `supports_websockets=false`

密钥优先从启动环境读取；用户也可在“设置 → DeepSeek Responses”中保存。保存值经 Electron `safeStorage` 交给操作系统加密，仓库外文件以 `0600` 原子写入。renderer 只能写入新密钥和读取布尔状态/来源，永远无法读回密钥。provider 重配置期间若存在活动 turn 会拒绝重启。

## 当前能力

| 能力 | `deepseek-v4-flash` | 说明 |
|---|---:|---|
| Responses API | 是 | 正式 wire API |
| 文本输入 | 是 | 1M context；客户端仍限制单次 composer 输入 |
| 函数工具 | 是 | 已验证 Responses 工具回传 |
| custom `apply_patch` | 是 | 已经 app-server 真实创建文件 |
| 推理 | 是 | none/low/high/max；不宣称 reasoning summary |
| Web Search | 是 | 服务端工具；每个 search call 独立检查状态 |
| 图片/文件输入 | 否 | UI 明确说明，不发送占位降级 |
| MCP/Code Interpreter/Computer Use | 否 | 不支持且不静默忽略 |
| Stateful/Background Responses | 否 | 客户端保存并回放完整历史 |
| WebSocket Responses | 否 | 使用 SSE |

`deepseek-v4-pro` 虽可从模型目录观察到，但截至 2026-08-10 调用 Responses 返回 HTTP 400。UI 保留禁用项并显示原因，不切换到 Chat Completions，也不冒充 Codex 兼容。

## 验证证据

- 官方 API 的非流式、SSE、函数工具回传和服务端 Web Search 已用现有安全凭据验证。
- Electron E2E 真实选择 `modelProvider=deepseek`、`model=deepseek-v4-flash`、`effort=low`。
- 模型产生 reasoning 活动并调用 custom `apply_patch`；app-server 可能将该 custom tool 归一为 commandExecution 或 fileChange，UI 均以结构化活动展示。
- 临时项目最终存在 `aster-deepseek-proof.txt`，内容精确为 `DEEPSEEK_TOOL_OK\n`，最终 agent 消息精确为 `ASTER_DEEPSEEK_OK`。
- credential store、环境优先级、provider 热重启参数和无明文持久化有自动测试。
