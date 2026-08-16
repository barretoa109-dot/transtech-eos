import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { buildMultiProviderGlobalContextCommitFromPlan } from "../../lib/financial-autopilot/global-context-commit";
import { runMultiProviderScopedPersistenceScenario } from "../../lib/financial-autopilot/multi-provider-scoped-persistence-scenario";
import type { MultiProviderScopedPersistencePlan } from "../../lib/financial-autopilot/multi-provider-scoped-persistence";
import { sha256FinancialFingerprint } from "../../lib/financial-autopilot/persistence-fingerprint";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const OTHER_USER_ID = "00000000-0000-4000-8000-000000000999";

const SQL_FILES = [
  "docs/financial-autopilot/SCHEMA_V1_DRAFT.sql",
  "docs/financial-autopilot/PERSISTENCE_RPC_V1_DRAFT.sql",
  "docs/financial-autopilot/PERSISTENCE_FIRST_FORECAST_RISK_V1_1_DRAFT.sql",
  "docs/financial-autopilot/PERSISTENCE_CRITICAL_OBLIGATIONS_V1_2_DRAFT.sql",
  "docs/financial-autopilot/PERSISTENCE_CRITICAL_SOURCES_V1_3_DRAFT.sql",
  "docs/financial-autopilot/GLOBAL_CONTEXT_COMMIT_V1_3_DRAFT.sql",
  "docs/financial-autopilot/PERSISTENCE_MULTI_PROVIDER_RPC_V1_3_DRAFT.sql",
] as const;

type RpcResult = {
  replayed: boolean;
  planFingerprint: string;
  globalContextRevision: string | null;
  globalContextCommitFingerprint: string | null;
  providerScopesTouched: number;
  ingestionRowsTouched: number;
  ledgerRowsTouched: number;
};

type PersistenceCounts = {
  scopes: number;
  events: number;
  ledger: number;
  contexts: number;
  commits: number;
  plans: number;
};

function errorCode(error: unknown) {
  return error instanceof Error
    ? (error as Error & { code?: string }).code ?? null
    : null;
}

async function rejectsMessage(
  work: () => Promise<unknown>,
  expectedMessage: string,
) {
  try {
    await work();
  } catch (error) {
    assert(error instanceof Error);
    assert.equal(error.message, expectedMessage);
    return errorCode(error);
  }
  assert.fail(`Expected rejection: ${expectedMessage}`);
}

async function createValidationDatabase(plan: MultiProviderScopedPersistencePlan) {
  const database = new PGlite({ extensions: { pgcrypto } });
  await database.waitReady;
  await database.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid()
      returns uuid
      language sql
      stable
      as $$ select null::uuid $$;
  `);

  for (const relativePath of SQL_FILES) {
    await database.exec(
      await readFile(new URL(relativePath, `file://${REPO_ROOT}/`), "utf8"),
    );
  }
  const version = await database.query<{ version_number: number }>(
    "select current_setting('server_version_num')::integer as version_number",
  );
  assert(version.rows[0]);
  assert(version.rows[0].version_number >= 170000);
  assert(version.rows[0].version_number < 180000);
  await database.query("insert into auth.users(id) values ($1)", [plan.userId]);
  return database;
}

async function persist(
  database: PGlite,
  plan: MultiProviderScopedPersistencePlan,
  userId = plan.userId,
) {
  const result = await database.query<{ result: RpcResult }>(
    "select public.eos_financial_persist_multi_provider_v1_3($1::uuid, $2::jsonb) as result",
    [userId, JSON.stringify(plan)],
  );
  assert(result.rows[0]);
  return result.rows[0].result;
}

async function persistenceCounts(database: PGlite) {
  const result = await database.query<PersistenceCounts>(`select
    (select count(*) from public.eos_financial_provider_scopes_v1_3)::integer as scopes,
    (select count(*) from public.eos_financial_ingestion_events_v1)::integer as events,
    (select count(*) from public.eos_financial_ledger_v1)::integer as ledger,
    (select count(*) from public.eos_financial_contexts_v1)::integer as contexts,
    (select count(*) from public.eos_financial_global_context_commits_v1_3)::integer as commits,
    (select count(*) from public.eos_financial_multi_provider_plans_v1_3)::integer as plans
  `);
  assert(result.rows[0]);
  return result.rows[0];
}

