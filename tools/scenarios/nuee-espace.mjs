/**
 * §505 (B25) — the swarm: no Temporary Hit Points (`blocksTempHp: true`), and a feature reserved for creatures in its space
 * (`targets.requires: { "target.sharesSpaceWithSource": true }`, refusal from the legality window, forceable). Test arena:
 * Zombie (the "swarm", synthetic actor), Fighter (placed in its cell), Bandit (next to it). A test trait is lent to the
 * Zombie: a utility activity with "self" range that targets a creature; its rule is in the world overlay (`overrideContent`).
 *  1. Temporary Hit Points: 10 Temporary Hit Points applied to the Zombie (like the card of a "temphp" heal) — it receives
 *     none; the rule removed, it receives them (control).
 *  2. The trait on the Fighter (placed in the Zombie's space — the rule also carries `sharesSpace: "mutual"`, like the real
 *     swarm, without which token collision stops it on contact): no legality window, the use card is created.
 *  3. The trait on the Bandit (outside its space): the legality window opens and names the Bandit; we give up, no card.
 * Legality is asked (`confirmed: false`); any other window is closed. Temporary Hit Points, positions, trait, overlay restored.
 */
const MODULE_ID = "dnd5e-combat";
const pause = ms => new Promise(r => setTimeout(r, ms));

const IDENTIFIER = "das-essai-nuee-espace";
const ACTIVITY = "dasEssaiNueeEsp0";
// Name as a constant: the test bench and the reference take the first "name:" indented by two spaces as the scenario title.
const ITEM_NAME = "Essai : nuée qui griffe";
// `sharesSpace` like the real swarm: without it, the Fighter's movement on the displayed scene stops on contact with the Zombie
// (token collision) and they are never in its space — test bench failure of 2026-11-20.
const RULE = { sharesSpace: "mutual", blocksTempHp: true, targets: { requires: { "target.sharesSpaceWithSource": true } } };

const LEND = `
const actor = canvas.scene.tokens.get(args.attacker).actor;
for ( const i of actor.items.filter(i => i.system?.identifier === args.identifier) ) await i.delete();
if ( args.remove ) return true;
const [item] = await actor.createEmbeddedDocuments("Item", [{ name: args.name, type: "feat", img: "icons/creatures/swarms/swarm-insects-green.webp",
  system: { identifier: args.identifier, type: { value: "monster" }, description: { value: "<p>Essai §505.</p>" },
    activities: { [args.activity]: { _id: args.activity, type: "utility", activation: { type: "action", value: 1 },
      range: { units: "self", override: true }, target: { affects: { type: "creature", count: "1" } } } } } }]);
return { itemId: item.id };
`;
const TEMP = `
const actor = canvas.scene.tokens.get(args.tokenId).actor;
if ( args.reset ) { await actor.update({ "system.attributes.hp.temp": 0 }); return 0; }
await actor.applyDamage([{ value: args.value, type: "temphp" }]);
return Number(actor.system.attributes.hp.temp) || 0;
`;
const PLACE = `
const t = canvas.scene.tokens.get(args.tokenId);
await t.update({ x: args.x, y: args.y }, { animate: false });
await new Promise(r => setTimeout(r, 500));
return { x: t._source.x, y: t._source.y };
`;

