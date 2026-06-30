import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Download, FileVideo, Images, RefreshCw, RotateCw, Trash2, Upload, XCircle } from "lucide-react";
import { type FrameExtractMode, type InputControlMode, type RotationMode, type Task, type TaskStatus } from "@prop-tool/shared";
import {
  cancelTask,
  createTask,
  deleteTask,
  downloadUrl,
  extractTask,
  getRuntimeConfig,
  getTask,
  listTasks,
  previewUrl,
  retryTask
} from "./api";
import type { RuntimeConfig } from "./api";

type FormState = {
  taskName: string;
  userExtraPrompt: string;
  inputControlMode: InputControlMode;
  rotationMode: RotationMode;
  aspectRatio: AspectRatio;
  resolutionPreset: ResolutionPreset;
  duration: number;
  fps: number;
  width: number;
  height: number;
  frameExtractMode: FrameExtractMode;
  frameInterval: number;
  totalExtractCount: number;
};

type AspectRatio = "21:9" | "16:9" | "4:3" | "1:1" | "3:4" | "9:16";
type ResolutionPreset = "480p" | "720p" | "1080p" | "4k";
type NumberField = "duration" | "fps" | "frameInterval" | "totalExtractCount";
type ReferenceViewKey = "front" | "side" | "back";
type ReferenceVideoProbeStatus = "idle" | "selected" | "probing" | "valid" | "low" | "failed";
type ReferenceVideoProbe = {
  status: ReferenceVideoProbeStatus;
  width?: number;
  height?: number;
  pixelCount?: number;
  message: string;
};
type MiddleKeyframeItem = {
  id: string;
  file: File;
  previewUrl: string;
  hasPreviewError: boolean;
};

const MIN_SEEDANCE_PIXEL_COUNT = 409600;
const MAX_MIDDLE_KEYFRAMES = 5;
const ASPECT_RATIO_OPTIONS: Array<{ label: AspectRatio; value: AspectRatio }> = [
  { label: "21:9", value: "21:9" },
  { label: "16:9", value: "16:9" },
  { label: "4:3", value: "4:3" },
  { label: "1:1", value: "1:1" },
  { label: "3:4", value: "3:4" },
  { label: "9:16", value: "9:16" }
];
const RESOLUTION_PRESET_OPTIONS: Array<{ label: string; value: ResolutionPreset; base: number }> = [
  { label: "480P", value: "480p", base: 480 },
  { label: "720P", value: "720p", base: 720 },
  { label: "1080P", value: "1080p", base: 1080 },
  { label: "4K", value: "4k", base: 2160 }
];

function roundEven(value: number) {
  return Math.ceil(value / 2) * 2;
}

function parseAspectRatio(aspectRatio: AspectRatio) {
  const [w, h] = aspectRatio.split(":").map(Number);
  return { w, h };
}

function calculateVideoSize(aspectRatio: AspectRatio, preset: ResolutionPreset) {
  const presetBaseMap: Record<ResolutionPreset, number> = {
    "480p": 480,
    "720p": 720,
    "1080p": 1080,
    "4k": 2160
  };
  const base = presetBaseMap[preset];
  const { w, h } = parseAspectRatio(aspectRatio);
  let width: number;
  let height: number;

  if (w >= h) {
    height = base;
    width = roundEven((base * w) / h);
  } else {
    width = base;
    height = roundEven((base * h) / w);
  }

  width = roundEven(width);
  height = roundEven(height);

  const pixelCount = width * height;
  if (pixelCount < MIN_SEEDANCE_PIXEL_COUNT) {
    const scale = Math.sqrt(MIN_SEEDANCE_PIXEL_COUNT / pixelCount);
    width = roundEven(width * scale);
    height = roundEven(height * scale);
  }

  return { width, height, pixelCount: width * height };
}

