/**
 * Sweep of the Player's Handbook feats, class and subclass features and species traits that have an activity, in the "Spell
 * Arena" (`tools/lib/balayage.mjs`). Lent to the Caster (a classless NPC) without spending their uses: a feature whose formula
 * cites its class scale (`@scale.monk.die`) and which fails because of it is noted "not played", not as a defect. What is not
 * used (a passive feat, a Reaction triggered by the engine) is not covered here: those are the rules scenarios.
 * Only played when named: `node tools/scenario.mjs balayage-aptitudes`. Variables: `APTITUDES=lay-on-hands,second-wind`
 * (identifiers), `MOTEUR=1` (only those the engine declares), `DEPUIS=<identifiant>`, `PILE=1`.
 */
import { CONTENT } from "../../module/scripts/content/index.mjs";
import { sweep } from "../lib/balayage.mjs";
import { ARENE_SORTS } from "../lib/stages.mjs";

const only = (process.env.APTITUDES ?? "").split(",").filter(Boolean);
const PLAYED = new Set(["attack", "save", "damage", "heal", "utility", "enchant", "check"]);

export default {
  name: "balayage des dons et aptitudes du Manuel des joueurs (Arène des sorts)",
  scene: ARENE_SORTS.name,
  audit: true,
  run: ctx => sweep(ctx, {
    kind: "aptitudes",
    packs: ["dnd-players-handbook.feats", "dnd-players-handbook.classes", "dnd-players-handbook.origins"],
    select: d => {
      if ( d.type !== "feat" ) return false;
      const ident = d.system.identifier;
      if ( only.length ) return only.includes(ident);
      if ( process.env.MOTEUR && !CONTENT[ident] ) return false;
      return Object.values(d.system.activities ?? {}).some(a => PLAYED.has(a.type));
    },
    sortKey: d => `${d.system.requirements ?? ""}|${d.name}`,
    lend: {},
    consume: false
  })
};
