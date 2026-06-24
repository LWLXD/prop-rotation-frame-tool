import { Queue } from "bullmq";

export const taskQueueName = "prop-rotation-tasks";

export type QueueClient = {
  enqueue(taskId: string): Promise<void>;
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
    async enqueue(taskId: string) {
      await queue.add("process-task", { taskId }, { attempts: 1, removeOnComplete: true });
    },
    async close() {
      await queue.close();
    }
  };
}
