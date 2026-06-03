"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from "@/components/ui/dropdown-menu";
import { apiFetch, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { PortfolioOption } from "@/types/performance";

// Routes where the picker shows a per-portfolio name + chevron.
const PER_PORTFOLIO_ROUTES = [
  "/enrich",
  "/concentrations",
  "/performance",
  "/builder",
  "/rebalancer",
];

// When a per-portfolio page is selected from Overview, default landing page.
const DEFAULT_PER_PORTFOLIO_LANDING = "/enrich";

function pickActiveLabel(
  pathname: string,
  activePortfolioName: string | null,
  activeId: string | null,
): { label: string; showChevron: boolean; hidden: boolean } {
  if (pathname.startsWith("/simulator")) {
    return { label: "SANDBOX", showChevron: false, hidden: true };
  }
  if (pathname === "/") {
    return { label: "ALL PORTFOLIOS", showChevron: true, hidden: false };
  }
  for (const r of PER_PORTFOLIO_ROUTES) {
    if (pathname.startsWith(r)) {
      if (!activeId || activeId === "all") {
        return { label: "ALL PORTFOLIOS", showChevron: true, hidden: false };
      }
      return {
        label: activePortfolioName ?? "SELECT PORTFOLIO",
        showChevron: true,
        hidden: false,
      };
    }
  }
  return { label: "ALL PORTFOLIOS", showChevron: true, hidden: false };
}

// useSearchParams() suspends during prerender, so the picker is wrapped in
// Suspense to keep dashboard pages statically renderable. The fallback
// renders a deterministic non-interactive trigger so the masthead chrome
// looks correct in the streamed HTML.
export function PortfolioPicker() {
  return (
    <Suspense
      fallback={
        <span className="font-mono text-chrome uppercase tracking-[0.06em] text-ink-2">
          ▾
        </span>
      }
    >
      <PortfolioPickerInner />
    </Suspense>
  );
}

function PortfolioPickerInner() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [portfolios, setPortfolios] = useState<PortfolioOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // Effect body is a single call to a function — satisfies
  // react-hooks/set-state-in-effect (setState lives inside the closure,
  // not directly in the effect body).
  useEffect(() => {
    let cancelled = false;
    const loadPortfolios = async () => {
      setLoading(true);
      setError(false);
      try {
        const data = await apiFetch<PortfolioOption[]>(
          "/portfolios?include_ids=true&has_companies=true",
        );
        if (!cancelled) {
          setPortfolios(Array.isArray(data) ? data : []);
        }
      } catch (e) {
        if (!cancelled) {
          // Silently absorb non-API errors; surface API failures as empty/error state.
          if (!(e instanceof ApiError)) {
            // no-op
          }
          setError(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    loadPortfolios();
    return () => {
      cancelled = true;
    };
  }, []);

  // Active portfolio = ?portfolio=<id> URL param. Page-local hooks may also
  // read this and use it as their filter; the picker is now the single
  // source of truth for "what portfolio is currently in focus."
  const activeId = searchParams.get("portfolio");
  const activePortfolio = useMemo(
    () => (activeId ? portfolios.find((p) => String(p.id) === activeId) : undefined),
    [activeId, portfolios],
  );
  const activePortfolioName = activePortfolio?.name ?? null;

  const { label, showChevron, hidden } = pickActiveLabel(
    pathname,
    activePortfolioName,
    activeId,
  );

  // Sandbox path → render plain label, no dropdown.
  if (hidden) {
    return (
      <span className="font-mono text-chrome uppercase tracking-[0.06em] text-ink">
        {label}
      </span>
    );
  }

  const total = portfolios.length;
  const onPerPortfolio = PER_PORTFOLIO_ROUTES.some((r) =>
    pathname.startsWith(r),
  );
  // "All portfolios" is active when on Overview, or when on a per-portfolio
  // page with no ?portfolio= param (which means "no filter / aggregate").
  const isAllPortfoliosActive =
    pathname === "/" || (onPerPortfolio && !activeId);

  // Decide where clicking a portfolio row should land:
  // - On Overview → jump to the default per-portfolio surface (Enrich).
  // - On a per-portfolio page → stay on that page, swap the ?portfolio= param.
  const targetRouteForPortfolio = (id: string | number): string => {
    const base = onPerPortfolio ? pathname : DEFAULT_PER_PORTFOLIO_LANDING;
    return `${base}?portfolio=${id}`;
  };

  // "All portfolios" row: stay on current per-portfolio page (clear param),
  // otherwise jump to Overview.
  const handleAllPortfoliosClick = () => {
    if (onPerPortfolio) {
      router.push(pathname);
    } else {
      router.push("/");
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className={cn(
              "inline-flex items-center gap-1 font-mono text-chrome uppercase tracking-[0.06em] text-ink hover:text-cyan transition-colors duration-[80ms]",
              "outline-none",
            )}
          />
        }
      >
        <span className="truncate max-w-[220px]">{label}</span>
        {showChevron && (
          <span aria-hidden className="text-ink-2">
            ▾
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={4}
        className="min-w-[320px] max-w-[480px] p-0"
      >
        {/* All portfolios row */}
        <button
          type="button"
          onClick={handleAllPortfoliosClick}
          className={cn(
            "w-full grid grid-cols-[24px_1fr_auto] items-center gap-2 px-3 py-2 text-left transition-colors duration-[80ms]",
            isAllPortfoliosActive
              ? "bg-bg-3"
              : "hover:bg-bg-2",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "font-mono text-micro uppercase tracking-[0.06em] text-ink-3",
              isAllPortfoliosActive && "border-l-2 border-cyan pl-1 -ml-1",
            )}
          >
            *
          </span>
          <span className="text-data text-ink">All portfolios</span>
          <span className="font-mono text-micro uppercase tracking-[0.12em] text-ink-3">
            AGGREGATE VIEW
          </span>
        </button>

        <div className="h-px bg-rule" />

        {/* Body — list / loading / empty */}
        {loading && (
          <div className="py-1">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="grid grid-cols-[24px_1fr_auto] items-center gap-2 px-3 py-2"
              >
                <span className="font-mono text-micro text-ink-3">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="text-data text-ink-3">—</span>
                <span className="font-mono text-chrome text-ink-3">—</span>
              </div>
            ))}
          </div>
        )}

        {!loading && (error || total === 0) && (
          <div className="px-3 py-6 text-center">
            <div className="font-mono text-micro uppercase tracking-[0.12em] text-ink-2 mb-1">
              NO PORTFOLIOS
            </div>
            <div className="text-chrome text-ink-3">
              Import a CSV or add a holding to begin.
            </div>
          </div>
        )}

        {!loading && !error && total > 0 && (
          <div className="py-1 max-h-[320px] overflow-y-auto">
            {portfolios.map((p, idx) => {
              const active = String(p.id) === activeId;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => router.push(targetRouteForPortfolio(p.id))}
                  className={cn(
                    "w-full grid grid-cols-[24px_1fr_auto] items-center gap-2 px-3 py-2 text-left transition-colors duration-[80ms]",
                    active ? "bg-bg-3" : "hover:bg-bg-2",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "font-mono text-micro uppercase tracking-[0.06em] text-ink-3",
                      active && "border-l-2 border-cyan pl-1 -ml-1",
                    )}
                  >
                    {String(idx + 1).padStart(2, "0")}
                  </span>
                  <span className="text-data text-ink truncate">{p.name}</span>
                  <span className="font-mono text-chrome text-ink-3">—</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Footer — jumps to Enrich with the portfolio-manager pre-armed
            (action=add, name field focused). */}
        <div className="border-t border-rule">
          <button
            type="button"
            onClick={() => router.push("/enrich?addPortfolio=1")}
            className="w-full px-3 py-2 text-left font-mono text-chrome uppercase tracking-[0.12em] text-cyan hover:bg-bg-2 transition-colors duration-[80ms]"
          >
            + NEW PORTFOLIO ↗
          </button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
