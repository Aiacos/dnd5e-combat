/**
 * Audit of a PC sheet (2026-10-29): every playable activity of its spells, features, weapons and consumables, used once in the
 * "Spell Arena" with the sweep invariants (`tools/lib/balayage.mjs`). A COPY of the sheet is played ("<name> (audit)",
 * same items, same ids, same effects), placed in the Caster's stead: the PC's sheet is never touched. The copy is marked as a
 * test actor and removed at the end (`darsh-loot`, `api.mcp.removeTestActors`).
 * Only played when named: `PJ=Kaalisti node tools/scenario.mjs audit-pj`. Sweep variables: `DEPUIS=<identifiant>`, `PILE=1`;
 * `ITEMS=fireball,hellish-rebuke` (identifiers) to play only a few.
 * Outside the audit: the engine's basic actions (`dnd5e-combat-*`), and what the sweep does not play (summons, dismissals).
 */
import { sweep } from "../lib/balayage.mjs";
import { ARENE_SORTS } from "../lib/stages.mjs";

const PLAYED = new Set(["attack", "save", "damage", "heal", "utility", "enchant", "check"]);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "audit d'une fiche de PJ (Arène des sorts, copie de la fiche)",
  scene: ARENE_SORTS.name,
  audit: true,

  async run(ctx) {
    const pj = process.env.PJ;
    if ( !pj ) { ctx.log("PJ=<nom de l'acteur> manquant : non applicable"); return; }
    const only = (process.env.ITEMS ?? "").split(",").filter(Boolean);
    const found = ((await ctx.call("list-actors", {})) ?? []).find(a => a.name === pj);
    if ( !found ) { ctx.log(`acteur « ${pj} » absent du monde : non applicable`); return; }
    const source = await ctx.call("get-actor", { actorId: found.id });
    const NAME = `${pj} (audit)`;

    // The copy: linked, hostile to no one (the Caster's disposition), marked as a test actor.
    const { _id, folder, ownership, _stats, id, ...data } = source;
    const created = await ctx.call("create-actor", { actorData: { ...data, name: NAME,
      prototypeToken: { ...(data.prototypeToken ?? {}), actorLink: true, name: NAME },
      flags: { ...(data.flags ?? {}), "darsh-loot": { test: true } },
      // The arena resets everyone to 999 HP between two uses: a PC with 54 max HP would be capped at its maximum midway.
      system: { ...(data.system ?? {}), attributes: { ...(data.system?.attributes ?? {}), hp: { ...(data.system?.attributes?.hp ?? {}), max: 999, value: 999 } } } } });
    const actorId = created?.id ?? created?.actor?.id;
    ctx.restore(async () => {
      await ctx.call("call-module-api", { moduleId: "darsh-loot", fn: "removeTestActors", args: {} }).catch(err => ctx.log(`copie non retirée : ${err.message}`));
    });

    // The arena's Caster steps aside (northwest corner), the copy takes its place.
    const lanceur = await ctx.token("Lanceur");
    const at = await ctx.position(lanceur);
    const grid = ARENE_SORTS.grid;
    await ctx.call("move-token", { tokenId: lanceur.id, x: grid, y: grid });
    ctx.restore(async () => { await ctx.call("move-token", { tokenId: lanceur.id, x: at.x, y: at.y, elevation: at.elevation ?? 0 }).catch(() => {}); });
    const placed = await ctx.call("place-token", { actorId, sceneId: (await ctx.scene()).sceneId, x: at.x, y: at.y });
    const disposition = (await ctx.call("get-scene-object", { type: "Token", objectId: lanceur.id }))?.data?.disposition;
    const tokenId = placed?.id ?? placed?.token?.id ?? placed?.tokenId;
    if ( tokenId && (disposition !== undefined) ) await ctx.call("update-scene-object", { type: "Token", objectId: tokenId, data: { disposition } }).catch(() => {});
    await pause(1000);
    // `ctx.scene()` keeps the token list from the start of the scenario: the copy is added to it.
    const live = (await ctx.liveTokens()).find(x => x.name === NAME);
    if ( live ) (await ctx.scene()).tokens.push(live);

    const copy = await ctx.call("get-actor", { actorId });
    const levels = (copy.items ?? []).filter(i => i.type === "class").map(i => `${i.name} ${i.system?.levels}`).join(", ");
    ctx.log(`copie de ${pj} (${levels || "sans classe"}) : ${(copy.items ?? []).length} items`);

    await sweep(ctx, {
      kind: `audit-${pj.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      caster: NAME,
      consume: false,
      items: async () => ((await ctx.call("get-actor", { actorId })).items ?? []).map(i => ({ itemId: i._id, data: i })),
      select: d => {
        const ident = d.system?.identifier ?? "";
        if ( ident.startsWith("dnd5e-combat-") ) return false;
        if ( only.length ) return only.includes(ident);
        return Object.values(d.system?.activities ?? {}).some(a => PLAYED.has(a.type));
      },
      sortKey: d => `${d.type}|${String(d.system?.level ?? "").padStart(2, "0")}|${d.name}`
    });
  }
};
