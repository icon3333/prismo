"use client";

import Link from "next/link";
import { useOverview } from "@/hooks/use-overview";
import { SensitiveValue } from "@/components/domain/anonymous-mode";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertTriangle,
  CheckCircle2,
  Wrench,
  ShieldAlert,
  ArrowRight,
} from "lucide-react";
import type { Violation } from "@/types/overview";
import { eur } from "@/lib/format";

function HealthIcon({ status }: { status: string }) {
  switch (status) {
    case "check":
      return <CheckCircle2 className="h-8 w-8 text-emerald-500" />;
    case "warning":
      return <AlertTriangle className="h-8 w-8 text-amber-500" />;
    case "alert":
      return <ShieldAlert className="h-8 w-8 text-coral-500" />;
    default:
      return <Wrench className="h-8 w-8 text-pearl-400" />;
  }
}

function ViolationGauge({
  title,
  violations,
  hasRule,
}: {
  title: string;
  violations: Violation[];
  hasRule: boolean;
}) {
  const count = violations.length;
  return (
    <div className="border border-border bg-card p-5">
      <p className="text-sm font-semibold text-muted-foreground mb-3">
        {title}
      </p>
      <div className="flex justify-center mb-2">
        <div
          className={`flex h-20 w-20 items-center justify-center rounded-full text-3xl font-bold font-mono text-white ${
            !hasRule
              ? "bg-muted text-muted-foreground"
              : count > 0
                ? "bg-destructive"
                : "bg-emerald-500"
          }`}
        >
          {hasRule ? count : "—"}
        </div>
      </div>
      <p className="text-center text-xs text-muted-foreground">
        {!hasRule
          ? "no rules set"
          : count === 0
            ? "all within limits"
            : ""}
      </p>
      {hasRule && violations.length > 0 && (
        <div className="mt-3 max-h-48 space-y-0 overflow-y-auto">
          {violations.map((v) => (
            <div
              key={v.name}
              className="flex items-center justify-between border-b border-border py-2 text-sm"
            >
              <span className="truncate mr-2">{v.name}</span>
              <span className="shrink-0 font-semibold font-mono text-destructive">
                +{(v.currentPercentage - v.maxPercentage).toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function OverviewPage() {
  const {
    metrics,
    portfolios,
    isLoading,
    dataLoading,
    error,
    healthStatus,
    missingPositions,
    stockViolations,
    sectorViolations,
    countryViolations,
    rules,
  } = useOverview();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Overview</h1>
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Overview</h1>
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Overview</h1>

      {/* Dashboard header */}
      <div className="border border-border bg-card p-6">
        <h2 className="text-xl font-bold">Welcome</h2>
        <p className="text-sm text-muted-foreground">
          Your portfolio at a glance
        </p>

        {/* Metric pills */}
        <div className="mt-4 grid grid-cols-3 gap-3">
          <div className="bg-muted p-4 text-center">
            <div className="text-lg font-bold font-mono">
              <SensitiveValue>
                {metrics ? eur(metrics.total_value) : "—"}
              </SensitiveValue>
            </div>
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Total Value
            </div>
          </div>
          <div className="bg-muted p-4 text-center">
            <div className="text-lg font-bold font-mono">
              {portfolios.length}
            </div>
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Portfolios
            </div>
          </div>
          <div className="bg-muted p-4 text-center">
            <div className="text-lg font-bold font-mono">
              {metrics?.total_items ?? 0}
            </div>
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Assets
            </div>
          </div>
        </div>
      </div>

      {/* Missing Positions */}
      {dataLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        missingPositions.length > 0 && (
          <div className="border border-border bg-card p-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold">Stocks Missing</h2>
              <Link
                href="/builder"
                className="inline-flex items-center gap-1 text-sm text-aqua-500 hover:text-aqua-400"
              >
                Go to Builder <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
            <p className="text-sm text-muted-foreground mb-3">
              Some portfolios need more positions to meet their allocation
              requirements.
            </p>
            <div className="flex flex-wrap gap-3">
              {missingPositions.map((p) => (
                <div
                  key={p.name}
                  className="flex-1 min-w-[260px] border-l-4 border-l-coral-500 bg-coral-500/10 p-4"
                >
                  <p className="font-semibold">{p.name}</p>
                  <p className="text-sm text-muted-foreground">
                    <span className="font-semibold">{p.missing_count}</span>{" "}
                    position{p.missing_count !== 1 ? "s" : ""} missing (
                    {p.current_positions}/{p.effective_positions} filled)
                  </p>
                </div>
              ))}
            </div>
          </div>
        )
      )}

      {/* Concentrations */}
      {dataLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-20 w-full" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Skeleton className="h-48" />
            <Skeleton className="h-48" />
            <Skeleton className="h-48" />
          </div>
        </div>
      ) : (
        <div className="border border-border bg-card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Concentrations</h2>
            <Link
              href="/concentrations"
              className="inline-flex items-center gap-1 text-sm text-aqua-500 hover:text-aqua-400"
            >
              View Details <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          {/* Health card */}
          <div className="flex items-center gap-3 border border-border bg-muted p-4 mb-4">
            <HealthIcon status={healthStatus.icon} />
            <div>
              <p className="font-semibold">{healthStatus.title}</p>
              <p className="text-sm text-muted-foreground">
                {healthStatus.subtitle}
              </p>
            </div>
          </div>

          {/* Gauge cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <ViolationGauge
              title="Stock Violations"
              violations={stockViolations}
              hasRule={!!rules?.maxPerStock && rules.maxPerStock > 0}
            />
            <ViolationGauge
              title="Sector Violations"
              violations={sectorViolations}
              hasRule={!!rules?.maxPerSector && rules.maxPerSector > 0}
            />
            <ViolationGauge
              title="Country Violations"
              violations={countryViolations}
              hasRule={!!rules?.maxPerCountry && rules.maxPerCountry > 0}
            />
          </div>
        </div>
      )}
    </div>
  );
}
