# Yee Stack for DeepSeek Harness

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 版的 Yee Stack：**一个 bundle，三个功能**。

| 功能 | 入口 | 一句话 |
|---|---|---|
| **Wish** 许愿特化器 | `/wish [light\|standard\|heavy] <愿望>` | 一次私有补全，把一句话愿望补成“方向性要求”，结果作为命令文本返回 |
| **Ask** 只读问答 | `/ask`、`/ask <问题>`、`/ask on\|off\|status` | 只读工具集 + 单调 guard + 提示词分区，三层保证不改文件、不跑命令 |
| **Browser** 浏览器操控 | `/browser`、`browser_*`、`$t3` | 自己拉起 chrome-devtools-mcp，选定 tab 后看快照、点击、填表 |
| **设置** | `/yee-config` | 打印当前解析后的设置 |

与 Pi 版共享 `@yee-stack/core`、`@yee-stack/{wish,ask,browser}`：提示词、工具策略、`$tN` 解析、快照 diff、chrome-devtools-mcp 连接规划都是同一份代码。

## 安装

从仓库 checkout 安装（会 `pnpm link` 整个目录）：

```bash
npm install && npm run build          # 先构建 core / features / dsh
dsh plugin --profile <name> add ./packages/dsh
dsh --profile <name> --dump-config | grep -A 2 'yee-stack'
dsh --profile <name>
```

也可以 `pnpm pack` 出 tarball 再 `dsh plugin --profile <name> add ./yee-stack-dsh-0.5.0.tgz`。

安装后多出一层：

```yaml
# == @yee-stack/dsh
- id: yee-stack
  name: '@yee-stack/dsh'
```

## 配置

改 profile 自己的 `cordis.patch.yml`（或 home 级 `$DSH_HOME/cordis.patch.yml`），**整块替换** `config`：

```yaml
- id: yee-stack
  config:
    wish:
      tier: heavy          # light / standard / heavy
      maxTokens: 900
    ask:
      extraTools: [web_search]     # 额外放行的工具名
      section: |                   # 覆盖 Ask 模式注入的提示词
        This session is read-only Q&A.
    browser:
      connect: launch      # auto / url / launch
      channel: stable      # stable / beta / dev / canary
      endpoint: ''         # connect=url 时：http://host:9222 或 ws://…
      executable: ''       # connect=launch 时的 Chrome 路径
      headless: auto       # auto / on / off
      profileDir: ''       # connect=launch 时的用户数据目录
      allowEval: false     # 允许页面里执行 JavaScript
      allowRemoteUpload: false  # 允许向远程 Chrome 上传文件（绕过本机项目目录校验）
      listenOnStartup: false
```

改完 `/reload`（HMR）或重启 dsh。`/yee-config` 会打印解析后的值。

## Wish

```text
/wish 做一个深色主页，卖手冲咖啡
/wish heavy 给我一个可操作的坦克模型展示页
```

- 走 `ctx.llm.prepareCall()` + `stream` + `BlockAssembler`（harness 没有 `llm.complete()`），用**当前会话的模型路由**，不额外登录、不改会话模型；
- 原话一个字不改，只补方向；结果作为命令文本返回，复制进输入框即可（也可以自己再改）；
- 输出上限由 `wish.maxTokens` 控制；模型报错、被取消、返回空内容时都不会产出半截结果。

## Ask

```text
/ask                     # 切换
/ask 这个项目的入口在哪？   # 开启并直接提问
/ask on / off / status
```

三层保证：

1. **工具集**：开启时在 agent 自己的作用域上调 `ctx.tools.restrict({ allow })`，只留 `read`、`read_image`、`glob`、`grep` 和 `ask.extraTools`；
2. **guard**：`ctx.tools.guard()` 在 pre-execute 之后单调否决，`bash` / `pwsh` / `write` / `edit` / `apply_patch` / `run_code` 永远不放行，后注册的插件也翻不了案；
3. **提示词**：`yee:ask` 分区只在模式开启时注入。

开关状态是 `yee/ask` 日志事件 + `yee-ask` 投影，**按会话保存**，resume / fork 后恢复。

## Browser

```text
/browser                # 未连接时连接，已连接时列 tab
/browser on http://127.0.0.1:9222
/browser launch         # 独立 profile 启动 Chrome（无显示器时无头，root 自动 --no-sandbox）
/browser off / status / tabs
/browser use $t3
```

15 个 `browser_*` 工具：`tabs`、`snapshot`、`screenshot`、`navigate`、`new_tab`、`close_tab`、`click`、`hover`、`fill`、`fill_form`、`type`、`press`、`wait`、`dialog`、`upload`。

- `page` 参数可省略，默认当前 tab；只有一个 tab 时直接用它；多个 tab 又没选时会报错并列出 tab；
- 发消息里带 `$t3` 会把那个 tab 设为当前（消息本身不改写，`yee:browser` 分区解释它是什么）；
- 操作类工具带 `includeSnapshot`，但只回传**新增或变化**的元素；导航后回整页；
- `browser_screenshot` 把图写到临时文件并在结果里给路径，用 `read_image` 查看（harness 的 image block 需要附件服务，这里不伪造）；
- 工具只在连接期间存在（`when` 条件），断开即消失。

浏览器实现自带一个小的 MCP stdio 客户端（`src/mcp.ts`）：harness 的 `dsh-mcp-client` 会把工具直接注册进 `ctx.tools`、但不给调用句柄，而 `/browser`、tab 列表和提示词分区都要在模型回合之外调 `list_pages`。

## 与 Pi 版的差异

| | Pi | DeepSeek Harness |
|---|---|---|
| Wish 结果 | 浮窗里改完写回输入框 | 作为命令文本返回，自己复制 |
| 快捷键 | `Ctrl+Alt+W` / `Ctrl+Alt+A` | 无（宿主命令面板） |
| `$tN` 补全 | 输入框里 `$` 补全 | 无补全，直接写 `$t3` |
| 设置页 | 多标签 TUI 页 | `/yee-config` 打印 + patch 文件 |
| 只读工具名 | `read`/`grep`/`find`/`ls` | `read`/`read_image`/`glob`/`grep` |

## 开发

```bash
node scripts/link-dsh.mjs            # 类型检查用：软链本机 dsh 的 @deepseek-ai/*
npm run build -w @yee-stack/dsh
npm run test -w @yee-stack/dsh       # ask / wish / browser / config
```

验证一个 checkout 不装进 profile 也能组合：

```bash
dsh --profile <name> --patch ./packages/dsh/cordis.patch.yml --dump-config
```

## License

MIT
