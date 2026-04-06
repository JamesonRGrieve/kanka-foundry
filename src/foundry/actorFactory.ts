import type {
    KankaApiAttribute,
    KankaApiCharacter,
    KankaApiEntityId,
    KankaApiId,
} from '../types/kanka';

/**
 * Maps Kanka attribute short names to Foundry wh40k-rpg characteristic keys.
 */
const CHARACTERISTIC_MAP: Record<string, string> = {
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
export const CHARACTERISTIC_REVERSE_MAP: Record<string, string> = Object.fromEntries(
    Object.entries(CHARACTERISTIC_MAP).map(([k, v]) => [v, k]),
);

/**
 * Maps Kanka attribute names to Foundry Actor system paths for non-characteristic stats.
 */
const STAT_MAP: Record<string, string> = {
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
export const STAT_REVERSE_MAP: Record<string, string> = Object.fromEntries(
    Object.entries(STAT_MAP).map(([k, v]) => [v, k]),
);

function getAttributeValue(attributes: KankaApiAttribute[], name: string): number | null {
    const attr = attributes.find((a) => a.name === name);
    if (!attr?.value) return null;
    const num = Number(attr.value);
    return Number.isNaN(num) ? null : num;
}

function buildCharacteristics(attributes: KankaApiAttribute[]): Record<string, { base: number }> {
    const characteristics: Record<string, { base: number }> = {};
    for (const [kankaName, foundryKey] of Object.entries(CHARACTERISTIC_MAP)) {
        const value = getAttributeValue(attributes, kankaName);
        if (value !== null) {
            characteristics[foundryKey] = { base: value };
        }
    }
    return characteristics;
}

function buildSystemStats(attributes: KankaApiAttribute[]): Record<string, unknown> {
    const stats: Record<string, unknown> = {};
    for (const [kankaName, foundryPath] of Object.entries(STAT_MAP)) {
        const value = getAttributeValue(attributes, kankaName);
        if (value === null) continue;

        const parts = foundryPath.split('.');
        if (parts.length === 2) {
            const [group, field] = parts;
            if (!stats[group] || typeof stats[group] !== 'object') {
                stats[group] = {};
            }
            (stats[group] as Record<string, unknown>)[field] = value;
        } else {
            stats[foundryPath] = value;
        }
    }
    return stats;
}

function determineActorType(
    _entity: KankaApiCharacter,
    entityTags: string[],
    defaultType: string,
    pcTags: string[],
): string {
    const lowerTags = entityTags.map((t) => t.toLowerCase());
    if (pcTags.some((tag) => lowerTags.includes(tag.toLowerCase()))) {
        return 'character';
    }
    return defaultType;
}

/**
 * Create Foundry Actor data from a Kanka character entity.
 */
export function createActorData(
    entity: KankaApiCharacter,
    entityTags: string[],
    campaignId: KankaApiId,
    defaultActorType: string,
    pcTags: string[],
): Record<string, unknown> {
    const actorType = determineActorType(entity, entityTags, defaultActorType, pcTags);
    const attributes = entity.attributes ?? [];

    const characteristics = buildCharacteristics(attributes);
    const statOverrides = buildSystemStats(attributes);

    const system: Record<string, unknown> = {
        ...statOverrides,
        characteristics,
    };

    if (actorType === 'character') {
        const appearanceTraits = entity.traits?.filter((t) => t.section === 'appearance') ?? [];
        const personalityTraits = entity.traits?.filter((t) => t.section === 'personality') ?? [];

        system.bio = {
            gender: entity.sex ?? '',
            age: entity.age != null ? String(entity.age) : '',
            build: appearanceTraits.find((t) => t.name.toLowerCase() === 'build')?.entry ?? '',
            hair: appearanceTraits.find((t) => t.name.toLowerCase() === 'hair')?.entry ?? '',
            eyes: appearanceTraits.find((t) => t.name.toLowerCase() === 'eyes')?.entry ?? '',
            complexion: appearanceTraits.find((t) => t.name.toLowerCase() === 'complexion')?.entry ?? '',
            quirks: personalityTraits.map((t) => `${t.name}: ${t.entry}`).join('; '),
            notes: entity.entry ?? '',
        };
    } else {
        // NPC type — simpler schema
        if (entity.entry) {
            system.description = entity.entry;
        }
        const orgData = entity.organisations?.data;
        if (orgData?.length) {
            system.faction = orgData[0].role ?? '';
        }
    }

    return {
        name: entity.name,
        type: actorType,
        img: entity.has_custom_image ? entity.image_full : undefined,
        system,
        flags: {
            'kanka-foundry': {
                kankaEntityId: entity.entity_id,
                kankaChildId: entity.id,
                campaign: campaignId,
                snapshot: entity,
                version: entity.updated_at,
            },
        },
        ownership: entity.is_private
            ? { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE }
            : { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED },
    };
}

/**
 * Find an existing Foundry Actor by its Kanka entity ID.
 */
export function findActorByKankaEntityId(entityId: KankaApiEntityId): Actor | undefined {
    return (game as Game).actors?.find(
        (a: Actor) => a.getFlag('kanka-foundry', 'kankaEntityId') === entityId,
    ) ?? undefined;
}

/**
 * Create or update a Foundry Actor from a Kanka character.
 */
export async function createOrUpdateActor(
    entity: KankaApiCharacter,
    entityTags: string[],
    campaignId: KankaApiId,
    defaultActorType: string,
    pcTags: string[],
): Promise<Actor> {
    const existing = findActorByKankaEntityId(entity.entity_id);
    const actorData = createActorData(entity, entityTags, campaignId, defaultActorType, pcTags);

    if (existing) {
        await existing.update({
            name: actorData.name,
            img: actorData.img,
            system: actorData.system,
            flags: actorData.flags,
        } as Record<string, unknown>);
        return existing;
    }

    // biome-ignore lint/complexity/noBannedTypes: Foundry's strict CreateData type doesn't accept dynamic actor data
    return (await (Actor.create as Function)(actorData)) as Actor;
}
