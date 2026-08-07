import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { SessionModule } from '../../session/session.module';
import { PerformanceService } from './application/performance.service';
import { ReflectionService } from './application/reflection.service';
import { ReflectionSchedulerService } from './application/reflection-scheduler.service';
import { SelfLearningService } from './application/self-learning.service';
import { ReflectionRepository } from './infrastructure/reflection.repository';
import { ReflectionController } from './presentation/reflection.controller';

@Module({
  imports: [DatabaseModule, SessionModule],
  controllers: [ReflectionController],
  providers: [
    ReflectionRepository,
    PerformanceService,
    ReflectionService,
    ReflectionSchedulerService,
    SelfLearningService,
  ],
  exports: [PerformanceService, ReflectionService, SelfLearningService],
})
export class ReflectionModule {}
