# Paca 打卡同步

独立 Obsidian 插件，配合官方 TaskNotes 与独立 Paca 打卡插件。支持桌面和手机拉取，TaskNotes 保持官方原版。

安装 Release 中 ZIP 的 `main.js`、`manifest.json`、`styles.css` 到笔记库 `.obsidian/plugins/obsidian-paca-checkin-sync/`，启用插件。Paca 项目“任务拍照打卡”设置中生成每设备配对码，在本插件填写 HTTPS 服务地址与配对码，选择实际 TaskNotes 状态。附件默认 `PushGo附件/`，必须独立于任务目录。

命令：**Paca 打卡同步：同步打卡记录、状态和照片**。可启动、恢复前台和定时自动拉取。只写专用打卡区块与相关状态，不恢复被删除的任务。笔记缺失需要手动关联；区块被编辑时先保留用户修改，状态冲突可选择本地或服务器。

配对码只保存在当前插件数据中；不进入任务笔记、源码或发行资产。多设备请分别配对，手机端附件使用 Vault API 下载。照片的服务器保存期限不删除已同步到本地的图片。官方 TaskNotes 未送达的 Webhook 不能由本插件补齐完整任务同步。

构建、类型检查、lint、自动测试、包体检查、安装包与发行全部通过 GitHub Actions。真实官方 Obsidian、TaskNotes 兼容性验收与单元测试分开记录；未经设备测试不声明手机真机通过。
