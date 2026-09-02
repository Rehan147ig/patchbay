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
          className="block text-[11px] font-medium tracking-tight text-zinc-600 font-sans antialiased"
        >
          {label}
        </label>
      ) : null}
      <input
        ref={ref}
        id={inputId}
        className={cn(
          "w-full h-10 rounded-xl border border-zinc-200 bg-white px-3.5 text-[13px] leading-none text-[#1d1d1f] placeholder:text-zinc-400",
          "shadow-sm transition-colors duration-150 font-sans antialiased",
          "focus:border-[#0071e3] focus:outline-none focus:ring-2 focus:ring-[#0071e3]/20",
          "disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-zinc-50",
          error ? "border-[#ff3b30] focus:border-[#ff3b30] focus:ring-[#ff3b30]/20" : "",
          className,
        )}
        {...props}
      />
      {error ? (
        <p className="text-[12px] font-medium text-[#ff3b30]">{error}</p>
      ) : hint ? (
        <p className="text-[12px] text-zinc-500">{hint}</p>
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
          className="block text-[11px] font-medium tracking-tight text-zinc-600 font-sans antialiased"
        >
          {label}
        </label>
      ) : null}
      <textarea
        ref={ref}
        id={inputId}
        rows={rows}
        className={cn(
          "w-full min-h-[80px] rounded-xl border border-zinc-200 bg-white px-3.5 py-2.5 text-[13px] leading-relaxed text-[#1d1d1f] placeholder:text-zinc-400",
          "shadow-sm transition-colors duration-150 font-sans antialiased",
          "focus:border-[#0071e3] focus:outline-none focus:ring-2 focus:ring-[#0071e3]/20",
          "disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-zinc-50",
          error ? "border-[#ff3b30] focus:border-[#ff3b30] focus:ring-[#ff3b30]/20" : "",
          className,
        )}
        {...props}
      />
      {error ? (
        <p className="text-[12px] font-medium text-[#ff3b30]">{error}</p>
      ) : hint ? (
        <p className="text-[12px] text-zinc-500">{hint}</p>
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
          className="block text-[11px] font-medium tracking-tight text-zinc-600 font-sans antialiased"
        >
          {label}
        </label>
      ) : null}
      <select
        ref={ref}
        id={inputId}
        className={cn(
          "w-full h-10 rounded-xl border border-zinc-200 bg-white px-3.5 text-[13px] leading-none text-[#1d1d1f]",
          "shadow-sm transition-colors duration-150 font-sans antialiased",
          "focus:border-[#0071e3] focus:outline-none focus:ring-2 focus:ring-[#0071e3]/20",
          "disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-zinc-50",
          error ? "border-[#ff3b30] focus:border-[#ff3b30] focus:ring-[#ff3b30]/20" : "",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      {error ? (
        <p className="text-[12px] font-medium text-[#ff3b30]">{error}</p>
      ) : hint ? (
        <p className="text-[12px] text-zinc-500">{hint}</p>
      ) : null}
    </div>
  );
});
