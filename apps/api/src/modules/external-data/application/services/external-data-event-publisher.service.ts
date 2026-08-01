import { Injectable, Logger } from '@nestjs/common';
import { ImportanceAssessment } from '../../domain/scoring/importance-scoring.types';

export interface ExternalDataEventPublisherGateway {
  broadcastToChannel(channel: string, event: string, data: any): void;
}

@Injectable()
export class ExternalDataEventPublisher {
  private readonly logger = new Logger(ExternalDataEventPublisher.name);
  private gateway?: ExternalDataEventPublisherGateway;

  setGateway(gateway: ExternalDataEventPublisherGateway) {
    this.gateway = gateway;
  }

  async publishNewsArticleCreated(
    article: any,
    assessment: ImportanceAssessment,
    symbols: string[],
    topics: string[],
  ) {
    const payload = {
      id: article.id,
      title: article.title,
      summary: article.summary,
      canonicalUrl: article.canonicalUrl,
      sourceId: article.sourceId,
      publishedAt: article.publishedAt.toISOString(),
      importanceScore: assessment.score,
      importanceLevel: assessment.level,
      symbols,
      topics,
    };

    if (this.gateway) {
      this.gateway.broadcastToChannel('news', 'NEWS_ARTICLE_CREATED', payload);

      if (assessment.score >= 70) {
        this.gateway.broadcastToChannel(
          'high-importance-news',
          'HIGH_IMPORTANCE_NEWS_DETECTED',
          payload,
        );
      }
    }
  }

  async publishExchangeAnnouncementCreated(announcement: any) {
    if (this.gateway) {
      this.gateway.broadcastToChannel('announcements', 'EXCHANGE_ANNOUNCEMENT_CREATED', {
        id: announcement.id,
        provider: announcement.provider,
        category: announcement.category,
        title: announcement.title,
        canonicalUrl: announcement.canonicalUrl,
        publishedAt: announcement.publishedAt.toISOString(),
        relatedSymbols: announcement.relatedSymbols,
        importanceScore: announcement.importanceScore,
      });
    }
  }

  async publishSecurityIncidentCreated(incident: any) {
    if (this.gateway) {
      this.gateway.broadcastToChannel('security-incidents', 'SECURITY_INCIDENT_CREATED', {
        id: incident.id,
        title: incident.title,
        severity: incident.severity,
        incidentType: incident.incidentType,
        relatedSymbols: incident.relatedSymbols,
        importanceScore: incident.importanceScore,
        firstReportedAt: incident.firstReportedAt.toISOString(),
      });
    }
  }

  async publishSentimentUpdated(observation: any) {
    if (this.gateway) {
      this.gateway.broadcastToChannel('sentiment', 'SENTIMENT_INDEX_UPDATED', {
        id: observation.id,
        provider: observation.provider,
        indexType: observation.indexType,
        value: observation.value,
        classification: observation.classification,
        observedAt: observation.observedAt.toISOString(),
      });
    }
  }

  async publishMacroEventCreated(event: any) {
    if (this.gateway) {
      this.gateway.broadcastToChannel('macro', 'MACRO_EVENT_CREATED', {
        id: event.id,
        name: event.name,
        country: event.country,
        category: event.category,
        importance: event.importance,
        scheduledAt: event.scheduledAt.toISOString(),
        actual: event.actual,
        forecast: event.forecast,
        previous: event.previous,
      });
    }
  }
}
