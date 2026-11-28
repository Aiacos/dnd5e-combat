/**
 * §171: a placed ring of fire (Wall of Fire, ring variant) — for the one who placed it, which side it burns: inward (what
 * is inside burns) or outward (what is inside is protected). Closing the window keeps the engine's side (the one where the caster
 * is not). The interface asks; runtime/wall-side.mjs writes, via the active GM.
 */

import { wallSideRuleOf, wallGeometryOf } from "../adapter/wall-side.mjs";
import { flipWallSide } from "../runtime/wall-side.mjs";
import { route } from "../runtime/router.mjs";
import { loc } from "../runtime/shared.mjs";

/** Returns +1 (inward), -1 (outward) or null (window closed). */
async function askRingSide(name) {
  const answer = await foundry.applications.api.DialogV2.wait({
    window: { title: name, icon: "fa-solid fa-fire" },
    content: `<p>${loc("MurFace.Question")}</p>`,
    buttons: [
      { action: "inward", label: loc("MurFace.Interieur"), icon: "fa-solid fa-arrows-to-circle", default: true, callback: () => 1 },
      { action: "outward", label: loc("MurFace.Exterieur"), icon: "fa-solid fa-arrows-left-right-to-line", callback: () => -1 }
    ],
    rejectClose: false
  }).catch(() => null);
  return [1, -1].includes(answer) ? answer : null;
}

async function onCreate(region, options, userId) {
  if ( (userId !== game.user.id) || !wallSideRuleOf(region) || !wallGeometryOf(region)?.ring ) return;
  const side = await askRingSide(region.name.replace(/\s*\[.*\]$/, ""));
  if ( side ) await flipWallSide(region, side);
}

export function registerWallSideUi() {
  route("createRegion", onCreate, { label: "wall: ring side not asked" });
}
