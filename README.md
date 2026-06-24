# 欧卡道具旋转视频与关键帧抠图网页工具

公司内网无账号版工具。核心流程：

上传道具图 -> 创建任务 -> Worker 生成/下载视频 -> FFmpeg 抽帧 -> rembg 抠图 -> 打包 ZIP -> 页面预览和下载。

## 本地启动

```powershell
npm install
npm run dev
```

默认地址：

- 前端：http://localhost:5173
- 后端：http://localhost:4000

默认 `SEEDANCE_MOCK=true`，没有火山方舟 API Key 时会用 FFmpeg 基于上传图片生成一个占位 MP4，并继续完成抽帧、打包流程。

## API 配置位置

后台 API 配置填写在项目根目录：

```text
D:\LWL\AI\道具旋转逐帧工具\.env
```

开始本地测试时可以先保持：

```env
SEEDANCE_MOCK=true
```

这时不会调用火山方舟。你可以上传道具图，也可以上传“参考视频”。如果上传了参考视频，Worker 会把参考视频转成 `result.mp4`，然后继续抽帧、抠图、打包，适合先验证后半段链路。

接入火山方舟 Seedance 时，修改 `.env`：

```env
SEEDANCE_MOCK=false
PUBLIC_BASE_URL=https://你的公网或火山可访问域名
ARK_API_KEY=你的火山方舟 API Key
ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
ARK_MODEL_ID=doubao-seedance-2-0-260128
```

注意：`PUBLIC_BASE_URL` 必须是火山方舟能访问到的地址，因为 Seedance 需要拉取上传的道具图。纯 `localhost` 或公司内网地址通常无法被火山方舟访问。`.env` 已加入 `.gitignore`，不会上传到 GitHub。

## 参考视频

创建任务时，图片是必填，参考视频是可选。当前版本的处理方式：

- `SEEDANCE_MOCK=true`：优先使用参考视频作为本地处理视频，用于测试抽帧、抠图和 ZIP 输出。
- `SEEDANCE_MOCK=false`：调用 Seedance 生成视频；参考视频会随任务保存，后续可扩展为正式的视频参考参数。

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
