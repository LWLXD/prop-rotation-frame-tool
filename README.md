# 欧卡道具旋转视频与关键帧抠图网页工具

公司内网无账号版工具。核心流程：

上传道具图 -> 创建任务 -> 参考图片/可选参考视频上传 OSS 临时目录 -> Worker 通过图片 OSS URL 调用 Seedance，或使用本地 mock 生成视频 -> 页面预览视频 -> 手动确认抽帧 -> FFmpeg 抽帧 -> rembg 抠图 -> 打包 ZIP -> 页面预览和下载。

## 本地启动

```powershell
npm install
npm run dev
```

默认地址：

- 前端：http://localhost:5173
- 后端：http://localhost:4000

如果本机其它 Vite 工具占用了 `5173`，建议直接使用项目根目录的启动脚本：

```powershell
.\start-tool.bat
```

脚本默认使用：

- 前端：http://localhost:5183
- 后端：http://localhost:4100

保持脚本窗口打开即可使用工具；按 `Ctrl+C` 或关闭脚本窗口，会自动关闭该脚本启动的前端、后端和 worker，不会主动关闭其它项目。需要临时换端口时可以这样启动：

```powershell
.\start-tool.bat -FrontendPort 5184 -BackendPort 4101
```

默认 `SEEDANCE_MOCK=true`，没有火山方舟 API Key 时会用 FFmpeg 基于上传图片生成一个占位 MP4。视频生成完成后，需要在任务详情中手动点击“开始抽帧”，才会继续抽帧、抠图和打包。

## API 配置位置

后台 API 配置填写在项目根目录：

```text
D:\LWL\AI\道具旋转逐帧工具\.env
```

`.env` 已加入 `.gitignore`，不会上传到 GitHub。

开始本地测试时可以先保持：

```env
SEEDANCE_MOCK=true
```

接入火山方舟 Seedance 时，修改 `.env`：

```env
SEEDANCE_MOCK=false
ARK_API_KEY=你的火山方舟 API Key
ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
ARK_MODEL_ID=doubao-seedance-2-0-260128
```

当前版本不启用 `PUBLIC_BASE_URL`。Seedance API 模式下，上传图片会在后端统一转成 PNG，上传到 OSS 临时目录，并以 OSS URL 形式传给 Seedance。

## OSS 参考素材配置

只有参考图片和可选参考视频会上传到 OSS；生成视频、抽帧、抠图和 ZIP 不上传 OSS。OSS 操作限制在 `wanglin/` 前缀内，临时上传固定使用 `wanglin/seedance2/temp/`。

```env
OSS_ENABLED=true
OSS_REGION=oss-cn-beijing
OSS_BUCKET=blueultra-ai
OSS_ENDPOINT=oss-cn-beijing.aliyuncs.com
OSS_BASE_URL=https://blueultra-ai.oss-cn-beijing.aliyuncs.com
OSS_ACCESS_KEY_ID=你的 AccessKey ID
OSS_ACCESS_KEY_SECRET=你的 AccessKey Secret
OSS_ALLOWED_ROOT_PREFIX=wanglin/
OSS_TEMP_PREFIX=wanglin/seedance2/temp/
OSS_TEMP_TTL_HOURS=24
```

后端启动时会自动清理 `OSS_TEMP_PREFIX` 下超过 `OSS_TEMP_TTL_HOURS` 的临时对象；删除任务时也会同步删除该任务的参考图片和参考视频 OSS 对象。

## 图片和视频参考

创建任务时必须上传参考图片，可以额外上传参考视频。当前版本的处理方式：

- `SEEDANCE_MOCK=true`：不会调用 Seedance，输出视频由上传图片生成 mock 占位视频。
- `SEEDANCE_MOCK=false`：调用 Seedance，图片以 OSS URL 作为 `image_url.url` 输入。参考视频会上传并保存 URL，但暂未写入 Seedance 请求体的额外字段，避免未确认字段导致 API 失败。

## 图片格式

前端可以上传常见图片格式。后端会统一转成真正的 `source.png` 再保存和传给后续流程。

建议优先使用 PNG、JPG/JPEG、WebP。后端也会尝试支持 AVIF、TIFF、GIF 等 Sharp 可解码的栅格格式。

## 两阶段处理

任务分为两阶段：

1. 生成视频：创建任务后自动执行，完成后任务停在 `VIDEO_DOWNLOADED`，此时可以预览和下载视频。
2. 抽帧打包：在任务详情中点击“开始抽帧”后执行，完成后可下载原始帧、透明帧和完整 ZIP。

## GitHub 更新约定

当前版本上传到 GitHub 后，后续新版本默认继续提交并推送到同一个 GitHub 仓库。

## 目录

- `apps/frontend`：React + TypeScript + Vite 前端
- `apps/backend`：任务 API、上传、预览、下载
- `apps/worker`：任务队列消费与处理
- `apps/rembg-service`：FastAPI + rembg 服务骨架
- `packages/shared`：共享类型和任务状态
- `storage`：按 `task_id` 组织的文件存储目录
- `data/tasks.json`：本地开发任务记录