export default {
  name: "nuee-espace — nuée : aucun PV temporaire reçu ; une capacité réservée aux créatures dans son espace, refusée (forçable) hors de lui (§505, brique B25)",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const need = ["Zombi", "Guerrier", "Bandit"];
    if ( need.some(n => !tokens.some(t => t.name === n)) ) { ctx.log(`${need.join(", ")} requis : non applicable`); return; }
    const zombie = await ctx.token("Zombi");
    const fighter = await ctx.token("Guerrier");
    const bandit = await ctx.token("Bandit");
    const script = async (code, args={}) => (await ctx.call("run-script", { code, args, waitMs: 20000 }))?.result ?? null;

    // --- Windows at the GM ------------------------------------------------------------------------------------------------
    const seen = new Set(((await ctx.call("list-dialogs", {})).windows ?? []).map(w => w.id));
    /** The Zombie's legality window (title "… — Zombie"), or null; the other windows are closed. */
    const legality = async (ms=6000) => {
      for ( const stop = Date.now() + ms; Date.now() < stop; ) {
        const r = await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: [...seen], waitMs: 1000, details: true }).catch(() => null);
        for ( const w of r?.windows ?? [] ) {
          seen.add(w.id);
          if ( / — Zombi$/.test(w.title ?? "") ) return w;
          ctx.log(`fenêtre « ${w.title} » : fermée`);
          await ctx.call("answer-dialog", { id: w.id }).catch(() => {});
        }
      }
      return null;
    };
    ctx.restore(async () => { const d = await legality(500); if ( d ) await ctx.call("answer-dialog", { id: d.id, button: "cancel" }).catch(() => {}); });

    // --- Trait, rule, positions ---------------------------------------------------------------------------------------------
    const lent = await script(LEND, { attacker: zombie.id, identifier: IDENTIFIER, name: ITEM_NAME, activity: ACTIVITY });
    ctx.restore(() => script(LEND, { attacker: zombie.id, identifier: IDENTIFIER, remove: true }).catch(() => {}));
    if ( !ctx.expect(!!lent?.itemId, "trait prêté au Zombi") ) return;
    const { before } = await ctx.engine("overrideContent", { identifier: IDENTIFIER, entry: RULE });
    ctx.restore(() => ctx.engine("overrideContent", { identifier: IDENTIFIER, entry: before }).catch(() => {}));
    ctx.restore(() => script(TEMP, { tokenId: zombie.id, reset: true }).catch(() => {}));
    ctx.restore(() => script(PLACE, { tokenId: fighter.id, x: fighter.x, y: fighter.y }).catch(() => {}));
    await pause(800);

    // 1. PV temporaires.
    await script(TEMP, { tokenId: zombie.id, reset: true });
    const blocked = await script(TEMP, { tokenId: zombie.id, value: 10 });
    ctx.expect(blocked === 0, `la nuée ne reçoit pas de PV temporaires (${blocked})`);
    await ctx.engine("overrideContent", { identifier: IDENTIFIER, entry: { sharesSpace: RULE.sharesSpace, targets: RULE.targets } });
    await pause(500);
    const witness = await script(TEMP, { tokenId: zombie.id, value: 10 });
    ctx.expect(witness === 10, `témoin, sans la règle : 10 PV temporaires reçus (${witness})`);
    await script(TEMP, { tokenId: zombie.id, reset: true });
    await ctx.engine("overrideContent", { identifier: IDENTIFIER, entry: RULE });
    await pause(500);

    // 2 and 3. The target in the swarm's space, then outside it.
    const placed = await script(PLACE, { tokenId: fighter.id, x: zombie.x, y: zombie.y });
    await pause(800);
    if ( !ctx.expect((placed?.x === zombie.x) && (placed?.y === zombie.y), `le Guerrier est dans la case du Zombi (${JSON.stringify(placed)} ; Zombi ${zombie.x},${zombie.y})`) ) return;
    const use = target => ctx.use({ tokenId: zombie.id, itemId: lent.itemId, activityType: "utility", consume: false, targetTokenIds: [target.id],
      usageConfig: { [MODULE_ID]: { confirmed: false } } });
    const usages = async since => (await ctx.messagesSince(since)).filter(m => (m.type === "usage") || m.flags?.dnd5e?.activity);

    let since = await ctx.lastMessageId();
    await use(fighter);
    const inside = await legality(3000);
    if ( inside ) { ctx.log(`fenêtre inattendue : ${JSON.stringify(inside).slice(0, 300)}`); await ctx.call("answer-dialog", { id: inside.id, button: "cancel" }).catch(() => {}); }
    await pause(1000);
    ctx.expect(!inside, "dans l'espace de la nuée : aucune fenêtre de légalité");
    ctx.expect((await usages(since)).length > 0, "la capacité est utilisée sur le Guerrier");

    since = await ctx.lastMessageId();
    await use(bandit);
    const outside = await legality(6000);
    if ( !ctx.expect(!!outside, "hors de l'espace : la fenêtre de légalité s'ouvre") ) return;
    ctx.expect(JSON.stringify(outside).includes("Bandit"), `elle nomme le Bandit (${JSON.stringify(outside).slice(0, 300)})`);
    await ctx.call("answer-dialog", { id: outside.id, button: "cancel" });
    await pause(1200);
    ctx.expect(!(await usages(since)).length, "renoncé : aucune carte d'utilisation");

    const errors = await ctx.clientErrors();
    ctx.expect(!errors.length, `aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(e => e.message ?? e.text).join(" | ").slice(0, 300)}` : ""}`);
  }
};
