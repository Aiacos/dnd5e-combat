/**
 * #173 (§556, §558): the Rogue's damage in dnd5e's damage dialog ("Damage and healing" on click). Rogue against the Bandit (300 HP),
 * the Fighter next to the Bandit (an ally within 5 ft: Sneak Attack), short sword until it hits:
 *  1. Sneak Attack "automatic": dnd5e's dialog shows the Sneak Attack dice as their own row, before any roll; "Critical Hit" pressed
 *     → the card holds the weapon and Sneak Attack dice, all critical (doubled), and the Sneak Attack is noted on the card.
 *  2. Sneak Attack "ask": DAS's "On hit" question first (Sneak Attack ticked, "Strike"), then dnd5e's dialog with the Sneak Attack row;
 *     "Normal" → one normal card with the Sneak Attack.
 * Restored: settings, positions, HP, statuses.
 */
const MODULE_ID = "dnd5e-combat";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

/** GM client: the engine's damage dialog, its rows' formulas, and a button to press. */
const DIALOG = `
  const app = [...foundry.applications.instances.values()].find(a => a.rendered && a.config?.["${MODULE_ID}"]?.dialog);
  if ( !app ) return { open: false };
  const out = { open: true, formulas: (app.rolls ?? []).map(r => r.formula), buttons: [...app.element.querySelectorAll('button[type="submit"][data-action]')].map(b => b.dataset.action) };
  if ( opts.press ) app.element.querySelector('button[data-action="' + opts.press + '"]')?.click();
  return out;`;

