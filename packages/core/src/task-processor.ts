import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import archiver from "archiver";
import type { AppConfig } from "./config.js";
import { ensureTaskDirs, getTaskPaths } from "./paths.js";
import type { TaskStore } from "./task-store.js";
import type { Task } from "@prop-tool/shared";

const execFileAsync = promisify(execFile);

async function fileSize(filePath: string): Promise<number> {
  const stat = await fs.stat(filePath);
  return stat.size;
}

async function listPngFiles(dir: string): Promise<string[]> {
  try {
    const files = await fs.readdir(dir);
    return files.filter((file) => file.toLowerCase().endsWith(".png")).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function pngHasAlphaChannel(filePath: string): Promise<boolean> {
  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(26);
    await handle.read(buffer, 0, buffer.length, 0);
    const isPng =
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47;
    if (!isPng) return false;
    const colorType = buffer[25];
    return colorType === 4 || colorType === 6;
  } finally {
    await handle.close();
  }
}

async function runFfmpeg(args: string[]): Promise<void> {
  await execFileAsync("ffmpeg", args, { windowsHide: true, maxBuffer: 1024 * 1024 * 10 });
}

async function generateMockVideo(task: Task, videoPath: string): Promise<void> {
  const scale = `scale=${task.width}:${task.height}:force_original_aspect_ratio=decrease`;
  const pad = `pad=${task.width}:${task.height}:(ow-iw)/2:(oh-ih)/2:color=white`;
  await runFfmpeg([
    "-y",
    "-loop",
    "1",
    "-i",
    task.sourceImagePath,
    "-t",
    String(task.duration),
    "-r",
    String(task.fps),
    "-vf",
    `${scale},${pad},format=yuv420p`,
    videoPath
  ]);
}

function withTimeout(seconds: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), seconds * 1000).unref();
  return controller.signal;
}

async function arkRequest(config: AppConfig, pathName: string, init: RequestInit = {}) {
  if (!config.ark.apiKey) {
    throw new Error("ARK_API_KEY is required when SEEDANCE_MOCK=false");
  }
  const response = await fetch(`${config.ark.baseUrl.replace(/\/$/, "")}${pathName}`, {
    ...init,
    signal: withTimeout(config.ark.requestTimeoutSeconds),
    headers: {
      Authorization: `Bearer ${config.ark.apiKey}`,
      "Content-Type": "application/json",
      ...init.headers
    }
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) as Record<string, unknown> : {};
  if (!response.ok) {
    throw new Error(`Seedance API ${response.status}: ${text}`);
  }
  return payload;
}

function readStringPath(value: unknown, pathNames: string[]): string | undefined {
  let current = value;
  for (const name of pathNames) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[name];
  }
  return typeof current === "string" ? current : undefined;
}

function extractSeedanceVideoUrl(payload: unknown): string | undefined {
  return (
    readStringPath(payload, ["content", "video_url"]) ??
    readStringPath(payload, ["result", "video_url"]) ??
    readStringPath(payload, ["output", "video_url"]) ??
    readStringPath(payload, ["content", "video", "url"])
  );
}

function extractSeedanceStatus(payload: unknown): string {
  return (
    readStringPath(payload, ["status"]) ??
    readStringPath(payload, ["data", "status"]) ??
    "unknown"
  ).toLowerCase();
}

async function createSeedanceTask(task: Task, config: AppConfig): Promise<Record<string, unknown>> {
  if (!task.sourceImageUrl) {
    throw new Error("OSS source image URL is required when SEEDANCE_MOCK=false");
  }
  const referenceImageContent = (task.referenceImages ?? [])
    .filter((item) => Boolean(item.url))
    .map((item) => ({
      type: "image_url",
      image_url: { url: item.url as string },
      role: "reference_image"
    }));
  const body = {
    model: config.ark.modelId,
    content: [
      { type: "text", text: task.prompt },
      { type: "image_url", image_url: { url: task.sourceImageUrl }, role: "first_frame" },
      ...referenceImageContent
    ],
    duration: task.duration,
    ratio: "1:1",
    resolution: task.width >= 1024 || task.height >= 1024 ? "1080p" : "720p",
    watermark: false,
    return_last_frame: false
  };
  return arkRequest(config, "/contents/generations/tasks", {
    method: "POST",
    body: JSON.stringify(body)
  });
}

