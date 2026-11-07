# 第三方组件与内容

| 组件                      | 用途                      | 许可证 / 来源                                          |
| ------------------------- | ------------------------- | ------------------------------------------------------ |
| React / React DOM         | 界面                      | MIT · https://github.com/facebook/react                |
| Lucide React              | 界面图标                  | ISC · https://github.com/lucide-icons/lucide           |
| Vite / TypeScript         | 构建                      | MIT / Apache-2.0                                       |
| ocgcore-wasm              | WebAssembly 包装层        | MIT · https://github.com/n1xx1/ocgcore-wasm            |
| EDOPro / ygopro-core      | WebAssembly 内的游戏规则  | AGPL-3.0 · https://github.com/edo9300/ygopro-core      |
| Project Ignis CardScripts | 运行时下载的 Lua 卡片脚本 | AGPL-3.0 · https://github.com/ProjectIgnis/CardScripts |
| adm-zip                   | 脚本归档读取              | MIT                                                    |
| sharp                     | 卡图完整性验证            | Apache-2.0                                             |
| ws                        | 联机传输                  | MIT                                                    |

部署者应保留第三方软件包附带的许可证及其源代码提供义务。`ocgcore-wasm` npm 包记录版本，`package-lock.json` 固定依赖；该项目公开了核心编译脚本和来源。运行时下载的脚本按 Git SHA 标识，原始脚本与 COPYING 保存在配置的数据目录，可按需提供给使用者。

界面与业务代码重新编写。`ant3190/neos-ts` 用于布局、功能与交互参考；按用户要求复用其 `neos-assets/card_back.jpg` 作为经典棕色旋涡卡背，保存为 `public/card-back.jpg`。游戏王的卡片图像、卡背、文本、商标和名称属于各自权利人；本仓库不附带原始卡库或卡面原图；文档包含界面实机截图与录屏。

猜拳手势路径来自 [Tabler Icons](https://github.com/tabler/tabler-icons) 的 `hand-grab`、`hand-two-fingers` 和 `hand-stop`，采用 MIT 许可证；原始许可证保存在 [licenses/Tabler-Icons-MIT.txt](licenses/Tabler-Icons-MIT.txt)。

- `https-proxy-agent`：MIT，https://github.com/TooTallNate/proxy-agents 。
- MDPro3 中文 `bot.conf` 对手名称、Deck 标识与简介：GPL-3.0，https://github.com/SethPDA/MDPro3 ，提交 `1d106cc4919f6996209215441035781f6f85203b`。本仓库 `server/data/ai-opponents.json` 为其可在线按 Deck 调用项目的整理。
- `ant3190/neos-ts` 的 YGOPro 协议与连续素材草稿操作用于参考，新实现继续采用 AGPL-3.0-or-later。对接边界见 [docs/interaction.md](docs/interaction.md)。

MDPro3 原始 GPL-3.0 许可证保存在 [licenses/MDPro3-GPL-3.0.txt](licenses/MDPro3-GPL-3.0.txt)。
