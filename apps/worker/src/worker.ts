import { Worker as BullWorker } from "bullmq";
import { getConfig, processTask, redisConnectionOptions, taskQueueName, TaskStore } from "@prop-tool/core";
import type { QueueAction } from "@prop-tool/core";

const config = getConfig();
const store = new TaskStore(config.dataRoot);
let running = false;

async function processNextQueuedTask(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const [task] = await store.listProcessable();
    if (task) {
      await processTask(task.id, store, config, task.status === "EXTRACTING_FRAMES" ? "extract" : "generate");
    }
  } finally {
    running = false;
  }
}

async function startLocalPollingWorker(): Promise<void> {
  console.log("Worker using local polling queue");
  await processNextQueuedTask();
  setInterval(() => {
    void processNextQueuedTask().catch((error) => {
      console.error("Worker polling error", error);
    });
  }, 2000);
}

async function startBullMqWorker(redisUrl: string): Promise<void> {
  console.log("Worker using BullMQ queue");
  const connection = redisConnectionOptions(redisUrl);
  const worker = new BullWorker(
    taskQueueName,
    async (job) => {
      const taskId = job.data?.taskId as string | undefined;
      const action = (job.data?.action ?? "generate") as QueueAction;
      if (!taskId) {
        throw new Error("Job missing taskId");
      }
      await processTask(taskId, store, config, action);
    },
    { connection, concurrency: 1 }
  );

  worker.on("failed", (job, error) => {
    console.error(`Job ${job?.id ?? "unknown"} failed`, error);
  });

  const close = async () => {
    await worker.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void close());
  process.on("SIGTERM", () => void close());
}

if (config.redisUrl) {
  await startBullMqWorker(config.redisUrl);
} else {
  await startLocalPollingWorker();
}
