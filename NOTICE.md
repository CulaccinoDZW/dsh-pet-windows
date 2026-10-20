NOTICE / 来源与改动说明
======================

本软件（"鲸鱼娘" Windows 独立版）是基于以下开源项目改造的非官方 Windows 打包版：

  上游项目：dsh-pet
  作者：PC2005-cloud
  仓库：https://github.com/PC2005-cloud/dsh-pet
  版本：0.3.7（npm 包 dsh-pet）
  代码许可：MIT
  素材许可：允许开源使用，禁止商用（见上游 README「许可」一节）

本项目不使用任何官方名义，也不代表上游作者的认可或背书。

对上游代码的主要改动（便于上游追溯）：
1. 新增独立运行外壳与 Windows 安装器（含一键配置、开机自启、托盘最小化、全屏自动隐藏）。
2. 独立配置文件：改用 %USERPROFILE%\.dsh\dsh-pet-standalone\（main-config.jsonc / ai-config.json / memory.json），
   与 DSH 插件共用配置分离。
3. 新增直连 DeepSeek 兼容 API 的对话与碎碎念（在 DSH 未运行时使用），本地对话记忆。
4. 新增右键菜单项：大小调节、改名、待办（不重复/每天/每周多选/每月多选日历）、退出置底、API Key 填写。
5. 新增整点/半点报时（鲸鱼娘风格时钟面板 + 自定义提示音）。
6. 新增待办到点整屏提醒（放大播放「抽陀螺」动画 + 点击查看详情）。
7. 充值余额展示在 DSH 在线时镜像；DSH 离线时静默不提示。
8. 仅静音 DSH 自身的 Windows 通知弹窗（退出即还原），不影响其他应用。
9. 体积精简：Electron 仅保留中英文语言包、移除 WebGPU/SwiftShader 组件、payload 用 zstd 压缩。

素材与第三方组件：
- 动画/表情包素材版权归上游作者，本项目仅作非商业分发。
- Electron 及其 Chromium 许可文件随包附带（runtime\electron\LICENSE、LICENSES.chromium.html.gz）。
- 其余 npm 依赖（@electron/get、extract-zip、debug、semver 等）许可文件见 app\node_modules\*\LICENSE。

本项目完全免费，不做商用；如上游作者认为本打包方式不妥，可联系删除。