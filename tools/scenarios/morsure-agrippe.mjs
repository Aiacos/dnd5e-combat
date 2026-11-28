/**
 * §504 (B24) — "instead of dealing damage, the creature can grapple the target (DC 11 to escape)": `choice: { outcome:
 * ["damage", "grapple"], grapple: { escapeDc: 11 } }`. Test arena: Zombie (the attacker, synthetic actor), Fighter (the target). A
 * test trait is lent to the Zombie: a melee attack (+50 to hit, 3 fixed bludgeoning); its rule is in the world's overlay
 * (`overrideContent`, never as an item flag). The choice is given in advance at use (`usageConfig.dnd5e-combat.choice`,
 * like the menu entry): no window waits.
 *  1. Grapple chosen: the Fighter loses no HP, they are Grappled, the effect carries the escape DC 11; the resolution notes the
 *     choice.
 *  2. Damage chosen: the Fighter loses 3 HP, they are not grappled.
 * The Fighter is first placed in contact with the Zombie (in the Arena they are two cells away: the grapple, judged at reach,
 * would be broken at once — test bench failure of 2026-11-20). The "Grapples: …" mark of the grappler is checked too.
 * A natural 1 misses: each attack is replayed up to three times. Grappled, trait, overlay, HP, position restored. Any
 * "do it anyway" window is accepted ("go"), any other closed.
 */
const MODULE_ID = "dnd5e-combat";
const pause = ms => new Promise(r => setTimeout(r, ms));

const IDENTIFIER = "das-essai-morsure-agrippe";
const ACTIVITY = "dasEssaiMorsAgr0";
// Name as a constant: the test bench and the reference take the first "name:" indented by two spaces as the scenario title.
const ITEM_NAME = "Essai : morsure qui agrippe";
const RULE = { choice: { outcome: ["damage", "grapple"], grapple: { escapeDc: 11 } } };
const GRAPPLE = "outcome.grapple";
const DAMAGE = "outcome.damage";

const LEND = `
const actor = canvas.scene.tokens.get(args.attacker).actor;
for ( const i of actor.items.filter(i => i.system?.identifier === args.identifier) ) await i.delete();
if ( args.remove ) return true;
const [item] = await actor.createEmbeddedDocuments("Item", [{ name: args.name, type: "weapon", img: "icons/creatures/abilities/mouth-teeth-long-red.webp",
  system: { identifier: args.identifier, type: { value: "natural" }, description: { value: "<p>Essai §504.</p>" },
    activities: { [args.activity]: { _id: args.activity, type: "attack", activation: { type: "action", value: 1 },
      range: { reach: 60, units: "ft", override: true }, target: { affects: { type: "creature", count: "1" } },
      attack: { type: { value: "melee", classification: "weapon" }, bonus: "50", flat: true },
      damage: { includeBase: false, parts: [{ number: null, denomination: null, bonus: "3", types: ["bludgeoning"], custom: { enabled: true, formula: "3" } }] } } } } }]);
return { itemId: item.id };
`;
/** The Fighter's state: HP, Grappled by this attack and its escape DC; the grappler's mark on the Zombie. */
const READ = `
const token = canvas.scene.tokens.get(args.target);
const actor = token.actor;
const grapple = actor.effects.find(e => !e.disabled && e.statuses?.has("grappled"));
const zombie = canvas.scene.tokens.get(args.attacker)?.actor;
const marks = (zombie?.effects ?? []).map(e => e.getFlag("${MODULE_ID}", "grappling")?.target).filter(Boolean);
return { hp: actor.system.attributes.hp.value, grappled: !!grapple, escapeDc: grapple?.getFlag("${MODULE_ID}", "escapeDc") ?? null,
  mark: marks.includes(token.uuid), marks };
`;

