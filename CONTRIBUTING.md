# Contributing to Norevinq

感谢你为 Norevinq 提交问题、文档或代码。

## 开始之前

- 遵守 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。
- 安全问题不要创建公开 Issue，请按 [SECURITY.md](SECURITY.md) 私下报告。
- 先搜索已有 Issue 和 Pull Request，避免重复工作。
- 较大的产品或架构改动应先创建讨论 Issue，明确用户价值和兼容性边界。

## 开发环境

完整步骤见[新手构建指南](docs/BUILDING.md)。最短流程：

```bash
pnpm install --frozen-lockfile
pnpm verify:ci
pnpm dev
```

项目固定 Node.js 24.14.0 和 pnpm 11.16.0 作为发布基线。不要提交 `node_modules`、构建产物、真实凭据、用户数据库、日志、私有仓库内容或包含个人绝对路径的截图。

## 代码约定

- 保持 Electron Renderer 无 Node integration，通过最小类型化 preload IPC 使用主进程能力。
- 所有 Renderer IPC、协议事件、文件路径、命令参数和外部数据都视为不可信输入。
- 进程执行使用参数数组，不拼接 shell 命令；文件操作必须维持项目/工作树根边界。
- 新功能需要对应的单元、集成或 Electron E2E 证据，不以静态 UI 代替真实闭环。
- 不伪造模型、Git、终端、浏览器或安全扫描结果。

## Codex 协议变更

协议绑定必须由锁定的项目依赖生成：

```bash
pnpm schema:sync
pnpm typecheck
```

审阅 `src/generated/codex/manifest.json` 的稳定版 Codex 版本和哈希，并提交全部生成差异。生成器默认优先使用 `node_modules/@openai/codex`，不会记录贡献者本机绝对路径。

## Pull Request

1. 从最新 `main` 创建短生命周期分支。
2. 只提交本次改动相关文件。
3. 运行 `pnpm verify:ci`；涉及打包时再运行目标平台 packaged E2E。
4. 在 PR 中说明变更、原因、用户影响、测试证据和已知限制。
5. 保持 CI 通过并处理审阅意见。

贡献在没有另行书面声明的情况下按 [Apache License 2.0](LICENSE) 提交。提交贡献即表示你有权按该许可证提供相关内容。
