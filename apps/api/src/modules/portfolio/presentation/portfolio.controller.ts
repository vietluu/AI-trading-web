import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { CurrentUser } from "../../../common/decorators/current-user.decorator";
import { SessionGuard } from "../../../session/session.guard";
import { PortfolioService } from "../application/portfolio.service";

@Controller("ai/portfolio")
@UseGuards(SessionGuard)
export class PortfolioController {
  constructor(private readonly portfolio: PortfolioService) {}

  @Get()
  dashboard(@CurrentUser() user: { id: string }) {
    return this.portfolio.dashboard(user.id);
  }

  @Post("rebalance")
  rebalance(@CurrentUser() user: { id: string }) {
    return this.portfolio.rebalance(user.id, "MANUAL");
  }

  @Patch("strategies/:key/status")
  async status(
    @CurrentUser() user: { id: string },
    @Param("key") key: string,
    @Body() body: { status?: string },
  ) {
    if (body.status !== "ACTIVE" && body.status !== "PAUSED")
      throw new BadRequestException("status must be ACTIVE or PAUSED");
    await this.portfolio.setStatus(user.id, key, body.status);
    return { updated: true };
  }

  @Post("strategies/:key/results")
  async result(
    @CurrentUser() user: { id: string },
    @Param("key") key: string,
    @Body() body: { symbol?: string; pnl?: number; returnPct?: number },
  ) {
    if (
      !body.symbol ||
      typeof body.pnl !== "number" ||
      typeof body.returnPct !== "number"
    )
      throw new BadRequestException("symbol, pnl and returnPct are required");
    await this.portfolio.recordResult(user.id, key, {
      symbol: body.symbol.toUpperCase(),
      pnl: body.pnl,
      returnPct: body.returnPct,
    });
    return { recorded: true };
  }
}
