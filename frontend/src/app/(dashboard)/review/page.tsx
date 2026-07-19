"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/shell/page-header";
import { useMonthlyReview } from "@/hooks/use-monthly-review";
import { firstUndecidedActionKey, groupReviewPresentation } from "@/lib/monthly-review-calc";
import { serializeReviewCsv } from "@/lib/monthly-review-export";
import type { MonthlyReview, ReviewAction, ReviewDecision } from "@/types/monthly-review";

const EUR = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" });
const NUMBER = new Intl.NumberFormat("en-IE", { maximumFractionDigits: 4 });

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border border-rule bg-bg-1" aria-labelledby={`section-${title.replaceAll(" ", "-")}`}>
      <h2 id={`section-${title.replaceAll(" ", "-")}`} className="border-b border-rule px-4 py-2 font-mono text-chrome uppercase tracking-[0.1em] text-ink-2">
        {title}
      </h2>
      <div className="p-4">{children}</div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="border-l border-rule pl-3">
      <dt className="font-mono text-micro uppercase tracking-[0.08em] text-ink-2">{label}</dt>
      <dd className="mt-1 font-mono text-data text-ink">{value}</dd>
    </div>
  );
}

function ActionCard({
  action,
  index,
  readOnly,
  saving,
  onSave,
}: {
  action: ReviewAction;
  index: number;
  readOnly: boolean;
  saving: boolean;
  onSave: (decision: Exclude<ReviewDecision, "undecided">, adjustedAmount?: number, note?: string) => Promise<unknown>;
}) {
  const [note, setNote] = useState(action.note ?? "");
  const [adjusted, setAdjusted] = useState(String(action.adjusted_amount ?? action.amount_eur));
  const decisions: Exclude<ReviewDecision, "undecided">[] = ["accepted", "adjusted", "deferred", "dismissed"];

  return (
    <article className="border border-rule-2 bg-bg-2 p-4" aria-labelledby={`action-title-${index}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id={`action-title-${index}`} className="font-semibold text-ink">{action.security}</h3>
          <p className="font-mono text-chrome uppercase text-ink-2">
            {action.side} · {action.portfolio}{action.identifier ? ` · ${action.identifier}` : ""}
          </p>
        </div>
        <div className="text-right font-mono">
          <p className={action.side === "sell" ? "text-red" : "text-cyan"}>{EUR.format(action.amount_eur)}</p>
          <p className="text-micro text-ink-2">
            {action.estimated_units == null ? "Units unavailable" : `Est. ${NUMBER.format(action.estimated_units)} units`}
          </p>
        </div>
      </div>

      <fieldset className="mt-4" disabled={readOnly || saving}>
        <legend className="font-mono text-micro uppercase tracking-[0.08em] text-ink-2">Decision</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {decisions.map((decision) => (
            <Button
              id={action.decision === "undecided" && decision === "accepted" ? `review-action-${index}` : undefined}
              key={decision}
              type="button"
              size="sm"
              variant={action.decision === decision ? "default" : "outline"}
              aria-pressed={action.decision === decision}
              onClick={() => {
                const amount = decision === "adjusted" ? Number(adjusted) : undefined;
                void onSave(decision, amount, note).catch(() => undefined);
              }}
            >
              {decision}
            </Button>
          ))}
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,180px)_1fr_auto] md:items-end">
          <label className="font-mono text-micro uppercase text-ink-2">
            Adjusted amount (EUR)
            <Input
              className="mt-1"
              type="number"
              min="0"
              step="0.01"
              value={adjusted}
              onChange={(event) => setAdjusted(event.target.value)}
            />
          </label>
          <label className="font-mono text-micro uppercase text-ink-2">
            Optional note
            <Textarea
              className="mt-1 min-h-[54px] normal-case"
              maxLength={1000}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          {action.decision !== "undecided" && (
            <Button
              type="button"
              variant="outline"
              onClick={() => void onSave(
                action.decision as Exclude<ReviewDecision, "undecided">,
                action.decision === "adjusted" ? Number(adjusted) : undefined,
                note,
              ).catch(() => undefined)}
            >
              Save row
            </Button>
          )}
        </div>
      </fieldset>
    </article>
  );
}

function ReviewWorkspace({
  review,
  isSaving,
  onSave,
  onComplete,
}: {
  review: MonthlyReview;
  isSaving: boolean;
  onSave: ReturnType<typeof useMonthlyReview>["save"];
  onComplete: ReturnType<typeof useMonthlyReview>["complete"];
}) {
  const [contribution, setContribution] = useState(String(review.payload.inputs.contribution));
  const [completionMessage, setCompletionMessage] = useState("");
  const readOnly = review.status === "completed";
  const payload = review.payload;
  const grouped = useMemo(
    () => groupReviewPresentation({
      breaches: payload.snapshot.breaches ?? [],
      actions: payload.recommendations.actions ?? [],
      cash: payload.cash_summary,
    }),
    [payload],
  );

  const download = () => {
    try {
      const csv = serializeReviewCsv(payload.recommendations.actions);
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `prismo-review-${review.period}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
      setCompletionMessage("Persisted decisions exported as CSV");
    } catch (caught) {
      setCompletionMessage(caught instanceof Error ? caught.message : "CSV export failed");
    }
  };

  const complete = async () => {
    const first = firstUndecidedActionKey(payload.recommendations.actions);
    if (first) {
      const index = grouped.actions.findIndex((action) => action.key === first);
      setCompletionMessage("Decide every action before completing. Focus moved to the first undecided action.");
      document.getElementById(`review-action-${index}`)?.focus();
      return;
    }
    try {
      await onComplete();
      setCompletionMessage("Review completed and frozen");
    } catch (caught) {
      setCompletionMessage(caught instanceof Error ? caught.message : "Completion failed");
    }
  };

  const comparison = payload.comparison;
  const receipt = payload.snapshot.receipt;
  const readiness = payload.snapshot.readiness;

  return (
    <div className="space-y-5">
      {readOnly && (
        <Alert><AlertDescription>This review was completed on {review.completed_at ?? payload.completed_at}. It is read-only.</AlertDescription></Alert>
      )}

      <Section title="Import and readiness">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <h3 className="font-semibold">Import receipt</h3>
            {receipt ? (
              <dl className="mt-2 grid grid-cols-2 gap-3">
                {Object.entries(receipt).filter(([, value]) => ["string", "number", "boolean"].includes(typeof value)).slice(0, 8).map(([key, value]) => (
                  <Stat key={key} label={key.replaceAll("_", " ")} value={String(value)} />
                ))}
              </dl>
            ) : <p className="mt-2 text-sm text-ink-2">Draft created without an import receipt.</p>}
          </div>
          <div>
            <h3 className="font-semibold">Readiness</h3>
            {readiness.blocking.length === 0 && readiness.warnings.length === 0 ? (
              <p className="mt-2 text-sm text-green">Ready — no captured blockers or warnings.</p>
            ) : (
              <ul className="mt-2 space-y-1 text-sm">
                {readiness.blocking.map((item, index) => <li key={`${item.code}-${index}`} className="text-red">Blocker: {item.message}</li>)}
                {readiness.warnings.map((item, index) => <li key={`${item.code}-${index}`} className="text-amber">Warning: {item.message}</li>)}
              </ul>
            )}
            {readiness.blocking.length > 0 && (
              <label className="mt-3 flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={payload.inputs.readiness_override}
                  disabled={readOnly || isSaving}
                  onChange={(event) => void onSave({ readiness_override: event.target.checked }).catch(() => undefined)}
                />
                I reviewed these blockers and explicitly override them for this frozen estimate.
              </label>
            )}
          </div>
        </div>
      </Section>

      <Section title="Since the previous review">
        {comparison.baseline ? (
          <p className="text-sm text-ink-2">This is the baseline review; comparison begins after it is completed.</p>
        ) : (
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Added" value={comparison.added.length} />
            <Stat label="Closed" value={comparison.closed.length} />
            <Stat label="Moved" value={comparison.moved.length} />
            <Stat label="Share changes" value={comparison.share_changes.length} />
            <Stat label="Value changes" value={comparison.value_changes.length} />
            <Stat label="Allocation changes" value={comparison.allocation_changes.length} />
            <Stat label="Cash change" value={EUR.format(comparison.cash_change)} />
            <Stat label="Rules / targets" value={`${comparison.rules_changed ? "rules " : ""}${comparison.targets_changed ? "targets" : ""}`.trim() || "unchanged"} />
          </dl>
        )}
        {payload.reconciliation.items.length > 0 && (
          <p className="mt-3 text-sm">{payload.reconciliation.items.length} prior action reconciliation item(s).</p>
        )}
        <p className="mt-3 text-xs text-ink-2">{comparison.disclaimer}</p>
      </Section>

      <Section title="Breaches and contributors">
        {grouped.breaches.length === 0 ? <p className="text-sm text-ink-2">No captured concentration breaches.</p> : (
          <div className="grid gap-3 md:grid-cols-2">
            {grouped.breaches.map((breach) => (
              <article key={breach.key} className="border border-rule-2 p-3">
                <div className="flex justify-between gap-3"><strong>{breach.name}</strong><span className="font-mono text-red">+{NUMBER.format(breach.excess_percentage_points)} pp</span></div>
                <p className="mt-1 text-xs text-ink-2">{NUMBER.format(breach.percentage)}% vs {NUMBER.format(breach.limit)}% limit · {breach.kind}</p>
                {breach.contributors.length > 0 && <p className="mt-2 text-xs">Top: {breach.contributors.slice(0, 3).map((item) => `${item.name} ${EUR.format(item.value)}`).join(" · ")}</p>}
              </article>
            ))}
          </div>
        )}
      </Section>

      <Section title="Capital decision">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="font-mono text-micro uppercase text-ink-2">
            Capital mode
            <select
              className="mt-1 h-[30px] w-full border border-rule-2 bg-bg-2 px-3 text-ink"
              value={payload.inputs.mode}
              disabled={readOnly || isSaving}
              onChange={(event) => void onSave({ mode: event.target.value }).catch(() => undefined)}
            >
              <option value="existing-only">Rebalance existing holdings</option>
              <option value="new-only">Deploy cash without sells</option>
              <option value="new-with-sells">Deploy cash with sells</option>
            </select>
          </label>
          <label className="font-mono text-micro uppercase text-ink-2">
            {payload.inputs.contribution_label}
            <div className="mt-1 flex gap-2">
              <Input type="number" min="0" step="0.01" value={contribution} disabled={readOnly || isSaving} onChange={(event) => setContribution(event.target.value)} />
              <Button type="button" variant="outline" disabled={readOnly || isSaving} onClick={() => void onSave({ contribution: Number(contribution) }).catch(() => undefined)}>Save</Button>
            </div>
          </label>
        </div>
      </Section>

      <Section title="Ranked actions">
        <div className="mb-3 flex flex-wrap gap-3 font-mono text-micro uppercase text-ink-2">
          {Object.entries(grouped.decisions).map(([decision, count]) => <span key={decision}>{decision}: {count}</span>)}
        </div>
        {grouped.actions.length === 0 ? <p className="text-sm text-ink-2">No actions are recommended for the captured inputs.</p> : (
          <div className="grid gap-3">
            {grouped.actions.map((action, index) => (
              <ActionCard
                key={`${review.version}-${action.key}`}
                action={action}
                index={index}
                readOnly={readOnly}
                saving={isSaving}
                onSave={(decision, adjustedAmount, note) => onSave({ action_decision: { key: action.key, decision, adjusted_amount: adjustedAmount, note } })}
              />
            ))}
          </div>
        )}
      </Section>

      <Section title="Cash reconciliation">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Stat label="Current cash" value={EUR.format(grouped.cash.current_cash)} />
          <Stat label="Contribution" value={EUR.format(grouped.cash.contribution)} />
          <Stat label="Accepted sales" value={EUR.format(grouped.cash.accepted_sales)} />
          <Stat label="Accepted buys" value={EUR.format(grouped.cash.accepted_buys)} />
          <Stat label="Remaining cash" value={EUR.format(grouped.cash.remaining_cash)} />
        </dl>
      </Section>

      {payload.recommendations.unresolved_gaps.length > 0 && (
        <Section title="Unresolved target gaps">
          <p className="text-sm">{payload.recommendations.unresolved_gaps.length} target gap(s) need attention before they can become executable actions.</p>
          <Link href="/plan" className="mt-2 inline-block font-mono text-chrome uppercase text-cyan underline">Open plan</Link>
        </Section>
      )}

      <Section title="Complete and export">
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={isSaving} onClick={download}>Export persisted decisions</Button>
          {!readOnly && <Button type="button" disabled={isSaving} onClick={() => void complete()}>Complete review</Button>}
        </div>
        <p className="mt-3 text-xs text-ink-2">All amounts and units are point-in-time estimates, not trading, tax, or accounting instructions.</p>
        <p className="sr-only" role="status" aria-live="polite">{completionMessage}</p>
        {completionMessage && <p className="mt-2 text-sm text-ink-2" aria-hidden>{completionMessage}</p>}
      </Section>
    </div>
  );
}

