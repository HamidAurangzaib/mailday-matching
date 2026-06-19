export type HealthStatus = "green" | "yellow" | "red";

const CONFIG: Record<HealthStatus, { dot: string; ring: string; label: string }> = {
  green:  { dot: "bg-green-500",  ring: "ring-green-200",  label: "Healthy"         },
  yellow: { dot: "bg-amber-400",  ring: "ring-amber-200",  label: "Needs attention" },
  red:    { dot: "bg-red-500",    ring: "ring-red-200",    label: "At risk"         },
};

export function HealthDot({
  status,
  size = "sm",
}: {
  status: HealthStatus;
  size?: "sm" | "md";
}) {
  const c = CONFIG[status];
  const dim = size === "md" ? "w-3 h-3" : "w-2.5 h-2.5";
  return (
    <span
      className={`inline-block ${dim} rounded-full shrink-0 ring-1 ${c.dot} ${c.ring}`}
      title={c.label}
      aria-label={c.label}
    />
  );
}

export function HealthFilterBadge({
  status,
  active,
  count,
  onClick,
}: {
  status: HealthStatus;
  active: boolean;
  count?: number;
  onClick: () => void;
}) {
  const c = CONFIG[status];
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
        active
          ? status === "green"
            ? "bg-green-100 text-green-800 border-green-300"
            : status === "yellow"
            ? "bg-amber-100 text-amber-800 border-amber-300"
            : "bg-red-100 text-red-800 border-red-300"
          : "bg-muted/40 text-muted-foreground border-border hover:bg-muted/60"
      }`}
    >
      <span className={`w-2 h-2 rounded-full ${c.dot}`} />
      {c.label}
      {count !== undefined && <span className="font-bold">{count}</span>}
    </button>
  );
}
