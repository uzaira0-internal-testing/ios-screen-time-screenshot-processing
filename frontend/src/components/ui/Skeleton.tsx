import { clsx } from "clsx";

interface SkeletonProps {
  className?: string;
  width?: string | number;
  height?: string | number;
  circle?: boolean;
  count?: number;
}

function SkeletonLine({ className, width, height, circle }: Omit<SkeletonProps, "count">) {
  return (
    <div
      className={clsx(
        "animate-pulse bg-slate-200 dark:bg-slate-700 rounded",
        circle && "rounded-full",
        className,
      )}
      style={{
        width: width ?? "100%",
        height: height ?? "1rem",
      }}
    />
  );
}

export function Skeleton({ count = 1, ...props }: SkeletonProps) {
  if (count === 1) return <SkeletonLine {...props} />;
  return (
    <div className="space-y-2">
      {Array.from({ length: count }, (_, i) => (
        <SkeletonLine key={i} {...props} />
      ))}
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-5 shadow-sm space-y-3">
      <Skeleton height="1.25rem" width="60%" />
      <Skeleton height="0.875rem" count={3} />
    </div>
  );
}
