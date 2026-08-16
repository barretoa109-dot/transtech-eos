-- EOS Financial Autopilot — atomic persistence RPC v1
-- DESIGN ONLY. DO NOT APPLY TO PRODUCTION DURING EOS 4.0 RC1 FREEZE.
-- Depends on SCHEMA_V1_DRAFT.sql and intentionally has no production migration wrapper.
--
-- Contract:
--   Connection -> Accounts -> Immutable Ingestion -> Canonical Ledger
--   -> Reconciliation -> Recurrences -> Obligations -> Financial Context
--
-- Security:
--   * service/server only;
--   * browser roles receive no EXECUTE grant;
--   * p_usuario_id comes from the authenticated server boundary, never client JSON;
--   * one function invocation is one PostgreSQL transaction;
--   * Financial Context is the commit marker and is inserted last;
--   * identity/fingerprint fields are compact lowercase SHA-256 strings generated
--     by the trusted server persistence plan.

create or replace function public.eos_financial_persist_snapshot_v1(
  p_usuario_id uuid,
  p_batch jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_version text;
  v_provider_key text;
  v_context jsonb;
  v_context_revision text;
  v_context_fingerprint text;

  v_connection jsonb;
  v_account jsonb;
  v_event jsonb;
  v_ledger jsonb;
  v_reconciliation jsonb;
  v_recurrence jsonb;
  v_obligation jsonb;

  v_connection_id uuid;
  v_account_id uuid;
  v_source_event_id uuid;
  v_recurrence_id uuid;
  v_reconciliation_entry_ids uuid[];
  v_recurrence_source_ids uuid[];
  v_expected_evidence_count integer;
  v_row_count integer;

  v_existing_context public.eos_financial_contexts_v1%rowtype;
  v_existing_event public.eos_financial_ingestion_events_v1%rowtype;

  v_ingestion_touched integer := 0;
  v_ledger_touched integer := 0;
  v_reconciliation_touched integer := 0;
begin
  if p_usuario_id is null then
    raise exception using errcode = '22023', message = 'financial_persistence_missing_user';
  end if;

  if p_batch is null or jsonb_typeof(p_batch) <> 'object' then
    raise exception using errcode = '22023', message = 'financial_persistence_invalid_batch';
  end if;

  v_version := p_batch ->> 'version';
  if v_version <> 'financial-persistence-plan-v1' then
    raise exception using errcode = '22023', message = 'financial_persistence_unsupported_version';
  end if;

  if nullif(p_batch ->> 'userId', '')::uuid is distinct from p_usuario_id then
    raise exception using errcode = '42501', message = 'financial_persistence_user_mismatch';
  end if;

  v_provider_key := nullif(p_batch ->> 'providerKey', '');
  if v_provider_key is null then
    raise exception using errcode = '22023', message = 'financial_persistence_missing_provider';
  end if;

  v_context := p_batch -> 'contextInsert';
  if v_context is null or jsonb_typeof(v_context) <> 'object' then
    raise exception using errcode = '22023', message = 'financial_persistence_missing_context';
  end if;

  if nullif(v_context ->> 'userId', '')::uuid is distinct from p_usuario_id then
    raise exception using errcode = '42501', message = 'financial_context_user_mismatch';
  end if;

  v_context_revision := nullif(v_context ->> 'revision', '');
  v_context_fingerprint := nullif(v_context ->> 'sourceFingerprint', '');

  if v_context_fingerprint is null
     or v_context_fingerprint !~ '^[0-9a-f]{64}$'
     or v_context_revision is distinct from ('ctx:' || v_context_fingerprint) then
    raise exception using errcode = '22023', message = 'financial_persistence_invalid_context_identity';
  end if;

  -- Exact replay is a true no-op. Exit before touching mutable source rows.
  select *
    into v_existing_context
    from public.eos_financial_contexts_v1 c
   where c.usuario_id = p_usuario_id
     and c.source_fingerprint = v_context_fingerprint;

  if found then
    if v_existing_context.revision <> v_context_revision then
      raise exception using errcode = '23505', message = 'financial_context_fingerprint_revision_mismatch';
    end if;

    return jsonb_build_object(
      'replayed', true,
      'contextRevision', v_existing_context.revision,
      'ingestionRowsTouched', 0,
      'ledgerRowsTouched', 0,
      'reconciliationRowsTouched', 0
    );
  end if;

  -- 1. Connection state. Credentials/tokens are deliberately absent from this payload.
  for v_connection in
    select value
      from jsonb_array_elements(coalesce(p_batch -> 'connectionUpserts', '[]'::jsonb))
  loop
    if nullif(v_connection ->> 'userId', '')::uuid is distinct from p_usuario_id then
      raise exception using errcode = '42501', message = 'financial_connection_user_mismatch';
    end if;

    if v_connection ->> 'providerKey' is distinct from v_provider_key then
      raise exception using errcode = '22023', message = 'financial_connection_provider_mismatch';
    end if;

    insert into public.eos_financial_connections_v1 (
      usuario_id,
      provider_key,
      connection_key,
      connection_type,
      country,
      status,
      last_sync_at,
      last_success_at,
      fresh_until,
      health
    ) values (
      p_usuario_id,
      v_provider_key,
      v_connection ->> 'connectionKey',
      v_connection ->> 'connectionType',
      coalesce(nullif(v_connection ->> 'country', ''), 'PY'),
      v_connection ->> 'status',
      nullif(v_connection ->> 'lastSyncAt', '')::timestamptz,
      nullif(v_connection ->> 'lastSuccessAt', '')::timestamptz,
      nullif(v_connection ->> 'freshUntil', '')::timestamptz,
      v_connection ->> 'health'
    )
    on conflict (usuario_id, provider_key, connection_key)
    do update set
      connection_type = excluded.connection_type,
      country = excluded.country,
      status = excluded.status,
      last_sync_at = excluded.last_sync_at,
      last_success_at = excluded.last_success_at,
      fresh_until = excluded.fresh_until,
      health = excluded.health,
      updated_at = now()
    where (
      eos_financial_connections_v1.connection_type,
      eos_financial_connections_v1.country,
      eos_financial_connections_v1.status,
      eos_financial_connections_v1.last_sync_at,
      eos_financial_connections_v1.last_success_at,
      eos_financial_connections_v1.fresh_until,
      eos_financial_connections_v1.health
    ) is distinct from (
      excluded.connection_type,
      excluded.country,
      excluded.status,
      excluded.last_sync_at,
      excluded.last_success_at,
      excluded.fresh_until,
      excluded.health
    );
  end loop;

  -- 2. Normalized accounts.
  for v_account in
    select value
      from jsonb_array_elements(coalesce(p_batch -> 'accountUpserts', '[]'::jsonb))
  loop
    if nullif(v_account ->> 'userId', '')::uuid is distinct from p_usuario_id then
      raise exception using errcode = '42501', message = 'financial_account_user_mismatch';
    end if;

    select c.id
      into v_connection_id
      from public.eos_financial_connections_v1 c
     where c.usuario_id = p_usuario_id
       and c.provider_key = v_provider_key
       and c.connection_key = v_account ->> 'connectionKey';

    if v_connection_id is null then
      raise exception using errcode = '23503', message = 'financial_account_connection_missing';
    end if;

    insert into public.eos_financial_accounts_v1 (
      usuario_id,
      connection_id,
      external_account_id,
      account_type,
      institution_name,
      display_name,
      currency,
      ownership,
      available_balance_minor,
      ledger_balance_minor,
      balance_as_of,
      fresh_until,
      status
    ) values (
      p_usuario_id,
      v_connection_id,
      v_account ->> 'externalAccountId',
      v_account ->> 'accountType',
      nullif(v_account ->> 'institutionName', ''),
      nullif(v_account ->> 'displayName', ''),
      v_account ->> 'currency',
      v_account ->> 'ownership',
      nullif(v_account ->> 'availableBalanceMinor', '')::bigint,
      nullif(v_account ->> 'ledgerBalanceMinor', '')::bigint,
      nullif(v_account ->> 'balanceAsOf', '')::timestamptz,
      nullif(v_account ->> 'freshUntil', '')::timestamptz,
      v_account ->> 'status'
    )
    on conflict (usuario_id, connection_id, external_account_id)
    do update set
      account_type = excluded.account_type,
      institution_name = excluded.institution_name,
      display_name = excluded.display_name,
      currency = excluded.currency,
      ownership = excluded.ownership,
      available_balance_minor = excluded.available_balance_minor,
      ledger_balance_minor = excluded.ledger_balance_minor,
      balance_as_of = excluded.balance_as_of,
      fresh_until = excluded.fresh_until,
      status = excluded.status,
      updated_at = now()
    where (
      eos_financial_accounts_v1.account_type,
      eos_financial_accounts_v1.institution_name,
      eos_financial_accounts_v1.display_name,
      eos_financial_accounts_v1.currency,
      eos_financial_accounts_v1.ownership,
      eos_financial_accounts_v1.available_balance_minor,
      eos_financial_accounts_v1.ledger_balance_minor,
      eos_financial_accounts_v1.balance_as_of,
      eos_financial_accounts_v1.fresh_until,
      eos_financial_accounts_v1.status
    ) is distinct from (
      excluded.account_type,
      excluded.institution_name,
      excluded.display_name,
      excluded.currency,
      excluded.ownership,
      excluded.available_balance_minor,
      excluded.ledger_balance_minor,
      excluded.balance_as_of,
      excluded.fresh_until,
      excluded.status
    );
  end loop;

  -- 3. Immutable ingestion. Exact replay is allowed; same immutable event identity
  -- with different SHA-256 material fails closed.
  for v_event in
    select value
      from jsonb_array_elements(coalesce(p_batch -> 'ingestionEventUpserts', '[]'::jsonb))
  loop
    if nullif(v_event ->> 'userId', '')::uuid is distinct from p_usuario_id then
      raise exception using errcode = '42501', message = 'financial_ingestion_user_mismatch';
    end if;

    if v_event ->> 'providerKey' is distinct from v_provider_key then
      raise exception using errcode = '22023', message = 'financial_ingestion_provider_mismatch';
    end if;

    if coalesce(v_event ->> 'sourceFingerprint', '') !~ '^[0-9a-f]{64}$'
       or coalesce(v_event ->> 'payloadHash', '') !~ '^[0-9a-f]{64}$' then
      raise exception using errcode = '22023', message = 'financial_ingestion_invalid_sha256';
    end if;

    select c.id
      into v_connection_id
      from public.eos_financial_connections_v1 c
     where c.usuario_id = p_usuario_id
       and c.provider_key = v_provider_key
       and c.connection_key = v_event ->> 'connectionKey';

    select a.id
      into v_account_id
      from public.eos_financial_accounts_v1 a
     where a.usuario_id = p_usuario_id
       and a.connection_id = v_connection_id
       and a.external_account_id = v_event ->> 'accountExternalId';

    if v_connection_id is null or v_account_id is null then
      raise exception using errcode = '23503', message = 'financial_ingestion_parent_missing';
    end if;

    select e.*
      into v_existing_event
      from public.eos_financial_ingestion_events_v1 e
     where e.usuario_id = p_usuario_id
       and e.provider_key = v_provider_key
       and e.connection_id = v_connection_id
       and e.external_event_id = v_event ->> 'externalEventId';

    if found then
      if v_existing_event.source_fingerprint <> v_event ->> 'sourceFingerprint'
         or v_existing_event.payload_hash <> v_event ->> 'payloadHash'
         or v_existing_event.account_id is distinct from v_account_id then
        raise exception using errcode = '23505', message = 'financial_ingestion_replay_mismatch';
      end if;
    else
      -- A source fingerprint may not silently migrate to another event identity.
      if exists (
        select 1
          from public.eos_financial_ingestion_events_v1 e
         where e.usuario_id = p_usuario_id
           and e.provider_key = v_provider_key
           and e.source_fingerprint = v_event ->> 'sourceFingerprint'
      ) then
        raise exception using errcode = '23505', message = 'financial_ingestion_fingerprint_reused';
      end if;

      insert into public.eos_financial_ingestion_events_v1 (
        usuario_id,
        connection_id,
        account_id,
        provider_key,
        external_event_id,
        event_type,
        provider_status,
        occurred_at,
        received_at,
        payload_hash,
        source_fingerprint,
        metadata
      ) values (
        p_usuario_id,
        v_connection_id,
        v_account_id,
        v_provider_key,
        v_event ->> 'externalEventId',
        v_event ->> 'eventType',
        v_event ->> 'providerStatus',
        nullif(v_event ->> 'occurredAt', '')::timestamptz,
        nullif(v_event ->> 'receivedAt', '')::timestamptz,
        v_event ->> 'payloadHash',
        v_event ->> 'sourceFingerprint',
        jsonb_build_object('sourceEventKey', v_event ->> 'sourceEventKey')
      );

      v_ingestion_touched := v_ingestion_touched + 1;
    end if;
  end loop;

  -- 4. Canonical Ledger. Compact canonical keys are scoped by provider + connection
  -- + external account on the trusted server before reaching this RPC.
  for v_ledger in
    select value
      from jsonb_array_elements(coalesce(p_batch -> 'ledgerUpserts', '[]'::jsonb))
  loop
    if nullif(v_ledger ->> 'userId', '')::uuid is distinct from p_usuario_id then
      raise exception using errcode = '42501', message = 'financial_ledger_user_mismatch';
    end if;

    if v_ledger ->> 'providerKey' is distinct from v_provider_key then
      raise exception using errcode = '22023', message = 'financial_ledger_provider_mismatch';
    end if;

    if coalesce(v_ledger ->> 'canonicalKey', '') !~ '^(ext|src|fp):[0-9a-f]{64}$' then
      raise exception using errcode = '22023', message = 'financial_ledger_invalid_canonical_key';
    end if;

    select c.id
      into v_connection_id
      from public.eos_financial_connections_v1 c
     where c.usuario_id = p_usuario_id
       and c.provider_key = v_provider_key
       and c.connection_key = v_ledger ->> 'connectionKey';

    select a.id
      into v_account_id
      from public.eos_financial_accounts_v1 a
     where a.usuario_id = p_usuario_id
       and a.connection_id = v_connection_id
       and a.external_account_id = v_ledger ->> 'accountExternalId';

    select e.id
      into v_source_event_id
      from public.eos_financial_ingestion_events_v1 e
     where e.usuario_id = p_usuario_id
       and e.provider_key = v_provider_key
       and e.connection_id = v_connection_id
       and e.account_id = v_account_id
       and e.external_event_id = v_ledger ->> 'sourceEventKey';

    if v_connection_id is null or v_account_id is null or v_source_event_id is null then
      raise exception using errcode = '23503', message = 'financial_ledger_source_missing';
    end if;

    insert into public.eos_financial_ledger_v1 (
      usuario_id,
      account_id,
      source_event_id,
      canonical_key,
      external_transaction_id,
      transaction_type,
      direction,
      status,
      amount_minor,
      currency,
      occurred_at,
      posted_at,
      description_raw,
      merchant_normalized,
      category,
      subcategory,
      counterparty_ref,
      confidence,
      provenance
    ) values (
      p_usuario_id,
      v_account_id,
      v_source_event_id,
      v_ledger ->> 'canonicalKey',
      nullif(v_ledger ->> 'externalTransactionId', ''),
      v_ledger ->> 'transactionType',
      v_ledger ->> 'direction',
      v_ledger ->> 'status',
      (v_ledger ->> 'amountMinor')::bigint,
      v_ledger ->> 'currency',
      (v_ledger ->> 'occurredAt')::timestamptz,
      nullif(v_ledger ->> 'postedAt', '')::timestamptz,
      nullif(v_ledger ->> 'descriptionRaw', ''),
      nullif(v_ledger ->> 'merchantNormalized', ''),
      nullif(v_ledger ->> 'category', ''),
      nullif(v_ledger ->> 'subcategory', ''),
      nullif(v_ledger ->> 'counterpartyRef', ''),
      (v_ledger ->> 'confidence')::numeric,
      v_ledger ->> 'provenance'
    )
    on conflict (usuario_id, canonical_key)
    do update set
      account_id = excluded.account_id,
      source_event_id = excluded.source_event_id,
      external_transaction_id = excluded.external_transaction_id,
      transaction_type = excluded.transaction_type,
      direction = excluded.direction,
      status = excluded.status,
      amount_minor = excluded.amount_minor,
      currency = excluded.currency,
      occurred_at = excluded.occurred_at,
      posted_at = excluded.posted_at,
      description_raw = excluded.description_raw,
      merchant_normalized = excluded.merchant_normalized,
      category = excluded.category,
      subcategory = excluded.subcategory,
      counterparty_ref = excluded.counterparty_ref,
      confidence = excluded.confidence,
      provenance = excluded.provenance,
      updated_at = now()
    where (
      eos_financial_ledger_v1.account_id,
      eos_financial_ledger_v1.source_event_id,
      eos_financial_ledger_v1.external_transaction_id,
      eos_financial_ledger_v1.transaction_type,
      eos_financial_ledger_v1.direction,
      eos_financial_ledger_v1.status,
      eos_financial_ledger_v1.amount_minor,
      eos_financial_ledger_v1.currency,
      eos_financial_ledger_v1.occurred_at,
      eos_financial_ledger_v1.posted_at,
      eos_financial_ledger_v1.description_raw,
      eos_financial_ledger_v1.merchant_normalized,
      eos_financial_ledger_v1.category,
      eos_financial_ledger_v1.subcategory,
      eos_financial_ledger_v1.counterparty_ref,
      eos_financial_ledger_v1.confidence,
      eos_financial_ledger_v1.provenance
    ) is distinct from (
      excluded.account_id,
      excluded.source_event_id,
      excluded.external_transaction_id,
      excluded.transaction_type,
      excluded.direction,
      excluded.status,
      excluded.amount_minor,
      excluded.currency,
      excluded.occurred_at,
      excluded.posted_at,
      excluded.description_raw,
      excluded.merchant_normalized,
      excluded.category,
      excluded.subcategory,
      excluded.counterparty_ref,
      excluded.confidence,
      excluded.provenance
    );

    get diagnostics v_row_count = row_count;
    v_ledger_touched := v_ledger_touched + v_row_count;
  end loop;

  -- Resolve explicit reversal links only after all canonical Ledger rows exist.
  for v_ledger in
    select value
      from jsonb_array_elements(coalesce(p_batch -> 'ledgerUpserts', '[]'::jsonb))
  loop
    if nullif(v_ledger ->> 'reversalCanonicalKey', '') is not null then
      if coalesce(v_ledger ->> 'reversalCanonicalKey', '') !~ '^(ext|src|fp):[0-9a-f]{64}$' then
        raise exception using errcode = '22023', message = 'financial_reversal_invalid_canonical_key';
      end if;

      update public.eos_financial_ledger_v1 target
         set reversal_of = original.id,
             updated_at = now()
        from public.eos_financial_ledger_v1 original
       where target.usuario_id = p_usuario_id
         and target.canonical_key = v_ledger ->> 'canonicalKey'
         and original.usuario_id = p_usuario_id
         and original.canonical_key = v_ledger ->> 'reversalCanonicalKey'
         and target.reversal_of is distinct from original.id;

      if not found and not exists (
        select 1
          from public.eos_financial_ledger_v1 target
          join public.eos_financial_ledger_v1 original
            on original.usuario_id = target.usuario_id
           and original.canonical_key = v_ledger ->> 'reversalCanonicalKey'
         where target.usuario_id = p_usuario_id
           and target.canonical_key = v_ledger ->> 'canonicalKey'
           and target.reversal_of = original.id
      ) then
        raise exception using errcode = '23503', message = 'financial_reversal_source_missing';
      end if;
    end if;
  end loop;

  -- 5. Immutable reconciliation evidence.
  for v_reconciliation in
    select value
      from jsonb_array_elements(coalesce(p_batch -> 'reconciliationInserts', '[]'::jsonb))
  loop
    if nullif(v_reconciliation ->> 'userId', '')::uuid is distinct from p_usuario_id then
      raise exception using errcode = '42501', message = 'financial_reconciliation_user_mismatch';
    end if;

    if coalesce(v_reconciliation ->> 'signature', '') !~ '^[0-9a-f]{64}$' then
      raise exception using errcode = '22023', message = 'financial_reconciliation_invalid_signature';
    end if;

    if jsonb_typeof(v_reconciliation -> 'ledgerCanonicalKeys') <> 'array' then
      raise exception using errcode = '22023', message = 'financial_reconciliation_invalid_evidence';
    end if;

    v_expected_evidence_count := jsonb_array_length(v_reconciliation -> 'ledgerCanonicalKeys');

    select coalesce(array_agg(l.id order by l.canonical_key), '{}'::uuid[])
      into v_reconciliation_entry_ids
      from public.eos_financial_ledger_v1 l
     where l.usuario_id = p_usuario_id
       and l.canonical_key in (
         select jsonb_array_elements_text(v_reconciliation -> 'ledgerCanonicalKeys')
       );

    if coalesce(array_length(v_reconciliation_entry_ids, 1), 0) <> v_expected_evidence_count then
      raise exception using errcode = '23503', message = 'financial_reconciliation_evidence_missing';
    end if;

    insert into public.eos_financial_reconciliations_v1 (
      usuario_id,
      signature,
      reconciliation_type,
      ledger_entry_ids,
      decision,
      confidence,
      matched_amount_minor,
      reason_code,
      rule_version
    ) values (
      p_usuario_id,
      v_reconciliation ->> 'signature',
      v_reconciliation ->> 'reconciliationType',
      v_reconciliation_entry_ids,
      v_reconciliation ->> 'decision',
      (v_reconciliation ->> 'confidence')::numeric,
      nullif(v_reconciliation ->> 'matchedAmountMinor', '')::bigint,
      v_reconciliation ->> 'reasonCode',
      v_reconciliation ->> 'ruleVersion'
    )
    on conflict (usuario_id, signature) do nothing;

    get diagnostics v_row_count = row_count;
    v_reconciliation_touched := v_reconciliation_touched + v_row_count;
  end loop;

  -- 6. Recurrences, resolving canonical Ledger evidence to durable UUIDs.
  for v_recurrence in
    select value
      from jsonb_array_elements(coalesce(p_batch -> 'recurrenceUpserts', '[]'::jsonb))
  loop
    if nullif(v_recurrence ->> 'userId', '')::uuid is distinct from p_usuario_id then
      raise exception using errcode = '42501', message = 'financial_recurrence_user_mismatch';
    end if;

    if jsonb_typeof(v_recurrence -> 'sourceLedgerCanonicalKeys') <> 'array' then
      raise exception using errcode = '22023', message = 'financial_recurrence_invalid_evidence';
    end if;

    v_expected_evidence_count := jsonb_array_length(v_recurrence -> 'sourceLedgerCanonicalKeys');

    select coalesce(array_agg(l.id order by l.canonical_key), '{}'::uuid[])
      into v_recurrence_source_ids
      from public.eos_financial_ledger_v1 l
     where l.usuario_id = p_usuario_id
       and l.canonical_key in (
         select jsonb_array_elements_text(v_recurrence -> 'sourceLedgerCanonicalKeys')
       );

    if coalesce(array_length(v_recurrence_source_ids, 1), 0) <> v_expected_evidence_count then
      raise exception using errcode = '23503', message = 'financial_recurrence_evidence_missing';
    end if;

    insert into public.eos_financial_recurrences_v1 (
      usuario_id,
      recurrence_key,
      kind,
      direction,
      cadence,
      expected_amount_minor,
      amount_min_minor,
      amount_max_minor,
      currency,
      next_expected_at,
      essentiality,
      confidence,
      status,
      source_entry_ids
    ) values (
      p_usuario_id,
      v_recurrence ->> 'recurrenceKey',
      v_recurrence ->> 'kind',
      v_recurrence ->> 'direction',
      v_recurrence ->> 'cadence',
      (v_recurrence ->> 'expectedAmountMinor')::bigint,
      (v_recurrence ->> 'amountMinMinor')::bigint,
      (v_recurrence ->> 'amountMaxMinor')::bigint,
      v_recurrence ->> 'currency',
      (v_recurrence ->> 'nextExpectedAt')::timestamptz,
      v_recurrence ->> 'essentiality',
      (v_recurrence ->> 'confidence')::numeric,
      v_recurrence ->> 'status',
      v_recurrence_source_ids
    )
    on conflict (usuario_id, recurrence_key)
    do update set
      kind = excluded.kind,
      direction = excluded.direction,
      cadence = excluded.cadence,
      expected_amount_minor = excluded.expected_amount_minor,
      amount_min_minor = excluded.amount_min_minor,
      amount_max_minor = excluded.amount_max_minor,
      currency = excluded.currency,
      next_expected_at = excluded.next_expected_at,
      essentiality = excluded.essentiality,
      confidence = excluded.confidence,
      status = excluded.status,
      source_entry_ids = excluded.source_entry_ids,
      updated_at = now()
    where (
      eos_financial_recurrences_v1.kind,
      eos_financial_recurrences_v1.direction,
      eos_financial_recurrences_v1.cadence,
      eos_financial_recurrences_v1.expected_amount_minor,
      eos_financial_recurrences_v1.amount_min_minor,
      eos_financial_recurrences_v1.amount_max_minor,
      eos_financial_recurrences_v1.currency,
      eos_financial_recurrences_v1.next_expected_at,
      eos_financial_recurrences_v1.essentiality,
      eos_financial_recurrences_v1.confidence,
      eos_financial_recurrences_v1.status,
      eos_financial_recurrences_v1.source_entry_ids
    ) is distinct from (
      excluded.kind,
      excluded.direction,
      excluded.cadence,
      excluded.expected_amount_minor,
      excluded.amount_min_minor,
      excluded.amount_max_minor,
      excluded.currency,
      excluded.next_expected_at,
      excluded.essentiality,
      excluded.confidence,
      excluded.status,
      excluded.source_entry_ids
    );
  end loop;

  -- 7. Obligations.
  for v_obligation in
    select value
      from jsonb_array_elements(coalesce(p_batch -> 'obligationUpserts', '[]'::jsonb))
  loop
    if nullif(v_obligation ->> 'userId', '')::uuid is distinct from p_usuario_id then
      raise exception using errcode = '42501', message = 'financial_obligation_user_mismatch';
    end if;

    v_recurrence_id := null;
    if nullif(v_obligation ->> 'recurrenceKey', '') is not null then
      select r.id
        into v_recurrence_id
        from public.eos_financial_recurrences_v1 r
       where r.usuario_id = p_usuario_id
         and r.recurrence_key = v_obligation ->> 'recurrenceKey';

      if v_recurrence_id is null then
        raise exception using errcode = '23503', message = 'financial_obligation_recurrence_missing';
      end if;
    end if;

    insert into public.eos_financial_obligations_v1 (
      usuario_id,
      source_key,
      recurrence_id,
      obligation_type,
      amount_minor,
      currency,
      due_at,
      source,
      confidence,
      priority,
      must_protect,
      status
    ) values (
      p_usuario_id,
      v_obligation ->> 'sourceKey',
      v_recurrence_id,
      v_obligation ->> 'obligationType',
      (v_obligation ->> 'amountMinor')::bigint,
      v_obligation ->> 'currency',
      (v_obligation ->> 'dueAt')::timestamptz,
      v_obligation ->> 'source',
      (v_obligation ->> 'confidence')::numeric,
      (v_obligation ->> 'priority')::integer,
      (v_obligation ->> 'mustProtect')::boolean,
      v_obligation ->> 'status'
    )
    on conflict (usuario_id, source_key)
    do update set
      recurrence_id = excluded.recurrence_id,
      obligation_type = excluded.obligation_type,
      amount_minor = excluded.amount_minor,
      currency = excluded.currency,
      due_at = excluded.due_at,
      source = excluded.source,
      confidence = excluded.confidence,
      priority = excluded.priority,
      must_protect = excluded.must_protect,
      status = excluded.status,
      updated_at = now()
    where (
      eos_financial_obligations_v1.recurrence_id,
      eos_financial_obligations_v1.obligation_type,
      eos_financial_obligations_v1.amount_minor,
      eos_financial_obligations_v1.currency,
      eos_financial_obligations_v1.due_at,
      eos_financial_obligations_v1.source,
      eos_financial_obligations_v1.confidence,
      eos_financial_obligations_v1.priority,
      eos_financial_obligations_v1.must_protect,
      eos_financial_obligations_v1.status
    ) is distinct from (
      excluded.recurrence_id,
      excluded.obligation_type,
      excluded.amount_minor,
      excluded.currency,
      excluded.due_at,
      excluded.source,
      excluded.confidence,
      excluded.priority,
      excluded.must_protect,
      excluded.status
    );
  end loop;

  -- 8. Financial Context is the atomic commit marker and therefore comes last.
  insert into public.eos_financial_contexts_v1 (
    usuario_id,
    revision,
    currency,
    status,
    horizon_until,
    horizon_reason,
    liquidity_usable_minor,
    protected_commitments_minor,
    essential_spend_expected_minor,
    protected_reserve_minor,
    critical_provisions_minor,
    confirmed_income_minor,
    uncertainty_buffer_minor,
    available_real_safe_minor,
    minimum_projected_cash_minor,
    minimum_projected_cash_at,
    confidence,
    explanation_refs,
    sources_fresh,
    source_fingerprint,
    generated_at,
    valid_until
  ) values (
    p_usuario_id,
    v_context_revision,
    v_context ->> 'currency',
    v_context ->> 'status',
    (v_context ->> 'horizonUntil')::timestamptz,
    v_context ->> 'horizonReason',
    (v_context ->> 'liquidityUsableMinor')::bigint,
    (v_context ->> 'protectedCommitmentsMinor')::bigint,
    (v_context ->> 'essentialSpendExpectedMinor')::bigint,
    (v_context ->> 'protectedReserveMinor')::bigint,
    (v_context ->> 'criticalProvisionsMinor')::bigint,
    (v_context ->> 'confirmedIncomeMinor')::bigint,
    (v_context ->> 'uncertaintyBufferMinor')::bigint,
    (v_context ->> 'availableRealSafeMinor')::bigint,
    nullif(v_context ->> 'minimumProjectedCashMinor', '')::bigint,
    nullif(v_context ->> 'minimumProjectedCashAt', '')::timestamptz,
    v_context -> 'confidence',
    coalesce(v_context -> 'explanationRefs', '[]'::jsonb),
    (v_context ->> 'sourcesFresh')::boolean,
    v_context_fingerprint,
    (v_context ->> 'generatedAt')::timestamptz,
    nullif(v_context ->> 'validUntil', '')::timestamptz
  );

  return jsonb_build_object(
    'replayed', false,
    'contextRevision', v_context_revision,
    'ingestionRowsTouched', v_ingestion_touched,
    'ledgerRowsTouched', v_ledger_touched,
    'reconciliationRowsTouched', v_reconciliation_touched
  );
end;
$$;

-- Fail closed by default. Only the trusted service role is a candidate executor.
revoke all on function public.eos_financial_persist_snapshot_v1(uuid, jsonb) from public;
revoke all on function public.eos_financial_persist_snapshot_v1(uuid, jsonb) from anon;
revoke all on function public.eos_financial_persist_snapshot_v1(uuid, jsonb) from authenticated;
grant execute on function public.eos_financial_persist_snapshot_v1(uuid, jsonb) to service_role;

-- Promotion gates before this draft can become an executable migration:
--   1. validate against a non-production Supabase branch/project;
--   2. test exact replay, replay mismatch, pending->posted, two-session races,
--      own-account transfers, refunds, reversals and card payment semantics;
--   3. verify compact SHA-256 identities and real unique-index behavior;
--   4. verify anon/authenticated/service-role grants and cross-user isolation;
--   5. run Supabase Security Advisor against SECURITY DEFINER;
--   6. rehearse rollback;
--   7. do not apply to production until EOS 4.0 RC1 freeze is closed.