const ui = {
  title: "\u6b27\u5361\u9053\u5177\u65cb\u8f6c\u9010\u5e27\u5de5\u5177",
  subtitle: "\u5185\u7f51\u65e0\u8d26\u53f7\u7248",
  refresh: "\u5237\u65b0",
  createTask: "\u521b\u5efa\u4efb\u52a1",
  submitting: "\u63d0\u4ea4\u4e2d",
  generateVideo: "\u751f\u6210\u89c6\u9891",
  chooseImage: "\u8bf7\u9009\u62e9\u56fe\u7247",
  durationRange: "\u0053\u0065\u0065\u0064\u0061\u006e\u0063\u0065\u0020\u0032\u002e\u0030\u0020\u652f\u6301\u7684\u65f6\u957f\u4e3a\u0020\u0034\u007e\u0031\u0035\u0020\u79d2",
  inputControlMode: "\u8f93\u5165\u63a7\u5236\u6a21\u5f0f",
  multiReference: "\u591a\u53c2\u8003\u56fe",
  keyframeControl: "\u5173\u952e\u5e27\u63a7\u5236",
  multiReferenceHint: "\u591a\u53c2\u8003\u56fe\u6a21\u5f0f\uff1a\u652f\u6301\u4e3b\u56fe\u3001\u4e09\u89c6\u56fe\u548c\u53c2\u8003\u89c6\u9891\u3002\u9002\u5408\u751f\u6210\u7a33\u5b9a\u7684\u9053\u5177\u6c34\u5e73\u65cb\u8f6c\u89c6\u9891\u3002",
  keyframeControlHint: "\u5173\u952e\u5e27\u63a7\u5236\u6a21\u5f0f\u7528\u4e8e\u901a\u8fc7\u201c\u521d\u59cb\u5e27 \u2192 \u4e2d\u95f4\u5e27 \u2192 \u5c3e\u5e27\u201d\u7ea6\u675f\u89c6\u9891\u53d8\u5316\u8fc7\u7a0b\u3002\u4e2d\u95f4\u5e27\u53ef\u4e0a\u4f20\u591a\u5f20\uff0c\u6309\u663e\u793a\u987a\u5e8f\u751f\u6548\u3002",
  keyframeReferenceConflict: "\u5173\u952e\u5e27\u63a7\u5236\u6a21\u5f0f\u4e0d\u80fd\u540c\u65f6\u4f7f\u7528\u53c2\u8003\u89c6\u9891\u3002\u8bf7\u79fb\u9664\u53c2\u8003\u89c6\u9891\uff0c\u6216\u5207\u6362\u4e3a\u591a\u53c2\u8003\u56fe\u6a21\u5f0f\u3002",
  keyframeReferenceImageConflict: "\u5173\u952e\u5e27\u63a7\u5236\u6a21\u5f0f\u4e0d\u80fd\u540c\u65f6\u4f7f\u7528\u4e09\u89c6\u56fe\u3002\u8bf7\u79fb\u9664\u4e09\u89c6\u56fe\uff0c\u6216\u5207\u6362\u4e3a\u591a\u53c2\u8003\u56fe\u6a21\u5f0f\u3002",
  clearReferences: "\u6e05\u9664\u53c2\u8003",
  referenceVideo: "\u53c2\u8003\u89c6\u9891\uff08\u53ef\u9009\uff0c\u4ec5\u4e0a\u4f20 OSS \u4e34\u65f6 URL\uff09",
  referenceVideoHint: "\u53c2\u8003\u89c6\u9891\u53ea\u7528\u4e8e\u53c2\u8003\u8fd0\u52a8\u8282\u594f\u548c\u955c\u5934\u7a33\u5b9a\u6027\uff0c\u4e0d\u4f1a\u4f5c\u4e3a\u9996\u5c3e\u5e27\u6216\u4e2d\u95f4\u5e27\u3002",
  noReferenceVideo: "\u672a\u9009\u62e9\u53c2\u8003\u89c6\u9891",
  initialFrame: "\u89c6\u9891\u521d\u59cb\u5e27",
  initialFrameHint: "\u8be5\u56fe\u7247\u5c06\u4f5c\u4e3a\u89c6\u9891\u751f\u6210\u7684\u8d77\u59cb\u753b\u9762\uff0c\u7528\u4e8e\u786e\u5b9a\u7269\u4f53\u521d\u59cb\u5916\u89c2\u3001\u6784\u56fe\u3001\u6750\u8d28\u548c\u98ce\u683c\u3002",
  mainReferenceImage: "\u4e3b\u53c2\u8003\u56fe",
  mainReferenceHint: "\u4f5c\u4e3a\u7269\u4f53\u5916\u89c2\u548c\u98ce\u683c\u7684\u6700\u9ad8\u4f18\u5148\u7ea7\u53c2\u8003\u3002",
  middleKeyframes: "\u4e2d\u95f4\u5e27\u53c2\u8003\u56fe",
  middleKeyframesHint: "\u53ef\u9009\u3002\u4e0a\u4f20\u540e\u5c06\u6309\u987a\u5e8f\u7ea6\u675f\u89c6\u9891\u4e2d\u95f4\u8fc7\u7a0b\uff0c\u9002\u5408\u63a7\u5236\u65cb\u8f6c\u89d2\u5ea6\u3001\u59ff\u6001\u53d8\u5316\u6216\u5173\u952e\u52a8\u4f5c\u9636\u6bb5\u3002",
  middleFrame: "\u4e2d\u95f4\u5e27",
  finalFrame: "\u89c6\u9891\u5c3e\u5e27",
  finalFrameHint: "\u53ef\u9009\u3002\u7528\u4e8e\u7ea6\u675f\u89c6\u9891\u7ed3\u675f\u753b\u9762\uff0c\u4f7f\u751f\u6210\u7ed3\u679c\u66f4\u63a5\u8fd1\u76ee\u6807\u7ec8\u6001\u3002",
  removeImage: "\u5220\u9664\u56fe\u7247",
  threeViewTitle: "\u4e09\u89c6\u56fe\u53c2\u8003\uff08\u53ef\u9009\uff09",
  threeViewHint: "\u7528\u4e8e\u8865\u5145\u6b63\u9762\u3001\u4fa7\u9762\u3001\u80cc\u9762\u7ed3\u6784\uff0c\u751f\u6210\u65f6\u4f1a\u4e00\u8d77\u4f20\u7ed9 Seedance\u3002",
  front: "\u6b63\u9762",
  side: "\u4fa7\u9762",
  back: "\u80cc\u9762",
  clickUpload: "\u70b9\u51fb\u4e0a\u4f20",
  taskName: "\u4efb\u52a1\u540d\u79f0",
  rotationMode: "\u65cb\u8f6c\u65b9\u5f0f",
  horizontal360: "\u6c34\u5e73 360",
  vertical360: "\u5782\u76f4 360",
  turntable: "\u8f6c\u53f0\u5c55\u793a",
  aspectRatio: "\u89c6\u9891\u6bd4\u4f8b",
  resolutionPreset: "\u89c6\u9891\u5927\u5c0f",
  estimatedVideo: "\u751f\u6210\u89c6\u9891\u9884\u4f30",
  seedanceSizeRaised: "\u5f53\u524d\u7ec4\u5408\u4f4e\u4e8e Seedance \u6700\u4f4e\u50cf\u7d20\u8981\u6c42\uff0c\u5df2\u81ea\u52a8\u63d0\u5347\u3002",
  durationTooLong: "\u0053\u0065\u0065\u0064\u0061\u006e\u0063\u0065\u0020\u0032\u002e\u0030\u0020\u5f53\u524d\u6700\u957f\u652f\u6301\u0020\u0031\u0035\u0020\u79d2\u3002",
  durationTooShort: "\u0053\u0065\u0065\u0064\u0061\u006e\u0063\u0065\u0020\u0032\u002e\u0030\u0020\u5f53\u524d\u6700\u77ed\u652f\u6301\u0020\u0034\u0020\u79d2\u3002",
  duration: "\u65f6\u957f",
  fps: "\u5e27\u7387",
  width: "\u5bbd\u5ea6",
  height: "\u9ad8\u5ea6",
  finalSize: "\u6700\u7ec8\u5c3a\u5bf8",
  extractParams: "\u62bd\u5e27\u53c2\u6570\uff08\u89c6\u9891\u751f\u6210\u540e\u4f7f\u7528\uff09",
  intervalExtract: "\u95f4\u9694\u62bd\u5e27",
  totalExtract: "\u56fa\u5b9a\u5f20\u6570",
  everyNFrames: "\u6bcf N \u5e27",
  totalCount: "\u603b\u5f20\u6570",
  prompt: "\u989d\u5916\u63d0\u793a\u8bcd",
  promptPlaceholder: "\u53ef\u5728\u6b64\u8f93\u5165\u989d\u5916\u63d0\u793a\u8bcd\uff0c\u7559\u7a7a\u5219\u6b63\u5e38\u65cb\u8f6c",
  promptHint: "\u7cfb\u7edf\u5df2\u5185\u7f6e\u9053\u5177\u98ce\u683c\u4fdd\u6301\u3001\u65cb\u8f6c\u63a7\u5236\u548c\u53c2\u8003\u56fe\u7ea6\u675f\u63d0\u793a\u8bcd\u3002\u6b64\u5904\u4ec5\u7528\u4e8e\u8865\u5145\u7279\u6b8a\u8981\u6c42\u3002\u652f\u6301\u4f7f\u7528 @\u56fe1\u3001@\u56fe2 \u5f15\u7528\u5bf9\u5e94\u53c2\u8003\u56fe\uff0c\u7f16\u53f7\u4ee5\u56fe\u7247\u6846\u4e0b\u65b9\u6807\u8bc6\u4e3a\u51c6\u3002",
  invalidImageRef: "\u989d\u5916\u63d0\u793a\u8bcd\u5f15\u7528\u4e86\u4e0d\u5b58\u5728\u7684\u53c2\u8003\u56fe\uff1a",
  previewFailed: "\u9884\u89c8\u5931\u8d25",
  tasks: "\u4efb\u52a1",
  startExtract: "\u5f00\u59cb\u62bd\u5e27",
  retry: "\u91cd\u8bd5",
  cancel: "\u53d6\u6d88",
  delete: "\u5220\u9664",
  size: "\u5c3a\u5bf8",
  frame: "\u5e27",
  video: "\u89c6\u9891",
  rawFrames: "\u539f\u59cb\u5e27",
  cutouts: "\u900f\u660e\u5e27",
  package: "\u5b8c\u6574\u5305",
  logs: "\u65e5\u5fd7",
  empty: "\u6682\u65e0\u4efb\u52a1",
  none: "\u65e0",
  close: "\u5173\u95ed",
  mockBanner: "\u5f53\u524d\u4e3a\u672c\u5730\u6a21\u62df\u6a21\u5f0f\uff1a\u4e0d\u4f1a\u8c03\u7528 Seedance\uff0c\u751f\u6210\u7684\u89c6\u9891\u662f\u9759\u6001\u5360\u4f4d\u89c6\u9891\u3002",
  liveBannerPrefix: "\u5f53\u524d\u4e3a Seedance API \u6a21\u5f0f\uff1a",
  missingArkKey: " \u7f3a\u5c11 ARK_API_KEY\u3002",
  ossDisabled: " OSS \u672a\u542f\u7528\uff0c\u53c2\u8003\u56fe\u7247\u65e0\u6cd5\u63d0\u4f9b\u516c\u7f51 URL\u3002",
  ossMissingKey: " OSS \u7f3a\u5c11 AccessKey\u3002",
  ossTemp: " OSS \u4e34\u65f6\u76ee\u5f55\uff1a"
};

