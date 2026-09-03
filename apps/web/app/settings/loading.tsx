import { Skeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <div
      role="status"
      className="mx-auto max-w-lg space-y-6"
      aria-busy="true"
      aria-label="Loading settings"
    >
      <Skeleton className="h-7 w-32" />
      <Skeleton className="h-96 w-full" />
      <Skeleton className="h-20 w-full" />
    </div>
  );
}
