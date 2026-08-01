import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../../../database/prisma.service';

@ApiTags('External Data - Security Incidents')
@Controller('external-data/incidents')
export class IncidentsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Get security incidents' })
  async getIncidents(
    @Query('severity') severity?: string,
    @Query('status') status?: string,
    @Query('symbol') symbol?: string,
    @Query('page') pageStr: string = '1',
    @Query('limit') limitStr: string = '20',
  ) {
    const page = Math.max(parseInt(pageStr, 10), 1);
    const limit = Math.min(Math.max(parseInt(limitStr, 10), 1), 100);

    const where: any = {};
    if (severity) where.severity = severity;
    if (status) where.status = status;
    if (symbol) where.relatedSymbols = { has: symbol.toUpperCase() };

    const total = await this.prisma.securityIncident.count({ where });
    const items = await this.prisma.securityIncident.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { firstReportedAt: 'desc' },
      include: { sourceReferences: true },
    });

    return {
      items: items.map((item) => ({
        id: item.id,
        title: item.title,
        summary: item.summary,
        incidentType: item.incidentType,
        severity: item.severity,
        status: item.status,
        verificationState: item.verificationState,
        relatedSymbols: item.relatedSymbols,
        relatedProtocols: item.relatedProtocols,
        firstReportedAt: item.firstReportedAt.toISOString(),
        lastUpdatedAt: item.lastUpdatedAt.toISOString(),
        canonicalUrl: item.canonicalUrl,
        importanceScore: item.importanceScore,
        sourcesCount: item.sourceReferences.length,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get security incident details by ID' })
  async getIncidentById(@Param('id') id: string) {
    const incident = await this.prisma.securityIncident.findUnique({
      where: { id },
      include: { sourceReferences: true },
    });
    if (!incident) {
      throw new NotFoundException(`Security incident ${id} not found`);
    }
    return {
      ...incident,
      firstReportedAt: incident.firstReportedAt.toISOString(),
      lastUpdatedAt: incident.lastUpdatedAt.toISOString(),
    };
  }
}
