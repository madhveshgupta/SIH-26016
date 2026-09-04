/**
 * The Bhoomi Nayan emblem — a sprout rising from the land: a soft sun behind two leaves on a
 * stem, over two field contours.
 */
export default function Emblem({
  variant = "color",
  className,
}: {
  variant?: "color" | "mono";
  className?: string;
}) {
  const mono = variant === "mono";
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" className={className}>
      {/* rising sun */}
      <circle cx="24" cy="21" r="11" className={mono ? "fill-current/15" : "fill-accent/15"} />
      {/* leaves */}
      <path
        d="M24 26c0-6.2-4.3-10.8-10.2-11.6C13.2 20.4 17 26 24 26Z"
        className={mono ? "fill-current" : "fill-brand"}
      />
      <path
        d="M24 26c0-6.2 4.3-10.8 10.2-11.6C34.8 20.4 31 26 24 26Z"
        className={mono ? "fill-current/70" : "fill-brand/70"}
      />
      {/* stem */}
      <path
        d="M24 26v-9"
        className={mono ? "stroke-current" : "stroke-brand"}
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />
      {/* land contours */}
      <path
        d="M6 34c6-3 12-3 18 0s12 3 18 0"
        className={mono ? "stroke-[#e5a06f]" : "stroke-accent"}
        strokeWidth="2.4"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M9 40c5-2.5 10-2.5 15 0s10 2.5 15 0"
        className={mono ? "stroke-current/45" : "stroke-brand/45"}
        strokeWidth="2.2"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}
