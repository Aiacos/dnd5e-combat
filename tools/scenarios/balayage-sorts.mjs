/**
 * Sweep of the 391 Player's Handbook spells in the "Spell Arena" (`tools/lib/balayage.mjs`: the invariants checked). The
 * reading survey (`prive/RELEVE_SORTS.md`) said what each spell SHOULD do; more than half had never been played
 * by a scenario (gap survey, 2026-10-22). Only played when named: `node tools/scenario.mjs balayage-sorts`. Variables:
 * `NIVEAUX=0-3`, `SORTS=fireball,web` (identifiers), `DEPUIS=<identifiant>` (resume), `PILE=1` (full error stacks).
 * §406: `MONTEE=2` casts every level 1+ spell whose dice go up two levels above its own and checks the number of dice
 * (invariant 8); report `prive/balayages/sorts-montee-<date>.md`.
 */
import { sweep } from "../lib/balayage.mjs";
import { ARENE_SORTS } from "../lib/stages.mjs";

const [lo, hi] = (process.env.NIVEAUX ?? "0-9").split("-").map(Number);
const only = (process.env.SORTS ?? "").split(",").filter(Boolean);
const upcast = Math.max(0, Number(process.env.MONTEE) || 0);

export default {
  name: "balayage des sorts du Manuel des joueurs (Arène des sorts)",
  scene: ARENE_SORTS.name,
  audit: true,
  run: ctx => sweep(ctx, {
    kind: upcast ? "sorts-montee" : "sorts",
    upcast,
    packs: ["dnd-players-handbook.spells"],
    select: d => (d.type === "spell")
      && (only.length ? only.includes(d.system.identifier) : (d.system.level >= lo) && (d.system.level <= (hi ?? lo))),
    sortKey: d => `${d.system.level}|${d.name}`,
    lend: { method: "spell", prepared: 1 },
    consume: true
  })
};
