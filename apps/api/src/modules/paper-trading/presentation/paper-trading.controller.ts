import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { SessionGuard } from '../../../session/session.guard';
import { PaperTradingService } from '../application/paper-trading.service';

@Controller('ai/paper-trading')
@UseGuards(SessionGuard)
export class PaperTradingController {
  constructor(private readonly paperTrading: PaperTradingService) {}
  @Get()
  dashboard(@CurrentUser() user: { id: string }) { return this.paperTrading.dashboard(user.id); }
}
