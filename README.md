# Aster Code

Aster Code 是一款面向 macOS 和 Windows 的开源桌面智能编程客户端。它以 Codex app-server 作为本地智能体协议层，当前已完成 OpenAI/DeepSeek Responses、Git 工作树与 GitHub Pull Request、差异审阅、终端、MCP、技能、计划任务和 Codex Security 的阶段性真实闭环。

项目正在按无人值守工程计划持续开发。当前进度、下一步和阻塞见：

- [自主开发状态](docs/AUTONOMOUS_STATE.md)
- [功能一致性](docs/FEATURE_PARITY.md)
- [UI 一致性](docs/UI_PARITY.md)
- [架构](docs/ARCHITECTURE.md)
- [性能基线](docs/PERFORMANCE.md)
- [桌面构建与发布](docs/RELEASING.md)
- [第三方许可证清单](THIRD_PARTY_NOTICES.md)

> 当前已完成完整自动测试、安全加固和性能优化阶段，正在执行桌面打包、发布准备与最终功能一致性审计。功能状态只以自动测试、真实运行证据和功能一致性表为准。

开发验证命令与在线测试边界见 [测试策略](docs/TESTING.md)。当前 Intel macOS 的无签名 DMG/ZIP 已完成真实构建、校验和挂载启动；签名、公证和 Windows 真机安装仍必须在持有相应凭据/系统的发布环境完成。

GitHub Pull Request 功能需要本机安装并登录 `gh`；Aster 不读取 token，而通过 GitHub CLI 的系统凭据存储完成认证。完整安全边界和验证证据见 [Git 工作流](docs/GIT.md)。

Aster 的 SQLite、工作树、日志、凭据和 Codex home 全部位于独立 Electron `userData` 目录。它不会复用官方 Codex 桌面客户端的 `~/.codex`，因此登录、任务和技能设置互不覆盖；首次运行需在 Aster 内单独登录。项目仓库内的 `.codex` 与 `AGENTS.md` 仍按 Codex 项目配置规则共享。
