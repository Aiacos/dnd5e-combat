/**
 * Condition facts take a condition or a list (DF #253 of 2026-11-23): `{ "target.hasStatus": ["restrained", "grappled"] }` holds
 * when the target has one of these conditions — the form given by the header of core/triggers.mjs, which the validator accepted
 * but never held. Test Arena, Sorcerer and Zombie. A test rule on Fire Bolt (world overlay): "+5 fire if the target is
 * Restrained or Grappled" (`preDamageRoll`). Fire Bolt fires until it hits:
 *  1. Zombie without condition: no "5" in the damage roll;
 *  2. Zombie Restrained: the "5" is added;
 *  3. the same rule under `not` ("except Restrained or Grappled"), Zombie Restrained: no "5".
 * Restored: overlay, condition, Zombie's HP.
 */
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const LIST = ["restrained", "grappled"];
const bonus = condition => ({ triggers: [{ on: "preDamageRoll", if: condition, do: [{ type: "damage", formula: "5", damageType: "fire" }] }] });

export default {
  name: "faits d'état avec une liste — target.hasStatus [Entravé, Empoigné] (#253)",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Ensorceleur", "Zombi"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Ensorceleur ou Zombi absent : non applicable"); return; }
    const sorc = await ctx.token("Ensorceleur");
    const zombi = await ctx.token("Zombi");
    const hp0 = await ctx.hp(zombi);
    ctx.restore(() => ctx.setHp(zombi, hp0));
    ctx.restore(() => ctx.call("set-status", { tokenId: zombi.id, statusId: "restrained", active: false }).catch(() => {}));
    const { before } = await ctx.engine("overrideContent", { identifier: "fire-bolt", entry: bonus({ "target.hasStatus": LIST }) });
    ctx.restore(() => ctx.engine("overrideContent", { identifier: "fire-bolt", entry: before }).catch(() => {}));
    if ( before ) ctx.log(`surcouche déjà posée sur fire-bolt, remplacée le temps du scénario : ${JSON.stringify(before)}`);

    /** Fire Bolt until it hits (12 tries): the damage roll's formulas, or null. */
    const hit = async label => {
      for ( let i = 0; i < 12; i++ ) {
        await ctx.setHp(zombi, 200);
        const since = await ctx.lastMessageId();
        const used = await ctx.use({ tokenId: sorc.id, identifier: "fire-bolt", activityType: "attack", targetTokenIds: [zombi.id] });
        const r = await ctx.settle(used.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
        if ( !r?.targets?.find(t => t.name === "Zombi")?.hit ) continue;
        await pause(1500);
        const damage = (await ctx.messagesSince(since)).find(m => m.type === "damage");
        const formulas = (damage?.rolls ?? []).map(x => x.formula);
        ctx.log(`${label} : ${JSON.stringify(formulas)}`);
        return formulas;
      }
      ctx.expect(false, `${label} : aucun toucher en 12 essais`);
      return null;
    };
    const hasFive = f => !!f && f.slice(1).some(x => x.trim() === "5");

    const plain = await hit("sans état");
    if ( plain ) ctx.expect(!hasFive(plain), `sans état : pas de +5 (${plain.join(" | ")})`);

    await ctx.call("set-status", { tokenId: zombi.id, statusId: "restrained", active: true });
    await pause(800);
    const held = await hit("Entravé");
    if ( held ) ctx.expect(hasFive(held), `Entravé, l'un des états de la liste : +5 feu (${held.join(" | ")})`);

    await ctx.engine("overrideContent", { identifier: "fire-bolt", entry: bonus({ not: { "target.hasStatus": LIST } }) });
    await pause(300);
    const negated = await hit("sous not, Entravé");
    if ( negated ) ctx.expect(!hasFive(negated), `sous « not », Entravé : pas de +5 (${negated.join(" | ")})`);
  }
};
