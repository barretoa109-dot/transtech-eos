import { calculateUsableLiquidity } from "./liquidity";
import type { FinancialAccount } from "./types";

const USER_ID = "00000000-0000-4000-8000-000000000099";
const AS_OF = "2026-08-16T18:00:00.000Z";

function account(
  id: string,
  patch: Partial<FinancialAccount> = {},
): FinancialAccount {
  return {
    id,
    userId: USER_ID,
    externalAccountId: `external-${id}`,
    connectionId: "connection-fixture",
    type: "checking",
    institutionName: "Fixture Bank",
    displayName: id,
    currency: "PYG",
    ownership: "own",
    availableBalanceMinor: 1000000,
    ledgerBalanceMinor: 1000000,
    balanceAsOf: AS_OF,
    freshUntil: "2026-08-16T19:00:00.000Z",
    ...patch,
  };
}

export function runLiquidityAuthorityScenario() {
  const healthy = calculateUsableLiquidity(
    [
      account("own", { availableBalanceMinor: 5000000 }),
      account("joint", {
        type: "wallet",
        ownership: "joint",
        availableBalanceMinor: 1000000,
      }),
      account("external", {
        ownership: "external",
        availableBalanceMinor: 9000000,
      }),
    ],
    "PYG",
    AS_OF,
  );

  const empty = calculateUsableLiquidity([], "PYG", AS_OF);
  const unknownOwnershipOnly = calculateUsableLiquidity(
    [account("unknown-owner", { ownership: "unknown" })],
    "PYG",
    AS_OF,
  );
  const nonLiquidOnly = calculateUsableLiquidity(
    [account("card", { type: "card" })],
    "PYG",
    AS_OF,
  );
  const wrongCurrencyOnly = calculateUsableLiquidity(
    [account("usd", { currency: "USD" })],
    "PYG",
    AS_OF,
  );
  const stale = calculateUsableLiquidity(
    [
      account("fresh", { availableBalanceMinor: 2000000 }),
      account("stale", {
        availableBalanceMinor: 3000000,
        freshUntil: "2026-08-16T17:59:59.999Z",
      }),
    ],
    "PYG",
    AS_OF,
  );
  const exactBoundary = calculateUsableLiquidity(
    [account("boundary", { freshUntil: AS_OF })],
    "PYG",
    AS_OF,
  );
  const invalidBalance = calculateUsableLiquidity(
    [
      account("unsafe-balance", {
        availableBalanceMinor: Number.MAX_SAFE_INTEGER + 1,
      }),
    ],
    "PYG",
    AS_OF,
  );
  const negativeKnownBalance = calculateUsableLiquidity(
    [account("negative", { availableBalanceMinor: -500000 })],
    "PYG",
    AS_OF,
  );

  const checks = {
    authoritativeOwnAndJointLiquidityIncluded:
      healthy.usableMinor === 6000000 &&
      healthy.includedAccountIds.includes("own") &&
      healthy.includedAccountIds.includes("joint") &&
      healthy.sourcesFresh,
    externalLiquidityNeverCounted:
      healthy.excludedAccountIds.includes("external") &&
      healthy.usableMinor !== 15000000,
    zeroEligibleSourcesAreUnknownNotFresh:
      empty.usableMinor === 0 &&
      empty.includedAccountIds.length === 0 &&
      empty.sourcesFresh === false,
    unknownOwnershipCannotAuthorizeLiquidity:
      unknownOwnershipOnly.usableMinor === 0 &&
      unknownOwnershipOnly.excludedAccountIds.includes("unknown-owner") &&
      unknownOwnershipOnly.sourcesFresh === false,
    nonLiquidSourceAloneCannotAuthorizeLiquidity:
      nonLiquidOnly.usableMinor === 0 &&
      nonLiquidOnly.sourcesFresh === false,
    otherCurrencyAloneCannotAuthorizeLiquidity:
      wrongCurrencyOnly.usableMinor === 0 &&
      wrongCurrencyOnly.sourcesFresh === false,
    oneStaleAuthoritativeSourceDegradesWholePicture:
      stale.usableMinor === 2000000 &&
      stale.staleAccountIds.includes("stale") &&
      stale.sourcesFresh === false,
    exactFreshnessBoundaryRemainsFresh:
      exactBoundary.usableMinor === 1000000 && exactBoundary.sourcesFresh,
    unsafeBalanceCannotEnterAvailableLiquidity:
      invalidBalance.usableMinor === 0 &&
      invalidBalance.staleAccountIds.includes("unsafe-balance") &&
      invalidBalance.sourcesFresh === false,
    knownNegativeBalanceContributesZeroButRemainsKnown:
      negativeKnownBalance.usableMinor === 0 &&
      negativeKnownBalance.includedAccountIds.includes("negative") &&
      negativeKnownBalance.sourcesFresh,
  };

  return {
    ok: Object.values(checks).every(Boolean),
    checks,
    healthy,
    empty,
    stale,
    invalidBalance,
  };
}
