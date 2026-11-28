/**
 * §16.35: the choice for a light spell that summons an object (Light, Continual Flame) — "on the ground" (the object is placed)
 * or "on me" (the caster holds it and shines), and the color. The interface asks; runtime/lights.mjs (`castLight`)
 * casts.
 */

import { summonedLightOf, lightsOfItem } from "../adapter/lights.mjs";
import { loc } from "../runtime/shared.mjs";

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * The window: "On the ground", "On me", and "Extinguish" when a light from the spell already shines; a color picker (the
 * object's color by default).
 * @param {Activity} activity
 * @returns {Promise<{where: "ground"|"self"|"off", color: string|null}|null>}  null: the user gives up.
 */
export async function askLightChoice(activity) {
  const light = await summonedLightOf(activity);
  const initial = HEX.test(light.color ?? "") ? light.color : "#ffffff";
  const content = `<div class="form-group"><label>${loc("Lumiere.Couleur")}</label>
    <input type="color" name="color" value="${initial}"></div>`;
  const pick = where => (event, button) => {
    const color = button.form?.elements?.color?.value;
    return { where, color: HEX.test(color ?? "") ? color : null };
  };
  const answer = await foundry.applications.api.DialogV2.wait({
    window: { title: activity.item.name, icon: "fa-solid fa-lightbulb" },
    content,
    buttons: [
      { action: "ground", label: loc("Lumiere.AuSol"), icon: "fa-solid fa-location-dot", default: true, callback: pick("ground") },
      { action: "self", label: loc("Lumiere.SurMoi"), icon: "fa-solid fa-hand-holding", callback: pick("self") },
      ...(lightsOfItem(activity.item) ? [{ action: "off", label: loc("Lumiere.Eteindre"), icon: "fa-solid fa-power-off", callback: pick("off") }] : [])
    ],
    rejectClose: false
  }).catch(() => null);
  return (answer && (typeof answer === "object")) ? answer : null;
}
