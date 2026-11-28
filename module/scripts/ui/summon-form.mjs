/**
 * §383 (issue #38): the "Choose the form" window of a summon cast without the dnd5e window (action bar, gamepad).
 * One card per form (image and name of the creature, name of the profile when it has one — Avenger / Defender), plus the size or
 * creature type when the activity offers several. A click on a card summons that form (if there is nothing else to
 * choose); "Summon" takes the ticked card. It opens on the caster's screen (the player on theirs, the GM on theirs),
 * with the "waiting" hourglass above the caster for the table (§381). The interface asks; runtime/summon-handover.mjs casts.
 *
 * §385: for "up to N" creatures (content `summon.chooseCount`, Create Undead), also the **number** (1 to N, N depending on the
 * level) and, opened from the sheet, the **level** (the slots that remain) — the permitted forms and N follow the level
 * (ghouls and ghasts at level 8, mummies at 9).
 */

import { loc, esc } from "../runtime/shared.mjs";
import { summonChoicesOf, summonCountAt, summonProfilesAt, castLevelsOf, preferredSummonUuid } from "../adapter/summons.mjs";
import { countChoices } from "../core/summon.mjs";
import { whileAwaiting } from "../adapter/awaiting.mjs";

/** dnd5e's label for a profile (name, otherwise "CR x or less", otherwise the creature's name; "2 × " in front of a number). */
function profileLabel(activity, profile, rollData) {
  const dialog = globalThis.dnd5e?.applications?.activity?.SummonUsageDialog;
  try {
    if ( dialog?.prototype?.getProfileLabel ) return dialog.prototype.getProfileLabel.call({ activity }, profile, rollData);
  } catch(err) { /* repli ci-dessous */ }
  return profile.name || fromUuidSync(profile.uuid, { strict: false })?.name || "—";
}

/** A form: its id, its label, the creature's image and name (compendium index, translated by Babele if it is). */
function formOf(activity, profile, rollData, { bare=false }={}) {
  // §386: the creature actually summoned (Monster Manual 2024 rather than SRD 2014).
  const uuid = profile.uuid ? preferredSummonUuid(profile.uuid) : null;
  const actor = uuid ? fromUuidSync(uuid, { strict: false }) : null;
  // Without a profile name, that of the creature actually summoned (Monster Manual, translated by the MM-fr).
  const native = profileLabel(activity, profile, rollData);
  const times = /^\s*\d+\s*×\s*/.exec(native)?.[0] ?? "";
  let label = (!profile.name && actor?.name) ? `${times}${actor.name}` : native;
  // The number is chosen separately: no "3 × " in front of the name.
  if ( bare ) label = label.replace(/^\s*\d+\s*×\s*/, "");
  const creature = actor?.name ?? null;
  return { id: profile._id, label, creature: (creature && !label.includes(creature)) ? creature : null,
    img: actor?.img || activity.item?.img || "icons/svg/mystery-man.svg" };
}

function cardsHtml(forms, picked) {
  return forms.map(f => `
    <label class="dnd5e-combat-form${f.id === picked ? " picked" : ""}" data-profile="${esc(f.id)}" title="${esc(f.creature ?? f.label)}">
      <input type="radio" name="profile" value="${esc(f.id)}"${f.id === picked ? " checked" : ""} hidden>
      <img src="${esc(f.img)}" alt="">
      <span class="name">${esc(f.label)}</span>
      ${f.creature ? `<span class="cr">${esc(f.creature)}</span>` : ""}
    </label>`).join("");
}

function selectHtml(name, label, values, labels, current) {
  const options = values.map(v => `<option value="${esc(v)}"${String(v) === String(current) ? " selected" : ""}>${esc(labels[v]?.label ?? labels[v] ?? v)}</option>`).join("");
  return `<div class="form-group"><label>${esc(label)}</label><div class="form-fields"><select name="${name}">${options}</select></div></div>`;
}

/**
 * Asks for the form. Returns `{ profile, creatureSize?, creatureType?, slot?, count? }`, or null if the player gives up (window
 * closed: nothing is cast).
 * @param {Activity} activity  The "summon" activity (scaled copy included: the available profiles follow the level).
 * @param {object} [current]   What dnd5e prepared (`usageConfig.summons`), pre-ticked.
 * @param {{ chooseCount?: boolean, countFormula?: string|null, chooseLevel?: boolean, slot?: string|null }} [options]  §385, §387.
 */
