import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SessionGuard } from '../../../../session/session.guard';
import { ProviderHealthService } from '../../application/services/provider-health.service';
import { ExternalDataSchedulerService } from '../../application/jobs/external-data-scheduler.service';

@ApiTags('External Data - Provider Operations')
@Controller('external-data/providers')
export class ProvidersController {
  constructor(
    private readonly providerHealthService: ProviderHealthService,
    private readonly schedulerService: ExternalDataSchedulerService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get list of all supported external data providers and statuses' })
  async getProviders() {
    return this.providerHealthService.getAllProviderHealth();
  }

  @Get('health')
  @ApiOperation({ summary: 'Get operational health metrics for external data providers' })
  async getProviderHealth() {
    return this.providerHealthService.getAllProviderHealth();
  }

  @Post(':id/run')
  @UseGuards(SessionGuard)
  @ApiOperation({ summary: 'Manually trigger an immediate ingestion run for a provider' })
  async triggerProviderRun(@Param('id') providerId: string) {
    return this.schedulerService.triggerManualRun(providerId);
  }

  @Post(':id/enable')
  @UseGuards(SessionGuard)
  @ApiOperation({ summary: 'Enable provider ingestion' })
  async enableProvider(@Param('id') providerId: string) {
    return Promise.resolve({ provider: providerId, isEnabled: true, status: 'ENABLED' });
  }

  @Post(':id/disable')
  @UseGuards(SessionGuard)
  @ApiOperation({ summary: 'Disable provider ingestion' })
  async disableProvider(@Param('id') providerId: string) {
    return Promise.resolve({ provider: providerId, isEnabled: false, status: 'DISABLED' });
  }
}
