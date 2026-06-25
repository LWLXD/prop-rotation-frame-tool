/// <reference path="./ali-oss.d.ts" />
import path from "node:path";
import OSS from "ali-oss";
import type { AppConfig } from "./config.js";

type OssClient = InstanceType<typeof OSS>;

export type TempUploadKind = "source-image" | "reference-video";

export type TempUploadResult = {
  key: string;
  url: string;
};

export type OssService = {
  readonly enabled: boolean;
  readonly bucket: string;
  readonly baseUrl: string;
  readonly tempPrefix: string;
  readonly hasCredentials: boolean;
  uploadTempObject(taskId: string, kind: TempUploadKind, fileName: string, body: Buffer, mimeType: string): Promise<TempUploadResult>;
  deleteObject(key?: string | null): Promise<void>;
  cleanupTempObjectsOlderThan(hours?: number): Promise<number>;
};

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function normalizeObjectKey(key: string): string {
  return key.replace(/\\/g, "/").replace(/^\/+/, "");
}

function safeFileName(fileName: string): string {
  const parsed = path.parse(fileName);
  const ext = parsed.ext.toLowerCase().replace(/[^a-z0-9.]/g, "");
  const base = parsed.name.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "file";
  return `${base}${ext}`;
}

function publicUrl(baseUrl: string, key: string): string {
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  return `${baseUrl.replace(/\/$/, "")}/${encodedKey}`;
}

function createDisabledOssService(config: AppConfig): OssService {
  return {
    enabled: false,
    bucket: config.oss.bucket,
    baseUrl: config.oss.baseUrl,
    tempPrefix: ensureTrailingSlash(normalizeObjectKey(config.oss.tempPrefix)),
    hasCredentials: Boolean(config.oss.accessKeyId && config.oss.accessKeySecret),
    async uploadTempObject() {
      throw new Error("OSS is disabled");
    },
    async deleteObject() {
      return;
    },
    async cleanupTempObjectsOlderThan() {
      return 0;
    }
  };
}

export function createOssService(config: AppConfig): OssService {
  const allowedRootPrefix = ensureTrailingSlash(normalizeObjectKey(config.oss.allowedRootPrefix));
  const tempPrefix = ensureTrailingSlash(normalizeObjectKey(config.oss.tempPrefix));
  const hasCredentials = Boolean(config.oss.accessKeyId && config.oss.accessKeySecret);

  if (!tempPrefix.startsWith(allowedRootPrefix)) {
    throw new Error("OSS_TEMP_PREFIX must be inside OSS_ALLOWED_ROOT_PREFIX");
  }
  if (!config.oss.enabled) {
    return createDisabledOssService(config);
  }
  if (!hasCredentials) {
    throw new Error("OSS_ACCESS_KEY_ID and OSS_ACCESS_KEY_SECRET are required when OSS_ENABLED=true");
  }

  const client: OssClient = new OSS({
    region: config.oss.region,
    endpoint: config.oss.endpoint,
    bucket: config.oss.bucket,
    accessKeyId: config.oss.accessKeyId,
    accessKeySecret: config.oss.accessKeySecret,
    secure: true
  });

  function assertAllowedKey(key: string): string {
    const normalized = normalizeObjectKey(key);
    if (!normalized.startsWith(allowedRootPrefix)) {
      throw new Error("OSS object key is outside the allowed root prefix");
    }
    return normalized;
  }

  function assertTempKey(key: string): string {
    const normalized = assertAllowedKey(key);
    if (!normalized.startsWith(tempPrefix)) {
      throw new Error("OSS temporary upload key is outside the configured temp prefix");
    }
    return normalized;
  }

  return {
    enabled: true,
    bucket: config.oss.bucket,
    baseUrl: config.oss.baseUrl,
    tempPrefix,
    hasCredentials,
    async uploadTempObject(taskId, kind, fileName, body, mimeType) {
      const key = assertTempKey(`${tempPrefix}${taskId}/${kind}/${Date.now()}-${safeFileName(fileName)}`);
      await client.put(key, body, {
        headers: {
          "Content-Type": mimeType,
          "Cache-Control": "no-store"
        }
      });
      return { key, url: publicUrl(config.oss.baseUrl, key) };
    },
    async deleteObject(key) {
      if (!key) return;
      await client.delete(assertAllowedKey(key));
    },
    async cleanupTempObjectsOlderThan(hours = config.oss.tempTtlHours) {
      const cutoff = Date.now() - Math.max(1, hours) * 60 * 60 * 1000;
      let marker: string | undefined;
      let removed = 0;

      do {
        const result = await client.list({ prefix: tempPrefix, marker, "max-keys": 1000 });
        const objects = result.objects ?? [];
        const staleKeys: string[] = [];
        for (const object of objects) {
          if (!object.name || !object.lastModified) continue;
          if (new Date(object.lastModified).getTime() < cutoff) {
            staleKeys.push(assertTempKey(object.name));
          }
        }

        if (staleKeys.length > 0) {
          await client.deleteMulti(staleKeys, { quiet: true });
          removed += staleKeys.length;
        }
        marker = result.nextMarker;
      } while (marker);

      return removed;
    }
  };
}
