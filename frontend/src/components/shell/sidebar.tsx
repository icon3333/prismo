"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import {
  Home,
  Gem,
  PieChart,
  Search,
  Boxes,
  Scale,
  FlaskConical,
  User,
  EyeOff,
  Eye,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Sun,
  Moon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api";
import { useTheme } from "next-themes";
import { useAnonymousMode } from "@/components/domain/anonymous-mode";
import { useAccount } from "@/hooks/use-account";

// Route → endpoints to warm on hover
const PREFETCH: Record<string, string[]> = {
  "/": ["/portfolio_data", "/portfolios?include_ids=true&has_companies=true", "/account/cash", "/state?page=builder", "/simulator/portfolio-data"],
  "/enrich": ["/portfolio_data", "/portfolios", "/account/cash", "/builder/investment-targets", "/portfolios_dropdown"],
  "/concentrations": ["/portfolios?include_ids=true&has_companies=true", "/account/cash", "/state?page=risk_overview", "/portfolio_data/all?fields=companies"],
};

function prefetchRoute(href: string) {
  const endpoints = PREFETCH[href];
  if (endpoints) endpoints.forEach((p) => apiFetch(p).catch(() => {}));
}

const NAV_SECTIONS = [
  {
    label: "Overview",
    items: [{ href: "/", icon: Home, label: "Overview" }],
  },
  {
    label: "Portfolios",
    items: [
      { href: "/enrich", icon: Gem, label: "Enrich" },
      { href: "/concentrations", icon: PieChart, label: "Concentrations" },
      { href: "/performance", icon: Search, label: "Performance" },
    ],
  },
  {
    label: "Allocation",
    items: [
      { href: "/builder", icon: Boxes, label: "Builder" },
      { href: "/rebalancer", icon: Scale, label: "Rebalancer" },
      { href: "/simulator", icon: FlaskConical, label: "Simulator" },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const { isAnonymous, toggle: toggleAnonymous } = useAnonymousMode();
  const { account } = useAccount();
  const { resolvedTheme, setTheme } = useTheme();
  const [expanded, setExpanded] = useState(true);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <aside
      className={cn(
        "sticky top-0 h-screen flex flex-col border-r border-border bg-card transition-all duration-200 ease-in-out overflow-hidden z-50",
        expanded ? "w-60" : "w-16"
      )}
    >
      {/* Brand */}
      <div
        className={cn(
          "flex h-14 items-center border-b border-border",
          expanded ? "gap-3 px-4" : "justify-center"
        )}
      >
        <Gem className="size-5 shrink-0 text-aqua-500" suppressHydrationWarning />
        {expanded && (
          <span className="font-bold text-lg whitespace-nowrap">
            Prismo
          </span>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-x-hidden overflow-y-auto scrollbar-none py-4">
        {NAV_SECTIONS.map((section) => (
          <div key={section.label} className="mb-4">
            <span
              className={cn(
                "block px-4 mb-1 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap transition-all duration-200",
                expanded ? "opacity-100 h-auto" : "opacity-0 h-0 overflow-hidden mb-0"
              )}
            >
              {section.label}
            </span>
            {section.items.map((item) => {
              const isActive =
                item.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onMouseEnter={() => prefetchRoute(item.href)}
                  className={cn(
                    "flex items-center py-2 text-sm transition-colors relative",
                    expanded ? "gap-3 px-4" : "justify-center",
                    isActive
                      ? "text-foreground bg-muted before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[3px] before:bg-aqua-500"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  )}
                >
                  <item.icon className="size-4 shrink-0" suppressHydrationWarning />
                  {expanded && (
                    <span className="whitespace-nowrap">
                      {item.label}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Collapse (above divider) */}
      <div className="py-2">
        <button
          onClick={() => setExpanded(!expanded)}
          className={cn(
            "flex w-full items-center py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors",
            expanded ? "gap-3 px-4" : "justify-center"
          )}
        >
          {expanded ? (
            <PanelLeftClose className="size-4 shrink-0" suppressHydrationWarning />
          ) : (
            <PanelLeftOpen className="size-4 shrink-0" suppressHydrationWarning />
          )}
          {expanded && (
            <span className="whitespace-nowrap">Collapse</span>
          )}
        </button>
      </div>

      {/* Bottom Actions */}
      <div className="border-t border-border py-2">
        <button
          onClick={toggleAnonymous}
          className={cn(
            "flex w-full items-center py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors",
            expanded ? "gap-3 px-4" : "justify-center"
          )}
        >
          {isAnonymous ? (
            <EyeOff className="size-4 shrink-0" suppressHydrationWarning />
          ) : (
            <Eye className="size-4 shrink-0" suppressHydrationWarning />
          )}
          {expanded && (
            <span className="whitespace-nowrap">
              {isAnonymous ? "Anonymous" : "Visible"}
            </span>
          )}
        </button>
        <button
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
          className={cn(
            "flex w-full items-center py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors",
            expanded ? "gap-3 px-4" : "justify-center"
          )}
        >
          {mounted && resolvedTheme === "dark" ? (
            <Sun className="size-4 shrink-0" suppressHydrationWarning />
          ) : (
            <Moon className="size-4 shrink-0" suppressHydrationWarning />
          )}
          {expanded && (
            <span className="whitespace-nowrap">
              {mounted && resolvedTheme === "dark" ? "Light mode" : "Dark mode"}
            </span>
          )}
        </button>
        <Link
          href="/account"
          className={cn(
            "flex items-center py-2 text-sm transition-colors",
            expanded ? "gap-3 px-4" : "justify-center",
            pathname === "/account"
              ? "text-foreground bg-muted"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
          )}
        >
          <User className="size-4 shrink-0" suppressHydrationWarning />
          {expanded && (
            <span className="whitespace-nowrap truncate">
              {account?.username ?? "Account"}
            </span>
          )}
        </Link>
        <button
          onClick={async () => {
            await fetch("/auth/logout", {
              method: "POST",
              credentials: "include",
            });
            window.location.reload();
          }}
          className={cn(
            "flex w-full items-center py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors",
            expanded ? "gap-3 px-4" : "justify-center"
          )}
        >
          <LogOut className="size-4 shrink-0" suppressHydrationWarning />
          {expanded && (
            <span className="whitespace-nowrap">Logout</span>
          )}
        </button>
      </div>
    </aside>
  );
}
