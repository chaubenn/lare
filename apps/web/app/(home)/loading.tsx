import { PostCardSkeleton, Skeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <div role="status" className="space-y-4" aria-busy="true" aria-label="Loading feed">
      <Skeleton className="h-7 w-24" />
      <PostCardSkeleton />
      <PostCardSkeleton />
    </div>
  );
}
