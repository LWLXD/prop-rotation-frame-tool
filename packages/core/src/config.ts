import path from "node:path";
import fs from "node:fs";

export type AppConfig = {
  port: number;
  dataRoot: string;
  storageRoot: string;
  publicBaseUrl?: string;
  seedanceMock: boolean;
  rembgServiceUrl: string;
  redisUrl?: string;
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
    publicBaseUrl: process.env.PUBLIC_BASE_URL || undefined,
    seedanceMock: (process.env.SEEDANCE_MOCK ?? "true") !== "false",
    rembgServiceUrl: process.env.REMBG_SERVICE_URL ?? "http://localhost:8001",
    redisUrl: process.env.REDIS_URL || undefined,
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
