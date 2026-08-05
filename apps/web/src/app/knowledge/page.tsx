"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n/i18n-context";
import { BookOpen, Lock, Inbox } from "lucide-react";

interface ArchiveItem {
  id: string;
  title: string;
  category: string;
  summary: string;
  reproducibleHash: string;
  createdAt: string;
}

export default function KnowledgePage() {
  const { t } = useTranslation();
  const [archives, setArchives] = useState<ArchiveItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadKnowledge() {
      try {
        const data = await apiRequest<ArchiveItem[]>("/quant-intelligence/knowledge");
        setArchives(data);
      } catch {
        setArchives([]);
      } finally {
        setLoading(false);
      }
    }
    void loadKnowledge();
  }, []);

  if (loading) return <div className="p-8 text-center text-muted-foreground">{t.common.loading}</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-border pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <BookOpen className="h-6 w-6 text-primary" /> {t.quant.knowledgeTitle}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t.quant.knowledgeSubtitle}
          </p>
        </div>
      </div>

      {archives.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-12 text-center text-muted-foreground space-y-3">
          <Inbox className="h-10 w-10 mx-auto text-muted-foreground/50" />
          <h3 className="font-semibold text-lg text-foreground">{t.quant.noKnowledge}</h3>
          <p className="text-sm max-w-md mx-auto">{t.quant.noKnowledgeDesc}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {archives.map((item) => (
            <div key={item.id} className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold px-2 py-0.5 rounded bg-primary/10 text-primary">{item.category}</span>
                <span className="text-xs text-muted-foreground font-mono flex items-center gap-1">
                  <Lock className="h-3 w-3" /> Hash: {item.reproducibleHash.slice(0, 16)}...
                </span>
              </div>
              <h3 className="text-base font-bold">{item.title}</h3>
              <p className="text-sm text-muted-foreground">{item.summary}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
