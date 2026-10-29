/**
 * The redesign's line icons, drawn like the brand's icon set: one uniform 1.8 stroke,
 * rounded ends, `currentColor` so they follow the control's ink. Decorative everywhere —
 * the control carrying one has its own accessible name. The two third-party marks at the
 * end (Google, GitHub) are the companies' own logos, not line icons.
 */
import type { ReactNode } from 'react';

type IconProps = { className?: string };

function Svg({ className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function ArrowLeftIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M19 12H5M11 18l-6-6 6-6" />
    </Svg>
  );
}

export function ChevronRightIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m9 6 6 6-6 6" />
    </Svg>
  );
}

export function MailIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <path d="m4 7 8 6 8-6" />
    </Svg>
  );
}

/** A written list: the twelve words. */
export function WordsIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="4" y="3" width="16" height="18" rx="3" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </Svg>
  );
}

/** A person: an account. */
export function AccountIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
    </Svg>
  );
}

/** A QR code: easy recovery's door from another Cosmos Wallet. */
export function QrIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1.2" />
      <rect x="14" y="3.5" width="6.5" height="6.5" rx="1.2" />
      <rect x="3.5" y="14" width="6.5" height="6.5" rx="1.2" />
      <path d="M14 14h2.5v2.5H14zM18 18h2.5v2.5H18zM14 20.5h1.5M20.5 14v1.5" />
    </Svg>
  );
}

/** Into a tray: bringing an account in from another wallet. */
export function ImportIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3.5v11M7.5 10l4.5 4.5 4.5-4.5" />
      <path d="M4 15.5v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </Svg>
  );
}

export function InfoIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 7.5v.01" />
    </Svg>
  );
}

export function WarningIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M10.3 4.2 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z" />
      <path d="M12 9.5v4M12 17v.01" />
    </Svg>
  );
}

export function ChevronDownIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m6 9 6 6 6-6" />
    </Svg>
  );
}

export function CheckIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </Svg>
  );
}

export function CloseIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Svg>
  );
}

/** `sun` and `moon` name a theme; `system` is the phone itself. */
export function ThemeIcon({ kind, className }: IconProps & { kind: 'sun' | 'moon' | 'system' }) {
  if (kind === 'sun') {
    return (
      <Svg className={className}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
      </Svg>
    );
  }
  if (kind === 'moon') {
    return (
      <Svg className={className}>
        <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
      </Svg>
    );
  }
  return (
    <Svg className={className}>
      <rect x="6.5" y="2.5" width="11" height="19" rx="3" />
      <path d="M12 7.5a4.5 4.5 0 0 1 0 9z" />
    </Svg>
  );
}

/** Google's "G", in its own four colours on any theme. */
/* ---- the wallet's own screens (Figma "Cosmos Wallet": Home, its tabs and its bar) ---- */

export function HomeIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5H15v-6H9v6H5.5A1.5 1.5 0 0 1 4 19z" />
    </Svg>
  );
}

/** A wallet: the wallets on this device and their addresses. */
export function WalletIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H17a1 1 0 0 1 1 1v2" />
      <rect x="4" y="7.5" width="16" height="12" rx="2.5" />
      <path d="M16 13.5h1.5" />
    </Svg>
  );
}

/** A scan frame: the camera reads a QR. */
export function ScanIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 8.5V6a2 2 0 0 1 2-2h2.5M15.5 4H18a2 2 0 0 1 2 2v2.5M20 15.5V18a2 2 0 0 1-2 2h-2.5M8.5 20H6a2 2 0 0 1-2-2v-2.5" />
      <rect x="8.5" y="8.5" width="7" height="7" rx="1.2" />
    </Svg>
  );
}

/** A coin with a percent: earning. */
export function EarnIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9 15l6-6M9.5 9.5h.01M14.5 14.5h.01" />
    </Svg>
  );
}

/** Three lines: more. */
export function MenuIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 7h16M4 12h16M4 17h10" />
    </Svg>
  );
}

/** A paper plane: send. */
export function SendIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M20.5 3.5 10 14M20.5 3.5 14 20.5l-4-6.5-6.5-4z" />
    </Svg>
  );
}

