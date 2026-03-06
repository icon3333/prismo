"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Home,
  Gem,
  PieChart,
  Search,
  Boxes,
  Scale,
  FlaskConical,
  Settings,
  EyeOff,
  Eye,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAnonymousMode } from "@/components/domain/anonymous-mode";

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
  const [expanded, setExpanded] = useState(false);

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
        <Gem className="size-5 shrink-0 text-aqua-500" />
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
                  className={cn(
                    "flex items-center py-2 text-sm transition-colors relative",
                    expanded ? "gap-3 px-4" : "justify-center",
                    isActive
                      ? "text-foreground bg-muted before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[3px] before:bg-aqua-500"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  )}
                >
                  <item.icon className="size-4 shrink-0" />
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
            <EyeOff className="size-4 shrink-0" />
          ) : (
            <Eye className="size-4 shrink-0" />
          )}
          {expanded && (
            <span className="whitespace-nowrap">
              {isAnonymous ? "Anonymous" : "Visible"}
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
          <Settings className="size-4 shrink-0" />
          {expanded && (
            <span className="whitespace-nowrap">Settings</span>
          )}
        </Link>
        <button
          onClick={() => setExpanded(!expanded)}
          className={cn(
            "flex w-full items-center py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors",
            expanded ? "gap-3 px-4" : "justify-center"
          )}
        >
          {expanded ? (
            <PanelLeftClose className="size-4 shrink-0" />
          ) : (
            <PanelLeftOpen className="size-4 shrink-0" />
          )}
          {expanded && (
            <span className="whitespace-nowrap">Collapse</span>
          )}
        </button>
      </div>
    </aside>
  );
}
