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
  | "reference_video"
  | "video"
  | "raw_frame"
  | "cutout"
  | "zip"
  | "raw_frames_zip"
  | "cutouts_zip"
  | "preview";

export type RotationMode = "horizontal_360" | "vertical_360" | "turntable";

export type FrameExtractMode = "interval" | "total_count";

export type ReferenceImageRole = "front" | "side" | "back";

export type TaskReferenceImage = {
  role: ReferenceImageRole;
  filePath: string;
  fileName: string;
  url?: string | null;
  ossKey?: string | null;
};

export type TaskParams = {
  taskName: string;
  prompt: string;
  rotationMode: RotationMode;
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
  referenceVideoPath?: string | null;
  referenceVideoUrl?: string | null;
  referenceVideoOssKey?: string | null;
  prompt: string;
  rotationMode: RotationMode;
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
  "Keep the same prop appearance as the main image. Preserve the original color, material, rounded bevels, thickness, surface highlights, proportions, and overall stylized 3D game prop icon style. Use a clean simple background and stable lighting. The video should look like the same object rotating, not a redesigned or photorealistic object.";

export function isTerminalStatus(status: TaskStatus): boolean {
  return status === "SUCCESS" || status === "FAILED" || status === "CANCELLED";
}
