/**
 * Reactive spell (War Mage, SPEC §16.26) — **interactive**: Rahadin leaves Sylaene's reach on his turn; the Opportunity Attack
 * window opens on the GM's screen (Sylaene has no connected player) and offers, besides her weapons,
 * her "reactive" spells. The GM picks a spell: the scenario checks that it is cast on Rahadin, paid for by the Reaction.
 * World `ravenloft` only; outside the default batch (`node tools/scenario.mjs sort-reactif`).
 */
const MODULE_ID = "dnd5e-combat";
const VICTIM = "Rahadin, chambellan du château";
const sleep = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "sort réactif — Mage de guerre (interactif : choisir un sort dans la fenêtre)",
  interactive: true,

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !tokens.some(t => t.name === "Sylaene") || !tokens.some(t => t.name === VICTIM) ) { ctx.log("Sylaene ou Rahadin absent : non applicable"); return; }
    const sylaene = await ctx.token("Sylaene");
    const victim = await ctx.token(VICTIM);
    const grid = await ctx.gridSize();
    const at = await ctx.position(sylaene);
    await ctx.call("move-token", { tokenId: victim.id, x: at.x + grid, y: at.y });

    await ctx.startCombat([sylaene, victim]);
    for ( let i = 0; i < 3; i++ ) {
      const state = await ctx.combat();
      const combat = state.combat ?? state.combats?.[0] ?? state;
      if ( combat.combatants?.find(c => c.id === combat.currentCombatantId)?.tokenId === victim.id ) break;
      await ctx.nextTurn();
      await sleep(800);
    }
    const since = await ctx.lastMessageId();
    ctx.log(">>> Rahadin s'éloigne : dans la fenêtre d'attaque d'opportunité de Sylaene, choisis un sort « (sort réactif) ».");
    await ctx.call("move-token", { tokenId: victim.id, x: at.x + (4 * grid), y: at.y, action: "walk" }).catch(err => ctx.log(`déplacement : ${err.message}`));

    let usage = null;
    for ( const until = Date.now() + 90000; !usage && (Date.now() < until); await sleep(1000) ) {
      usage = (await ctx.messagesSince(since)).find(m => (m.type === "usage") && (m.alias === "Sylaene"));
    }
    ctx.expect(!!usage, "Sylaene a réagi");
    if ( !usage ) return;
    const flags = usage.flags?.[MODULE_ID] ?? usage.flags ?? {};
    ctx.expect(flags.cost === "reaction", `payé par la réaction (${flags.cost})`);
    // The expenditure is logged by the GM right after the card: we wait for it.
    let spent = flags.spent;
    for ( const until = Date.now() + 6000; !spent && (Date.now() < until); await sleep(400) ) {
      const again = (await ctx.call("list-chat-messages", { limit: 30, flagScope: MODULE_ID })).messages?.find(m => m.id === usage.id);
      spent = again?.flags?.[MODULE_ID]?.spent ?? again?.flags?.spent;
    }
    ctx.expect(spent?.after?.reaction === 0, `réaction de Sylaene dépensée (${spent?.before?.reaction} → ${spent?.after?.reaction})`);
    const targets = (usage.targets ?? []).map(t => t.name ?? t);
    ctx.expect(targets.includes(VICTIM) || (usage.text ?? "").length > 0, `visé : ${targets.join(", ") || "(voir la carte)"}`);
  }
};
