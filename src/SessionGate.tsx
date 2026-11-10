import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { useAuth } from "./AuthContext.js";
import LoginModal from "./LoginModal.js";
import { gateView } from "./sessionGate.js";
import { SESSION_ENDED_MESSAGE } from "./api.js";

// Renders the app only while a member is signed in. Because the app is what
// fetches data and runs the polling and sync timers, those start when a session
// exists and stop (the app unmounts) as soon as it ends, whether by logging out
// or by the session expiring.
export default function SessionGate({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const view = gateView(status);

  if (view === "loading") {
    return (
      <main className="grid min-h-dvh place-items-center" aria-busy="true">
        <div role="status" className="flex items-center gap-2 text-sm text-mist-400">
          <Loader2 className="size-4 animate-spin text-teal-300" aria-hidden="true" />
          Checking your session…
        </div>
      </main>
    );
  }

  if (view === "auth") return <AuthScreen />;

  return <>{children}</>;
}

// The only thing a visitor without a session sees: the sign-in dialog, which
// can't be dismissed because there is nothing behind it to go back to.
function AuthScreen() {
  const { sessionEnded } = useAuth();
  return (
    <main className="min-h-dvh">
      <header className="px-6 py-6 font-logo text-lg font-semibold tracking-tight text-strong sm:px-10">Leeterboard</header>
      <LoginModal open dismissible={false} onClose={() => {}} notice={sessionEnded ? SESSION_ENDED_MESSAGE : undefined} />
    </main>
  );
}
