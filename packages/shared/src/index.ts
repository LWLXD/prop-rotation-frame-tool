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
  "\u8bf7\u6839\u636e\u8f93\u5165\u56fe\u7247\u4e2d\u7684\u6b27\u5361\u9053\u5177\u751f\u6210\u4e00\u4e2a\u5e73\u6ed1\u65cb\u8f6c\u5c55\u793a\u89c6\u9891\u3002\u4e3b\u53c2\u8003\u56fe\u51b3\u5b9a\u6700\u7ec8\u5916\u89c2\uff1b\u5982\u679c\u4e0a\u4f20\u4e86\u6b63\u9762\u3001\u4fa7\u9762\u3001\u80cc\u9762\u4e09\u89c6\u56fe\uff0c\u8bf7\u5c06\u8fd9\u4e9b\u56fe\u7247\u4f5c\u4e3a\u7ed3\u6784\u53c2\u8003\uff0c\u7528\u4e8e\u6821\u51c6\u9053\u5177\u7684\u8f6e\u5ed3\u3001\u539a\u5ea6\u3001\u80cc\u9762\u7ec6\u8282\u548c\u4fa7\u9762\u6bd4\u4f8b\uff0c\u4f46\u4e0d\u8981\u751f\u6210\u5206\u5c4f\u6216\u4e09\u89c6\u56fe\u6392\u7248\u3002\u4fdd\u6301\u9053\u5177\u7684\u539f\u59cb\u5916\u89c2\u3001\u989c\u8272\u3001\u6750\u8d28\u3001\u8f6e\u5ed3\u3001\u6bd4\u4f8b\u548c\u98ce\u683c\u4e0d\u53d8\uff0c\u53ea\u8ba9\u9053\u5177\u56f4\u7ed5\u81ea\u8eab\u4e2d\u5fc3\u8fdb\u884c\u6c34\u5e73 360 \u5ea6\u65cb\u8f6c\u3002\u753b\u9762\u4fdd\u6301\u4e2d\u5fc3\u6784\u56fe\uff0c\u80cc\u666f\u5e72\u51c0\u7edf\u4e00\uff0c\u4e0d\u6dfb\u52a0\u4efb\u4f55\u65b0\u5143\u7d20\uff0c\u4e0d\u6539\u53d8\u9053\u5177\u8bbe\u8ba1\uff0c\u4e0d\u6539\u53d8\u9053\u5177\u989c\u8272\uff0c\u4e0d\u4ea7\u751f\u53d8\u5f62\u3001\u878d\u5316\u3001\u95ea\u70c1\u3001\u6296\u52a8\u3001\u6b8b\u5f71\u6216\u98ce\u683c\u6f02\u79fb\u3002\u4fdd\u6301\u6b27\u5f0f\u4f11\u95f2\u6e38\u620f 3D \u9053\u5177\u56fe\u6807\u8d28\u611f\uff0c\u8fb9\u7f18\u6e05\u6670\uff0c\u4f53\u5757\u5706\u6da6\uff0c\u5149\u5f71\u7a33\u5b9a\uff0c\u6750\u8d28\u5e72\u51c0\uff0c\u65cb\u8f6c\u8fc7\u7a0b\u81ea\u7136\u8fde\u8d2f\u3002";

export function isTerminalStatus(status: TaskStatus): boolean {
  return status === "SUCCESS" || status === "FAILED" || status === "CANCELLED";
}
