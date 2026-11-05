import { Button } from "./Button";

/** The footer of a paged list, like the feed's: one button that fetches the next page. */
export function LoadMore({
  query,
}: {
  query: {
    hasNextPage: boolean;
    isFetchingNextPage: boolean;
    fetchNextPage: () => Promise<unknown>;
  };
}) {
  if (!query.hasNextPage) return null;
  return (
    <div className="flex justify-center pt-4">
      <Button
        onClick={() => void query.fetchNextPage()}
        loading={query.isFetchingNextPage}
        disabled={query.isFetchingNextPage}
      >
        Load more
      </Button>
    </div>
  );
}
