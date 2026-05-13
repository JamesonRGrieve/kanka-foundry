export type KankaApiId = number | { __type: 'KankaApiId' };
export type KankaApiEntityId = number | { __type: 'KankaApiEntityId' };
export type KankaApiAnyId = KankaApiId | KankaApiEntityId;
export type KankaApiModuleType =
    | 'character'
    | 'creature'
    | 'location'
    | 'family'
    | 'ability'
    | 'organisation'
    | 'item'
    | 'note'
    | 'event'
    | 'calendar'
    | 'timeline'
    | 'race'
    | 'quest'
    | 'map'
    | 'journal'
    | 'tag';

export enum KankaVisibility {
    all = 1,
    admin = 2,
    adminSelf = 3,
    self = 4,
    members = 5,
}

enum KankaOrganisationPinId {
    Character = 1,
    Organisation = 2,
    Both = 3,
}

enum KankaOrganisationStatusId {
    Active = 0,
    Inactive = 1,
    Unknown = 2,
}

export interface KankaApiSimpleConstrainable {
    is_private: boolean;
}

export interface KankaApiVisibilityConstrainable {
    visibility_id: KankaVisibility;
}

export type AnyConstrainable = KankaApiVisibilityConstrainable | KankaApiSimpleConstrainable | { isPrivate: boolean };

interface KankaApiEntityImageData {
    image?: string;
    image_full?: string;
    image_thumb?: string;
    has_custom_image?: boolean;
}

interface KankaApiBlamable {
    created_at: string;
    created_by: number;
    updated_at: string;
    updated_by: number;
}

export interface KankaApiChildEntity extends KankaApiRelated, KankaApiSimpleConstrainable, KankaApiBlamable, KankaApiEntityImageData {
    id: KankaApiId;
    entity_id: KankaApiEntityId;
    name: string;
    entry: string;
    entry_parsed: string;
    urls: {
        view: string;
        api: string;
    };
}

export interface KankaApiResult<T> {
    data: T;
}

export interface KankaApiListResult<T> extends KankaApiResult<T[]> {
    links: {
        first: string;
        last: string;
        prev: string | null;
        next: string | null;
    };
    meta: {
        current_page: number;
        from: number;
        last_page: number;
        path: string;
        per_page: number;
        to: number;
        total: number;
    };
    sync: string;
}

export interface KankaApiAttribute extends KankaApiSimpleConstrainable {
    id: KankaApiId;
    type: null | 'checkbox' | 'section' | 'text' | 'number';
    name: string;
    value: string | null;
    parsed: string | null;
    is_star: boolean;
    default_order: number;
}

export interface KankaApiRelation extends KankaApiVisibilityConstrainable {
    id: KankaApiId;
    owner_id: KankaApiEntityId;
    target_id: KankaApiEntityId;
    relation?: string;
    attitude?: number;
    colour?: string;
    is_star: boolean;
}

export interface KankaApiInventory extends KankaApiVisibilityConstrainable {
    id: KankaApiId;
    amount: number;
    is_equipped: boolean;
    item_id: KankaApiId;
    name: string;
    description?: string;
    position?: string;
}

interface KankaApiEntityPost extends KankaApiVisibilityConstrainable {
    id: KankaApiId;
    entity_id: KankaApiEntityId;
    entry: string;
    entry_parsed: string;
    is_private: boolean;
    name: string;
    position: number | null;
    settings: { collapsed: '0' | '1' } | null;
}

interface KankaApiReminder extends KankaApiVisibilityConstrainable, KankaApiBlamable {
    id: KankaApiId;
    remindable_id: KankaApiEntityId;
    calendar_id: KankaApiId;
    colour: string | null;
    comment: string;
    date: string;
    day: number;
    month: number;
    year: number;
    length: number;
    type_id: number | null;
    is_recurring: boolean;
    recurring_periodicity: string | null;
    recurring_until: number | null;
}

export interface KankaApiAbilityLink extends KankaApiVisibilityConstrainable {
    id: KankaApiId;
    charges: number | null;
    ability_id: KankaApiId;
    note: string | null;
    position: number;
}

enum KankaApiAssetType {
    file = 1,
    link = 2,
    alias = 3,
}

interface KankaApiEntityBaseAsset extends KankaApiBlamable, KankaApiVisibilityConstrainable, KankaApiSimpleConstrainable {
    entity_id: KankaApiEntityId;
    id: KankaApiId;
    name: string;
    type_id: KankaApiAssetType;
    metadata: unknown;
}

