"use client";

import { useState } from "react";
import { AccountNav } from "@/components/account-nav";
import { useMacroEvents } from "@/hooks/settings/useSettings";
import { useTranslation } from "@/lib/i18n/i18n-context";

interface PreviewResultState {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  previewItems: Array<Record<string, unknown>>;
  errors: Array<{ row: number; message: string }>;
}

export default function MacroPage() {
  const { t } = useTranslation();
  const [importanceFilter, setImportanceFilter] = useState<string>("");
  const [categoryFilter, setCategoryFilter] = useState<string>("");

  // Import Modal State
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [fileContent, setFileContent] = useState("");
  const [fileFormat, setFileFormat] = useState<"csv" | "json">("csv");
  const [previewResult, setPreviewResult] = useState<PreviewResultState | null>(null);

  const { query, previewMutation, confirmMutation } = useMacroEvents(importanceFilter, categoryFilter);
  const { data, isLoading, isError } = query;

  return (
    <div className="container mx-auto max-w-6xl">
      <AccountNav />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t.macro.title}</h1>
          <p className="text-sm text-muted-foreground">{t.macro.subtitle}</p>
        </div>

        <button
          onClick={() => setIsImportOpen(true)}
          className="rounded-md bg-primary px-3.5 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          {t.macro.importButton}
        </button>
      </div>

      {/* Filter Bar */}
      <div className="mb-6 rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">{t.macro.importance}</label>
            <select
              value={importanceFilter}
              onChange={(e) => setImportanceFilter(e.target.value)}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-xs focus:outline-none"
            >
              <option value="">{t.macro.allImportance}</option>
              <option value="CRITICAL">Critical</option>
              <option value="HIGH">High</option>
              <option value="MEDIUM">Medium</option>
              <option value="LOW">Low</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">{t.macro.category}</label>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-xs focus:outline-none"
            >
              <option value="">{t.macro.allCategories}</option>
              <option value="CPI">CPI (Inflation)</option>
              <option value="FOMC">FOMC / Fed</option>
              <option value="INTEREST_RATE_DECISION">Interest Rate</option>
              <option value="GDP">GDP</option>
              <option value="UNEMPLOYMENT">Unemployment</option>
              <option value="NONFARM_PAYROLLS">Nonfarm Payrolls</option>
            </select>
          </div>
        </div>
      </div>

      {/* Macro Events Table */}
      {isLoading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">{t.macro.loading}</div>
      ) : isError ? (
        <div className="py-12 text-center text-sm text-red-400">{t.macro.error}</div>
      ) : !data?.items || data.items.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">{t.macro.empty}</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-border bg-muted/50 text-muted-foreground">
              <tr>
                <th className="p-3 font-semibold">{t.macro.dateTimeUtc}</th>
                <th className="p-3 font-semibold">{t.macro.country}</th>
                <th className="p-3 font-semibold">{t.macro.eventName}</th>
                <th className="p-3 font-semibold">{t.macro.importance}</th>
                <th className="p-3 font-semibold">{t.macro.actual}</th>
                <th className="p-3 font-semibold">{t.macro.forecast}</th>
                <th className="p-3 font-semibold">{t.macro.previous}</th>
                <th className="p-3 font-semibold">{t.macro.status}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.items.map((event) => (
                <tr key={event.id} className="hover:bg-muted/30">
                  <td className="p-3 font-mono text-muted-foreground">
                    {new Date(event.scheduledAt).toLocaleString()}
                  </td>
                  <td className="p-3 font-semibold">{event.country || t.macro.global}</td>
                  <td className="p-3 font-medium text-foreground">{event.name}</td>
                  <td className="p-3">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                        event.importance === "CRITICAL"
                          ? "bg-red-500/20 text-red-400 border border-red-500/30"
                          : event.importance === "HIGH"
                          ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                          : "bg-blue-500/10 text-blue-400"
                      }`}
                    >
                      {event.importance}
                    </span>
                  </td>
                  <td className="p-3 font-mono font-semibold text-emerald-400">{event.actual || "-"}</td>
                  <td className="p-3 font-mono text-muted-foreground">{event.forecast || "-"}</td>
                  <td className="p-3 font-mono text-muted-foreground">{event.previous || "-"}</td>
                  <td className="p-3 font-medium text-muted-foreground">{event.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Manual Import Modal */}
      {isImportOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-2xl rounded-lg border border-border bg-card p-6 shadow-xl">
            <h2 className="text-lg font-bold tracking-tight mb-2">{t.macro.importModalTitle}</h2>
            <p className="text-xs text-muted-foreground mb-4">{t.macro.importModalSubtitle}</p>

            <div className="mb-4 flex items-center gap-4">
              <label className="text-xs font-medium">{t.macro.formatLabel}</label>
              <select
                value={fileFormat}
                onChange={(e) => setFileFormat(e.target.value as "csv" | "json")}
                className="rounded-md border border-border bg-background px-3 py-1 text-xs"
              >
                <option value="csv">{t.macro.csvFormat}</option>
                <option value="json">{t.macro.jsonFormat}</option>
              </select>
            </div>

            <textarea
              rows={8}
              placeholder={
                fileFormat === "csv"
                  ? t.macro.csvExample
                  : t.macro.jsonExample
              }
              value={fileContent}
              onChange={(e) => setFileContent(e.target.value)}
              className="w-full rounded-md border border-border bg-background p-3 font-mono text-xs focus:outline-none mb-4"
            />

            {previewResult && (
              <div className="mb-4 rounded-md bg-muted/40 p-3 text-xs">
                <div className="flex gap-4 font-medium mb-2">
                  <span>{t.macro.totalRows}: {previewResult.totalRows}</span>
                  <span className="text-emerald-400">{t.macro.valid}: {previewResult.validRows}</span>
                  <span className="text-red-400">{t.macro.invalid}: {previewResult.invalidRows}</span>
                </div>
                {previewResult.errors.length > 0 && (
                  <div className="text-red-400 text-[11px] space-y-1">
                    {previewResult.errors.map((err, idx) => (
                      <div key={idx}>{t.macro.row} {err.row}: {err.message}</div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => {
                  setIsImportOpen(false);
                  setPreviewResult(null);
                }}
                className="rounded-md border border-border px-4 py-2 text-xs font-medium hover:bg-muted"
              >
                {t.common.cancel}
              </button>

              {!previewResult ? (
                <button
                  disabled={!fileContent.trim() || previewMutation.isPending}
                  onClick={() => { previewMutation.mutate({ fileContent, fileFormat }); }}
                  className="rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {previewMutation.isPending ? t.macro.validating : t.macro.previewImport}
                </button>
              ) : (
                <button
                  disabled={previewResult.validRows === 0 || confirmMutation.isPending}
                  onClick={() => { confirmMutation.mutate({ previewResult, fileFormat }); }}
                  className="rounded-md bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  {confirmMutation.isPending ? t.macro.importing : `${t.macro.confirmImport} (${previewResult.validRows} ${t.macro.row.toLowerCase()}${previewResult.validRows === 1 ? "" : "s"})`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
