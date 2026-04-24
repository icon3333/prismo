import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

// Terminal §9.3 — 30px, bg-2 fill, rule-2 border, mono 12px.
// Focus = cyan border swap (no ring; global :focus-visible adds the 2px box-shadow).
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-[30px] w-full min-w-0 border border-rule-2 bg-bg-2 px-3 py-1 font-mono text-[12px] text-ink outline-none transition-colors duration-[80ms] file:inline-flex file:h-6 file:border-0 file:bg-transparent file:font-mono file:text-[12px] file:font-medium file:text-ink placeholder:text-ink-3 focus:border-cyan disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Input }
