/**
/**
 * Chromatic Orb (SPEC §16.27) — **interactive**:
 *  1. the damage type: on the first cast, the "damage type" window opens on the GM's screen (author here) — choose
 *     one; the damage roll carries that type;
 *  2. the bounce: recast (same type, fixed in advance) until a hit with a double on the d8s; the "the orb
 *     bounces" aiming opens on the GM's screen — click the second target (brought to 10 ft); the bounce goes to it, free, same
 *     type. Targets: the Zombie (low AC: enough hits) and the Wolf, failing that Rahadin and Morgantha.
 * World `ravenloft`; outside the suite (`node tools/scenario.mjs orbe`).
 */
const MODULE_ID = "dnd5e-combat";
// A low-AC target (enough hits to see a double), and a second one at 10 ft for the bounce.
const VICTIMS = ["Zombi", "Rahadin, chambellan du château"];
const SECONDS = ["Loup", "Morgantha - Coven"];
const sleep = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "Orbe chromatique — type choisi, rebond (interactif : choisir un type, puis cliquer la seconde cible)",
  interactive: true,

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const VICTIM = VICTIMS.find(n => tokens.some(t => t.name === n));
    const SECOND = SECONDS.find(n => tokens.some(t => t.name === n));
    if ( !tokens.some(t => t.name === "Bramo") || !VICTIM || !SECOND ) { ctx.log("Bramo, une cible ou une seconde cible absente : non applicable"); return; }
    const bramo = await ctx.token("Bramo");
    const victim = await ctx.token(VICTIM);
    const second = await ctx.token(SECOND);
    const grid = await ctx.gridSize();
    const at = await ctx.position(bramo);
    await ctx.call("move-token", { tokenId: victim.id, x: at.x + (3 * grid), y: at.y });
    await ctx.call("move-token", { tokenId: second.id, x: at.x + (5 * grid), y: at.y });

    const damageTypeOf = async resolution => {
      const damage = (await ctx.call("list-chat-messages", { limit: 40 })).messages?.find(m => m.id === resolution.damageRoll?.messageId);
      const raw = damage?.rolls?.[0];
      const roll = (typeof raw === "string") ? JSON.parse(raw) : raw;
      return roll?.options?.type ?? roll?.type ?? null;
    };

    // 1. Type chosen in the window: recast until a hit (the type only shows on a damage roll).
    ctx.log(">>> Fenêtre « Orbe chromatique — type de dégâts » à l'écran : choisis un type.");
    let first = null;
    for ( let n = 1; (n <= 5) && !first; n++ ) {
      await ctx.setHp(victim, 150);
      const used = await ctx.use({ tokenId: bramo.id, identifier: "chromatic-orb", activityType: "attack", consume: false, targetTokenIds: [victim.id],
        ...(n > 1 ? { usageConfig: { [MODULE_ID]: { damageType: "fire" } } } : {}) });
      const r = await ctx.settle(used.usageMessageId, { timeoutMs: 60000 });
      if ( r.targets[0]?.hit ) first = r;
    }
    ctx.expect(!!first, `l'orbe touche ${VICTIM}`);
    if ( !first ) return;
    const type = await damageTypeOf(first);
    const chosen = (await ctx.call("list-chat-messages", { limit: 60, flagScope: MODULE_ID })).messages?.find(m => m.id === (first.origin ?? first.carrier));
    const flagged = chosen?.flags?.[MODULE_ID]?.damageType ?? chosen?.flags?.damageType ?? null;
    ctx.expect(!!type && (type === flagged), `dégâts de type « ${type} », le type choisi (${flagged})`);

    // 2. Bounce: a double on the d8s, then the GM's click on Morgantha.
    let leapUsage = null;
    for ( let n = 1; (n <= 25) && !leapUsage; n++ ) {
      await ctx.setHp(victim, 150);
      const since = await ctx.lastMessageId();
      const used = await ctx.use({ tokenId: bramo.id, identifier: "chromatic-orb", activityType: "attack", consume: false, targetTokenIds: [victim.id],
        usageConfig: { [MODULE_ID]: { damageType: flagged ?? "fire" } } });
      const r = await ctx.settle(used.usageMessageId, { timeoutMs: 60000 });
      if ( !r.targets[0]?.hit ) continue;
      const faces = await (async () => {
        const damage = (await ctx.call("list-chat-messages", { limit: 40 })).messages?.find(m => m.id === r.damageRoll?.messageId);
        return (damage?.rolls?.[0]?.dice?.[0]?.results ?? damage?.rolls?.[0]?.terms?.[0]?.results ?? []).map(x => x.result ?? x);
      })();
      const double = faces.length && (new Set(faces).size < faces.length);
      ctx.log(`lancement ${n} : touché, d8 ${faces.join(", ") || "?"}${double ? ` — DOUBLE : clique ${SECOND} !` : ""}`);
      if ( !double ) continue;
      for ( const until = Date.now() + 60000; !leapUsage && (Date.now() < until); await sleep(1000) ) {
        leapUsage = (await ctx.messagesSince(since)).find(m => (m.type === "usage") && (m.flags?.[MODULE_ID]?.leap ?? m.flags?.leap));
      }
    }
    // The engine's journal around the bounces (offered, refused), before the caster empties it.
    for ( const line of (await ctx.engineLog()).filter(l => /rebond|double|type de dégâts|bounce|leap|damage type/i.test(l)).slice(-10) ) ctx.log(`· ${line.slice(0, 200)}`);
    ctx.expect(!!leapUsage, "l'orbe a bondi");
    if ( !leapUsage ) return;
    const flags = leapUsage.flags?.[MODULE_ID] ?? leapUsage.flags ?? {};
    ctx.expect((leapUsage.targets ?? []).some(t => (t.name ?? t) === SECOND), `rebond vers ${SECOND}`);
    ctx.expect(flags.cost === "free", `rebond gratuit (${flags.cost})`);
    const r2 = await ctx.settle(leapUsage.id, { timeoutMs: 60000 }).catch(() => null);
    if ( r2?.targets?.[0]?.hit ) ctx.expect((await damageTypeOf(r2)) === flagged, `le rebond garde le type (${flagged})`);
  }
};
