import { Body, Controller, Get, Put, Req, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiTags } from "@nestjs/swagger";

import {
  type AuthenticatedRequest,
  requestMetadata,
} from "../common/request-context";
import { SessionGuard } from "../session/session.guard";
import { SessionService } from "../session/session.service";
import { UpdateSettingsDto } from "./settings.dto";
import { SettingsService } from "./settings.service";

@ApiTags("settings")
@ApiCookieAuth(SessionService.cookieName)
@UseGuards(SessionGuard)
@Controller("settings")
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  get(@Req() request: AuthenticatedRequest) {
    return this.settings.get(request.auth.userId);
  }

  @Put()
  update(@Body() dto: UpdateSettingsDto, @Req() request: AuthenticatedRequest) {
    return this.settings.update(
      request.auth.userId,
      dto,
      requestMetadata(request),
    );
  }
}
