/**
 * Audit of the Dungeon Master's Guide and Player's Handbook potions (SPEC §53) — a diagnostic, not a test: the Fighter drinks
 * each potion (with no designated target, like a player drinking) and we record what comes out — effects placed and on whom,
 * HP, Temporary Hit Points, conditions, spell cast. `ONLY=speed,flying` drinks only the potions whose identifier contains
 * one of these words. Restores everything.
 */
import { RESTORED_KEEP } from "../lib/stages.mjs";

const PACKS = ["dnd-dungeon-masters-guide.equipment", "dnd-players-handbook.equipment"];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "audit des potions — ce que chacune fait vraiment",
  audit: true,   // a diagnostic: played only when named (`node tools/scenario.mjs potions-audit`)

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !tokens.some(t => t.name === "Guerrier") ) { ctx.log("Guerrier requis : non applicable"); return; }
    await ctx.stage(RESTORED_KEEP);
    const g = await ctx.token("Guerrier");
    const actorId = (await ctx.call("get-scene-object", { type: "Token", objectId: g.id })).data.actorId;
    const hp0 = await ctx.hp(g);
    const actor = async () => ctx.call("get-actor", { actorId });
    const baseEffects = new Set(((await actor()).effects ?? []).map(e => e._id));
    const baseItems = new Set(((await actor()).items ?? []).map(i => i._id));
    const reset = async () => {
      const a = await actor();
      for ( const e of a.effects ?? [] ) if ( !baseEffects.has(e._id) ) await ctx.call("remove-embedded-effect", { documentType: "Actor", id: actorId, effectId: e._id }).catch(() => {});
      // The spell copies are left first: removing the potion takes them away (dnd5e, data/item/templates/activities.mjs:503-508);
      // removing them too caused "Item … does not exist!" in the GM's console. The sheet is re-read for what remains.
      const removeAll = list => Promise.all(list.filter(i => !baseItems.has(i._id))
        .map(i => ctx.call("remove-embedded-item", { documentType: "Actor", id: actorId, itemId: i._id }).catch(() => {})));
      await removeAll((a.items ?? []).filter(i => !i.flags?.dnd5e?.cachedFor));
      // dnd5e removes the copy without waiting for it (`deleteEmbeddedDocuments` not awaited, :508): re-read too early, it was
      // still there and went away twice (Potion of Speed, one pass in two). We give it time.
      if ( (a.items ?? []).some(i => !baseItems.has(i._id) && i.flags?.dnd5e?.cachedFor) ) await pause(1000);
      await removeAll((await actor()).items ?? []);
      await ctx.call("update-actor", { actorId, actorData: { "system.attributes.hp.value": Math.max(1, (hp0 ?? 20) - 12), "system.attributes.hp.temp": 0 } });
    };
    ctx.restore(async () => { await reset(); if ( hp0 !== null ) await ctx.setHp(g, hp0); });

    const only = (process.env.ONLY ?? "").split(",").map(s => s.trim()).filter(Boolean);
    const potions = [];
    for ( const pack of PACKS ) {
      const r = await ctx.call("list-compendium-entries", { packId: pack }).catch(() => null);
      for ( const e of (Array.isArray(r) ? r : (r?.entries ?? [])) ) if ( e.type === "consumable" ) potions.push({ pack, ...e });
    }
    const seen = new Set();
    // The console errors collected potion by potion (the buffer empties on each read): each is attached to its row.
    const errors = [];
    await ctx.clientErrors();
    for ( const p of potions ) {
      const uuid = p.uuid;
      const { data } = await ctx.call("get-compendium-entry", { uuid }).catch(() => ({ data: null }));
      if ( (data?.type !== "consumable") || (data.system?.type?.value !== "potion") ) continue;
      const id = data.system.identifier;
      if ( seen.has(id) || (only.length && !only.some(o => id.includes(o))) ) continue;
      seen.add(id);
      await reset();
      await pause(500);
      const { _id, folder, ownership, _stats, ...itemData } = data;
      const added = await ctx.call("upsert-embedded-item", { documentType: "Actor", id: actorId, itemData, match: { path: "name", value: data.name } });
      const activities = Object.values(data.system.activities ?? {});
      const first = activities[0];
      if ( !first ) { ctx.log(`${id} : aucune activité`); continue; }
      const before = await actor();
      const since = await ctx.lastMessageId();
      const windowsBefore = new Set((await ctx.engine("windows")).map(w => w.id));
      let outcome = "";
      try {
        const used = await ctx.use({ tokenId: g.id, itemId: added.itemId, activityType: first.type, targetTokenIds: [], consume: false });
        await pause(1200);
        if ( ["heal", "damage", "save"].includes(first.type) ) await ctx.engine("rollCard", { messageId: used.usageMessageId }).catch(err => { outcome += ` (carte : ${err.message.slice(0, 60)})`; });
        await ctx.settle(used.usageMessageId, { timeoutMs: 15000 }).catch(() => null);
      } catch ( err ) { outcome += ` ÉCHEC ${err.message.slice(0, 80)}`; }
      await pause(2500);
      // A spell with several activities (Detect Thoughts from the Potion of Mind Reading) opens dnd5e's activity choice on the
      // GM's client: at the table the player chooses; here we note it and close it, otherwise it stays on the screen.
      const opened = (await ctx.engine("windows")).filter(w => !windowsBefore.has(w.id));
      for ( const w of opened ) await ctx.engine("closeWindow", { id: w.id }).catch(() => {});
      if ( opened.length ) outcome += ` (fenêtre : ${opened.map(w => w.title ?? w.className).join(", ")})`;
      const after = await actor();
      const fx = (after.effects ?? []).filter(e => !baseEffects.has(e._id) && !(e.statuses ?? []).includes("bloodied")).map(e => `${e.name}${(e.statuses ?? []).length ? `[${e.statuses.join(",")}]` : ""}${process.env.DETAIL ? ` ‹origine ${String(e.origin ?? "").split(".").slice(-2).join(".")}, message ${e.system?.origin?.message ? "oui" : "non"}›` : ""}`);
      const items = (after.items ?? []).filter(i => !baseItems.has(i._id) && (i._id !== added.itemId)).map(i => `${i.name}(${i.type})`);
      const hp = (after.system?.attributes?.hp?.value ?? 0) - (before.system?.attributes?.hp?.value ?? 0);
      const temp = (after.system?.attributes?.hp?.temp ?? 0) - (before.system?.attributes?.hp?.temp ?? 0);
      const engine = (await ctx.messagesSince(since)).filter(m => m.flags?.["dnd5e-combat"]).map(m => {
        const r = m.flags["dnd5e-combat"].resolution;
        return r ? `résolution ${r.step}, ${r.targets?.length ?? 0} cible(s)` : Object.keys(m.flags["dnd5e-combat"]).join("/");
      });
      ctx.log(`${id.padEnd(32)} ${first.type.padEnd(8)} effets : ${fx.join(", ") || "—"} | PV ${hp >= 0 ? "+" : ""}${hp}${temp ? `, temp +${temp}` : ""}`
        + `${items.length ? ` | items : ${items.join(", ")}` : ""} | moteur : ${engine.join(" ; ") || "—"}${outcome}`);
      await reset();
      await pause(800);
      const fresh = (await ctx.clientErrors()).map(e => `${id} : ${e.message ?? e.text}`);
      if ( fresh.length ) { errors.push(...fresh); ctx.log(`  ⚠ ${fresh.join(" | ").slice(0, 300)}`); }
    }
    errors.push(...(await ctx.clientErrors()).map(e => e.message ?? e.text));
    ctx.expect(!errors.length, `aucune erreur dans la console du MJ${errors.length ? ` — ${errors.join(" | ").slice(0, 400)}` : ""}`);
  }
};
