/**
 * §419: the "Damage and healing" setting (`damageFlow`, "Flow" frame) — who rolls the dice and who decides to apply them, on a
 * Sorcerer's Fire Bolt against the Zombie (Test Arena), shot until it hits:
 *  1. `click`: after the hit, the dnd5e damage window on the author's side (#173, §556 — before: DAS's "Roll damage"); no
 *     roll while it is open; "Normal" clicked, the damage is rolled and applied.
 *  2. `validate`: the damage is rolled automatically, the GM's "Apply?" window opens, HP have not moved; refused, nothing is
 *     applied and the resolution closes; replayed and accepted, HP drop.
 *  3. `clickValidate`: both windows, in order.
 *  4. `auto`: no window (the behavior as always).
 * The scenario plays as the GM: the shot's author and the validating GM are the same client.
 * The setting is restored to its previous value.
 */
const MODULE_ID = "dnd5e-combat";
const TERMINAL = new Set(["done", "missed", "undone"]);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "déroulement : dégâts — au clic de l'auteur, validés par le MJ, les deux, d'office",

  async run(ctx) {
    const sorc = await ctx.token("Ensorceleur");
    const zombi = await ctx.token("Zombi");
    const hp0 = await ctx.hp(zombi);
    ctx.restore(() => ctx.setHp(zombi, hp0));
    const before = (await ctx.engine("setting", { key: "damageFlow" }))?.now ?? "level";
    const mode = value => ctx.engine("setting", { key: "damageFlow", value });
    ctx.restore(() => mode(before));

    /** The author's window (button `roll`) or the GM's (buttons `apply` / `refuse`), if there is one. */
    // §556: the author's window is dnd5e's damage dialog (its "Normal" button), found and pressed on the GM client.
    const rollDialog = (press=false) => ctx.call("run-script", { code: `
      const app = [...foundry.applications.instances.values()].find(a => a.rendered && a.config?.["${MODULE_ID}"]?.dialog);
      if ( app && ${press} ) app.element.querySelector('button[data-action="normal"]')?.click();
      return !!app;` }).then(r => r?.result === true).catch(() => false);
    const answer = (w, validate) => (w.kind === "roll") ? rollDialog(true) : ctx.call("answer-dialog", { id: w.id, button: validate });
    const flowWindow = async () => {
      if ( await rollDialog() ) return { id: null, kind: "roll" };
      const r = await ctx.call("list-dialogs", { dialogsOnly: true, waitMs: 400 }).catch(() => null);
      for ( const w of (r?.windows ?? []) ) {
        const actions = (w.buttons ?? []).map(b => b.action);
        if ( actions.includes("apply") && actions.includes("refuse") ) return { id: w.id, kind: "validate", text: [w.content, w.text].filter(Boolean).join(" ") };
      }
      return null;
    };
    ctx.restore(async () => { for ( let w, i = 0; (i < 6) && (w = await flowWindow()); i++ ) await answer(w, "refuse").catch(() => {}); });

    /**
     * Shoots until it hits (eight tries). `answers`: the answer to the GM's window ("apply" or "refuse"). Returns what happened:
     * the windows seen in order, the damage rolls present when each opened, the HP at that moment, the final resolution.
     */
    const shoot = async ({ validate="apply" }={}) => {
      for ( let i = 0; i < 8; i++ ) {
        await ctx.setHp(zombi, hp0);
        const since = await ctx.lastMessageId();
        const used = await ctx.use({ tokenId: sorc.id, identifier: "fire-bolt", activityType: "attack", targetTokenIds: [zombi.id] });
        const seen = [];
        let r = null;
        for ( const stop = Date.now() + 40000; Date.now() < stop; ) {
          r = await ctx.resolution(used.usageMessageId);
          if ( r && TERMINAL.has(r.step) ) break;
          const w = await flowWindow();
          if ( w ) {
            await pause(1200);   // time for a wrongly chained roll to arrive
            const damageRolls = (await ctx.messagesSince(since)).filter(m => m.type === "damage").length;
            seen.push({ kind: w.kind, damageRolls, hp: await ctx.hp(zombi), text: w.text ?? "" });
            await answer(w, validate);
          }
          await pause(300);
        }
        if ( !r?.targets?.[0]?.hit ) continue;
        await pause(1500);
        const messages = await ctx.messagesSince(since);
        return { r, seen, hpAfter: await ctx.hp(zombi), damageRolls: messages.filter(m => m.type === "damage").length };
      }
      return null;
    };
    const kinds = shot => shot.seen.map(s => s.kind).join(" puis ") || "aucune";

    // 1. Au clic de l'auteur.
    await mode("click");
    let shot = await shoot();
    if ( ctx.expect(!!shot, "click : le Trait de feu touche (huit essais au plus)") ) {
      ctx.expect(kinds(shot) === "roll", `click : la fenêtre de dégâts de dnd5e chez l'auteur, et elle seule (${kinds(shot)})`);
      ctx.expect(shot.seen[0]?.damageRolls === 0, `click : aucun jet de dégâts tant qu'elle est ouverte (${shot.seen[0]?.damageRolls})`);
      ctx.expect((shot.r.step === "done") && (shot.damageRolls === 1) && (shot.hpAfter < hp0), `click : cliquée, un jet, dégâts appliqués (${hp0} → ${shot.hpAfter})`);
    }

    // 2. Validated by the GM: refused, then accepted.
    await mode("validate");
    shot = await shoot({ validate: "refuse" });
    if ( ctx.expect(!!shot, "validate : le Trait de feu touche") ) {
      ctx.expect(kinds(shot) === "validate", `validate : la fenêtre « Appliquer ? » du MJ, et elle seule (${kinds(shot)})`);
      ctx.expect((shot.seen[0]?.damageRolls === 1) && (shot.seen[0]?.hp === hp0), `validate : dégâts déjà lancés, PV intacts à l'ouverture (${shot.seen[0]?.damageRolls} jet, ${shot.seen[0]?.hp} PV)`);
      ctx.expect(/Zombi/.test(shot.seen[0]?.text ?? ""), `validate : la fenêtre nomme la cible (${(shot.seen[0]?.text ?? "").slice(0, 120)})`);
      ctx.expect((shot.r.step === "done") && (shot.hpAfter === hp0) && !shot.r.targets[0].damage, `validate : refusé, rien n'est appliqué, la résolution est close (${shot.r.step}, ${shot.hpAfter} PV)`);
    }
    shot = await shoot({ validate: "apply" });
    if ( ctx.expect(!!shot, "validate : le Trait de feu touche une seconde fois") ) {
      ctx.expect((shot.r.step === "done") && (shot.hpAfter < hp0), `validate : accepté, dégâts appliqués (${hp0} → ${shot.hpAfter})`);
    }

    // 3. Les deux.
    await mode("clickValidate");
    shot = await shoot({ validate: "apply" });
    if ( ctx.expect(!!shot, "clickValidate : le Trait de feu touche") ) {
      ctx.expect(kinds(shot) === "roll puis validate", `clickValidate : la fenêtre de l'auteur, puis celle du MJ (${kinds(shot)})`);
      ctx.expect(shot.hpAfter < hp0, `clickValidate : dégâts appliqués (${hp0} → ${shot.hpAfter})`);
    }

    // 4. D'office.
    await mode("auto");
    shot = await shoot();
    if ( ctx.expect(!!shot, "auto : le Trait de feu touche") ) {
      ctx.expect(!shot.seen.length && (shot.hpAfter < hp0), `auto : aucune fenêtre, dégâts appliqués (${kinds(shot)}, ${hp0} → ${shot.hpAfter})`);
    }
  }
};
