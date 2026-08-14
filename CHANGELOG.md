# Changelog

本项目的显著变更记录在此文件中，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本遵循语义化版本。

## [Unreleased]

### Added

- Apache-2.0 开源许可证、贡献指南、行为准则、支持说明和 GitHub 模板。
- 面向首次贡献者的源码运行、质量验证和 macOS/Windows 打包指南。
- 公开发布检查表和经过隐私检查的实际产品截图。
- Codex Security 可直接选择经 Norevinq 0.1.0 在线 sealed 扫描验证的 DeepSeek V4 Flash 或 V4 Pro，无需 OpenAI 登录；扫描卡实时显示输入、缓存命中/未命中、输出、推理 token 及人民币费用估算。进一步对照确认 Flash 早期失败与旧运行时/并发收敛组合有关，现已固定复用 Norevinq 0.147.0 并采用单线程审计，真实一文件标准扫描于 160.9 秒完成并通过 `completed + sealed`。
- macOS Deep Scan 保留官方外层安全沙箱，仅取消 discovery worker 的重复 Seatbelt；真实一文件扫描完成 discovery、validation、attack path、reporting 与 sealed 闭环。失败时优先展示协调器清单中的原始故障，不再被二次完成保存错误覆盖。

### Changed

- Codex app-server 协议绑定改为由锁定的 `@openai/codex` 项目依赖生成，清单不再记录本机绝对路径或非稳定 ChatGPT bundle 版本。
- Codex Security 升级到 0.1.11，并以公开 Apache-2.0 补丁增加固定 DeepSeek provider、实例级凭据环境和 token usage 回调；补丁范围与上游限制均公开记录。

## [0.1.0] - Unreleased

首个公开预览版本正在准备中。功能完成度与验证状态见 [docs/FEATURE_PARITY.md](docs/FEATURE_PARITY.md)。
