import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { User, PlatformId } from "./types.js";
import { installSessionExpiryHandler } from "./api.js";
import {
  AuthError,
  mergeSessionUser,
  postJson,
  startOAuthSignIn as startOAuthSignInRequest,
  fetchPendingOAuthSignup as fetchPendingOAuthSignupRequest,
  completeOAuthSignup as completeOAuthSignupRequest,
  startOAuthLink as startOAuthLinkRequest,
  unlinkOAuth as unlinkOAuthRequest,
  requestEmailCode,
  requestJson,
  requestResetCode,
  requestSignupCode,
  submitEmailCode,
  submitResetCode,
  submitSignupCode,
  type EmailCodeChallenge,
  type EmailVerifiedResult,
  type PasswordResetChallenge,
  type OAuthProvider,
  type PendingOAuthSignup
} from "./authApi.js";

// The error every auth call throws; defined in authApi.ts, re-exported here for
// the components that already import it from this file.
export { AuthError };
export type { EmailCodeChallenge, EmailVerifiedResult, PasswordResetChallenge };

export type SessionStatus = "loading" | "guest" | "authenticated";

// Returned when linking an extra platform account is started: the code the
// member must paste into a profile field of that account to prove it is theirs.
export interface PlatformLinkChallenge {
  code: string;
  platform: PlatformId | "leetcode";
  handle: string; // the platform's own spelling of the handle
  instructions: string; // where to put the code, written by the server per platform
  expiresInMinutes: number;
}

// The optional about-me fields editable from account settings.
export interface ProfileDetails {
  bio: string;
  github: string;
  linkedin: string;
  website: string;
}

interface AuthContextValue {
  status: SessionStatus;
  user: User | null;
  // True from the moment the server says the session is gone (expired, logged
  // out elsewhere, password changed on another device) until the member signs
  // in again; the sign-in screen explains it. A normal log out doesn't set it.
  sessionEnded: boolean;
  oauthProviders: OAuthProvider[];
  email: string | null;
  emailVerified: boolean;
  signInMethods: { password: boolean; providers: OAuthProvider[] };
  startOAuthSignIn: (provider: OAuthProvider) => void;
  fetchPendingOAuthSignup: () => Promise<PendingOAuthSignup>;
  completeOAuthSignup: (username: string, displayName?: string) => Promise<User>;
  startOAuthLink: (provider: OAuthProvider, currentPassword?: string) => Promise<string>;
  unlinkOAuth: (provider: OAuthProvider) => Promise<void>;
  // Sign in with the login name. Members who signed up with LeetCode before
  // login names existed use their LeetCode username (the same name, lowercase).
  login: (username: string, password: string) => Promise<User>;
  // Transitional legacy UI contract; removed when LoginModal is migrated in
  // Step 13. The OAuth sign-up contract is exposed above.
  startRegistration: (username: string, password: string, email: string, displayName?: string) => Promise<EmailCodeChallenge>;
  verifyRegistration: (code: string) => Promise<User>;
  logout: () => Promise<void>;
  // Transitional legacy UI contract; removed in Step 13.
  startPasswordReset: (email: string, newPassword: string) => Promise<PasswordResetChallenge>;
  verifyPasswordReset: (code: string) => Promise<User>;
  // Transitional legacy UI contract; removed when AccountPage is migrated in
  // Step 14.
  startEmailChange: (email: string, currentPassword: string) => Promise<EmailCodeChallenge>;
  verifyEmailChange: (code: string) => Promise<EmailVerifiedResult>;
  refreshSession: () => Promise<void>;
  updateDisplayName: (displayName: string) => Promise<User>;
  updateSchool: (school: string) => Promise<User>;
  updateProfileDetails: (details: ProfileDetails) => Promise<User>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  deleteAccount: (password: string) => Promise<void>;
  startPlatformLink: (platform: PlatformId, handle: string) => Promise<PlatformLinkChallenge>;
  verifyPlatformLink: (platform: PlatformId) => Promise<User>;
  unlinkPlatform: (platform: PlatformId) => Promise<User>;
  setPlatformHidden: (platform: PlatformId, hidden: boolean) => Promise<User>;
  setHideLeetcodeStats: (hidden: boolean) => Promise<User>;
  // LeetCode is linked through its own routes (its stats live on the member's
  // row, not in platform_accounts) but follows the same start -> code -> verify
  // flow. Optional, like the other platforms.
  startLeetcodeLink: (leetcodeUsername: string) => Promise<PlatformLinkChallenge>;
  verifyLeetcodeLink: () => Promise<User>;
  unlinkLeetcode: () => Promise<User>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [sessionEnded, setSessionEnded] = useState(false);
  const [oauthProviders, setOAuthProviders] = useState<OAuthProvider[]>([]);

