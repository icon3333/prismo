"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { useAnonymousMode } from "@/components/domain/anonymous-mode";
import { cetTime } from "@/lib/format";
import { LiveDot } from "./LiveDot";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

const ROW2_GROUPS = [
  [{ href: "/", label: "Overview" }],
  [
    { href: "/enrich", label: "Enrich" },
    { href: "/concentrations", label: "Concentrations" },
    { href: "/performance", label: "Performance" },
  ],
  [
    { href: "/builder", label: "Builder" },
    { href: "/rebalancer", label: "Rebalancer" },
    { href: "/simulator", label: "Simulator" },
  ],
];

// Pages that read `?portfolio=` — the param is carried across them so a
// selected portfolio survives tab switches.
const PORTFOLIO_PARAM_ROUTES = [
  "/enrich",
  "/concentrations",
  "/performance",
  "/builder",
  "/rebalancer",
];

function isTabActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname.startsWith(href);
}

function NavTabs({ portfolioId }: { portfolioId: string | null }) {
  const pathname = usePathname();

  const hrefFor = (href: string) =>
    portfolioId && PORTFOLIO_PARAM_ROUTES.includes(href)
      ? `${href}?portfolio=${encodeURIComponent(portfolioId)}`
      : href;

  return (
    <>
      {ROW2_GROUPS.map((group, gi) => (
        <div
          key={gi}
          className={cn(
            "flex shrink-0 items-stretch",
            gi > 0 && "border-l border-rule-2",
          )}
        >
          {group.map((tab) => {
            const active = isTabActive(pathname, tab.href);
            return (
              <Link
                key={tab.href}
                href={hrefFor(tab.href)}
                className={cn(
                  "px-4 h-8 inline-flex items-center font-mono uppercase text-chrome tracking-[0.1em] transition-colors duration-[80ms]",
                  active
                    ? "text-cyan border-b-2 border-cyan -mb-px"
                    : "text-ink-2 hover:text-ink",
                )}
              >
                {tab.label}
              </Link>
            );
          })}
        </div>
      ))}
    </>
  );
}

// useSearchParams() suspends during prerender (same pattern as the
// PortfolioPicker), so the param-aware tabs sit behind Suspense with a
// param-less fallback that renders identical chrome.
function NavTabsWithParams() {
  const searchParams = useSearchParams();
  return <NavTabs portfolioId={searchParams.get("portfolio")} />;
}

function useNowEvery30s(): number {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function Masthead() {
  const { isAnonymous, toggle: toggleAnonymous } = useAnonymousMode();
  const { resolvedTheme, setTheme } = useTheme();
  const router = useRouter();
  const now = useNowEvery30s();

  // Render-time-stable timestamp for SSR/hydration: only render the time on
  // the client to avoid mismatches.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const liveLabel = mounted
    ? `LIVE · EUR · ${cetTime(now)}`
    : "LIVE · EUR";

  return (
    <header className="sticky top-0 z-40 w-full border-b border-rule bg-bg">
      {/* Row 1 — 40px */}
      <div className="flex h-10 items-stretch bg-bg-1 border-b border-rule">
        {/* Brand */}
        <div className="flex items-center gap-2 px-3">
          <span
            aria-hidden
            className="inline-block w-[10px] h-[10px] bg-cyan"
          />
          <span className="font-mono font-bold uppercase text-chrome tracking-[0.12em] text-cyan">
            PRISMO
          </span>
        </div>

        {/* Spacer */}
        <div className="flex-1 border-l border-rule" />

        {/* Live */}
        <div className="flex items-center gap-2 px-3 border-l border-rule">
          <LiveDot level="live" />
          <span className="font-mono uppercase text-chrome tracking-[0.06em] text-ink-2">
            {liveLabel}
          </span>
        </div>

        {/* Anon toggle */}
        <button
          type="button"
          onClick={toggleAnonymous}
          aria-pressed={isAnonymous}
          className={cn(
            "flex items-center px-3 border-l border-rule font-mono uppercase text-chrome tracking-[0.06em] transition-colors duration-[80ms]",
            isAnonymous
              ? "text-cyan bg-bg-3"
              : "text-ink-2 bg-transparent hover:text-ink",
          )}
        >
          ANON
        </button>

        {/* Theme toggle */}
        <button
          type="button"
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
          aria-label="Toggle theme"
          aria-pressed={mounted ? resolvedTheme === "light" : false}
          className="flex items-center px-3 border-l border-rule font-mono uppercase text-chrome tracking-[0.06em] text-ink-2 bg-transparent hover:text-ink transition-colors duration-[80ms]"
        >
          {mounted ? (resolvedTheme === "dark" ? "DARK" : "LIGHT") : "DARK"}
        </button>

        {/* Kebab */}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                aria-label="More actions"
                className="flex items-center justify-center w-8 border-l border-rule text-ink-2 hover:text-ink hover:bg-bg-2 transition-colors duration-[80ms]"
              />
            }
          >
            <span aria-hidden className="text-[14px] leading-none">⋮</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={4}>
            <DropdownMenuItem onClick={() => router.push("/account")}>
              Account settings
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={async () => {
                try {
                  await fetch("/auth/logout", {
                    method: "POST",
                    credentials: "include",
                  });
                } finally {
                  window.location.reload();
                }
              }}
            >
              Switch account
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Row 2 — 32px. Scrolls horizontally on phones (7 tabs ≈ 770px);
          md:overflow-visible restores the active tab's -mb-px underline overlap. */}
      <nav className="flex h-8 items-stretch bg-bg-1 border-b border-rule overflow-x-auto overflow-y-hidden md:overflow-visible">
        <Suspense fallback={<NavTabs portfolioId={null} />}>
          <NavTabsWithParams />
        </Suspense>
      </nav>
    </header>
  );
}
