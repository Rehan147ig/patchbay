import {
  forwardRef,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
  type SelectHTMLAttributes,
  type ReactNode,
} from "react";
import { cn } from "./cn";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, label, error, hint, id, ...props },
  ref,
) {
  const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, "-") : undefined);

  return (
    <div className="w-full space-y-1.5">
      {label ? (
        <label
          htmlFor={inputId}
          className="block text-xs font-semibold uppercase tracking-wider text-ink-300"
        >
          {label}
        </label>
      ) : null}
      <input
        ref={ref}
        id={inputId}
        className={cn(
          "w-full rounded-lg border border-ink-700 bg-ink-900/80 px-3.5 py-2 text-sm text-gray-100 placeholder:text-ink-500",
          "shadow-sm transition-all duration-150 backdrop-blur-sm",
          "focus:border-accent-500 focus:bg-ink-900 focus:outline-none focus:ring-2 focus:ring-accent-500/20",
          "disabled:cursor-not-allowed disabled:opacity-50",
          error ? "border-red-500 focus:border-red-500 focus:ring-red-500/20" : "",
          className,
        )}
        {...props}
      />
      {error ? (
        <p className="text-xs font-medium text-red-400">{error}</p>
      ) : hint ? (
        <p className="text-xs text-ink-400">{hint}</p>
      ) : null}
    </div>
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  hint?: ReactNode;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, label, error, hint, id, rows = 3, ...props },
  ref,
) {
  const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, "-") : undefined);

  return (
    <div className="w-full space-y-1.5">
      {label ? (
        <label
          htmlFor={inputId}
          className="block text-xs font-semibold uppercase tracking-wider text-ink-300"
        >
          {label}
        </label>
      ) : null}
      <textarea
        ref={ref}
        id={inputId}
        rows={rows}
        className={cn(
          "w-full rounded-lg border border-ink-700 bg-ink-900/80 px-3.5 py-2 text-sm text-gray-100 placeholder:text-ink-500",
          "shadow-sm transition-all duration-150 backdrop-blur-sm",
          "focus:border-accent-500 focus:bg-ink-900 focus:outline-none focus:ring-2 focus:ring-accent-500/20",
          "disabled:cursor-not-allowed disabled:opacity-50",
          error ? "border-red-500 focus:border-red-500 focus:ring-red-500/20" : "",
          className,
        )}
        {...props}
      />
      {error ? (
        <p className="text-xs font-medium text-red-400">{error}</p>
      ) : hint ? (
        <p className="text-xs text-ink-400">{hint}</p>
      ) : null}
    </div>
  );
});

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  hint?: ReactNode;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, label, error, hint, id, children, ...props },
  ref,
) {
  const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, "-") : undefined);

  return (
    <div className="w-full space-y-1.5">
      {label ? (
        <label
          htmlFor={inputId}
          className="block text-xs font-semibold uppercase tracking-wider text-ink-300"
        >
          {label}
        </label>
      ) : null}
      <select
        ref={ref}
        id={inputId}
        className={cn(
          "w-full rounded-lg border border-ink-700 bg-ink-900/80 px-3.5 py-2 text-sm text-gray-100",
          "shadow-sm transition-all duration-150 backdrop-blur-sm",
          "focus:border-accent-500 focus:bg-ink-900 focus:outline-none focus:ring-2 focus:ring-accent-500/20",
          "disabled:cursor-not-allowed disabled:opacity-50",
          error ? "border-red-500 focus:border-red-500 focus:ring-red-500/20" : "",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      {error ? (
        <p className="text-xs font-medium text-red-400">{error}</p>
      ) : hint ? (
        <p className="text-xs text-ink-400">{hint}</p>
      ) : null}
    </div>
  );
});