interface KankaApiEntityAssetAlias extends KankaApiEntityBaseAsset {
    _alias: true;
    _link: false;
    _file: false;
    type_id: KankaApiAssetType.alias;
    metadata: null;
}

interface KankaApiEntityAssetFile extends KankaApiEntityBaseAsset {
    _file: true;
    _link: false;
    _alias: false;
    type_id: KankaApiAssetType.file;
    _url: string;
    metadata: {
        path: string;
        size: number;
        type: string;
    };
}

interface KankaApiEntityAssetLink extends KankaApiEntityBaseAsset {
    _link: true;
    _file: false;
    _alias: false;
    type_id: KankaApiAssetType.link;
    metadata: {
        url: string;
        link: string;
    };
}

type KankaApiEntityAsset = KankaApiEntityAssetAlias | KankaApiEntityAssetFile | KankaApiEntityAssetLink;

export interface KankaApiCampaign extends KankaApiEntityImageData {
    id: KankaApiId;
    name: string;
    entry: string;
    locale: string;
    urls: {
        view: string;
        api: string;
    };
}

interface KankaApiRelated {
    attributes: KankaApiAttribute[];
    relations: KankaApiRelation[];
    inventory: KankaApiInventory[];
    posts: KankaApiEntityPost[];
    entity_abilities: KankaApiAbilityLink[];
    reminders: KankaApiReminder[];
    entity_assets: KankaApiEntityAsset[];
}

export interface KankaApiChildEntityWithChildren extends KankaApiChildEntity {
    children: KankaApiId[];
    parents: KankaApiId[];
}

export interface KankaApiEntity extends KankaApiSimpleConstrainable, KankaApiBlamable {
    id: KankaApiEntityId;
    name: string;
    type: string;
    child_id: KankaApiId;
    campaign_id: KankaApiId;
    child: KankaApiEntityImageData;
    is_template: boolean;
    urls: {
        view: string;
        api: string;
    };
    module: KankaEntityModule;
}

interface KankaApiCharacterTrait {
    id: KankaApiId;
    name: string;
    entry: string;
    section: 'appearance' | 'personality';
    default_order: number;
}

export interface KankaApiCharacterOrganisationLink extends KankaApiSimpleConstrainable {
    id: KankaApiId;
    character_id: KankaApiId;
    organisation_id: KankaApiId;
    role?: string;
    pin_id?: KankaOrganisationPinId | null;
    status_id?: KankaOrganisationStatusId | null;
}

export interface KankaApiCharacter extends KankaApiChildEntity {
    /** @deprecated Use locations instead */
    location_id?: KankaApiId | null;
    locations?: KankaApiId[];
    title: string | null;
    age: number | string | null;
    sex: string | null;
    pronouns: string | null;
    /** @deprecated Use races instead */
    race_id?: KankaApiId | null;
    races?: KankaApiId[];
    type: string | null;
    /** @deprecated Use families instead */
    family_id?: KankaApiId | null;
    families?: KankaApiId[];
    is_dead: boolean;
    traits: KankaApiCharacterTrait[];
    is_personality_visible: boolean;
    is_personality_pinned: boolean;
    is_appearance_pinned: boolean;
    organisations: { data: KankaApiCharacterOrganisationLink[] };
}

export interface KankaApiCreature extends KankaApiChildEntityWithChildren {
    /** @deprecated Will be removed; use parents[] instead */
    creature_id?: KankaApiId | null;
    locations: KankaApiId[];
    type: string | null;
    is_extinct: boolean;
    is_dead: boolean;
}

export interface KankaApiAbility extends KankaApiChildEntityWithChildren {
    /** @deprecated Will be removed; use parents[] instead */
    ability_id?: KankaApiId | null;
    type: string | null;
    charges: string | null;
    abilities: KankaApiId[];
}

export interface KankaApiFamily extends KankaApiChildEntityWithChildren {
    /** @deprecated Will be removed; use parents[] instead */
    family_id?: KankaApiId | null;
    location_id?: KankaApiId | null;
    type: string | null;
    members: KankaApiId[];
    is_extinct: boolean;
}

export interface KankaApiItem extends KankaApiChildEntityWithChildren {
    /** @deprecated Will be removed; use parents[] instead */
    item_id?: KankaApiId | null;
    location_id?: KankaApiId | null;
    /** @deprecated Use creator_id instead */
    character_id?: KankaApiId | null;
    creator_id?: KankaApiId | null;
    type: string | null;
    price: string | null;
    size: string | null;
    weight: string | null;
}

