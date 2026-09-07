import { Container } from "@lare/ui/primitives";
import { PostCardSkeleton, Skeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <Container width="page" role="status" aria-busy="true" aria-label="Loading post">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Skeleton className="size-10 rounded-full" />
          <div className="space-y-1.5">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
        <PostCardSkeleton />
        <Skeleton className="h-24 w-full" />
      </div>
    </Container>
  );
}
