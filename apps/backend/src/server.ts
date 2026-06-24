import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import cors from "cors";
import express from "express";
import multer from "multer";
import { z } from "zod";
import { defaultPrompt, taskStatuses, type FrameExtractMode, type RotationMode, type Task } from "@prop-tool/shared";
import { assertInside, createQueueClient, ensureTaskDirs, getConfig, getTaskPaths, TaskStore } from "@prop-tool/core";

const config = getConfig();
const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 300 * 1024 * 1024 }
});
const store = new TaskStore(config.dataRoot);
const queue = createQueueClient(config.redisUrl);

function isVideoUpload(file: Express.Multer.File): boolean {
  const ext = path.extname(file.originalname).toLowerCase();
  return file.mimetype.startsWith("video/") || [".mp4", ".mov", ".webm", ".m4v", ".avi", ".mkv"].includes(ext);
}

const taskSchema = z.object({
  taskName: z.string().trim().max(80).optional().default(""),
  prompt: z.string().trim().max(4000).default(defaultPrompt),
  rotationMode: z.enum(["horizontal_360", "vertical_360", "turntable"]).default("horizontal_360"),
  duration: z.coerce.number().int().min(1).max(15).default(4),
  fps: z.coerce.number().int().min(1).max(60).default(24),
  width: z.coerce.number().int().min(128).max(2048).default(1024),
  height: z.coerce.number().int().min(128).max(2048).default(1024),
  frameExtractMode: z.enum(["interval", "total_count"]).default("interval"),
  frameInterval: z.coerce.number().int().min(1).max(120).default(4),
  totalExtractCount: z.coerce.number().int().min(1).max(120).optional()
});

app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.post(
  "/api/tasks",
  upload.fields([
    { name: "image", maxCount: 1 },
    { name: "referenceVideo", maxCount: 1 }
  ]),
  async (req, res, next) => {
  try {
    const files = req.files as Record<string, Express.Multer.File[] | undefined>;
    const imageFile = files.image?.[0];
    const referenceVideoFile = files.referenceVideo?.[0];

    if (!imageFile) {
      res.status(400).json({ message: "image is required" });
      return;
    }
    if (!imageFile.mimetype.startsWith("image/")) {
      res.status(400).json({ message: "Only image uploads are supported" });
      return;
    }
    if (referenceVideoFile && !isVideoUpload(referenceVideoFile)) {
      res.status(400).json({ message: "referenceVideo must be a video file" });
      return;
    }

    const params = taskSchema.parse(req.body);
    const taskId = randomUUID();
    const taskName = params.taskName || `任务-${taskId.slice(0, 8)}`;
    const paths = getTaskPaths(config.storageRoot, taskId);
    await ensureTaskDirs(paths);
    await fs.writeFile(paths.sourceImage, imageFile.buffer);
    if (referenceVideoFile) {
      await fs.writeFile(paths.referenceVideo, referenceVideoFile.buffer);
    }

    const now = new Date().toISOString();
    const task: Task = {
      id: taskId,
      name: taskName,
      sourceImagePath: paths.sourceImage,
      referenceVideoPath: referenceVideoFile ? paths.referenceVideo : null,
      prompt: params.prompt || defaultPrompt,
      rotationMode: params.rotationMode as RotationMode,
      duration: params.duration,
      fps: params.fps,
      width: params.width,
      height: params.height,
      frameExtractMode: params.frameExtractMode as FrameExtractMode,
      frameInterval: params.frameInterval,
      totalExtractCount: params.totalExtractCount ?? null,
      status: "QUEUED",
      progress: 0,
      errorMessage: null,
      seedanceTaskId: null,
      videoPath: null,
      zipPath: null,
      createdAt: now,
      updatedAt: now,
      finishedAt: null,
      outputs: [],
      logs: []
    };

    await store.create(task);
    await store.addOutput(taskId, {
      outputType: "source",
      filePath: paths.sourceImage,
      fileName: "source.png",
      fileSize: imageFile.size,
      sortOrder: 0
    });
    if (referenceVideoFile) {
      await store.addOutput(taskId, {
        outputType: "reference_video",
        filePath: paths.referenceVideo,
        fileName: referenceVideoFile.originalname || "reference.mp4",
        fileSize: referenceVideoFile.size,
        sortOrder: 0
      });
    }
    await store.addLog(taskId, "QUEUED", "info", "任务已创建并进入队列");
    await queue.enqueue(taskId);

    res.status(201).json({ taskId, status: "QUEUED" });
  } catch (error) {
    next(error);
  }
});

