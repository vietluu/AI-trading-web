import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { Job } from "bullmq";
import { CONFLUENCE_TIMEOUT_QUEUE_NAME } from "./pipeline-queue.constants";
import { ConfluenceCollectorService } from "./confluence-collector.service";
import { PipelineRunnerService } from "../application/pipeline-runner.service";

export interface ConfluenceTimeoutJob {
  batchId: string;
  userId: string;
}

@Processor(CONFLUENCE_TIMEOUT_QUEUE_NAME, { concurrency: 5 })
@Injectable()
export class ConfluenceTimeoutProcessor extends WorkerHost {
  private readonly logger = new Logger(ConfluenceTimeoutProcessor.name);

  constructor(
    private readonly collector: ConfluenceCollectorService,
    @Optional() @Inject(PipelineRunnerService) private readonly runner?: PipelineRunnerService,
  ) {
    super();
  }

  async process(job: Job<ConfluenceTimeoutJob>): Promise<void> {
    const { batchId, userId } = job.data;
    const batch = await this.collector.batchStatus(batchId);
    if (!batch) {
      // Batch has already been drained or expired
      return;
    }

    this.logger.warn({
      event: "confluence_batch_timeout",
      batchId,
      userId,
      reportedCount: batch.reportedCount,
      expectedCount: batch.expectedCount,
    });

    if (this.runner) {
      await this.runner.executeConfluenceBatch(batchId, userId);
    }
  }
}
