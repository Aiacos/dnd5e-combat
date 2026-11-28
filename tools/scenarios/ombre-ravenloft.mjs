/**
 * §447 — Shadow Power (Shadow Sorcery, Ravenloft), Eyes of the Dark: "if a spell you cast creates Darkness, you
 * see normally through it" (`seesThroughOwnDarkness`). In the "Vision Arena" (`node tools/arene-vision.mjs` first):
 *  1. The Human receives Shadow Power and the Darkness spell, and casts it on the Target in the darkness: they see (rules and
 *     screen) the target in their Darkness and the one behind; the Elf Ranger (Darkvision) still sees neither.
 *  2. Their Darkness lifted, the Fiend Warlock casts theirs in the same place: the Human no longer sees there (it is not theirs).
 * Without the Vision Arena or without the Ravenloft module: not applicable.
 */
import { ARENE_VISION } from "../lib/stages.mjs";

const RHW = "dnd-ravenloft-horrors-within.options";
const PHB = "Compendium.dnd-players-handbook.spells.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const OBSERVERS = ["Humain", "Rôdeur elfe"];
const TARGETS = ["Cible dans les ténèbres", "Cible derrière les ténèbres", "Cible au loin"];

export default {
  name: "Pouvoir de l'ombre — voir normalement à travers ses propres Ténèbres (Arène de la vision)",
  scene: ARENE_VISION.name,

  async run(ctx) {
    const packs = await ctx.call("list-compendiums", {}).catch(() => null);
    if ( !JSON.stringify(packs ?? "").includes(RHW) ) { ctx.log("module Ravenloft absent : non applicable"); return; }
    const tokens = {};
    for ( const name of [...OBSERVERS, ...TARGETS, "Occultiste du diable"] ) tokens[name] = await ctx.token(name);
    const human = tokens["Humain"];
    const warlock = tokens["Occultiste du diable"];
    const grid = await ctx.gridSize();
    ctx.restore(() => ctx.removeEffectsNamed(human, /concentr/i));
    ctx.restore(() => ctx.removeEffectsNamed(warlock, /concentr/i));

    // Shadow Power lent to the Human (its effect also gives them Darkvision at 120 ft), and the Darkness spell.
    const uuid = `Compendium.${RHW}.Item.rhwSSPowerofShNG`;
    const { data } = await ctx.call("get-compendium-entry", { uuid });
    const { _id, folder, ownership, _stats, ...itemData } = data;
    itemData.flags = { ...(itemData.flags ?? {}), dnd5e: { ...(itemData.flags?.dnd5e ?? {}), sourceId: uuid } };
    const r = await ctx.call("upsert-actor-item", { actorId: human.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: uuid } });
    ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: human.actorId, itemId: r.id }).catch(() => {}));
    await ctx.ensureItem(human, PHB + "phbsplDarkness00", { system: { method: "atwill" } });
    await pause(1500);

    const matrix = async () => (await ctx.engine("visionMatrix", { observerIds: OBSERVERS.map(n => tokens[n].id), targetIds: TARGETS.map(n => tokens[n].id) })).rows;
    const cell = (rows, o, t) => rows.find(r => (r.observer === o) && (r.target === t));
    const box = await ctx.box(tokens[ARENE_VISION.darknessOn]);
    const centre = { x: box.x + (box.width / 2), y: box.y + (box.height / 2) };

    // 1. The Human's Darkness.
    const dark = await ctx.use({ tokenId: human.id, identifier: "darkness", area: { shape: "circle", ...centre, radius: 3 * grid } });
    if ( !ctx.expect(dark.used && !!dark.regionId, "Ténèbres de l'Humain posées") ) return;
    ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: dark.regionId }).catch(() => {}));
    await pause(2000);
    const own = await matrix();
    for ( const r of own ) ctx.log(`  ${r.observer} → ${r.target} : règles ${r.rules.sees ? "voit" : "ne voit pas"} (zone ${r.rules.blocked.join("+") || "aucune"}) ; écran ${r.screen}`);
    for ( const t of ["Cible dans les ténèbres", "Cible derrière les ténèbres"] ) {
      const c = cell(own, "Humain", t);
      ctx.expect(c?.rules.sees === true, `l'Humain voit ${t} à travers SES Ténèbres (règles)`);
      ctx.expect(["seen", "outline"].includes(c?.screen), `l'Humain : ${t} affichée (écran : ${c?.screen})`);
      ctx.expect(cell(own, "Rôdeur elfe", t)?.rules.sees === false, `le Rôdeur elfe ne voit pas ${t} (ces Ténèbres ne sont pas les siennes)`);
    }
    // The aiming: the Human's Darkness, a target inside — the engine does not refuse it as "not in sight".
    const HEX = PHB + "phbsplHex0000000";
    await ctx.ensureItem(human, HEX, { system: { method: "atwill" } });
    const aim = await ctx.engine("sightIssues", { tokenId: human.id, identifier: "hex", targetIds: [tokens["Cible dans les ténèbres"].id] });
    ctx.expect(!aim.unseen.length, `l'Humain peut viser dans ses Ténèbres (refusées : ${aim.unseen.join(", ") || "aucune"})`);

    // 2. Someone else's Darkness: no more free pass.
    await ctx.call("delete-scene-object", { type: "Region", objectId: dark.regionId }).catch(() => {});
    await ctx.removeEffectsNamed(human, /concentr/i);
    const other = await ctx.use({ tokenId: warlock.id, identifier: "darkness", area: { shape: "circle", ...centre, radius: 3 * grid } });
    if ( !ctx.expect(other.used && !!other.regionId, "Ténèbres de l'Occultiste du diable posées") ) return;
    ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: other.regionId }).catch(() => {}));
    await pause(2000);
    const foreign = await matrix();
    ctx.expect(cell(foreign, "Humain", "Cible dans les ténèbres")?.rules.sees === false, "l'Humain ne voit pas dans les Ténèbres d'un autre (règles)");
    ctx.expect(cell(foreign, "Humain", "Cible au loin")?.rules.sees === true, "témoin : l'Humain voit toujours la Cible au loin");
  }
};
