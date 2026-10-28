"use client";

import * as React from "react";
import {
  onAuthStateChanged,
  signInWithPopup,
  GoogleAuthProvider,
  signOut as fbSignOut,
  type User,
} from "firebase/auth";
import { firebaseAuth, isFirebaseConfigured } from "@/lib/firebase";
import { setAuthTokenGetter } from "@/lib/api";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  configured: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = React.createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<User | null>(null);
  const [loading, setLoading] = React.useState(true);

  const getIdToken = React.useCallback(async () => {
    if (!user) return null;
    try {
      return await user.getIdToken();
    } catch {
      return null;
    }
  }, [user]);

  const getIdTokenRef = React.useRef(getIdToken);
  getIdTokenRef.current = getIdToken;

  React.useEffect(() => {
    setAuthTokenGetter(() => getIdTokenRef.current());
    return () => setAuthTokenGetter(null);
  }, []);

  React.useEffect(() => {
    if (!firebaseAuth) {
      setLoading(false);
      return;
    }
    const unsub = onAuthStateChanged(firebaseAuth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const signIn = React.useCallback(async () => {
    if (!firebaseAuth) return;
    const provider = new GoogleAuthProvider();
    await signInWithPopup(firebaseAuth, provider);
  }, []);

  const signOut = React.useCallback(async () => {
    if (!firebaseAuth) return;
    await fbSignOut(firebaseAuth);
    // Clear local state and reload to ensure fresh data for next login
    if (typeof window !== "undefined") {
      // Clear local storage data that might be user-specific
      try {
        window.localStorage.removeItem("helium-theme");
        window.localStorage.removeItem("helium-reviewer");
        window.localStorage.removeItem("helium-topk");
        // Don't remove tour completion - that's not user-specific
      } catch {
        // ignore
      }
      // Reload page to ensure clean state
      window.location.href = "/";
    }
  }, []);

  const value: AuthContextValue = {
    user,
    loading,
    configured: isFirebaseConfigured,
    signIn,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