async function pollSeedanceTask(seedanceTaskId: string, config: AppConfig): Promise<Record<string, unknown>> {
  const started = Date.now();
  while (Date.now() - started < config.ark.maxPollSeconds * 1000) {
    const payload = await arkRequest(config, `/contents/generations/tasks/${encodeURIComponent(seedanceTaskId)}`);
    const status = extractSeedanceStatus(payload);
    if (status === "succeeded" || status === "success" || status === "completed") {
      return payload;
    }
    if (status === "failed" || status === "cancelled" || status === "canceled") {
      throw new Error(`Seedance task ended with status: ${status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, config.ark.pollIntervalSeconds * 1000));
  }
  throw new Error("Seedance task polling timeout");
}

async function downloadVideo(url: string, outputPath: string, config: AppConfig): Promise<void> {
  const response = await fetch(url, { signal: withTimeout(config.ark.requestTimeoutSeconds) });
  if (!response.ok || !response.body) {
    throw new Error(`Video download failed: ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(outputPath, bytes);
  if ((await fileSize(outputPath)) === 0) {
    throw new Error("Downloaded video is empty");
  }
}

async function generateSeedanceVideo(task: Task, config: AppConfig, store: TaskStore, outputPath: string): Promise<void> {
  const referenceRoles = (task.referenceImages ?? []).filter((item) => Boolean(item.url)).map((item) => item.role);
  await store.addLog(
    task.id,
    "GENERATING_VIDEO",
    "info",
    `Seedance image roles: main=first_frame${referenceRoles.length > 0 ? `, reference_views=${referenceRoles.join(",")}` : ""}`
  );
  const createPayload = await createSeedanceTask(task, config);
  const seedanceTaskId = readStringPath(createPayload, ["id"]) ?? readStringPath(createPayload, ["data", "id"]);
  if (!seedanceTaskId) {
    throw new Error("Seedance create task response did not include id");
  }
  await store.update(task.id, {
    seedanceTaskId,
    seedanceRawResponse: createPayload
  });
  await store.addLog(task.id, "GENERATING_VIDEO", "info", `Seedance task created: ${seedanceTaskId}`);

  const resultPayload = await pollSeedanceTask(seedanceTaskId, config);
  const videoUrl = extractSeedanceVideoUrl(resultPayload);
  if (!videoUrl) {
    throw new Error("Seedance succeeded but video_url was not found in response");
  }

  await store.updateStatus(task.id, "DOWNLOADING_VIDEO", 25, "开始下载 Seedance 生成视频");
  await downloadVideo(videoUrl, outputPath, config);
  await store.update(task.id, { seedanceRawResponse: resultPayload });
}

async function extractFrames(task: Task, videoPath: string, outputDir: string): Promise<string[]> {
  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(outputDir, { recursive: true });

  const filter =
    task.frameExtractMode === "total_count" && task.totalExtractCount
      ? `fps=${task.totalExtractCount}/${task.duration}`
      : `select=not(mod(n\\,${Math.max(1, task.frameInterval)}))`;

  const args =
    task.frameExtractMode === "total_count"
      ? ["-y", "-i", videoPath, "-vf", filter, path.join(outputDir, "frame_%04d.png")]
      : ["-y", "-i", videoPath, "-vf", filter, "-vsync", "vfr", path.join(outputDir, "frame_%04d.png")];

  await runFfmpeg(args);
  const files = await listPngFiles(outputDir);
  if (files.length === 0) {
    throw new Error("FFmpeg did not output any frames");
  }
  return files;
}

async function removeBackground(task: Task, config: AppConfig, rawDir: string, cutoutDir: string, store: TaskStore) {
  await fs.rm(cutoutDir, { recursive: true, force: true });
  await fs.mkdir(cutoutDir, { recursive: true });

  try {
    const response = await fetch(`${config.rembgServiceUrl}/remove-bg-batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input_dir: rawDir, output_dir: cutoutDir })
    });
    if (!response.ok) {
      throw new Error(`rembg-service returned ${response.status}`);
    }
    return;
  } catch (error) {
    await store.addLog(
      task.id,
      "REMOVING_BG",
      "warn",
      "rembg-service unavailable; background removal failed",
      { error: error instanceof Error ? error.message : String(error) }
    );
    throw error;
  }
}

async function writeZip(zipPath: string, entries: Array<{ source: string; name: string }>, meta?: unknown): Promise<void> {
  await fs.mkdir(path.dirname(zipPath), { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", resolve);
    archive.on("error", reject);
    archive.pipe(output);

    for (const entry of entries) {
      archive.directory(entry.source, entry.name);
    }
    if (meta) {
      archive.append(JSON.stringify(meta, null, 2), { name: "meta.json" });
    }
    void archive.finalize();
  });
}

async function addFileOutput(store: TaskStore, taskId: string, outputType: Parameters<TaskStore["addOutput"]>[1]["outputType"], filePath: string, sortOrder = 0) {
  await store.addOutput(taskId, {
    outputType,
    filePath,
    fileName: path.basename(filePath),
    fileSize: await fileSize(filePath),
    sortOrder
  });
}

export async function processVideoGeneration(taskId: string, store: TaskStore, config: AppConfig): Promise<void> {
  const task = await store.get(taskId);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }
  if (task.status === "CANCELLED") {
    return;
  }

  const paths = getTaskPaths(config.storageRoot, task.id);
  await ensureTaskDirs(paths);

  try {
    await store.updateStatus(task.id, "GENERATING_VIDEO", 10, "开始生成旋转视频");
    if (!config.seedanceMock) {
      await generateSeedanceVideo(task, config, store, paths.video);
    } else {
      await generateMockVideo(task, paths.video);
    }
    await addFileOutput(store, task.id, "video", paths.video);
    await store.update(task.id, { videoPath: paths.video });
    await store.updateStatus(task.id, "VIDEO_DOWNLOADED", 40, "视频已生成并保存，等待确认是否抽帧");
  } catch (error) {
    await store.fail(task.id, error instanceof Error ? error.message : String(error));
  }
}

export async function processFrameExtraction(taskId: string, store: TaskStore, config: AppConfig): Promise<void> {
  const task = await store.get(taskId);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }
  if (task.status === "CANCELLED") {
    return;
  }

  const paths = getTaskPaths(config.storageRoot, task.id);
  await ensureTaskDirs(paths);

  try {
    const videoPath = task.videoPath ?? paths.video;
    await fs.stat(videoPath);
    await store.updateStatus(task.id, "EXTRACTING_FRAMES", 45, "开始使用 FFmpeg 抽帧");
    const rawFrames = await extractFrames(task, videoPath, paths.rawFramesDir);
    for (const [index, file] of rawFrames.entries()) {
      await addFileOutput(store, task.id, "raw_frame", path.join(paths.rawFramesDir, file), index + 1);
    }
    await store.updateStatus(task.id, "FRAMES_EXTRACTED", 65, `抽帧完成，共 ${rawFrames.length} 张`);

    await store.updateStatus(task.id, "REMOVING_BG", 72, "开始对关键帧抠图");
    await removeBackground(task, config, paths.rawFramesDir, paths.cutoutsDir, store);
    const cutouts = await listPngFiles(paths.cutoutsDir);
    if (cutouts.length === 0) {
      throw new Error("rembg-service did not output any transparent frames");
    }
    const invalidCutout = await Promise.all(
      cutouts.map(async (file) => ({
        file,
        hasAlpha: await pngHasAlphaChannel(path.join(paths.cutoutsDir, file))
      }))
    ).then((items) => items.find((item) => !item.hasAlpha));
    if (invalidCutout) {
      throw new Error(`Background removal output is not a transparent PNG: ${invalidCutout.file}`);
    }
    for (const [index, file] of cutouts.entries()) {
      await addFileOutput(store, task.id, "cutout", path.join(paths.cutoutsDir, file), index + 1);
    }
    await store.updateStatus(task.id, "BG_REMOVED", 82, `抠图完成，共 ${cutouts.length} 张`);

    await store.updateStatus(task.id, "PACKAGING", 90, "开始打包 ZIP");
    const meta = {
      task_id: task.id,
      task_name: task.name,
      rotation_mode: task.rotationMode,
      duration: task.duration,
      fps: task.fps,
      frame_interval: task.frameInterval,
      raw_frame_count: rawFrames.length,
      transparent_frame_count: cutouts.length,
      created_at: task.createdAt
    };
    await writeZip(paths.rawFramesZip, [{ source: paths.rawFramesDir, name: "raw_frames" }]);
    await writeZip(paths.cutoutsZip, [{ source: paths.cutoutsDir, name: "transparent_frames" }]);
    await writeZip(
      paths.fullZip,
      [
        { source: paths.sourceDir, name: "source" },
        { source: paths.videoDir, name: "video" },
        { source: paths.rawFramesDir, name: "raw_frames" },
        { source: paths.cutoutsDir, name: "transparent_frames" }
      ],
      meta
    );
    await addFileOutput(store, task.id, "raw_frames_zip", paths.rawFramesZip);
    await addFileOutput(store, task.id, "cutouts_zip", paths.cutoutsZip);
    await addFileOutput(store, task.id, "zip", paths.fullZip);
    await store.update(task.id, { zipPath: paths.fullZip });
    await store.updateStatus(task.id, "SUCCESS", 100, "任务处理完成");
  } catch (error) {
    await store.fail(task.id, error instanceof Error ? error.message : String(error));
  }
}

export async function processTask(
  taskId: string,
  store: TaskStore,
  config: AppConfig,
  action: "generate" | "extract" = "generate"
): Promise<void> {
  if (action === "extract") {
    await processFrameExtraction(taskId, store, config);
    return;
  }
  await processVideoGeneration(taskId, store, config);
}

export function streamFile(filePath: string) {
  return createReadStream(filePath);
}
