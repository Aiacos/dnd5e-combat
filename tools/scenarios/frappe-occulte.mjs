/**
 * Eldritch Smite on a hit (§47 bis). World `ravenloft`: Kaalisti (Warlock 5, Pact of the Blade, level 3 pact slot) hits Rahadin
 * (failing that, the Zombi) with Porte-Fardeau, in combat.
 *  1. On the hit's damage roll, the question offers Eldritch Smite: chosen → +(1 + level)d8 force on that roll, one pact slot
 *     spent, the target (size M) Prone.
 *  2. A second hit that lands in the same turn: Eldritch Smite is no longer offered (once per turn).
 * Not applicable without Kaalisti. Restores the slot, the turn's mark, the HP and the target's condition.
 */
const MODULE_ID = "dnd5e-combat";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "Frappe occulte — proposée au toucher, emplacement de pacte, À terre, une fois par tour",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !tokens.some(t => t.name === "Kaalisti") ) { ctx.log("Kaalisti absent : non applicable"); return; }
    const warlock = await ctx.token("Kaalisti");
    // A target that survives the hit (the Zombi, 22 HP at most, died from the sword and the 4d8: at 0 HP, no Prone):
    // Rahadin (M).
    const target = tokens.find(t => /^Rahadin/.test(t.name)) ?? await ctx.token("Zombi");
    const actor = () => ctx.call("get-actor", { actorId: warlock.actorId });
    const pactValue = async () => Number((await actor()).system?.spells?.pact?.value) || 0;
    const slots0 = await pactValue();
    ctx.restore(() => ctx.call("update-actor", { actorId: warlock.actorId, actorData: { "system.spells.pact.value": slots0 } }).catch(() => {}));
    await ctx.call("update-actor", { actorId: warlock.actorId, actorData: { "system.spells.pact.value": 2 } });
    // The "once per turn" mark from a previous run (Kaalisti may be in a user's combat, which does not advance).
    const clearOnce = () => ctx.call("update-actor", { actorId: warlock.actorId, actorData: { "flags.dnd5e-combat.oncePerTurn.-=eldritch-smite": null } }).catch(() => {});
    await clearOnce();
    ctx.restore(clearOnce);

    const hp0 = await ctx.hp(target);
    const home = await ctx.position(target);
    const grid = await ctx.gridSize();
    ctx.restore(() => ctx.setHp(target, hp0));
    ctx.restore(() => ctx.call("move-token", { tokenId: target.id, x: home.x, y: home.y, elevation: home.elevation }).catch(() => {}));
    ctx.restore(() => ctx.call("set-status", { tokenId: target.id, statusId: "prone", active: false }).catch(() => {}));
    const w = await ctx.position(warlock);
    await ctx.call("move-token", { tokenId: target.id, x: w.x + grid, y: w.y, elevation: w.elevation });
    await ctx.setHp(target, (await ctx.engine("stats", { tokenId: target.id }))?.hp?.max ?? hp0);

    await ctx.startCombat([warlock, target]);
    const sword = await ctx.itemId(warlock.id, "greatsword");
    const known = async () => (await ctx.call("list-dialogs", {})).windows.map(x => x.id);
    /** The on-hit question: returns what it offered, after answering with the button that matches `pick`. */
    const answer = async (ids, pick, ms=8000) => {
      for ( const stop = Date.now() + ms; Date.now() < stop; ) {
        const r = await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: ids, waitMs: 1500, details: true }).catch(() => null);
        const d = (r?.windows ?? []).find(x => /toucher|On hit|Châtiment|Smite/i.test(`${x.title ?? ""}`));
        if ( !d ) continue;
        const labels = (d.buttons ?? []).map(b => b.label ?? "");
        const b = (d.buttons ?? []).find(x => pick.test(x.label ?? "")) ?? (d.buttons ?? []).at(-1);
        await ctx.call("answer-dialog", { id: d.id, button: b.action ?? b.label }).catch(() => {});
        return labels;
      }
      return null;
    };
    /** Kaalisti strikes until a hit (10 tries); returns the question seen and the damage roll. */
    const hits = async pick => {
      for ( let n = 0; n < 10; n++ ) {
        const ids = await known();
        const since = await ctx.lastMessageId();
        const u = await ctx.use({ tokenId: warlock.id, itemId: sword, activityType: "attack", targetTokenIds: [target.id],
          usageConfig: { [MODULE_ID]: { confirmed: true, autoReact: "none" } } });
        const asked = await answer(ids, pick);
        const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
        if ( r?.targets?.find(t => t.name === target.name)?.hit !== true ) continue;
        await pause(2000);
        return { asked, damage: (await ctx.messagesSince(since)).find(m => m.type === "damage") };
      }
      return null;
    };

    const first = await hits(/Frappe occulte|Eldritch Smite/i);
    if ( !ctx.expect(!!first, `Porte-Fardeau touche ${target.name} (10 essais au plus)`) ) return;
    ctx.expect((first.asked ?? []).some(l => /Frappe occulte|Eldritch Smite/i.test(l)), `Frappe occulte proposée (${(first.asked ?? []).join(" / ") || "aucune question"})`);
    const smite = first.damage?.flags?.[MODULE_ID]?.smite;
    ctx.expect((smite?.kind === "rider") && (smite?.formula === "4d8") && (smite?.type === "force"), `+4d8 de force sur le jet (${JSON.stringify(smite)})`);
    ctx.expect((await pactValue()) === 1, `un emplacement de pacte dépensé (2 → ${await pactValue()})`);
    await pause(1500);
    const prone = (await ctx.engine("stats", { tokenId: target.id }))?.statuses?.includes("prone");
    ctx.expect(prone === true, `${target.name} est À terre (${prone})`);

    // Still Kaalisti's turn: a second hit no longer offers it.
    await ctx.call("set-status", { tokenId: target.id, statusId: "prone", active: false }).catch(() => {});
    const second = await hits(/Frappe occulte|Eldritch Smite/i);
    if ( !ctx.expect(!!second, "second coup qui touche (10 essais au plus)") ) return;
    ctx.expect(!(second.asked ?? []).some(l => /Frappe occulte|Eldritch Smite/i.test(l)), `une fois par tour : plus proposée (${(second.asked ?? []).join(" / ") || "aucune question"})`);
    ctx.expect((await pactValue()) === 1, `aucun autre emplacement dépensé (${await pactValue()})`);
  }
};
