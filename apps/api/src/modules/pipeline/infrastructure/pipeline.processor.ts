import { Processor, WorkerHost, OnWorkerEvent, InjectQueue } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import type { PipelineJob } from './pipeline-queue.service';
import { PipelineRunnerService } from '../application/pipeline-runner.service';
import { PIPELINE_DEAD_LETTER_QUEUE_NAME, PIPELINE_RUN_QUEUE_NAME } from './pipeline-queue.constants';

const configuredConcurrency = Number(process.env.PIPELINE_MAX_CONCURRENCY ?? 5);
const workerConcurrency = Number.isFinite(configuredConcurrency)
  ? Math.max(1, Math.min(50, Math.trunc(configuredConcurrency)))
  : 5;

@Processor(PIPELINE_RUN_QUEUE_NAME, { concurrency: workerConcurrency })
export class PipelineProcessor extends WorkerHost {
  private readonly logger = new Logger(PipelineProcessor.name);
  constructor(private readonly runner: PipelineRunnerService, @InjectQueue(PIPELINE_DEAD_LETTER_QUEUE_NAME) private readonly deadLetter: Queue) { super(); }
  process(job: Job<PipelineJob>) { return this.runner.run(job.data); }
  @OnWorkerEvent('failed')
  async failed(job: Job<PipelineJob> | undefined, error: Error) {
    if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) return;
    this.logger.error({ event: 'pipeline_dead_letter', runId: job.data.runId, error: error.message });
    await this.deadLetter.add('failed', { ...job.data, errorCode: 'RETRIES_EXHAUSTED', failedAt: new Date().toISOString() }, { jobId: `dlq-${job.data.runId}`, removeOnComplete: false });
  }
}