/** An arrow down and in: receive. */
export function ReceiveIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M17 7 7 17M7 9v8h8" />
    </Svg>
  );
}

/** An arrow up and out: sent. */
export function SentIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M7 17 17 7M9 7h8v8" />
    </Svg>
  );
}

/** A receipt with a percent on it: a commission, set apart from a send's arrow. */
export function FeeIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M6 3.5h12v17l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5-2 1.5z" />
      <path d="M9.5 14l5-5M9.75 9.25h.01M14.25 13.75h.01" />
    </Svg>
  );
}

/** Two opposite arrows: exchange. */
export function ExchangeIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 8h15l-3.5-3.5M20 16H5l3.5 3.5" />
    </Svg>
  );
}

export function DotsIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M6 12h.01M12 12h.01M18 12h.01" />
    </Svg>
  );
}

export function ClipboardIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="8" y="3" width="8" height="4" rx="1.5" />
      <path d="M16 5h1.5A1.5 1.5 0 0 1 19 6.5v13a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19.5v-13A1.5 1.5 0 0 1 6.5 5H8" />
    </Svg>
  );
}

export function SearchIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </Svg>
  );
}

export function BellIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </Svg>
  );
}

export function GearIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </Svg>
  );
}

/** A globe: the network. */
export function GlobeIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.4 2.3 3.5 5.2 3.5 8.5s-1.1 6.2-3.5 8.5c-2.4-2.3-3.5-5.2-3.5-8.5S9.6 5.8 12 3.5z" />
    </Svg>
  );
}

export function CopyIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="9" y="9" width="11" height="11" rx="2.5" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </Svg>
  );
}

export function PlusIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

/** A shield with a check: the account can be recovered. */
export function ShieldIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3.5 5 6.5v5c0 4.4 3 7.9 7 9 4-1.1 7-4.6 7-9v-5z" />
      <path d="m9 12 2 2 4-4" />
    </Svg>
  );
}

export function TrendUpIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m3.5 16.5 6-6 4 4 7-7M15 7.5h5.5V13" />
    </Svg>
  );
}

export function TrendDownIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m3.5 7.5 6 6 4-4 7 7M15 16.5h5.5V11" />
    </Svg>
  );
}

export function StarIcon({ className, filled = false }: IconProps & { filled?: boolean }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="m12 3.8 2.5 5.1 5.6.8-4 4 .9 5.6-5-2.7-5 2.7.9-5.6-4-4 5.6-.8z" />
    </svg>
  );
}

/** A key: the recovery phrase and the secret key. */
export function KeyIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="8" cy="15" r="4" />
      <path d="m11 12 8.5-8.5M16 7l2.5 2.5M14 9l2 2" />
    </Svg>
  );
}

export function LockIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </Svg>
  );
}

/** Two devices: transfer a wallet to another one. */
export function DevicesIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="5" width="12" height="9" rx="2" />
      <path d="M6 18h6" />
      <rect x="16" y="9" width="5.5" height="11" rx="1.5" />
    </Svg>
  );
}

export function InfoCircleIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5M12 8h.01" />
    </Svg>
  );
}

/** A chain link: a payment link. */
export function LinkIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </Svg>
  );
}

/** A clock with an arrow: the activity list. */
export function ActivityIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6M3.5 4v4h4" />
      <path d="M12 8v4.5l3 2" />
    </Svg>
  );
}

/** A power line: lock the wallet now. */
export function PowerIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3.5v7.5M7 6.3a7.5 7.5 0 1 0 10 0" />
    </Svg>
  );
}

/** A pen: sign something. */
export function PenIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z" />
      <path d="m13.5 6.5 4 4" />
    </Svg>
  );
}

export function GoogleLogo({ className }: IconProps) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="#4285F4" d="M22.6 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h5.9a5 5 0 0 1-2.2 3.3v2.7h3.6c2.1-1.9 3.3-4.8 3.3-8.1z" />
      <path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.7c-1 .7-2.2 1.1-3.7 1.1-2.9 0-5.3-1.9-6.2-4.5H2.1v2.8A11 11 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.8 14.2a6.6 6.6 0 0 1 0-4.3V7.1H2.1a11 11 0 0 0 0 9.9l3.7-2.8z" />
      <path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A11 11 0 0 0 2.1 7.1l3.7 2.8C6.7 7.3 9.1 5.4 12 5.4z" />
    </svg>
  );
}

