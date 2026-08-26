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
    <div className={cn("flex flex-col gap-3 pb-6 border-b border-ink-800/80 mb-6", className)}>
      {breadcrumbs && breadcrumbs.length > 0 ? (
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs text-ink-400">
          {breadcrumbs.map((crumb, idx) => {
            const isLast = idx === breadcrumbs.length - 1;
            return (
              <span key={crumb.label} className="flex items-center gap-1.5">
                {idx > 0 ? <span className="text-ink-600">/</span> : null}
                {crumb.href && !isLast ? (
                  <a href={crumb.href} className="transition-colors hover:text-gray-200">
                    {crumb.label}
                  </a>
                ) : (
                  <span className={cn(isLast ? "text-gray-200 font-medium" : "text-ink-400")}>
                    {crumb.label}
                  </span>
                )}
              </span>
            );
          })}
        </nav>
      ) : null}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-white">{title}</h1>
            {badge ? <div>{badge}</div> : null}
          </div>
          {description ? (
            <p className="text-xs sm:text-sm leading-relaxed text-ink-400 max-w-3xl">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? <div className="flex items-center gap-2.5 shrink-0">{actions}</div> : null}
      </div>
    </div>
  );
}
