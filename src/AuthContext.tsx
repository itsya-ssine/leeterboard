import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { User, PlatformId } from "./types.js";

export type SessionStatus = "loading" | "guest" | "authenticated";

// Returned when a sign-up is started: the code the person must paste into
// their LeetCode profile summary to prove the account is theirs.
export interface RegistrationChallenge {
  code: string;
  // "create": new account · "claim": existing board entry that has no
  // password yet · "reset": existing account, setting a new password.
  purpose: "create" | "claim" | "reset";
  leetcodeUsername: string;
  expiresInMinutes: number;
}

// Returned when linking an extra platform account is started: the code the
// member must paste into a profile field of that account to prove it is theirs.
export interface PlatformLinkChallenge {
  code: string;
  platform: PlatformId;
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
  login: (leetcodeUsername: string, password: string) => Promise<User>;
  startRegistration: (leetcodeUsername: string, password: string, displayName?: string) => Promise<RegistrationChallenge>;
  verifyRegistration: () => Promise<User>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
  updateDisplayName: (displayName: string) => Promise<User>;
  updateSchool: (school: string) => Promise<User>;
  updateProfileDetails: (details: ProfileDetails) => Promise<User>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  deleteAccount: (password: string) => Promise<void>;
  startPlatformLink: (platform: PlatformId, handle: string) => Promise<PlatformLinkChallenge>;
  verifyPlatformLink: (platform: PlatformId) => Promise<User>;
  unlinkPlatform: (platform: PlatformId) => Promise<User>;
}

// Thrown for any non-2xx response; `expired` is set when the server says the
// sign-up in progress is gone and has to be started again.
export class AuthError extends Error {
  expired: boolean;
  constructor(message: string, expired = false) {
    super(message);
    this.name = "AuthError";
    this.expired = expired;
  }
}

async function requestJson<T>(method: string, url: string, body: unknown = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  } catch {
    throw new AuthError("Couldn't reach the server. Check your connection and try again.");
  }
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    // Non-JSON body (e.g. a proxy error page) — fall through to the generic message.
  }
  if (!res.ok) {
    throw new AuthError(data?.error || "Something went wrong. Please try again.", Boolean(data?.expired));
  }
  return data as T;
}

const postJson = <T,>(url: string, body: unknown = {}) => requestJson<T>("POST", url, body);

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>("loading");
  const [user, setUser] = useState<User | null>(null);

  const refreshSession = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/session");
      const data = await res.json();
      if (data.status === "authenticated") {
        setUser(data.user);
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

  const login = useCallback(async (leetcodeUsername: string, password: string) => {
    const data = await postJson<User>("/api/auth/login", { leetcodeUsername, password });
    setUser(data);
    setStatus("authenticated");
    return data;
  }, []);

  const startRegistration = useCallback(
    (leetcodeUsername: string, password: string, displayName?: string) =>
      postJson<RegistrationChallenge>("/api/auth/register", { leetcodeUsername, password, displayName }),
    []
  );

  const verifyRegistration = useCallback(async () => {
    const data = await postJson<User>("/api/auth/register/verify");
    setUser(data);
    setStatus("authenticated");
    return data;
  }, []);

  const updateDisplayName = useCallback(async (displayName: string) => {
    const data = await requestJson<User>("PATCH", "/api/account/profile", { displayName });
    setUser(data);
    return data;
  }, []);

  // An empty string clears the school.
  const updateSchool = useCallback(async (school: string) => {
    const data = await requestJson<User>("PATCH", "/api/account/profile", { school });
    setUser(data);
    return data;
  }, []);

  // Empty strings clear a field. The server validates the links and answers
  // with a specific message when one isn't acceptable.
  const updateProfileDetails = useCallback(async (details: ProfileDetails) => {
    const data = await requestJson<User>("PATCH", "/api/account/profile", details);
    setUser(data);
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
    setUser(data);
    return data;
  }, []);

  const unlinkPlatform = useCallback(async (platform: PlatformId) => {
    const data = await requestJson<User>("DELETE", `/api/account/platforms/${platform}`);
    setUser(data);
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
        login,
        startRegistration,
        verifyRegistration,
        logout,
        refreshSession,
        updateDisplayName,
        updateSchool,
        updateProfileDetails,
        changePassword,
        deleteAccount,
        startPlatformLink,
        verifyPlatformLink,
        unlinkPlatform
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
