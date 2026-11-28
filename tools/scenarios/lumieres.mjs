/**
 * Carried light sources (SPEC §52). Items lent from the Player's Handbook compendium.
 *  1. Lamp: its activity lights it (Bright Light 4.50 m, Dim Light up to 13.50 m, flickering flame), then puts it out.
 *  2. Bullseye Lantern: a Cone (angle).
 *  3. Torch (no light activity): the tinderbox lights it — the only remaining extinguished source, automatically.
 *  4. The torch leaves the sheet: its light goes out.
 * §121: a lit source is held in hand — with full hands (weapons, shield equipped), the lamp is refused; the scenario
 * then stows weapons and shield, and re-equips them at the end.
 * Restores the light; removes the lent items.
 */
import { RESTORED_KEEP } from "../lib/stages.mjs";

const EQ = "Compendium.dnd-players-handbook.equipment.Item";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "sources de lumière — lampe, lanterne sourde, torche par la boîte à amadou",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !tokens.some(t => t.name === "Guerrier") ) { ctx.log("Guerrier requis : non applicable"); return; }
    const packs = await ctx.call("list-compendiums", {}).catch(() => null);
    if ( !JSON.stringify(packs ?? "").includes("dnd-players-handbook.equipment") ) { ctx.log("Manuel des joueurs absent : non applicable"); return; }
    await ctx.stage(RESTORED_KEEP);
    const g = await ctx.token("Guerrier");
    const actorId = (await ctx.call("get-scene-object", { type: "Token", objectId: g.id })).data.actorId;
    const light = async () => (await ctx.engine("stats", { tokenId: g.id }))?.light ?? {};
    const lit = async () => ((await ctx.call("get-actor", { actorId })).effects ?? []).filter(e => e.flags?.["dnd5e-combat"]?.carriedLightOf);
    ctx.restore(async () => {
      for ( const e of await lit() ) await ctx.call("remove-embedded-effect", { documentType: "Actor", id: actorId, effectId: e._id }).catch(() => {});
    });
    const grid = await ctx.call("get-scene", {}).then(s => s.grid ?? s.scene?.grid ?? null).catch(() => null);
    const base = await light();
    ctx.log(`lumière de départ : ${base.bright}/${base.dim} (unité de la scène : ${grid?.units ?? "?"})`);
    const use = async (itemId, activityType="utility") => {
      await ctx.use({ tokenId: g.id, itemId, activityType, targetTokenIds: [] });
      await pause(2000);
    };

    // 1. Lamp. Full hands first, if the Fighter's are: refused; then weapons and shield stowed.
    const lamp = await ctx.ensureItem(g, `${EQ}.Ekz3r0UKJ261oBJj`);
    const setItem = (id, data) => ctx.call("upsert-actor-item", { actorId, itemData: data, match: { path: "_id", value: id } });
    const hands = i => (i.type === "weapon") ? ((i.system?.type?.value === "natural") ? 0 : (i.system?.properties ?? []).includes("two") ? 2 : 1)
      : ((i.type === "equipment") && (i.system?.type?.value === "shield")) ? 1 : 0;
    const held = ((await ctx.call("get-actor", { actorId })).items ?? []).filter(i => i.system?.equipped && hands(i));
    if ( held.reduce((n, i) => n + hands(i), 0) >= 2 ) {
      await use(lamp);
      ctx.expect(!(await lit()).length, `mains pleines (${held.map(i => i.name).join(", ")}) : la lampe n'est pas allumée`);
    }
    for ( const i of held ) await setItem(i._id, { "system.equipped": false });
    ctx.restore(async () => { for ( const i of held ) await setItem(i._id, { "system.equipped": true }); });
    await use(lamp);
    let l = await light();
    ctx.expect((l.bright === 15) && (l.dim === 45) && (l.animation === "torch"), `lampe allumée : ${l.bright}/${l.dim} ft, animation ${l.animation}`);
    await use(lamp);
    l = await light();
    ctx.expect((l.bright === base.bright) && (l.dim === base.dim) && !(await lit()).length, `lampe éteinte : ${l.bright}/${l.dim}, plus d'effet`);

    // 2. Bullseye Lantern: a Cone.
    const bullseye = await ctx.ensureItem(g, `${EQ}.KZUoiZrigDbovEu7`);
    await use(bullseye);
    l = await light();
    ctx.expect((l.bright === 60) && (l.dim === 120) && (l.angle === 53), `lanterne sourde : ${l.bright}/${l.dim} ft en cône de ${l.angle}°`);
    // §121: BLFX's built-in macro for this lantern wrote the token's light (flag `torchData` on the token, equipmentMacros.js:6);
    // darsh-animations replaces it, if present. The flag must not appear.
    const blfx = (await ctx.call("get-scene-object", { type: "Token", objectId: g.id })).data.flags?.["boss-loot-assets-premium"] ?? {};
    ctx.expect(!Object.keys(blfx).some(k => /torchData|lantern/i.test(k)), `BLFX n'a pas écrit la lumière du token (${Object.keys(blfx).join(", ") || "aucun drapeau"})`);
    await use(bullseye);

    // 3. Torch, by the tinderbox (the lamp and the lantern are extinguished: three sources, hence a choice — we remove the
    // first two so that the torch stays alone and is lit automatically).
    for ( const id of [lamp, bullseye] ) await ctx.call("remove-embedded-item", { documentType: "Actor", id: actorId, itemId: id }).catch(() => {});
    await pause(1000);
    const torch = await ctx.ensureItem(g, `${EQ}.gYKSyS7STTresmnS`);
    const tinderbox = await ctx.ensureItem(g, `${EQ}.367bsHMaHI1II4k9`);
    await use(tinderbox);
    l = await light();
    ctx.expect((l.bright === 20) && (l.dim === 40), `boîte à amadou : torche allumée, ${l.bright}/${l.dim} ft`);

    // 4. The torch leaves the sheet: its light goes out.
    await ctx.call("remove-embedded-item", { documentType: "Actor", id: actorId, itemId: torch });
    await pause(2500);
    l = await light();
    ctx.expect(!(await lit()).length && (l.bright === base.bright), `torche retirée : plus de lumière (${l.bright}/${l.dim})`);
  }
};
