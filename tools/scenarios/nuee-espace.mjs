/**
 * §505 (B25) — la nuée : pas de PV temporaires (`blocksTempHp: true`), et une capacité réservée aux créatures dans son espace
 * (`targets.requires: { "target.sharesSpaceWithSource": true }`, refus de la fenêtre de légalité, forçable). Arène de test : Zombi (la
 * « nuée », acteur synthétique), Guerrier (posé dans sa case), Bandit (à côté). Un trait d'essai est prêté au Zombi : une activité
 * utilitaire de portée « soi-même » qui vise une créature ; sa règle est dans la surcouche du monde (`overrideContent`).
 *  1. PV temporaires : 10 PV temporaires appliqués au Zombi (comme la carte d'un soin « temphp ») — il n'en reçoit aucun ; la règle
 *     retirée, il les reçoit (témoin).
 *  2. Le trait sur le Guerrier (dans l'espace du Zombi) : aucune fenêtre de légalité, la carte d'utilisation est créée.
 *  3. Le trait sur le Bandit (hors de son espace) : la fenêtre de légalité s'ouvre et nomme le Bandit ; on renonce, aucune carte.
 * La légalité est demandée (`confirmed: false`) ; toute autre fenêtre est fermée. PV temporaires, positions, trait, surcouche remis.
 */
const MODULE_ID = "dnd5e-combat";
const pause = ms => new Promise(r => setTimeout(r, ms));

const IDENTIFIER = "das-essai-nuee-espace";
const ACTIVITY = "dasEssaiNueeEsp0";
// Nom en constante : le banc et la référence prennent le premier « name: » indenté de deux espaces pour le titre du scénario.
const ITEM_NAME = "Essai : nuée qui griffe";
const RULE = { blocksTempHp: true, targets: { requires: { "target.sharesSpaceWithSource": true } } };

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
return true;
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

    // --- Fenêtres chez le MJ ---------------------------------------------------------------------------------------------------
    const seen = new Set(((await ctx.call("list-dialogs", {})).windows ?? []).map(w => w.id));
    /** La fenêtre de légalité du Zombi (titre « … — Zombi »), ou null ; les autres fenêtres sont fermées. */
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

    // --- Trait, règle, positions ------------------------------------------------------------------------------------------------
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
    await ctx.engine("overrideContent", { identifier: IDENTIFIER, entry: { targets: RULE.targets } });
    await pause(500);
    const witness = await script(TEMP, { tokenId: zombie.id, value: 10 });
    ctx.expect(witness === 10, `témoin, sans la règle : 10 PV temporaires reçus (${witness})`);
    await script(TEMP, { tokenId: zombie.id, reset: true });
    await ctx.engine("overrideContent", { identifier: IDENTIFIER, entry: RULE });
    await pause(500);

    // 2 et 3. La cible dans l'espace de la nuée, puis hors de lui.
    await script(PLACE, { tokenId: fighter.id, x: zombie.x, y: zombie.y });
    await pause(800);
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
