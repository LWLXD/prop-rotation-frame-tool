export const taskStatuses = [
  "PENDING",
  "QUEUED",
  "GENERATING_VIDEO",
  "VIDEO_GENERATED",
  "DOWNLOADING_VIDEO",
  "VIDEO_DOWNLOADED",
  "EXTRACTING_FRAMES",
  "FRAMES_EXTRACTED",
  "REMOVING_BG",
  "BG_REMOVED",
  "PACKAGING",
  "SUCCESS",
  "FAILED",
  "CANCELLED"
] as const;

export type TaskStatus = (typeof taskStatuses)[number];

export type OutputType =
  | "source"
  | "reference_image"
  | "keyframe_image"
  | "reference_video"
  | "video"
  | "raw_frame"
  | "cutout"
  | "zip"
  | "raw_frames_zip"
  | "cutouts_zip"
  | "preview";

export type RotationMode = "horizontal_360" | "vertical_360" | "turntable";

export type InputControlMode = "multi_reference" | "keyframe_control";

export type FrameExtractMode = "interval" | "total_count";

export type AspectRatio = "21:9" | "16:9" | "4:3" | "1:1" | "3:4" | "9:16";

export type ResolutionPreset = "480p" | "720p" | "1080p" | "4k";

export type ReferenceImageRole = "front" | "side" | "back";

export type KeyframeImageRole = "initial" | "middle" | "final";

export type VideoMediaMeta = {
  width?: number;
  height?: number;
  pixelCount?: number;
  duration?: number;
  format?: string;
};

export type TaskReferenceImage = {
  role: ReferenceImageRole;
  filePath: string;
  fileName: string;
  url?: string | null;
  ossKey?: string | null;
};

export type TaskKeyframeImage = {
  role: KeyframeImageRole;
  index: number;
  filePath: string;
  fileName: string;
  url?: string | null;
  ossKey?: string | null;
};

export type TaskParams = {
  taskName: string;
  userExtraPrompt?: string;
  inputControlMode: InputControlMode;
  rotationMode: RotationMode;
  aspectRatio?: AspectRatio;
  resolutionPreset?: ResolutionPreset;
  duration: number;
  fps: number;
  width: number;
  height: number;
  frameExtractMode: FrameExtractMode;
  frameInterval: number;
  totalExtractCount?: number | null;
};

export type TaskOutput = {
  id: string;
  taskId: string;
  outputType: OutputType;
  filePath: string;
  fileName: string;
  fileSize: number;
  sortOrder: number;
  createdAt: string;
};

export type TaskLog = {
  id: string;
  taskId: string;
  stage: TaskStatus | "SYSTEM";
  level: "info" | "warn" | "error";
  message: string;
  meta?: Record<string, unknown>;
  createdAt: string;
};

export type Task = {
  id: string;
  name: string;
  sourceImagePath: string;
  sourceImageUrl?: string | null;
  sourceImageOssKey?: string | null;
  referenceImages?: TaskReferenceImage[];
  keyframeImages?: TaskKeyframeImage[];
  referenceVideoPath?: string | null;
  referenceVideoUrl?: string | null;
  referenceVideoOssKey?: string | null;
  referenceVideoFileName?: string | null;
  referenceVideoMimeType?: string | null;
  referenceVideoFileSize?: number | null;
  referenceVideoOriginalMeta?: VideoMediaMeta | null;
  referenceVideoProcessedMeta?: VideoMediaMeta | null;
  referenceVideoWasUpscaled?: boolean;
  prompt: string;
  userExtraPrompt?: string | null;
  inputControlMode: InputControlMode;
  rotationMode: RotationMode;
  aspectRatio?: AspectRatio;
  resolutionPreset?: ResolutionPreset;
  duration: number;
  fps: number;
  width: number;
  height: number;
  frameExtractMode: FrameExtractMode;
  frameInterval: number;
  totalExtractCount?: number | null;
  status: TaskStatus;
  progress: number;
  errorMessage?: string | null;
  seedanceTaskId?: string | null;
  seedanceRawResponse?: unknown;
  videoPath?: string | null;
  zipPath?: string | null;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string | null;
  outputs: TaskOutput[];
  logs: TaskLog[];
};

export type TaskListResponse = {
  items: Task[];
  total: number;
  page: number;
  pageSize: number;
};

export const defaultPrompt =
  "Keep the same prop appearance as the main image. Preserve the original color, simplified material, rounded bevels, thickness, soft surface highlights, proportions, and overall stylized 3D casual game prop icon style. The visual style should feel like a polished Western cartoon mobile game icon: clean chunky shapes, saturated friendly colors, smooth toy-like surfaces, soft painted highlights, and simple readable shading. Avoid photorealism, cinematic lighting, PBR realism, metallic/glass/stone material complexity, scratches, grime, heavy reflections, and overly detailed texture. Use a clean simple background and stable lighting. The video should look like the same object rotating, not a redesigned or photorealistic object. For horizontal rotation, make the prop complete exactly one full 360-degree yaw turn at constant speed: 0% original main view, 25% side view, 50% inferred back view, 75% opposite side view, and 100% back to the original main view. The first and final frames should match closely so the video can loop seamlessly with no visible pop, jump cut, fade, lighting shift, scale change, position shift, pose mismatch, slow stop, or reset motion. Do not make it wobble, rock back and forth, pause, stop at half rotation, or jump between a few static angles. If rough front, side, or back sketches are provided, use them only to infer structure and hidden details while keeping the final rendered appearance anchored to the main image and the same cartoon icon material on unseen sides.";

export function isTerminalStatus(status: TaskStatus): boolean {
  return status === "SUCCESS" || status === "FAILED" || status === "CANCELLED";
}
