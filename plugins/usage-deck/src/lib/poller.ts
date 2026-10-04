import streamDeck from "@elgato/streamdeck";

export type Snapshot<T> = {
	data?: T;
	/** When {@link data} was last fetched successfully. */
	fetchedAt?: number;
	/** The last error, cleared on the next successful fetch. */
	error?: FetchError;
};

/** An error with a short, translatable message for the key face. */
export class FetchError extends Error {
	constructor(
		/** Localization key for the key face, e.g. "err.auth". */
		readonly short: string,
		detail: string,
		/** Retry later than usual (rate limited). */
		readonly backoff = false,
		/** Placeholder values for {@link short}. */
		readonly vars: Record<string, string | number> = {}
	) {
		super(detail);
	}
}

/**
 * Shared, subscriber-driven poller for one data source. Polls only while at least one key is visible,
 * so an off-screen page never hits the API.
 */
export class Poller<T> {
	private snapshot: Snapshot<T> = {};
	private readonly listeners = new Set<(s: Snapshot<T>) => void>();
	private timer?: NodeJS.Timeout;
	private inFlight?: Promise<void>;
	private currentDelay: number;
	/** Bumped by reset(); a fetch started under an older generation is discarded when it lands. */
	private generation = 0;

	constructor(
		private readonly name: string,
		private readonly fetcher: () => Promise<T>,
		private readonly intervalMs: number,
		/** Presses within this window reuse the last result instead of refetching. */
		private readonly minManualMs = 15_000
	) {
		this.currentDelay = intervalMs;
	}

	get current(): Snapshot<T> {
		return this.snapshot;
	}

	subscribe(listener: (s: Snapshot<T>) => void): () => void {
		this.listeners.add(listener);
		listener(this.snapshot);
		if (this.listeners.size === 1) void this.tick();
		return () => {
			this.listeners.delete(listener);
			if (this.listeners.size === 0) this.stop();
		};
	}

	/** Manual refresh (key press). Debounced so repeated presses don't hammer the API. */
	refresh(): Promise<void> {
		const age = Date.now() - (this.snapshot.fetchedAt ?? 0);
		if (age < this.minManualMs && !this.snapshot.error) {
			this.emit();
			return Promise.resolve();
		}
		return this.tick();
	}

	/** Drop cached data and refetch, e.g. after credentials or the source change. */
	reset(): void {
		this.generation++;
		this.snapshot = {};
		this.currentDelay = this.intervalMs;
		this.emit();
		// If a fetch is running it was started with the old settings: its result is dropped and a new one follows.
		if (this.listeners.size > 0 && !this.inFlight) void this.tick();
	}

	private tick(): Promise<void> {
		if (this.inFlight) return this.inFlight;
		this.stop();
		const generation = this.generation;
		const current = () => generation === this.generation;
		this.inFlight = this.fetcher()
			.then((data) => {
				if (!current()) return;
				this.snapshot = { data, fetchedAt: Date.now() };
				this.currentDelay = this.intervalMs;
			})
			.catch((e: unknown) => {
				if (!current()) return;
				const error = e instanceof FetchError ? e : new FetchError("err.generic", String(e));
				streamDeck.logger.warn(`[${this.name}] ${error.message}`);
				this.snapshot = { ...this.snapshot, error };
				this.currentDelay = error.backoff ? Math.min(this.currentDelay * 2, 30 * 60_000) : this.intervalMs;
			})
			.finally(() => {
				this.inFlight = undefined;
				if (this.listeners.size === 0) return;
				if (!current()) {
					void this.tick();
					return;
				}
				this.emit();
				this.timer = setTimeout(() => void this.tick(), this.currentDelay);
			});
		return this.inFlight;
	}

	private stop(): void {
		if (this.timer) clearTimeout(this.timer);
		this.timer = undefined;
	}

	private emit(): void {
		for (const l of this.listeners) l(this.snapshot);
	}
}