app.get("/api/tasks", async (req, res, next) => {
  try {
    const status = typeof req.query.status === "string" && taskStatuses.includes(req.query.status as never)
      ? (req.query.status as Task["status"])
      : undefined;
    const result = await store.list({
      page: Number(req.query.page ?? 1),
      pageSize: Number(req.query.pageSize ?? 20),
      keyword: typeof req.query.keyword === "string" ? req.query.keyword : undefined,
      status
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.get("/api/tasks/:id", async (req, res, next) => {
  try {
    const task = await store.get(req.params.id);
    if (!task) {
      res.status(404).json({ message: "Task not found" });
      return;
    }
    res.json(task);
  } catch (error) {
    next(error);
  }
});

app.post("/api/tasks/:id/retry", async (req, res, next) => {
  try {
    const task = await store.get(req.params.id);
    if (!task) {
      res.status(404).json({ message: "Task not found" });
      return;
    }
    const action = task.videoPath ? "extract" : "generate";
    const nextStatus = action === "extract" ? "EXTRACTING_FRAMES" : "QUEUED";
    await store.update(req.params.id, { status: nextStatus, progress: action === "extract" ? 45 : 0, errorMessage: null, finishedAt: null });
    await store.addLog(req.params.id, nextStatus, "info", action === "extract" ? "任务已重新进入抽帧队列" : "任务已重新进入视频生成队列");
    await queue.enqueue(req.params.id, action);
    res.json({ taskId: req.params.id, status: nextStatus });
  } catch (error) {
    next(error);
  }
});

app.post("/api/tasks/:id/extract", async (req, res, next) => {
  try {
    const task = await store.get(req.params.id);
    if (!task) {
      res.status(404).json({ message: "Task not found" });
      return;
    }
    if (!task.videoPath) {
      res.status(400).json({ message: "Video is not ready yet" });
      return;
    }
    await store.update(req.params.id, { status: "EXTRACTING_FRAMES", progress: 45, errorMessage: null, finishedAt: null });
    await store.addLog(req.params.id, "EXTRACTING_FRAMES", "info", "已确认开始抽帧、抠图和打包");
    await queue.enqueue(req.params.id, "extract");
    res.json({ taskId: req.params.id, status: "EXTRACTING_FRAMES" });
  } catch (error) {
    next(error);
  }
});

app.post("/api/tasks/:id/cancel", async (req, res, next) => {
  try {
    const task = await store.get(req.params.id);
    if (!task) {
      res.status(404).json({ message: "Task not found" });
      return;
    }
    await store.update(req.params.id, { status: "CANCELLED", progress: 100 });
    await store.addLog(req.params.id, "CANCELLED", "warn", "任务已取消");
    res.json({ taskId: req.params.id, status: "CANCELLED" });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/tasks/:id", async (req, res, next) => {
  try {
    const taskId = req.params.id;
    const task = await store.get(taskId);
    if (!task) {
      res.status(404).json({ message: "Task not found" });
      return;
    }
    for (const dir of ["uploads", "videos", "frames", "cutouts", "previews", "zips"]) {
      await fs.rm(assertInside(config.storageRoot, path.join(config.storageRoot, dir, taskId)), {
        recursive: true,
        force: true
      });
    }
    await store.remove(taskId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

function sendOutput(res: express.Response, task: Task, outputType: string, downloadName?: string) {
  const output = task.outputs.find((item) => item.outputType === outputType);
  if (!output) {
    res.status(404).json({ message: "Output not found" });
    return;
  }
  const filePath = assertInside(config.storageRoot, output.filePath);
  res.download(filePath, downloadName ?? output.fileName);
}

app.get("/api/tasks/:id/download/video", async (req, res, next) => {
  try {
    const task = await store.get(req.params.id);
    if (!task) return res.status(404).json({ message: "Task not found" });
    return sendOutput(res, task, "video", `${task.name || task.id}.mp4`);
  } catch (error) {
    return next(error);
  }
});

app.get("/api/tasks/:id/download/zip", async (req, res, next) => {
  try {
    const task = await store.get(req.params.id);
    if (!task) return res.status(404).json({ message: "Task not found" });
    return sendOutput(res, task, "zip", `${task.name || task.id}.zip`);
  } catch (error) {
    return next(error);
  }
});

app.get("/api/tasks/:id/download/raw-frames", async (req, res, next) => {
  try {
    const task = await store.get(req.params.id);
    if (!task) return res.status(404).json({ message: "Task not found" });
    return sendOutput(res, task, "raw_frames_zip", `${task.name || task.id}_raw_frames.zip`);
  } catch (error) {
    return next(error);
  }
});

app.get("/api/tasks/:id/download/cutouts", async (req, res, next) => {
  try {
    const task = await store.get(req.params.id);
    if (!task) return res.status(404).json({ message: "Task not found" });
    return sendOutput(res, task, "cutouts_zip", `${task.name || task.id}_transparent_frames.zip`);
  } catch (error) {
    return next(error);
  }
});

function sendPreview(res: express.Response, task: Task, outputType: string, index = 0) {
  const outputs = task.outputs
    .filter((item) => item.outputType === outputType)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const output = outputs[index];
  if (!output) {
    res.status(404).json({ message: "Preview not found" });
    return;
  }
  res.sendFile(assertInside(config.storageRoot, output.filePath));
}

app.get("/api/tasks/:id/preview/source", async (req, res, next) => {
  try {
    const task = await store.get(req.params.id);
    if (!task) return res.status(404).json({ message: "Task not found" });
    return sendPreview(res, task, "source");
  } catch (error) {
    return next(error);
  }
});

app.get("/api/tasks/:id/preview/video", async (req, res, next) => {
  try {
    const task = await store.get(req.params.id);
    if (!task) return res.status(404).json({ message: "Task not found" });
    const output = task.outputs.find((item) => item.outputType === "video");
    if (!output) return res.status(404).json({ message: "Video not found" });
    return res.sendFile(assertInside(config.storageRoot, output.filePath));
  } catch (error) {
    return next(error);
  }
});

app.get("/api/tasks/:id/preview/frame/:index", async (req, res, next) => {
  try {
    const task = await store.get(req.params.id);
    if (!task) return res.status(404).json({ message: "Task not found" });
    return sendPreview(res, task, "raw_frame", Number(req.params.index) - 1);
  } catch (error) {
    return next(error);
  }
});

app.get("/api/tasks/:id/preview/cutout/:index", async (req, res, next) => {
  try {
    const task = await store.get(req.params.id);
    if (!task) return res.status(404).json({ message: "Task not found" });
    return sendPreview(res, task, "cutout", Number(req.params.index) - 1);
  } catch (error) {
    return next(error);
  }
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof z.ZodError) {
    const message = error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    res.status(400).json({ message });
    return;
  }
  const message = error instanceof Error ? error.message : "Unknown error";
  res.status(500).json({ message });
});

app.listen(config.port, () => {
  console.log(`Backend API listening on http://localhost:${config.port}`);
});
