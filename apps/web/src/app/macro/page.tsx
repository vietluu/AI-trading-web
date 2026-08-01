"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AccountNav } from "@/components/account-nav";
import { apiRequest } from "@/lib/api-client";

interface MacroEvent {
  id: string;
  name: string;
  country?: string;
  currency?: string;
  category: string;
  importance: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  scheduledAt: string;
  actual?: string;
  forecast?: string;
  previous?: string;
  unit?: string;
  status: string;
  sourceUrl?: string;
}

interface MacroPreviewResult {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  previewItems: Record<string, unknown>[];
  errors: { row: number; message: string }[];
}

export default function MacroPage() {
  const queryClient = useQueryClient();
  const [importanceFilter, setImportanceFilter] = useState<string>("");
  const [categoryFilter, setCategoryFilter] = useState<string>("");

  // Import Modal State
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [fileContent, setFileContent] = useState("");
  const [fileFormat, setFileFormat] = useState<"csv" | "json">("csv");
  const [previewResult, setPreviewResult] = useState<MacroPreviewResult | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["macro-events", importanceFilter, categoryFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (importanceFilter) params.set("importance", importanceFilter);
      if (categoryFilter) params.set("category", categoryFilter);
      return apiRequest<{ items: MacroEvent[]; pagination: unknown }>(
        `/external-data/macro/events?${params.toString()}`,
      );
    },
  });

  const previewMutation = useMutation({
    mutationFn: async () => {
      return apiRequest<MacroPreviewResult>("/external-data/macro/import/preview", {
        method: "POST",
        body: JSON.stringify({ fileContent, fileFormat }),
      });
    },
    onSuccess: (res) => {
      setPreviewResult(res);
    },
  });

  const confirmMutation = useMutation({
    mutationFn: async () => {
      if (!previewResult) return;
      return apiRequest<unknown>("/external-data/macro/import", {
        method: "POST",
        body: JSON.stringify({
          fileName: `manual_import.${fileFormat}`,
          fileFormat,
          items: previewResult.previewItems,
        }),
      });
    },
    onSuccess: () => {
      setIsImportOpen(false);
      setPreviewResult(null);
      setFileContent("");
      void queryClient.invalidateQueries({ queryKey: ["macro-events"] });
    },
  });

  return (
    <div className="container mx-auto max-w-6xl p-6">
      <AccountNav />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Economic Calendar & Macro Data</h1>
          <p className="text-sm text-muted-foreground">
            Macroeconomic events (CPI, FOMC, GDP, Interest Rates) with scheduled release times and actual metrics.
          </p>
        </div>

        <button
          onClick={() => setIsImportOpen(true)}
          className="rounded-md bg-primary px-3.5 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          + Import Macro File (CSV/JSON)
        </button>
      </div>

      {/* Filter Bar */}
      <div className="mb-6 rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Importance</label>
            <select
              value={importanceFilter}
              onChange={(e) => setImportanceFilter(e.target.value)}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-xs focus:outline-none"
            >
              <option value="">All Importance Levels</option>
              <option value="CRITICAL">Critical</option>
              <option value="HIGH">High</option>
              <option value="MEDIUM">Medium</option>
              <option value="LOW">Low</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Category</label>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-xs focus:outline-none"
            >
              <option value="">All Categories</option>
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
        <div className="py-12 text-center text-sm text-muted-foreground">Loading economic calendar events...</div>
      ) : isError ? (
        <div className="py-12 text-center text-sm text-red-400">Failed to load macro events.</div>
      ) : !data?.items || data.items.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">No macroeconomic events found. Use manual import to add events.</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-border bg-muted/50 text-muted-foreground">
              <tr>
                <th className="p-3 font-semibold">Date & Time (UTC)</th>
                <th className="p-3 font-semibold">Country</th>
                <th className="p-3 font-semibold">Event Name</th>
                <th className="p-3 font-semibold">Importance</th>
                <th className="p-3 font-semibold">Actual</th>
                <th className="p-3 font-semibold">Forecast</th>
                <th className="p-3 font-semibold">Previous</th>
                <th className="p-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.items.map((event) => (
                <tr key={event.id} className="hover:bg-muted/30">
                  <td className="p-3 font-mono text-muted-foreground">
                    {new Date(event.scheduledAt).toLocaleString()}
                  </td>
                  <td className="p-3 font-semibold">{event.country || "GLOBAL"}</td>
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
            <h2 className="text-lg font-bold tracking-tight mb-2">Import Macroeconomic Events</h2>
            <p className="text-xs text-muted-foreground mb-4">
              Paste CSV or JSON content containing macroeconomic event schedules.
            </p>

            <div className="mb-4 flex items-center gap-4">
              <label className="text-xs font-medium">Format:</label>
              <select
                value={fileFormat}
                onChange={(e) => setFileFormat(e.target.value as "csv" | "json")}
                className="rounded-md border border-border bg-background px-3 py-1 text-xs"
              >
                <option value="csv">CSV Format</option>
                <option value="json">JSON Format</option>
              </select>
            </div>

            <textarea
              rows={8}
              placeholder={
                fileFormat === "csv"
                  ? "name,country,category,importance,scheduledAt,actual,forecast,previous\nUS CPI YoY,US,CPI,HIGH,2026-08-10T12:30:00Z,3.2%,3.1%,3.4%"
                  : '[\n  {\n    "name": "US CPI YoY",\n    "country": "US",\n    "importance": "HIGH",\n    "scheduledAt": "2026-08-10T12:30:00Z"\n  }\n]'
              }
              value={fileContent}
              onChange={(e) => setFileContent(e.target.value)}
              className="w-full rounded-md border border-border bg-background p-3 font-mono text-xs focus:outline-none mb-4"
            />

            {previewResult && (
              <div className="mb-4 rounded-md bg-muted/40 p-3 text-xs">
                <div className="flex gap-4 font-medium mb-2">
                  <span>Total Rows: {previewResult.totalRows}</span>
                  <span className="text-emerald-400">Valid: {previewResult.validRows}</span>
                  <span className="text-red-400">Invalid: {previewResult.invalidRows}</span>
                </div>
                {previewResult.errors.length > 0 && (
                  <div className="text-red-400 text-[11px] space-y-1">
                    {previewResult.errors.map((err, idx) => (
                      <div key={idx}>Row {err.row}: {err.message}</div>
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
                Cancel
              </button>

              {!previewResult ? (
                <button
                  disabled={!fileContent.trim() || previewMutation.isPending}
                  onClick={() => { previewMutation.mutate(); }}
                  className="rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {previewMutation.isPending ? "Validating..." : "Preview Import"}
                </button>
              ) : (
                <button
                  disabled={previewResult.validRows === 0 || confirmMutation.isPending}
                  onClick={() => { confirmMutation.mutate(); }}
                  className="rounded-md bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  {confirmMutation.isPending ? "Importing..." : `Confirm Import (${previewResult.validRows} rows)`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
