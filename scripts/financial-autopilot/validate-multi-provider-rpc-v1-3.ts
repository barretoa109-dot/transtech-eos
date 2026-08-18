import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import {
  buildFinancialConstitutionV1,
  financialConstitutionPolicyMaterial,
} from "../../lib/financial-autopilot/financial-constitution";
import { buildMultiProviderGlobalContextCommitFromPlan } from "../../lib/financial-autopilot/global-context-commit";
import { runMultiProviderScopedPersistenceScenario } from "../../lib/financial-autopilot/multi-provider-scoped-persistence-scenario";
import type { MultiProviderScopedPersistencePlan } from "../../lib/financial-autopilot/multi-provider-scoped-persistence";
import { sha256FinancialFingerprint } from "../../lib/financial-autopilot/persistence-fingerprint";
import { buildSourceCoverageEvidenceV1 } from "../../lib/financial-autopilot/source-coverage-evidence";
import {
  financialSourceCoverageRef,
  trustedFinancialSourceInventoryFingerprint,
  trustedFinancialSourceInventoryMaterial,
  type TrustedFinancialSourceInventory,
} from "../../lib/financial-autopilot/source-coverage";
import {
  buildFinancialReadConsentV1,
  financialReadConsentMaterial,
} from "../../lib/financial-autopilot/source-onboarding";

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
  "docs/financial-autopilot/PERSISTENCE_CONSTITUTION_RPC_V1_DRAFT.sql",
  "docs/financial-autopilot/PERSISTENCE_SOURCE_ONBOARDING_RPC_V1_DRAFT.sql",
  "docs/financial-autopilot/PERSISTENCE_SOURCE_COVERAGE_EVIDENCE_RPC_V1_DRAFT.sql",
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

type ConstitutionRpcResult = {
  constitutionId: string;
  version: number;
  policyFingerprint: string;
  replayed: boolean;
};

