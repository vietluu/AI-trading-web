import { Global, Module } from "@nestjs/common";

import { SessionGuard } from "./session.guard";
import { SessionRepository } from "./session.repository";
import { SessionService } from "./session.service";

@Global()
@Module({
  providers: [SessionService, SessionGuard, SessionRepository],
  exports: [SessionService, SessionGuard],
})
export class SessionModule {}
