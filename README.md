# Prop Rotation Frame Tool

Internal no-login web tool for generating prop rotation videos, extracting frames,
removing backgrounds, and exporting transparent PNG assets.

## Recommended Company LAN Startup

Run the tool on one host computer inside the company network:

```powershell
.\start-tool.bat
```

Default ports:

- Frontend: `http://localhost:5183/`
- Backend API: `http://localhost:4100/`
- Local rembg service: `http://localhost:8001/`

The startup script prints one or more LAN URLs, for example:

```text
LAN:
  http://192.168.1.23:5183/
```

Other company computers should open the printed LAN URL. The frontend will
automatically call the backend on the same host with port `4100`, so teammates
do not need to edit configuration on their machines.

Keep the startup window open while the tool is in use. Press `Ctrl+C` or close
the window to stop the frontend, backend, worker, and rembg processes started by
the script.

If a port is occupied, start with custom ports:

```powershell
.\start-tool.bat -FrontendPort 5184 -BackendPort 4101 -RembgPort 8002
```

If other computers cannot open the LAN URL, allow inbound access to the frontend
and backend ports in Windows Firewall, usually `5183` and `4100`.

## Workflow

1. Upload a reference image and create a task.
2. The worker generates a video through Seedance, or a local placeholder video
   when mock mode is enabled.
3. Preview the generated video in the task detail panel.
4. Click the extract button to extract frames, remove backgrounds, and package
   downloads.
5. Download the video, raw frames, transparent frames, or full ZIP package.

Generated videos, frames, cutouts, and ZIP packages stay on local disk. Only
reference images and optional reference videos are uploaded to OSS for use as
reference URLs.

## API Configuration

Runtime configuration is stored in the local `.env` file at the project root:

```text
<project-root>\.env
```

`.env` is ignored by Git and must not be committed.

For local flow testing:

```env
SEEDANCE_MOCK=true
```

For Seedance API mode:

```env
SEEDANCE_MOCK=false
ARK_API_KEY=your_volcengine_ark_api_key
ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
ARK_MODEL_ID=doubao-seedance-2-0-260128
```

`PUBLIC_BASE_URL` is not required for the current OSS reference workflow. The
backend converts uploaded images to PNG, uploads the reference asset to OSS, and
passes the OSS URL to Seedance.

## OSS Reference Asset Configuration

Only reference images and optional reference videos are uploaded to OSS.
Generated outputs remain local.

All OSS operations are restricted to `wanglin/`, and temporary reference assets
are stored under `wanglin/seedance2/temp/`.

```env
OSS_ENABLED=true
OSS_REGION=oss-cn-beijing
OSS_BUCKET=blueultra-ai
OSS_ENDPOINT=oss-cn-beijing.aliyuncs.com
OSS_BASE_URL=https://blueultra-ai.oss-cn-beijing.aliyuncs.com
OSS_ACCESS_KEY_ID=your_access_key_id
OSS_ACCESS_KEY_SECRET=your_access_key_secret
OSS_ALLOWED_ROOT_PREFIX=wanglin/
OSS_TEMP_PREFIX=wanglin/seedance2/temp/
OSS_TEMP_TTL_HOURS=24
```

The backend clears expired temporary OSS objects on startup and deletes a task's
reference OSS objects when that task is deleted.

## Image And Video References

Reference image upload is required. The frontend accepts common image formats,
and the backend normalizes them to `source.png` before storage and API use.

Recommended image formats: PNG, JPG/JPEG, and WebP. The backend also attempts to
decode formats supported by Sharp, such as AVIF, TIFF, and GIF.

Optional reference video upload is stored as a reference URL, but it is not added
to the Seedance request body yet. This avoids API failures before the exact
Seedance video-reference field contract is confirmed.

## Development

```powershell
npm install
npm run check
npm run build
```

The older `npm run dev` command is still available for development, but company
LAN testing should use `.\start-tool.bat` because it starts all required services
on stable ports and cleans them up when the window closes.

## Repository Layout

- `apps/frontend`: React + TypeScript + Vite frontend
- `apps/backend`: task API, upload, preview, download, and OSS cleanup
- `apps/worker`: task queue processing
- `apps/rembg-service`: FastAPI + rembg background removal service
- `packages/shared`: shared types and defaults
- `storage`: local task files grouped by task id
- `data/tasks.json`: local task state
