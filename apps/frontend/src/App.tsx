import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { Download, FileVideo, Images, RefreshCw, RotateCw, Trash2, Upload, XCircle } from "lucide-react";
import { defaultPrompt, type FrameExtractMode, type RotationMode, type Task, type TaskStatus } from "@prop-tool/shared";
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
type ReferenceViewKey = "front" | "side" | "back";

const ui = {
  title: "\u6b27\u5361\u9053\u5177\u65cb\u8f6c\u9010\u5e27\u5de5\u5177",
  subtitle: "\u5185\u7f51\u65e0\u8d26\u53f7\u7248",
  refresh: "\u5237\u65b0",
  createTask: "\u521b\u5efa\u4efb\u52a1",
  submitting: "\u63d0\u4ea4\u4e2d",
  generateVideo: "\u751f\u6210\u89c6\u9891",
  chooseImage: "\u8bf7\u9009\u62e9\u56fe\u7247",
  referenceVideo: "\u53c2\u8003\u89c6\u9891\uff08\u53ef\u9009\uff0c\u4ec5\u4e0a\u4f20 OSS \u4e34\u65f6 URL\uff09",
  noReferenceVideo: "\u672a\u9009\u62e9\u53c2\u8003\u89c6\u9891",
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
  duration: "\u65f6\u957f",
  fps: "\u5e27\u7387",
  width: "\u5bbd\u5ea6",
  height: "\u9ad8\u5ea6",
  extractParams: "\u62bd\u5e27\u53c2\u6570\uff08\u89c6\u9891\u751f\u6210\u540e\u4f7f\u7528\uff09",
  intervalExtract: "\u95f4\u9694\u62bd\u5e27",
  totalExtract: "\u56fa\u5b9a\u5f20\u6570",
  everyNFrames: "\u6bcf N \u5e27",
  totalCount: "\u603b\u5f20\u6570",
  prompt: "\u63d0\u793a\u8bcd",
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

export function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [referenceVideoFile, setReferenceVideoFile] = useState<File | null>(null);
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
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfig | null>(null);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  const firstFrames = useMemo(() => {
    const raw = Array.from({ length: Math.min(8, rawFrameCount) }, (_, index) => index + 1);
    const cutouts = Array.from({ length: Math.min(8, cutoutCount) }, (_, index) => index + 1);
    return { raw, cutouts };
  }, [rawFrameCount, cutoutCount]);

  async function refresh(nextSelectedId = selectedId) {
    const result = await listTasks();
    setTasks(result.items);
    const id = nextSelectedId ?? result.items[0]?.id ?? null;
    setSelectedId(id);
    setSelectedTask(id ? await getTask(id) : null);
  }

  useEffect(() => {
    void refresh().catch((err) => setError(err instanceof Error ? err.message : String(err)));
    void getRuntimeConfig().then(setRuntimeConfig).catch((err) => setError(err instanceof Error ? err.message : String(err)));
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
      for (const preview of Object.values(referencePreviews)) {
        if (preview) URL.revokeObjectURL(preview);
      }
    };
  }, [localPreview, referencePreviews]);

  function updateNumber(name: NumberField, value: string) {
    setForm((current) => ({ ...current, [name]: Number(value) }));
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0] ?? null;
    setFile(nextFile);
    if (localPreview) URL.revokeObjectURL(localPreview);
    setLocalPreview(nextFile ? URL.createObjectURL(nextFile) : null);
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
    setReferenceVideoFile(event.target.files?.[0] ?? null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) {
      setError(ui.chooseImage);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const data = new FormData();
      data.append("image", file);
      if (referenceVideoFile) {
        data.append("referenceVideo", referenceVideoFile);
      }
      for (const item of referenceViewFields) {
        const referenceFile = referenceImages[item.key];
        if (referenceFile) data.append(item.field, referenceFile);
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

  return (
    <main className="app">
      <header className="topbar">
        <div>
          <h1>{ui.title}</h1>
          <p>{ui.subtitle}</p>
        </div>
        <button className="iconButton" title={ui.refresh} onClick={() => void refresh()}>
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

          <label className="dropzone">
            {localPreview ? <img src={localPreview} alt="" /> : <Upload size={32} />}
            <input accept="image/*" type="file" onChange={handleFileChange} />
          </label>

          <div className="subhead">{ui.threeViewTitle}</div>
          <small className="hintText">{ui.threeViewHint}</small>
          <div className="referenceGrid">
            {referenceViewFields.map((item) => (
              <label className="referenceDropzone" key={item.key}>
                {referencePreviews[item.key] ? (
                  <img src={referencePreviews[item.key] ?? ""} alt="" />
                ) : (
                  <span>
                    <Upload size={18} />
                    {item.label}
                  </span>
                )}
                <input accept="image/*" type="file" onChange={(event) => handleReferenceImageChange(item.key, event)} />
                <small>{referenceImages[item.key]?.name ?? ui.clickUpload}</small>
              </label>
            ))}
          </div>

          <label className="fileField">
            <span>{ui.referenceVideo}</span>
            <input accept="video/*" type="file" onChange={handleReferenceVideoChange} />
            <small>
              <FileVideo size={14} />
              {referenceVideoFile ? referenceVideoFile.name : ui.noReferenceVideo}
            </small>
          </label>

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
              <span>{ui.duration}</span>
              <input type="number" min="1" max="15" value={form.duration} onChange={(event) => updateNumber("duration", event.target.value)} />
            </label>
            <label>
              <span>{ui.fps}</span>
              <input type="number" min="1" max="60" value={form.fps} onChange={(event) => updateNumber("fps", event.target.value)} />
            </label>
            <label>
              <span>{ui.width}</span>
              <input type="number" min="128" max="2048" value={form.width} onChange={(event) => updateNumber("width", event.target.value)} />
            </label>
            <label>
              <span>{ui.height}</span>
              <input type="number" min="128" max="2048" value={form.height} onChange={(event) => updateNumber("height", event.target.value)} />
            </label>
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
              value={form.prompt}
              rows={7}
              onChange={(event) => setForm((current) => ({ ...current, prompt: event.target.value }))}
            />
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
                onClick={() => setSelectedId(task.id)}
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
                  <button title={ui.delete} onClick={() => void runAction(() => deleteTask(selectedTask.id))}>
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
