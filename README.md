# Wish Specializer for Pi

参考 [dsh-wish-specializer](https://github.com/WestFox-AwA/dsh-wish-specializer) 的思路，为 Pi 的 TUI 写的一个轻量扩展：

- 原话**一个字都不改**，只补上工作模型真正需要的“方向性要求”；
- 支持**快捷键**和 **slash 命令**触发；
- 生成后弹出可编辑的小浮窗，支持 **确认** / **取消**；
- 确认后写回 Pi 输入框，取消则输入框原样保留；
- `/wish-model` 可以从 Pi 当前可用模型里选一个，长期固定给许愿特化器使用。

## 安装

从 GitHub 安装：

```bash
pi install git:github.com/akirousnow/pi-wish-specializer@v0.1.0
```

然后在 Pi 里重新加载：

```text
/reload
```

用 `/hotkeys` 可以在 **Extensions** 一栏看到注册的快捷键。

本地开发/试用：

```bash
git clone https://github.com/akirousnow/pi-wish-specializer.git
pi -e ./pi-wish-specializer

# 或安装为长期包
pi install ./pi-wish-specializer
```

## 使用

### 快捷键

1. 在输入框里写下愿望，例如：
   ```text
   画一只赛博朋克风格的猫，用于网站首屏
   ```
2. 按 `Ctrl+Alt+W`。
3. 等待生成后，在浮窗里编辑结果：
   - `Enter`：确认，写回输入框
   - `Esc`：取消，输入框保持原样
   - `Shift+Enter`：换行
   - `PgUp` / `PgDn`：滚动较长内容
   - `Tab`：编辑器补全（与主编辑器一致）
4. 回到输入框后按 `Enter` 发送。

### 命令

```text
/wish <愿望>
/wish light <愿望>
/wish standard <愿望>
/wish heavy <愿望>
```

示例：

```text
/wish 做一个深色主页，卖手冲咖啡
/wish heavy 给我一个可操作的坦克模型展示页
```

命令执行后输入框会被清空；确认结果时写回输入框，取消则保持为空。

### 选择许愿模型

```text
/wish-model
```

回车后会列出 Pi 当前可用的模型（与 `/model` 使用同一套模型来源）：

- 第一项 `↺ 跟随当前 Pi 模型（默认）`：不固定，始终使用 Pi 当前模型；
- 其余模型会显示 `provider/model`、模型名，并用 `[✓ 固定]` / `[当前]` 标记；
- 选中后立即写入配置文件，**长期生效**，并且不会修改 Pi 自己的当前模型。

配置文件位置：

```text
~/.pi/agent/wish-specializer.json
```

内容示例：

```json
{
  "model": {
    "provider": "magpie",
    "id": "deepseek-v4.1-flash"
  }
}
```

选择“跟随当前 Pi 模型”后，`model` 会写成 `null`。如果固定模型之后不可用（例如登录失效或模型被移除），许愿特化器会提示一次，并临时退回当前 Pi 模型。

## 档位

| 档位 | 行为 | 预算 |
|---|---|---|
| `light` | 只给 2–3 条最高杠杆的方向 | 约 700 字符 |
| `standard` | 4–6 条关键方向 + 一行验收口径（默认） | 约 1200 字符 |
| `heavy` | 把最有决定性的少数方向写透，可带一小段分阶段建议 + 验收口径 | 约 2000 字符 |

档位控制“补多少”，不会替用户做决定。

## 生成规则

系统提示词要求模型：

- 只输出**补充要求**，不重写、不重复原话；
- 使用与原愿望相同的语言；
- 不写代码、不写具体数值参数、不写实现步骤；
- 不替用户做架构/范围/不可逆选择；
- 从这些维度里只挑对结果真正重要的：
  - 审美取向
  - 光影与材质
  - 构图与层次
  - 场景与氛围
  - 交互与状态
  - 验收口径
- 原愿望已经足够具体时，允许零增量。

最终 prompt 的结构是：

```text
<原话，逐字保留>

---

<模型生成的补充要求>
```

## 实现说明

- 默认使用当前 Pi 会话的 `ctx.model`；如果通过 `/wish-model` 固定了模型，则优先使用固定模型。
- 调用 `ctx.modelRegistry.complete()`，模型来源与 Pi 自带的 `/model` 一致。
- 生成期间显示可取消的 loader；`Esc` / `Ctrl+C` 会中止请求。
- 结果浮窗使用 `ctx.ui.custom(..., { overlay: true })`，内含 Pi 的 `Editor` 组件，保留光标、IME、换行、滚动和补全行为。
- 浮窗每行都铺满主题 `customMessageBg` 背景，避免浮在聊天记录上时看不清。
- 如果模型出错、被取消、或返回空内容，不会覆盖输入框。

## 注意事项

- 快捷键需要终端能把 `Ctrl+Alt+W` 传进来；如果被终端占用，直接用 `/wish <愿望>` 即可。
- 优化调用使用当前模型或 `/wish-model` 固定的模型，可能产生一次额外的模型请求。
- 扩展不会修改 Pi 本身，也不会修改 Pi 的当前模型。
