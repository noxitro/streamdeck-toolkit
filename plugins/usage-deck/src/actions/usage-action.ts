import streamDeck, {
	type DidReceiveSettingsEvent,
	type KeyAction,
	type KeyDownEvent,
	type KeyUpEvent,
	SingletonAction,
	type WillAppearEvent,
	type WillDisappearEvent
} from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";

import type { Poller, Snapshot } from "../lib/poller";
import { type KeyFace, renderKey } from "../lib/render";

const LONG_PRESS_MS = 600;

type Instance<S extends JsonObject> = { action: KeyAction<S>; settings: S; unsubscribe: () => void };

/**
 * A key that shows one metric from a shared {@link Poller}.
 * Press: refresh. Hold: open the provider's usage page.
 */
export abstract class UsageAction<T, S extends JsonObject> extends SingletonAction<S> {
	private readonly instances = new Map<string, Instance<S>>();
	private readonly pressedAt = new Map<string, number>();

	protected abstract readonly poller: Poller<T>;
	protected abstract readonly usageUrl: string;
	protected abstract face(snapshot: Snapshot<T>, settings: S): KeyFace;
	/** Called on every poller update (once per visible key; implementations dedupe). */
	protected snapshotChanged(_snapshot: Snapshot<T>): void {}

	/** Re-render every key from cached data (reset countdowns change without a fetch). */
	rerenderAll(): void {
		for (const inst of this.instances.values()) void this.render(inst);
	}

	override onWillAppear(ev: WillAppearEvent<S>): void {
		if (!ev.action.isKey()) return;
		this.instances.get(ev.action.id)?.unsubscribe();
		const inst: Instance<S> = { action: ev.action, settings: ev.payload.settings, unsubscribe: () => {} };
		this.instances.set(ev.action.id, inst);
		inst.unsubscribe = this.poller.subscribe((snapshot) => {
			this.snapshotChanged(snapshot);
			void this.render(inst);
		});
	}

	override onWillDisappear(ev: WillDisappearEvent<S>): void {
		this.instances.get(ev.action.id)?.unsubscribe();
		this.instances.delete(ev.action.id);
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<S>): void {
		const inst = this.instances.get(ev.action.id);
		if (!inst) return;
		inst.settings = ev.payload.settings;
		void this.render(inst);
	}

	override onKeyDown(ev: KeyDownEvent<S>): void {
		this.pressedAt.set(ev.action.id, Date.now());
	}

	override async onKeyUp(ev: KeyUpEvent<S>): Promise<void> {
		const held = Date.now() - (this.pressedAt.get(ev.action.id) ?? Date.now());
		this.pressedAt.delete(ev.action.id);
		if (held >= LONG_PRESS_MS) {
			await streamDeck.system.openUrl(this.usageUrl);
			return;
		}
		await this.poller.refresh();
		if (this.poller.current.error) await ev.action.showAlert();
	}

	private async render(inst: Instance<S>): Promise<void> {
		try {
			await inst.action.setImage(renderKey(this.face(this.poller.current, inst.settings)));
		} catch (e) {
			streamDeck.logger.error(`render failed: ${String(e)}`);
		}
	}
}
