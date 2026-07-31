import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiCookieAuth, ApiTags } from "@nestjs/swagger";

import {
  type AuthenticatedRequest,
  requestMetadata,
} from "../common/request-context";
import { SessionGuard } from "../session/session.guard";
import { SessionService } from "../session/session.service";
import { CreateCredentialDto, UpdateCredentialDto } from "./credential.dto";
import { CredentialService } from "./credential.service";
import { SensitiveActionGuard } from "../auth/sensitive-action.guard";

@ApiTags("credentials")
@ApiCookieAuth(SessionService.cookieName)
@UseGuards(SessionGuard)
@Controller("credentials")
export class CredentialController {
  constructor(private readonly credentials: CredentialService) {}

  @Get()
  list(@Req() request: AuthenticatedRequest) {
    return this.credentials.list(request.auth.userId);
  }

  @Post()
  @UseGuards(SensitiveActionGuard)
  create(
    @Body() dto: CreateCredentialDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.credentials.create(
      request.auth.userId,
      dto,
      requestMetadata(request),
    );
  }

  @Put(":id")
  @UseGuards(SensitiveActionGuard)
  update(
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Body() dto: UpdateCredentialDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.credentials.update(
      request.auth.userId,
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
    return this.credentials.delete(
      request.auth.userId,
      id,
      requestMetadata(request),
    );
  }

  @Post(":id/test")
  test(
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.credentials.test(
      request.auth.userId,
      id,
      requestMetadata(request),
    );
  }
}
