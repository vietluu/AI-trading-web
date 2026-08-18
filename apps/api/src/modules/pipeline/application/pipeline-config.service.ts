import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { FULL_ANALYSIS_DECISION } from "../domain/pipeline.definition";

@Injectable()
export class PipelineConfigService {
  constructor(private readonly config: ConfigService) {}
  get enabled() {
    return this.config.get<boolean>("PIPELINE_ENABLED", true);
  }
  get maxConcurrency() {
    return this.config.get<number>("PIPELINE_MAX_CONCURRENCY", 5);
  }
  get cooldownMs() {
    return this.config.get<number>("PIPELINE_COOLDOWN_MS", 60_000);
  }
  get maxRunsPerHour() {
    return this.config.get<number>("PIPELINE_MAX_RUNS_PER_HOUR", 120);
  }
  get minConfidence() {
    return this.config.get<number>("MIN_CONFIDENCE", 70);
  }
  get staleRunAfterMs() {
    return this.config.get<number>(
      "PIPELINE_STALE_RUN_AFTER_MS",
      FULL_ANALYSIS_DECISION.timeoutMs * 2,
    );
  }
  get recoveryIntervalMs() {
    return this.config.get<number>("PIPELINE_RECOVERY_INTERVAL_MS", 60_000);
  }
}
