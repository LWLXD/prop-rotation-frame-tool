import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  CheckCircle2,
  Clock3,
  Download,
  FileVideo,
  Images,
  Package,
  RefreshCw,
  RotateCw,
  Server,
  Trash2,
  Upload,
  Wifi,
  XCircle
} from "lucide-react";
import { defaultPrompt, type FrameExtractMode, type RotationMode, type Task, type TaskStatus } from "@prop-tool/shared";
import {
  apiBaseUrl,
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
  prompt: string;
  rotationMode: RotationMode;
  duration: number;
  fps: number;
  width: number;
  height: number;
  frameExtractMode: FrameExtractMode;
  frameInterval: number;
  totalExtractCount: number;
};

type NumberField = "duration" | "fps" | "width" | "height" | "frameInterval" | "totalExtractCount";

const text = {
  chooseImageError: "\u8bf7\u9009\u62e9\u53c2\u8003\u56fe\u7247",
  title: "\u6b27\u5361\u9053\u5177\u65cb\u8f6c\u9010\u5e27\u5de5\u5177",
  subtitle: "\u5185\u7f51\u65e0\u8d26\u53f7\u7248",
  currentAddress: "\u5f53\u524d\u8bbf\u95ee\u5730\u5740",
  refreshTasks: "\u5237\u65b0\u4efb\u52a1",
  allTasks: "\u5168\u90e8\u4efb\u52a1",
  activeTasks: "\u961f\u5217\u4e2d",
  completedTasks: "\u5df2\u5b8c\u6210",
  localMock: "\u672c\u5730\u6a21\u62df",
  mockBanner: "\u5f53\u524d\u4e3a\u672c\u5730\u6a21\u62df\u6a21\u5f0f\uff0c\u751f\u6210\u89c6\u9891\u4ec5\u7528\u4e8e\u6d41\u7a0b\u9a8c\u8bc1\u3002",
  liveBannerPrefix: "\u5f53\u524d\u4e3a Seedance API \u6a21\u5f0f\uff1a",
  missingArkKey: " \u7f3a\u5c11 ARK_API_KEY\u3002",
  ossDisabled: " OSS \u672a\u542f\u7528\uff0c\u53c2\u8003\u56fe\u65e0\u6cd5\u63d0\u4f9b\u516c\u7f51 URL\u3002",
  ossTempPrefix: " OSS \u4e34\u65f6\u76ee\u5f55\uff1a",
  close: "\u5173\u95ed",
  createTask: "\u521b\u5efa\u4efb\u52a1",
  createHint: "\u4e0a\u4f20\u53c2\u8003\u56fe\u540e\u5148\u751f\u6210\u89c6\u9891\uff0c\u786e\u8ba4\u540e\u518d\u62bd\u5e27\u62a0\u56fe\u3002",
  submitting: "\u63d0\u4ea4\u4e2d",
  generateVideo: "\u751f\u6210\u89c6\u9891",
  chooseImage: "\u9009\u62e9\u53c2\u8003\u56fe\u7247",
  referenceVideo: "\u53c2\u8003\u89c6\u9891\uff08\u53ef\u9009\uff09",
  noReferenceVideo: "\u672a\u9009\u62e9\u53c2\u8003\u89c6\u9891",
  taskName: "\u4efb\u52a1\u540d\u79f0",
  autoName: "\u7559\u7a7a\u81ea\u52a8\u751f\u6210",
  rotationMode: "\u65cb\u8f6c\u65b9\u5f0f",
  horizontal360: "\u6c34\u5e73 360",
  vertical360: "\u5782\u76f4 360",
  turntable: "\u8f6c\u53f0\u5c55\u793a",
  duration: "\u65f6\u957f",
  fps: "\u5e27\u7387",
  width: "\u5bbd\u5ea6",
  height: "\u9ad8\u5ea6",
  extraction: "\u62bd\u5e27\u53c2\u6570",
  intervalExtract: "\u95f4\u9694\u62bd\u5e27",
  totalExtract: "\u56fa\u5b9a\u5f20\u6570",
  everyNFrames: "\u6bcf N \u5e27",
  totalFrames: "\u603b\u5f20\u6570",
  prompt: "\u63d0\u793a\u8bcd",
  taskQueue: "\u4efb\u52a1\u961f\u5217",
  taskCountSuffix: "\u4e2a\u4efb\u52a1",
  startExtract: "\u5f00\u59cb\u62bd\u5e27",
  retry: "\u91cd\u8bd5",
  cancel: "\u53d6\u6d88",
  delete: "\u5220\u9664",
  size: "\u5c3a\u5bf8",
  frame: "\u5e27",
  sourceImage: "\u53c2\u8003\u56fe",
  generatedVideo: "\u751f\u6210\u89c6\u9891",
  waitingGenerate: "\u7b49\u5f85\u751f\u6210",
  video: "\u89c6\u9891",
  rawFrames: "\u539f\u59cb\u5e27",
  cutoutFrames: "\u900f\u660e\u5e27",
  fullPackage: "\u5b8c\u6574\u5305",
  logs: "\u65e5\u5fd7",
  empty: "\u6682\u65e0\u4efb\u52a1"
};