type SourceOnboardingRpcResult = {
  commitId: string;
  version: number;
  consentFingerprint: string;
  inventoryFingerprint: string;
  replayed: boolean;
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

async function persistConstitution(input: {
  database: PGlite;
  constitution: ReturnType<typeof buildFinancialConstitutionV1>;
  expectedCurrentVersion: number;
  userId?: string;
}) {
  const result = await input.database.query<{ result: ConstitutionRpcResult }>(
    `select public.eos_financial_persist_constitution_v1(
      $1::uuid, $2::jsonb, $3::text, $4::timestamptz, $5::integer
    ) as result`,
    [
      input.userId ?? OTHER_USER_ID,
      JSON.stringify(financialConstitutionPolicyMaterial(input.constitution)),
      input.constitution.policyFingerprint,
      input.constitution.confirmedAt,
      input.expectedCurrentVersion,
    ],
  );
  assert(result.rows[0]);
  return result.rows[0].result;
}

async function validateConstitutionPersistence(
  database: PGlite,
  userId: string,
) {
  const firstPolicy = buildFinancialConstitutionV1({
    currency: "PYG",
    protectedLiquidityMinor: 5_000_000,
    minimumSavingsRateBps: 1_500,
    debtPolicy: "PAY_CARD_FULL",
    primaryGoal: {
      id: "emergency-fund",
      label: "Fondo de emergencia",
      priority: "HIGH",
    },
    approvalThresholdMinor: 2_000_000,
    autonomyLevel: "RECOMMEND",
    confirmedAt: "2026-08-16T17:00:00.000-03:00",
  });
  const first = await persistConstitution({
    database,
    constitution: firstPolicy,
    expectedCurrentVersion: 0,
    userId,
  });
  assert.equal(first.version, 1);
  assert.equal(first.policyFingerprint, firstPolicy.policyFingerprint);
  assert.equal(first.replayed, false);

  await database.exec("set role service_role");
  const replay = await persistConstitution({
    database,
    constitution: firstPolicy,
    expectedCurrentVersion: 0,
    userId,
  });
  assert.equal(replay.constitutionId, first.constitutionId);
  assert.equal(replay.version, 1);
  assert.equal(replay.replayed, true);

  const secondPolicy = buildFinancialConstitutionV1({
    ...financialConstitutionPolicyMaterial(firstPolicy),
    protectedLiquidityMinor: 5_500_000,
    confirmedAt: "2026-08-16T18:00:00.000-03:00",
  });
  const second = await persistConstitution({
    database,
    constitution: secondPolicy,
    expectedCurrentVersion: 1,
    userId,
  });
  assert.equal(second.version, 2);
  assert.equal(second.replayed, false);

  const stalePolicy = buildFinancialConstitutionV1({
    ...financialConstitutionPolicyMaterial(secondPolicy),
    approvalThresholdMinor: 2_500_000,
    confirmedAt: "2026-08-16T19:00:00.000-03:00",
  });
  assert.equal(
    await rejectsMessage(
      () =>
        persistConstitution({
          database,
          constitution: stalePolicy,
          expectedCurrentVersion: 1,
          userId,
        }),
      "financial_constitution_version_conflict",
    ),
    "40001",
  );

  await database.exec("reset role");
  const rows = await database.query<{
    version: number;
    active: boolean;
    execution_authority: string;
  }>(`select
      version,
      superseded_at is null as active,
      policy ->> 'executionAuthorityMinor' as execution_authority
    from public.eos_financial_constitutions_v1
    where usuario_id = $1
    order by version`, [userId]);
  assert.deepEqual(rows.rows, [
    { version: 1, active: false, execution_authority: "0" },
    { version: 2, active: true, execution_authority: "0" },
  ]);

  const tamperedPolicy = {
    ...financialConstitutionPolicyMaterial(stalePolicy),
    executionAuthorityMinor: 1,
  };
  const tamperedFingerprint = `policy:${sha256FinancialFingerprint(tamperedPolicy)}`;
  await database.exec("set role service_role");
  assert.equal(
    await rejectsMessage(
      () =>
        database.query(
          `select public.eos_financial_persist_constitution_v1(
            $1::uuid, $2::jsonb, $3::text, $4::timestamptz, $5::integer
          )`,
          [
            userId,
            JSON.stringify(tamperedPolicy),
            tamperedFingerprint,
            tamperedPolicy.confirmedAt,
            2,
          ],
        ),
      "financial_constitution_invalid_policy_amounts",
    ),
    "22023",
  );
  await database.exec("reset role");
  return firstPolicy;
}

async function validateSourceOnboardingPersistence(database: PGlite, userId: string) {
  const consent = buildFinancialReadConsentV1({
    trustedUserId: userId,
    providerKey: "mock-source-onboarding",
    grantedAt: "2026-08-16T20:00:00.000-03:00",
    validUntil: "2026-09-16T20:00:00.000-03:00",
    readScopes: ["ACCOUNTS_READ", "BALANCES_READ", "LIABILITIES_READ", "TRANSACTIONS_READ"],
  });
  const inventory: TrustedFinancialSourceInventory = {
    version: "trusted-financial-source-inventory-v1",
    userId,
    asOf: "2026-08-16T20:05:00.000-03:00",
    validUntil: "2026-08-18T20:05:00.000-03:00",
    authority: "user_confirmed",
    scope: "global_user_finances",
    discoveryComplete: true,
    confidence: 0.98,
    unresolvedMaterialSourceCount: 0,
    expectedSources: [{
      sourceRef: financialSourceCoverageRef({ userId, providerKey: "mock-source-onboarding", connectionId: "connection-1", externalAccountId: "account-1" }),
      materiality: "critical",
      confidence: 0.99,
    }],
  };
  const persistOnboarding = async (expectedVersion: number, value = inventory) => {
    const result = await database.query<{ result: SourceOnboardingRpcResult }>(
      `select public.eos_financial_persist_source_onboarding_v1(
        $1::uuid,$2::jsonb,$3::text,$4::jsonb,$5::text,$6::integer
      ) as result`,
      [userId, JSON.stringify(financialReadConsentMaterial(consent)), consent.fingerprint, JSON.stringify(trustedFinancialSourceInventoryMaterial(value)), trustedFinancialSourceInventoryFingerprint(value), expectedVersion],
    );
    assert(result.rows[0]);
    return result.rows[0].result;
  };

  await database.exec("set role service_role");
  const first = await persistOnboarding(0);
  assert.equal(first.version, 1);
  assert.equal(first.replayed, false);
  const replay = await persistOnboarding(0);
  assert.equal(replay.commitId, first.commitId);
  assert.equal(replay.replayed, true);

  const changedInventory = { ...inventory, asOf: "2026-08-16T20:10:00.000-03:00", validUntil: "2026-08-18T20:10:00.000-03:00" };
  const second = await persistOnboarding(1, changedInventory);
  assert.equal(second.version, 2);
  assert.equal(second.replayed, false);
  assert.equal(await rejectsMessage(() => persistOnboarding(1, { ...changedInventory, confidence: 0.97 }), "financial_source_onboarding_version_conflict"), "40001");

  await database.exec("reset role");
  const rows = await database.query<{ version: number; active: boolean; movement: boolean }>(
    `select version, superseded_at is null as active,
      (consent ->> 'movementAuthority')::boolean as movement
     from public.eos_financial_source_onboarding_commits_v1
     where usuario_id = $1 order by version`, [userId],
  );
  assert.deepEqual(rows.rows, [
    { version: 1, active: false, movement: false },
    { version: 2, active: true, movement: false },
  ]);

  await database.exec("set role authenticated");
  await rejectsMessage(() => persistOnboarding(1), "permission denied for function eos_financial_persist_source_onboarding_v1");
  await rejectsMessage(() => database.query("select * from public.eos_financial_source_onboarding_commits_v1"), "permission denied for table eos_financial_source_onboarding_commits_v1");
  await database.exec("reset role");
}

async function validateCoverageEvidencePersistence(database: PGlite, userId: string) {
  const inventoryFingerprint = "b".repeat(64);
  const evidence = buildSourceCoverageEvidenceV1({
    trustedUserId: userId,
    inventoryFingerprint,
    resolvedAt: "2026-08-16T21:00:00.000-03:00",
    validUntil: "2026-08-18T21:00:00.000-03:00",
    resolution: {
      criticalSourcesComplete: true,
      criticalSourcesFresh: true,
      expectedMaterialCount: 2,
      connectedMaterialCount: 2,
      missingMaterialCount: 0,
      staleConnectedSourceCount: 0,
      connectedSourceCount: 2,
      reasonCodes: [],
      freshnessReasonCodes: [],
      inventoryFingerprint,
      coverageValidUntil: "2026-08-19T00:00:00.000Z",
    },
  });
  const persistEvidence = async (value = evidence) => {
    const result = await database.query<{ result: { evidenceId: string; evidenceFingerprint: string; replayed: boolean } }>(
      "select public.eos_financial_persist_source_coverage_evidence_v1($1::uuid,$2::jsonb,$3::text) as result",
      [userId, JSON.stringify(value), value.fingerprint],
    );
    assert(result.rows[0]);
    return result.rows[0].result;
  };
  await database.exec("set role service_role");
  const first = await persistEvidence();
  assert.equal(first.replayed, false);
  const replay = await persistEvidence();
  assert.equal(replay.evidenceId, first.evidenceId);
  assert.equal(replay.replayed, true);
  const tampered = { ...evidence, connectedMaterialCount: 1 };
  assert.equal(await rejectsMessage(() => persistEvidence(tampered), "financial_coverage_evidence_fingerprint_mismatch"), "22023");
  await database.exec("reset role; set role authenticated");
  await rejectsMessage(() => persistEvidence(), "permission denied for function eos_financial_persist_source_coverage_evidence_v1");
  await rejectsMessage(() => database.query("select * from public.eos_financial_source_coverage_evidence_v1"), "permission denied for table eos_financial_source_coverage_evidence_v1");
  await database.exec("reset role");
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

  const constitution = await validateConstitutionPersistence(
    database,
    healthy.userId,
  );
  await validateSourceOnboardingPersistence(database, healthy.userId);
  await validateCoverageEvidencePersistence(database, healthy.userId);

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
      persistConstitution({
        database,
        constitution,
        expectedCurrentVersion: 0,
        userId: healthy.userId,
      }),
    "permission denied for function eos_financial_persist_constitution_v1",
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
      persistConstitution({
        database,
        constitution,
        expectedCurrentVersion: 0,
        userId: healthy.userId,
      }),
    "permission denied for function eos_financial_persist_constitution_v1",
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
          'eos_financial_multi_provider_plans_v1_3',
          'eos_financial_source_onboarding_commits_v1'
        )
        and grantee in ('PUBLIC', 'anon', 'authenticated')) +
    (select count(*) from information_schema.routine_privileges
      where routine_schema = 'public'
        and routine_name in (
          'eos_financial_persist_multi_provider_v1_3',
          'eos_financial_persist_constitution_v1',
          'eos_financial_persist_source_onboarding_v1'
        )
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
        constitutionFingerprintVerifiedByPostgres: true,
        constitutionExactReplayNoOp: true,
        constitutionVersionCas: true,
        constitutionServiceRoleOnly: true,
        constitutionExecutionAuthorityFixedToZero: true,
        sourceOnboardingFingerprintVerifiedByPostgres: true,
        sourceOnboardingExactReplayNoOp: true,
        sourceOnboardingVersionCas: true,
        sourceOnboardingServiceRoleOnly: true,
        sourceOnboardingMovementAuthorityFixedToFalse: true,
        coverageEvidenceFingerprintVerifiedByPostgres: true,
        coverageEvidenceExactReplayNoOp: true,
        coverageEvidenceTamperRejected: true,
        coverageEvidenceServiceRoleOnly: true,
      },
    }),
  );
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
