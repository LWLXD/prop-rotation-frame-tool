import { useEffect, useMemo, useState } from "react";
import { Download, Images, RefreshCw, RotateCw, Trash2, Upload, XCircle } from "lucide-react";
import { defaultPrompt, type Task, type TaskStatus } from "@prop-tool/shared";
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

const statusLabels: Record<TaskStatus, string> = {
  PENDING: "等待",
  QUEUED: "排队",
  GENERATING_VIDEO: "生成视频",
  VIDEO_GENERATED: "视频生成",
  DOWNLOADING_VIDEO: "下载视频",
  VIDEO_DOWNLOADED: "视频已存",
  EXTRACTING_FRAMES: "抽帧",
  FRAMES_EXTRACTED: "抽帧完成",
  REMOVING_BG: "抠图",
  BG_REMOVED: "抠图完成",
  PACKAGING: "打包",
  SUCCESS: "成功",
  FAILED: "失败",
  CANCELLED: "取消"
};

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

export function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [referenceVideo, setReferenceVideo] = useState<File | null>(null);
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfig | null>(null);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
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
    if (id) {
      setSelectedTask(await getTask(id));
    } else {
      setSelectedTask(null);
    }
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

  function updateNumber(name: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [name]: Number(value) }));
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0] ?? null;
    setFile(nextFile);
    if (localPreview) {
      URL.revokeObjectURL(localPreview);
    }
    setLocalPreview(nextFile ? URL.createObjectURL(nextFile) : null);
  }

  function handleReferenceVideoChange(event: React.ChangeEvent<HTMLInputElement>) {
    setReferenceVideo(event.target.files?.[0] ?? null);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) {
      setError("请选择图片");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const data = new FormData();
      data.append("image", file);
      if (referenceVideo) {
        data.append("referenceVideo", referenceVideo);
      }
      for (const [key, value] of Object.entries(form)) {
        data.append(key, String(value));
      }
      const created = await createTask(data);
      setForm((current) => ({ ...current, taskName: "" }));
      setReferenceVideo(null);
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
          <h1>欧卡道具旋转逐帧工具</h1>
          <p>内网无账号版</p>
        </div>
        <button className="iconButton" title="刷新" onClick={() => void refresh()}>
          <RefreshCw size={18} />
        </button>
      </header>

      {runtimeConfig && (
        <div className={runtimeConfig.seedanceMock ? "modeBanner mock" : "modeBanner live"}>
          {runtimeConfig.seedanceMock
            ? "当前为本地模拟模式：不会调用 Seedance，生成的视频是静态占位视频。"
            : `当前为 Seedance API 模式：${runtimeConfig.arkModelId}`}
          {!runtimeConfig.seedanceMock && !runtimeConfig.hasPublicBaseUrl && " 缺少 PUBLIC_BASE_URL，火山方舟无法拉取上传图片。"}
          {!runtimeConfig.seedanceMock && !runtimeConfig.hasArkApiKey && " 缺少 ARK_API_KEY。"}
        </div>
      )}

      {error && (
        <div className="toast">
          <XCircle size={18} />
          <span>{error}</span>
          <button onClick={() => setError(null)}>关闭</button>
        </div>
      )}

      <section className="workspace">
        <form className="panel createPanel" onSubmit={handleSubmit}>
          <div className="panelHeader">
            <h2>创建任务</h2>
            <button className="primaryButton" disabled={submitting} type="submit">
              <Upload size={17} />
              {submitting ? "提交中" : "生成视频"}
            </button>
          </div>

          <label className="dropzone">
            {localPreview ? <img src={localPreview} alt="" /> : <Upload size={32} />}
            <input accept="image/*" type="file" onChange={handleFileChange} />
          </label>

          <label className="fileField">
            <span>参考视频（可选）</span>
            <input accept="video/*" type="file" onChange={handleReferenceVideoChange} />
            {referenceVideo && <small>{referenceVideo.name}</small>}
          </label>

          <label>
            <span>任务名称</span>
            <input
              value={form.taskName}
              onChange={(event) => setForm((current) => ({ ...current, taskName: event.target.value }))}
              placeholder="prop_rotation"
            />
          </label>

          <label>
            <span>旋转方式</span>
            <select
              value={form.rotationMode}
              onChange={(event) => setForm((current) => ({ ...current, rotationMode: event.target.value }))}
            >
              <option value="horizontal_360">水平 360</option>
              <option value="vertical_360">垂直 360</option>
              <option value="turntable">转台展示</option>
            </select>
          </label>

          <div className="fieldGrid">
            <label>
              <span>时长</span>
              <input type="number" min="1" max="15" value={form.duration} onChange={(event) => updateNumber("duration", event.target.value)} />
            </label>
            <label>
              <span>帧率</span>
              <input type="number" min="1" max="60" value={form.fps} onChange={(event) => updateNumber("fps", event.target.value)} />
            </label>
            <label>
              <span>宽度</span>
              <input type="number" min="128" max="2048" value={form.width} onChange={(event) => updateNumber("width", event.target.value)} />
            </label>
            <label>
              <span>高度</span>
              <input type="number" min="128" max="2048" value={form.height} onChange={(event) => updateNumber("height", event.target.value)} />
            </label>
          </div>

          <div className="subhead">抽帧参数（视频生成后使用）</div>

          <div className="segmented">
            <button
              type="button"
              className={form.frameExtractMode === "interval" ? "selected" : ""}
              onClick={() => setForm((current) => ({ ...current, frameExtractMode: "interval" }))}
            >
              间隔抽帧
            </button>
            <button
              type="button"
              className={form.frameExtractMode === "total_count" ? "selected" : ""}
              onClick={() => setForm((current) => ({ ...current, frameExtractMode: "total_count" }))}
            >
              固定张数
            </button>
          </div>

          {form.frameExtractMode === "interval" ? (
            <label>
              <span>每 N 帧</span>
              <input type="number" min="1" max="120" value={form.frameInterval} onChange={(event) => updateNumber("frameInterval", event.target.value)} />
            </label>
          ) : (
            <label>
              <span>总张数</span>
              <input type="number" min="1" max="120" value={form.totalExtractCount} onChange={(event) => updateNumber("totalExtractCount", event.target.value)} />
            </label>
          )}

          <label>
            <span>提示词</span>
            <textarea
              value={form.prompt}
              rows={7}
              onChange={(event) => setForm((current) => ({ ...current, prompt: event.target.value }))}
            />
          </label>
        </form>

        <section className="panel taskPanel">
          <div className="panelHeader">
            <h2>任务</h2>
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
                    <button title="开始抽帧" onClick={() => void runAction(() => extractTask(selectedTask.id))}>
                      <Images size={17} />
                    </button>
                  )}
                  <button title="重试" onClick={() => void runAction(() => retryTask(selectedTask.id))}>
                    <RotateCw size={17} />
                  </button>
                  {!terminalStatuses.has(selectedTask.status) && (
                    <button title="取消" onClick={() => void runAction(() => cancelTask(selectedTask.id))}>
                      <XCircle size={17} />
                    </button>
                  )}
                  <button title="删除" onClick={() => void runAction(() => deleteTask(selectedTask.id))}>
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
                  <small>时长</small>
                </div>
                <div>
                  <strong>{selectedTask.fps}</strong>
                  <small>fps</small>
                </div>
                <div>
                  <strong>{selectedTask.width}x{selectedTask.height}</strong>
                  <small>尺寸</small>
                </div>
                <div>
                  <strong>{rawFrameCount}/{cutoutCount}</strong>
                  <small>帧</small>
                </div>
              </div>

              {selectedTask.errorMessage && <p className="errorText">{selectedTask.errorMessage}</p>}

              <div className="previewSplit">
                <img className="sourcePreview" src={previewUrl(selectedTask.id, "source", undefined, token)} alt="" />
                {selectedTask.videoPath && (
                  <video controls src={previewUrl(selectedTask.id, "video", undefined, token)} />
                )}
              </div>

              <div className="downloadBar">
                {canExtract && (
                  <button className="extractButton" onClick={() => void runAction(() => extractTask(selectedTask.id))}>
                    <Images size={16} /> 开始抽帧
                  </button>
                )}
                <a className={!canDownloadVideo ? "disabled" : ""} href={downloadUrl(selectedTask.id, "video")}>
                  <Download size={16} /> 视频
                </a>
                <a className={!canDownloadAssets ? "disabled" : ""} href={downloadUrl(selectedTask.id, "raw-frames")}>
                  <Download size={16} /> 原始帧
                </a>
                <a className={!canDownloadAssets ? "disabled" : ""} href={downloadUrl(selectedTask.id, "cutouts")}>
                  <Download size={16} /> 透明帧
                </a>
                <a className={!canDownloadAssets ? "disabled" : ""} href={downloadUrl(selectedTask.id, "zip")}>
                  <Download size={16} /> 完整包
                </a>
              </div>

              <h3>原始帧</h3>
              <div className="frameGrid">
                {firstFrames.raw.map((index) => (
                  <img key={index} src={previewUrl(selectedTask.id, "frame", index, token)} alt="" />
                ))}
              </div>

              <h3>透明帧</h3>
              <div className="frameGrid checker">
                {firstFrames.cutouts.map((index) => (
                  <img key={index} src={previewUrl(selectedTask.id, "cutout", index, token)} alt="" />
                ))}
              </div>

              <h3>日志</h3>
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
            <div className="empty">暂无任务</div>
          )}
        </section>
      </section>
    </main>
  );
}
