import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  PipelineReplayRequestSchema,
  PipelineRunRequestSchema,
  PipelineRunStatusSchema,
  PipelineScheduleInputSchema,
} from "@platform/shared";
import { CurrentUser } from "../../../common/decorators/current-user.decorator";
import { SessionGuard } from "../../../session/session.guard";
import { PipelineService } from "../application/pipeline.service";
import { PipelineRepository } from "../infrastructure/pipeline.repository";
import { PipelineCancellationService } from "../infrastructure/pipeline-cancellation.service";
import { PipelineSchedulerService } from "../application/pipeline-scheduler.service";

@Controller()
@UseGuards(SessionGuard)
export class PipelineController {
  constructor(
    private readonly pipeline: PipelineService,
    private readonly repository: PipelineRepository,
    private readonly cancellation: PipelineCancellationService,
    private readonly scheduler: PipelineSchedulerService,
  ) {}

  @Post("pipeline/run")
  run(@CurrentUser() user: { id: string }, @Body() body: unknown) {
    return this.pipeline.trigger(user.id, PipelineRunRequestSchema.parse(body));
  }
  @Get("pipeline-runs")
  list(
    @CurrentUser() user: { id: string },
    @Query("status") status?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.repository.listRuns(user.id, {
      status: status ? PipelineRunStatusSchema.parse(status) : undefined,
      page: Math.max(1, Number(page) || 1),
      limit: Math.min(100, Math.max(1, Number(limit) || 20)),
    });
  }
  @Get("pipeline-runs/:id")
  detail(@CurrentUser() user: { id: string }, @Param("id") id: string) {
    return this.repository.findRun(id, user.id);
  }
  @Post("pipeline-runs/:id/replay")
  replay(
    @CurrentUser() user: { id: string },
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const input = PipelineReplayRequestSchema.parse(body);
    return this.pipeline.replay(user.id, id, input.mode);
  }
  @Post("pipeline-runs/:id/cancel")
  async cancel(@CurrentUser() user: { id: string }, @Param("id") id: string) {
    return { success: await this.cancellation.request(id, user.id) };
  }
  @Get("pipeline/schedules")
  schedules(@CurrentUser() user: { id: string }) {
    return this.scheduler.list(user.id);
  }
  @Post("pipeline/schedules")
  createSchedule(@CurrentUser() user: { id: string }, @Body() body: unknown) {
    return this.scheduler.create(
      user.id,
      PipelineScheduleInputSchema.parse(body),
    );
  }
  @Patch("pipeline/schedules/:id/enabled")
  enableSchedule(
    @CurrentUser() user: { id: string },
    @Param("id") id: string,
    @Body() body: { enabled: boolean },
  ) {
    return this.scheduler.setEnabled(user.id, id, body.enabled === true);
  }
  @Delete("pipeline/schedules/:id")
  cancelSchedule(@CurrentUser() user: { id: string }, @Param("id") id: string) {
    return this.scheduler.cancel(user.id, id);
  }
}