function buildLateProviderConflictPlan(
  source: MultiProviderScopedPersistencePlan,
) {
  const plan = structuredClone(source);
  const provider = plan.providerPlans.at(-1);
  assert(provider);
  const event = provider.ingestionEventUpserts[0];
  assert(event);

  provider.scopeFingerprint = sha256FinancialFingerprint({
    contract: "multi-provider-late-conflict-validation-scope-v1",
    priorScopeFingerprint: provider.scopeFingerprint,
  });
  event.payloadHash = sha256FinancialFingerprint({
    contract: "multi-provider-late-conflict-validation-payload-v1",
    original: event.payloadHash,
  });
  provider.providerPlanFingerprint = sha256FinancialFingerprint({
    contract: "multi-provider-scoped-provider-plan-v1",
    providerKey: provider.providerKey,
    scopeFingerprint: provider.scopeFingerprint,
    snapshotFingerprint: provider.snapshotFingerprint,
    connectionUpserts: provider.connectionUpserts,
    accountUpserts: provider.accountUpserts,
    ingestionEventUpserts: provider.ingestionEventUpserts,
    ledgerUpserts: provider.ledgerUpserts,
  });

  const manifestScope = plan.manifest.providerScopes.find(
    (candidate) => candidate.providerKey === provider.providerKey,
  );
  assert(manifestScope);
  manifestScope.scopeFingerprint = provider.scopeFingerprint;
  plan.manifest.manifestFingerprint = sha256FinancialFingerprint({
    contract: "multi-provider-persistence-manifest-v1",
    trustedUserId: plan.manifest.trustedUserId,
    providerScopes: plan.manifest.providerScopes.map((candidate) => ({
      providerKey: candidate.providerKey,
      scopeFingerprint: candidate.scopeFingerprint,
    })),
    analysisFingerprint: plan.manifest.analysisFingerprint,
    globalCoverageFingerprint: plan.manifest.globalCoverageFingerprint,
    sourceOrchestrationFingerprint:
      plan.manifest.sourceOrchestrationFingerprint,
    globalResultFingerprint: plan.manifest.globalResultFingerprint,
    globalContextEligible: plan.manifest.globalContextEligible,
  });
  plan.planFingerprint = sha256FinancialFingerprint({
    contract: "multi-provider-scoped-persistence-plan-v1",
    trustedUserId: plan.userId,
    manifestFingerprint: plan.manifest.manifestFingerprint,
    providerPlans: plan.providerPlans.map((candidate) => ({
      providerKey: candidate.providerKey,
      scopeFingerprint: candidate.scopeFingerprint,
      providerPlanFingerprint: candidate.providerPlanFingerprint,
    })),
    globalContextRevision: plan.globalContextPlan?.revision ?? null,
  });
  return plan;
}

function buildDuplicateProviderPlan(
  source: MultiProviderScopedPersistencePlan,
) {
  const plan = structuredClone(source);
  assert(plan.providerPlans[0]);
  assert(plan.providerPlans[1]);
  assert(plan.manifest.providerScopes[0]);
  assert(plan.manifest.providerScopes[1]);
  plan.providerPlans[1] = structuredClone(plan.providerPlans[0]);
  plan.manifest.providerScopes[1] = structuredClone(
    plan.manifest.providerScopes[0],
  );
  return plan;
}

