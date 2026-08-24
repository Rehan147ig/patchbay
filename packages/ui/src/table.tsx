import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "./cn";

export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto rounded-xl border border-ink-700/60 bg-ink-800/50">
      <table className={cn("w-full min-w-full text-left text-sm", className)} {...props} />
    </div>
  );
}

export function TableHead({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={cn(
        "border-b border-ink-700 bg-ink-900/60 text-[11px] uppercase tracking-widest text-ink-400",
        className,
      )}
      {...props}
    />
  );
}

export function TableBody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn("divide-y divide-ink-700/40", className)} {...props} />;
}

export function TableRow({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn(
        "transition-all duration-150 hover:bg-ink-700/40 hover:shadow-[inset_3px_0_0_0_#6366f1]",
        className,
      )}
      {...props}
    />
  );
}

export function TableHeaderCell({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn("px-4 py-2.5 font-medium", className)} {...props} />;
}

export function TableCell({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("px-4 py-3 align-top text-gray-300", className)} {...props} />;
}
