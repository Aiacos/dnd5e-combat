/**
 * A key struck in an input field belongs to the field: the engine, which listens to the keyboard of the whole document during
 * aiming (Enter casts a group spell, Esc cancels), must not take it from the field — otherwise a message typed in the chat
 * during aiming is not sent and the spell goes off instead. Pure function: it reads only what it is given about the event's target.
 */

/** The `<input>` types that do not receive text: a key "writes" nothing there. */
const NOT_TEXT = new Set(["button", "checkbox", "radio", "range", "color", "file", "image", "reset", "submit"]);

/**
 * Is the target of a keyboard event a field where one writes: text area, list, text field, or editable content
 * (the chat editor)?
 * @param {{tagName?: string, type?: string, isContentEditable?: boolean}|null} target
 */
export function typingIn(target) {
  if ( !target ) return false;
  if ( target.isContentEditable === true ) return true;
  const tag = String(target.tagName ?? "").toUpperCase();
  if ( (tag === "TEXTAREA") || (tag === "SELECT") ) return true;
  return (tag === "INPUT") && !NOT_TEXT.has(String(target.type ?? "text").toLowerCase());
}
