import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import {
  buildSourceCoverageEvidenceV1,
  financialReadConsentMaterial,
  financialSourceCoverageRef,
  trustedFinancialSourceInventoryFingerprint,
  trustedFinancialSourceInventoryMaterial,
  type TrustedFinancialSourceInventory,
} from "../../lib/financial-autopilot";
import { buildFinancialReadConsentV1 } from "../../lib/financial-autopilot/source-onboarding";
import {
  SupabaseSourceCoverageEvidenceReader,
  SupabaseSourceOnboardingReader,
  resolveAuthenticatedSourceOnboarding,
} from "../../lib/financial-autopilot/server";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const USER_A = "00000000-0000-4000-8000-000000000071";
const USER_B = "00000000-0000-4000-8000-000000000072";
const NOW = "2026-08-17T02:15:00.000Z";
const SQL_FILES = [
  "docs/financial-autopilot/SCHEMA_V1_DRAFT.sql",
  "docs/financial-autopilot/PERSISTENCE_RPC_V1_DRAFT.sql",
  "docs/financial-autopilot/PERSISTENCE_FIRST_FORECAST_RISK_V1_1_DRAFT.sql",
  "docs/financial-autopilot/PERSISTENCE_CRITICAL_OBLIGATIONS_V1_2_DRAFT.sql",
  "docs/financial-autopilot/PERSISTENCE_CRITICAL_SOURCES_V1_3_DRAFT.sql",
  "docs/financial-autopilot/GLOBAL_CONTEXT_COMMIT_V1_3_DRAFT.sql",
  "docs/financial-autopilot/PERSISTENCE_MULTI_PROVIDER_RPC_V1_3_DRAFT.sql",
  "docs/financial-autopilot/PERSISTENCE_SOURCE_ONBOARDING_RPC_V1_DRAFT.sql",
  "docs/financial-autopilot/PERSISTENCE_SOURCE_COVERAGE_EVIDENCE_RPC_V1_DRAFT.sql",
] as const;

type Predicate = { kind: "eq" | "is" | "gt"; column: string; value: unknown };

function normalizeRow(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalizeRow);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, normalizeRow(child)]));
  }
  return value;
}

/** Minimal PostgREST-compatible read surface backed by isolated PostgreSQL. */
class PGliteReadQuery {
  private columns = "*";
  private predicates: Predicate[] = [];
  private ordering: { column: string; ascending: boolean } | null = null;
  private rowLimit = 1;
  constructor(private readonly database: PGlite, private readonly table: string) {
    if (!/^eos_financial_[a-z0-9_]+$/.test(table)) throw new Error("financial_e2e_invalid_table");
  }
  select(columns: string) { this.columns = columns; return this; }
  eq(column: string, value: unknown) { this.predicates.push({ kind: "eq", column, value }); return this; }
  is(column: string, value: unknown) { this.predicates.push({ kind: "is", column, value }); return this; }
  gt(column: string, value: unknown) { this.predicates.push({ kind: "gt", column, value }); return this; }
  order(column: string, input: { ascending: boolean }) { this.ordering = { column, ascending: input.ascending }; return this; }
  limit(value: number) { this.rowLimit = value; return this; }
  async maybeSingle() {
    const identifiers = this.columns.split(",");
    const safe = [this.table, ...identifiers, ...this.predicates.map((item) => item.column), this.ordering?.column]
      .filter((value): value is string => Boolean(value));
    if (!safe.every((value) => /^[a-z0-9_]+$/.test(value))) throw new Error("financial_e2e_invalid_identifier");
    const values: unknown[] = [];
    const where = this.predicates.map((item) => {
      if (item.kind === "is") { assert.equal(item.value, null); return `${item.column} is null`; }
      values.push(item.value);
      return `${item.column} ${item.kind === "eq" ? "=" : ">"} $${values.length}`;
    });
    const order = this.ordering ? ` order by ${this.ordering.column} ${this.ordering.ascending ? "asc" : "desc"}` : "";
    const result = await this.database.query<Record<string, unknown>>(
      `select ${identifiers.join(",")} from public.${this.table}${where.length ? ` where ${where.join(" and ")}` : ""}${order} limit ${this.rowLimit}`,
      values,
    );
    assert(result.rows.length <= 1);
    return { data: result.rows[0] ? normalizeRow(result.rows[0]) : null, error: null };
  }
}

class PGliteServerClient {
  constructor(private readonly database: PGlite) {}
  from(table: string) { return new PGliteReadQuery(this.database, table); }
}

async function createDatabase() {
  const database = new PGlite({ extensions: { pgcrypto } });
  await database.waitReady;
  await database.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  `);
  for (const path of SQL_FILES) await database.exec(await readFile(new URL(path, `file://${ROOT}/`), "utf8"));
  await database.query("insert into auth.users(id) values ($1),($2)", [USER_A, USER_B]);
  return database;
}

function onboardingFixture(userId: string, suffix: string) {
  const consent = buildFinancialReadConsentV1({
    trustedUserId: userId,
    providerKey: `mock-e2e-${suffix}`,
    grantedAt: "2026-08-17T01:00:00.000Z",
    validUntil: "2026-09-17T01:00:00.000Z",
    readScopes: ["ACCOUNTS_READ", "BALANCES_READ", "LIABILITIES_READ", "TRANSACTIONS_READ"],
  });
  const inventory: TrustedFinancialSourceInventory = {
    version: "trusted-financial-source-inventory-v1", userId,
    asOf: "2026-08-17T01:05:00.000Z", validUntil: "2026-08-19T01:05:00.000Z",
    authority: "user_confirmed", scope: "global_user_finances", discoveryComplete: true,
    confidence: 0.99, unresolvedMaterialSourceCount: 0,
    expectedSources: [{
      sourceRef: financialSourceCoverageRef({ userId, providerKey: `mock-e2e-${suffix}`, connectionId: `connection-${suffix}`, externalAccountId: `account-${suffix}` }),
      materiality: "critical", confidence: 0.99,
    }],
  };
  return { consent, inventory, fingerprint: trustedFinancialSourceInventoryFingerprint(inventory) };
}

