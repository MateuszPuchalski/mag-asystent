import { cn } from "@/lib/utils";

/* Kod kreskowy — motyw skanowania WERTIS. */
export function Barcode({
  className,
  color = "currentColor",
}: {
  className?: string;
  color?: string;
}) {
  return (
    <svg viewBox="0 0 24 16" className={className} aria-hidden>
      <g fill={color}>
        <rect x="0" y="0" width="2" height="16" />
        <rect x="4" y="0" width="1" height="16" />
        <rect x="7" y="0" width="3" height="16" />
        <rect x="12" y="0" width="1" height="16" />
        <rect x="15" y="0" width="2" height="16" />
        <rect x="19" y="0" width="1" height="16" />
        <rect x="22" y="0" width="2" height="16" />
      </g>
    </svg>
  );
}

/* Zębatka-spinner (motyw logo). */
export function Cog({
  className,
  color = "#F7A600",
  hole = "#ffffff",
  spinning = true,
  style,
}: {
  className?: string;
  color?: string;
  hole?: string;
  spinning?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn(spinning && "anim-spin", className)}
      style={style}
      aria-hidden
    >
      <g fill={color}>
        <rect x="10.6" y="0.5" width="2.8" height="5" rx="1.2" />
        <rect x="10.6" y="18.5" width="2.8" height="5" rx="1.2" />
        <rect x="0.5" y="10.6" width="5" height="2.8" rx="1.2" />
        <rect x="18.5" y="10.6" width="5" height="2.8" rx="1.2" />
        <rect x="10.6" y="0.5" width="2.8" height="5" rx="1.2" transform="rotate(45 12 12)" />
        <rect x="10.6" y="18.5" width="2.8" height="5" rx="1.2" transform="rotate(45 12 12)" />
        <rect x="0.5" y="10.6" width="5" height="2.8" rx="1.2" transform="rotate(45 12 12)" />
        <rect x="18.5" y="10.6" width="5" height="2.8" rx="1.2" transform="rotate(45 12 12)" />
        <circle cx="12" cy="12" r="7" />
        <circle cx="12" cy="12" r="3" fill={hole} />
      </g>
    </svg>
  );
}
