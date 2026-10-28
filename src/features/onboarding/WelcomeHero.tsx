import { useEffect, useRef, useState } from 'react';
import type { Theme } from '@/state/usePreferences';
import { cx } from '@/lib/cx';
import { whenAppRevealed } from '@/lib/appReveal';
import '@/styles/features/onboarding/welcome-hero.css';

/** The rendered motion (Remotion project `cosmos-wallet-welcome-motion`), one set per theme. */
const media = (name: string) => `${import.meta.env.BASE_URL}brand/welcome/${name}`;

/** The entrance plays once per app session: coming back to Welcome goes straight to the loop. */
let introSeen = false;

/**
 * Welcome's hero, provisional: the brand astronaut rises in, a blue lazo closes into an orbit
 * around it, and the scene settles into a seamless idle loop. Two files per theme — the intro
 * (2.5s, once) and the loop (6s, repeating), whose first frame continues the intro's last,
 * so the cut is invisible. Their canvas is exactly `--bg`, so the square sits on the screen
 * with no box.
 *
 * - The intro waits for the boot splash to lift (`whenAppRevealed`), or it would play under it.
 * - The loop stays hidden under the intro until the cut: before the intro's first frame is
 *   decoded the intro is transparent, and the loop's poster (the settled scene) showed through.
 * - Autoplay refused, or no playable file: the loop's poster stays — the same scene, still.
 * - It moves for everyone, reduced-motion included, and has no pause control: both the
 *   user's call (2026-10-28). WCAG 2.2.2 asks for a way to stop motion that lasts over 5s;
 *   revisit when the final hero replaces this provisional one.
 * - A theme flip swaps the files without replaying the entrance.
 * - It plays only while it is on screen (IntersectionObserver). On a desktop window two
 *   copies exist — Welcome's own, hidden by the split, and the brand panel's — and a hidden
 *   video that keeps decoding is a second one for nothing. A copy that comes into view after
 *   the other already played the entrance goes straight to the loop.
 *
 * Decorative: no sound, no controls of its own, hidden from assistive technology; the screen's
 * buttons say what it is for.
 */
export function WelcomeHero({ theme, className }: { theme: Theme; className?: string }) {
  const [phase, setPhase] = useState<'intro' | 'loop'>(introSeen ? 'loop' : 'intro');
  const [seen, setSeen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const introRef = useRef<HTMLVideoElement>(null);
  const loopRef = useRef<HTMLVideoElement>(null);
  const firstTheme = useRef(theme);

  const toLoop = () => {
    introSeen = true;
    setPhase('loop');
  };

  useEffect(() => {
    if (theme !== firstTheme.current) toLoop();
  }, [theme]);

  // Seen or not: `display: none` and scrolled away both read as not intersecting.
  useEffect(() => {
    const box = boxRef.current;
    if (!box || typeof IntersectionObserver === 'undefined') {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver(([entry]) => setSeen(entry.isIntersecting));
    io.observe(box);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!seen) {
      introRef.current?.pause();
      loopRef.current?.pause();
      return;
    }
    if (phase === 'intro' && introSeen) {
      toLoop();
      return;
    }
    const video = phase === 'intro' ? introRef.current : loopRef.current;
    if (!video) return;
    return whenAppRevealed(() => {
      video.play().catch(() => {
        // An intro that cannot play hands over to the loop, whose poster covers the rest.
        if (phase === 'intro') toLoop();
      });
    });
  }, [phase, theme, seen]);

  return (
    <div ref={boxRef} className={cx('welcome-hero', className)}>
      <video
        key={`loop-${theme}`}
        ref={loopRef}
        className={cx('welcome-video', phase === 'intro' && 'is-waiting')}
        muted
        playsInline
        loop
        preload="auto"
        poster={media(`welcome-poster-${theme}.png`)}
        aria-hidden="true"
        tabIndex={-1}
      >
        <source src={media(`welcome-loop-${theme}.webm`)} type="video/webm" />
        <source src={media(`welcome-loop-${theme}.mp4`)} type="video/mp4" />
      </video>
      {phase === 'intro' && (
        <video
          key={`intro-${theme}`}
          ref={introRef}
          className="welcome-video"
          muted
          playsInline
          preload="auto"
          onEnded={toLoop}
          aria-hidden="true"
          tabIndex={-1}
        >
          <source src={media(`welcome-intro-${theme}.webm`)} type="video/webm" />
          <source src={media(`welcome-intro-${theme}.mp4`)} type="video/mp4" />
        </video>
      )}
    </div>
  );
}
