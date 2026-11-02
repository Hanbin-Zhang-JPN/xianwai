# 弦外 · 把话听进心里

面向 iPhone 的中文聊天沟通助手。导入微信聊天截图或文字，在已导入的完整语境中选择一句消息，查看原话依据、不同的可能解释，以及可以自己编辑的回复草稿。

当前可用方式是 **Mac 伴随应用 + iPhone Safari**：Mac 负责截图文字识别和真实 AI 分析，iPhone 扫码配对后使用。无需编译 iPhone App，也无需为这条路径配置模型 API Key。

Xianwai is a Chinese-language communication assistant for iPhone, powered by a paired Mac. It provides screenshot OCR, context-grounded analysis, and editable reply suggestions. Interpretations are hypotheses, not claims about another person's mind.

## 0.3：日常少点几步

- **日常回复**：复制对方刚发的一句 → 打开弦外 → 粘贴到下方 → 点“帮我回”。已有前文自动一起参考，不必每次截图。
- **第一次补前情**：导入历史截图 → 核对 → “保存并帮我回”，省去再次选消息。连续截图的完全重叠消息可选择合并或保留。
- **回复先出现**：先给可直接修改的草稿，分析与原话依据收进“看看为什么这样回”。
- **三种语气即时切换**：一次生成温柔、坦诚和简短三版，不重复请求 AI；各版编辑内容在切换时保留。
- **让它像你说话**：每段对话可设置称呼、默认语气、说话习惯与事实背景，并记住当前选择的对话。
- **前文不掺假**：复制不会自动记为已发送。实际发送后点“我已发出”补入前文，误点可撤销并恢复草稿。
- **关窗继续用**：Mac 窗口关闭后仍在菜单栏后台运行；明确选择“退出弦外并关闭连接”才结束服务。

## 功能

- 批量微信截图导入，Mac 使用 Apple Vision 识别文字；导入前核对发送者、内容和顺序。
- 文本、TXT 和 JSON 导入，可以向当前对话追加消息。
- 在工作台里长按或点击消息，分析目标消息及之前的全部已导入内容。
- 原话引用、多种可能解释、信息不足提示和可确认的问题。
- 温柔、坦诚、简短三种回复语气，支持编辑、复制和收藏。
- Mac 端复用官方 Codex CLI 的已登录账户，支持异步分析、取消和会话内缓存。
- 二维码配对、HTTPS 手机访问、可选的设备保存和 Mac 备份恢复。
- 可选的兼容 Chat Completions 协议的模型 API 后端，以及独立 iOS 工程源码。

## 快速开始：Mac + iPhone

当前构建脚本面向 Apple Silicon Mac，最低 macOS 14。需要：

- Apple Command Line Tools，包含 Swift 与 macOS SDK。
- Node.js 22.13 或以上。
- `cloudflared`。
- 已安装并登录的 ChatGPT 桌面应用，其中的 Codex CLI 能执行 `login status`。

Mac 启动器目前使用 ChatGPT 应用内的 Codex 路径，以及 Homebrew 的 `/opt/homebrew/bin/node`、`/opt/homebrew/bin/cloudflared`。其他安装位置需调整 `desktop/XianwaiMac.swift`。

```sh
git clone https://github.com/Hanbin-Zhang-JPN/xianwai.git
cd xianwai
zsh desktop/build-app.sh
```

构建结果为 `output/弦外.app`，可双击运行或复制到自己的应用程序文件夹。

1. 打开 Mac 上的「弦外」，保持窗口开启，等待手机二维码。
2. 用 iPhone 相机扫码，在 Safari 打开并确认连接 Mac。
3. 点击“导入微信截图”，每次最多选择 12 张，核对识别结果后点击“保存并帮我回”。
4. 回复草稿先出现，可编辑、即时切换语气并复制，再回微信粘贴发送；发送后可点“我已发出”补入前文。
5. Safari 分享菜单 → 添加到主屏幕，下次像 App 一样打开。

Mac 窗口中的“打开 Mac 工作台”也能直接使用。应用在本机临时签名，尚未经过 Apple 公证；仓库不包含 IPA、TestFlight 或 App Store 安装包。

**Mac 需要持续开机、联网。**运行期间会阻止空闲自动睡眠，关闭窗口仍会后台运行，合盖、断网或明确退出应用会中断连接。临时手机地址每次启动会改变，重新打开应用后需重新扫码；主动开启保存的聊天可从 Mac 恢复。Cloudflare 临时连接没有可用性保证，失败时可点击“重新连接”。

## 只体验网页

无第三方 npm 依赖：

```sh
npm start
```

打开 `http://127.0.0.1:4388`。未连接模型时使用明确标注的本地关键词规则，**本地规则不代表大模型分析**。扫描 Mac 应用二维码后可使用 Mac OCR 与 Codex 分析；也可按下一节配置独立模型 API。

文本格式示例，内容为虚构：

```text
我：今晚一起吃饭？
对方：好呀，我等你。
我：临时有个会，可能晚一点。
对方：算了，你忙吧。
```

JSON 格式：

```json
[
  {"role": "me", "text": "今晚一起吃饭？"},
  {"role": "partner", "text": "好呀，我等你。"}
]
```

