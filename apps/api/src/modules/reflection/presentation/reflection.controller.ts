import { Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { EvaluationHorizonSchema, ImprovementProposalInputSchema, ImprovementProposalReviewSchema } from '@platform/shared';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { SessionGuard } from '../../../session/session.guard';
import { PerformanceService } from '../application/performance.service';
import { ReflectionService } from '../application/reflection.service';
import { ReflectionRepository } from '../infrastructure/reflection.repository';

@Controller('ai')
@UseGuards(SessionGuard)
export class ReflectionController {
  constructor(private readonly performance: PerformanceService, private readonly reflection: ReflectionService, private readonly repository: ReflectionRepository) {}

  @Get('performance')
  records(@CurrentUser() user: { id: string }, @Query('horizon') raw?: string, @Query('symbol') symbol?: string) {
    return this.performance.list(user.id, raw ? EvaluationHorizonSchema.parse(raw) : undefined, symbol);
  }
  @Get('performance/metrics')
  metrics(@CurrentUser() user: { id: string }, @Query('horizon') raw?: string, @Query('symbol') symbol?: string) {
    return this.performance.metrics(user.id, raw ? EvaluationHorizonSchema.parse(raw) : undefined, symbol);
  }
  @Get('performance/alerts')
  alerts(@CurrentUser() user: { id: string }, @Query('symbol') symbol?: string) { return this.performance.alerts(user.id, symbol); }
  @Post('performance/evaluate')
  evaluate() { return this.performance.evaluateDue(); }

  @Get('reflection')
  overview(@CurrentUser() user: { id: string }) { return this.reflection.generate(user.id, false); }
  @Post('reflection/run')
  run(@CurrentUser() user: { id: string }) { return this.reflection.generate(user.id, true); }
  @Get('reflection/insights')
  insights(@CurrentUser() user: { id: string }) { return this.repository.insights(user.id); }
  @Get('reflection/proposals')
  proposals(@CurrentUser() user: { id: string }) { return this.repository.proposals(user.id); }
  @Post('reflection/proposals')
  createProposal(@CurrentUser() user: { id: string }, @Body() body: unknown) {
    const input = ImprovementProposalInputSchema.parse(body);
    return this.repository.createProposal(user.id, input.description, input.proposedChange);
  }
  @Patch('reflection/proposals/:id/review')
  async review(@CurrentUser() user: { id: string }, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = ImprovementProposalReviewSchema.parse(body);
    const result = await this.repository.reviewProposal(user.id, id, input.status);
    if (!result.count) throw new NotFoundException('Pending proposal not found');
    return this.repository.proposal(user.id, id);
  }
}
