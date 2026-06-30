import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import cors from "cors";
import express from "express";
import multer from "multer";
import sharp from "sharp";
import { z } from "zod";
import {
  taskStatuses,
  type AspectRatio,
  type FrameExtractMode,
  type InputControlMode,
  type KeyframeImageRole,
  type ReferenceImageRole,
  type ResolutionPreset,
  type RotationMode,
  type Task,
  type TaskKeyframeImage,
  type TaskReferenceImage,
  type VideoMediaMeta
} from "@prop-tool/shared";
import { assertInside, createOssService, createQueueClient, ensureTaskDirs, getConfig, getTaskPaths, TaskStore } from "@prop-tool/core";

const config = getConfig();
const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 300 * 1024 * 1024 }
});
const store = new TaskStore(config.dataRoot);
const queue = createQueueClient(config.redisUrl);
const oss = createOssService(config);
const execFileAsync = promisify(execFile);
const MIN_SEEDANCE_PIXEL_COUNT = 409600;
const UPSCALED_REFERENCE_VIDEO_SIZE = 720;
const MAX_MIDDLE_KEYFRAMES = 5;

const referenceImageFields: Array<{ field: string; role: ReferenceImageRole; fileName: string; sortOrder: number }> = [
  { field: "referenceFrontImage", role: "front", fileName: "reference-front.png", sortOrder: 1 },
  { field: "referenceSideImage", role: "side", fileName: "reference-side.png", sortOrder: 2 },
  { field: "referenceBackImage", role: "back", fileName: "reference-back.png", sortOrder: 3 }
];

const keyframeImageFields: Array<{ field: string; role: KeyframeImageRole; fileName: string; sortOrder: number }> = [
  { field: "finalFrameImage", role: "final", fileName: "keyframe-final.png", sortOrder: 20 }
];

const SEEDANCE_DURATION_MESSAGE = "\u0053\u0065\u0065\u0064\u0061\u006e\u0063\u0065\u0020\u0032\u002e\u0030\u0020\u65f6\u957f\u5fc5\u987b\u4e3a\u0020\u0034\u007e\u0031\u0035\u0020\u79d2";

const GLOBAL_OBJECT_LOCK_PROMPT = [
  "Use the main input image as the highest-priority appearance anchor for the object.",
  "Preserve the same object identity, silhouette, proportions, material, color, highlights, edge thickness, and overall visual style from the main image.",
  "Preserve a casual Western cartoon mobile game icon style: clean simplified shapes, chunky rounded bevels, saturated friendly colors, soft painted highlights, and a polished toy-like surface.",
  "Keep the material simple and stylized, like a casual puzzle or match-3 game prop icon, not realistic metal, glass, stone, leather, or physically complex PBR material.",
  "When inferring unseen sides or the back, continue the same simplified cartoon icon material from the main image instead of adding extra realistic texture, scratches, grime, complex reflections, or heavy specular detail.",
  "Preserve the stylized 3D game prop icon look from the main image. Do not make the object photorealistic, cinematic, physically realistic, or materially more complex than the main image.",
  "The output must look like the exact same object rotating, not a redesigned or newly generated similar object.",
  "If additional front, side, or back view images are provided, treat them as rough structural sketches only, not as final rendered frames.",
  "Use those sketches only to infer silhouette, thickness, hidden side/back details, and how the same object should look from other angles.",
  "These additional views are not keyframes, not middle frames, not final appearance targets, and not an animation sequence.",
  "The main input image remains the source of truth for final material, color, bevels, highlights, and style.",
  "If a reference video is provided, use it only as a motion rhythm, pacing, and camera stability reference.",
  "Do not copy the subject, shape logic, rotation axis, or object identity from the reference video.",
  "The object's rotation axis must be determined by the main input image, not by the reference video.",
  "Define the rotation axis from the object's own symmetric true centerline in the main input image, passing through the exact geometric center of the object.",
  "Keep this centerline fixed in screen space for the entire video."
].join(" ");

