/**
 * §536: the dnd5e roll link a click came from, when it sits in a journal.
 *
 * dnd5e's enricher listener (`handleRoll`, enrichers.mjs) passes the click to `rollCheckSave`, which hands it to the actor's roll as
 * `config.event`: the pre-roll hooks see it before any dialog opens (`BasicRoll.buildConfigure`, dnd5e 6.1.1 dnd5e.mjs:72243).
 */

/** Journal documents whose sheets hold enriched text. */
const JOURNAL_DOCUMENTS = new Set(["JournalEntry", "JournalEntryPage"]);

/**
 * @param {Event|null|undefined} event  `config.event` of a dnd5e roll.
 * @returns {{type: string}|null}       The link's `data-type` (`check`, `skill`, `tool`, `save`…), or null when the roll does not come
 *   from a roll link inside a journal.
 */
export function inlineLinkOf(event) {
  const target = event?.target;
  if ( !(target instanceof Element) ) return null;
  const button = target.closest('[data-action="roll"]');
  if ( !button ) return null;
  const group = button.closest(".roll-link-group") ?? button;
  const type = button.closest(".roll-link")?.dataset?.type ?? group.dataset?.type ?? null;
  if ( !type || !inJournal(button) ) return null;
  return { type };
}

/** The element belongs to a journal sheet (entry or page), wherever it is shown. */
function inJournal(element) {
  const app = element.closest(".application");
  const sheet = app?.id ? foundry.applications.instances.get(app.id) : null;
  if ( JOURNAL_DOCUMENTS.has(sheet?.document?.documentName) ) return true;
  return !!element.closest(".journal-entry-page, .journal-page-content");
}
