/**
 * §500 (B20) — death by drain announced to the whole table: when a drain brings the target's Hit Point maximum to 0, it dies
 * (existing rule, runtime/drain.mjs) AND the engine places a chat card (flag `drainDeath`) with a notice and a sound on every
 * client. Test arena: Zombie (the attacker), Bandit (the target, the token's synthetic actor). A test feature is lent to the
 * Zombie: an attack
 * whose text states the Monster Manual 2024 drain ("Hit Point maximum decreases by an amount equal to the Necrotic damage taken …
 * dies if this effect reduces its Hit Point maximum to 0"). The damage is applied by the GM's client like the button of a damage
 * card (`applyDamage` with an origin message in memory that names the Zombie and the feature's activity): exact amounts, no roll,
 * no window. The Bandit receives 999 Temporary Hit Points: its HP do not drop to 0 through the damage (death is only due to
 * the drain).
 *  1. Necrotic damage = half of its maximum: the maximum drops by that much, no death, no card.
 *  2. Necrotic damage = the rest of the maximum: maximum at 0 → Dead, a single `drainDeath` card (the Bandit, the feature, "hp").
 * Drain effect, Dead, Temporary Hit Points, HP and feature restored.
 */
const MODULE_ID = "dnd5e-combat";
const pause = ms => new Promise(r => setTimeout(r, ms));

const IDENTIFIER = "das-essai-drain-mort";
const ACTIVITY = "dasEssaiDrainAtk";
// Name as a constant: the test bench and the reference take the first "name:" indented by two spaces as the scenario title.
const ITEM_NAME = "Essai : drain mortel";
const TEXT = "<p>Melee Attack Roll: +5, reach 5 ft. Hit: 7 (2d6) Necrotic damage. The target's Hit Point maximum decreases by an amount "
  + "equal to the Necrotic damage taken. The target dies if this effect reduces its Hit Point maximum to 0.</p>";

const SETUP = `
const actor = canvas.scene.tokens.get(args.attacker).actor;
for ( const i of actor.items.filter(i => i.system?.identifier === args.identifier) ) await i.delete();
const [item] = await actor.createEmbeddedDocuments("Item", [{ name: args.name, type: "weapon", img: "icons/magic/unholy/hand-claw-glow-orange.webp",
  system: { identifier: args.identifier, type: { value: "natural" }, description: { value: args.text },
    activities: { [args.activity]: { _id: args.activity, type: "attack", activation: { type: "action", value: 1 },
      attack: { type: { value: "melee", classification: "weapon" } }, damage: { parts: [] } } } } }]);
return { itemId: item.id, activity: item.system.activities.get(args.activity)?.uuid ?? null };
`;
/** La cible : PV, maximum en vigueur, Mort, effets de drain. `clean` : retire drain et Mort, remet PV temporaires et PV. */
const STATE = `
const actor = canvas.scene.tokens.get(args.target).actor;
if ( args.clean ) {
  const ids = actor.effects.filter(e => e.flags?.["${MODULE_ID}"]?.drain || e.statuses?.has("dead") || e.statuses?.has("unconscious")).map(e => e.id);
  if ( ids.length ) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
  await actor.update({ "system.attributes.hp.temp": args.temp ?? 0, "system.attributes.hp.value": args.hp ?? actor.system.attributes.hp.max });
}
const hp = actor.system.attributes.hp;
return { hp: hp.value, max: hp.max, effectiveMax: hp.effectiveMax ?? (hp.max + (hp.tempmax ?? 0)), temp: hp.temp,
  dead: actor.statuses.has("dead"), drains: actor.effects.filter(e => e.flags?.["${MODULE_ID}"]?.drain).length };
`;
const HURT = `
const target = canvas.scene.tokens.get(args.target).actor;
const from = canvas.scene.tokens.get(args.attacker);
const message = new ChatMessage.implementation({ speaker: { scene: canvas.scene.id, token: from.id, actor: from.actorId, alias: from.name },
  flags: { dnd5e: { activity: { uuid: args.activity } } } });
await target.applyDamage([{ value: args.value, type: "necrotic", properties: new Set() }], { originatingMessage: message });
return true;
`;
const CLEANUP = `
const actor = canvas.scene.tokens.get(args.attacker)?.actor;
for ( const i of actor?.items.filter(i => i.system?.identifier === args.identifier) ?? [] ) await i.delete();
return true;
`;