/** GitHub's mark, in the control's ink. */
export function GitHubLogo({ className }: IconProps) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M12 1.5a10.5 10.5 0 0 0-3.3 20.5c.5.1.7-.2.7-.5v-1.8c-2.9.6-3.5-1.4-3.5-1.4-.5-1.2-1.2-1.5-1.2-1.5-1-.7.1-.7.1-.7 1 .1 1.6 1.1 1.6 1.1.9 1.6 2.5 1.2 3.1.9.1-.7.4-1.2.7-1.4-2.3-.3-4.8-1.2-4.8-5.2 0-1.1.4-2.1 1.1-2.8-.1-.3-.5-1.4.1-2.8 0 0 .9-.3 2.9 1.1a10 10 0 0 1 5.2 0c2-1.4 2.9-1.1 2.9-1.1.6 1.4.2 2.5.1 2.8.7.7 1.1 1.7 1.1 2.8 0 4-2.5 4.9-4.8 5.2.4.3.7 1 .7 1.9v2.9c0 .3.2.6.7.5A10.5 10.5 0 0 0 12 1.5z" />
    </svg>
  );
}

/** The Cosmos isotype (public/brand/isotipo-mono.svg) inline, so it takes the ink of the
 *  control it sits in — an `<img>` of it cannot follow `currentColor`. */
export function CosmosMark({ className }: IconProps) {
  return (
    <svg className={className} width="20" height="20" viewBox="527.04 182.81 101.18 101.05" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M 599.14,254.82 C 590.71,263.23 578.05,264.86 567.98,259.72 L 557.35,269.27 C 564.03,273.85 571.91,276.33 580.18,276.33 C 590.98,276.33 601.15,272.12 608.79,264.47 C 614.9,258.37 618.83,250.65 620.16,242.15 L 606.66,240.04 C 605.78,245.66 603.18,250.77 599.14,254.82" />
      <path d="M 620.79,186.55 C 620.12,187.23 619.46,187.91 618.8,188.59 C 616.23,191.21 613.73,193.91 611.11,196.46 C 609.6,197.94 607.89,199.27 605.89,199.92 C 601.78,201.24 598.07,199.26 594.28,197.93 C 594.15,197.89 594.01,197.85 593.88,197.81 C 592.96,197.45 592.02,197.1 591.04,196.83 C 587.49,195.84 583.78,195.35 580.09,195.35 C 569.3,195.35 559.13,199.56 551.48,207.21 C 543.83,214.83 539.62,224.99 539.62,235.82 C 539.62,236.2 539.62,236.55 539.65,236.94 C 539.72,239.27 540.03,241.61 540.51,243.91 C 540.7,244.89 540.92,245.85 541.19,246.81 C 541.24,247 541.31,247.18 541.37,247.37 C 541.62,248.22 541.87,249.08 542.17,249.92 C 543.48,253.71 545.48,257.41 544.15,261.53 C 543.51,263.53 542.17,265.24 540.7,266.75 C 538.14,269.37 535.45,271.88 532.83,274.43 C 532.15,275.09 531.47,275.76 530.79,276.42 L 534.48,280.11 L 537.47,277.33 L 551.4,264.37 L 553.47,262.43 L 560.66,255.24 L 561.12,254.78 C 550.69,244.31 550.69,227.32 561.12,216.85 C 566.21,211.8 572.93,209.02 580.09,209.02 C 583.62,209.02 587.05,209.71 590.23,211.01 C 590.26,211.02 590.28,211.03 590.31,211.04 C 591.02,211.33 591.72,211.66 592.41,212.01 C 592.53,212.07 592.66,212.14 592.78,212.2 C 593.34,212.49 593.88,212.82 594.41,213.16 C 594.64,213.3 594.86,213.43 595.08,213.57 C 595.34,213.76 595.6,213.95 595.85,214.14 C 597,214.97 598.11,215.86 599.14,216.89 L 606.79,209.24 L 608.73,207.17 L 622.73,192.11 L 624.47,190.24 Z M 620.79,186.55" />
    </svg>
  );
}
