"use client";

import { useEffect } from "react";

/** Registers the service worker that makes the field app open offline. */
export default function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // A newer worker taking over means the page on screen may have come from the old one's cache.
    const hadController = Boolean(navigator.serviceWorker.controller);
    let reloaded = false;
    const onChange = () => {
      if (!hadController || reloaded) return;
      reloaded = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onChange);
    navigator.serviceWorker.register("/sw.js", { scope: "/field" }).catch(() => {
      /* no offline shell on this device; the app still works online */
    });
    return () => navigator.serviceWorker.removeEventListener("controllerchange", onChange);
  }, []);
  return null;
}