  // Bumped on every sign-in and sign-out. A 401 that belongs to an older
  // session (a poll that was still in flight when the member logged out and
  // back in) must not end the new one.
  const epoch = useRef(0);
  const statusRef = useRef<SessionStatus>(status);
  useEffect(() => {
    epoch.current += 1;
    statusRef.current = status;
  }, [status]);

  // Any request that comes back "session required" ends the session here, so
  // every component (the board poll, the account page, admin tools...) is
  // covered without handling 401 itself.
  useEffect(
    () =>
      installSessionExpiryHandler(
        () => epoch.current,
        (startedIn) => {
          if (startedIn !== epoch.current || statusRef.current !== "authenticated") return;
          statusRef.current = "guest"; // several requests can fail at once; end it once
          setSessionEnded(true);
          setUser(null);
          setStatus("guest");
        }
      ),
    []
  );

  const refreshSession = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/session");
      const data = await res.json();
      setOAuthProviders(Array.isArray(data.oauthProviders) ? data.oauthProviders : []);
      if (data.status === "authenticated") {
        setUser((prev) => mergeSessionUser(prev, data.user));
        setSessionEnded(false);
        setStatus("authenticated");
      } else {
        setUser(null);
        setStatus("guest");
      }
    } catch {
      setUser(null);
      setStatus("guest");
    }
  }, []);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  const startOAuthSignIn = useCallback((provider: OAuthProvider) => {
    startOAuthSignInRequest(provider);
  }, []);

  const fetchPendingOAuthSignup = useCallback(() => fetchPendingOAuthSignupRequest(), []);

  const completeOAuthSignup = useCallback(async (username: string, displayName?: string) => {
    const data = await completeOAuthSignupRequest(username, displayName);
    setUser(data);
    setSessionEnded(false);
    setStatus("authenticated");
    await refreshSession();
    return data;
  }, [refreshSession]);

  const startOAuthLink = useCallback(async (provider: OAuthProvider, currentPassword?: string) => {
    const { url } = await startOAuthLinkRequest(provider, currentPassword);
    return url;
  }, []);

  const unlinkOAuth = useCallback(async (provider: OAuthProvider) => {
    await unlinkOAuthRequest(provider);
    await refreshSession();
  }, [refreshSession]);

  const login = useCallback(async (username: string, password: string) => {
    const data = await postJson<User>("/api/auth/login", { username, password });
    setUser(data);
    setSessionEnded(false);
    setStatus("authenticated");
    await refreshSession();
    return data;
  }, [refreshSession]);

  const startRegistration = useCallback(
    (username: string, password: string, email: string, displayName?: string) =>
      requestSignupCode(username, password, email, displayName),
    []
  );

  const verifyRegistration = useCallback(async (code: string) => {
    const data = await submitSignupCode(code);
    setUser(data);
    setSessionEnded(false);
    setStatus("authenticated");
    return data;
  }, []);

  const startPasswordReset = useCallback((email: string, newPassword: string) => requestResetCode(email, newPassword), []);

  const verifyPasswordReset = useCallback(async (code: string) => {
    const data = await submitResetCode(code);
    setUser(data);
    setSessionEnded(false);
    setStatus("authenticated");
    return data;
  }, []);

  const startEmailChange = useCallback((email: string, currentPassword: string) => requestEmailCode(email, currentPassword), []);

  const verifyEmailChange = useCallback(
    async (code: string) => {
      const result = await submitEmailCode(code);
      await refreshSession(); // the session is where the member's own address comes from
      return result;
    },
    [refreshSession]
  );

  const updateDisplayName = useCallback(async (displayName: string) => {
    const data = await requestJson<User>("PATCH", "/api/account/profile", { displayName });
    setUser((prev) => mergeSessionUser(prev, data));
    return data;
  }, []);

  // An empty string clears the school.
  const updateSchool = useCallback(async (school: string) => {
    const data = await requestJson<User>("PATCH", "/api/account/profile", { school });
    setUser((prev) => mergeSessionUser(prev, data));
    return data;
  }, []);

  // Empty strings clear a field. The server validates the links and answers
  // with a specific message when one isn't acceptable.
  const updateProfileDetails = useCallback(async (details: ProfileDetails) => {
    const data = await requestJson<User>("PATCH", "/api/account/profile", details);
    setUser((prev) => mergeSessionUser(prev, data));
    return data;
  }, []);

  // The server keeps this device signed in with a fresh cookie and signs out
  // every other session.
  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    await postJson("/api/account/password", { currentPassword, newPassword });
  }, []);

  const deleteAccount = useCallback(async (password: string) => {
    await postJson("/api/account/delete", { password });
    setUser(null);
    setStatus("guest");
  }, []);

  // Linked Codeforces / CodinGame accounts. Start asks the server for a proof
  // code, verify checks it on the public profile and links the account, unlink
  // removes it. The server answers with the updated member, so the session user
  // (and its `platforms`) stays current without another fetch.
  const startPlatformLink = useCallback(
    (platform: PlatformId, handle: string) =>
      postJson<PlatformLinkChallenge>(`/api/account/platforms/${platform}/start`, { handle }),
    []
  );

  const verifyPlatformLink = useCallback(async (platform: PlatformId) => {
    const data = await postJson<User>(`/api/account/platforms/${platform}/verify`);
    setUser((prev) => mergeSessionUser(prev, data));
    return data;
  }, []);

  const unlinkPlatform = useCallback(async (platform: PlatformId) => {
    const data = await requestJson<User>("DELETE", `/api/account/platforms/${platform}`);
    setUser((prev) => mergeSessionUser(prev, data));
    return data;
  }, []);

  // Hide a linked platform from other members (or show it again). Admins and
  // the member themself always see it; the server enforces this.
  const setPlatformHidden = useCallback(async (platform: PlatformId, hidden: boolean) => {
    const data = await requestJson<User>("PATCH", `/api/account/platforms/${platform}`, { hidden });
    setUser((prev) => mergeSessionUser(prev, data));
    return data;
  }, []);

  // Hide the member's LeetCode stats on their profile. They still count on the
  // leaderboard and in the global stats.
  const setHideLeetcodeStats = useCallback(async (hidden: boolean) => {
    const data = await requestJson<User>("PATCH", "/api/account/profile", { hideLeetcodeStats: hidden });
    setUser((prev) => mergeSessionUser(prev, data));
    return data;
  }, []);

  const startLeetcodeLink = useCallback(
    (leetcodeUsername: string) =>
      postJson<PlatformLinkChallenge>("/api/account/leetcode/start", { leetcodeUsername }),
    []
  );

  const verifyLeetcodeLink = useCallback(async () => {
    const data = await postJson<User>("/api/account/leetcode/verify");
    setUser((prev) => mergeSessionUser(prev, data));
    return data;
  }, []);

  const unlinkLeetcode = useCallback(async () => {
    const data = await requestJson<User>("DELETE", "/api/account/leetcode");
    setUser((prev) => mergeSessionUser(prev, data));
    return data;
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch("/api/logout", { method: "POST" });
    } finally {
      setUser(null);
      setStatus("guest");
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        status,
        user,
        sessionEnded,
        oauthProviders,
        email: user?.email ?? null,
        emailVerified: Boolean(user?.emailVerified),
        signInMethods: user?.signInMethods ?? { password: false, providers: [] },
        startOAuthSignIn,
        fetchPendingOAuthSignup,
        completeOAuthSignup,
        startOAuthLink,
        unlinkOAuth,
        login,
        startRegistration,
        verifyRegistration,
        logout,
        startPasswordReset,
        verifyPasswordReset,
        startEmailChange,
        verifyEmailChange,
        refreshSession,
        updateDisplayName,
        updateSchool,
        updateProfileDetails,
        changePassword,
        deleteAccount,
        startPlatformLink,
        verifyPlatformLink,
        unlinkPlatform,
        setPlatformHidden,
        setHideLeetcodeStats,
        startLeetcodeLink,
        verifyLeetcodeLink,
        unlinkLeetcode
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
