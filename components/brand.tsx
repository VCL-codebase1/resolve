"use client";

import { useEffect, useState } from "react";

export function Logo({ className = "w-40" }: { className?: string }) {
  return (
    <img
      src="/resolve-logo.png"
      alt="Resolve"
      className={`block h-auto max-w-full object-contain object-left ${className}`}
      width={1024}
      height={195}
      decoding="async"
    />
  );
}

export function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("desk-theme", next ? "dark" : "light");
    setDark(next);
  }

  return (
    <button
      type="button"
      className="inline-flex size-11 items-center justify-center rounded-full text-action hover:bg-wash"
      onClick={toggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      aria-pressed={dark}
    >
      {dark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 14.5A8.2 8.2 0 0 1 9.5 4 7 7 0 1 0 20 14.5Z" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v1.8M12 19.2V21M3 12h1.8M19.2 12H21M5.4 5.4l1.3 1.3M17.3 17.3l1.3 1.3M18.6 5.4l-1.3 1.3M6.7 17.3l-1.3 1.3" />
    </svg>
  );
}
