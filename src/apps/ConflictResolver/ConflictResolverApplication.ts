import type { DeepPartial } from 'fvtt-types/utils';
import { listConflicts } from '../../foundry/conflicts/conflictStore';
import { resolveConflict } from '../../foundry/conflicts/resolveConflicts';
import type { ConflictChoice, StoredConflict } from '../../foundry/conflicts/types';
import { showError, showInfo, showWarning } from '../../foundry/notifications';
import { logError } from '../../util/logger';
import resolverTemplate from './templates/resolver.hbs';
import ApplicationV2 = foundry.applications.api.ApplicationV2;
import HandlebarsApplicationMixin = foundry.applications.api.HandlebarsApplicationMixin;

/** Longest value rendered inline before it is clipped with an ellipsis. */
const MAX_DISPLAY_LENGTH = 240;

interface ResolverRow {
    id: string;
    entityName: string;
    label: string;
    kankaDisplay: string;
    foundryDisplay: string;
    /** Snapshot rows cannot auto-apply Kanka → Foundry; the Kanka side is annotated. */
    isSnapshot: boolean;
}

type RenderContext = ApplicationV2.RenderContext &
    Partial<{
        rows: ResolverRow[];
        hasConflicts: boolean;
    }>;

function toDisplay(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) return '';
    return trimmed.length > MAX_DISPLAY_LENGTH ? `${trimmed.slice(0, MAX_DISPLAY_LENGTH)}…` : trimmed;
}

function toRow(conflict: StoredConflict): ResolverRow {
    return {
        id: conflict.id,
        entityName: conflict.entityName,
        label: conflict.label,
        kankaDisplay: toDisplay(conflict.kankaValue),
        foundryDisplay: toDisplay(conflict.foundryValue),
        isSnapshot: conflict.kind === 'snapshot',
    };
}

function isConflictChoice(value: string): value is ConflictChoice {
    return value === 'kanka' || value === 'foundry';
}

/**
 * GM-facing dialog that surfaces every pending Kanka ↔ Foundry conflict in one
 * place. Each row shows the Kanka value (left) against the Foundry value (right)
 * with a mutually-exclusive radio choice; the GM picks a winning side per row
 * (or bulk-selects a side) and applies. Unresolved rows stay in the registry and
 * are re-asked on the next login.
 */
export default class ConflictResolverApplication extends HandlebarsApplicationMixin(ApplicationV2<RenderContext>) {
    static override DEFAULT_OPTIONS: DeepPartial<ApplicationV2.Configuration> = {
        id: 'kanka-conflict-resolver',
        classes: ['kanka-conflict-resolver'],
        window: {
            // eslint-disable-next-line no-restricted-syntax -- this IS a localization key; the rule flags every title literal
            title: 'KANKA.conflicts.title',
            resizable: true,
            contentClasses: ['knk:overflow-auto'],
        },
        position: {
            height: 'auto',
            width: 720,
        },
        actions: {
            takeAllKanka(this: ConflictResolverApplication): void {
                this.selectAll('kanka');
            },
            takeAllFoundry(this: ConflictResolverApplication): void {
                this.selectAll('foundry');
            },
            async resolveSelected(this: ConflictResolverApplication): Promise<void> {
                await this.applySelected();
            },
            // The Apply button becomes a Continue button once the batch has applied
            // (see #turnIntoContinue); this action fires on that second click.
            async continueAfterApply(this: ConflictResolverApplication): Promise<void> {
                await this.proceedAfterApply();
            },
        },
    };

    static override PARTS: Record<string, HandlebarsApplicationMixin.HandlebarsTemplatePart> = {
        resolver: {
            template: resolverTemplate,
        },
    };

    protected selectAll(choice: ConflictChoice): void {
        for (const input of this.element.querySelectorAll<HTMLInputElement>(`input[type="radio"][value="${choice}"]`)) {
            input.checked = true;
        }
    }

