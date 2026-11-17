import type { ReactNode } from 'react';

const PATHS = {
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </>
  ),
  micOff: (
    <>
      <path d="M9 9v2a3 3 0 0 0 4.5 2.6M15 10.5V6a3 3 0 0 0-5.7-1.3" />
      <path d="M5 11a7 7 0 0 0 11 5.7M19 11a7 7 0 0 1-.6 2.8M12 18v3M4 4l16 16" />
    </>
  ),
  cam: (
    <>
      <rect x="3" y="6.5" width="12" height="11" rx="2.5" />
      <path d="m15 10.5 6-3v9l-6-3" />
    </>
  ),
  camOff: (
    <>
      <path d="M15 13.5v1.5a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 3 15V9a2.5 2.5 0 0 1 2-2.4M10 6.5h2.5A2.5 2.5 0 0 1 15 9v1.5l6-3v9" />
      <path d="M4 4l16 16" />
    </>
  ),
  swap: <path d="M7 4 3 8l4 4M3 8h13M17 12l4 4-4 4M21 16H8" />,
  expand: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  shrink: <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />,
  share: (
    <>
      <path d="M12 15V3M8 7l4-4 4 4" />
      <path d="M5 12v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
    </>
  ),
  leave: (
    <>
      <path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4" />
      <path d="M15 8l4 4-4 4M19 12H9" />
    </>
  ),
  play: <path d="M7 4.5v15l12-7.5z" fill="currentColor" />,
  pause: (
    <>
      <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" />
      <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" />
    </>
  ),
  paste: (
    <>
      <rect x="6" y="5" width="12" height="16" rx="2" />
      <path d="M9 5a1 1 0 0 1 1-2h4a1 1 0 0 1 1 2M9.5 11h5M9.5 15h5" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
