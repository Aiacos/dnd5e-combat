/**
 * §542 (issue #43): players who cannot summon. Arène de test (Magicien), world `dnd-6`.
 *  1. Load alert: dnd5e "Allow Summoning" off, nothing dismissed → the GM's window opens and lists the gap (`api.mcp.summonAlert`, the
 *     same decision as at `ready`); closed again.
 *  2. "Don't show again": with the signature of these gaps kept, the window stays shut; a kind of gap the GM never dismissed brings it
 *     back.
 *  3. A player without the right uses Find Familiar (`api.mcp.summonBlocked` for the first non-GM user: the bench has no player client):
 *     the reason is named and the GM gets a whispered alert card that names the player.
 *  4. The world diagnostic lists the gap (read only: no repair offered).
 *  5. "Allow Summoning" on: that reason is gone.
 * The player's own warning (`ui.notifications`) shows on the player's client only: not checked here.
 * Restores both settings and the GM alert setting.
 */
const MODULE_ID = "dnd5e-combat";
const SPELL = "Compendium.dnd-players-handbook.spells.Item.phbsplFindFamili";
const pause = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "invocation sans droits — alerte au chargement, alerte MJ, diagnostic (issue #43)",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !tokens.some(t => t.name === "Magicien") ) { ctx.log("Magicien absent : non applicable"); return; }
    const wizard = await ctx.token("Magicien");
    const spellId = await ctx.ensureItem(wizard, SPELL);
    const listed = await ctx.call("list-players", {});
    const players = Array.isArray(listed) ? listed : (listed?.players ?? []);
    const player = players.find(p => (p.role ?? 4) < 4) ?? null;   // below ASSISTANT: what dnd5e's canSummon checks for a player
    if ( !ctx.expect(!!player, `un joueur non MJ dans le monde (${players.map(p => p.name).join(", ")})`) ) return;

    const allow = await ctx.engine("foreignSetting", { namespace: "dnd5e", key: "allowSummoning" });
    const seen = await ctx.engine("setting", { key: "summonPermissionsSeen" });
    const alerts = await ctx.engine("setting", { key: "gmAlerts", value: true });
    ctx.restore(() => ctx.engine("foreignSetting", { namespace: "dnd5e", key: "allowSummoning", value: allow.before }));
    ctx.restore(() => ctx.engine("setting", { key: "summonPermissionsSeen", value: seen.before }));
    ctx.restore(() => ctx.engine("setting", { key: "gmAlerts", value: alerts.before }));
    const closeAlert = id => ctx.engine("closeWindow", { id }).catch(() => {});

    // 1. The load alert.
    await ctx.engine("foreignSetting", { namespace: "dnd5e", key: "allowSummoning", value: false });
    await ctx.engine("setting", { key: "summonPermissionsSeen", value: "" });
    const first = await ctx.engine("summonAlert");
    ctx.restore(() => closeAlert(first.windowId));
    const keys = (first.gaps ?? []).map(g => g.key);
    ctx.expect(keys.includes("allowSummoning"), `le manque « Allow Summoning » est relevé (${keys.join(", ")})`);
    ctx.expect(first.opened === true, "la fenêtre s'ouvre chez le MJ");
    await pause(500);
    const open = (await ctx.engine("windows")).some(w => w.id === first.windowId);
    ctx.expect(open, `fenêtre « ${first.windowId} » ouverte`);
    await closeAlert(first.windowId);

    // 2. "Don't show again", then a new kind of gap.
    const signature = [...new Set(keys)].sort().join(",");
    await ctx.engine("setting", { key: "summonPermissionsSeen", value: signature });
    const silent = await ctx.engine("summonAlert");
    ctx.expect(silent.opened === false, "« Ne plus afficher » : la fenêtre ne revient pas pour les mêmes manques");
    await ctx.engine("setting", { key: "summonPermissionsSeen", value: keys.filter(k => k !== "allowSummoning").sort().join(",") });
    const back = await ctx.engine("summonAlert");
    ctx.expect(back.opened === true, "un manque jamais écarté la fait revenir");
    await closeAlert(back.windowId);

    // 3. A player without the right summons.
    const mark = await ctx.lastMessageId();
    const used = await ctx.engine("summonBlocked", { userId: player.id, tokenId: wizard.id, itemId: spellId });
    ctx.expect(["tokenCreate", "allowSummoning"].includes(used.blocker), `${player.name} : raison nommée (${used.blocker})`);
    await pause(1500);
    const cards = (await ctx.messagesSince(mark)).filter(m => m.flags?.[MODULE_ID]?.gmAlert);
    const text = cards.at(-1)?.flags?.[MODULE_ID]?.gmAlert?.text ?? "";
    ctx.expect(cards.length >= 1 && text.includes(player.name), `carte d'alerte au MJ qui nomme le joueur (${text || "aucune"})`);

    // 4. The diagnostic.
    const scan = await ctx.engine("diagnosticScan", { checks: ["summon-permissions"] });
    const tasks = scan["summon-permissions"] ?? [];
    ctx.expect(tasks.length >= 1, `diagnostic : ${tasks.length} manque(s) signalé(s)`);
    ctx.expect(tasks.every(t => !t.fixable && !t.apply), "diagnostic : lecture seule, aucune réparation proposée");

    // 5. "Allow Summoning" on: that reason is gone.
    await ctx.engine("foreignSetting", { namespace: "dnd5e", key: "allowSummoning", value: true });
    const after = await ctx.engine("summonBlocked", { userId: player.id, tokenId: wizard.id, itemId: spellId, tell: false });
    ctx.expect(after.blocker !== "allowSummoning", `réglage allumé : plus cette raison (${after.blocker ?? "aucune"})`);
    const gapsNow = (await ctx.engine("summonAlert")).gaps.map(g => g.key);
    await closeAlert(first.windowId);
    ctx.expect(!gapsNow.includes("allowSummoning"), `l'alerte ne relève plus « Allow Summoning » (${gapsNow.join(", ") || "rien"})`);
  }
};
