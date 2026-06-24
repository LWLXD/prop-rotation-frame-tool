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
  referenceVideoPath?: string | null;
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
  "请根据输入图片中的单个欧卡道具生成一个平滑旋转展示视频。保持道具的原始外观、颜色、材质、轮廓、厚度、比例和风格不变，只让道具围绕自身中心进行水平 360 度旋转。画面保持中心构图，背景干净统一，不添加任何新元素，不改变道具设计，不改变道具颜色，不产生变形、融化、闪烁、抖动、残影或风格漂移。保持欧式休闲游戏 3D 道具图标质感，边缘清晰，体块圆润，光影稳定，材质干净，旋转过程自然连贯。";

export function isTerminalStatus(status: TaskStatus): boolean {
  return status === "SUCCESS" || status === "FAILED" || status === "CANCELLED";
}