未标记发送者的行暂记“对方”并高亮，需人工核对。每段最多 300 条、每条最多 2,000 字、合计最多 80,000 字；超出会提示，不会静默截断。

分析使用**目标消息及之前的全部已导入消息**，加上该对话的关系背景。不读取其他对话，也不借用目标之后的消息。引用编号是工作台内的消息顺序，不是微信原始消息 ID。

## 可选：使用模型 API

这是一条独立于 Mac Codex 桥接的可选路径。

1. 复制 `.env.example` 为 `.env`，在本机填写 `AI_API_KEY`，不要提交到仓库或填进网页。
2. 按需配置 `AI_BASE_URL`、`AI_MODEL`，运行 `npm start`。
3. 工作台 → 设置与隐私 → 主动开启在线 AI。本机使用时后端地址可留空。

默认配置使用 DeepSeek 的 Chat Completions 接口，也可配置兼容该 JSON 协议的 HTTPS 服务。模型 API 费用由所配置的服务账户承担，和 Codex 账户额度分开。

自行部署远程后端时需要 HTTPS 与 `API_TOKEN`；非回环地址监听必须配置令牌。在客户端填入后端根地址和访问令牌，访问令牌不是模型 API Key。

- `GET /api/health`：返回服务是否就绪。
- `POST /api/analyze`：接受 `{messages, targetIndex, tone, note}`。`targetIndex` 从 0 开始，`tone` 为 `warm`、`honest`、`brief`。

后端面向个人测试，多人部署还需用户认证、额度管理和用户数据隔离。调用失败会明确显示，不会悄悄改用本地规则。

## 数据与隐私

- 截图通过 Cloudflare HTTPS 连接发送到自己的 Mac，在 Mac 使用 Apple Vision 识别，完成后删除临时图片。识别可能有错字、拆分错误或发送者误判，需核对。
- 主动选择分析时，相关文字和背景通过 Codex 发送给 OpenAI，使用当前 Codex 账户额度。可选 API 路径发送给所配置的模型提供方。
- Codex 通过官方 CLI 使用已有登录，使用临时会话；代码不读取、复制或导出登录凭据。分析关闭了工具和插件能力，不提供任意命令执行接口。
- 配对使用每次启动随机生成的 256 位令牌，数据接口需要验证。请勿转发二维码或配对链接。
- 未开启保存时，聊天与收藏默认只在当前页面内存中。主动开启后，在当前设备与 Mac 保存，**未加密**。
- Mac 备份默认位于 `~/Library/Application Support/Xianwai/workspace.json`，权限为 `0600`。设置可清除当前设备和已连接 Mac 的备份；导出文件与剪贴板需另行管理。
- 项目没有聊天遥测或广告。仓库只包含源码、图标和虚构测试，不包含用户聊天、密钥、配对链接或私有部署配置。

## iOS 原生工程

`ios/Xianwai.xcodeproj` 包含 SwiftUI / WKWebView 容器、相册选择、Apple Vision OCR、原生复制和 JSON 分享。最低 iOS 16，需要完整 Xcode、自己的开发团队和 Bundle Identifier 才能构建安装。

修改网页后运行 `npm run sync:ios` 同步资源。原生工程目前只完成语法与工程文件校验，尚未进行完整 iOS 编译和真机验证。当前可用的手机入口是 Mac 配对后的 Safari 网页。

## 验证

```sh
npm test
```

14 项自动检查覆盖导入格式、发送者不确定性、数据上限、前情与后续消息边界、本地语气、明确拒绝、安全信号、引用校验、API 错误、配对鉴权、偏好备份恢复、截图边界去重、快速粘贴与三种语气选择。检查使用虚构数据与模拟模型响应，不需要真实模型密钥。

开发机上另已完成虚构截图的 HTTPS 上传、实际 Vision OCR、发送者核对、真实 Codex 分析和回复复制的端到端验证。手机尺寸使用浏览器验证，未进行 iPhone 真机测试。

## 项目结构

| 目录 / 文件 | 用途 |
| --- | --- |
| `dist/` | 无构建步骤的中文网页工作台 |
| `desktop/` | Mac 应用、OCR、配对后端和构建脚本 |
| `lib/codex.mjs` | Codex CLI 分析桥接 |
| `lib/ai.mjs` | 可选模型 API 和输出校验 |
| `server.mjs` | 本机 / 自部署模型 API 后端 |
| `ios/` | iPhone 原生工程源码 |
| `tests/` | 虚构数据与 HTTP 检查 |
| `PRODUCT.md` | 产品范围与后续方向 |

## 平台边界

这是主动导入聊天的沟通辅助工具，不是微信插件。普通 iOS App 无法直接读取微信私有聊天数据；本项目不能把分析功能加入微信原有的长按菜单，也不能知道另一个人的真实心思或保证回复一定有效。

参考：[Apple 应用沙盒](https://support.apple.com/guide/security/security-of-runtime-process-sec15bfe098e/web)、[Apple Vision](https://developer.apple.com/documentation/vision/recognizing-text-in-images)、[Codex 非交互运行](https://learn.chatgpt.com/docs/non-interactive-mode)、[Cloudflare 临时连接](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)、[DeepSeek 接口](https://api-docs.deepseek.com/)。
