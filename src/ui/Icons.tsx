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
