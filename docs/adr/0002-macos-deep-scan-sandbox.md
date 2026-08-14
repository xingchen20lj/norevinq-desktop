# ADR 0002: macOS 深扫描只使用一层 Seatbelt

状态：已接受（2026-08-14）

## 背景

Codex Security 0.1.11 的 Deep Scan 在受 `codex_security_scan` managed
permission profile 保护的父进程中启动 discovery worker，又固定向 worker
传递 `--sandbox read-only`。macOS Seatbelt 不能可靠嵌套；真实 2117 文件扫描
的所有 worker 都在审阅源码前以 `Operation not permitted` 退出。Codex 上游
构建文档也要求使用 Seatbelt 的测试避开外层 Bazel sandbox。

## 决策

仅在 macOS deep 模式生成私有 Codex 转发器。转发器要求同时满足：存在
`CODEX_SECURITY_SCAN_ID`、命令是 `exec --experimental-json`，并且精确包含
`--sandbox read-only`；满足时把子进程模式改为 `danger-full-access`，其余参数
逐项原样传给锁定的官方 Codex 二进制。

这里的 `danger-full-access` 不会移除或扩大父进程权限。worker 已经继承官方
协调器验证过的外层 managed sandbox，操作系统层实际权限仍由
`codex_security_scan` 限定。非 macOS、standard 扫描、普通任务和不匹配的
Codex 调用不经过改写。

## 验证与取舍

- 未改 Codex Security 插件、扫描提示、finding schema、workbench 或 sealed
  产物；插件版本身份保持真实。
- 一文件 DeepSeek V4 Flash 对照真实完成 discovery、validation、attack path、
  reporting，并返回 `completed + sealed`。
- SDK 自带 Codex 0.144.6 虽越过 EPERM，但同一 Flash worker 在受控时间窗内
  不收敛，因此不作为发布运行时。
- 外层 sandbox 是安全前提；若上游不再提供可验证父沙箱，官方协调器会在
  启动 worker 前失败关闭。
