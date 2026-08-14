/**
 * Join class names, dropping every falsy part.
 *
 * The app has no inline styles: state is expressed with `.is-*` / `.has-*`
 * modifier classes written alongside their base class (see CLAUDE.md). This is
 * the single helper that composes them, so components stop repeating the
 * `on ? 'base is-on' : 'base'` ternary at every call site.
 *
 *   cx('tap network-dd-item', on && 'is-on')
 *   cx('btn-primary', className)
 */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}
