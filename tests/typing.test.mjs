/**
 * Pendant une visée, le moteur écoute le clavier du document (Entrée : lancer le sort de groupe ; Échap : annuler). Une touche
 * frappée dans un champ de saisie reste au champ — vu en jeu : Entrée dans le chat ne postait pas le message et lançait le sort.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { typingIn } from "../module/scripts/core/typing.mjs";

describe("typingIn — la cible d'une touche est-elle un champ de saisie", () => {
  it("l'éditeur du chat (contenu éditable), une zone de texte, une liste, un champ de texte : oui", () => {
    expect(typingIn({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(typingIn({ tagName: "TEXTAREA" })).toBe(true);
    expect(typingIn({ tagName: "SELECT" })).toBe(true);
    expect(typingIn({ tagName: "INPUT", type: "text" })).toBe(true);
    expect(typingIn({ tagName: "INPUT", type: "number" })).toBe(true);
    expect(typingIn({ tagName: "input" })).toBe(true);
  });
  it("le canevas, un bouton, une case à cocher : non", () => {
    expect(typingIn({ tagName: "CANVAS" })).toBe(false);
    expect(typingIn({ tagName: "BODY", isContentEditable: false })).toBe(false);
    expect(typingIn({ tagName: "BUTTON" })).toBe(false);
    expect(typingIn({ tagName: "INPUT", type: "checkbox" })).toBe(false);
    expect(typingIn({ tagName: "INPUT", type: "range" })).toBe(false);
    expect(typingIn(null)).toBe(false);
    expect(typingIn({})).toBe(false);
  });
});

describe("la visée ne prend pas les touches d'un champ de saisie", () => {
  it("`onKeyDown` rend la main avant de lire Entrée ou Échap", () => {
    const source = readFileSync(new URL("../module/scripts/ui/pointer-mouse.mjs", import.meta.url), "utf8");
    const body = source.slice(source.indexOf("export function onKeyDown(event) {"));
    expect(body.indexOf("if ( typingIn(event.target) ) return;")).toBeGreaterThan(0);
    expect(body.indexOf("if ( typingIn(event.target) ) return;")).toBeLessThan(body.indexOf('event.key === "Enter"'));
  });
});
