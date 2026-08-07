import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { OkxPublicStreamAdapter } from './infrastructure/streams/okx-public-stream.adapter';

@Module({
  imports: [ConfigModule],
  providers: [OkxPublicStreamAdapter],
  exports: [OkxPublicStreamAdapter],
})
export class MarketStreamsModule {}