const KEYFRAME_MAIN_IMAGE_PROMPT = [
  "Use the main input image as the first frame of the video.",
  "The first frame should preserve the main image appearance as closely as possible before the controlled rotation begins.",
  "After the first frame, keep the same object locked to its own symmetric true centerline."
].join(" ");

const HORIZONTAL_360_PROMPT = [
  "Rotation mode: one complete horizontal 360-degree turntable rotation at constant speed.",
  "The object must complete exactly one full 360-degree yaw rotation during the video, no less and no more.",
  "Use uniform angular velocity: every frame advances the rotation angle by the same amount, with no easing in, easing out, pauses, speed changes, reversals, or rocking motion.",
  "The animation timeline must follow this angle plan: at 0% show the original main-view angle, at 25% show a true side view, at 50% show the inferred back side, at 75% show the opposite side view, and at 100% return to the original main-view angle.",
  "The first and final frames must closely match in object angle, pose, scale, lighting, and appearance, forming a seamless looping 360 turntable video.",
  "Rotate only the object around its own vertical symmetric true centerline, equivalent to the object's local Y axis.",
  "This vertical axis must pass through the exact visual center of the object from top to bottom, like a skewer through the object's own middle.",
  "The object must stay upright at all times while turning left-to-right around this fixed vertical axis.",
  "The center of the object must remain locked in the same screen position with stable scale, stable lighting, and a stable bounding box.",
  "The camera must remain fixed and face the object's center; the camera must not orbit, pan, tilt, zoom, or change viewing height.",
  "Do not fake rotation by only moving highlights, stretching the shape, sliding the object, or tilting the front view; the visible faces and silhouette must continuously change as the object turns through side view, back view, side view, and back to the starting view.",
  "Do not stop at 90 degrees or 180 degrees, do not swing back and forth, and do not jump between a few static angles.",
  "Do not use the reference video to infer a different axis, diagonal axis, off-center pivot, irregular pacing, or tumbling motion.",
  "Strictly avoid pitch, roll, diagonal leaning, flipping, somersaulting, end-over-end motion, horizontal-axis rotation, camera orbit, or any 3D space tumble."
].join(" ");

const VERTICAL_360_PROMPT = [
  "Rotation mode: vertical 360-degree object rotation.",
  "Rotate the object around the horizontal symmetric true centerline of the object shown in the main input image.",
  "This axis must pass through the exact visual center of the object from left to right, not through an off-center edge or corner.",
  "Keep the object centered and rotate it in place around this fixed horizontal centerline only.",
  "The camera must remain fixed and face the object's center; the camera must not orbit, pan, tilt, zoom, or change viewing height.",
  "Do not use the reference video to infer a different axis, diagonal axis, off-center pivot, or chaotic flipping style.",
  "Strictly avoid diagonal tumbling, free-space rolling, camera orbit, drifting pivot points, shape deformation, and unstable scale."
].join(" ");

const TURNTABLE_PROMPT = [
  "Rotation mode: stable product turntable showcase.",
  "Use a clean, smooth, controlled turntable rotation around the vertical symmetric true centerline of the object shown in the main input image.",
  "The axis must pass through the object's exact geometric center and remain fixed for the full clip.",
  "Keep the object upright, centered, and visually stable with no wobble, no diagonal lean, and no off-axis pivot.",
  "The camera must stay fixed and face the center of the object; only the object rotates.",
  "Use the reference video, if provided, only for pacing, rhythm, smoothness, and camera stability, never for axis selection or object identity.",
  "Do not distort, redesign, stretch, melt, roll, tumble, flip, or orbit the object."
].join(" ");

