import { describe, it, expect } from 'vitest';
import { Wallet } from 'ethers';
import { actionHash, signL1Action, approveAgentTypedData, recoverApproveAgentSigner, splitSignature } from '../signing.ts';
import { orderAction } from '../exchange.ts';

// Vectors from hyperliquid-python-sdk tests/signing_test.py
const KEY = '0x0123456789012345678901234567890123456789012345678901234567890123';
const wallet = new Wallet(KEY);

const big = (h: string) => BigInt(h);

function expectSig(sig: { r: string; s: string; v: number }, r: string, s: string, v: number) {
  expect(big(sig.r)).toBe(big(r));
  expect(big(sig.s)).toBe(big(s));
  expect(sig.v).toBe(v);
}

describe('Hyperliquid L1 signing matches the official SDK', () => {
  it('phantom agent connectionId for a production order', () => {
    const action = orderAction([{ a: 4, b: true, p: '1670.1', s: '0.0147', r: false, t: { limit: { tif: 'Ioc' } } }]);
    expect(actionHash(action, 1677777606040)).toBe('0x0fcbeda5ae3c4950a548021552a4fea2226858c4453571bf3f24ba017eac2908');
  });

  it('dummy action with uint64 field, mainnet and testnet', async () => {
    const action = { type: 'dummy', num: 100000000000 };
    expectSig(await signL1Action(wallet, action, 0, true),
      '0x53749d5b30552aeb2fca34b530185976545bb22d0b3ce6f62e31be961a59298',
      '0x755c40ba9bf05223521753995abb2f73ab3229be8ec921f350cb447e384d8ed8', 27);
    expectSig(await signL1Action(wallet, action, 0, false),
      '0x542af61ef1f429707e3c76c5293c80d01f74ef853e34b76efffcb57e574f9510',
      '0x17b8b32f086e8cdede991f1e2c529f5dd5297cbe8128500e00cbaf766204a613', 28);
  });

  it('dummy action with vault address', async () => {
    const action = { type: 'dummy', num: 100000000000 };
    const vault = '0x1719884eb866cb12b2287399b15f7db5e7d775ea';
    expectSig(await signL1Action(wallet, action, 0, true, vault),
      '0x3c548db75e479f8012acf3000ca3a6b05606bc2ec0c29c50c515066a326239',
      '0x4d402be7396ce74fbba3795769cda45aec00dc3125a984f2a9f23177b190da2c', 28);
  });

  it('GTC limit order', async () => {
    const action = orderAction([{ a: 1, b: true, p: '100', s: '100', r: false, t: { limit: { tif: 'Gtc' } } }]);
    expectSig(await signL1Action(wallet, action, 0, true),
      '0xd65369825a9df5d80099e513cce430311d7d26ddf477f5b3a33d2806b100d78e',
      '0x2b54116ff64054968aa237c20ca9ff68000f977c93289157748a3162b6ea940e', 28);
    expectSig(await signL1Action(wallet, action, 0, false),
      '0x82b2ba28e76b3d761093aaded1b1cdad4960b3af30212b343fb2e6cdfa4e3d54',
      '0x6b53878fc99d26047f4d7e8c90eb98955a109f44209163f52d8dc4278cbbd9f5', 27);
  });

  it('order with cloid', async () => {
    const action = orderAction([{ a: 1, b: true, p: '100', s: '100', r: false, t: { limit: { tif: 'Gtc' } }, c: '0x00000000000000000000000000000001' }]);
    expectSig(await signL1Action(wallet, action, 0, true),
      '0x41ae18e8239a56cacbc5dad94d45d0b747e5da11ad564077fcac71277a946e3',
      '0x3c61f667e747404fe7eea8f90ab0e76cc12ce60270438b2058324681a00116da', 27);
  });

  it('market stop-loss trigger order', async () => {
    const action = orderAction([{ a: 1, b: true, p: '100', s: '100', r: false, t: { trigger: { isMarket: true, triggerPx: '103', tpsl: 'sl' } } }]);
    expectSig(await signL1Action(wallet, action, 0, true),
      '0x98343f2b5ae8e26bb2587daad3863bc70d8792b09af1841b6fdd530a2065a3f9',
      '0x6b5bb6bb0633b710aa22b721dd9dee6d083646a5f8e581a20b545be6c1feb405', 27);
    expectSig(await signL1Action(wallet, action, 0, false),
      '0x971c554d917c44e0e1b6cc45d8f9404f32172a9d3b3566262347d0302896a2e4',
      '0x206257b104788f80450f8e786c329daa589aa0b32ba96948201ae556d5637eac', 28);
  });
});

describe('ApproveAgent typed data', () => {
  it('round-trips: a wallet signature over the v4 payload recovers to the wallet', async () => {
    const msg = { hyperliquidChain: 'Testnet' as const, agentAddress: Wallet.createRandom().address, agentName: 'OpenHype', nonce: 1700000000000 };
    const td = approveAgentTypedData(msg, 421614);
    const { EIP712Domain: _omit, ...types } = td.types;
    const sig = splitSignature(await wallet.signTypedData(td.domain, types, td.message));
    expect(recoverApproveAgentSigner(msg, 421614, sig)).toBe(wallet.address);
    // A different signing chain id must not verify against the same signature.
    expect(recoverApproveAgentSigner(msg, 1, sig)).not.toBe(wallet.address);
  });
});