const statusLabels: Record<TaskStatus, string> = {
  PENDING: "\u7b49\u5f85",
  QUEUED: "\u6392\u961f\u4e2d",
  GENERATING_VIDEO: "\u751f\u6210\u89c6\u9891",
  VIDEO_GENERATED: "\u89c6\u9891\u751f\u6210",
  DOWNLOADING_VIDEO: "\u4e0b\u8f7d\u89c6\u9891",
  VIDEO_DOWNLOADED: "\u5f85\u62bd\u5e27",
  EXTRACTING_FRAMES: "\u62bd\u5e27\u4e2d",
  FRAMES_EXTRACTED: "\u62bd\u5e27\u5b8c\u6210",
  REMOVING_BG: "\u62a0\u56fe\u4e2d",
  BG_REMOVED: "\u62a0\u56fe\u5b8c\u6210",
  PACKAGING: "\u6253\u5305\u4e2d",
  SUCCESS: "\u5df2\u5b8c\u6210",
  FAILED: "\u5931\u8d25",
  CANCELLED: "\u5df2\u53d6\u6d88"
};

const terminalStatuses = new Set<TaskStatus>(["SUCCESS", "FAILED", "CANCELLED"]);

function classForStatus(status: TaskStatus) {
  if (status === "SUCCESS") return "status success";
  if (status === "FAILED") return "status failed";
  if (status === "CANCELLED") return "status muted";
  if (status === "VIDEO_DOWNLOADED") return "status ready";
  return "status active";
}

function formatTime(value?: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function countOutputs(task: Task | null, type: string) {
  return task?.outputs.filter((output) => output.outputType === type).length ?? 0;
}

function currentLanUrl() {
  return `${window.location.protocol}//${window.location.host}/`;
}

function defaultTaskName() {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, "")
    .slice(0, 14);
  return `prop_rotation_${stamp}`;
}

