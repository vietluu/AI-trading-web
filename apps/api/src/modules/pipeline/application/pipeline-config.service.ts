import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class PipelineConfigService {
  constructor(private readonly config: ConfigService) {}
  get enabled() { return this.config.get<boolean>('PIPELINE_ENABLED', true); }
  get maxConcurrency() { return this.config.get<number>('PIPELINE_MAX_CONCURRENCY', 5); }
  get cooldownMs() { return this.config.get<number>('PIPELINE_COOLDOWN_MS', 60_000); }
  get maxRunsPerHour() { return this.config.get<number>('PIPELINE_MAX_RUNS_PER_HOUR', 120); }
  get minConfidence() { return this.config.get<number>('MIN_CONFIDENCE', 60); }
}
