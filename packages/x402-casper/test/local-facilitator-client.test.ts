import { describe, it, expect } from 'vitest';
import { LocalFacilitatorClient } from '../src/local-facilitator-client.ts';

describe('LocalFacilitatorClient', () => {
  it('reports supported casper kinds', async () => {
    const client = new LocalFacilitatorClient({ nodeUrl: 'http://unused', networkName: 'casper-test' });
    const supported = await client.getSupported();
    const kinds = supported.kinds.map((k: { network: string; scheme: string }) => `${k.scheme}:${k.network}`);
    expect(kinds).toContain('exact:casper:casper-test');
  });
});
