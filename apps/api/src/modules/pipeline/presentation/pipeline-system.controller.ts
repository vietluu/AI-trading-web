import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { SessionGuard } from '../../../session/session.guard';
import { PipelineHealthService } from '../application/pipeline-health.service';
import { PipelineQueueService } from '../infrastructure/pipeline-queue.service';

@Controller('system/pipeline')
@UseGuards(SessionGuard)
export class PipelineSystemController {
  constructor(private readonly healthService: PipelineHealthService, private readonly queue: PipelineQueueService) {}
  @Get('health') health() { return this.healthService.health(); }
  @Get('metrics') metrics() { return this.healthService.metrics(); }
  @Post('pause') async pause() { await this.queue.pause(); return { paused: true }; }
  @Post('resume') async resume() { await this.queue.resume(); return { paused: false }; }
}
