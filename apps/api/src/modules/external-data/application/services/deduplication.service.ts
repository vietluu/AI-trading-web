import { Injectable } from '@nestjs/common';

@Injectable()
export class DeduplicationService {
  private readonly stopWords = new Set([
    'a', 'an', 'the', 'and', 'or', 'but', 'is', 'if', 'then', 'else', 'when',
    'at', 'from', 'by', 'for', 'with', 'about', 'against', 'between', 'into',
    'through', 'during', 'before', 'after', 'above', 'below', 'to', 'in', 'on',
    'of', 'for', 'crypto', 'bitcoin', 'ethereum', 'news', 'update', 'report',
  ]);

  calculateJaccardSimilarity(textA: string, textB: string): number {
    const tokensA = this.tokenize(textA);
    const tokensB = this.tokenize(textB);

    if (tokensA.size === 0 || tokensB.size === 0) return 0;

    let intersectionSize = 0;
    for (const token of tokensA) {
      if (tokensB.has(token)) {
        intersectionSize++;
      }
    }

    const unionSize = new Set([...tokensA, ...tokensB]).size;
    return unionSize === 0 ? 0 : intersectionSize / unionSize;
  }

  calculateCosineSimilarity(textA: string, textB: string): number {
    const tfA = this.computeTermFrequency(textA);
    const tfB = this.computeTermFrequency(textB);

    const allTerms = new Set([...Object.keys(tfA), ...Object.keys(tfB)]);
    if (allTerms.size === 0) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (const term of allTerms) {
      const valA = tfA[term] || 0;
      const valB = tfB[term] || 0;
      dotProduct += valA * valB;
      normA += valA * valA;
      normB += valB * valB;
    }

    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  isNearDuplicate(
    titleA: string,
    titleB: string,
    threshold: number = 0.85,
  ): { isDuplicate: boolean; jaccardScore: number; cosineScore: number } {
    const jaccardScore = this.calculateJaccardSimilarity(titleA, titleB);
    const cosineScore = this.calculateCosineSimilarity(titleA, titleB);

    const maxScore = Math.max(jaccardScore, cosineScore);
    return {
      isDuplicate: maxScore >= threshold,
      jaccardScore,
      cosineScore,
    };
  }

  private tokenize(text: string): Set<string> {
    const tokens = new Set<string>();
    const cleaned = text.toLowerCase().replace(/[^\w\s]/g, ' ');
    const parts = cleaned.split(/\s+/);

    for (const part of parts) {
      if (part.length > 2 && !this.stopWords.has(part)) {
        tokens.add(part);
      }
    }
    return tokens;
  }

  private computeTermFrequency(text: string): Record<string, number> {
    const tf: Record<string, number> = {};
    const cleaned = text.toLowerCase().replace(/[^\w\s]/g, ' ');
    const parts = cleaned.split(/\s+/);

    let count = 0;
    for (const part of parts) {
      if (part.length > 2 && !this.stopWords.has(part)) {
        tf[part] = (tf[part] || 0) + 1;
        count++;
      }
    }

    if (count > 0) {
      for (const term of Object.keys(tf)) {
        const val = tf[term];
        if (val != null) {
          tf[term] = val / count;
        }
      }
    }

    return tf;
  }
}
