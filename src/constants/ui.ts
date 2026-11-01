/** Small UI data tables and timings. Data only — behaviour lives in src/lib. */

/** Toast exit-animation length in ms — must match the toastOut animation
 *  duration (.23s) that the .is-leaving class runs in styles/app/toast.css. */
export const TOAST_EXIT_MS = 230;

/** How long a copy button keeps showing its "copied" state (useCopied default). */
export const COPY_FEEDBACK_MS = 1500;

/** After a mouse side-button press, how long the browser has to walk its own history
 *  before the wallet does it instead (a WebView may not). Desktop browsers answer in a
 *  frame or two; doing it twice would skip a step. */
export const MOUSE_NAV_GRACE_MS = 250;

/** How long the wallet waits for a history traversal it asked for before it stops
 *  waiting: one the browser cannot make (its history is shorter) never arrives. */
export const NAV_REWIND_TIMEOUT_MS = 1000;

/** How far a finger or the mouse travels on a word before a press becomes a drag (the
 *  phrase check, features/onboarding/useWordDrag.ts). Under it, the press is a tap. */
export const WORD_DRAG_START_PX = 6;

/** How long a dropped word glides into its gap, or back where it came from — --dur-base,
 *  the token for a small move (src/styles/theme.css). */
export const WORD_DRAG_GLIDE_MS = 300;

/** A wheel that counts in lines (Firefox) or pages, turned into pixels for the scroll a
 *  desktop window forwards to the screen (src/lib/scrollForward.ts). */
export const WHEEL_LINE_PX = 40;

/** A forwarded scroll this long or more eases (a mouse notch is ~100px); shorter ones — a
 *  touchpad's stream of small deltas — follow the fingers as they come. */
export const SCROLL_SMOOTH_MIN_PX = 50;

/** What an arrow key scrolls by when the window forwards it (PageUp/Down take a screenful). */
export const SCROLL_ARROW_PX = 40;

/** How long a screen opened at one of its parts waits before scrolling there: its entrance
 *  (--dur-base) moves the content, and its sections settle their height as they load. */
export const SECTION_SCROLL_DELAY_MS = 450;
