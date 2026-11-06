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

界面与业务代码重新编写。旧 `ant3190/neos-ts` 仅作功能与交互参考，不分发其界面素材。游戏王的卡片图像、文本、商标和名称属于各自权利人；本仓库不附带这些资源。
