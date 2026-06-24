import fs from "node:fs/promises";
import path from "node:path";

export type TaskPaths = {
  sourceDir: string;
  sourceImage: string;
  referenceVideoDir: string;
  referenceVideo: string;
  videoDir: string;
  video: string;
  rawFramesDir: string;
  cutoutsDir: string;
  previewsDir: string;
  zipsDir: string;
  fullZip: string;
  rawFramesZip: string;
  cutoutsZip: string;
};

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export function getTaskPaths(storageRoot: string, taskId: string): TaskPaths {
  const sourceDir = path.join(storageRoot, "uploads", taskId, "source");
  const referenceVideoDir = path.join(storageRoot, "uploads", taskId, "reference_video");
  const videoDir = path.join(storageRoot, "videos", taskId);
  const rawFramesDir = path.join(storageRoot, "frames", taskId, "raw_frames");
  const cutoutsDir = path.join(storageRoot, "cutouts", taskId, "transparent_frames");
  const previewsDir = path.join(storageRoot, "previews", taskId);
  const zipsDir = path.join(storageRoot, "zips", taskId);

  return {
    sourceDir,
    sourceImage: path.join(sourceDir, "source.png"),
    referenceVideoDir,
    referenceVideo: path.join(referenceVideoDir, "reference.mp4"),
    videoDir,
    video: path.join(videoDir, "result.mp4"),
    rawFramesDir,
    cutoutsDir,
    previewsDir,
    zipsDir,
    fullZip: path.join(zipsDir, "result.zip"),
    rawFramesZip: path.join(zipsDir, "raw_frames.zip"),
    cutoutsZip: path.join(zipsDir, "transparent_frames.zip")
  };
}

export async function ensureTaskDirs(paths: TaskPaths): Promise<void> {
  await Promise.all([
    ensureDir(paths.sourceDir),
    ensureDir(paths.referenceVideoDir),
    ensureDir(paths.videoDir),
    ensureDir(paths.rawFramesDir),
    ensureDir(paths.cutoutsDir),
    ensureDir(paths.previewsDir),
    ensureDir(paths.zipsDir)
  ]);
}

export function assertInside(root: string, target: string): string {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Path escapes configured root");
  }
  return resolvedTarget;
}
