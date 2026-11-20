# Changelog

## [0.4.3] - 2026-11-20

### 新增

- `/browser on <地址>` 和 `/browser launch` 连接成功后会写回 `yee-stack.json`；之后每次 `/browser on` 直接复用上次保存的连接方式和地址。
- `browser_screenshot` 会把截图写到临时文件，并在文本结果里追加 `[截图文件：…]`。codemode 模式丢弃图像块时，可以用该路径配合 `read` + `image()` 查看截图；同时给工具加了对应提示。

## [0.4.2] - 2026-11-20

### 变更

- `browser.focusTab` 默认改为 `false`：发送 `$t3 …` 只在 Pi 里切换当前 tab，不再调用 `select_page` 把 Chrome 切到前台。需要原来的行为时在 `/yee-config → Browser` 打开「选中后切到前台」。
- `browser_new_tab` 默认 `background: true`，新 tab 在后台打开；需要前台时传 `background: false`。
- `$` 补全列表改为显示 tab 标题，`$t3` 和 URL 放在副标题里；插入编辑器的仍然是 `$t3`。

## [0.4.1] - 2026-11-20

### 修复

- `$` 补全包裹了 Pi 的补全器，但 `applyCompletion` 无条件按 tab 处理，导致 `/brow` + Tab 变成 `/browbrowser`。现在只有 `$tN` 补全由浏览器扩展处理，斜杠命令、文件路径和命令参数都交回 Pi。
- `$5`、`$1` 这类纯数字不再被当成 tab 查询，避免和 shell 变量、prompt 模板冲突。

## [0.4.0] - 2026-11-20

新增 **Browser**：用 chrome-devtools-mcp 当引擎，在 TUI 里用 `$t3` 选定 tab 后直接操控真实 Chrome。

### 新增

- `/browser`：连接浏览器、选择 tab、断开、查看状态和 tab 列表；`/browser use $t3` 只切换当前 tab。
- `$` 补全：输入 `$` 列出所有 tab，可按标题 / 域名 / URL 过滤，选中插入 `$t3 `；`$HOME`、`$5` 不匹配时交回 Pi 原来的补全。
- `$t3 …`：发送消息时把 `$t3` 设为本次的当前 tab（可选切到 Chrome 前台），原话不改写，由 `<yee-browser>` 系统提示分区解释。
- 15 个 `browser_*` 工具：tabs / snapshot / screenshot / navigate / new_tab / close_tab / click / hover / fill / fill_form / type / press / wait / dialog / upload。工具只在连接期间激活；`pageId` 可选，默认当前 tab；快照按 uid 只回传新增或变化的元素。
- 三种连接方式：自动（Chrome 144+ 的 `chrome://inspect` 开关，或 `127.0.0.1:9222`）、指定 `http://` / `ws://` 地址、`/browser launch` 启动独立 profile 的 Chrome（没有显示器时无头，root 下自动 `--no-sandbox`）。
- `--browser` 启动参数；`/yee-config → Browser` 标签（连接方式、渠道、地址、Chrome 程序、无头、profile、启动时监听、切到前台、允许执行 JS、快捷键）。
- MCP 子进程是进程级单例，`/reload`、`/new`、`/resume` 不断开；最后一个会话退出后宽限 60 秒再关，退出 Pi 时同步杀掉。
- Ask 模式放行只读的浏览器工具：可以看快照和截图，但不能点击、输入、导航。
- 新增单元测试（refs / tabs / snapshot / args / tools / mode）；真实 chrome-devtools-mcp 的端到端测试验证了 launch、快照、填表、点击和截图。

### 变更

- 配置新增 `browser` 段；快捷键冲突按 Wish > Ask > Browser 保留，后面的会被停用并在启动时提示。
- 新增运行时依赖 `chrome-devtools-mcp ~1.13.0`（Apache-2.0）与 `@earendil-works/pi-mcp ~1.5.2`（MIT）。
- 不提供安全确认：点击、提交、上传都直接执行；需要只读时用 Ask 模式。

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
