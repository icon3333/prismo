import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full border border-rule-2 bg-bg-2 px-3 py-2 font-mono text-[12px] text-ink outline-none transition-colors duration-[80ms] placeholder:text-ink-3 focus:border-cyan disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
