import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiTags } from "@nestjs/swagger";
import { SensitiveActionGuard } from "../../../auth/sensitive-action.guard";
import { type AuthenticatedRequest, requestMetadata } from "../../../common/request-context";
import { SessionGuard } from "../../../session/session.guard";
import { SessionService } from "../../../session/session.service";
import { CloseApprovedPositionDto, ExecuteApprovedOrderDto, SyncConnectionDto } from "../application/live-trading.dto";
import { LiveTradingService } from "../application/live-trading.service";

@ApiTags("live-trading")
@ApiCookieAuth(SessionService.cookieName)
@UseGuards(SessionGuard)
@Controller("ai/live-trading")
export class LiveTradingController {
  constructor(private readonly trading: LiveTradingService) {}

  @Get()
  dashboard(@Req() request: AuthenticatedRequest, @Query("connectionId") connectionId?: string) {
    return this.trading.dashboard(request.auth.userId, connectionId);
  }

  @Post("orders")
  @UseGuards(SensitiveActionGuard)
  execute(@Body() dto: ExecuteApprovedOrderDto, @Req() request: AuthenticatedRequest) {
    return this.trading.execute(request.auth.userId, dto, requestMetadata(request));
  }

  @Post("positions/close")
  @UseGuards(SensitiveActionGuard)
  close(@Body() dto: CloseApprovedPositionDto, @Req() request: AuthenticatedRequest) {
    return this.trading.close(request.auth.userId, dto, requestMetadata(request));
  }

  @Post("orders/:id/cancel")
  @UseGuards(SensitiveActionGuard)
  cancel(
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.trading.cancel(request.auth.userId, id, requestMetadata(request));
  }

  @Post("sync")
  sync(@Body() dto: SyncConnectionDto, @Req() request: AuthenticatedRequest) {
    return this.trading.sync(request.auth.userId, dto.connectionId, requestMetadata(request));
  }

  @Post("kill-switch")
  kill(@Req() request: AuthenticatedRequest) {
    return this.trading.kill(request.auth.userId, requestMetadata(request));
  }

  @Post("kill-switch/enable")
  @UseGuards(SensitiveActionGuard)
  enable(@Req() request: AuthenticatedRequest) {
    return this.trading.enable(request.auth.userId, requestMetadata(request));
  }
}