function ReviewPageInner() {
  const params = useSearchParams();
  const router = useRouter();
  const parsed = Number(params.get("review"));
  const requestedId = Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  const recoveryJob = params.get("job");
  const reviewState = useMonthlyReview(requestedId);
  const historyRef = useRef<HTMLSelectElement>(null);

  if (reviewState.isLoading) {
    return <div className="space-y-5"><PageHeader title="Monthly review" showPortfolioPicker={false} /><Skeleton className="h-20" /><Skeleton className="h-56" /><Skeleton className="h-72" /></div>;
  }

  if (reviewState.listError && reviewState.reviews.length === 0) {
    return <div className="space-y-4"><PageHeader title="Monthly review" showPortfolioPicker={false} /><Alert variant="destructive"><AlertDescription>{reviewState.listError}</AlertDescription></Alert></div>;
  }

  if (!reviewState.review) {
    return (
      <div className="space-y-5">
        <PageHeader title="Monthly review" showPortfolioPicker={false} />
        <Section title={recoveryJob ? "Recover import review" : "No reviews yet"}>
          <p className="text-sm text-ink-2">{recoveryJob ? "The import finished, but its review handoff needs to be retried." : "Create a point-in-time draft from the current portfolio, targets, rules, cash, prices, and FX."}</p>
          <Button className="mt-3" disabled={reviewState.isSaving} onClick={() => void reviewState.create(recoveryJob ?? undefined).catch(() => undefined)}>{recoveryJob ? "Retry review capture" : "Create monthly review"}</Button>
        </Section>
      </div>
    );
  }

  const review = reviewState.review;
  return (
    <div className="space-y-5">
      <PageHeader title="Monthly review" showPortfolioPicker={false} right={<span className="font-mono text-chrome uppercase text-ink-2">{review.period} · {review.status} · v{review.version}</span>} />
      <div className="flex flex-wrap items-end justify-between gap-3 border border-rule bg-bg-1 p-3">
        <label className="min-w-[260px] font-mono text-micro uppercase text-ink-2">
          Review history
          <select
            ref={historyRef}
            className="mt-1 h-[30px] w-full border border-rule-2 bg-bg-2 px-3 text-ink"
            value={review.id}
            disabled={reviewState.isSaving}
            onChange={(event) => {
              const id = Number(event.target.value);
              if (reviewState.chooseReview(id)) router.replace(`/review?review=${id}`);
            }}
          >
            {reviewState.reviews.map((item) => <option key={item.id} value={item.id}>{item.period} · {item.status} · v{item.version}</option>)}
          </select>
        </label>
        <p className="font-mono text-micro uppercase text-ink-2">{reviewState.isSaving ? "Saving — history locked" : "Server-saved state"}</p>
      </div>

      <div role="status" aria-live="polite" className="min-h-5 text-sm text-ink-2">{reviewState.error ?? reviewState.saveMessage}</div>
      {reviewState.error && <Alert variant="destructive"><AlertDescription>{reviewState.error}</AlertDescription></Alert>}
      {recoveryJob && review.source_job_id !== recoveryJob && (
        <Alert>
          <AlertDescription>
            <span>This page was opened from import job {recoveryJob}. Retry its idempotent review capture if the receipt is not represented in history.</span>
            <Button className="ml-3" size="sm" variant="outline" disabled={reviewState.isSaving} onClick={() => void reviewState.create(recoveryJob).catch(() => undefined)}>Retry review capture</Button>
          </AlertDescription>
        </Alert>
      )}
      <ReviewWorkspace key={`${review.id}:${review.version}`} review={review} isSaving={reviewState.isSaving} onSave={reviewState.save} onComplete={reviewState.complete} />
    </div>
  );
}

export default function ReviewPage() {
  return <Suspense fallback={<div className="space-y-5"><PageHeader title="Monthly review" showPortfolioPicker={false} /><Skeleton className="h-72" /></div>}><ReviewPageInner /></Suspense>;
}