const REFERENCE_VIDEO_PROMPT = [
  "Reference video usage rule: use the reference video only for motion timing, pacing, smoothness, and stable product-display feel.",
  "The reference video must not define the object's rotation axis, pivot point, shape, material, color, identity, or camera path.",
  "If the reference video does not show a clean full 360-degree constant-speed turntable rotation, ignore its incomplete angle path and still follow the selected rotation-mode instructions.",
  "For horizontal 360 mode, the generated object must complete the full constant-speed 360-degree yaw rotation even if the reference video only wobbles, pauses, turns partially, or jumps between angles.",
  "Ignore any diagonal rolling, off-axis turning, tumbling, flipping, camera orbit, or subject-specific movement that appears in the reference video.",
  "The main input image and the selected rotation-mode instructions have higher priority than the reference video."
].join(" ");

async function normalizeImageUpload(file: Express.Multer.File): Promise<Buffer> {
  try {
    return await sharp(file.buffer, { animated: false })
      .rotate()
      .png()
      .toBuffer();
  } catch {
    throw new Error("Uploaded image could not be decoded. Supported raster formats include PNG, JPEG, WebP, AVIF, TIFF, and GIF.");
  }
}

function filesByField(req: express.Request): Record<string, Express.Multer.File[]> {
  return (req.files ?? {}) as Record<string, Express.Multer.File[]>;
}

function isVideoUpload(file: Express.Multer.File): boolean {
  return file.mimetype.startsWith("video/");
}

function safeReferenceVideoFileName(taskId: string, originalName?: string): string {
  const extension = path.extname(originalName ?? "").toLowerCase().replace(/[^a-z0-9.]/g, "") || ".mp4";
  return `reference-video-${taskId}-${Date.now()}${extension}`;
}

async function probeVideoMeta(filePath: string): Promise<VideoMediaMeta> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height,duration:format=duration,format_name",
    "-of",
    "json",
    filePath
  ], { windowsHide: true, maxBuffer: 1024 * 1024 * 10 });
  const payload = JSON.parse(stdout) as {
    streams?: Array<{ width?: number; height?: number; duration?: string }>;
    format?: { duration?: string; format_name?: string };
  };
  const stream = payload.streams?.[0];
  const width = typeof stream?.width === "number" ? stream.width : undefined;
  const height = typeof stream?.height === "number" ? stream.height : undefined;
  const durationText = stream?.duration ?? payload.format?.duration;
  const duration = durationText ? Number(durationText) : undefined;
  return {
    width,
    height,
    pixelCount: width && height ? width * height : undefined,
    duration: Number.isFinite(duration) ? duration : undefined,
    format: payload.format?.format_name
  };
}

async function upscaleReferenceVideo(inputPath: string, outputPath: string): Promise<void> {
  const size = String(UPSCALED_REFERENCE_VIDEO_SIZE);
  await execFileAsync("ffmpeg", [
    "-y",
    "-i",
    inputPath,
    "-vf",
    `scale=${size}:${size}:force_original_aspect_ratio=decrease,pad=${size}:${size}:(ow-iw)/2:(oh-ih)/2`,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-an",
    outputPath
  ], { windowsHide: true, maxBuffer: 1024 * 1024 * 10 });
}

function buildRotationDirective(rotationMode: RotationMode): string {
  switch (rotationMode) {
    case "horizontal_360":
      return HORIZONTAL_360_PROMPT;
    case "vertical_360":
      return VERTICAL_360_PROMPT;
    case "turntable":
    default:
      return TURNTABLE_PROMPT;
  }
}

function buildReferenceViewPrompt(referenceImages: TaskReferenceImage[]): string {
  if (!referenceImages || referenceImages.length === 0) return "";
  const roles = referenceImages.map((item) => item.role).join(", ");
  return [
    `Additional reference views are provided: ${roles}.`,
    "Treat these extra images as rough structure sketches, not as finished rendered frames.",
    "Use them only to infer the same object's silhouette, thickness, side proportions, and rear details from the main image.",
    "They are not keyframes, not middle frames, not an animation sequence, and not first/middle/last frame references.",
    "Do not directly copy their drawing style, roughness, linework, colors, lighting, or low-detail appearance.",
    "Do not interpolate between these views as if they were animation frames.",
    "Do not create a split-screen three-view layout.",
    "Do not use these views to change the rotation axis away from the symmetric true centerline defined by the main input image.",
    "These extra views must not override the main input image.",
    "The main input image has priority for material, color, glossiness, lighting style, stylization level, and overall appearance."
  ].join(" ");
}

