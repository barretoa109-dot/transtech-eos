import type {
  FinancialPersistencePlan,
  FinancialPersistenceStore,
} from "./persistence";

function stableJson(value: unknown) {
  return JSON.stringify(value);
}

function immutableInsert(
  map: Map<string, string>,
  key: string,
  value: unknown,
  mismatchCode: string,
) {
  const serialized = stableJson(value);
  const current = map.get(key);
  if (current === undefined) {
    map.set(key, serialized);
    return true;
  }
  if (current !== serialized) throw new Error(mismatchCode);
  return false;
}

function mutableUpsert(map: Map<string, string>, key: string, value: unknown) {
  const serialized = stableJson(value);
  const current = map.get(key);
  if (current === serialized) return false;
  map.set(key, serialized);
  return true;
}

/**
 * Deterministic persistence emulator for preview tests only.
 *
 * It models the semantics required from the future Postgres/Supabase adapter:
 * - raw ingestion events are immutable and replay-mismatch protected;
 * - canonical Ledger rows can advance lifecycle state by stable canonical key;
 * - reconciliations are immutable by signature;
 * - recurrence/obligation/account state is upserted by stable business key;
 * - a previously persisted context source fingerprint is an idempotent replay.
 *
 * It is intentionally process-local and is not a production datastore.
 */
export class InMemoryFinancialPersistenceStore implements FinancialPersistenceStore {
  private readonly connections = new Map<string, string>();
  private readonly accounts = new Map<string, string>();
  private readonly ingestion = new Map<string, string>();
  private readonly ledger = new Map<string, string>();
  private readonly reconciliations = new Map<string, string>();
  private readonly recurrences = new Map<string, string>();
  private readonly obligations = new Map<string, string>();
  private readonly contexts = new Map<string, string>();

  async persist(plan: FinancialPersistencePlan) {
    const contextKey = `${plan.userId}|${plan.contextInsert.sourceFingerprint}`;
    if (this.contexts.has(contextKey)) {
      return {
        replayed: true,
        contextRevision: plan.contextInsert.revision,
        ledgerRowsTouched: 0,
        ingestionRowsTouched: 0,
        reconciliationRowsTouched: 0,
      };
    }

    for (const connection of plan.connectionUpserts) {
      mutableUpsert(
        this.connections,
        `${connection.userId}|${connection.providerKey}|${connection.connectionKey}`,
        connection,
      );
    }

    for (const account of plan.accountUpserts) {
      mutableUpsert(
        this.accounts,
        `${account.userId}|${account.connectionKey}|${account.externalAccountId}`,
        account,
      );
    }

    let ingestionRowsTouched = 0;
    for (const event of plan.ingestionEventUpserts) {
      const inserted = immutableInsert(
        this.ingestion,
        `${event.userId}|${event.providerKey}|${event.connectionKey}|${event.externalEventId}`,
        event,
        "financial_ingestion_replay_mismatch",
      );
      if (inserted) ingestionRowsTouched += 1;
    }

    let ledgerRowsTouched = 0;
    for (const entry of plan.ledgerUpserts) {
      if (
        mutableUpsert(
          this.ledger,
          `${entry.userId}|${entry.canonicalKey}`,
          entry,
        )
      ) {
        ledgerRowsTouched += 1;
      }
    }

    let reconciliationRowsTouched = 0;
    for (const reconciliation of plan.reconciliationInserts) {
      const inserted = immutableInsert(
        this.reconciliations,
        `${reconciliation.userId}|${reconciliation.signature}`,
        reconciliation,
        "financial_reconciliation_replay_mismatch",
      );
      if (inserted) reconciliationRowsTouched += 1;
    }

    for (const recurrence of plan.recurrenceUpserts) {
      mutableUpsert(
        this.recurrences,
        `${recurrence.userId}|${recurrence.recurrenceKey}`,
        recurrence,
      );
    }

    for (const obligation of plan.obligationUpserts) {
      mutableUpsert(
        this.obligations,
        `${obligation.userId}|${obligation.sourceKey}`,
        obligation,
      );
    }

    this.contexts.set(contextKey, stableJson(plan.contextInsert));

    return {
      replayed: false,
      contextRevision: plan.contextInsert.revision,
      ledgerRowsTouched,
      ingestionRowsTouched,
      reconciliationRowsTouched,
    };
  }

  snapshotCounts() {
    return {
      connections: this.connections.size,
      accounts: this.accounts.size,
      ingestionEvents: this.ingestion.size,
      ledgerRows: this.ledger.size,
      reconciliations: this.reconciliations.size,
      recurrences: this.recurrences.size,
      obligations: this.obligations.size,
      contexts: this.contexts.size,
    };
  }
}
