import type { HTMLAttributes } from "react";
import { cn } from "./cn";

export interface CodeBlockProps extends HTMLAttributes<HTMLPreElement> {
  maxHeight?: string;
}

export function CodeBlock({ className, maxHeight = "24rem", ...props }: CodeBlockProps) {
  return (
    <pre
      className={cn(
        "overflow-auto rounded-lg border border-ink-700/60 bg-ink-950 p-4 font-mono text-xs leading-relaxed text-gray-200",
        className,
      )}
      style={{ maxHeight }}
      {...props}
    />
  );
}
