/**
 * The three automation levels (SPEC §117), from lightest to most complete:
 *  - `essentials` (Essential): mouse movement, A*, context menus, turn budget, vision and light, interface; rolls
 *    stay those of dnd5e (native cards, nothing resolved by the engine);
 *  - `assisted` (Assisted): + resolution (attack → hit → damage applied, saving throws, the activity's effects) and the general
 *    PHB rules valid for any creature (conditions, Cover, Concentration, 0 HP, Opportunity Attacks, basic actions);
 *  - `full` (Full): + per-item content (spells, features, monster abilities, creations from other modules).
 *
 * Each function of the entry point (`register…()` of dnd5e-combat.mjs) has its minimum level; below it, it registers
 * anyway (settings, queries) but listens to no hook (runtime/router.mjs, `suspended`). The test checks that every
 * `register…()` of the entry point appears here.
 *
 * Pure: no dependency on Foundry.
 */

export const LEVELS = Object.freeze(["essentials", "assisted", "full"]);
export const DEFAULT_LEVEL = "full";

/** The rank of a level (unknown: the default level). */
export function levelRank(level) {
  const i = LEVELS.indexOf(level);
  return i >= 0 ? i : LEVELS.indexOf(DEFAULT_LEVEL);
}

/** Does the level `level` include what requires `min`? */
export function atLeast(level, min) {
  return levelRank(level) >= levelRank(min);
}

const E = "essentials";
const A = "assisted";
const F = "full";

/** The minimum level of each `register…()` of the entry point. */
export const FEATURE_LEVELS = Object.freeze({
  // Always: the base, movement, the mouse, the turn budget, vision, the interface.
  registerPerf: E, registerFlow: E, registerGmQueue: E, registerContent: E, registerIcons: E, registerAltitude: E, registerClimb: E, registerFalls: E, registerKnockout: E, registerTheater: E, registerVanilla: E, registerCorrection: E, registerCorrectionUi: E, registerCombatLaunch: E, registerCombatLaunchUI: E, registerClimbSystem: E, registerActions: E, registerFollow: E, registerDoors: E, registerDoorLockUi: E, registerWallGrateUi: E, registerSceneBrightUi: E, registerCombatEvents: E, registerCombatOutcome: E, registerSkipDefeated: E,
  registerPointer: E, registerTurn: E, registerFormLock: F, registerAmmo: E, registerVision: E, registerSpace: E, registerBasics: E,
  registerIllumination: E, registerPerception: E, registerEtherealUI: E, registerEtherealMovement: E, registerTracker: E, registerLightIndicator: E, registerFeedback: E, registerTimers: E,
  registerPurge: E, registerAutomation: E, registerSummonHandover: E, registerAutoTranslate: E, registerDataFixes: E, registerClock: E, registerCriticals: A, registerFlanking: A, registerFactions: E, registerFactionsUI: E, registerSettingsWindow: E, registerStealthMode: E, registerStealthUI: E, registerGroupRoll: E, registerGroupRollUI: E, registerInlineChecks: E, registerGroupRollTracker: E, registerGmAlert: E, registerForced: E, registerGmAlertUi: E, registerSummonPermissions: E, registerSummonPermissionsUi: E, registerPlayerWaits: E, registerPlayerWaitsUI: E, registerDebugReport: E, registerConnectionTest: E, registerAwaiting: E, registerAwaitingUI: E,

  // Assisted: resolution, and the general rules that apply to any creature.
  registerEngine: A, registerHeroic: A, registerSuccessAtCost: A, registerSuccessAtCostUI: A, registerConcentration: A, registerSpellWeapons: A, registerDeath: A, registerUsage: A, registerReactions: A, registerReady: A, registerBurning: A, registerImprovised: A, registerArmorTraining: A, registerMasteryChoices: A, registerMasteryUI: A, registerTriggers: A,
  registerConditions: A, registerAreas: A, registerLingering: A, registerPassengers: A, registerBanish: F, registerSelfAreas: A, registerZones: A, registerGrapple: A, registerProne: A,
  registerStabilize: A, registerHelp: A, registerHide: A, registerSearch: A, registerPassivePerception: A, registerEffects: A, registerAntimagic: A,
  registerAnimations: A, registerActivityChoice: A, registerCompact: A, registerChat: A,

  // Full: what the content declares, item by item.
  registerPilot: F, registerReduction: F, registerCoven: F, registerRecast: F, registerProjectiles: F, registerMetamagic: F, registerFreeCast: F,
  registerGates: F, registerPortent: F, registerDispel: F, registerContest: F, registerStorm: F, registerBursts: F, registerCoatings: F, registerGrants: F,
  registerFelled: F, registerWeaponFeed: F, registerWrath: F, registerBackfire: F, registerProtection: F, registerAuras: F, registerEmanations: F, registerRegeneration: F, registerFortitude: F, registerDamageTraits: F, registerExtraTurns: F, registerDamageByCount: F, registerDrain: F,
  registerSpaceSharing: F, registerObjectPassage: E, registerEmpower: F, registerLifesteal: F, registerDischarge: F, registerMastery: F, registerSneak: F, registerFighter: F, registerFeats: F, registerEffectWhile: F, registerSpeedGrants: F, registerGrimoire: F, registerLeaves: F, registerUsesSpent: F, registerFlee: F, registerReactionLoss: F,
  registerMonk: F, registerSmite: F, registerFollowUps: F, registerManeuverDice: F, registerRollBonus: F, registerNaturalOne: F, registerRise: F,
  registerAfterSneak: F, registerCantrips: F, registerEndings: F, registerActionEnd: F, registerBarbarian: F,
  registerSwallow: F, registerMount: F, registerFamiliars: F, registerBreaks: F, registerCure: F, registerBlink: F, registerWalls: F, registerWallSide: F, registerElevationSpells: F, registerPotions: F, registerPotionChoice: A, registerOil: F, registerScatter: F, registerFlammable: F,
  registerSkillAid: F, registerLights: F, registerWildShape: F, registerEnchant: F, registerTether: F, registerDefenses: F,
  registerSize: F, registerOrders: F, registerCompulsion: F, registerControl: F, registerCatalyst: F, registerVigor: F, registerCureUi: F, registerWallSideUi: F, registerKindleUi: F, registerStandingMasteryUi: F, registerSkillAidUi: F
});

/** The minimum level of a function (absent from the table: Full, to be safe). */
export function featureLevel(name) {
  return FEATURE_LEVELS[name] ?? F;
}
