"use client";

import { createContext, useContext, useState, useCallback, useEffect } from "react";

interface AnonymousModeContextType {
  isAnonymous: boolean;
  toggle: () => void;
}

const AnonymousModeContext = createContext<AnonymousModeContextType>({
  isAnonymous: false,
  toggle: () => {},
});

export function useAnonymousMode() {
  return useContext(AnonymousModeContext);
}

const STORAGE_KEY = "prismo.anon";

export function AnonymousModeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isAnonymous, setIsAnonymous] = useState(false);

  // §17.1 — restore from sessionStorage on mount.
  useEffect(() => {
    const restore = () => {
      if (typeof window === "undefined") return;
      try {
        const stored = window.sessionStorage.getItem(STORAGE_KEY);
        if (stored === "1") {
          setIsAnonymous(true);
          document.documentElement.classList.add("anonymous-mode");
        }
      } catch {
        // sessionStorage unavailable (private mode, etc.) — silent.
      }
    };
    restore();
  }, []);

  const toggle = useCallback(() => {
    setIsAnonymous((prev) => {
      const next = !prev;
      if (next) {
        document.documentElement.classList.add("anonymous-mode");
      } else {
        document.documentElement.classList.remove("anonymous-mode");
      }
      try {
        window.sessionStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  return (
    <AnonymousModeContext.Provider value={{ isAnonymous, toggle }}>
      {children}
    </AnonymousModeContext.Provider>
  );
}

export function SensitiveValue({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <span className={`sensitive-value ${className ?? ""}`}>{children}</span>;
}
