export function Spinner({
  className = "size-5 text-action",
  label = "Loading",
}: {
  className?: string;
  label?: string;
}) {
  return (
    <span role="status" className="inline-flex shrink-0">
      <svg className={`spinner ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.28" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function SpinnerBlock({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center px-4 py-14">
      <Spinner className="size-7 text-action" label={label} />
    </div>
  );
}

export function PendingLabel({ pending, idle, busy }: { pending: boolean; idle: string; busy: string }) {
  if (!pending) return idle;
  return (
    <span className="inline-flex items-center justify-center gap-2">
      <Spinner className="size-4 text-current" label={busy} />
      {busy}
    </span>
  );
}