async function persistOnboarding(database: PGlite, userId: string, fixture: ReturnType<typeof onboardingFixture>) {
  await database.query(
    `select public.eos_financial_persist_source_onboarding_v1($1::uuid,$2::jsonb,$3::text,$4::jsonb,$5::text,0)`,
    [userId, JSON.stringify(financialReadConsentMaterial(fixture.consent)), fixture.consent.fingerprint, JSON.stringify(trustedFinancialSourceInventoryMaterial(fixture.inventory)), fixture.fingerprint],
  );
}

async function persistEvidence(input: { database: PGlite; userId: string; inventoryFingerprint: string; resolvedAt: string; validUntil: string }) {
  const evidence = buildSourceCoverageEvidenceV1({
    trustedUserId: input.userId, inventoryFingerprint: input.inventoryFingerprint,
    resolvedAt: input.resolvedAt, validUntil: input.validUntil,
    resolution: {
      criticalSourcesComplete: true, criticalSourcesFresh: true,
      expectedMaterialCount: 1, connectedMaterialCount: 1, missingMaterialCount: 0,
      staleConnectedSourceCount: 0, connectedSourceCount: 1, reasonCodes: [], freshnessReasonCodes: [],
      inventoryFingerprint: input.inventoryFingerprint, coverageValidUntil: input.validUntil,
    },
  });
  await input.database.query(
    "select public.eos_financial_persist_source_coverage_evidence_v1($1::uuid,$2::jsonb,$3::text)",
    [input.userId, JSON.stringify(evidence), evidence.fingerprint],
  );
}

async function readModel(database: PGlite, userId: string) {
  const client = new PGliteServerClient(database);
  return resolveAuthenticatedSourceOnboarding({
    sessionUserId: userId,
    reader: new SupabaseSourceOnboardingReader(client as never, userId),
    coverageReader: new SupabaseSourceCoverageEvidenceReader(client as never),
    coverage: null, nowIso: NOW,
  });
}

async function main() {
  const database = await createDatabase();
  const fixtureA = onboardingFixture(USER_A, "a");
  const fixtureB = onboardingFixture(USER_B, "b");
  await database.exec("set role service_role");
  await persistOnboarding(database, USER_A, fixtureA);
  await persistOnboarding(database, USER_B, fixtureB);
  await persistEvidence({ database, userId: USER_A, inventoryFingerprint: fixtureA.fingerprint, resolvedAt: "2026-08-17T01:10:00.000Z", validUntil: "2026-08-18T01:10:00.000Z" });
  await database.exec("reset role");

  const valid = await readModel(database, USER_A);
  const absent = await readModel(database, USER_B);
  assert.equal(valid.state, "COVERAGE_READY");
  assert.equal(valid.mayBuildBaseline, true);
  assert.equal(valid.mayAssertSafety, false);
  assert.equal(absent.state, "DISCOVERING");
  assert.equal(absent.mayBuildBaseline, false);

  await database.exec("set role service_role");
  await persistEvidence({ database, userId: USER_B, inventoryFingerprint: fixtureB.fingerprint, resolvedAt: "2026-08-16T01:00:00.000Z", validUntil: "2026-08-17T02:00:00.000Z" });
  await database.exec("reset role");
  assert.equal((await readModel(database, USER_B)).state, "DISCOVERING");

  await database.exec("set role service_role");
  await persistEvidence({ database, userId: USER_B, inventoryFingerprint: "f".repeat(64), resolvedAt: "2026-08-17T01:15:00.000Z", validUntil: "2026-08-18T01:15:00.000Z" });
  await database.exec("reset role");
  assert.equal((await readModel(database, USER_B)).state, "DISCOVERING");

  const client = new PGliteServerClient(database);
  await assert.rejects(
    () => new SupabaseSourceOnboardingReader(client as never, USER_A).getCurrent(USER_B),
    /financial_source_onboarding_user_mismatch/,
  );
  await database.exec("set role authenticated");
  await assert.rejects(() => database.query("select * from public.eos_financial_source_onboarding_commits_v1"), /permission denied/);
  await assert.rejects(() => database.query("select * from public.eos_financial_source_coverage_evidence_v1"), /permission denied/);
  await assert.rejects(() => database.query("select public.eos_financial_persist_source_coverage_evidence_v1($1::uuid,$2::jsonb,$3::text)", [USER_A, "{}", "x"]), /permission denied/);
  await database.exec("reset role");

  console.log(JSON.stringify({
    ok: true, database: "isolated-postgresql-17", users: 2,
    checks: {
      validEvidenceBuildsBaselineWithoutAssertingSafe: true,
      absentEvidenceStaysDiscovering: true,
      expiredEvidenceIsIgnored: true,
      otherInventoryEvidenceIsIgnored: true,
      secondUserCannotReadFirstUserThroughBoundReader: true,
      authenticatedRoleCannotAccessInternalPersistence: true,
    },
  }, null, 2));
  await database.close();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
