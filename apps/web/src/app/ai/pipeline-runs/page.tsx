"use client";

import Link from "next/link";
import { ROUTES } from "@/constants/routes";
import { usePipelineRuns } from "@/hooks/ai/useAiFeature";

type PipelineRunListItem = {
  id: string;
  symbol: string;
  provider: string;
  status: string;
  decision?: string;
  confidence?: number;
  trigger: string;
  durationMs?: number;
  createdAt: string;
};

export default function PipelineRunsPage() {
  const query = usePipelineRuns();
  const runs = (query.data?.data ?? []) as PipelineRunListItem[];
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Pipeline runs</h1>
          <p className="mt-1 text-muted-foreground">
            End-to-end runtime history and outcomes.
          </p>
        </div>
       <button className="rounded h-8 bg-primary px-4  font-medium text-primary-foreground hover:bg-primary/90">
         <Link
          className="text-nowrap h-fit"
          href={ROUTES.ai.pipeline}
        >
          Automation
        </Link>
       </button>
      </div>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-muted text-xs uppercase text-muted-foreground">
            <tr>
              {[
                "Run",
                "Status",
                "Decision",
                "Confidence score",
                "Trigger",
                "Duration",
                "Created",
              ].map((h) => (
                <th className="p-3" key={h}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {runs.map((run) => (
              <tr key={run.id} className="hover:bg-muted/40">
                <td className="p-3">
                  <Link
                    className="font-mono text-primary hover:underline"
                    href={`/ai/pipeline-runs/${run.id}`}
                  >
                    {run.id.slice(0, 8)}
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    {run.symbol} · {run.provider}
                  </div>
                </td>
                <td className="p-3 font-semibold">{run.status}</td>
                <td className="p-3">{run.decision ?? "—"}</td>
                <td className="p-3">
                  {run.confidence == null ? "—" : `${run.confidence}/100`}
                </td>
                <td className="p-3">{run.trigger}</td>
                <td className="p-3">
                  {run.durationMs == null ? "—" : `${run.durationMs}ms`}
                </td>
                <td className="p-3 text-muted-foreground">
                  {new Date(run.createdAt).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!runs.length && (
          <p className="p-8 text-center text-muted-foreground">
            No pipeline runs yet.
          </p>
        )}
      </div>
    </div>
  );
}
