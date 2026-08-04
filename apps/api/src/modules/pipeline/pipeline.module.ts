import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { BullModule } from "@nestjs/bullmq";
import { AgentsModule } from "../agents/agents.module";
import { DatabaseModule } from "../../database/database.module";
import { SessionModule } from "../../session/session.module";
import { PipelineController } from "./presentation/pipeline.controller";
import { PipelineSystemController } from "./presentation/pipeline-system.controller";
import { PipelineConfigService } from "./application/pipeline-config.service";
import { PipelineThresholdService } from "./application/pipeline-threshold.service";
import { SignalFilterService } from "./application/signal-filter.service";
import { PipelineAlertService } from "./application/pipeline-alert.service";
import { PipelineRunnerService } from "./application/pipeline-runner.service";
import { PipelineService } from "./application/pipeline.service";
import { PipelineSchedulerService } from "./application/pipeline-scheduler.service";
import { PipelineHealthService } from "./application/pipeline-health.service";
import { PipelineAnalyticsService } from "./application/pipeline-analytics.service";
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
import { createBullRootConfig } from "./infrastructure/bull-config";

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    SessionModule,
    AgentsModule,
    LiveTradingModule,
    MarketDataModule,
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => createBullRootConfig(config),
      inject: [ConfigService],
    }),
    BullModule.registerQueue(
      { name: PIPELINE_RUN_QUEUE_NAME },
      { name: PIPELINE_RETRY_QUEUE_NAME },
      { name: PIPELINE_DEAD_LETTER_QUEUE_NAME },
    ),
  ],
  controllers: [PipelineController, PipelineSystemController],
  providers: [
    PipelineConfigService,
    PipelineThresholdService,
    SignalFilterService,
    PipelineAlertService,
    PipelineRunnerService,
    PipelineService,
    PipelineSchedulerService,
    PipelineHealthService,
    PipelineAnalyticsService,
    PipelineRepository,
    PipelineQueueService,
    PipelineCancellationService,
    PipelineProcessor,
  ],
  exports: [PipelineService, PipelineHealthService],
})
export class PipelineModule {}
