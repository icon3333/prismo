"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"

// Terminal §9.2 / §10 — Prismo has essentially no icons. Replace each toast type's
// lucide icon with a 6px solid colored dot: success→green, error→red, info→cyan, warning→amber.
// Loader stays as the mono FETCHING… text glyph (already in place from Phase 2).
const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: (
          <span className="inline-block w-1.5 h-1.5 bg-green" />
        ),
        info: (
          <span className="inline-block w-1.5 h-1.5 bg-cyan" />
        ),
        warning: (
          <span className="inline-block w-1.5 h-1.5 bg-amber" />
        ),
        error: (
          <span className="inline-block w-1.5 h-1.5 bg-red" />
        ),
        loading: (
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-amber">FETCHING…</span>
        ),
      }}
      style={
        {
          "--normal-bg": "var(--bg-1)",
          "--normal-text": "var(--ink)",
          "--normal-border": "var(--rule-2)",
          "--border-radius": "0",
        } as React.CSSProperties
      }
      toastOptions={{
        duration: 4000,
        classNames: {
          toast: "cn-toast border border-rule-2 bg-bg-1 text-ink duration-[80ms]",
          title: "font-mono text-[11px] uppercase tracking-[0.12em] text-ink",
          description: "font-sans text-[12px] text-ink-1",
        },
      }}
      position="bottom-right"
      {...props}
    />
  )
}

export { Toaster }
