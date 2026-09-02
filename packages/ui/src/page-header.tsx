import type { ReactNode } from "react";
import { cn } from "./cn";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  badge?: ReactNode;
  actions?: ReactNode;
  breadcrumbs?: BreadcrumbItem[];
  className?: string;
}

export function PageHeader({
  title,
  description,
  badge,
  actions,
  breadcrumbs,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn("flex flex-col gap-3 pb-6 border-b border-zinc-200/60 mb-6", className)}>
      {breadcrumbs && breadcrumbs.length > 0 ? (
        <nav
          aria-label="Breadcrumb"
          className="flex items-center gap-1.5 text-[12px] font-medium tracking-tight text-zinc-400 font-sans antialiased"
        >
          {breadcrumbs.map((crumb, idx) => {
            const isLast = idx === breadcrumbs.length - 1;
            return (
              <span key={crumb.label} className="flex items-center gap-1.5">
                {idx > 0 ? <span className="text-zinc-300">/</span> : null}
                {crumb.href && !isLast ? (
                  <a href={crumb.href} className="transition-colors hover:text-zinc-600">
                    {crumb.label}
                  </a>
                ) : (
                  <span className={cn(isLast ? "text-zinc-900" : "text-zinc-400")}>
                    {crumb.label}
                  </span>
                )}
              </span>
            );
          })}
        </nav>
      ) : null}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1.5">
          <div className="flex items-center gap-3">
            <h1 className="text-[24px] font-semibold tracking-tight text-[#1d1d1f] font-sans antialiased leading-none">
              {title}
            </h1>
            {badge ? <div>{badge}</div> : null}
          </div>
          {description ? (
            <p className="text-[13px] leading-relaxed text-zinc-500 max-w-3xl font-sans antialiased">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? <div className="flex items-center gap-2.5 shrink-0">{actions}</div> : null}
      </div>
    </div>
  );
}