function buildReferenceVideoPrompt(hasReferenceVideo: boolean): string {
  return hasReferenceVideo ? REFERENCE_VIDEO_PROMPT : "";
}

function buildKeyframeControlPrompt(keyframeImages: TaskKeyframeImage[]): string {
  const middleCount = keyframeImages.filter((item) => item.role === "middle").length;
  const hasFinal = keyframeImages.some((item) => item.role === "final");
  return [
    KEYFRAME_MAIN_IMAGE_PROMPT,
    "Keyframe control mode uses the initial frame as the first video frame and appearance anchor.",
    middleCount > 0
      ? `There are ${middleCount} middle keyframe reference image(s). Use them in their provided order to guide the intermediate motion and pose progression.`
      : "",
    hasFinal
      ? "A final frame reference image is provided. Use it to guide the ending state while preserving the same object identity and style."
      : "No final frame is provided. End the motion naturally according to the selected rotation mode while preserving object identity and style.",
    "Do not treat middle frames as unrelated reference images; use them only as ordered temporal constraints."
  ].filter(Boolean).join(" ");
}

function buildReferenceImageNumberPrompt(options: {
  inputControlMode: InputControlMode;
  referenceImages: TaskReferenceImage[];
  keyframeImages: TaskKeyframeImage[];
}): string {
  const lines: string[] = [];
  if (options.inputControlMode === "keyframe_control") {
    const middleFrames = options.keyframeImages
      .filter((item) => item.role === "middle")
      .sort((a, b) => a.index - b.index);
    const hasInitial = options.keyframeImages.some((item) => item.role === "initial");
    const finalFrame = options.keyframeImages.find((item) => item.role === "final");
    if (hasInitial) lines.push("\u56fe1 is the video initial frame reference image.");
    middleFrames.forEach((_, index) => {
      lines.push(`\u56fe${index + 2} is middle keyframe reference image ${index + 1}.`);
    });
    if (finalFrame) {
      lines.push(`\u56fe${middleFrames.length + 2} is the video final frame reference image.`);
    }
  } else {
    lines.push("\u56fe1 is the main reference image and highest-priority appearance anchor.");
    for (const [index, field] of referenceImageFields.entries()) {
      const image = options.referenceImages.find((item) => item.role === field.role);
      if (!image) continue;
      lines.push(`\u56fe${index + 2} is the ${field.role} auxiliary structural reference image.`);
    }
  }

  return lines.length > 0
    ? ["Reference image number mapping for any user mentions such as @\u56fe1 or @\u56fe2:", ...lines].join("\n")
    : "";
}

function buildSeedancePrompt(options: {
  userExtraPrompt?: string;
  rotationMode: RotationMode;
  referenceImages: TaskReferenceImage[];
  keyframeImages: TaskKeyframeImage[];
  inputControlMode: InputControlMode;
  hasReferenceVideo: boolean;
}): string {
  return [
    GLOBAL_OBJECT_LOCK_PROMPT,
    options.inputControlMode === "keyframe_control" ? buildKeyframeControlPrompt(options.keyframeImages) : "",
    buildRotationDirective(options.rotationMode),
    options.inputControlMode === "multi_reference" ? buildReferenceViewPrompt(options.referenceImages) : "",
    options.inputControlMode === "multi_reference" ? buildReferenceVideoPrompt(options.hasReferenceVideo) : "",
    buildReferenceImageNumberPrompt(options),
    options.userExtraPrompt?.trim() ? `User extra prompt: ${options.userExtraPrompt.trim()}` : ""
  ].filter(Boolean).join("\n\n");
}

