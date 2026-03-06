"use client";

import { createContext, useContext, useState, useCallback } from "react";

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

export function AnonymousModeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isAnonymous, setIsAnonymous] = useState(false);

  const toggle = useCallback(() => {
    setIsAnonymous((prev) => {
      const next = !prev;
      if (next) {
        document.documentElement.classList.add("anonymous-mode");
      } else {
        document.documentElement.classList.remove("anonymous-mode");
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
