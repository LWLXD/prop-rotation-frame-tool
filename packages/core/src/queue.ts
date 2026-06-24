import { Queue } from "bullmq";

export const taskQueueName = "prop-rotation-tasks";

export type QueueAction = "generate" | "extract";

export type QueueClient = {
  enqueue(taskId: string, action?: QueueAction): Promise<void>;
  close(): Promise<void>;
};

export function redisConnectionOptions(redisUrl: string) {
  const parsed = new URL(redisUrl);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    username: parsed.username || undefined,
    password: parsed.password || undefined,
    maxRetriesPerRequest: null
  };
}

export function createQueueClient(redisUrl?: string): QueueClient {
  if (!redisUrl) {
    return {
      async enqueue() {
        return undefined;
      },
      async close() {
        return undefined;
      }
    };
  }

  const connection = redisConnectionOptions(redisUrl);
  const queue = new Queue(taskQueueName, { connection });

  return {
    async enqueue(taskId: string, action: QueueAction = "generate") {
      await queue.add("process-task", { taskId, action }, { attempts: 1, removeOnComplete: true });
    },
    async close() {
      await queue.close();
    }
  };
}
