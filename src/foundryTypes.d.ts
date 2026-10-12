import type { CampaignDayChangedHook, EventResolvedHook, PcAttitudeChangedHook } from './foundry/eventTrackerSync';

type FlagData = {
    id: KankaApiEntityId;
    campaign: KankaApiId;
    snapshot: KankaApiChildEntity;
    type: KankaApiModuleType;
    version: string;
    references: Record<number, Reference>;
};

type ActorFlagData = {
    kankaEntityId: KankaApiEntityId;
    kankaChildId: KankaApiId;
    campaign: KankaApiId;
    snapshot: KankaApiChildEntity;
    version: string;
    /** Interior Scene linked to a vehicle Actor (read by the wh40k-rpg system to "Board Interior"). */
    interiorSceneId?: string;
};

type CampaignJournalFlagData = {
    campaign: KankaApiId;
    campaignDescription: boolean;
    campaignSnapshot: {
        id: KankaApiId;
        name: string;
        entry: string;
        image_full?: string;
    };
};

type SceneFlagData = {
    kankaMapId: KankaApiId;
    kankaEntityId: KankaApiEntityId;
    /** Vehicle Actor this interior Scene belongs to (reverse of ActorFlagData.interiorSceneId). */
    vehicleActorId?: string;
};

declare module 'fvtt-types/configuration' {
    interface FlagConfig {
        JournalEntry: {
            'core': Document.CoreFlags;
            'kanka-foundry': FlagData & Partial<CampaignJournalFlagData>;
        };
        Folder: {
            'core': Document.CoreFlags;
            'kanka-foundry': FlagData;
        };
        Actor: {
            'core': Document.CoreFlags;
            'kanka-foundry': ActorFlagData;
        };
        Scene: {
            'core': Document.CoreFlags;
            'kanka-foundry': SceneFlagData;
        };
    }

    interface DataModelConfig {
        JournalEntryPage: {
            'kanka-foundry.post': BaseJournalEntryPage;
            'kanka-foundry.overview': typeof KankaPageModel;
            'kanka-foundry.character-profile': typeof KankaPageModel;
            'kanka-foundry.attributes': typeof KankaPageModel;
            'kanka-foundry.abilities': typeof KankaPageModel;
            'kanka-foundry.relations': typeof KankaPageModel;
            'kanka-foundry.assets': typeof KankaPageModel;
            'kanka-foundry.inventory': typeof KankaPageModel;
            'kanka-foundry.children': typeof KankaPageModel;
            'kanka-foundry.events': typeof KankaPageModel;
            'kanka-foundry.character-organisations': typeof KankaPageModel;
            'kanka-foundry.family-members': typeof KankaPageModel;
            'kanka-foundry.organisation-members': typeof KankaPageModel;
            'kanka-foundry.quest-elements': typeof KankaPageModel;
        };
    }

    interface SettingConfig {
        'kanka-foundry.baseUrl': string;
        'kanka-foundry.accessToken': string;
        'kanka-foundry.campaign': string;
        'kanka-foundry.importLanguage': string;
        'kanka-foundry.disableExternalMentionLinks': boolean;
        'kanka-foundry.importPrivateEntities': boolean;
        'kanka-foundry.mergeOverviewPages': boolean;
        'kanka-foundry.keepTreeStructure': boolean;
        'kanka-foundry.browserView': 'grid' | 'list';
        'kanka-foundry.automaticPermissions': 'never' | 'initial' | 'always';
        'kanka-foundry.importTemplateEntities': boolean;
        'kanka-foundry.questQuestStatusIcon': boolean;
        'kanka-foundry.createActorsForCharacters': boolean;
        'kanka-foundry.defaultActorType': string;
        'kanka-foundry.defaultGameSystem': string;
        'kanka-foundry.pcTags': string;
        'kanka-foundry.syncBackActors': boolean;
        'kanka-foundry.syncBackJournals': boolean;
        'kanka-foundry.migrationVersion': string;
        'kanka-foundry.collapseType_ability': boolean;
        'kanka-foundry.collapseType_campaign': boolean;
        'kanka-foundry.collapseType_creature': boolean;
        'kanka-foundry.collapseType_character': boolean;
        'kanka-foundry.collapseType_event': boolean;
        'kanka-foundry.collapseType_family': boolean;
        'kanka-foundry.collapseType_item': boolean;
        'kanka-foundry.collapseType_journal': boolean;
        'kanka-foundry.collapseType_location': boolean;
        'kanka-foundry.collapseType_note': boolean;
        'kanka-foundry.collapseType_organisation': boolean;
        'kanka-foundry.collapseType_quest': boolean;
        'kanka-foundry.collapseType_race': boolean;
        /** Legacy campaign day, read once to migrate it into the wh40k-rpg Event Tracker. */
        'kanka-foundry.currentDay': number;
        'kanka-foundry.pendingConflicts': string;
    }

    // The wh40k-rpg system's Event Tracker hooks, which the Kanka sync adapter
    // (foundry/eventTrackerSync.ts) listens to. Declared here so `Hooks.on`
    // types their payloads without a cast at the registration site.
    // eslint-disable-next-line @typescript-eslint/no-shadow -- boundary: fvtt-types declares HookConfig inside `namespace Hooks`; augmenting it means re-opening that namespace
    namespace Hooks {
        interface HookConfig {
            'wh40k-rpg.eventResolved': EventResolvedHook;
            'wh40k-rpg.campaignDayChanged': CampaignDayChangedHook;
            'wh40k-rpg.pcAttitudeChanged': PcAttitudeChangedHook;
        }
    }
}
