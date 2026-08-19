const VENDORS = [
  { name: "OpenAI", level: "Certified" },
  { name: "Stripe", level: "Certified" },
  { name: "Twilio", level: "Certified" },
  { name: "Anthropic", level: "Certified" },
  { name: "AWS SDK", level: "Certified" },
  { name: "Supabase", level: "Certified" },
  { name: "Auth0", level: "Plan-only" },
  { name: "Generic OpenAPI", level: "Assess" },
];

/** Infinite CSS marquee of tracked vendors (list duplicated for a seamless loop). */
export function VendorMarquee() {
  const row = [...VENDORS, ...VENDORS];
  return (
    <div
      className="relative overflow-hidden border-y border-white/8 py-5"
      aria-label="Tracked vendors"
    >
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-24 bg-gradient-to-r from-ink-950 to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24 bg-gradient-to-l from-ink-950 to-transparent" />
      <div className="flex w-max animate-marquee gap-10">
        {row.map((vendor, index) => (
          <span
            key={`${vendor.name}-${index}`}
            className="flex items-center gap-2.5 font-mono text-sm text-ink-400"
          >
            <span className="size-1.5 rounded-full bg-accent-500/70" />
            {vendor.name}
            <span className="text-xs text-ink-600">{vendor.level}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
