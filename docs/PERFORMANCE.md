# 性能基线与预算

最后验证：2026-08-11（macOS 15.7.9、Intel x86_64、16 GiB RAM、Electron 43.3.0、Node.js 24.14.0）

性能数字是当前机器上的可重复工程基线，不是对所有硬件的绝对承诺。CI 使用宽松上限捕获数量级回归；发布前仍需在 macOS Apple Silicon 与 Windows 真机复测。

## 首屏与包体

阶段 19 前，Renderer 的唯一 JavaScript 入口为 1,204.97 kB，终端和所有低频工作台都在应用启动时解析。阶段 19 将终端、设置、安全、计划任务、文件、浏览器和命令面板改为 `React.lazy` 边界：

| 指标 | 优化前 | 优化后 | 变化 |
|---|---:|---:|---:|
| 首屏 JavaScript | 1,204.97 kB | 643.29 kB | -46.6% |
| 首屏 CSS | 约 74.9 kB | 67.81 kB | xterm CSS 延迟加载 |
| xterm 核心 | 首屏内 | 411.70 kB 独立 chunk | 首次打开终端加载 |
| Renderer 全部资产 | 单一主包 | 1,257.4 KiB | 总功能不缩水，按需解析 |

`pnpm check:bundle` 从生产 `index.html` 解析真实首屏资产并执行以下预算：

- 首屏 JavaScript 不超过 700 KiB；
- 首屏 CSS 不超过 80 KiB；
- Renderer 全部资产不超过 1.4 MiB。

该预算已加入 `verify` 与 `verify:ci`，不能通过改文件名或只查看 gzip 数字绕过。

## 桌面冷启动和内存

`pnpm test:e2e:performance` 使用全新 user-data 目录启动真实 Electron 应用，等待 `.app-shell` 可见并读取 Electron 进程指标。2026-08-11 基线：

- Electron launch 到首屏可见：2,147.8 ms；
- Renderer DOMContentLoaded：345.3 ms；
- 主进程、Renderer、GPU/utility 共 4 个进程：工作集总计 307.1 MiB；
- 守门上限分别为 15 s、5 s 与 1,500 MiB，用于检测失控回归而不是掩盖硬件差异。

## 大数据量路径

`pnpm test:performance` 使用真实实现而非静态结果：

- 5,000 条活动历史上，对最新活动连续应用 2,000 个流式 delta：两次观测为 15.8–139.0 ms；
- 真实 SQLite 中保留 3,000 条计划任务运行，读取最近 1,000 条并批量标记已读：两次观测为 20.9–22.7 ms；
- 流式活动查找由正向全历史扫描改为从最新项反向查找，数组仍保持不可变领域契约；
- 活动卡使用 `content-visibility` 跳过离屏布局与绘制；
- SQLite migration v7 为项目最近访问和计划运行时间排序添加索引；“全部已读”由逐条 JSON 解析/写回改为单条原子 SQL；
- 终端主进程与 Renderer 各自保持 4 MiB 有界缓冲，xterm scrollback 为 10,000 行；日志仍为 2 MiB、3 份轮转；diff 保持 200 文件、16 MiB 总预算。

性能测试门槛刻意高于本机基线，以避免共享 CI 上的偶发抖动；具体基线变化必须在本文件说明原因。

## 验证命令

```bash
pnpm test:performance
pnpm test:e2e:performance
pnpm build
pnpm check:bundle
pnpm verify:ci
```

在线模型额度不会影响这些性能测试；app-server 只需完成本地初始化，不发起模型 turn。
