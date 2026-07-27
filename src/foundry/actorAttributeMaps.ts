/**
 * Maps Kanka attribute short names to Foundry wh40k-rpg characteristic keys.
 */
export const CHARACTERISTIC_MAP: Record<string, string> = {
    WS: 'weaponSkill',
    BS: 'ballisticSkill',
    S: 'strength',
    T: 'toughness',
    Ag: 'agility',
    Int: 'intelligence',
    Per: 'perception',
    WP: 'willpower',
    Fel: 'fellowship',
    Inf: 'influence',
};

/**
 * Reverse map: Foundry characteristic key -> Kanka attribute name.
 */
export const CHARACTERISTIC_REVERSE_MAP: Record<string, string> = Object.fromEntries(Object.entries(CHARACTERISTIC_MAP).map(([k, v]) => [v, k]));

/**
 * Maps Kanka attribute names to Foundry Actor system paths for non-characteristic stats.
 *
 * **Allow-list — durable character facts ONLY.** Foundry is the sole authority for
 * live, mutable mechanical state; Kanka is the narrative wiki and must never be a
 * mirror (or, via the bidirectional reconcile in `syncBack.ts`, a *source*) for it.
 *
 * Every entry here is read by all four consumers — actor creation, sync-back,
 * conflict detection, and the sheet button — so an entry added here is synced
 * everywhere. Before adding one, ask: *does this value change during play?* If yes,
 * it does not belong in this map.
 *
 * Deliberately EXCLUDED as live state (#474):
 *   - `fate.value`        — per-session Fate spend
 *   - `wounds.value`      — current damage
 *   - `insanity` / `corruption` — trackers accrued in play
 *   - `experience.used`   — spend state, changes on every advancement
 *
 * The retained entries are character-sheet *capacities/totals*, not spend state.
 */
export const STAT_MAP: Record<string, string> = {
    wounds_max: 'wounds.max',
    fate_max: 'fate.max',
    xp_total: 'experience.total',
};

/**
 * Reverse map: Foundry system path -> Kanka attribute name.
 */
export const STAT_REVERSE_MAP: Record<string, string> = Object.fromEntries(Object.entries(STAT_MAP).map(([k, v]) => [v, k]));

/** Foundry system.bio.* key -> Kanka attribute name */
export const BIO_MAP: Record<string, string> = {
    gender: 'bio_gender',
    age: 'bio_age',
    build: 'bio_build',
    complexion: 'bio_complexion',
    hair: 'bio_hair',
    eyes: 'bio_eyes',
    quirks: 'bio_quirks',
    superstition: 'bio_superstition',
    mementos: 'bio_mementos',
    playerName: 'bio_playerName',
};

/** Foundry system.originPath.* key -> Kanka attribute name */
export const ORIGIN_MAP: Record<string, string> = {
    background: 'origin_background',
    role: 'origin_role',
    homeWorld: 'origin_homeWorld',
    divination: 'origin_divination',
    elite: 'origin_elite',
    career: 'origin_career',
    regiment: 'origin_regiment',
    speciality: 'origin_speciality',
};

/** Foundry system.* root keys -> Kanka attribute name */
export const ROOT_STRING_MAP: Record<string, string> = {
    faction: 'bio_faction',
};
