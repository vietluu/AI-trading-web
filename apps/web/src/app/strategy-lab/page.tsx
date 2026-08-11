"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n/i18n-context";
import { Cpu, Play, Award, CheckCircle } from "lucide-react";

interface StrategyCandidate {
  key: string;
  name: string;
  kind: string;
  score: number;
  expectedValue: number;
  profitFactor: number;
  sharpeRatio: number;
  maxDrawdown: number;
}

interface SimulationResultData {
  name: string;
  experimentType: string;
  passedCriteria: boolean;
  baselineExpectedValue: number;
  simulatedExpectedValue: number;
  baselineSharpe: number;
  simulatedSharpe: number;
  summary: string;
}

export default function StrategyLabPage() {
  const { t } = useTranslation();
  const [strategies, setStrategies] = useState<StrategyCandidate[]>([]);
  const [simulationResult, setSimulationResult] = useState<SimulationResultData | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadData() {
      try {
        const strats = await apiRequest<StrategyCandidate[]>("/quant-intelligence/strategies");
        setStrategies(strats);
      } catch (cause) {
        setStrategies([]);
        setError(cause instanceof Error ? cause.message : "Verified strategy evidence is unavailable.");
      }
    }
    void loadData();
  }, []);

  async function handleRunSimulation() {
    setSimulating(true);
    try {
      const res = await apiRequest<SimulationResultData>("/quant-intelligence/simulation", {
        method: "POST",
        body: JSON.stringify({
          name: "Virtual Prompt & Threshold Test",
          experimentType: "THRESHOLD",
          symbol: "BTC-USDT",
          provider: "OKX_FUTURES",
          interval: "15m",
          lookbackCandles: 500,
          config: { strategyName: "HYBRID_QUANT", confidenceThreshold: 68, atrMultiplier: 1.8 },
        }),
      });
      setSimulationResult(res);
    } catch (cause) {
      setSimulationResult(null);
      setError(cause instanceof Error ? cause.message : "Historical simulation failed.");
    } finally {
      setSimulating(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-border pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Cpu className="h-6 w-6 text-primary" /> {t.quant.strategyLabTitle}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t.quant.strategyLabSubtitle}
          </p>
        </div>
        <button
          onClick={() => void handleRunSimulation()}
          disabled={simulating}
          className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          <Play className="h-4 w-4" /> {simulating ? t.quant.simulating : t.quant.runSimulation}
        </button>
      </div>

      {error && <div className="rounded-xl border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-200">{error}</div>}

      {simulationResult && (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5 space-y-2">
          <div className="flex items-center gap-2 font-bold text-emerald-500">
            <CheckCircle className="h-5 w-5" /> {t.quant.simulationResult}: {simulationResult.passedCriteria ? t.quant.passed : t.quant.failed}
          </div>
          <p className="text-sm font-medium">{simulationResult.summary}</p>
          <div className="flex gap-4 text-xs font-semibold pt-1">
            <span>EV: {simulationResult.baselineExpectedValue} → <strong className="text-emerald-500">+{simulationResult.simulatedExpectedValue}</strong></span>
            <span>Sharpe: {simulationResult.baselineSharpe} → <strong className="text-emerald-500">{simulationResult.simulatedSharpe}</strong></span>
          </div>
        </div>
      )}

      {/* Discovered Strategies */}
      <div className="rounded-2xl border border-border bg-card p-6 space-y-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Award className="h-5 w-5 text-primary" /> {t.quant.discoveredStrategyCandidates}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {strategies.map((s) => (
            <div key={s.key} className="rounded-xl border border-border p-4 space-y-2">
              <div className="flex justify-between items-center">
                <h3 className="font-bold">{s.name}</h3>
                <span className="text-xs font-bold text-primary px-2 py-0.5 rounded bg-primary/10">{t.quant.score}: {s.score}/100</span>
              </div>
              <div className="grid grid-cols-4 gap-2 text-center text-xs pt-1">
                <div><span className="text-muted-foreground">{t.quant.expectedValue}</span><p className="font-bold text-emerald-500">+{s.expectedValue}</p></div>
                <div><span className="text-muted-foreground">{t.quant.profitFactor}</span><p className="font-bold">{s.profitFactor}</p></div>
                <div><span className="text-muted-foreground">{t.quant.sharpe}</span><p className="font-bold">{s.sharpeRatio}</p></div>
                <div><span className="text-muted-foreground">{t.quant.maxDrawdown}</span><p className="font-bold text-rose-500">{s.maxDrawdown}%</p></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
