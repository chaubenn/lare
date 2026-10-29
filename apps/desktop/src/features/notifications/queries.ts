import { describeNotification, NOTIFICATION_SELECT, parseNotifications } from "@lare/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useUser } from "@/features/auth/AuthProvider";
import { supabase } from "@/lib/supabase";
import { notifyDesktop } from "./desktopNotify";
import { DESKTOP_NOTIFICATION_LINKS } from "./links";

export function useNotifications() {
  const { userId } = useUser();
  return useQuery({
    queryKey: ["notifications", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select(NOTIFICATION_SELECT)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return parseNotifications(data);
    },
  });
}

export function useUnreadNotificationCount() {
  const { userId } = useUser();
  return useQuery({
    queryKey: ["notifications-unread", userId],
    refetchInterval: 120_000,
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
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
      void queryClient.invalidateQueries({ queryKey: ["notifications-unread"] });
    },
  });
}

/** Keeps the list and badge live, and raises an OS notification for each new row. */
export function useNotificationStream() {
  const { userId } = useUser();
  const queryClient = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel(`notifications:${userId}:${crypto.randomUUID()}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `recipient_id=eq.${userId}`,
        },
        (payload) => {
          void queryClient.invalidateQueries({ queryKey: ["notifications"] });
          void queryClient.invalidateQueries({ queryKey: ["notifications-unread"] });
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
  if (notification)
    await notifyDesktop(describeNotification(notification, DESKTOP_NOTIFICATION_LINKS).text);
}