export function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [referenceVideoFile, setReferenceVideoFile] = useState<File | null>(null);
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfig | null>(null);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const [form, setForm] = useState<FormState>({
    taskName: "",
    prompt: defaultPrompt,
    rotationMode: "horizontal_360",
    duration: 4,
    fps: 24,
    width: 1024,
    height: 1024,
    frameExtractMode: "interval",
    frameInterval: 4,
    totalExtractCount: 12
  });

  const token = selectedTask?.updatedAt ?? "";
  const rawFrameCount = countOutputs(selectedTask, "raw_frame");
  const cutoutCount = countOutputs(selectedTask, "cutout");
  const canDownloadVideo = Boolean(selectedTask?.videoPath);
  const canDownloadAssets = selectedTask?.status === "SUCCESS";
  const canExtract = selectedTask?.status === "VIDEO_DOWNLOADED" && Boolean(selectedTask.videoPath);
  const activeCount = tasks.filter((task) => !terminalStatuses.has(task.status)).length;
  const successCount = tasks.filter((task) => task.status === "SUCCESS").length;

  const firstFrames = useMemo(() => {
    const raw = Array.from({ length: Math.min(8, rawFrameCount) }, (_, index) => index + 1);
    const cutouts = Array.from({ length: Math.min(8, cutoutCount) }, (_, index) => index + 1);
    return { raw, cutouts };
  }, [rawFrameCount, cutoutCount]);

  function selectTask(id: string | null) {
    selectedIdRef.current = id;
    setSelectedId(id);
  }

  async function refresh(nextSelectedId?: string | null) {
    const result = await listTasks();
    setTasks(result.items);
    const preferredId = nextSelectedId ?? selectedIdRef.current;
    const id = preferredId && result.items.some((task) => task.id === preferredId) ? preferredId : result.items[0]?.id ?? null;
    selectTask(id);
    setSelectedTask(id ? await getTask(id) : null);
  }

  useEffect(() => {
    void refresh().catch((err) => setError(err instanceof Error ? err.message : String(err)));
    void getRuntimeConfig()
      .then(setRuntimeConfig)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));

    const interval = window.setInterval(() => {
      void refresh().catch((err) => setError(err instanceof Error ? err.message : String(err)));
    }, 2500);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    void getTask(selectedId)
      .then(setSelectedTask)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [selectedId]);

  useEffect(() => {
    return () => {
      if (localPreview) URL.revokeObjectURL(localPreview);
    };
  }, [localPreview]);

  function updateNumber(name: NumberField, value: string) {
    setForm((current) => ({ ...current, [name]: Number(value) }));
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0] ?? null;
    setFile(nextFile);
    if (localPreview) URL.revokeObjectURL(localPreview);
    setLocalPreview(nextFile ? URL.createObjectURL(nextFile) : null);
  }

  function handleReferenceVideoChange(event: ChangeEvent<HTMLInputElement>) {
    setReferenceVideoFile(event.target.files?.[0] ?? null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) {
      setError(text.chooseImageError);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const data = new FormData();
      data.append("image", file);
      if (referenceVideoFile) data.append("referenceVideo", referenceVideoFile);
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

  return (
    <main className="app">
      <header className="topbar">
        <div>
          <h1>{text.title}</h1>
          <p>{text.subtitle}</p>
        </div>
        <div className="topbarRight">
          <span className="topInfo" title={text.currentAddress}>
            <Wifi size={15} />
            {currentLanUrl()}
          </span>
          <button className="iconButton" title={text.refreshTasks} onClick={() => void refresh()}>
            <RefreshCw size={18} />
          </button>
        </div>
      </header>

      <section className="overview">
        <div className="metric">
          <strong>{tasks.length}</strong>
          <span>{text.allTasks}</span>
        </div>
        <div className="metric">
          <strong>{activeCount}</strong>
          <span>{text.activeTasks}</span>
        </div>
        <div className="metric">
          <strong>{successCount}</strong>
          <span>{text.completedTasks}</span>
        </div>
        <div className="serviceStrip">
          <span className={runtimeConfig?.seedanceMock ? "servicePill warn" : "servicePill ok"}>
            <Server size={14} />
            {runtimeConfig?.seedanceMock ? text.localMock : "Seedance API"}
          </span>
          <span className={runtimeConfig?.ossEnabled ? "servicePill ok" : "servicePill warn"}>OSS</span>
          <span className="servicePill neutral">{apiBaseUrl}</span>
        </div>
      </section>

      {runtimeConfig && (
        <div className={runtimeConfig.seedanceMock ? "modeBanner mock" : "modeBanner live"}>
          {runtimeConfig.seedanceMock ? text.mockBanner : `${text.liveBannerPrefix}${runtimeConfig.arkModelId}`}
          {!runtimeConfig.seedanceMock && !runtimeConfig.hasArkApiKey && text.missingArkKey}
          {!runtimeConfig.seedanceMock && !runtimeConfig.ossEnabled && text.ossDisabled}
          {runtimeConfig.ossEnabled && `${text.ossTempPrefix}${runtimeConfig.ossTempPrefix}`}
        </div>
      )}

      {error && (
        <div className="toast">
          <XCircle size={18} />
          <span>{error}</span>
          <button onClick={() => setError(null)}>{text.close}</button>
        </div>
      )}

      <section className="workspace">
        <form className="panel createPanel" onSubmit={handleSubmit}>
          <div className="panelHeader">
            <div>
              <h2>{text.createTask}</h2>
              <p>{text.createHint}</p>
            </div>
            <button className="primaryButton" disabled={submitting} type="submit">
              <Upload size={17} />
              {submitting ? text.submitting : text.generateVideo}
            </button>
          </div>

          <label className="dropzone">
            {localPreview ? (
              <img src={localPreview} alt="" />
            ) : (
              <span>
                <Upload size={30} />
                <strong>{text.chooseImage}</strong>
              </span>
            )}
            <input accept="image/*" type="file" onChange={handleFileChange} />
          </label>

          <label className="fileField">
            <span>{text.referenceVideo}</span>
            <input accept="video/*" type="file" onChange={handleReferenceVideoChange} />
            <small>
              <FileVideo size={14} />
              {referenceVideoFile ? referenceVideoFile.name : text.noReferenceVideo}
            </small>
          </label>

          <label>
            <span>{text.taskName}</span>
            <input
              value={form.taskName}
              onChange={(event) => setForm((current) => ({ ...current, taskName: event.target.value }))}
              placeholder={text.autoName}
            />
          </label>

          <label>
            <span>{text.rotationMode}</span>
            <select
              value={form.rotationMode}
              onChange={(event) => setForm((current) => ({ ...current, rotationMode: event.target.value as RotationMode }))}
            >
              <option value="horizontal_360">{text.horizontal360}</option>
              <option value="vertical_360">{text.vertical360}</option>
              <option value="turntable">{text.turntable}</option>
            </select>
          </label>

          <div className="fieldGrid">
            <label>
              <span>{text.duration}</span>
              <input type="number" min="1" max="15" value={form.duration} onChange={(event) => updateNumber("duration", event.target.value)} />
            </label>
            <label>
              <span>{text.fps}</span>
              <input type="number" min="1" max="60" value={form.fps} onChange={(event) => updateNumber("fps", event.target.value)} />
            </label>
            <label>
              <span>{text.width}</span>
              <input type="number" min="128" max="2048" value={form.width} onChange={(event) => updateNumber("width", event.target.value)} />
            </label>
            <label>
              <span>{text.height}</span>
              <input type="number" min="128" max="2048" value={form.height} onChange={(event) => updateNumber("height", event.target.value)} />
            </label>
          </div>

          <div className="subhead">{text.extraction}</div>
          <div className="segmented">
            <button
              type="button"
              className={form.frameExtractMode === "interval" ? "selected" : ""}
              onClick={() => setForm((current) => ({ ...current, frameExtractMode: "interval" }))}
            >
              {text.intervalExtract}
            </button>
            <button
              type="button"
              className={form.frameExtractMode === "total_count" ? "selected" : ""}
              onClick={() => setForm((current) => ({ ...current, frameExtractMode: "total_count" }))}
            >
              {text.totalExtract}
            </button>
          </div>

          {form.frameExtractMode === "interval" ? (
            <label>
              <span>{text.everyNFrames}</span>
              <input type="number" min="1" max="120" value={form.frameInterval} onChange={(event) => updateNumber("frameInterval", event.target.value)} />
            </label>
          ) : (
            <label>
              <span>{text.totalFrames}</span>
              <input type="number" min="1" max="120" value={form.totalExtractCount} onChange={(event) => updateNumber("totalExtractCount", event.target.value)} />
            </label>
          )}

          <label>
            <span>{text.prompt}</span>
            <textarea
              value={form.prompt}
              rows={7}
              onChange={(event) => setForm((current) => ({ ...current, prompt: event.target.value }))}
            />
          </label>
        </form>

        <section className="panel taskPanel">
          <div className="panelHeader">
            <div>
              <h2>{text.taskQueue}</h2>
              <p>
                {tasks.length} {text.taskCountSuffix}
              </p>
            </div>
            <span className="count">{activeCount}</span>
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
              <div className="panelHeader detailHeader">
                <div>
                  <h2>{selectedTask.name}</h2>
                  <span className={classForStatus(selectedTask.status)}>{statusLabels[selectedTask.status]}</span>
                </div>
                <div className="actions">
                  {canExtract && (
                    <button title={text.startExtract} onClick={() => void runAction(() => extractTask(selectedTask.id))}>
                      <Images size={17} />
                    </button>
                  )}
                  <button title={text.retry} onClick={() => void runAction(() => retryTask(selectedTask.id))}>
                    <RotateCw size={17} />
                  </button>
                  {!terminalStatuses.has(selectedTask.status) && (
                    <button title={text.cancel} onClick={() => void runAction(() => cancelTask(selectedTask.id))}>
                      <XCircle size={17} />
                    </button>
                  )}
                  <button title={text.delete} onClick={() => void runAction(() => deleteTask(selectedTask.id))}>
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
                  <small>{text.duration}</small>
                </div>
                <div>
                  <strong>{selectedTask.fps}</strong>
                  <small>fps</small>
                </div>
                <div>
                  <strong>
                    {selectedTask.width}x{selectedTask.height}
                  </strong>
                  <small>{text.size}</small>
                </div>
                <div>
                  <strong>
                    {rawFrameCount}/{cutoutCount}
                  </strong>
                  <small>{text.frame}</small>
                </div>
              </div>

              {selectedTask.errorMessage && <p className="errorText">{selectedTask.errorMessage}</p>}

              <div className="previewSplit">
                <div className="previewBox">
                  <span>{text.sourceImage}</span>
                  <img className="sourcePreview" src={previewUrl(selectedTask.id, "source", undefined, token)} alt="" />
                </div>
                <div className="previewBox">
                  <span>{text.generatedVideo}</span>
                  {selectedTask.videoPath ? (
                    <video controls src={previewUrl(selectedTask.id, "video", undefined, token)} />
                  ) : (
                    <div className="videoPlaceholder">
                      <Clock3 size={26} />
                      <span>{text.waitingGenerate}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="downloadBar">
                {canExtract && (
                  <button className="extractButton" onClick={() => void runAction(() => extractTask(selectedTask.id))}>
                    <Images size={16} /> {text.startExtract}
                  </button>
                )}
                <a className={!canDownloadVideo ? "disabled" : ""} href={downloadUrl(selectedTask.id, "video")}>
                  <Download size={16} /> {text.video}
                </a>
                <a className={!canDownloadAssets ? "disabled" : ""} href={downloadUrl(selectedTask.id, "raw-frames")}>
                  <Download size={16} /> {text.rawFrames}
                </a>
                <a className={!canDownloadAssets ? "disabled" : ""} href={downloadUrl(selectedTask.id, "cutouts")}>
                  <Download size={16} /> {text.cutoutFrames}
                </a>
                <a className={!canDownloadAssets ? "disabled" : ""} href={downloadUrl(selectedTask.id, "zip")}>
                  <Package size={16} /> {text.fullPackage}
                </a>
              </div>

              <h3>{text.rawFrames}</h3>
              <div className="frameGrid">
                {firstFrames.raw.map((index) => (
                  <img key={index} src={previewUrl(selectedTask.id, "frame", index, token)} alt="" />
                ))}
              </div>

              <h3>{text.cutoutFrames}</h3>
              <div className="frameGrid checker">
                {firstFrames.cutouts.map((index) => (
                  <img key={index} src={previewUrl(selectedTask.id, "cutout", index, token)} alt="" />
                ))}
              </div>

              <h3>{text.logs}</h3>
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
            <div className="empty">
              <CheckCircle2 size={28} />
              <span>{text.empty}</span>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
