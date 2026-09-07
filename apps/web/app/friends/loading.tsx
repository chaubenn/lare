import { Container } from "@lare/ui/primitives";
import { Skeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <Container width="page" role="status" aria-busy="true" aria-label="Loading friends">
      <div className="space-y-4">
        <Skeleton className="h-7 w-28" />
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    </Container>
  );
}
