import { Processor, WorkerHost, OnWorkerEvent, InjectQueue } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import type { PipelineJob } from './pipeline-queue.service';
import { PipelineRunnerService } from '../application/pipeline-runner.service';

@Processor('pipeline:run', { concurrency: 5 })
export class PipelineProcessor extends WorkerHost {
  private readonly logger = new Logger(PipelineProcessor.name);
  constructor(private readonly runner: PipelineRunnerService, @InjectQueue('pipeline:dead-letter') private readonly deadLetter: Queue) { super(); }
  process(job: Job<PipelineJob>) { return this.runner.run(job.data); }
  @OnWorkerEvent('failed')
  async failed(job: Job<PipelineJob> | undefined, error: Error) {
    if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) return;
    this.logger.error({ event: 'pipeline_dead_letter', runId: job.data.runId, error: error.message });
    await this.deadLetter.add('failed', { ...job.data, errorCode: 'RETRIES_EXHAUSTED', failedAt: new Date().toISOString() }, { jobId: `dlq-${job.data.runId}`, removeOnComplete: false });
  }
}
