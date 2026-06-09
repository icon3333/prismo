"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useOverview } from "@/hooks/use-overview";
import { SensitiveValue } from "@/components/domain/anonymous-mode";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { eur, int, pct } from "@/lib/format";
import type { Violation } from "@/types/overview";

function StatusMark({ status }: { status: string }) {
  const color =
    status === "check"
      ? "bg-green"
      : status === "warning"
        ? "bg-amber"
        : status === "alert"
          ? "bg-red"
          : "bg-ink-3";

  return (
    <span
      aria-hidden
      className={`inline-block h-2 w-2 border border-bg ${color}`}
    />
  );
}

function MetricCell({
  label,
  value,
  muted,
}: {
  label: string;
  value: ReactNode;
  muted?: ReactNode;
}) {
  return (
    <div className="border border-border bg-card p-4">
      <div className="font-mono text-chrome uppercase text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 text-xl font-semibold tracking-normal text-foreground">
        {value}
      </div>
      {muted && (
        <div className="mt-1 font-mono text-chrome uppercase text-ink-3">
          {muted}
        </div>
      )}
    </div>
  );
}

function ViolationPanel({
  title,
  violations,
  hasRule,
}: {
  title: string;
  violations: Violation[];
  hasRule: boolean;
}) {
  const state = !hasRule
    ? "UNSET"
    : violations.length > 0
      ? "BREACH"
      : "CLEAR";
  const stateClass =
    state === "CLEAR"
      ? "text-green"
      : state === "BREACH"
        ? "text-red"
        : "text-ink-3";

  return (
    <section className="border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="font-mono text-xs font-semibold uppercase text-foreground">
          {title}
        </h3>
        <span className={`font-mono text-xs font-semibold ${stateClass}`}>
          {state}
        </span>
      </div>
      <div className="divide-y divide-border">
        {!hasRule ? (
          <div className="px-4 py-5 text-sm text-muted-foreground">
            Rule not configured.
          </div>
        ) : violations.length === 0 ? (
          <div className="px-4 py-5 text-sm text-muted-foreground">
            No concentration exceptions.
          </div>
        ) : (
          violations.slice(0, 5).map((violation) => {
            const overage =
              violation.currentPercentage - violation.maxPercentage;
            return (
              <div
                key={`${violation.type}-${violation.name}`}
                className="grid grid-cols-[1fr_auto] gap-4 px-4 py-3 text-sm"
              >
                <span className="truncate text-foreground">
                  {violation.name}
                </span>
                <span className="font-mono font-semibold text-red">
                  +{pct(overage)}
                </span>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

export default function OverviewPage() {
  const {
    metrics,
    portfolios,
    cashBalance,
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
        <h1 className="text-title font-bold">
          Portfolio Status
        </h1>
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <h1 className="text-title font-bold">
          Portfolio Status
        </h1>
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const holdingsValue = metrics?.total_value ?? 0;
  const totalExposure = holdingsValue + cashBalance;
  const totalViolations =
    stockViolations.length + sectorViolations.length + countryViolations.length;

  return (
    <div className="space-y-6">
      <header className="border border-border bg-card">
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <div className="font-mono text-chrome uppercase text-muted-foreground">
              OPERATOR OVERVIEW
            </div>
            <h1 className="mt-1 text-title font-bold">
              Portfolio Status
            </h1>
          </div>
          <div className="flex items-center gap-2 border border-border bg-bg px-3 py-2 font-mono text-xs uppercase">
            <StatusMark status={healthStatus.icon} />
            <span>{healthStatus.title}</span>
          </div>
        </div>
        <div className="grid gap-px bg-border md:grid-cols-4">
          <MetricCell
            label="Total Exposure"
            value={
              <SensitiveValue>{eur(totalExposure)}</SensitiveValue>
            }
            muted={
              <>
                <SensitiveValue>{eur(holdingsValue)}</SensitiveValue> holdings
              </>
            }
          />
          <MetricCell
            label="Cash"
            value={<SensitiveValue>{eur(cashBalance)}</SensitiveValue>}
          />
          <MetricCell
            label="Portfolios"
            value={<span className="font-mono">{int(portfolios.length)}</span>}
          />
          <MetricCell
            label="Positions"
            value={<span className="font-mono">{int(metrics?.total_items ?? 0)}</span>}
            muted={`${int(metrics?.missing_prices ?? 0)} missing prices`}
          />
        </div>
      </header>

      {dataLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        missingPositions.length > 0 && (
          <section className="border border-red bg-red/10">
            <div className="flex items-center justify-between gap-4 border-b border-red/40 px-5 py-4">
              <div>
                <h2 className="font-mono text-sm font-semibold uppercase text-red">
                  BUILDER POSITIONS REQUIRED
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {int(missingPositions.length)} portfolio allocation plan
                  {missingPositions.length === 1 ? " needs" : "s need"} more
                  positions.
                </p>
              </div>
              <Link
                href="/builder"
                className="border border-red px-3 py-2 font-mono text-xs uppercase text-red hover:bg-red/10"
              >
                Open Builder
              </Link>
            </div>
            <div className="divide-y divide-red/30">
              {missingPositions.map((portfolio) => (
                <div
                  key={portfolio.name}
                  className="grid gap-2 px-5 py-3 text-sm md:grid-cols-[1fr_auto]"
                >
                  <span className="font-medium text-foreground">
                    {portfolio.name}
                  </span>
                  <span className="font-mono text-red">
                    {int(portfolio.missing_count)} missing |{" "}
                    {int(portfolio.current_positions)}/
                    {int(portfolio.effective_positions)} filled
                  </span>
                </div>
              ))}
            </div>
          </section>
        )
      )}

      {dataLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-20 w-full" />
          <div className="grid gap-4 md:grid-cols-3">
            <Skeleton className="h-48" />
            <Skeleton className="h-48" />
            <Skeleton className="h-48" />
          </div>
        </div>
      ) : (
        <section className="border border-border bg-card">
          <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
            <div>
              <h2 className="font-mono text-sm font-semibold uppercase">
                CONCENTRATION WATCH
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {healthStatus.subtitle}. {int(totalViolations)} active exception
                {totalViolations === 1 ? "" : "s"}.
              </p>
            </div>
            <Link
              href="/concentrations"
              className="border border-border px-3 py-2 font-mono text-xs uppercase text-cyan hover:bg-cyan/10"
            >
              View Details
            </Link>
          </div>
          <div className="grid gap-px bg-border md:grid-cols-3">
            <ViolationPanel
              title="Stock Limits"
              violations={stockViolations}
              hasRule={!!rules?.maxPerStock && rules.maxPerStock > 0}
            />
            <ViolationPanel
              title="Sector Limits"
              violations={sectorViolations}
              hasRule={!!rules?.maxPerSector && rules.maxPerSector > 0}
            />
            <ViolationPanel
              title="Country Limits"
              violations={countryViolations}
              hasRule={!!rules?.maxPerCountry && rules.maxPerCountry > 0}
            />
          </div>
        </section>
      )}
    </div>
  );
}
