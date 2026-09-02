import type { HTMLAttributes } from "react";
import { cn } from "./cn";

export interface CodeBlockProps extends HTMLAttributes<HTMLPreElement> {
  maxHeight?: string;
}

export function CodeBlock({ className, maxHeight = "24rem", ...props }: CodeBlockProps) {
  return (
    <div className="overflow-hidden rounded-[16px] border border-zinc-800 bg-zinc-900 shadow-sm">
      <div className="flex items-center gap-1.5 border-b border-zinc-800 bg-zinc-900 px-4 py-3">
        <span
          aria-hidden="true"
          className="size-3 rounded-full bg-[#ff5f57] border border-[#e0443e]"
        />
        <span
          aria-hidden="true"
          className="size-3 rounded-full bg-[#ffbd2e] border border-[#dea123]"
        />
        <span
          aria-hidden="true"
          className="size-3 rounded-full bg-[#28c840] border border-[#1aab29]"
        />
      </div>
      <pre
        className={cn(
          "overflow-auto bg-zinc-900 p-4 font-mono text-xs leading-relaxed text-zinc-100",
          className,
        )}
        style={{ maxHeight }}
        {...props}
      />
    </div>
  );
}
