// Irreversible-action substrate (handbook §18.3, §5.3; Constitution X): every
// external action carries an idempotency key and is audited, so a retry can
// never become a second real-world event. In-memory adapters serve Build 0;
// Postgres-backed adapters replace them in Build 1 behind the same contracts.

export type AuditStatus = "executed" | "duplicate" | "failed";

export type AuditEntry = {
  actionType: string;
  idempotencyKey: string;
  status: AuditStatus;
  at: Date;
  detail?: string;
};

export type IdempotencyStore = {
  /** Atomically claim a key. Returns false if it was already claimed. */
  claim(key: string): Promise<boolean>;
  /** Release a key whose action failed, so a retry (same key) may run. */
  release(key: string): Promise<void>;
};

export type AuditLog = {
  record(entry: AuditEntry): Promise<void>;
  list(): Promise<readonly AuditEntry[]>;
};

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly claimed = new Set<string>();

  async claim(key: string): Promise<boolean> {
    if (this.claimed.has(key)) return false;
    this.claimed.add(key);
    return true;
  }

  async release(key: string): Promise<void> {
    this.claimed.delete(key);
  }
}

export class InMemoryAuditLog implements AuditLog {
  private readonly entries: AuditEntry[] = [];

  async record(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
  }

  async list(): Promise<readonly AuditEntry[]> {
    return [...this.entries];
  }
}

export type IrreversibleResult<T> = { outcome: "executed"; value: T } | { outcome: "duplicate" };

export type RunIrreversibleOptions<T> = {
  actionType: string;
  idempotencyKey: string;
  store: IdempotencyStore;
  audit: AuditLog;
  /** Receives the key so the external call itself carries it (§18.3). */
  action: (idempotencyKey: string) => Promise<T>;
};

export async function runIrreversible<T>(
  options: RunIrreversibleOptions<T>,
): Promise<IrreversibleResult<T>> {
  const { actionType, idempotencyKey, store, audit, action } = options;

  if (!(await store.claim(idempotencyKey))) {
    await audit.record({ actionType, idempotencyKey, status: "duplicate", at: new Date() });
    return { outcome: "duplicate" };
  }

  try {
    const value = await action(idempotencyKey);
    await audit.record({ actionType, idempotencyKey, status: "executed", at: new Date() });
    return { outcome: "executed", value };
  } catch (error) {
    // The key is released so a deliberate retry may run; the retry re-uses the
    // same key, which downstream dedupe honors even after a partial failure.
    await store.release(idempotencyKey);
    await audit.record({
      actionType,
      idempotencyKey,
      status: "failed",
      at: new Date(),
      detail: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
