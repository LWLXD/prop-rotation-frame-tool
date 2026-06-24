import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Task, TaskLog, TaskOutput, TaskStatus } from "@prop-tool/shared";
import { isTerminalStatus } from "@prop-tool/shared";
import { ensureDir } from "./paths.js";

type TaskDatabase = {
  tasks: Task[];
};

type ListOptions = {
  page?: number;
  pageSize?: number;
  status?: TaskStatus;
  keyword?: string;
};

export class TaskStore {
  private readonly dbPath: string;

  constructor(dataRoot: string) {
    this.dbPath = path.join(dataRoot, "tasks.json");
  }

  async list(options: ListOptions = {}) {
    const page = Math.max(1, options.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 20));
    const keyword = options.keyword?.trim().toLowerCase();
    const db = await this.read();

    let items = [...db.tasks].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (options.status) {
      items = items.filter((task) => task.status === options.status);
    }
    if (keyword) {
      items = items.filter((task) => task.name.toLowerCase().includes(keyword));
    }

    const total = items.length;
    const start = (page - 1) * pageSize;
    return { items: items.slice(start, start + pageSize), total, page, pageSize };
  }

  async listProcessable(): Promise<Task[]> {
    const db = await this.read();
    return db.tasks
      .filter((task) => task.status === "QUEUED" || task.status === "PENDING")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async get(id: string): Promise<Task | undefined> {
    const db = await this.read();
    return db.tasks.find((task) => task.id === id);
  }

  async create(task: Task): Promise<Task> {
    const db = await this.read();
    db.tasks.push(task);
    await this.write(db);
    return task;
  }

  async update(id: string, patch: Partial<Task>): Promise<Task> {
    const db = await this.read();
    const index = db.tasks.findIndex((task) => task.id === id);
    if (index === -1) {
      throw new Error(`Task not found: ${id}`);
    }
    const now = new Date().toISOString();
    const next: Task = { ...db.tasks[index], ...patch, updatedAt: now };
    if (patch.status && isTerminalStatus(patch.status)) {
      next.finishedAt = next.finishedAt ?? now;
    }
    db.tasks[index] = next;
    await this.write(db);
    return next;
  }

  async updateStatus(id: string, status: TaskStatus, progress: number, message?: string): Promise<Task> {
    const task = await this.update(id, { status, progress });
    if (message) {
      await this.addLog(id, status, "info", message);
    }
    return task;
  }

  async fail(id: string, message: string): Promise<Task> {
    await this.addLog(id, "FAILED", "error", message);
    return this.update(id, { status: "FAILED", progress: 100, errorMessage: message });
  }

  async addOutput(taskId: string, output: Omit<TaskOutput, "id" | "taskId" | "createdAt">): Promise<TaskOutput> {
    const db = await this.read();
    const task = db.tasks.find((item) => item.id === taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    const next: TaskOutput = {
      id: randomUUID(),
      taskId,
      createdAt: new Date().toISOString(),
      ...output
    };
    task.outputs = [...task.outputs.filter((item) => item.filePath !== next.filePath), next];
    task.updatedAt = new Date().toISOString();
    await this.write(db);
    return next;
  }

  async addLog(
    taskId: string,
    stage: TaskLog["stage"],
    level: TaskLog["level"],
    message: string,
    meta?: Record<string, unknown>
  ): Promise<TaskLog> {
    const db = await this.read();
    const task = db.tasks.find((item) => item.id === taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    const next: TaskLog = {
      id: randomUUID(),
      taskId,
      stage,
      level,
      message,
      meta,
      createdAt: new Date().toISOString()
    };
    task.logs = [...task.logs, next].slice(-200);
    task.updatedAt = new Date().toISOString();
    await this.write(db);
    return next;
  }

  async remove(id: string): Promise<void> {
    const db = await this.read();
    db.tasks = db.tasks.filter((task) => task.id !== id);
    await this.write(db);
  }

  private async read(): Promise<TaskDatabase> {
    await ensureDir(path.dirname(this.dbPath));
    try {
      const raw = await fs.readFile(this.dbPath, "utf8");
      return JSON.parse(raw) as TaskDatabase;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { tasks: [] };
      }
      throw error;
    }
  }

  private async write(db: TaskDatabase): Promise<void> {
    await ensureDir(path.dirname(this.dbPath));
    await fs.writeFile(this.dbPath, JSON.stringify(db, null, 2), "utf8");
  }
}
