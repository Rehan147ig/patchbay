import type { HTMLAttributes } from "react";
import { cn } from "./cn";

export interface CodeBlockProps extends HTMLAttributes<HTMLPreElement> {
  maxHeight?: string;
}

export function CodeBlock({ className, maxHeight = "24rem", ...props }: CodeBlockProps) {
  return (
    <pre
      className={cn(
        "overflow-auto rounded-lg bg-slate-950 p-4 font-mono text-xs leading-relaxed text-slate-100",
        className,
      )}
      style={{ maxHeight }}
      {...props}
    />
  );
}
