/**
 * §446 — Pouvoir de l'ombre (Sorcellerie de l'ombre, Ravenloft), Yeux des ténèbres : « si un sort que vous lancez crée des Ténèbres, vous
 * voyez normalement à travers » (`seesThroughOwnDarkness`). Dans l'« Arène de la vision » (`node tools/arene-vision.mjs` d'abord) :
 *  1. L'Humain reçoit Pouvoir de l'ombre et le sort Ténèbres, et les lance sur la Cible dans les ténèbres : il voit (règles et écran) la
 *     cible dans ses Ténèbres et celle derrière ; le Rôdeur elfe (vision dans le noir) ne voit toujours ni l'une ni l'autre.
 *  2. Ses Ténèbres levées, l'Occultiste du diable lance les siennes au même endroit : l'Humain n'y voit plus (ce ne sont pas les siennes).
 * Sans l'Arène de la vision ou sans le module Ravenloft : non applicable.
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

    // Pouvoir de l'ombre prêté à l'Humain (son effet lui donne aussi la vision dans le noir à 120 ft), et le sort Ténèbres.
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

    // 1. Les Ténèbres de l'Humain.
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
    // La visée : Ténèbres de l'Humain, une cible dedans — le moteur ne la refuse pas « pas en vue ».
    const HEX = PHB + "phbsplHex0000000";
    await ctx.ensureItem(human, HEX, { system: { method: "atwill" } });
    const aim = await ctx.engine("sightIssues", { tokenId: human.id, identifier: "hex", targetIds: [tokens["Cible dans les ténèbres"].id] });
    ctx.expect(!aim.unseen.length, `l'Humain peut viser dans ses Ténèbres (refusées : ${aim.unseen.join(", ") || "aucune"})`);

    // 2. Les Ténèbres d'un autre : plus de passe-droit.
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