const taskSchema = z.object({
  taskName: z.string().trim().max(80).optional().default(""),
  userExtraPrompt: z.string().trim().max(4000).optional().default(""),
  prompt: z.string().trim().max(4000).optional().default(""),
  inputControlMode: z.enum(["multi_reference", "keyframe_control"]).default("multi_reference"),
  rotationMode: z.enum(["horizontal_360", "vertical_360", "turntable"]).default("horizontal_360"),
  aspectRatio: z.enum(["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"]).default("1:1"),
  resolutionPreset: z.enum(["480p", "720p", "1080p", "4k"]).default("720p"),
  duration: z.coerce.number().int().min(4, { message: SEEDANCE_DURATION_MESSAGE }).max(15, { message: SEEDANCE_DURATION_MESSAGE }).default(4),
  fps: z.coerce.number().int().min(1).max(60).default(24),
  width: z.coerce.number().int().min(128).max(8192).default(1024),
  height: z.coerce.number().int().min(128).max(8192).default(1024),
  frameExtractMode: z.enum(["interval", "total_count"]).default("interval"),
  frameInterval: z.coerce.number().int().min(1).max(120).default(4),
  totalExtractCount: z.coerce.number().int().min(1).max(120).optional()
}).refine((value) => value.width * value.height >= MIN_SEEDANCE_PIXEL_COUNT, {
  message: "Seedance 2.0 要求视频总像素数不低于 409600，请选择 720P 或更高规格。",
  path: ["width"]
});

app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/runtime-config", (_req, res) => {
  res.json({
    seedanceMock: config.seedanceMock,
    hasArkApiKey: Boolean(config.ark.apiKey),
    arkBaseUrl: config.ark.baseUrl,
    arkModelId: config.ark.modelId,
    ossEnabled: oss.enabled,
    ossBucket: oss.bucket,
    ossBaseUrl: oss.baseUrl,
    ossTempPrefix: oss.tempPrefix,
    ossHasAccessKey: oss.hasCredentials
  });
});

