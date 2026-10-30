import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router";

/**
 * Step back through history, so the page you left (the feed, a profile) reappears where you were
 * scrolled to instead of being opened afresh. Only the first entry has the key "default"; if the
 * app was opened straight onto this page there is nothing to go back to, so go to `fallback`.
 */
export function useGoBack(fallback: string): () => void {
  const navigate = useNavigate();
  const { key } = useLocation();
  return useCallback(() => {
    if (key === "default") void navigate(fallback);
    else void navigate(-1);
  }, [navigate, key, fallback]);
}