export async function askSummonForm(activity, current={}, { chooseCount=false, countFormula=null, chooseLevel=false, slot=null }={}) {
  const choices = summonChoicesOf(activity);
  const baseRollData = activity.getRollData?.() ?? {};
  const baseLevel = Number(activity.item?.system?.level) || 0;
  // The levels offered (from the sheet), otherwise the level of the slot already chosen (bar) or that of the spell.
  const levels = chooseLevel ? castLevelsOf(activity) : [];
  const fixedLevel = Math.max(baseLevel, Number(activity.actor?.system?.spells?.[slot]?.level) || baseLevel);
  let level = levels.length ? levels[0].level : fixedLevel;
  let slotKey = levels.length ? levels[0].slot : null;
  const rollAt = lvl => ({ ...baseRollData, item: { ...(baseRollData.item ?? {}), level: lvl } });
  // §390: a form whose number falls to 0 at this level (TG item with a spellcasting modifier of 2) is not offered.
  const profilesAt = lvl => (chooseCount
    ? summonProfilesAt(activity, lvl).filter(p => summonCountAt(activity, p, lvl, countFormula) !== 0)
    : Array.from(activity.availableProfiles ?? []));
  if ( !profilesAt(level).length ) return null;

  let picked = profilesAt(level).some(p => p._id === current.profile) ? current.profile : profilesAt(level)[0]._id;
  const sizes = Array.from(activity.creatureSizes ?? []);
  const types = Array.from(activity.creatureTypes ?? []);
  const fixed = [
    choices.size ? selectHtml("creatureSize", loc("Invocation.Taille"), sizes, CONFIG.DND5E.actorSizes, current.creatureSize ?? sizes[0]) : "",
    choices.type ? selectHtml("creatureType", loc("Invocation.Type"), types, CONFIG.DND5E.creatureTypes, current.creatureType ?? types[0]) : ""
  ].join("");
  const levelHtml = (levels.length > 1)
    ? selectHtml("level", loc("Invocation.Niveau"), levels.map((l, i) => i),
      Object.fromEntries(levels.map((l, i) => [i, loc("Invocation.NiveauLibelle", { level: l.level, slot: l.label ?? "", left: l.left })])), 0)
    : "";

  /** The cards and the number at the current level. */
  const body = () => {
    const profiles = profilesAt(level);
    if ( !profiles.some(p => p._id === picked) ) picked = profiles[0]?._id ?? null;
    const forms = profiles.map(p => formOf(activity, p, rollAt(level), { bare: chooseCount }));
    const profile = profiles.find(p => p._id === picked);
    const counts = chooseCount ? countChoices(summonCountAt(activity, profile, level, countFormula)) : [];
    const countHtml = counts.length
      ? selectHtml("count", loc("Invocation.Nombre"), counts, {}, counts[counts.length - 1]) : "";
    return `<div class="dnd5e-combat-forms">${cardsHtml(forms, picked)}</div>${countHtml}`;
  };
  const quick = !choices.size && !choices.type && !chooseCount && !(levels.length > 1);
  const content = `<p class="hint">${esc(loc(quick ? "Invocation.ChoisirClic" : "Invocation.Choisir"))}</p>
    ${levelHtml}<div class="dnd5e-combat-summon-body">${body()}</div>${fixed}`;
  const read = form => {
    const data = new foundry.applications.ux.FormDataExtended(form).object;
    // The number capped at the maximum of the ticked form at this level (a form changed without a click would keep another's).
    const max = chooseCount ? summonCountAt(activity, profilesAt(level).find(p => p._id === (data.profile || picked)), level, countFormula) : null;
    const count = (Number(data.count) > 0) ? (max ? Math.min(Number(data.count), max) : Number(data.count)) : null;
    return { profile: data.profile || picked, ...(choices.size ? { creatureSize: data.creatureSize } : {}),
      ...(choices.type ? { creatureType: data.creatureType } : {}),
      ...(slotKey ? { slot: slotKey } : {}), ...(count ? { count } : {}) };
  };
  const ask = () => foundry.applications.api.DialogV2.wait({
    window: { title: activity.item.name, icon: "fa-solid fa-spaghetti-monster-flying" },
    classes: ["dnd5e-combat-summon-form"],
    position: { width: Math.min(140 * Math.max(Array.from(activity.profiles ?? []).length, 2) + 60, 640) },
    content,
    buttons: [{ action: "summon", label: loc("Invocation.Invoquer"), icon: "fa-solid fa-spaghetti-monster-flying", default: true,
      callback: (event, button) => read(button.form) }],
    render: (event, dialog) => {
      const root = dialog.element;
      const wire = () => {
        for ( const card of root.querySelectorAll(".dnd5e-combat-form") ) {
          // A form ticked other than by a click (keyboard): the number follows too.
          card.querySelector("input[type=radio]")?.addEventListener("change", () => {
            picked = card.dataset.profile;
            if ( chooseCount ) refresh();
          });
          card.addEventListener("click", () => {
            picked = card.dataset.profile;
            root.querySelectorAll(".dnd5e-combat-form").forEach(c => c.classList.toggle("picked", c === card));
            const radio = card.querySelector("input[type=radio]");
            if ( radio ) radio.checked = true;
            if ( quick ) return root.querySelector('button[data-action="summon"]')?.click();
            if ( chooseCount ) refresh();
          });
        }
      };
      const refresh = () => {
        const holder = root.querySelector(".dnd5e-combat-summon-body");
        if ( holder ) holder.innerHTML = body();
        wire();
      };
      root.querySelector('select[name="level"]')?.addEventListener("change", ev => {
        const chosen = levels[Number(ev.currentTarget.value)] ?? levels[0];
        level = chosen.level;
        slotKey = chosen.slot;
        refresh();
      });
      wire();
    },
    rejectClose: false
  }).catch(() => null);
  const answer = await whileAwaiting(activity.actor ?? null, "choice", ask);
  return (answer && (typeof answer === "object")) ? answer : null;
}