async function validateHealthyAndFailurePaths(
  healthy: MultiProviderScopedPersistencePlan,
  incomplete: MultiProviderScopedPersistencePlan,
) {
  const database = await createValidationDatabase(healthy);
  const expectedCommit = buildMultiProviderGlobalContextCommitFromPlan({
    trustedUserId: healthy.userId,
    plan: healthy,
  });
  assert(expectedCommit);

  const canonicalFixture = {
    z: "value, with: structural-looking text",
    a: [null, true, 12, { y: "Paraguay", b: "Gs." }],
  };
  const canonicalHash = await database.query<{ hash: string }>(
    "select eos_private.eos_financial_sha256_json_v1($1::jsonb) as hash",
    [JSON.stringify(canonicalFixture)],
  );
  assert.equal(
    canonicalHash.rows[0]?.hash,
    sha256FinancialFingerprint(canonicalFixture),
  );

  const first = await persist(database, healthy);
  assert.equal(first.replayed, false);
  assert.equal(first.planFingerprint, healthy.planFingerprint);
  assert.equal(first.globalContextRevision, healthy.globalContextPlan?.revision);
  assert.equal(
    first.globalContextCommitFingerprint,
    expectedCommit.commitFingerprint,
  );
  assert.deepEqual(await persistenceCounts(database), {
    scopes: 2,
    events: 2,
    ledger: 2,
    contexts: 1,
    commits: 1,
    plans: 1,
  });

  await database.exec("set role service_role");
  const replay = await persist(database, healthy);
  assert.deepEqual(
    {
      replayed: replay.replayed,
      providerScopesTouched: replay.providerScopesTouched,
      ingestionRowsTouched: replay.ingestionRowsTouched,
      ledgerRowsTouched: replay.ledgerRowsTouched,
    },
    {
      replayed: true,
      providerScopesTouched: 0,
      ingestionRowsTouched: 0,
      ledgerRowsTouched: 0,
    },
  );

  await database.exec("reset role; set role authenticated");
  await rejectsMessage(
    () => persist(database, healthy),
    "permission denied for function eos_financial_persist_multi_provider_v1_3",
  );
  await rejectsMessage(
    () =>
      database.query(
        "select * from public.eos_financial_multi_provider_plans_v1_3",
      ),
    "permission denied for table eos_financial_multi_provider_plans_v1_3",
  );
  await database.exec("reset role; set role anon");
  await rejectsMessage(
    () => persist(database, healthy),
    "permission denied for function eos_financial_persist_multi_provider_v1_3",
  );
  await rejectsMessage(
    () =>
      database.query(
        "select * from public.eos_financial_provider_scopes_v1_3",
      ),
    "permission denied for table eos_financial_provider_scopes_v1_3",
  );
  await database.exec("reset role");

  const forbiddenAcl = await database.query<{ count: number }>(`select (
    (select count(*) from information_schema.table_privileges
      where table_schema = 'public'
        and table_name in (
          'eos_financial_provider_scopes_v1_3',
          'eos_financial_multi_provider_plans_v1_3'
        )
        and grantee in ('PUBLIC', 'anon', 'authenticated')) +
    (select count(*) from information_schema.routine_privileges
      where routine_schema = 'public'
        and routine_name = 'eos_financial_persist_multi_provider_v1_3'
        and grantee in ('PUBLIC', 'anon', 'authenticated'))
  )::integer as count`);
  assert.equal(forbiddenAcl.rows[0]?.count, 0);

  await database.query("insert into auth.users(id) values ($1)", [OTHER_USER_ID]);
  const beforeCrossUser = await persistenceCounts(database);
  assert.equal(
    await rejectsMessage(
      () => persist(database, healthy, OTHER_USER_ID),
      "financial_multi_provider_persistence_user_mismatch",
    ),
    "42501",
  );
  assert.deepEqual(await persistenceCounts(database), beforeCrossUser);

  const duplicateProvider = buildDuplicateProviderPlan(incomplete);
  const beforeDuplicateProvider = await persistenceCounts(database);
  assert.equal(
    await rejectsMessage(
      () => persist(database, duplicateProvider),
      "financial_multi_provider_persistence_invalid_manifest_scope",
    ),
    "22023",
  );
  assert.deepEqual(
    await persistenceCounts(database),
    beforeDuplicateProvider,
  );

  const lateConflict = buildLateProviderConflictPlan(incomplete);
  const beforeLateConflict = await persistenceCounts(database);
  assert.equal(
    await rejectsMessage(
      () => persist(database, lateConflict),
      "financial_multi_provider_ingestion_replay_mismatch",
    ),
    "23505",
  );
  assert.deepEqual(await persistenceCounts(database), beforeLateConflict);
  await database.close();
}

async function validateStaleContext(plan: MultiProviderScopedPersistencePlan) {
  const database = await createValidationDatabase(plan);
  const expectedCommit = buildMultiProviderGlobalContextCommitFromPlan({
    trustedUserId: plan.userId,
    plan,
  });
  assert(expectedCommit);
  const result = await persist(database, plan);
  assert.equal(
    result.globalContextCommitFingerprint,
    expectedCommit.commitFingerprint,
  );
  const context = await database.query<{
    status: string;
    sources_fresh: boolean;
    critical_sources_complete: boolean;
  }>(
    "select status, sources_fresh, critical_sources_complete from public.eos_financial_contexts_v1",
  );
  assert.deepEqual(context.rows[0], {
    status: "DEGRADED",
    sources_fresh: false,
    critical_sources_complete: true,
  });
  assert.deepEqual(await persistenceCounts(database), {
    scopes: 2,
    events: 2,
    ledger: 2,
    contexts: 1,
    commits: 1,
    plans: 1,
  });
  await database.close();
}

async function validateIncompleteCoverage(
  plan: MultiProviderScopedPersistencePlan,
) {
  const database = await createValidationDatabase(plan);
  const result = await persist(database, plan);
  assert.equal(result.globalContextRevision, null);
  assert.equal(result.globalContextCommitFingerprint, null);
  assert.deepEqual(await persistenceCounts(database), {
    scopes: 2,
    events: 2,
    ledger: 2,
    contexts: 0,
    commits: 0,
    plans: 1,
  });
  await database.close();
}

async function main() {
  const scenario = runMultiProviderScopedPersistenceScenario();
  assert.equal(scenario.ok, true);
  await validateHealthyAndFailurePaths(scenario.healthy, scenario.incomplete);
  await validateStaleContext(scenario.stale);
  await validateIncompleteCoverage(scenario.incomplete);

  console.log(
    JSON.stringify({
      ok: true,
      checks: {
        sqlLoadsOnPostgres17: true,
        canonicalShaParity: true,
        freshAtomicWrite: true,
        exactReplayNoOp: true,
        typescriptPostgresFingerprintParity: true,
        serviceRoleOnlyExecute: true,
        receiptTablesServerOnly: true,
        crossUserRejectedWithoutMutation: true,
        duplicateProviderIdentityRejectedWithoutMutation: true,
        lateProviderConflictRollsBackEverything: true,
        staleContextCommitsAsDegraded: true,
        incompleteCoverageHasNoContextOrCommit: true,
      },
    }),
  );
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
