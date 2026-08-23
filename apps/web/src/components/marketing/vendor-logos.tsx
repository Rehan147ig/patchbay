const ROW_A = [
  { name: "OpenAI", mark: "openai", color: "#10a37f" },
  { name: "stripe", mark: "stripe", color: "#635bff" },
  { name: "twilio", mark: "twilio", color: "#f22f46" },
  { name: "Anthropic", mark: "anthropic", color: "#d97757" },
  { name: "aws", mark: "aws", color: "#ff9900" },
];

const ROW_B = [
  { name: "supabase", mark: "supabase", color: "#3ecf8e" },
  { name: "Auth0", mark: "auth0", color: "#eb5424" },
  { name: "Google Cloud", mark: "gcp", color: "#4285f4" },
  { name: "MongoDB", mark: "mongodb", color: "#47a248" },
  { name: "SendGrid", mark: "sendgrid", color: "#51a9e3" },
];

/** Minimal geometric marks per vendor — recognizable silhouettes, no trademark paths. */
function VendorMark({ mark }: { mark: string }) {
  const cls = "size-5";
  switch (mark) {
    case "openai":
      return (
        <svg viewBox="0 0 24 24" className={cls} fill="currentColor" aria-hidden>
          <path d="M12 2l2.4 4.15L19 5l-.6 4.7L22.5 12 18.4 14.3 19 19l-4.6-1.15L12 22l-2.4-4.15L5 19l.6-4.7L1.5 12 5.6 9.7 5 5l4.6 1.15L12 2z" />
        </svg>
      );
    case "stripe":
      return (
        <svg
          viewBox="0 0 24 24"
          className={cls}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          aria-hidden
        >
          <path d="M3 17c3 1.5 9 1.5 9-2s-9-1-9-4.5S12 7 15 8" strokeLinecap="round" />
        </svg>
      );
    case "twilio":
      return (
        <svg
          viewBox="0 0 24 24"
          className={cls}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden
        >
          <circle cx="12" cy="12" r="9" />
          <circle cx="9" cy="10" r="1.4" fill="currentColor" stroke="none" />
          <circle cx="15" cy="10" r="1.4" fill="currentColor" stroke="none" />
          <circle cx="9" cy="14" r="1.4" fill="currentColor" stroke="none" />
          <circle cx="15" cy="14" r="1.4" fill="currentColor" stroke="none" />
        </svg>
      );
    case "anthropic":
      return (
        <svg viewBox="0 0 24 24" className={cls} fill="currentColor" aria-hidden>
          <path d="M10 4L3 20h4l1.4-3.6h7.2L17 20h4L14 4h-4zm0 9l2.1-5.4L14.2 13H10z" />
        </svg>
      );
    case "aws":
      return (
        <svg
          viewBox="0 0 24 24"
          className={cls}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden
        >
          <path d="M4 16c4 3 12 3 16-1" strokeLinecap="round" />
          <path d="M18 13l2.5 2-3 1.5" strokeLinecap="round" strokeLinejoin="round" />
          <text
            x="12"
            y="11"
            textAnchor="middle"
            fontSize="9"
            fontWeight="700"
            fill="currentColor"
            stroke="none"
          >
            aws
          </text>
        </svg>
      );
    case "supabase":
      return (
        <svg viewBox="0 0 24 24" className={cls} fill="currentColor" aria-hidden>
          <path d="M13 2L4 14h6v8l9-12h-6V2z" />
        </svg>
      );
    case "auth0":
      return (
        <svg viewBox="0 0 24 24" className={cls} fill="currentColor" aria-hidden>
          <path d="M12 2l8 3v6c0 5-3.5 9.5-8 11-4.5-1.5-8-6-8-11V5l8-3zm0 5a5 5 0 100 10 5 5 0 000-10z" />
        </svg>
      );
    case "gcp":
      return (
        <svg
          viewBox="0 0 24 24"
          className={cls}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          aria-hidden
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 4a8 8 0 017.4 5M12 20a8 8 0 01-7.4-5" strokeLinecap="round" />
        </svg>
      );
    case "mongodb":
      return (
        <svg viewBox="0 0 24 24" className={cls} fill="currentColor" aria-hidden>
          <path d="M12 2c3 4 5 6.5 5 10a5 5 0 01-4 4.9L12 22l-1-5.1A5 5 0 017 12c0-3.5 2-6 5-10z" />
        </svg>
      );
    default:
      return (
        <svg
          viewBox="0 0 24 24"
          className={cls}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          aria-hidden
        >
          <rect x="4" y="4" width="16" height="16" rx="4" />
          <path d="M9 12h6M12 9v6" strokeLinecap="round" />
        </svg>
      );
  }
}

function LogoRow({
  vendors,
  reverse = false,
}: {
  vendors: Array<{ name: string; mark: string; color: string }>;
  reverse?: boolean;
}) {
  const doubled = [...vendors, ...vendors];
  return (
    <div className="relative flex overflow-hidden" aria-hidden={reverse}>
      {reverse && (
        <>
          <span className="sr-only">{vendors.map((v) => v.name).join(", ")}</span>
        </>
      )}
      <div
        className={`flex w-max shrink-0 items-center gap-14 px-7 ${
          reverse ? "animate-marquee-reverse" : "animate-marquee"
        }`}
      >
        {doubled.map((vendor, index) => (
          <span
            key={`${vendor.name}-${index}`}
            className="group flex shrink-0 items-center gap-2.5 text-xl font-semibold tracking-tight text-gray-300 transition-colors duration-300 hover:text-[var(--brand)]"
            style={{ "--brand": vendor.color } as React.CSSProperties}
          >
            <VendorMark mark={vendor.mark} />
            {vendor.name}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Wall of supported SDK/API vendors: two opposing marquees, monochrome until
 * hover reveals each brand's color.
 */
export function VendorLogoWall() {
  return (
    <section aria-label="Supported SDKs and APIs" className="border-y border-gray-100 bg-white">
      <p className="pt-12 text-center text-sm font-medium text-gray-400">
        Certified migration kits and live detection for the SDKs your team ships with
      </p>
      <div className="mt-8 space-y-6 pb-12 [mask-image:linear-gradient(to_right,transparent,black_12%,black_88%,transparent)]">
        <LogoRow vendors={ROW_A} />
        <LogoRow vendors={ROW_B} reverse />
      </div>
    </section>
  );
}
