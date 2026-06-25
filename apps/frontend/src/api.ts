import type { Task, TaskListResponse } from "@prop-tool/shared";

export type RuntimeConfig = {
  seedanceMock: boolean;
  hasArkApiKey: boolean;
  arkBaseUrl: string;
  arkModelId: string;
  ossEnabled: boolean;
  ossBucket: string;
  ossBaseUrl: string;
  ossTempPrefix: string;
  ossHasAccessKey: boolean;
};

function resolveApiBaseUrl(): string {
  const configured = import.meta.env.VITE_API_BASE_URL as string | undefined;
  if (configured && configured !== "auto") {
    return configured.replace(/\/$/, "");
  }

  const apiPort = (import.meta.env.VITE_API_PORT as string | undefined) ?? "4100";
  return `${window.location.protocol}//${window.location.hostname}:${apiPort}`;
}

export const apiBaseUrl = resolveApiBaseUrl();

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, options);
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(payload?.message ?? `Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function createTask(formData: FormData): Promise<{ taskId: string; status: string }> {
  return request("/api/tasks", { method: "POST", body: formData });
}

export async function listTasks(): Promise<TaskListResponse> {
  return request("/api/tasks?pageSize=50");
}

export async function getTask(id: string): Promise<Task> {
  return request(`/api/tasks/${id}`);
}

export async function getRuntimeConfig(): Promise<RuntimeConfig> {
  return request("/api/runtime-config");
}

export async function retryTask(id: string): Promise<void> {
  await request(`/api/tasks/${id}/retry`, { method: "POST" });
}

export async function extractTask(id: string): Promise<void> {
  await request(`/api/tasks/${id}/extract`, { method: "POST" });
}

export async function cancelTask(id: string): Promise<void> {
  await request(`/api/tasks/${id}/cancel`, { method: "POST" });
}

export async function deleteTask(id: string): Promise<void> {
  const response = await fetch(`${apiBaseUrl}/api/tasks/${id}`, { method: "DELETE" });
  if (!response.ok) {
    throw new Error(`Delete failed: ${response.status}`);
  }
}

export function previewUrl(taskId: string, kind: "source" | "video" | "frame" | "cutout", index?: number, token?: string) {
  const suffix = token ? `?v=${encodeURIComponent(token)}` : "";
  if (kind === "frame" || kind === "cutout") {
    return `${apiBaseUrl}/api/tasks/${taskId}/preview/${kind}/${index ?? 1}${suffix}`;
  }
  return `${apiBaseUrl}/api/tasks/${taskId}/preview/${kind}${suffix}`;
}

export function downloadUrl(taskId: string, kind: "video" | "zip" | "raw-frames" | "cutouts") {
  return `${apiBaseUrl}/api/tasks/${taskId}/download/${kind}`;
}
