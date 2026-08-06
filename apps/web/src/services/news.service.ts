import { API_ENDPOINTS } from "@/constants/api-endpoints";
import { apiRequest } from "@/lib/api-client";

export interface NewsItem {
  id: string;
  sourceId: string;
  title: string;
  summary?: string;
  canonicalUrl: string;
  publishedAt: string;
  reliabilityScore: number;
  importanceScore: number;
  duplicateCount: number;
  symbols: string[];
  topics: string[];
  userState?: {
    isRead: boolean;
    isSaved: boolean;
    isHidden: boolean;
  };
}

export interface NewsFeedResponse {
  items: NewsItem[];
  pagination: unknown;
}

export interface NewsDetail {
  id: string;
  sourceId: string;
  title: string;
  summary?: string;
  excerpt?: string;
  canonicalUrl: string;
  originalUrl?: string;
  author?: string;
  language?: string;
  publishedAt: string;
  reliabilityScore: number;
  importanceScore: number;
  symbols: string[];
  topics: string[];
  entities: string[];
  sourceReferences: {
    id: string;
    sourceId: string;
    sourceName: string;
    publishedAt: string;
    canonicalUrl: string;
  }[];
  importanceReasons: string[];
}

export async function getNewsFeed(filters: { symbolFilter: string; minImportance: number; savedOnly: boolean; unreadOnly: boolean }) {
  const params = new URLSearchParams();
  if (filters.symbolFilter) params.set("symbol", filters.symbolFilter);
  if (filters.minImportance > 0) params.set("minImportance", filters.minImportance.toString());
  if (filters.savedOnly) params.set("saved", "true");
  if (filters.unreadOnly) params.set("unread", "true");
  return apiRequest<NewsFeedResponse>(`${API_ENDPOINTS.externalData.newsList}?${params.toString()}`);
}

export async function getNewsDetail(id: string) {
  return apiRequest<NewsDetail>(API_ENDPOINTS.externalData.newsDetail(id));
}

export async function saveNewsItem(id: string, isSaved: boolean) {
  return apiRequest(API_ENDPOINTS.externalData.newsSave(id), {
    method: "PATCH",
    body: JSON.stringify({ isSaved }),
  });
}

export async function markNewsItemRead(id: string, isRead: boolean) {
  return apiRequest(API_ENDPOINTS.externalData.newsRead(id), {
    method: "PATCH",
    body: JSON.stringify({ isRead }),
  });
}
