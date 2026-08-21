import { Controller, Get, UseGuards } from '@nestjs/common';
import { SessionGuard } from '../../../session/session.guard';
import { PipelineHealthService } from '../application/pipeline-health.service';

@Controller('system/pipeline')
@UseGuards(SessionGuard)
export class PipelineSystemController {
  constructor(private readonly healthService: PipelineHealthService) {}
  @Get('health') health() { return this.healthService.health(); }
  @Get('metrics') metrics() { return this.healthService.metrics(); }
}
