import { describePostState, type PostState } from "@lare/shared";
import { Badge } from "./Badge";

/** "Pending" or "Not visible" on the author's own post while its videos are not ready. */
export function PostStateBadge({ state }: { state: PostState }) {
  const description = describePostState(state);
  if (!description) return null;
  return (
    <span title={description} className="inline-flex">
      <Badge tone={state === "failed" ? "rose" : "amber"}>
        {state === "failed" ? "Not visible" : "Pending"}
        <span className="sr-only">: {description}</span>
      </Badge>
    </span>
  );
}
