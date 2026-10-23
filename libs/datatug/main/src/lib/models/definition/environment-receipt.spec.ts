import goldens from './environment-receipts.golden.json';
import {
  EnvironmentState,
  EnvironmentOperationResult,
} from './environment-state';
import {
  environmentPayloadDigest,
  environmentAfterDigest,
  verifyEnvironmentReceipt,
  EnvironmentWrite,
} from './environment-receipt';

// Captured by private Go test overlays invoking actual state/create/save methods.
// CLI 5d4dc5494ea136ad9f8f7af47ca5481824e9607a, Backend 0fe7258087eb490f09b62905cc84d123f5c53dcc,
// both linked to Core 7d0e7523ad8ce1df165eb09ab3f74dfabc80b6de. No fabricated receipt digests.
describe('Go-service environment receipt goldens', () => {
  for (const fixture of goldens) {
    const before = fixture.before as unknown as EnvironmentState;
    const request = fixture.request as EnvironmentWrite;
    const receipt = fixture.receipt as EnvironmentOperationResult;
    it(`${fixture.transport} ${receipt.kind} matches payload and after-state`, async () => {
      expect(await environmentPayloadDigest(request)).toBe(
        receipt.payloadDigest,
      );
      expect(
        await environmentAfterDigest(before, request, receipt.environmentId),
      ).toBe(receipt.afterStateDigest);
      await expect(
        verifyEnvironmentReceipt(before, request, receipt),
      ).resolves.toBeUndefined();
    });
    it(`${fixture.transport} ${receipt.kind} rejects tampered proof`, async () => {
      for (const changed of [
        { ...receipt, kind: 'wrong' },
        { ...receipt, payloadDigest: '0'.repeat(64) },
        { ...receipt, afterStateDigest: '0'.repeat(64) },
        { ...receipt, operationId: receipt.operationId + 'x' },
        ...('name' in request
          ? [
              { ...receipt, environmentId: undefined },
              { ...receipt, environmentId: 'another-id' },
            ]
          : [{ ...receipt, environmentOrder: [] }]),
      ]) {
        await expect(
          verifyEnvironmentReceipt(
            before,
            request,
            changed as EnvironmentOperationResult,
          ),
        ).rejects.toThrow();
      }
    });
  }
});
