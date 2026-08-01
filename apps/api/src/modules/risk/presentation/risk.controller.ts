import { Controller, Get, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../../../common/decorators/current-user.decorator";
import { SessionGuard } from "../../../session/session.guard";
import { RiskManagementService } from "../application/risk-management.service";

@Controller("ai/risk")
@UseGuards(SessionGuard)
export class RiskController {
  constructor(private readonly risk: RiskManagementService) {}
  @Get()
  dashboard(@CurrentUser() user: { id: string }) {
    return this.risk.dashboard(user.id);
  }
}