export default {
  name: "morsure-agrippe — au lieu d'infliger les dégâts, l'attaquant agrippe la cible (DD 11 pour s'échapper) ; ou il inflige les dégâts, sans empoignade (§504, brique B24)",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const need = ["Zombi", "Guerrier"];
    if ( need.some(n => !tokens.some(t => t.name === n)) ) { ctx.log(`${need.join(", ")} requis : non applicable`); return; }
    const zombie = await ctx.token("Zombi");
    const fighter = await ctx.token("Guerrier");
    const script = async (code, args={}) => (await ctx.call("run-script", { code, args, waitMs: 20000 }))?.result ?? null;

    // --- Windows at the GM: none stays unanswered ---------------------------------------------------------------------
    const seen = new Set(((await ctx.call("list-dialogs", {})).windows ?? []).map(w => w.id));
    const sweep = async (ms=800) => {
      const r = await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: [...seen], waitMs: ms, details: true }).catch(() => null);
      for ( const w of r?.windows ?? [] ) {
        seen.add(w.id);
        const go = (w.buttons ?? []).find(b => b.action === "go");
        const button = go ? "go" : ((w.buttons ?? []).find(b => ["cancel", "no", "none"].includes(b.action))?.action ?? null);
        ctx.log(`fenêtre « ${w.title} » : ${button ?? "fermée"}`);
        await ctx.call("answer-dialog", { id: w.id, ...(button ? { button } : {}) }).catch(() => {});
      }
    };

    // In contact: the grapple is judged at the grappler's reach.
    const size = await ctx.gridSize();
    ctx.restore(() => ctx.call("move-token", { tokenId: fighter.id, x: fighter.x, y: fighter.y }).catch(() => {}));
    await ctx.call("move-token", { tokenId: fighter.id, x: zombie.x + size, y: zombie.y });
    await pause(800);
    const clear = () => ctx.removeStatusEffects(fighter, "grappled").catch(() => {});
    await clear();
    ctx.restore(clear);
    const hp0 = await ctx.hp(fighter);
    ctx.restore(() => ctx.setHp(fighter, hp0).catch(() => {}));
    const lent = await script(LEND, { attacker: zombie.id, identifier: IDENTIFIER, name: ITEM_NAME, activity: ACTIVITY });
    ctx.restore(() => script(LEND, { attacker: zombie.id, identifier: IDENTIFIER, remove: true }).catch(() => {}));
    if ( !ctx.expect(!!lent?.itemId, "trait d'attaque prêté au Zombi") ) return;
    const { before } = await ctx.engine("overrideContent", { identifier: IDENTIFIER, entry: RULE });
    ctx.restore(() => ctx.engine("overrideContent", { identifier: IDENTIFIER, entry: before }).catch(() => {}));
    await pause(800);

    /** An attack with the `choice` outcome given in advance; returns the resolution of the hit, or null. */
    const bite = async choice => {
      for ( let shot = 1; shot <= 3; shot++ ) {
        const used = await ctx.use({ tokenId: zombie.id, itemId: lent.itemId, activityType: "attack", targetTokenIds: [fighter.id], consume: false,
          usageConfig: { [MODULE_ID]: { choice } } });
        await sweep(500);
        const r = await ctx.settle(used.usageMessageId).catch(err => { ctx.log(err.message); return null; });
        await pause(2000);
        await sweep(300);
        if ( r?.targets?.[0]?.hit ) return r;
        ctx.log(`attaque ${shot} : ratée (${r?.attack?.roll?.total ?? "?"})`);
      }
      return null;
    };

    try {
      await ctx.setHp(fighter, hp0);
      const s0 = await script(READ, { target: fighter.id, attacker: zombie.id });
      const r1 = await bite(GRAPPLE);
      if ( !ctx.expect(!!r1, "le Zombi touche le Guerrier (empoignade choisie)") ) return;
      const s1 = await script(READ, { target: fighter.id, attacker: zombie.id });
      ctx.expect(r1.choice === GRAPPLE, `la résolution note l'empoignade (${JSON.stringify(r1.choice)})`);
      ctx.expect(s1.hp === s0.hp, `aucun dégât : PV ${s0.hp} → ${s1.hp}`);
      ctx.expect(s1.grappled && (s1.escapeDc === 11), `Agrippé, DD d'évasion 11 (${JSON.stringify(s1)})`);
      ctx.expect(s1.mark, `la marque « Agrippe : Guerrier » est sur le Zombi (marques : ${JSON.stringify(s1.marks)})`);
      if ( !s1.grappled ) ctx.log((await ctx.engineLog().catch(() => [])).filter(l => /grapple|grappled|condition/.test(l)).slice(-4).join(" | "));

      await clear();
      await pause(800);
      const r2 = await bite(DAMAGE);
      if ( !ctx.expect(!!r2, "le Zombi touche le Guerrier (dégâts choisis)") ) return;
      const s2 = await script(READ, { target: fighter.id, attacker: zombie.id });
      ctx.expect(s1.hp - s2.hp === 3, `3 dégâts : PV ${s1.hp} → ${s2.hp}`);
      ctx.expect(!s2.grappled, "pas d'empoignade");
    } finally {
      await clear();
    }
    const errors = await ctx.clientErrors();
    ctx.expect(!errors.length, `aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(e => e.message ?? e.text).join(" | ").slice(0, 300)}` : ""}`);
  }
};
