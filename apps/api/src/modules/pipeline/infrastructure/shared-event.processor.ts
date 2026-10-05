import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { EventPipelineService, SHARED_EVENT_QUEUE, SharedMarketEvent } from '../application/event-pipeline.service';

@Processor(SHARED_EVENT_QUEUE, { concurrency: 1 })
export class SharedEventProcessor extends WorkerHost {
  constructor(private readonly events: EventPipelineService) { super(); }
  async process(job: Job<SharedMarketEvent>) { await this.events.dispatch(job.data); }
}
