import { Skeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <div role="status" className="space-y-4" aria-busy="true" aria-label="Loading requests">
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-4 w-80" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
