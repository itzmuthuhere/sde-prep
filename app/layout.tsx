import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SDE Prep — Mock Interview",
  description: "Live AI mock-interview practice using your own Anthropic API key.",
};

const THEME_INIT = `try{document.documentElement.dataset.theme=localStorage.getItem('sdeprep:theme')||'dark'}catch(e){document.documentElement.dataset.theme='dark'}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
        <link rel="stylesheet" href="/style.css" />
      </head>
      <body>{children}</body>
    </html>
  );
}