const statusLabels: Record<TaskStatus, string> = {
  PENDING: "\u7b49\u5f85",
  QUEUED: "\u6392\u961f",
  GENERATING_VIDEO: "\u751f\u6210\u89c6\u9891",
  VIDEO_GENERATED: "\u89c6\u9891\u751f\u6210",
  DOWNLOADING_VIDEO: "\u4e0b\u8f7d\u89c6\u9891",
  VIDEO_DOWNLOADED: "\u89c6\u9891\u5df2\u4fdd\u5b58",
  EXTRACTING_FRAMES: "\u62bd\u5e27",
  FRAMES_EXTRACTED: "\u62bd\u5e27\u5b8c\u6210",
  REMOVING_BG: "\u62a0\u56fe",
  BG_REMOVED: "\u62a0\u56fe\u5b8c\u6210",
  PACKAGING: "\u6253\u5305",
  SUCCESS: "\u6210\u529f",
  FAILED: "\u5931\u8d25",
  CANCELLED: "\u53d6\u6d88"
};

const referenceViewFields: Array<{ key: ReferenceViewKey; field: string; label: string }> = [
  { key: "front", field: "referenceFrontImage", label: ui.front },
  { key: "side", field: "referenceSideImage", label: ui.side },
  { key: "back", field: "referenceBackImage", label: ui.back }
];

const terminalStatuses = new Set<TaskStatus>(["SUCCESS", "FAILED", "CANCELLED"]);

function classForStatus(status: TaskStatus) {
  if (status === "SUCCESS") return "status success";
  if (status === "FAILED") return "status failed";
  if (status === "CANCELLED") return "status muted";
  return "status active";
}

