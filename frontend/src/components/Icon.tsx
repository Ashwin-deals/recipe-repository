import type { ReactElement } from "react";

const PATHS = {
  hat: (
    <>
      <path d="M7 14.5a4 4 0 1 1 1.6-7.7 4 4 0 0 1 6.8 0A4 4 0 1 1 17 14.5V20H7z" />
      <path d="M7 17h10" />
    </>
  ),
  book: (
    <>
      <path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z" />
      <path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3" />
      <path d="M9 7.5h6" />
    </>
  ),
  list: (
    <>
      <path d="M10 6h10M10 12h10M10 18h10" />
      <path d="m3.5 6 1.5 1.5 2.5-3" />
      <path d="m3.5 12 1.5 1.5 2.5-3" />
      <path d="M4 18h3" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  chart: (
    <>
      <path d="M3 20.5h18" />
      <path d="M6.5 17v-6M12 17V5.5M17.5 17v-9" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  camera: (
    <>
      <path d="M4 8.5h3.2L9 6h6l1.8 2.5H20v10.5H4z" />
      <circle cx="12" cy="13.5" r="3.2" />
    </>
  ),
  trash: <path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5" />,
  swap: <path d="M5 8h13l-3.5-3.5M19 16H6l3.5 3.5" />,
  sparkle: <path d="M12 3.5 13.9 9l5.6 2-5.6 2L12 18.5 10.1 13l-5.6-2 5.6-2z" />,
  cart: (
    <>
      <path d="M3 4h2.2l2.3 10.5h10.2L20 7.5H6.2" />
      <circle cx="9" cy="19" r="1.4" />
      <circle cx="16.5" cy="19" r="1.4" />
    </>
  ),
  "wifi-off": (
    <>
      <path d="M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 12.5a10 10 0 0 1 4-2.3M14.8 10.2A10 10 0 0 1 19 12.5M2 9a15 15 0 0 1 4.3-2.6M11 5.6A15 15 0 0 1 22 9" />
      <circle cx="12" cy="20" r=".8" />
    </>
  ),
} satisfies Record<string, ReactElement>;

export type IconName = keyof typeof PATHS;

export function Icon({ name }: { name: IconName }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {PATHS[name]}
    </svg>
  );
}
