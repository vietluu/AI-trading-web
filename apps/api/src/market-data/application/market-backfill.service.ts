import { Injectable, Logger } from '@nestjs/common';
import { MarketDataRepository } from '../infrastructure/persistence/market-data.repository';
import { MarketDataConfigService } from './market-data-config.service';
import { DataGapStatus } from '../domain/market-data.enums';

@Injectable()
export class MarketBackfillService {
  private readonly logger = new Logger(MarketBackfillService.name);
  private checkInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly repository: MarketDataRepository,
    private readonly configService: MarketDataConfigService,
  ) {}

  startGapDetection(checkIntervalMs: number = 3600000) {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
    
    // Initial check on startup
    setTimeout(() => {
      void this.detectGaps();
    }, 10000);

    // Periodic check
    this.checkInterval = setInterval(() => {
      void this.detectGaps();
    }, checkIntervalMs);
  }

  stopGapDetection() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  async detectGaps() {
    this.logger.log('Running gap detection for market data...');
    const config = this.configService.getConfig();

    if (!config.candles.enabled) return;

    for (const provider of config.providers) {
      for (const symbol of config.symbols) {
        for (const interval of config.intervals) {
          try {
            // We get the latest 500 candles to check for continuity
            const recentCandles = await this.repository.getCandles({
              provider,
              symbol,
              interval,
              limit: 500,
            });

            if (recentCandles.length < 2) continue;

            const intervalMs = this.intervalToMs(interval);
            
            for (let i = 1; i < recentCandles.length; i++) {
              const prev = recentCandles[i - 1];
              const curr = recentCandles[i];
              if (!prev || !curr) continue;
              
              const prevOpenTime = prev.openTime.getTime();
              const currOpenTime = curr.openTime.getTime();
              
              // If difference is greater than 1 interval, we have a gap
              if (currOpenTime - prevOpenTime > intervalMs) {
                const expectedNextOpen = new Date(prevOpenTime + intervalMs);
                const gapEnd = new Date(currOpenTime - intervalMs);
                
                // Record the gap in database for repair workers
                await this.repository.createGap({
                  provider,
                  symbol,
                  interval,
                  gapStart: expectedNextOpen,
                  gapEnd,
                  status: DataGapStatus.DETECTED,
                });
                
                this.logger.warn({
                  event: 'market_data_gap_detected',
                  provider,
                  symbol,
                  interval,
                  gapStart: expectedNextOpen.toISOString(),
                  gapEnd: gapEnd.toISOString(),
                });
              }
            }
          } catch (error) {
            this.logger.error({
              event: 'gap_detection_error',
              provider,
              symbol,
              interval,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }
    }
  }

  private intervalToMs(interval: string): number {
    const value = parseInt(interval, 10);
    if (interval.endsWith('m')) return value * 60 * 1000;
    if (interval.endsWith('h')) return value * 60 * 60 * 1000;
    if (interval.endsWith('d')) return value * 24 * 60 * 60 * 1000;
    if (interval.endsWith('w')) return value * 7 * 24 * 60 * 60 * 1000;
    return value * 60 * 1000;
  }
}
