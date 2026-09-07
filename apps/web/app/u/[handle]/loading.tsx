import { Container } from "@lare/ui/primitives";
import { PostCardSkeleton, Skeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <Container width="page" role="status" aria-busy="true" aria-label="Loading profile">
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <Skeleton className="size-10 rounded-full" />
          <div className="space-y-1.5">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
        <Skeleton className="h-16 w-full" />
        <PostCardSkeleton />
        <PostCardSkeleton />
      </div>
    </Container>
  );
}
