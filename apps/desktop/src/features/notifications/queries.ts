import { describeNotification, NOTIFICATION_SELECT, parseNotifications } from "@lare/shared";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useUser } from "@/features/auth/AuthProvider";
import { type KeysetCursor, keysetFilter, nextCursor } from "@/lib/keyset";
import { whileOnline } from "@/lib/queryClient";
import { queryKeys, refresh } from "@/lib/queryKeys";
import { supabase, uniqueChannel } from "@/lib/supabase";
import { notifyDesktop } from "./desktopNotify";
import { DESKTOP_NOTIFICATION_LINKS } from "./links";

const NOTIFICATIONS_PAGE_SIZE = 50;

/** Newest first, a page at a time; `data` is every page loaded so far, flattened. */
export function useNotifications() {
  const { userId } = useUser();
  return useInfiniteQuery({
    queryKey: queryKeys.notifications.of(userId),
    initialPageParam: undefined as KeysetCursor | undefined,
    queryFn: async ({ pageParam }) => {
      let query = supabase.from("notifications").select(NOTIFICATION_SELECT);
      if (pageParam) query = query.or(keysetFilter("created_at", pageParam));
      const { data, error } = await query
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(NOTIFICATIONS_PAGE_SIZE);
      if (error) throw error;
      // The cursor comes from the raw rows: parsing drops malformed ones, and a short parsed page
      // must not be mistaken for the last.
      const rows = data ?? [];
      return {
        items: parseNotifications(rows),
        next: nextCursor(rows, NOTIFICATIONS_PAGE_SIZE, (row) => row.created_at),
      };
    },
    getNextPageParam: (lastPage) => lastPage.next,
    select: (data) => data.pages.flatMap((page) => page.items),
  });
}

export function useUnreadNotificationCount() {
  const { userId } = useUser();
  return useQuery({
    queryKey: queryKeys.notificationsUnread.of(userId),
    refetchInterval: whileOnline(120_000),
    queryFn: async () => {
      const { count, error } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .is("read_at", null);
      if (error) throw error;
      return count ?? 0;
    },
  });
}

export function useMarkNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[] | null) => {
      const { error } = await supabase.rpc("mark_notifications_read", { ids });
      if (error) throw error;
    },
    onSuccess: () => void refresh.notifications(queryClient),
  });
}

/** Keeps the list and badge live, and raises an OS notification for each new row. */
export function useNotificationStream() {
  const { userId } = useUser();
  const queryClient = useQueryClient();
  useEffect(() => {
    const channel = uniqueChannel(`notifications:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `recipient_id=eq.${userId}`,
        },
        (payload) => {
          void refresh.notifications(queryClient);
          const id = (payload.new as { id?: unknown }).id;
          if (typeof id === "string") void announce(id);
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, queryClient]);
}

async function announce(id: string) {
  const { data } = await supabase
    .from("notifications")
    .select(NOTIFICATION_SELECT)
    .eq("id", id)
    .maybeSingle();
  const [notification] = parseNotifications(data ? [data] : []);
  if (!notification) return;
  const { text, href } = describeNotification(notification, DESKTOP_NOTIFICATION_LINKS);
  await notifyDesktop(text, href);
}