export default {
  name: "Rogue's damage in dnd5e's damage dialog (#173): Sneak Attack row, forced critical, the « ask » question first",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const need = ["Roublard", "Bandit", "Guerrier"];
    if ( need.some(n => !tokens.some(t => t.name === n)) ) { ctx.log(`${need.join(", ")} requis : non applicable`); return; }
    const rogue = await ctx.token("Roublard");
    const bandit = await ctx.token("Bandit");
    const fighter = await ctx.token("Guerrier");
    const grid = await ctx.gridSize();
    const homes = new Map();
    for ( const t of [rogue, bandit, fighter] ) homes.set(t.id, { pos: await ctx.position(t), hp: await ctx.hp(t) });
    const r0 = homes.get(rogue.id).pos;
    const reset = async () => {
      for ( const [id, h] of homes ) {
        await ctx.call("move-token", { tokenId: id, x: h.pos.x, y: h.pos.y, elevation: h.pos.elevation ?? 0 }).catch(() => {});
        for ( const s of ["prone", "restrained", "poisoned"] ) await ctx.call("set-status", { tokenId: id, statusId: s, active: false }).catch(() => {});
      }
      await ctx.removeEffectsNamed(rogue, /Visée|Steady|Frappe malicieuse|Cunning Strike|Caché|Hidden|Furtiv|Ouverture|Vex/i);
    };
    ctx.restore(reset);
    // Allies added under the Rogue (Monk, Druid, Ranger, Bard) would also be within 5 ft of the Bandit: moved away for the scenario.
    for ( const name of ["Moine", "Druide", "Rôdeur", "Barde"] ) {
      const t = tokens.find(x => x.name === name);
      if ( !t ) continue;
      const pos = await ctx.position(t);
      ctx.restore(() => ctx.call("move-token", { tokenId: t.id, x: pos.x, y: pos.y, elevation: pos.elevation ?? 0 }).catch(() => {}));
      await ctx.call("move-token", { tokenId: t.id, x: pos.x, y: pos.y + 2 * grid, elevation: pos.elevation ?? 0 });
    }
    const { data: bdata } = await ctx.call("get-scene-object", { type: "Token", objectId: bandit.id });
    const max0 = bdata.delta?.system?.attributes?.hp?.max ?? null;
    ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: bandit.id,
      data: max0 === null ? { "delta.system.attributes.hp.-=max": null } : { "delta.system.attributes.hp.max": max0 } }).catch(() => {}));
    const tough = () => ctx.call("update-scene-object", { type: "Token", objectId: bandit.id, data: { "delta.system.attributes.hp.max": 300, "delta.system.attributes.hp.value": 300 } });

    const setting = async (key, value) => {
      const before = (await ctx.engine("setting", { key }))?.now;
      ctx.restore(() => ctx.engine("setting", { key, value: before }));
      await ctx.engine("setting", { key, value });
    };
    await setting("damageFlow", "click");
    await setting("sneakAttackMode", "auto");
    const dialog = (opts={}) => ctx.call("run-script", { code: `const opts = ${JSON.stringify(opts)};\n${DIALOG}` }).then(r => r?.result ?? { open: false });
    ctx.restore(async () => { for ( let i = 0; (i < 4) && (await dialog()).open; i++ ) await dialog({ press: "normal" }).catch(() => {}); });
    const sword = await ctx.itemId(rogue.id, "shortsword");
    if ( !ctx.expect(!!sword, "the Rogue has a short sword") ) return;

    const place = async () => {
      await tough();
      await ctx.call("move-token", { tokenId: bandit.id, x: r0.x - grid, y: r0.y, elevation: 0 });
      await ctx.call("move-token", { tokenId: fighter.id, x: r0.x - 2 * grid, y: r0.y, elevation: 0 });
      await pause(800);
    };

    /** Attacks until it hits (twenty tries). `ask` answers DAS's "On hit" question; `press` the button of dnd5e's dialog. */
    const hit = async ({ press, ask=false }) => {
      for ( let n = 1; n <= 20; n++ ) {
        await place();
        const since = await ctx.lastMessageId();
        const u = await ctx.use({ tokenId: rogue.id, itemId: sword, activityType: "attack", targetTokenIds: [bandit.id], usageConfig: { [MODULE_ID]: { cost: "free" } } });
        let res = null, seen = null, question = null;
        for ( const until = Date.now() + 40000; Date.now() < until; await pause(400) ) {
          res = await ctx.resolution(u.usageMessageId);
          if ( ["done", "missed", "undone"].includes(res?.step) ) break;
          if ( ask && !question ) {
            const r = await ctx.call("list-dialogs", { dialogsOnly: true, waitMs: 300 }).catch(() => null);
            const w = (r?.windows ?? []).find(x => (x.buttons ?? []).some(b => b.action === "strike"));
            if ( w ) {
              question = { title: w.title, damageCards: (await ctx.messagesSince(since)).filter(m => m.type === "damage").length, engineDialog: (await dialog()).open };
              await ctx.call("answer-dialog", { id: w.id, fields: { sneak: true }, button: "strike" });
              continue;
            }
          }
          if ( seen ) continue;
          const win = await dialog();
          if ( !win.open ) continue;
          await pause(800);
          seen = { ...(await dialog()), cards: (await ctx.messagesSince(since)).filter(m => m.type === "damage").length };
          await dialog({ press });
        }
        if ( !res?.targets?.find(t => t.name === bandit.name)?.hit ) continue;
        await pause(1500);
        const card = (await ctx.messagesSince(since)).filter(m => m.type === "damage").pop() ?? null;
        return { res, seen, question, card, natural20: res.targets.find(t => t.name === bandit.name)?.critical === true };
      }
      return null;
    };
    const formulas = card => (card?.rolls ?? []).map(r => r.formula).join(" | ");

    // 1. Automatic Sneak Attack, Critical Hit pressed.
    let shot = await hit({ press: "critical" });
    if ( ctx.expect(!!shot, "auto: the short sword hits (twenty tries at most)") ) {
      const sneak = shot.card?.flags?.[MODULE_ID]?.sneak ?? null;
      ctx.expect(shot.seen?.open && (shot.seen.cards === 0), `auto: dnd5e's dialog opens before any roll (${JSON.stringify(shot.seen)})`);
      ctx.expect((shot.seen?.formulas?.length ?? 0) >= 2 && sneak && shot.seen.formulas.some(f => f.replace(/\s/g, "") === `${sneak.dice}d${sneak.faces}`),
        `auto: the Sneak Attack dice are their own row in the dialog (${(shot.seen?.formulas ?? []).join(" | ")}; Sneak Attack ${sneak?.dice}d${sneak?.faces})`);
      ctx.expect(!!sneak, `auto: the card notes the Sneak Attack (${JSON.stringify(sneak)})`);
      const sneakRoll = (shot.card?.rolls ?? []).find(r => new RegExp(`^${sneak?.dice * 2}d${sneak?.faces}`).test((r.formula ?? "").replace(/\s/g, "")));
      ctx.expect((shot.card?.rolls ?? []).every(r => r.options?.isCritical === true) && !!sneakRoll,
        `auto: Critical Hit pressed${shot.natural20 ? " (natural 20 anyway)" : ""} — every roll critical, the Sneak Attack dice doubled (${formulas(shot.card)})`);
      ctx.expect(shot.res.step === "done", `auto: resolution closed (${shot.res.step})`);
    }

    // 2. "Ask": DAS's question first, then dnd5e's dialog.
    await setting("sneakAttackMode", "ask");
    shot = await hit({ press: "normal", ask: true });
    if ( ctx.expect(!!shot, "ask: the short sword hits") ) {
      const sneak = shot.card?.flags?.[MODULE_ID]?.sneak ?? null;
      ctx.expect(!!shot.question && !shot.question.engineDialog && (shot.question.damageCards === 0),
        `ask: DAS's question opens first, alone, before any roll (${JSON.stringify(shot.question)})`);
      ctx.expect(shot.seen?.open && sneak && shot.seen.formulas.some(f => f.replace(/\s/g, "") === `${sneak.dice}d${sneak.faces}`),
        `ask: then dnd5e's dialog, with the Sneak Attack row (${(shot.seen?.formulas ?? []).join(" | ")})`);
      ctx.expect(!!shot.card && (shot.res.step === "done") && (shot.natural20 || (shot.card.rolls ?? []).every(r => r.options?.isCritical !== true)),
        `ask: Normal pressed, one card applied (${formulas(shot.card)}, ${shot.res.step})`);
    }
    const errors = await ctx.clientErrors();
    ctx.expect(!errors.length, `no error in the GM console${errors.length ? ` — ${errors.map(e => e.message ?? e.text).join(" | ").slice(0, 300)}` : ""}`);
  }
};
