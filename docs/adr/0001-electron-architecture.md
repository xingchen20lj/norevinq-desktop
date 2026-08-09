# ADR-0001：采用 Electron 的隔离多进程架构

- 状态：接受
- 日期：2026-08-10

## 背景

应用需要同时承载 Node.js 22.13+ 的 Codex Security SDK、启动 Codex app-server、PTY 终端、Git 子进程、系统 keychain 和跨平台桌面 UI。Tauri 可减小安装体积，但仍需额外 Node sidecar 才能运行官方安全 SDK 和现有 TypeScript 集成层，增加生命周期、打包和签名复杂度。

## 决策

使用 Electron 43 + React 19 + TypeScript。主进程承担可信本地能力，预加载层只暴露类型化白名单，渲染器启用 Chromium sandbox、context isolation 并禁用 Node integration。

## 后果

- 优点：官方 TypeScript SDK 可直接集成；macOS/Windows 共用绝大多数代码；PTY 和 app-server 生命周期简单。
- 代价：安装包与内存开销高于原生 WebView；需进行启动、内存、长时间流和多窗口性能治理。
- 约束：禁止从远程 URL 加载主 UI；设置 CSP；外链用系统浏览器；所有 IPC 输入运行时校验。
