import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', () => ({ default: { reset: vi.fn(), switchUser: vi.fn() } }));
vi.mock('../apps/KankaJournal/KankaJournalApplication', () => ({ default: class {} }));
vi.mock('../state/localization', () => ({ default: { setLanguage: vi.fn() } }));
vi.mock('./getMessage', () => ({ default: (key: string): string => key }));
vi.mock('./notifications', () => ({ showError: vi.fn(), showWarning: vi.fn() }));

interface SettingRegistration {
    scope?: string;
}

/** Register the module's settings against a stub and return each registration by key. */
async function registrations(): Promise<Map<string, SettingRegistration>> {
    const seen = new Map<string, SettingRegistration>();
    vi.stubGlobal('game', {
        settings: {
            register: (_module: string, key: string, config: SettingRegistration): void => {
                seen.set(key, config);
            },
        },
    });
    const { registerSettings } = await import('./settings');
    registerSettings();
    return seen;
}

describe('registerSettings', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('keeps the migration version per world, so a GM in a new browser does not re-run every migration', async () => {
        // Unscoped, Foundry keeps a setting per browser: every fresh GM client read it
        // empty and re-ran all migrations since 2024-07-28 against the world's journals.
        const migration = (await registrations()).get('migrationVersion');
        expect(migration?.scope).toBe('world');
    });
});
