/**
 * Une touche frappée dans un champ de saisie appartient au champ : le moteur, qui écoute le clavier de tout le document pendant une
 * visée (Entrée lance un sort de groupe, Échap annule), ne doit pas la lui prendre — sinon un message tapé dans le chat pendant la
 * visée n'est pas envoyé et le sort part à sa place. Fonction pure : elle ne lit que ce qu'on lui donne de la cible de l'événement.
 */

/** Les `<input>` qui ne reçoivent pas de texte : une touche n'y « écrit » rien. */
const NOT_TEXT = new Set(["button", "checkbox", "radio", "range", "color", "file", "image", "reset", "submit"]);

/**
 * La cible d'un événement clavier est-elle un champ où l'on écrit : zone de texte, liste, champ de texte, ou contenu éditable
 * (l'éditeur du chat) ?
 * @param {{tagName?: string, type?: string, isContentEditable?: boolean}|null} target
 */
export function typingIn(target) {
  if ( !target ) return false;
  if ( target.isContentEditable === true ) return true;
  const tag = String(target.tagName ?? "").toUpperCase();
  if ( (tag === "TEXTAREA") || (tag === "SELECT") ) return true;
  return (tag === "INPUT") && !NOT_TEXT.has(String(target.type ?? "text").toLowerCase());
}
