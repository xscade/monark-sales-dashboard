"use client";

import { useEffect } from "react";

export function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // Offline support is progressive enhancement; normal online capture must
      // remain usable if a locked-down device blocks service workers.
    });
  }, []);
  return null;
}
