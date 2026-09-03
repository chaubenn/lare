import { Navigate, Outlet } from "react-router";
import { ErrorState, PageSpinner } from "@/components/ui/States";
import { useAuth } from "./AuthProvider";
import { OnboardingPage } from "./OnboardingPage";

/** Gate: restores the session, forces onboarding until a handle exists, then renders children. */
export function RequireAuth() {
  const { session, profile, profileLoading, profileError } = useAuth();
  if (session === undefined) return <PageSpinner label="Restoring your session…" />;
  if (!session) return <Navigate to="/login" replace />;
  if (profileLoading) return <PageSpinner label="Loading your profile…" />;
  if (profileError) {
    return (
      <div className="p-8">
        <ErrorState error={profileError} title="Couldn't load your profile" />
      </div>
    );
  }
  if (!profile || profile.handle === null) return <OnboardingPage />;
  return <Outlet />;
}
