import {
  excerptFromHtml,
  formatBeats,
  formatDurationHuman,
  formatRelativeTime,
} from "@lare/shared";
import { DifficultyBadge } from "@lare/ui";
import { Video } from "lucide-react";
import { Link } from "react-router";
import { Avatar } from "@/components/ui/Avatar";
import { Badge, KindBadge } from "@/components/ui/Badge";
import { bestAccepted } from "@/lib/json";
import type { FeedPost } from "./queries";

export function PostCard({ post }: { post: FeedPost }) {
  const author = post.profiles;
  const session = post.sessions;
  const problems = session?.session_problems ?? [];
  const name = author?.display_name ?? (author?.handle ? `@${author.handle}` : "Someone");
  const when = post.published_at ?? post.created_at;
  const excerpt = post.body ? excerptFromHtml(post.body, 220) : "";

  return (
    <Link
      to={`/posts/${post.id}`}
      className="block rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 transition-colors hover:border-zinc-700 hover:bg-zinc-900/70"
    >
      <div className="flex items-center gap-3">
        <Avatar url={author?.avatar_url} name={name} size={32} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm">
            <span className="truncate font-medium text-zinc-100">{name}</span>
            {author?.handle ? (
              <span className="truncate text-zinc-500">@{author.handle}</span>
            ) : null}
          </div>
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <span>{formatRelativeTime(when)}</span>
            {session ? (
              <>
                <span aria-hidden>·</span>
                <KindBadge kind={session.kind} />
                <span>{formatDurationHuman(session.active_ms)}</span>
              </>
            ) : null}
            {post.video_id ? (
              <Badge tone="emerald">
                <Video className="size-3" aria-hidden />
                video
              </Badge>
            ) : null}
          </div>
        </div>
      </div>

      {post.title ? (
        <h3 className="mt-3 text-base font-semibold text-zinc-100">{post.title}</h3>
      ) : null}
      {excerpt ? <p className="mt-1 text-sm leading-relaxed text-zinc-400">{excerpt}</p> : null}

      {problems.length > 0 ? (
        <ul className="mt-3 space-y-1.5">
          {problems.slice(0, 4).map((p) => {
            const best = bestAccepted(p.submissions);
            const beats = best ? formatBeats(best.runtime_percentile) : null;
            return (
              <li key={p.id} className="flex items-center gap-2 text-sm">
                <span className="truncate text-zinc-200">{p.title}</span>
                <DifficultyBadge difficulty={p.difficulty} />
                {best ? (
                  <span className="ml-auto shrink-0 text-xs text-zinc-500">
                    {best.runtime_display ??
                      (best.runtime_ms !== null ? `${best.runtime_ms} ms` : "")}
                    {beats ? ` · beats ${beats}` : ""}
                  </span>
                ) : (
                  <span className="ml-auto shrink-0 text-xs text-zinc-600">no accepted run</span>
                )}
              </li>
            );
          })}
          {problems.length > 4 ? (
            <li className="text-xs text-zinc-500">+{problems.length - 4} more</li>
          ) : null}
        </ul>
      ) : null}
    </Link>
  );
}