    protected collectPicks(): { id: string; choice: ConflictChoice }[] {
        const picks: { id: string; choice: ConflictChoice }[] = [];
        for (const row of this.element.querySelectorAll<HTMLElement>('[data-conflict-id]')) {
            const id = row.dataset['conflictId'];
            if (id === undefined) continue;
            const checked = row.querySelector<HTMLInputElement>('input[type="radio"]:checked');
            if (checked && isConflictChoice(checked.value)) {
                picks.push({ id, choice: checked.value });
            }
        }
        return picks;
    }

    protected async applySelected(): Promise<void> {
        const picks = this.collectPicks();
        if (picks.length === 0) {
            showWarning('conflicts.noneSelected');
            return;
        }

        // Give the GM live feedback while the batch applies: disable the button and
        // mount a spinner + "done/total" counter beside it, updated per change.
        const button = this.element.querySelector<HTMLButtonElement>('button[data-action="resolveSelected"]');
        const progress = this.#beginApplyProgress(button, picks.length);

        let failures = 0;
        let done = 0;
        for (const { id, choice } of picks) {
            try {
                // Sequential by design: each resolution reads-and-writes the shared
                // conflict setting; concurrent writes would clobber one another.
                // eslint-disable-next-line no-await-in-loop -- race-free serial persistence of the conflict registry
                const applied = await resolveConflict(id, choice);
                if (!applied) failures += 1;
            } catch (error) {
                failures += 1;
                logError(`Failed to resolve conflict ${id}`, error);
            }
            done += 1;
            progress?.update(done);
        }

        // Surface failures explicitly — a resolution that could not be applied
        // (e.g. a Kanka write failed) must not look like the button did nothing.
        if (failures > 0) {
            showError('conflicts.applyFailed', { count: String(failures) });
        }

        // Batch done: swap the spinner for a checkmark and turn Apply into Continue,
        // so the GM sees completion and then advances deliberately.
        progress?.finish();
        this.#turnIntoContinue(button);
    }

    /**
     * Disable the Apply button and mount a spinner + `0/total` progress counter
     * beside it. Returns `{ update, finish }` to advance the count and swap the
     * spinner for a checkmark, or null when the button is missing.
     */
    #beginApplyProgress(button: HTMLButtonElement | null, total: number): { update: (done: number) => void; finish: () => void } | null {
        if (button === null) return null;
        button.disabled = true;
        const status = document.createElement('span');
        status.className = 'kanka-apply-status knk:inline-flex knk:items-center knk:gap-1 knk:ml-2';
        const icon = document.createElement('i');
        icon.className = 'fas fa-spinner fa-spin';
        const count = document.createElement('span');
        count.className = 'kanka-apply-count';
        count.textContent = `0/${total}`;
        status.append(icon, count);
        button.after(status);
        return {
            update: (applied: number): void => {
                count.textContent = `${applied}/${total}`;
            },
            finish: (): void => {
                icon.className = 'fas fa-check kanka-apply-done';
                count.textContent = `${total}/${total}`;
            },
        };
    }

    /**
     * Turn the (now re-enabled) Apply button into a Continue button whose click
     * advances past the resolved batch (see {@link proceedAfterApply}).
     */
    #turnIntoContinue(button: HTMLButtonElement | null): void {
        if (button === null) return;
        button.disabled = false;
        button.dataset['action'] = 'continueAfterApply';
        button.textContent = game.i18n?.localize('KANKA.conflicts.continue') ?? 'Continue';
    }

    /**
     * Advance after a batch applied: close when every conflict is resolved, else
     * re-render the remaining ones. Formerly the tail of {@link applySelected}, now
     * gated behind the Continue click.
     */
    protected async proceedAfterApply(): Promise<void> {
        if (listConflicts().length === 0) {
            await this.close();
            showInfo('conflicts.allResolved');
        } else {
            await this.render();
        }
    }

    // eslint-disable-next-line @typescript-eslint/require-await -- ApplicationV2 mandates a Promise return; the context is built synchronously
    override async _prepareContext(): Promise<RenderContext> {
        const rows = listConflicts().map(toRow);
        return { rows, hasConflicts: rows.length > 0 };
    }
}
