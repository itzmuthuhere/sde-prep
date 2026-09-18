"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const THEME_KEY = "sdeprep:theme";

export default function SiteHeader({ active }: { active?: "interview" | "settings" }) {
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const current = document.documentElement.getAttribute("data-theme");
    if (current === "light" || current === "dark") setTheme(current);
  }, []);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* localStorage unavailable (private mode, blocked storage) — theme still applies for this load */
    }
  }

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link className="brand" href="/">
          SDE<span>·</span>Prep
        </Link>
        <nav id="site-nav">
          <Link href="/">Home</Link>
          <Link href="/roadmap.html">Roadmap</Link>
          <Link href="/mock-interview" className={active === "interview" ? "active" : undefined}>
            Mock Interview
          </Link>
          <Link href="/settings" className={active === "settings" ? "active" : undefined}>
            Settings
          </Link>
        </nav>
        <button className="theme-toggle" type="button" onClick={toggleTheme}>
          {theme === "dark" ? "☾ Dark" : "☀ Light"}
        </button>
      </div>
    </header>
  );
}
