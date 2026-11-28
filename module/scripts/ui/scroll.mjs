/**
 * Keep the scroll of a fully redrawn window (`_replaceHTML` that replaces all the content): without this, every click
 * (checkbox, "Uncheck all", changed setting) sends the window back to the very top. The position of each scrolling area is read
 * before the replacement and restored after, as long as the window shows the same view (`view`, e.g. the tab); changing view
 * starts at the top again.
 */

/**
 * Replace the content of `content` with `result` while keeping the scroll of the `selectors` areas (and of `content` itself).
 * @param {HTMLElement} content      The window's container (`.window-content`).
 * @param {HTMLElement} result       The new content.
 * @param {string[]} selectors       The scrolling areas, found in the old and the new content by these selectors.
 * @param {object} memo              An object specific to the window, kept from one render to the next (`{ view, tops }`).
 * @param {string} view              The view shown; if it changes, nothing is restored.
 */
export function replaceKeepingScroll(content, result, selectors, memo, view) {
  const same = memo.view === view;
  const tops = same ? readTops(content, selectors) : null;
  content.replaceChildren(result);
  memo.view = view;
  if ( tops ) writeTops(content, selectors, tops);
}

/** The position of each area: `{ "": haut du conteneur, [sélecteur]: [haut de chaque élément trouvé] }`. */
export function readTops(content, selectors) {
  const tops = { "": content.scrollTop ?? 0 };
  for ( const s of selectors ) tops[s] = [...content.querySelectorAll(s)].map(e => e.scrollTop ?? 0);
  return tops;
}

/** Restore the positions read by `readTops`, element by element in document order. */
export function writeTops(content, selectors, tops) {
  for ( const s of selectors ) {
    const found = [...content.querySelectorAll(s)];
    (tops[s] ?? []).forEach((top, i) => { if ( found[i] && top ) found[i].scrollTop = top; });
  }
  if ( tops[""] ) content.scrollTop = tops[""];
}
