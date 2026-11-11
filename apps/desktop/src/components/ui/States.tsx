import { ErrorState as BaseErrorState } from "@lare/ui/primitives";
import type { ComponentProps } from "react";
import { isNetworkError, NETWORK_ERROR_MESSAGE } from "@/lib/errors";

export { EmptyState, ListSkeleton, PageSpinner, Spinner } from "@lare/ui/primitives";

/**
 * The shared error panel, but with a plain message when the request never left the machine:
 * "TypeError: Failed to fetch" tells nobody that they are offline.
 */
export function ErrorState({ error, ...props }: ComponentProps<typeof BaseErrorState>) {
  return (
    <BaseErrorState error={isNetworkError(error) ? NETWORK_ERROR_MESSAGE : error} {...props} />
  );
}
