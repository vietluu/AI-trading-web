import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { BullModule } from "@nestjs/bullmq";
import { AgentsModule } from "../agents/agents.module";
import { DatabaseModule } from "../../database/database.module";
import { SessionModule } from "../../session/session.module";
import { PipelineController } from "./presentation/pipeline.controller";
import { PipelineSystemController } from "./presentation/pipeline-system.controller";
import { PipelineConfigService } from "./application/pipeline-config.service";
import { SignalFilterService } from "./application/signal-filter.service";
import { PipelineAlertService } from "./application/pipeline-alert.service";
import { PipelineRunnerService } from "./application/pipeline-runner.service";
import { DecisionJudgeService } from "./application/decision-judge.service";
import { QuantExecutionPolicyService } from "./application/quant-execution-policy.service";
import { DecisionRiskPolicyService } from "../risk/application/decision-risk-policy.service";
import { PipelineService } from "./application/pipeline.service";
import { PipelineSchedulerService } from "./application/pipeline-scheduler.service";
import { MarketEventScannerService } from "./application/market-event-scanner.service";
import { PipelineHealthService } from "./application/pipeline-health.service";
import { PipelineAnalyticsService } from "./application/pipeline-analytics.service";
import { PipelineRecoveryService } from "./application/pipeline-recovery.service";
import { PipelineRepository } from "./infrastructure/pipeline.repository";
import { PipelineQueueService } from "./infrastructure/pipeline-queue.service";
import { PipelineCancellationService } from "./infrastructure/pipeline-cancellation.service";
import { PipelineProcessor } from "./infrastructure/pipeline.processor";
import {
  PIPELINE_DEAD_LETTER_QUEUE_NAME,
  PIPELINE_RETRY_QUEUE_NAME,
  PIPELINE_RUN_QUEUE_NAME,
} from "./infrastructure/pipeline-queue.constants";
import { LiveTradingModule } from "../live-trading/live-trading.module";
import { MarketDataModule } from "../../market-data/market-data.module";
import { RedisModule } from "../../redis/redis.module";
import { SettingsModule } from "../../settings/settings.module";
import { PortfolioModule } from "../portfolio/portfolio.module";
import { ExternalDataModule } from "../external-data/external-data.module";
import { HighImportanceNewsTriggerService } from "./application/high-importance-news-trigger.service";

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    SessionModule,
    AgentsModule,
    LiveTradingModule,
    MarketDataModule,
    RedisModule,
    SettingsModule,
    PortfolioModule,
    ExternalDataModule,
    BullModule.registerQueue(
      { name: PIPELINE_RUN_QUEUE_NAME },
      { name: PIPELINE_RETRY_QUEUE_NAME },
      { name: PIPELINE_DEAD_LETTER_QUEUE_NAME },
    ),
  ],
  controllers: [PipelineController, PipelineSystemController],
  providers: [
    PipelineConfigService,
    SignalFilterService,
    PipelineAlertService,
    DecisionRiskPolicyService,
    PipelineRunnerService,
    DecisionJudgeService,
    QuantExecutionPolicyService,
    PipelineService,
    PipelineSchedulerService,
    MarketEventScannerService,
    PipelineHealthService,
    PipelineAnalyticsService,
    PipelineRecoveryService,
    PipelineRepository,
    PipelineQueueService,
    PipelineCancellationService,
    PipelineProcessor,
    HighImportanceNewsTriggerService,
  ],
  exports: [PipelineService, PipelineHealthService],
})
export class PipelineModule {}
