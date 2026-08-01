import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../database/prisma.service';

@Injectable()
export class UserNewsStateService {
  constructor(private readonly prisma: PrismaService) {}

  async markRead(userId: string, articleId: string, isRead: boolean = true) {
    const article = await this.prisma.newsArticle.findUnique({ where: { id: articleId } });
    if (!article) {
      throw new NotFoundException(`Article ${articleId} not found`);
    }

    return this.prisma.userNewsState.upsert({
      where: {
        userId_articleId: { userId, articleId },
      },
      create: {
        userId,
        articleId,
        isRead,
        readAt: isRead ? new Date() : null,
      },
      update: {
        isRead,
        readAt: isRead ? new Date() : null,
      },
    });
  }

  async markSaved(userId: string, articleId: string, isSaved: boolean = true) {
    const article = await this.prisma.newsArticle.findUnique({ where: { id: articleId } });
    if (!article) {
      throw new NotFoundException(`Article ${articleId} not found`);
    }

    return this.prisma.userNewsState.upsert({
      where: {
        userId_articleId: { userId, articleId },
      },
      create: {
        userId,
        articleId,
        isSaved,
        savedAt: isSaved ? new Date() : null,
      },
      update: {
        isSaved,
        savedAt: isSaved ? new Date() : null,
      },
    });
  }

  async markHidden(userId: string, articleId: string, isHidden: boolean = true) {
    const article = await this.prisma.newsArticle.findUnique({ where: { id: articleId } });
    if (!article) {
      throw new NotFoundException(`Article ${articleId} not found`);
    }

    return this.prisma.userNewsState.upsert({
      where: {
        userId_articleId: { userId, articleId },
      },
      create: {
        userId,
        articleId,
        isHidden,
      },
      update: {
        isHidden,
      },
    });
  }

  async getUserPreferences(userId: string) {
    let pref = await this.prisma.userExternalDataPreference.findUnique({
      where: { userId },
    });

    if (!pref) {
      pref = await this.prisma.userExternalDataPreference.create({
        data: { userId },
      });
    }

    return pref;
  }

  async updateUserPreferences(userId: string, updates: Partial<{
    preferredLanguage: string;
    followedSymbols: string[];
    followedTopics: string[];
    hiddenSourceIds: string[];
    minImportanceScore: number;
    highImportanceAlertThreshold: number;
    macroCountries: string[];
    minMacroImportance: any;
    redditCommunities: string[];
    realtimeNewsEnabled: boolean;
    autoMarkRead: boolean;
  }>) {
    return this.prisma.userExternalDataPreference.upsert({
      where: { userId },
      create: {
        userId,
        ...updates,
      },
      update: {
        ...updates,
      },
    });
  }
}