function formatTime(value?: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function countOutputs(task: Task | null, type: string) {
  return task?.outputs.filter((output) => output.outputType === type).length ?? 0;
}

function defaultTaskName() {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  return `prop_rotation_${stamp}`;
}

function createStableId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function extractImageRefs(prompt: string) {
  return [...prompt.matchAll(/@\u56fe(\d+)/g)].map((match) => Number(match[1]));
}

function imageNumberLabel(number: number, label: string) {
  return `\u56fe${number}\uff08${label}\uff09`;
}

export function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [referenceVideoFile, setReferenceVideoFile] = useState<File | null>(null);
  const [referenceVideoProbe, setReferenceVideoProbe] = useState<ReferenceVideoProbe>({
    status: "idle",
    message: ui.noReferenceVideo
  });
  const [referenceImages, setReferenceImages] = useState<Record<ReferenceViewKey, File | null>>({
    front: null,
    side: null,
    back: null
  });
  const [referencePreviews, setReferencePreviews] = useState<Record<ReferenceViewKey, string | null>>({
    front: null,
    side: null,
    back: null
  });
  const [referenceInputKey, setReferenceInputKey] = useState(0);
  const [middleKeyframes, setMiddleKeyframes] = useState<MiddleKeyframeItem[]>([]);
  const [finalFrameFile, setFinalFrameFile] = useState<File | null>(null);
  const [finalFramePreview, setFinalFramePreview] = useState<string | null>(null);
  const [keyframeInputKey, setKeyframeInputKey] = useState(0);
  const localPreviewRef = useRef<string | null>(null);
  const referencePreviewsRef = useRef<Record<ReferenceViewKey, string | null>>({ front: null, side: null, back: null });
  const middleKeyframesRef = useRef<MiddleKeyframeItem[]>([]);
  const finalFramePreviewRef = useRef<string | null>(null);
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfig | null>(null);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({
    taskName: "",
    userExtraPrompt: "",
    inputControlMode: "multi_reference",
    rotationMode: "horizontal_360",
    aspectRatio: "1:1",
    resolutionPreset: "720p",
    duration: 4,
    fps: 24,
    width: 720,
    height: 720,
    frameExtractMode: "interval",
    frameInterval: 4,
    totalExtractCount: 12
  });

  const token = selectedTask?.updatedAt ?? "";
  const rawFrameCount = countOutputs(selectedTask, "raw_frame");
  const cutoutCount = countOutputs(selectedTask, "cutout");
  const keyframeOutputs = useMemo(
    () => selectedTask?.outputs.filter((output) => output.outputType === "keyframe_image").sort((a, b) => a.sortOrder - b.sortOrder) ?? [],
    [selectedTask]
  );
  const referenceOutputs = useMemo(
    () => selectedTask?.outputs.filter((output) => output.outputType === "reference_image").sort((a, b) => a.sortOrder - b.sortOrder) ?? [],
    [selectedTask]
  );
  const canDownloadVideo = Boolean(selectedTask?.videoPath);
  const canDownloadAssets = selectedTask?.status === "SUCCESS";
  const canExtract = selectedTask?.status === "VIDEO_DOWNLOADED" && Boolean(selectedTask.videoPath);
  const hasReferenceImages = Object.values(referenceImages).some(Boolean);
  const hasReferenceMedia = hasReferenceImages || Boolean(referenceVideoFile);
  const calculatedVideoSize = useMemo(
    () => calculateVideoSize(form.aspectRatio, form.resolutionPreset),
    [form.aspectRatio, form.resolutionPreset]
  );
  const selectedResolutionLabel = RESOLUTION_PRESET_OPTIONS.find((item) => item.value === form.resolutionPreset)?.label ?? form.resolutionPreset;
  const selectedPresetBase = RESOLUTION_PRESET_OPTIONS.find((item) => item.value === form.resolutionPreset)?.base ?? 720;
  const unraisedPixelCount = (() => {
    const { w, h } = parseAspectRatio(form.aspectRatio);
    const width = w >= h ? roundEven((selectedPresetBase * w) / h) : selectedPresetBase;
    const height = w >= h ? selectedPresetBase : roundEven((selectedPresetBase * h) / w);
    return roundEven(width) * roundEven(height);
  })();
  const sizeWasRaised = unraisedPixelCount < MIN_SEEDANCE_PIXEL_COUNT;
  const finalFrameImageNumber = 2 + middleKeyframes.length;
  const validImageNumbers = useMemo(() => {
    const numbers = new Set<number>();
    if (!file) return numbers;
    numbers.add(1);
    if (form.inputControlMode === "keyframe_control") {
      middleKeyframes.forEach((_, index) => numbers.add(index + 2));
      if (finalFrameFile) numbers.add(finalFrameImageNumber);
      return numbers;
    }
    referenceViewFields.forEach((item, index) => {
      if (referenceImages[item.key]) numbers.add(index + 2);
    });
    return numbers;
  }, [file, finalFrameFile, finalFrameImageNumber, form.inputControlMode, middleKeyframes, referenceImages]);
  const emptyMiddleFrameImageNumber = finalFrameFile ? finalFrameImageNumber + 1 : middleKeyframes.length + 2;
  const finalFrameDisplayImageNumber = finalFrameFile ? finalFrameImageNumber : middleKeyframes.length + 3;

  const firstFrames = useMemo(() => {
    const raw = Array.from({ length: Math.min(8, rawFrameCount) }, (_, index) => index + 1);
    const cutouts = Array.from({ length: Math.min(8, cutoutCount) }, (_, index) => index + 1);
    return { raw, cutouts };
  }, [rawFrameCount, cutoutCount]);

  function referenceOutputLabel(fileName: string) {
    if (fileName.includes("front")) return imageNumberLabel(2, ui.front);
    if (fileName.includes("side")) return imageNumberLabel(3, ui.side);
    if (fileName.includes("back")) return imageNumberLabel(4, ui.back);
    return fileName.replace(/\.[^.]+$/i, "");
  }

  function keyframeOutputLabel(task: Task, index: number) {
    const keyframe = [...(task.keyframeImages ?? [])].sort((a, b) => {
      const sortA = a.role === "initial" ? 0 : a.role === "final" ? 100 : a.index;
      const sortB = b.role === "initial" ? 0 : b.role === "final" ? 100 : b.index;
      return sortA - sortB;
    })[index];
    if (keyframe?.role === "initial") return imageNumberLabel(index + 1, ui.initialFrame);
    if (keyframe?.role === "final") return imageNumberLabel(index + 1, ui.finalFrame);
    return imageNumberLabel(index + 1, `${ui.middleFrame}${index}`);
  }

  function selectTask(taskId: string | null) {
    selectedIdRef.current = taskId;
    setSelectedId(taskId);
    if (!taskId) {
      setSelectedTask(null);
    }
  }

  function isTaskNotFound(errorValue: unknown) {
    return errorValue instanceof Error && errorValue.message.includes("Task not found");
  }

  async function refresh(nextSelectedId?: string | null, allowAutoSelect = false) {
    const result = await listTasks();
    setTasks(result.items);
    const currentSelectedId = nextSelectedId !== undefined ? nextSelectedId : selectedIdRef.current;
    const selectedStillExists = currentSelectedId ? result.items.some((task) => task.id === currentSelectedId) : false;
    const id = selectedStillExists
      ? currentSelectedId
      : allowAutoSelect
        ? result.items[0]?.id ?? null
        : null;

    selectTask(id);
    if (!id) return;

    try {
      const detail = await getTask(id);
      if (selectedIdRef.current === id) {
        setSelectedTask(detail);
      }
    } catch (err) {
      if (isTaskNotFound(err) && selectedIdRef.current === id) {
        selectTask(null);
        setTasks((current) => current.filter((task) => task.id !== id));
        return;
      }
      throw err;
    }
  }

  useEffect(() => {
    void refresh(undefined, true).catch((err) => setError(err instanceof Error ? err.message : String(err)));
    void getRuntimeConfig().then(setRuntimeConfig).catch((err) => setError(err instanceof Error ? err.message : String(err)));
    const interval = window.setInterval(() => {
      void refresh(undefined, false).catch((err) => setError(err instanceof Error ? err.message : String(err)));
    }, 2500);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setSelectedTask(null);
      return;
    }
    void getTask(selectedId)
      .then((task) => {
        if (selectedIdRef.current === selectedId) {
          setSelectedTask(task);
        }
      })
      .catch((err) => {
        if (isTaskNotFound(err) && selectedIdRef.current === selectedId) {
          selectTask(null);
          setTasks((current) => current.filter((task) => task.id !== selectedId));
          return;
        }
        setError(err instanceof Error ? err.message : String(err));
      });
  }, [selectedId]);

  useEffect(() => {
    setForm((current) => ({
      ...current,
      width: calculatedVideoSize.width,
      height: calculatedVideoSize.height
    }));
  }, [calculatedVideoSize.width, calculatedVideoSize.height]);

  useEffect(() => {
    localPreviewRef.current = localPreview;
  }, [localPreview]);

  useEffect(() => {
    referencePreviewsRef.current = referencePreviews;
  }, [referencePreviews]);

  useEffect(() => {
    middleKeyframesRef.current = middleKeyframes;
  }, [middleKeyframes]);

  useEffect(() => {
    finalFramePreviewRef.current = finalFramePreview;
  }, [finalFramePreview]);

  useEffect(() => {
    return () => {
      if (localPreviewRef.current) URL.revokeObjectURL(localPreviewRef.current);
      for (const preview of Object.values(referencePreviewsRef.current)) {
        if (preview) URL.revokeObjectURL(preview);
      }
      for (const item of middleKeyframesRef.current) {
        URL.revokeObjectURL(item.previewUrl);
      }
      if (finalFramePreviewRef.current) URL.revokeObjectURL(finalFramePreviewRef.current);
    };
  }, []);

  function updateNumber(name: NumberField, value: string) {
    const nextValue = Number(value);
    if (name === "duration") {
      if (nextValue > 15) setError(ui.durationTooLong);
      if (nextValue < 4) setError(ui.durationTooShort);
      setForm((current) => ({ ...current, duration: Math.min(15, Math.max(4, nextValue || 4)) }));
      return;
    }
    setForm((current) => ({ ...current, [name]: nextValue }));
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0] ?? null;
    setFile(nextFile);
    if (localPreview) URL.revokeObjectURL(localPreview);
    setLocalPreview(nextFile ? URL.createObjectURL(nextFile) : null);
  }

  function removeMainFile() {
    setFile(null);
    if (localPreview) URL.revokeObjectURL(localPreview);
    setLocalPreview(null);
  }

  function handleReferenceImageChange(key: ReferenceViewKey, event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0] ?? null;
    setReferenceImages((current) => ({ ...current, [key]: nextFile }));
    setReferencePreviews((current) => {
      if (current[key]) URL.revokeObjectURL(current[key]);
      return { ...current, [key]: nextFile ? URL.createObjectURL(nextFile) : null };
    });
  }

  function handleReferenceVideoChange(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0] ?? null;
    setReferenceVideoFile(nextFile);
    if (!nextFile) {
      setReferenceVideoProbe({ status: "idle", message: ui.noReferenceVideo });
      return;
    }

    setReferenceVideoProbe({ status: "probing", message: "\u6b63\u5728\u68c0\u6d4b\u53c2\u8003\u89c6\u9891\u5206\u8fa8\u7387..." });
    const objectUrl = URL.createObjectURL(nextFile);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.src = objectUrl;
    video.onloadedmetadata = () => {
      const width = video.videoWidth;
      const height = video.videoHeight;
      const pixelCount = width * height;
      URL.revokeObjectURL(objectUrl);
      if (pixelCount < MIN_SEEDANCE_PIXEL_COUNT) {
        setReferenceVideoProbe({
          status: "low",
          width,
          height,
          pixelCount,
          message: `参考视频分辨率：${width}x${height}，低于要求，提交后会自动放大到 720x720。`
        });
        return;
      }
      setReferenceVideoProbe({
        status: "valid",
        width,
        height,
        pixelCount,
        message: `参考视频分辨率：${width}x${height}，符合 Seedance 2.0 要求。`
      });
    };
    video.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      setReferenceVideoProbe({
        status: "failed",
        message: "\u53c2\u8003\u89c6\u9891\u5206\u8fa8\u7387\u68c0\u6d4b\u5931\u8d25\uff0c\u540e\u7aef\u4f1a\u5728\u4e0a\u4f20\u524d\u518d\u6b21\u6821\u9a8c\u3002"
      });
    };
  }

  function handleMiddleKeyframeChange(index: number, event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0] ?? null;
    if (!nextFile) return;
    const preview = URL.createObjectURL(nextFile);
    setMiddleKeyframes((current) => {
      const next = [...current];
      const existing = next[index];
      if (existing) URL.revokeObjectURL(existing.previewUrl);
      next[index] = {
        id: existing?.id ?? createStableId(),
        file: nextFile,
        previewUrl: preview,
        hasPreviewError: false
      };
      return next.slice(0, MAX_MIDDLE_KEYFRAMES);
    });
  }

  function removeMiddleKeyframe(index: number) {
    setMiddleKeyframes((current) => {
      const removed = current[index];
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return current.filter((_, itemIndex) => itemIndex !== index);
    });
    setKeyframeInputKey((current) => current + 1);
  }

  function markMiddlePreviewError(id: string) {
    setMiddleKeyframes((current) => current.map((item) => item.id === id ? { ...item, hasPreviewError: true } : item));
  }

  function handleFinalFrameChange(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0] ?? null;
    setFinalFrameFile(nextFile);
    if (finalFramePreview) URL.revokeObjectURL(finalFramePreview);
    setFinalFramePreview(nextFile ? URL.createObjectURL(nextFile) : null);
  }

  function removeFinalFrame() {
    if (finalFramePreview) URL.revokeObjectURL(finalFramePreview);
    setFinalFrameFile(null);
    setFinalFramePreview(null);
    setKeyframeInputKey((current) => current + 1);
  }

  function clearReferenceMedia() {
    for (const preview of Object.values(referencePreviews)) {
      if (preview) URL.revokeObjectURL(preview);
    }
    setReferenceImages({ front: null, side: null, back: null });
    setReferencePreviews({ front: null, side: null, back: null });
    setReferenceVideoFile(null);
    setReferenceVideoProbe({ status: "idle", message: ui.noReferenceVideo });
    setReferenceInputKey((current) => current + 1);
  }

  function handleInputControlModeChange(mode: InputControlMode) {
    if (mode === "keyframe_control" && hasReferenceMedia) {
      setError(referenceVideoFile ? ui.keyframeReferenceConflict : ui.keyframeReferenceImageConflict);
      return;
    }
    setError(null);
    setForm((current) => ({ ...current, inputControlMode: mode }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) {
      setError(ui.chooseImage);
      return;
    }
    if (form.duration < 4 || form.duration > 15) {
      setError(ui.durationRange);
      return;
    }
    const missingImageRefs = Array.from(new Set(extractImageRefs(form.userExtraPrompt)))
      .filter((imageNumber) => !validImageNumbers.has(imageNumber))
      .sort((a, b) => a - b);
    if (missingImageRefs.length > 0) {
      setError(`${ui.invalidImageRef}${missingImageRefs.map((imageNumber) => `@\u56fe${imageNumber}`).join("\u3001")}`);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const data = new FormData();
      data.append("image", file);
      if (form.inputControlMode === "keyframe_control" && hasReferenceMedia) {
        setError(referenceVideoFile ? ui.keyframeReferenceConflict : ui.keyframeReferenceImageConflict);
        return;
      }
      if (form.inputControlMode === "multi_reference" && referenceVideoFile) {
        if (referenceVideoProbe.status === "low") {
          setReferenceVideoProbe((current) => ({
            ...current,
            status: "selected",
            message: current.width && current.height
              ? `参考视频分辨率：${current.width}x${current.height}，低于要求，正在上传并自动放大到 720x720。`
              : "\u53c2\u8003\u89c6\u9891\u5206\u8fa8\u7387\u4f4e\u4e8e\u8981\u6c42\uff0c\u6b63\u5728\u4e0a\u4f20\u5e76\u81ea\u52a8\u653e\u5927\u3002"
          }));
        }
        data.append("referenceVideo", referenceVideoFile);
      }
      if (form.inputControlMode === "multi_reference") {
        for (const item of referenceViewFields) {
          const referenceFile = referenceImages[item.key];
          if (referenceFile) data.append(item.field, referenceFile);
        }
      } else {
        for (const item of middleKeyframes) {
          data.append("keyframeMiddleImages", item.file);
        }
        if (finalFrameFile) {
          data.append("finalFrameImage", finalFrameFile);
        }
      }
      for (const [key, value] of Object.entries(form)) {
        data.append(key, key === "taskName" ? String(value).trim() || defaultTaskName() : String(value));
      }
      const created = await createTask(data);
      setForm((current) => ({ ...current, taskName: "" }));
      await refresh(created.taskId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function runAction(action: () => Promise<void>) {
    setError(null);
    try {
      await action();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDeleteTask(taskId: string) {
    if (deletingTaskId) return;
    setDeletingTaskId(taskId);
    setError(null);
    setTasks((current) => current.filter((task) => task.id !== taskId));
    if (selectedIdRef.current === taskId) {
      selectTask(null);
    }
    try {
      await deleteTask(taskId);
      await refresh(undefined, false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      await refresh(undefined, true).catch((refreshErr) => {
        console.warn("Refresh after delete failure failed", refreshErr);
      });
    } finally {
      setDeletingTaskId(null);
    }
  }

  return (
    <main className="app">
      <header className="topbar">
        <div>
          <h1>{ui.title}</h1>
          <p>{ui.subtitle}</p>
        </div>
        <button className="iconButton" title={ui.refresh} onClick={() => void refresh(undefined, true)}>
          <RefreshCw size={18} />
        </button>
      </header>

      {runtimeConfig && (
        <div className={runtimeConfig.seedanceMock ? "modeBanner mock" : "modeBanner live"}>
          {runtimeConfig.seedanceMock ? ui.mockBanner : `${ui.liveBannerPrefix}${runtimeConfig.arkModelId}`}
          {!runtimeConfig.seedanceMock && !runtimeConfig.hasArkApiKey && ui.missingArkKey}
          {!runtimeConfig.seedanceMock && !runtimeConfig.ossEnabled && ui.ossDisabled}
          {runtimeConfig.ossEnabled && !runtimeConfig.ossHasAccessKey && ui.ossMissingKey}
          {runtimeConfig.ossEnabled && `${ui.ossTemp}${runtimeConfig.ossTempPrefix}`}
        </div>
      )}

      {error && (
        <div className="toast">
          <XCircle size={18} />
          <span>{error}</span>
          <button onClick={() => setError(null)}>{ui.close}</button>
        </div>
      )}

      <section className="workspace">
        <form className="panel createPanel" onSubmit={handleSubmit}>
          <div className="panelHeader">
            <h2>{ui.createTask}</h2>
            <button className="primaryButton" disabled={submitting} type="submit">
              <Upload size={17} />
              {submitting ? ui.submitting : ui.generateVideo}
            </button>
          </div>

          <div className="uploadGroup">
            <div className="subhead">{form.inputControlMode === "keyframe_control" ? ui.initialFrame : ui.mainReferenceImage}</div>
            {form.inputControlMode === "multi_reference" && <small className="hintText">{ui.mainReferenceHint}</small>}
            <label className="dropzone">
              {localPreview ? <img src={localPreview} alt="" /> : <Upload size={32} />}
              <input accept="image/*" type="file" onChange={handleFileChange} />
              {localPreview && (
                <button className="removeMediaButton" type="button" title={ui.removeImage} onClick={(event) => {
                  event.preventDefault();
                  removeMainFile();
                }}>
                  <XCircle size={18} />
                </button>
              )}
            </label>
            <small className="imageNumberBadge">
              {imageNumberLabel(1, form.inputControlMode === "keyframe_control" ? ui.initialFrame : ui.mainReferenceImage)}
            </small>
          </div>

          <div className="subhead">{ui.inputControlMode}</div>
          <div className="segmented">
            <button
              type="button"
              className={form.inputControlMode === "multi_reference" ? "selected" : ""}
              onClick={() => handleInputControlModeChange("multi_reference")}
            >
              {ui.multiReference}
            </button>
            <button
              type="button"
              className={form.inputControlMode === "keyframe_control" ? "selected" : ""}
              onClick={() => handleInputControlModeChange("keyframe_control")}
            >
              {ui.keyframeControl}
            </button>
          </div>
          {form.inputControlMode === "multi_reference" && <small className="hintText">{ui.multiReferenceHint}</small>}

          {form.inputControlMode === "multi_reference" && (
            <>
              <div className="subheadRow">
                <div className="subhead">{ui.threeViewTitle}</div>
                {hasReferenceMedia && (
                  <button className="linkButton" type="button" onClick={clearReferenceMedia}>
                    {ui.clearReferences}
                  </button>
                )}
              </div>
              <small className="hintText">{ui.threeViewHint}</small>
              <div className="referenceGrid">
                {referenceViewFields.map((item, index) => (
                  <label className="referenceDropzone" key={item.key}>
                    {referencePreviews[item.key] ? (
                      <img src={referencePreviews[item.key] ?? ""} alt="" />
                    ) : (
                      <span>
                        <Upload size={18} />
                        {item.label}
                      </span>
                    )}
                    <input key={`${referenceInputKey}-${item.key}`} accept="image/*" type="file" onChange={(event) => handleReferenceImageChange(item.key, event)} />
                    <small className="imageNumberBadge">{imageNumberLabel(index + 2, item.label)}</small>
                  </label>
                ))}
              </div>

              <label className="fileField">
                <span>{ui.referenceVideo}</span>
                <input key={`video-${referenceInputKey}`} accept="video/*" type="file" onChange={handleReferenceVideoChange} />
                <small>
                  <FileVideo size={14} />
                  {referenceVideoFile ? referenceVideoFile.name : ui.noReferenceVideo}
                </small>
                {referenceVideoFile && (
                  <small className={`referenceVideoState ${referenceVideoProbe.status}`}>
                    {referenceVideoProbe.message}
                  </small>
                )}
                <small className="hintText">{ui.referenceVideoHint}</small>
              </label>
            </>
          )}

          {form.inputControlMode === "keyframe_control" && (
            <div className="keyframeStack">
              <div>
                <div className="subhead">{ui.middleKeyframes}</div>
              </div>
              <div className="keyframeGrid">
                {middleKeyframes.map((item, index) => (
                  <label className="keyframeDropzone" key={item.id}>
                    {item.hasPreviewError ? (
                      <span>
                        <XCircle size={18} />
                        {ui.previewFailed}
                      </span>
                    ) : (
                      <img src={item.previewUrl} alt="" onError={() => markMiddlePreviewError(item.id)} />
                    )}
                    <input accept="image/*" type="file" onChange={(event) => handleMiddleKeyframeChange(index, event)} />
                    <button className="removeMediaButton" type="button" title={ui.removeImage} onClick={(event) => {
                      event.preventDefault();
                      removeMiddleKeyframe(index);
                    }}>
                      <XCircle size={16} />
                    </button>
                    <small className="imageNumberBadge">{imageNumberLabel(index + 2, `${ui.middleFrame}${index + 1}`)}</small>
                  </label>
                ))}
                {middleKeyframes.length < MAX_MIDDLE_KEYFRAMES && (
                  <label className="keyframeDropzone" key={`empty-middle-${keyframeInputKey}-${middleKeyframes.length}`}>
                    <span>
                      <Upload size={18} />
                      {ui.middleFrame} {middleKeyframes.length + 1}
                    </span>
                    <input accept="image/*" type="file" onChange={(event) => handleMiddleKeyframeChange(middleKeyframes.length, event)} />
                    <small className="imageNumberBadge">
                      {imageNumberLabel(emptyMiddleFrameImageNumber, `${ui.middleFrame}${middleKeyframes.length + 1}`)}
                    </small>
                  </label>
                )}
              </div>

              <div>
                <div className="subhead">{ui.finalFrame}</div>
              </div>
              <div className="keyframeGrid">
                <label className="keyframeDropzone">
                  {finalFramePreview ? (
                    <img src={finalFramePreview} alt="" />
                  ) : (
                    <span>
                      <Upload size={18} />
                      {ui.finalFrame}
                    </span>
                  )}
                  <input key={`final-${keyframeInputKey}`} accept="image/*" type="file" onChange={handleFinalFrameChange} />
                  {finalFramePreview && (
                    <button className="removeMediaButton" type="button" title={ui.removeImage} onClick={(event) => {
                      event.preventDefault();
                      removeFinalFrame();
                    }}>
                      <XCircle size={16} />
                    </button>
                  )}
                  <small className="imageNumberBadge">{imageNumberLabel(finalFrameDisplayImageNumber, ui.finalFrame)}</small>
                </label>
              </div>
            </div>
          )}

          <label>
            <span>{ui.taskName}</span>
            <input
              value={form.taskName}
              onChange={(event) => setForm((current) => ({ ...current, taskName: event.target.value }))}
              placeholder="prop_rotation"
            />
          </label>

          <label>
            <span>{ui.rotationMode}</span>
            <select
              value={form.rotationMode}
              onChange={(event) => setForm((current) => ({ ...current, rotationMode: event.target.value as RotationMode }))}
            >
              <option value="horizontal_360">{ui.horizontal360}</option>
              <option value="vertical_360">{ui.vertical360}</option>
              <option value="turntable">{ui.turntable}</option>
            </select>
          </label>

          <div className="fieldGrid">
            <label>
              <span>{ui.aspectRatio}</span>
              <select
                value={form.aspectRatio}
                onChange={(event) => setForm((current) => ({ ...current, aspectRatio: event.target.value as AspectRatio }))}
              >
                {ASPECT_RATIO_OPTIONS.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </label>
            <label>
              <span>{ui.resolutionPreset}</span>
              <select
                value={form.resolutionPreset}
                onChange={(event) => setForm((current) => ({ ...current, resolutionPreset: event.target.value as ResolutionPreset }))}
              >
                {RESOLUTION_PRESET_OPTIONS.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </label>
            <label>
              <span>{ui.duration}</span>
              <input type="number" min={4} max={15} step={1} value={form.duration} onChange={(event) => updateNumber("duration", event.target.value)} />
            </label>
            <label>
              <span>{ui.fps}</span>
              <input type="number" min="1" max="60" value={form.fps} onChange={(event) => updateNumber("fps", event.target.value)} />
            </label>
          </div>
          <div className="sizeSummary">
            <strong>{ui.estimatedVideo}：{form.aspectRatio} / {selectedResolutionLabel} / {form.width}x{form.height}</strong>
            {sizeWasRaised && <small>{ui.seedanceSizeRaised} {ui.finalSize}：{form.width}x{form.height}</small>}
          </div>

          <div className="subhead">{ui.extractParams}</div>

          <div className="segmented">
            <button
              type="button"
              className={form.frameExtractMode === "interval" ? "selected" : ""}
              onClick={() => setForm((current) => ({ ...current, frameExtractMode: "interval" }))}
            >
              {ui.intervalExtract}
            </button>
            <button
              type="button"
              className={form.frameExtractMode === "total_count" ? "selected" : ""}
              onClick={() => setForm((current) => ({ ...current, frameExtractMode: "total_count" }))}
            >
              {ui.totalExtract}
            </button>
          </div>

          {form.frameExtractMode === "interval" ? (
            <label>
              <span>{ui.everyNFrames}</span>
              <input type="number" min="1" max="120" value={form.frameInterval} onChange={(event) => updateNumber("frameInterval", event.target.value)} />
            </label>
          ) : (
            <label>
              <span>{ui.totalCount}</span>
              <input type="number" min="1" max="120" value={form.totalExtractCount} onChange={(event) => updateNumber("totalExtractCount", event.target.value)} />
            </label>
          )}

          <label>
            <span>{ui.prompt}</span>
            <textarea
              value={form.userExtraPrompt}
              rows={4}
              placeholder={ui.promptPlaceholder}
              onChange={(event) => setForm((current) => ({ ...current, userExtraPrompt: event.target.value }))}
            />
            <small className="hintText">{ui.promptHint}</small>
          </label>
        </form>

        <section className="panel taskPanel">
          <div className="panelHeader">
            <h2>{ui.tasks}</h2>
            <span className="count">{tasks.length}</span>
          </div>
          <div className="taskList">
            {tasks.map((task) => (
              <button
                key={task.id}
                className={task.id === selectedId ? "taskRow selected" : "taskRow"}
                onClick={() => selectTask(task.id)}
              >
                <img src={previewUrl(task.id, "source", undefined, task.updatedAt)} alt="" />
                <span>
                  <strong>{task.name}</strong>
                  <small>{formatTime(task.createdAt)}</small>
                </span>
                <em className={classForStatus(task.status)}>{statusLabels[task.status]}</em>
              </button>
            ))}
          </div>
        </section>

        <section className="panel detailPanel">
          {selectedTask ? (
            <>
              <div className="panelHeader">
                <div>
                  <h2>{selectedTask.name}</h2>
                  <span className={classForStatus(selectedTask.status)}>{statusLabels[selectedTask.status]}</span>
                </div>
                <div className="actions">
                  {canExtract && (
                    <button title={ui.startExtract} onClick={() => void runAction(() => extractTask(selectedTask.id))}>
                      <Images size={17} />
                    </button>
                  )}
                  <button title={ui.retry} onClick={() => void runAction(() => retryTask(selectedTask.id))}>
                    <RotateCw size={17} />
                  </button>
                  {!terminalStatuses.has(selectedTask.status) && (
                    <button title={ui.cancel} onClick={() => void runAction(() => cancelTask(selectedTask.id))}>
                      <XCircle size={17} />
                    </button>
                  )}
                  <button
                    disabled={deletingTaskId === selectedTask.id}
                    title={ui.delete}
                    onClick={() => void handleDeleteTask(selectedTask.id)}
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
              </div>

              <div className="progress">
                <span style={{ width: `${selectedTask.progress}%` }} />
              </div>

              <div className="detailGrid">
                <div>
                  <strong>{selectedTask.duration}s</strong>
                  <small>{ui.duration}</small>
                </div>
                <div>
                  <strong>{selectedTask.fps}</strong>
                  <small>fps</small>
                </div>
                <div>
                  <strong>
                    {selectedTask.width}x{selectedTask.height}
                  </strong>
                  <small>{ui.size}</small>
                </div>
                <div>
                  <strong>
                    {rawFrameCount}/{cutoutCount}
                  </strong>
                  <small>{ui.frame}</small>
                </div>
              </div>

              {selectedTask.errorMessage && <p className="errorText">{selectedTask.errorMessage}</p>}

              <div className="previewSplit">
                <img className="sourcePreview" src={previewUrl(selectedTask.id, "source", undefined, token)} alt="" />
                {selectedTask.videoPath && <video controls src={previewUrl(selectedTask.id, "video", undefined, token)} />}
              </div>

              {selectedTask.inputControlMode === "keyframe_control" && keyframeOutputs.length > 0 && (
                <>
                  <h3>{ui.keyframeControl}</h3>
                  <div className="keyframePreviewGrid">
                    {keyframeOutputs.map((output, index) => (
                      <figure key={output.id}>
                        <img src={previewUrl(selectedTask.id, "keyframe", index + 1, token)} alt="" />
                        <figcaption>{keyframeOutputLabel(selectedTask, index)}</figcaption>
                      </figure>
                    ))}
                  </div>
                </>
              )}

              {selectedTask.inputControlMode === "multi_reference" && referenceOutputs.length > 0 && (
                <>
                  <h3>{ui.threeViewTitle}</h3>
                  <div className="keyframePreviewGrid">
                    {referenceOutputs.map((output, index) => (
                      <figure key={output.id}>
                        <img src={previewUrl(selectedTask.id, "reference", index + 1, token)} alt="" />
                        <figcaption>{referenceOutputLabel(output.fileName)}</figcaption>
                      </figure>
                    ))}
                  </div>
                </>
              )}

              <div className="extraPromptInfo">
                <strong>{ui.prompt}</strong>
                <span>{selectedTask.userExtraPrompt?.trim() || ui.none}</span>
              </div>

              <div className="downloadBar">
                {canExtract && (
                  <button className="extractButton" onClick={() => void runAction(() => extractTask(selectedTask.id))}>
                    <Images size={16} /> {ui.startExtract}
                  </button>
                )}
                <a className={!canDownloadVideo ? "disabled" : ""} href={downloadUrl(selectedTask.id, "video")}>
                  <Download size={16} /> {ui.video}
                </a>
                <a className={!canDownloadAssets ? "disabled" : ""} href={downloadUrl(selectedTask.id, "raw-frames")}>
                  <Download size={16} /> {ui.rawFrames}
                </a>
                <a className={!canDownloadAssets ? "disabled" : ""} href={downloadUrl(selectedTask.id, "cutouts")}>
                  <Download size={16} /> {ui.cutouts}
                </a>
                <a className={!canDownloadAssets ? "disabled" : ""} href={downloadUrl(selectedTask.id, "zip")}>
                  <Download size={16} /> {ui.package}
                </a>
              </div>

              <h3>{ui.rawFrames}</h3>
              <div className="frameGrid">
                {firstFrames.raw.map((index) => (
                  <img key={index} src={previewUrl(selectedTask.id, "frame", index, token)} alt="" />
                ))}
              </div>

              <h3>{ui.cutouts}</h3>
              <div className="frameGrid checker">
                {firstFrames.cutouts.map((index) => (
                  <img key={index} src={previewUrl(selectedTask.id, "cutout", index, token)} alt="" />
                ))}
              </div>

              <h3>{ui.logs}</h3>
              <div className="logs">
                {selectedTask.logs.slice(-8).reverse().map((log) => (
                  <p key={log.id}>
                    <time>{formatTime(log.createdAt)}</time>
                    <span>{log.message}</span>
                  </p>
                ))}
              </div>
            </>
          ) : (
            <div className="empty">{ui.empty}</div>
          )}
        </section>
      </section>
    </main>
  );
}
