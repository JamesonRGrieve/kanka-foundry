function assertType<T>(_value: unknown): asserts _value is T {}

interface PersonalityEntry {
    entry_parsed?: string;
    entry?: string;
    [k: string]: unknown;
}

// Migrate from old journal entry format to new page based format
export default async function migrate(): Promise<void> {
    const journals = Array.from(game.journal?.values() ?? []).filter((e) => e.getFlag('kanka-foundry', 'id'));

    for (const entry of journals) {
        const pages = Array.from(entry.pages.values()).filter((page) => ['kanka-foundry.character-profile'].includes(page.type));

        const updates = pages
            .map((page) => {
                const sysRaw: unknown = page.system;
                if (sysRaw === null || typeof sysRaw !== 'object') return null;
                const snapshotRaw: unknown = Reflect.get(sysRaw, 'snapshot');
                if (snapshotRaw === null || typeof snapshotRaw !== 'object') return null;
                assertType<Record<string, unknown>>(snapshotRaw);
                const personalityRaw: unknown = snapshotRaw['personality'];
                if (!Array.isArray(personalityRaw)) return null;
                const personalityArr: unknown[] = Array.from(personalityRaw as unknown[]);
                const personality: PersonalityEntry[] = personalityArr.map((p: unknown) => {
                    assertType<PersonalityEntry>(p);
                    return p;
                });
                return {
                    _id: page._id,
                    system: {
                        snapshot: {
                            ...snapshotRaw,
                            personality: personality.map((p) => ({ ...p, entry_parsed: p.entry_parsed ?? p.entry })),
                        },
                    },
                };
            })
            .filter(Boolean);

        if (updates.length > 0) {
            assertType<JournalEntryPage.UpdateData[]>(updates);
            await entry.updateEmbeddedDocuments('JournalEntryPage', updates);
        }
    }
}
