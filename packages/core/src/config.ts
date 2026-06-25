import path from "node:path";
import fs from "node:fs";

export type AppConfig = {
  port: number;
  dataRoot: string;
  storageRoot: string;
  seedanceMock: boolean;
  rembgServiceUrl: string;
  redisUrl?: string;
  oss: {
    enabled: boolean;
    region: string;
    bucket: string;
    endpoint: string;
    baseUrl: string;
    accessKeyId?: string;
    accessKeySecret?: string;
    allowedRootPrefix: string;
    tempPrefix: string;
    tempTtlHours: number;
  };
  ark: {
    baseUrl: string;
    apiKey?: string;
    modelId: string;
    pollIntervalSeconds: number;
    maxPollSeconds: number;
    requestTimeoutSeconds: number;
  };
};

function findWorkspaceRoot(start: string): string {
  let current = start;
  while (true) {
    const manifestPath = path.join(current, "package.json");
    if (fs.existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { workspaces?: unknown };
        if (manifest.workspaces) {
          return current;
        }
      } catch {
        // Keep walking upward if a package file cannot be parsed.
      }
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return start;
    }
    current = parent;
  }
}

function readNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function loadRootEnv(root: string): void {
  const envPath = path.join(root, ".env");
  if (!fs.existsSync(envPath)) return;

  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export function getConfig(): AppConfig {
  const cwd = findWorkspaceRoot(process.cwd());
  loadRootEnv(cwd);
  return {
    port: readNumber("PORT", 4000),
    dataRoot: path.resolve(cwd, process.env.DATA_ROOT ?? "./data"),
    storageRoot: path.resolve(cwd, process.env.STORAGE_ROOT ?? "./storage"),
    seedanceMock: (process.env.SEEDANCE_MOCK ?? "true") !== "false",
    rembgServiceUrl: process.env.REMBG_SERVICE_URL ?? "http://localhost:8001",
    redisUrl: process.env.REDIS_URL || undefined,
    oss: {
      enabled: (process.env.OSS_ENABLED ?? "false") === "true",
      region: process.env.OSS_REGION ?? "oss-cn-beijing",
      bucket: process.env.OSS_BUCKET ?? "blueultra-ai",
      endpoint: process.env.OSS_ENDPOINT ?? "oss-cn-beijing.aliyuncs.com",
      baseUrl: process.env.OSS_BASE_URL ?? "https://blueultra-ai.oss-cn-beijing.aliyuncs.com",
      accessKeyId: process.env.OSS_ACCESS_KEY_ID || undefined,
      accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET || undefined,
      allowedRootPrefix: process.env.OSS_ALLOWED_ROOT_PREFIX ?? "wanglin/",
      tempPrefix: process.env.OSS_TEMP_PREFIX ?? "wanglin/seedance2/temp/",
      tempTtlHours: readNumber("OSS_TEMP_TTL_HOURS", 24)
    },
    ark: {
      baseUrl: process.env.ARK_BASE_URL ?? "https://ark.cn-beijing.volces.com/api/v3",
      apiKey: process.env.ARK_API_KEY || undefined,
      modelId: process.env.ARK_MODEL_ID ?? "doubao-seedance-2-0-260128",
      pollIntervalSeconds: readNumber("ARK_POLL_INTERVAL_SECONDS", 5),
      maxPollSeconds: readNumber("ARK_MAX_POLL_SECONDS", 900),
      requestTimeoutSeconds: readNumber("ARK_REQUEST_TIMEOUT_SECONDS", 60)
    }
  };
}
