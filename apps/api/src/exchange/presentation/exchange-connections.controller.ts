import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiCookieAuth, ApiTags } from "@nestjs/swagger";

import { SensitiveActionGuard } from "../../auth/sensitive-action.guard";
import {
  type AuthenticatedRequest,
  requestMetadata,
} from "../../common/request-context";
import { SessionGuard } from "../../session/session.guard";
import { SessionService } from "../../session/session.service";
import {
  CreateExchangeConnectionDto,
  OpenOrdersQueryDto,
  OrderLookupQueryDto,
  UpdateExchangeConnectionDto,
} from "../application/exchange-connection.dto";
import { ExchangeConnectionService } from "../application/exchange-connection.service";

@ApiTags("exchange-connections")
@ApiCookieAuth(SessionService.cookieName)
@UseGuards(SessionGuard)
@Controller("exchange-connections")
export class ExchangeConnectionsController {
  constructor(private readonly connections: ExchangeConnectionService) {}

  @Get()
  list(@Req() request: AuthenticatedRequest) {
    return this.connections.list(request.auth.userId);
  }

  @Post()
  @UseGuards(SensitiveActionGuard)
  create(
    @Body() dto: CreateExchangeConnectionDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.connections.create(
      request.auth.userId,
      request.auth.sessionRecordId,
      dto,
      requestMetadata(request),
    );
  }

  @Get(":id")
  get(
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.connections.get(request.auth.userId, id);
  }

  @Patch(":id")
  @UseGuards(SensitiveActionGuard)
  update(
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Body() dto: UpdateExchangeConnectionDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.connections.update(
      request.auth.userId,
      request.auth.sessionRecordId,
      id,
      dto,
      requestMetadata(request),
    );
  }

  @Delete(":id")
  @UseGuards(SensitiveActionGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    return this.connections.delete(
      request.auth.userId,
      request.auth.sessionRecordId,
      id,
      requestMetadata(request),
    );
  }

  @Post(":id/test")
  test(
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.connections.test(
      request.auth.userId,
      id,
      requestMetadata(request),
    );
  }

  @Post(":id/enable")
  @UseGuards(SensitiveActionGuard)
  enable(
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.connections.setEnabled(
      request.auth.userId,
      request.auth.sessionRecordId,
      id,
      true,
      requestMetadata(request),
    );
  }

  @Post(":id/disable")
  @UseGuards(SensitiveActionGuard)
  disable(
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.connections.setEnabled(
      request.auth.userId,
      request.auth.sessionRecordId,
      id,
      false,
      requestMetadata(request),
    );
  }

  @Get(":id/account")
  account(
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.connections.account(
      request.auth.userId,
      id,
      requestMetadata(request),
    );
  }

  @Get(":id/balances")
  balances(
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.connections.balances(
      request.auth.userId,
      id,
      requestMetadata(request),
    );
  }

  @Get(":id/positions")
  positions(
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.connections.positions(
      request.auth.userId,
      id,
      requestMetadata(request),
    );
  }

  @Get(":id/orders/open")
  openOrders(
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Query() query: OpenOrdersQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.connections.openOrders(
      request.auth.userId,
      id,
      requestMetadata(request),
      query.symbol,
    );
  }

  @Get(":id/orders/:orderId")
  order(
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Param("orderId") orderId: string,
    @Query() query: OrderLookupQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.connections.order(
      request.auth.userId,
      id,
      orderId,
      query.symbol,
      requestMetadata(request),
    );
  }

  @Get(":id/configuration")
  configuration(
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.connections.configuration(
      request.auth.userId,
      id,
      requestMetadata(request),
    );
  }
}
