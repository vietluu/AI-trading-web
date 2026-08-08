import { Global, Module } from "@nestjs/common";

import { RedisService } from "./redis.service";
import { DistributedTaskLockService } from "./distributed-task-lock.service";

@Global()
@Module({
  providers: [RedisService, DistributedTaskLockService],
  exports: [RedisService, DistributedTaskLockService],
})
export class RedisModule {}
