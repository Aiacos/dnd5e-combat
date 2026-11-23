/**
 * Les faits d'état prennent un état ou une liste (DF #253 du 2026-11-23) : `{ "target.hasStatus": ["restrained", "grappled"] }` vaut quand
 * la cible a l'un de ces états — la forme que donne l'en-tête de core/triggers.mjs, que le validateur acceptait mais qui ne tenait jamais.
 * Arène de test, Ensorceleur et Zombi. Une règle d'essai sur Trait de feu (surcouche du monde) : « +5 feu si la cible est Entravée ou
 * Empoignée » (`preDamageRoll`). Le Trait de feu tire jusqu'à toucher :
 *  1. Zombi sans état : pas de « 5 » dans le jet de dégâts ;
 *  2. Zombi Entravé : le « 5 » s'ajoute ;
 *  3. la même règle sous `not` (« sauf Entravée ou Empoignée »), Zombi Entravé : pas de « 5 ».
 * Remis en état : surcouche, état, PV du Zombi.
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

    /** Trait de feu jusqu'à toucher (12 essais) : les formules du jet de dégâts, ou null. */
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
