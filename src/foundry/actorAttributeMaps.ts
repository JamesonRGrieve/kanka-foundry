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
 */
export const STAT_MAP: Record<string, string> = {
    wounds_max: 'wounds.max',
    wounds_current: 'wounds.value',
    fate_max: 'fate.max',
    fate_current: 'fate.value',
    insanity: 'insanity',
    corruption: 'corruption',
    xp_total: 'experience.total',
    xp_used: 'experience.used',
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