/**
 * §391: the same window for an enchantment or a transformation with several profiles (Elemental Weapon, Magic Weapon,
 * +1/+2/+3 weapons, True Polymorph), when dnd5e's window is skipped. One card per profile: the enchantment effect (name, icon)
 * or the transformation form (name, creature). A click chooses. Returns `{ enchantmentProfile }` or `{ transform: { profile } }`,
 * or null.
 * @param {Activity} activity  An "enchant" or "transform" activity.
 * @param {object} usageConfig  What dnd5e prepared (the profile pre-ticked).
 */
export async function askProfile(activity, usageConfig={}) {
  const enchant = activity.type === "enchant";
  const list = Array.from((enchant ? activity.availableEnchantments : activity.availableProfiles) ?? []);
  if ( list.length < 2 ) return null;
  const forms = list.map(p => {
    if ( enchant ) {
      const effect = p.effect ?? activity.item?.effects?.get?.(p._id) ?? null;
      return { id: p._id, label: effect?.name ?? p._id, creature: null, img: effect?.img || activity.item?.img || "icons/svg/aura.svg" };
    }
    const actor = p.uuid ? fromUuidSync(p.uuid, { strict: false }) : null;
    const label = p.name || actor?.name || p.effect?.name || p._id;
    return { id: p._id, label, creature: (actor?.name && (actor.name !== label)) ? actor.name : null,
      img: actor?.img || p.effect?.img || activity.item?.img || "icons/svg/mystery-man.svg" };
  });
  const current = enchant ? usageConfig.enchantmentProfile : usageConfig.transform?.profile;
  const picked = forms.some(f => f.id === current) ? current : forms[0].id;
  const content = `<p class="hint">${esc(loc("Invocation.ChoisirProfil"))}</p>
    <div class="dnd5e-combat-forms">${cardsHtml(forms, picked)}</div>`;
  const ask = () => foundry.applications.api.DialogV2.wait({
    window: { title: activity.item.name, icon: enchant ? "fa-solid fa-wand-magic-sparkles" : "fa-solid fa-paw" },
    classes: ["dnd5e-combat-summon-form"],
    position: { width: Math.min(140 * Math.max(forms.length, 2) + 60, 760) },
    content,
    buttons: [{ action: "summon", label: loc("Invocation.Choisir1"), icon: "fa-solid fa-check", default: true,
      callback: (event, button) => new foundry.applications.ux.FormDataExtended(button.form).object.profile || picked }],
    render: (event, dialog) => {
      const root = dialog.element;
      for ( const card of root.querySelectorAll(".dnd5e-combat-form") ) card.addEventListener("click", () => {
        const radio = card.querySelector("input[type=radio]");
        if ( radio ) radio.checked = true;
        root.querySelector('button[data-action="summon"]')?.click();
      });
    },
    rejectClose: false
  }).catch(() => null);
  const id = await whileAwaiting(activity.actor ?? null, "choice", ask);
  if ( !id || (typeof id !== "string") ) return null;
  return enchant ? { enchantmentProfile: id } : { transform: { ...(usageConfig.transform ?? {}), profile: id } };
}
