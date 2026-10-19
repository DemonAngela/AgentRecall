# Windows 本机双 CLI 适配

范围：此 fork 基于正式 `v0.61.0` 的 AgentRecall **v1**，仅维护本机 CodeBuddy 与 **OpenCode 2** 的读取和原生恢复；不是 AgentRecall v2 预览版，也不是 AionUi 注入插件。

## 启动

在仓库根目录运行：

```powershell
npm run local:v1
```

前置条件：Node 22.13+、可用的 `codebuddy` 与 `opencode2`、已安装并构建的 v1。开发安装使用 `npm run setup:v1`，随后 `npm --prefix apps/main-1.0 run build`；setup 会跳过 Claude 状态栏安装。不要为本功能运行全局 npm 安装。

`node scripts/local-v1.mjs --check` 只检查 CLI 与路径，不打开应用。启动器必须确认 `opencode2 --version` 为 2.x，且 `opencode2 debug paths db` 与当前解析器默认库一致；不一致时停止，而不是回退旧库。实际 CLI 入口从 PATH 解析，优先使用对应 npm `.cmd` shim，不依赖特定用户名或安装盘符。

## 配置与数据边界

- 本机配置和索引：仓库 `.local/windows-v1/`，与正式 AgentRecall 的用户数据隔离，不提交到 Git。
- 每次启动只启用 CodeBuddy/OpenCode，关闭默认 Claude/Codex 历史及其空项目合并。普通上游启动方式仍保留原默认来源。
- 保留本机真实 HOME，原生 CLI 沿用原账户、模型、插件和权限设置，不使用假 HOME 恢复。
- 自动更新、MCP 自动安装、全局 MCP 数据库指针、自动摘要和云同步默认关闭；启动器会重新应用这些本机安全开关，但保留布局和收藏等其他设置。不向 AionUi、Claude 或 Codex 配置注入 hooks。
- 仅读取 OpenCode 2 诊断所报告的 `opencode.db`，不读取其他旧库、不删除或迁移 OpenCode 1 历史。原始 SQLite 以只读方式打开。
- 应用仍包含上游的显式删除、迁移和手动 AI 操作；本适配不将其包装为全功能只读产品。验收时不要点击清理、删除、迁移或 AI 操作。

## 项目目录与恢复

- CodeBuddy 采用日志内 `cwd`；OpenCode 采用源库 `directory/path`。同一路径可在项目侧栏查看两个来源的会话。
- 没有路径的会话保留为“无项目路径”，不解码存储文件夹名称猜测项目，也不自动归类为临时会话。
- 继续会话使用 CodeBuddy 原生 `--resume`，或配置的 OpenCode CLI 原生 `--session ses_…`；不会导出、重建或复制为另一 CLI 会话。
- 启动前要求真实项目目录与源文件仍存在；OpenCode 另只读确认 ID 存在、项目目录一致，避免其在 ID 丢失时悄悄创建新会话。目录不明或已失效时显示错误，不在其他目录兜底启动。
- OpenCode 恢复仅限本机；SSH/WSL、OpenCode 迁移和云同步未适配。保留原权限提示，不添加跳过权限参数。
- 打开项目目录沿用桌面系统文件管理器入口，不新建、移动或删除磁盘文件夹。
- 关闭主窗口可能缩至托盘；完全退出使用托盘菜单。诊断日志在本机配置目录的 `runtime.log`，不要把完整真实日志或索引上传至公开仓库。

## 调试与验证

- 回归入口：`scripts/local-v1-profile.test.mjs`、v1 的 `local-source-profile.test.ts`、`native-resume-preflight.test.ts`、`platform.test.ts` 与 `session-ui.test.ts`。测试使用合成数据与临时目录。
- `--debug-port=<端口>` 仅用于临时回环 CDP 调试；调试结束退出应用，正常启动不传该参数。不要将端口转发、共享或暴露到局域网。
- 原生恢复可启动终端并更新 CLI 自身运行状态，最终应由用户选择一个常用会话确认；自动验证不向真实会话发送消息。
- 修改范围有意只限用户选用的 v1；v2 继续保持独立的 PostgreSQL、设置和恢复能力，不读取或迁移它的数据。
