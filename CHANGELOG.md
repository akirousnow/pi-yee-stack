# Changelog

## [0.3.0] - 2026-11-19

`pi-wish-specializer` 更名并重构为通用扩展 **`pi-yee-stack`**：一次安装、一个多标签配置页，Wish 行为照旧，新增 Ask 只读问答模式。

### 新增

- `/yee-config`：多标签配置页（**Wish** / **Ask**），改动立即保存。`/yee-config ask` 可直接打开 Ask 标签；`/wish-config` 保留为打开 Wish 标签的旧入口。
- **Ask 模式**（只读问答）：
  - `/ask` 切换、`/ask <问题>` 进入并提问、`/ask on|off|status`，快捷键默认 `Ctrl+Alt+A`（可在 `/yee-config → Ask` 修改），`--ask` 启动参数。
  - 进入后 agent 只做问答：放行 `read` / `grep` / `find` / `ls`、声明了 `readOnlyHint` 的工具、以及你在配置里勾选的工具；`bash` / `powershell` / `edit` / `write` 永远不放行。
  - 三层保证：缩减工具集（每次回答前重新校正）、`tool_call` 拦截、`<yee-ask>` 系统提示词分区。
  - 模式按会话保存，`/reload`、`/resume`、`pi -c`、`/tree` 后恢复；退出时恢复进入前的工具。
- 快捷键可以清除（`Backspace`）；Wish 与 Ask 的快捷键不能相同，冲突时 Wish 保留。
- 启动时检测到旧的 `pi-wish-specializer` 仍在加载会提示一次。

### 变更

- 包名 `pi-wish-specializer` → `pi-yee-stack`，GitHub 仓库同步更名（旧地址自动跳转）。
- 配置文件改为 `~/.pi/agent/yee-stack.json`，首次运行时自动导入旧的 `wish-specializer.json`（旧文件原样保留）。
- 配置保存前会重新读取文件、原子写入，多个 Pi 同时运行不再互相覆盖。
- 模型选择改为可搜索的列表（原来是不可搜索的下拉）。
- 代码拆分为 `extensions/yee-stack/`（`features/wish`、`features/ask`、`ui`），入口改为 `./extensions/yee-stack/index.ts`；新增单元测试与 `npm test`。

### 不变

- `/wish`、`Ctrl+Alt+W`、三个档位、系统提示词、浮窗交互、模型固定与回退逻辑与 0.2.0 完全一致（提示词与文本处理函数已逐项对比）。

### 迁移

先 `pi remove` 旧包再 `pi install git:github.com/akirousnow/pi-yee-stack@v0.3.0`，否则两个包会重复注册 `/wish` 与快捷键。详见 README。

## [0.2.0] - 2026-11-18

### 新增

- `/wish-config`：配置许愿模型、默认风格和触发快捷键，并长期保存。

## [0.1.1] - 2026-11-18

### 修复

- 许愿浮窗增加留白。

## [0.1.0] - 2026-11-18

### 新增

- 许愿特化器：快捷键与 `/wish [light|standard|heavy] <愿望>`，可编辑的浮窗，确认后写回输入框。