export interface KankaApiJournal extends KankaApiChildEntityWithChildren {
    /** @deprecated Will be removed; use parents[] instead */
    journal_id?: KankaApiId | null;
    location_id?: KankaApiId | null;
    /** @deprecated Use author_id instead */
    character_id?: KankaApiId | null;
    author_id?: KankaApiId | null;
    type: string | null;
    date: string | null;
    calendar_id: KankaApiId | null;
    calendar_year: number | null;
    calendar_month: number | null;
    calendar_day: number | null;
    calendar_reminder_length: number | null;
}

export interface KankaApiLocation extends KankaApiChildEntityWithChildren {
    /** @deprecated Use location_id instead */
    parent_location_id?: KankaApiId | null;
    /** @deprecated Will be removed; use parents[] instead */
    location_id?: KankaApiId | null;
    type: string | null;
    is_destroyed: boolean;
}

export interface KankaApiNote extends KankaApiChildEntityWithChildren {
    /** @deprecated Will be removed; use parents[] instead */
    note_id?: KankaApiId | null;
    type: string | null;
}

export interface KankaApiOrganisation extends KankaApiChildEntityWithChildren {
    /** @deprecated Will be removed; use parents[] instead */
    organisation_id?: KankaApiId | null;
    /** @deprecated Use locations instead */
    location_id?: KankaApiId | null;
    locations?: KankaApiId[];
    type: string | null;
    members: KankaApiCharacterOrganisationLink[];
    is_defunct?: boolean;
}

export interface KankaApiQuestElement extends KankaApiVisibilityConstrainable {
    id: KankaApiId;
    name: string;
    entity_id: KankaApiEntityId;
    colour: string | null;
    entry: string;
    entry_parsed: string | null;
    role: string | null;
}

export interface KankaApiQuest extends KankaApiChildEntityWithChildren {
    /** @deprecated Will be removed; use parents[] instead */
    quest_id?: KankaApiId | null;
    /** @deprecated Use instigator_id instead */
    character_id?: KankaApiId | null;
    instigator_id?: KankaApiEntityId | null;
    location_id: KankaApiId | null;
    type: string | null;
    date: string | null;
    is_completed: boolean;
    elements_count: number;
    elements: KankaApiQuestElement[];
    calendar_id: KankaApiId | null;
    calendar_year: number | null;
    calendar_month: number | null;
    calendar_day: number | null;
    calendar_reminder_length: number | null;
}

export interface KankaApiRace extends KankaApiChildEntityWithChildren {
    locations: KankaApiId[];
    /** @deprecated Will be removed; use parents[] instead */
    race_id?: KankaApiId | null;
    type: string | null;
    is_extinct: boolean;
}

export interface KankaApiEvent extends KankaApiChildEntityWithChildren {
    type: string | null;
    date: string | null;
    location_id?: KankaApiId | null;
    /** @deprecated Will be removed; use parents[] instead */
    event_id?: KankaApiId | null;
    calendar_id: KankaApiId | null;
    calendar_year: number | null;
    calendar_month: number | null;
    calendar_day: number | null;
    calendar_reminder_length: number | null;
}

export interface KankaApiTimelineElement extends KankaApiVisibilityConstrainable {
    id: KankaApiId;
    era_id: KankaApiId;
    timeline_id: KankaApiId;
    entity_id: KankaApiEntityId | null;
    name: string;
    entry: string;
    entry_parsed: string | null;
    date: string | null;
    colour: string | null;
    position: number;
    icon: string | null;
    is_collapsed: boolean;
}

interface KankaApiTimelineEra {
    id: KankaApiId;
    name: string;
    abbreviation: string | null;
    start_year: number | null;
    end_year: number | null;
    entry: string | null;
    entry_parsed: string | null;
    elements: KankaApiTimelineElement[];
    is_collapsed: boolean;
    position: number;
}

export interface KankaApiTimeline extends KankaApiChildEntityWithChildren {
    /** @deprecated Will be removed; use parents[] instead */
    timeline_id?: KankaApiId | null;
    type: string | null;
    eras: KankaApiTimelineEra[];
    revert_order: number;
}

interface KankaEntityModule {
    id: number;
    code: KankaApiModuleType;
    singular: string;
    plural: string;
}
