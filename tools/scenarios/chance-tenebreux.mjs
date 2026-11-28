/**
 * Dark One's Luck (SPEC §38), world `dnd-6`. The Warlock receives Dark One's Luck (Player's Handbook); the Cleric casts
 * Charm Person (at will) on him until a failed Wisdom saving throw. The question "add 1d10?" opens on the GM's side (the Warlock
 * has no connected player): the scenario answers "Add" there (`answer-dialog`). Checks:
 *  - the question comes on a failed saving throw, with "Keep the roll" as first option (the one taken when there is no answer);
 *  - the resolution's total = the roll + the d10 (card `rollBonus`), and the verdict follows that total against the DC;
 *  - one use of the item spent.
 * Resets effects and uses; removes the lent items.
 */
const MODULE_ID = "dnd5e-combat";
const pause = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "chance du ténébreux — 1d10 ajouté à une sauvegarde ratée",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Clerc", "Occultiste"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Clerc ou Occultiste absent : non applicable"); return; }
    const cleric = await ctx.token("Clerc");
    const warlock = await ctx.token("Occultiste");
    const luckId = await ctx.ensureItem(warlock, "Compendium.dnd-players-handbook.classes.Item.phbwlkDarkOnesOw");
    const charmId = await ctx.ensureItem(cleric, "Compendium.dnd-players-handbook.spells.Item.phbsplCharmPerso", { system: { method: "atwill" } });
    const effects0 = new Set((await ctx.effects(warlock)).map(e => e._id ?? e.id));
    const clearNew = async () => {
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: warlock.id });
      const sceneId = (await ctx.scene()).sceneId;
      const target = data.actorLink ? { documentType: "Actor", id: data.actorId } : { uuid: `Scene.${sceneId}.Token.${warlock.id}.Actor.${data.actorId}` };
      for ( const e of (await ctx.effects(warlock)).filter(e => !effects0.has(e._id ?? e.id)) ) {
        await ctx.call("remove-embedded-effect", { ...target, effectId: e._id ?? e.id }).catch(() => {});
      }
    };
    ctx.restore(clearNew);
    const spentOf = async () => {
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: warlock.id });
      const items = data.actorLink ? ((await ctx.call("get-actor", { actorId: data.actorId })).items ?? []) : (data.delta?.items ?? []);
      return Number(items.find(i => i._id === luckId)?.system?.uses?.spent) || 0;
    };

    let done = false;
    for ( let n = 1; (n <= 15) && !done; n++ ) {
      await clearNew();
      const known = (await ctx.call("list-dialogs", {})).windows.map(w => w.id);
      const spent0 = await spentOf();
      const since = await ctx.lastMessageId();
      const used = await ctx.use({ tokenId: cleric.id, itemId: charmId, activityType: "save", consume: false, targetTokenIds: [warlock.id] });
      // The question only exists on a failed saving throw: we wait for it a while, otherwise the saving throw succeeded.
      let dialog = null;
      for ( let k = 0; (k < 3) && !dialog; k++ ) {
        dialog = (await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: known, waitMs: 5000 })).windows.find(w => /1d10/.test(w.text ?? "")) ?? null;
      }
      if ( !dialog ) { await ctx.settle(used.usageMessageId, { timeoutMs: 30000 }).catch(() => null); continue; }
      ctx.expect(/Garder|Keep/i.test(dialog.buttons?.[0]?.label ?? ""), `la question vient sur la sauvegarde ratée ; première option : « ${dialog.buttons?.[0]?.label} »`);
      const add = dialog.buttons.find(b => /Ajouter|Add/i.test(b.label ?? ""));
      await ctx.call("answer-dialog", { id: dialog.id, button: add?.action ?? "pick1" });
      const r = await ctx.settle(used.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      await pause(1500);
      const msgs = await ctx.messagesSince(since);
      const save = msgs.find(m => (m.type === "save") && /Occultiste/.test(m.alias ?? ""));
      const raw = (save?.rolls ?? []).reduce((s, x) => s + (x.total ?? 0), 0);
      const added = msgs.find(m => m.flags?.[MODULE_ID]?.rollBonus)?.flags?.[MODULE_ID]?.rollBonus?.added ?? null;
      const t = r?.targets?.find(x => /Occultiste/.test(x.name ?? ""));
      const dc = r?.plan?.save?.dc;
      ctx.expect(Number.isFinite(added) && (t?.save?.total === raw + added), `total ${t?.save?.total} = jet ${raw} + d10 ${added}`);
      ctx.expect(t?.save?.success === (t?.save?.total >= dc), `verdict cohérent : ${t?.save?.total} contre DD ${dc} → ${t?.save?.success ? "réussie" : "ratée"}`);
      ctx.expect((await spentOf()) === spent0 + 1, `une utilisation dépensée (${spent0} → ${await spentOf()})`);
      done = true;
    }
    ctx.expect(done, "une sauvegarde ratée de l'Occultiste vue (15 essais au plus)");
    const errors = await ctx.clientErrors();
    ctx.expect(!errors.length, `aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(e => e.message ?? e.text).join(" | ").slice(0, 300)}` : ""}`);
  }
};
