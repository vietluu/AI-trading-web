import { Injectable } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import type { ExchangeProvider, PipelineTrigger } from "@prisma/client";
import type { PipelineSymbol } from "@platform/shared";
import { Optional } from "@nestjs/common";
import { FULL_ANALYSIS_DECISION } from "../domain/pipeline.definition";
import {
  CONFLUENCE_TIMEOUT_QUEUE_NAME,
  PIPELINE_RUN_QUEUE_NAME,
} from "./pipeline-queue.constants";

export interface PipelineJob {
  runId: string;
  pipelineId: string;
  symbol: PipelineSymbol;
  provider: ExchangeProvider;
  userId: string;
  params: Record<string, unknown>;
  trigger: PipelineTrigger;
  createdAt: string;
  useStoredContext?: boolean;
  confluenceBatchId?: string;
  confluenceBatchExpectedCount?: number;
}

@Injectable()
export class PipelineQueueService {
  constructor(
    @InjectQueue(PIPELINE_RUN_QUEUE_NAME)
    private readonly queue: Queue<PipelineJob>,
    @Optional()
    @InjectQueue(CONFLUENCE_TIMEOUT_QUEUE_NAME)
    private readonly timeoutQueue?: Queue,
  ) {}

  async enqueueConfluenceTimeout(
    batchId: string,
    userId: string,
    delayMs: number,
  ) {
    if (!this.timeoutQueue) return;
    return this.timeoutQueue.add(
      "timeout",
      { batchId, userId },
      {
        jobId: `confluence-timeout-${batchId}`,
        delay: delayMs,
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    );
  }
  enqueue(job: PipelineJob) {
    return this.queue.add("execute", job, {
      jobId: job.runId,
      attempts: FULL_ANALYSIS_DECISION.retryPolicy.attempts,
      backoff: {
        type: "exponential",
        delay: FULL_ANALYSIS_DECISION.retryPolicy.backoffMs,
      },
      removeOnComplete: 500,
      removeOnFail: 1000,
    });
  }
  async depth(): Promise<number> {
    const counts = await this.queue.getJobCounts(
      "waiting",
      "active",
      "delayed",
      "failed",
    );
    return (counts.waiting ?? 0) + (counts.active ?? 0) + (counts.delayed ?? 0);
  }
  async isPaused(): Promise<boolean> {
    return this.queue.isPaused();
  }
  async jobState(runId: string): Promise<string | undefined> {
    const job = await this.queue.getJob(runId);
    return job ? job.getState() : undefined;
  }
}
