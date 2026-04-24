"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useAccount } from "@/hooks/use-account";
import { useAnonymousMode } from "@/components/domain/anonymous-mode";
import { LiveDot } from "./LiveDot";
import { PortfolioPicker } from "./PortfolioPicker";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

const PAGE_NAMES: Record<string, string> = {
  "/": "OVERVIEW",
  "/enrich": "ENRICH",
  "/concentrations": "CONCENTRATIONS",
  "/performance": "PERFORMANCE",
  "/builder": "BUILDER",
  "/rebalancer": "REBALANCER",
  "/simulator": "SIMULATOR",
  "/account": "ACCOUNT",
};

function pageNameFor(pathname: string): string {
  if (pathname === "/") return PAGE_NAMES["/"];
  // Match longest prefix (excluding root)
  const matches = Object.keys(PAGE_NAMES)
    .filter((p) => p !== "/" && pathname.startsWith(p))
    .sort((a, b) => b.length - a.length);
  return matches[0] ? PAGE_NAMES[matches[0]] : "PRISMO";
}

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

function isTabActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname.startsWith(href);
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function useNowEvery30s(): number {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function formatCetTime(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
  });
}

export function Masthead() {
  const pathname = usePathname();
  const router = useRouter();
  const { account } = useAccount();
  const { isAnonymous, toggle: toggleAnonymous } = useAnonymousMode();
  const now = useNowEvery30s();

  const pageName = pageNameFor(pathname);
  const isOverview = pathname === "/";
  const navLabel = isOverview ? "AGGREGATE NAV" : "NAV";

  // Render-time-stable timestamp for SSR/hydration: only render the time on
  // the client to avoid mismatches.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const liveLabel = mounted
    ? `LIVE · EUR · ${formatCetTime(now)} CET`
    : "LIVE · EUR";

  const username = account?.username ?? "—";
  const displayUser = truncate(username, 12);

  return (
    <header className="w-full border-b border-rule bg-bg">
      {/* Row 1 — 40px */}
      <div className="flex h-10 items-stretch bg-bg-1 border-b border-rule">
        {/* Brand */}
        <div className="flex items-center gap-2 px-3">
          <span
            aria-hidden
            className="inline-block w-[10px] h-[10px] bg-cyan"
          />
          <span className="font-mono font-bold uppercase text-[11px] tracking-[0.12em] text-cyan">
            PRISMO
          </span>
        </div>

        {/* Breadcrumb */}
        <div className="flex items-center gap-2 px-3 border-l border-rule">
          <span className="font-mono uppercase text-[11px] tracking-[0.06em] text-ink">
            {pageName}
          </span>
          <span aria-hidden className="text-ink-3 text-[11px]">
            ·
          </span>
          <PortfolioPicker />
        </div>

        {/* Spacer */}
        <div className="flex-1 border-l border-rule" />

        {/* NAV */}
        <div className="flex items-center gap-2 px-3 border-l border-rule">
          <span className="font-mono uppercase text-[11px] tracking-[0.06em] text-ink-2">
            {navLabel}
          </span>
          <span className="font-mono tabular-nums text-[11px] text-ink">
            —
          </span>
        </div>

        {/* Live */}
        <div className="flex items-center gap-2 px-3 border-l border-rule">
          <LiveDot level="live" />
          <span className="font-mono uppercase text-[11px] tracking-[0.06em] text-ink-2">
            {liveLabel}
          </span>
        </div>

        {/* Anon toggle */}
        <button
          type="button"
          onClick={toggleAnonymous}
          aria-pressed={isAnonymous}
          className={cn(
            "flex items-center px-3 border-l border-rule font-mono uppercase text-[11px] tracking-[0.06em] transition-colors duration-[80ms]",
            isAnonymous
              ? "text-cyan bg-bg-3"
              : "text-ink-2 bg-transparent hover:text-ink",
          )}
        >
          ANON
        </button>

        {/* Account */}
        <Link
          href="/account"
          className="flex items-center px-3 border-l border-rule font-mono uppercase text-[11px] tracking-[0.06em] text-ink-2 hover:text-ink transition-colors duration-[80ms]"
        >
          ACCT · {displayUser}
        </Link>

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
            <DropdownMenuItem onClick={() => router.push("/auth/select")}>
              Switch account
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
              Logout
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Row 2 — 32px */}
      <nav className="flex h-8 items-stretch bg-bg-1 border-b border-rule">
        {ROW2_GROUPS.map((group, gi) => (
          <div
            key={gi}
            className={cn(
              "flex items-stretch",
              gi > 0 && "border-l border-rule-2",
            )}
          >
            {group.map((tab) => {
              const active = isTabActive(pathname, tab.href);
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={cn(
                    "px-4 h-8 inline-flex items-center font-mono uppercase text-[11px] tracking-[0.06em] transition-colors duration-[80ms]",
                    active
                      ? "text-ink border-b-2 border-cyan -mb-px"
                      : "text-ink-2 hover:text-ink",
                  )}
                >
                  {tab.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
    </header>
  );
}