export default {
  name: "drain-mort — maximum de PV drainé à 0 : la cible meurt et la table le voit (carte de chat, avis, son) ; pas de carte avant (§500, brique B20)",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const need = ["Zombi", "Bandit"];
    if ( need.some(n => !tokens.some(t => t.name === n)) ) { ctx.log(`${need.join(", ")} requis : non applicable`); return; }
    const zombie = await ctx.token("Zombi");
    const bandit = await ctx.token("Bandit");
    const script = async (code, args={}) => (await ctx.call("run-script", { code, args, waitMs: 20000 }))?.result ?? null;

    // --- Windows on the GM's side: none stays unanswered ------------------------------------------------------------------
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

    // --- Clean Bandit (synthetic actor), feature lent to the Zombie -------------------------------------------------------
    const start = await script(STATE, { target: bandit.id });
    const clean = (temp=0, hp=null) => script(STATE, { target: bandit.id, clean: true, temp, hp });
    await clean(0);
    ctx.restore(() => clean(start?.temp ?? 0, start?.hp ?? null).catch(() => {}));
    const lent = await script(SETUP, { attacker: zombie.id, identifier: IDENTIFIER, name: ITEM_NAME, activity: ACTIVITY, text: TEXT });
    ctx.restore(() => script(CLEANUP, { attacker: zombie.id, identifier: IDENTIFIER }).catch(() => {}));
    if ( !ctx.expect(!!lent?.activity, `trait de drain prêté au Zombi (${JSON.stringify(lent)})`) ) return;
    const fresh = await clean(999);
    if ( !ctx.expect(fresh.max >= 2 && !fresh.dead && fresh.temp === 999, `Bandit vivant, ${fresh.max} PV max, 999 PV temporaires`) ) return;

    const hit = async value => {
      const since = await ctx.lastMessageId();
      await script(HURT, { target: bandit.id, attacker: zombie.id, activity: lent.activity, value });
      await pause(2500);
      await sweep(300);
      const cards = (await ctx.messagesSince(since)).filter(m => m.flags?.[MODULE_ID]?.drainDeath).map(m => m.flags[MODULE_ID].drainDeath);
      return { state: await script(STATE, { target: bandit.id }), cards };
    };

    try {
      const half = Math.floor(fresh.max / 2);
      const first = await hit(half);
      ctx.expect(first.state.effectiveMax === fresh.max - half && first.state.drains === 1, `drain : maximum ${fresh.max} → ${first.state.effectiveMax} (attendu ${fresh.max - half})`);
      ctx.expect(!first.state.dead && !first.cards.length, `pas de mort ni de carte avant 0 (${JSON.stringify(first)})`);

      const second = await hit(fresh.max - half);
      ctx.expect(second.state.effectiveMax <= 0, `maximum drainé à 0 (${second.state.effectiveMax})`);
      ctx.expect(second.state.dead === true, "le Bandit meurt");
      const card = second.cards[0] ?? null;
      ctx.expect(second.cards.length === 1 && card.kind === "hp" && String(card.actor).includes(`Token.${bandit.id}`),
        `une carte « mort par drain » (${JSON.stringify(second.cards)})`);
    } finally {
      await clean(0);
    }
    const errors = await ctx.clientErrors();
    ctx.expect(!errors.length, `aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(e => e.message ?? e.text).join(" | ").slice(0, 300)}` : ""}`);
  }
};
