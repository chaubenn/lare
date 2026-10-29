import { Navigate, Outlet } from "react-router";
import { ErrorState, PageSpinner } from "@/components/ui/States";
import { WindowScreen } from "@/components/ui/WindowScreen";
import { useAuth } from "./AuthProvider";
import { OnboardingPage } from "./OnboardingPage";
import { SetupGate } from "./SetupPage";

/** Gate: restores the session, forces onboarding until a handle exists, then renders children. */
export function RequireAuth() {
  const { session, profile, profileLoading, profileError } = useAuth();
  // These render without the shell, so they carry their own drag region: a window that cannot be
  // moved while the session is being restored is the worst place to leave someone.
  if (session === undefined)
    return (
      <WindowScreen>
        <PageSpinner label="Restoring your session…" />
      </WindowScreen>
    );
  if (!session) return <Navigate to="/login" replace />;
  if (profileLoading)
    return (
      <WindowScreen>
        <PageSpinner label="Loading your profile…" />
      </WindowScreen>
    );
  if (profileError) {
    return (
      <WindowScreen className="max-w-md">
        <ErrorState error={profileError} title="Couldn't load your profile" />
      </WindowScreen>
    );
  }
  if (!profile || profile.handle === null) return <OnboardingPage />;
  return (
    <SetupGate>
      <Outlet />
    </SetupGate>
  );
}