app.post("/api/tasks", upload.fields([
  { name: "image", maxCount: 1 },
  { name: "referenceFrontImage", maxCount: 1 },
  { name: "referenceSideImage", maxCount: 1 },
  { name: "referenceBackImage", maxCount: 1 },
  { name: "referenceVideo", maxCount: 1 },
  { name: "keyframeMiddleImages", maxCount: MAX_MIDDLE_KEYFRAMES },
  { name: "finalFrameImage", maxCount: 1 }
]), async (req, res, next) => {
  try {
    const uploaded = filesByField(req);
    const imageFile = uploaded.image?.[0];
    const referenceVideoFile = uploaded.referenceVideo?.[0];
    const middleKeyframeFiles = (uploaded.keyframeMiddleImages ?? []).slice(0, MAX_MIDDLE_KEYFRAMES);
    const finalFrameFile = uploaded.finalFrameImage?.[0];
    const referenceImageFiles = referenceImageFields.flatMap((item) => {
      const file = uploaded[item.field]?.[0];
      return file ? [{ ...item, file }] : [];
    });

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
    for (const item of referenceImageFiles) {
      if (!item.file.mimetype.startsWith("image/")) {
        res.status(400).json({ message: `${item.field} must be an image file` });
        return;
      }
    }
    for (const [index, file] of middleKeyframeFiles.entries()) {
      if (!file.mimetype.startsWith("image/")) {
        res.status(400).json({ message: `keyframeMiddleImages[${index}] must be an image file` });
        return;
      }
    }
    if (finalFrameFile && !finalFrameFile.mimetype.startsWith("image/")) {
      res.status(400).json({ message: "finalFrameImage must be an image file" });
      return;
    }

    const params = taskSchema.parse(req.body);
    if (params.inputControlMode === "keyframe_control" && (referenceImageFiles.length > 0 || referenceVideoFile)) {
      res.status(400).json({ message: "关键帧控制模式不能同时使用三视图或参考视频" });
      return;
    }
    if (params.inputControlMode === "multi_reference" && (middleKeyframeFiles.length > 0 || finalFrameFile)) {
      res.status(400).json({ message: "多参考图模式不能同时提交关键帧图片" });
      return;
    }
    const taskId = randomUUID();
    const taskName = params.taskName || `任务-${taskId.slice(0, 8)}`;
    const sourcePng = await normalizeImageUpload(imageFile);
    const paths = getTaskPaths(config.storageRoot, taskId);
    await ensureTaskDirs(paths);
    await fs.writeFile(paths.sourceImage, sourcePng);
    const sourceUpload = oss.enabled
      ? await oss.uploadTempObject(taskId, "source-image", "source.png", sourcePng, "image/png")
      : null;
    const referenceImages: TaskReferenceImage[] = [];
    for (const item of referenceImageFiles) {
      const referencePng = await normalizeImageUpload(item.file);
      const filePath = path.join(paths.sourceDir, item.fileName);
      await fs.writeFile(filePath, referencePng);
      const referenceUpload = oss.enabled
        ? await oss.uploadTempObject(taskId, "reference-image", item.fileName, referencePng, "image/png")
        : null;
      referenceImages.push({
        role: item.role,
        filePath,
        fileName: item.fileName,
        url: referenceUpload?.url ?? null,
        ossKey: referenceUpload?.key ?? null
      });
    }
    const keyframeImages: TaskKeyframeImage[] = params.inputControlMode === "keyframe_control"
      ? [{
        role: "initial",
        index: 0,
        filePath: paths.sourceImage,
        fileName: "source.png",
        url: sourceUpload?.url ?? null,
        ossKey: sourceUpload?.key ?? null
      }]
      : [];
    if (params.inputControlMode === "keyframe_control") {
      for (const [index, file] of middleKeyframeFiles.entries()) {
        const keyframePng = await normalizeImageUpload(file);
        const fileName = `keyframe-middle-${index + 1}.png`;
        const filePath = path.join(paths.sourceDir, fileName);
        await fs.writeFile(filePath, keyframePng);
        const keyframeUpload = oss.enabled
          ? await oss.uploadTempObject(taskId, "reference-image", fileName, keyframePng, "image/png")
          : null;
        keyframeImages.push({
          role: "middle",
          index: index + 1,
          filePath,
          fileName,
          url: keyframeUpload?.url ?? null,
          ossKey: keyframeUpload?.key ?? null
        });
      }
      if (finalFrameFile) {
        const keyframePng = await normalizeImageUpload(finalFrameFile);
        const fileName = keyframeImageFields[0].fileName;
        const filePath = path.join(paths.sourceDir, fileName);
        await fs.writeFile(filePath, keyframePng);
        const keyframeUpload = oss.enabled
          ? await oss.uploadTempObject(taskId, "reference-image", fileName, keyframePng, "image/png")
          : null;
        keyframeImages.push({
          role: "final",
          index: middleKeyframeFiles.length + 1,
          filePath,
          fileName,
          url: keyframeUpload?.url ?? null,
          ossKey: keyframeUpload?.key ?? null
        });
      }
    }
    const referenceVideoFileName = referenceVideoFile ? safeReferenceVideoFileName(taskId, referenceVideoFile.originalname) : null;
    const referenceVideoPath = referenceVideoFileName ? path.join(paths.sourceDir, referenceVideoFileName) : null;
    let referenceVideoOriginalMeta: VideoMediaMeta | null = null;
    let referenceVideoProcessedMeta: VideoMediaMeta | null = null;
    let referenceVideoWasUpscaled = false;
    let referenceVideoUploadPath = referenceVideoPath;
    let referenceVideoUploadFileName = referenceVideoFileName;
    let referenceVideoUploadMimeType = referenceVideoFile?.mimetype || "application/octet-stream";
    if (referenceVideoFile && referenceVideoPath) {
      await fs.writeFile(referenceVideoPath, referenceVideoFile.buffer);
      referenceVideoOriginalMeta = await probeVideoMeta(referenceVideoPath);
      referenceVideoProcessedMeta = referenceVideoOriginalMeta;
      if ((referenceVideoOriginalMeta.pixelCount ?? 0) < MIN_SEEDANCE_PIXEL_COUNT) {
        referenceVideoWasUpscaled = true;
        referenceVideoUploadFileName = referenceVideoFileName?.replace(/\.[^.]+$/, "-upscaled.mp4") ?? `reference-video-${taskId}-${Date.now()}-upscaled.mp4`;
        referenceVideoUploadPath = path.join(paths.sourceDir, referenceVideoUploadFileName);
        await upscaleReferenceVideo(referenceVideoPath, referenceVideoUploadPath);
        referenceVideoProcessedMeta = await probeVideoMeta(referenceVideoUploadPath);
        if ((referenceVideoProcessedMeta.pixelCount ?? 0) < MIN_SEEDANCE_PIXEL_COUNT) {
          throw new Error("Reference video upscaling did not reach Seedance minimum pixel count");
        }
        referenceVideoUploadMimeType = "video/mp4";
      }
    }
    const referenceVideoUpload = oss.enabled && referenceVideoFile
      ? await oss.uploadTempObject(
        taskId,
        "reference-video",
        referenceVideoUploadFileName ?? "reference-video.mp4",
        await fs.readFile(referenceVideoUploadPath as string),
        referenceVideoUploadMimeType
      )
      : null;

    const now = new Date().toISOString();
    const task: Task = {
      id: taskId,
      name: taskName,
      sourceImagePath: paths.sourceImage,
      sourceImageUrl: sourceUpload?.url ?? null,
      sourceImageOssKey: sourceUpload?.key ?? null,
      referenceImages,
      keyframeImages,
      referenceVideoPath: referenceVideoUploadPath,
      referenceVideoUrl: referenceVideoUpload?.url ?? null,
      referenceVideoOssKey: referenceVideoUpload?.key ?? null,
      referenceVideoFileName: referenceVideoUploadFileName,
      referenceVideoMimeType: referenceVideoUploadMimeType,
      referenceVideoFileSize: referenceVideoUploadPath ? (await fs.stat(referenceVideoUploadPath)).size : null,
      referenceVideoOriginalMeta,
      referenceVideoProcessedMeta,
      referenceVideoWasUpscaled,
      prompt: buildSeedancePrompt({
        userExtraPrompt: params.userExtraPrompt || params.prompt,
        rotationMode: params.rotationMode as RotationMode,
        referenceImages,
        keyframeImages,
        inputControlMode: params.inputControlMode as InputControlMode,
        hasReferenceVideo: Boolean(referenceVideoUpload)
      }),
      userExtraPrompt: params.userExtraPrompt || params.prompt || null,
      inputControlMode: params.inputControlMode as InputControlMode,
      rotationMode: params.rotationMode as RotationMode,
      aspectRatio: params.aspectRatio as AspectRatio,
      resolutionPreset: params.resolutionPreset as ResolutionPreset,
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
      fileSize: sourcePng.length,
      sortOrder: 0
    });
    for (const item of referenceImages) {
      await store.addOutput(taskId, {
        outputType: "reference_image",
        filePath: item.filePath,
        fileName: item.fileName,
        fileSize: (await fs.stat(item.filePath)).size,
        sortOrder: referenceImageFields.find((field) => field.role === item.role)?.sortOrder ?? 0
      });
    }
    for (const item of keyframeImages) {
      await store.addOutput(taskId, {
        outputType: "keyframe_image",
        filePath: item.filePath,
        fileName: item.role === "initial" ? "视频初始帧.png" : item.role === "final" ? "视频尾帧.png" : `中间帧 ${item.index}.png`,
        fileSize: (await fs.stat(item.filePath)).size,
        sortOrder: item.role === "initial" ? 0 : item.role === "middle" ? item.index : 100
      });
    }
    if (referenceImages.length > 0) {
      await store.addLog(taskId, "QUEUED", "info", "Reference view images uploaded", {
        roles: referenceImages.map((item) => item.role)
      });
    }
    if (keyframeImages.length > 0) {
      await store.addLog(taskId, "QUEUED", "info", "Keyframe control images uploaded", {
        frames: keyframeImages.map((item) => ({ role: item.role, index: item.index, url: item.url }))
      });
    }
    if (referenceVideoUpload) {
      await store.addOutput(taskId, {
        outputType: "reference_video",
        filePath: referenceVideoUploadPath as string,
        fileName: referenceVideoUploadFileName as string,
        fileSize: referenceVideoUploadPath ? (await fs.stat(referenceVideoUploadPath)).size : 0,
        sortOrder: 4
      });
      await store.addLog(taskId, "QUEUED", "info", "Reference video uploaded to OSS temp directory", {
        originalName: referenceVideoFile?.originalname,
        storedFileName: referenceVideoUploadFileName,
        originalMeta: referenceVideoOriginalMeta,
        processedMeta: referenceVideoProcessedMeta,
        wasUpscaled: referenceVideoWasUpscaled,
        mimeType: referenceVideoUploadMimeType,
        fileSize: referenceVideoUploadPath ? (await fs.stat(referenceVideoUploadPath)).size : 0,
        ossKey: referenceVideoUpload.key,
        url: referenceVideoUpload.url
      });
      if (referenceVideoWasUpscaled) {
        await store.addLog(taskId, "QUEUED", "info", "Reference video was automatically upscaled before OSS upload", {
          from: referenceVideoOriginalMeta,
          to: referenceVideoProcessedMeta
        });
      }
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
    const retryPatch: Partial<Task> = { status: nextStatus, progress: action === "extract" ? 45 : 0, errorMessage: null, finishedAt: null };
    if (action === "generate" && task.duration < 4) {
      retryPatch.duration = 4;
    }
    await store.update(req.params.id, retryPatch);
    await store.addLog(req.params.id, nextStatus, "info", action === "extract" ? "Task requeued for frame extraction" : "Task requeued for video generation");
    if (action === "generate" && task.duration < 4) {
      await store.addLog(req.params.id, nextStatus, "warn", "Task duration was raised to 4 seconds for Seedance 2.0 compatibility");
    }
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
      res.json({ ok: true, deleted: false, message: "Task already deleted" });
      return;
    }
    for (const dir of ["uploads", "videos", "frames", "cutouts", "previews", "zips"]) {
      await fs.rm(assertInside(config.storageRoot, path.join(config.storageRoot, dir, taskId)), {
        recursive: true,
        force: true
      });
    }
    await Promise.all([
      oss.deleteObject(task.sourceImageOssKey),
      oss.deleteObject(task.referenceVideoOssKey),
      ...(task.referenceImages ?? []).map((item) => oss.deleteObject(item.ossKey)),
      ...(task.keyframeImages ?? []).map((item) => item.role === "initial" ? Promise.resolve() : oss.deleteObject(item.ossKey))
    ]);
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

app.get("/api/tasks/:id/preview/keyframe/:index", async (req, res, next) => {
  try {
    const task = await store.get(req.params.id);
    if (!task) return res.status(404).json({ message: "Task not found" });
    return sendPreview(res, task, "keyframe_image", Number(req.params.index) - 1);
  } catch (error) {
    return next(error);
  }
});

app.get("/api/tasks/:id/preview/reference/:index", async (req, res, next) => {
  try {
    const task = await store.get(req.params.id);
    if (!task) return res.status(404).json({ message: "Task not found" });
    return sendPreview(res, task, "reference_image", Number(req.params.index) - 1);
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
  if (oss.enabled) {
    const cleanup = () => oss.cleanupTempObjectsOlderThan()
      .then((removed) => {
        if (removed > 0) {
          console.log(`OSS temp cleanup removed ${removed} object(s) from ${oss.tempPrefix}`);
        }
      })
      .catch((error: unknown) => {
        console.warn("OSS temp cleanup failed", error instanceof Error ? error.message : String(error));
      });
    void cleanup();
    setInterval(cleanup, 60 * 60 * 1000).unref();
  }
});
