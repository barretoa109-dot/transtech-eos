import type { FinancialConnectorSnapshot } from "./types";

export interface FinancialReadConnector {
  providerKey: string;
  fetchSnapshot(userId: string): Promise<FinancialConnectorSnapshot>;
}

export class MockFinancialConnector implements FinancialReadConnector {
  readonly providerKey = "mock_py_bank_v1";

  constructor(private readonly snapshotFactory: (userId: string) => FinancialConnectorSnapshot) {}

  async fetchSnapshot(userId: string): Promise<FinancialConnectorSnapshot> {
    const snapshot = this.snapshotFactory(userId);
    if (snapshot.providerKey !== this.providerKey) {
      throw new Error("mock connector providerKey mismatch");
    }
    return structuredClone(snapshot);
  }
}
