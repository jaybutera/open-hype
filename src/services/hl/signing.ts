import { encode } from '@msgpack/msgpack';
import { keccak256, getBytes, concat, toBeArray, zeroPadValue, Signature, TypedDataEncoder, recoverAddress, type Wallet } from 'ethers';

/**
 * Hyperliquid action signing, ported from the official Python SDK
 * (hyperliquid/utils/signing.py) and checked against its test vectors.
 *
 * L1 actions (order, cancel, updateLeverage) are hashed with msgpack and signed
 * as an EIP-712 "phantom agent" on chainId 1337. Browser wallets refuse that
 * domain, so trades are signed by a locally held agent key that the user
 * approves once with a user-signed ApproveAgent message from their wallet.
 */

export interface HLSignature { r: string; s: string; v: number }

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const L1_DOMAIN = { name: 'Exchange', version: '1', chainId: 1337, verifyingContract: ZERO_ADDRESS };
const AGENT_TYPES = { Agent: [{ name: 'source', type: 'string' }, { name: 'connectionId', type: 'bytes32' }] };

function u64be(n: number): Uint8Array {
  return getBytes(zeroPadValue(toBeArray(BigInt(n)), 8));
}

export function actionHash(action: unknown, nonce: number, vaultAddress?: string | null, expiresAfter?: number | null): string {
  const parts: Uint8Array[] = [encode(action, { ignoreUndefined: true }), u64be(nonce)];
  if (vaultAddress) {
    parts.push(new Uint8Array([1]), getBytes(vaultAddress));
  } else {
    parts.push(new Uint8Array([0]));
  }
  if (expiresAfter != null) {
    parts.push(new Uint8Array([0]), u64be(expiresAfter));
  }
  return keccak256(concat(parts));
}

export function splitSignature(sig: string): HLSignature {
  const s = Signature.from(sig);
  return { r: s.r, s: s.s, v: s.v };
}

export async function signL1Action(
  signer: Wallet,
  action: unknown,
  nonce: number,
  isMainnet: boolean,
  vaultAddress?: string | null,
  expiresAfter?: number | null,
): Promise<HLSignature> {
  const phantomAgent = { source: isMainnet ? 'a' : 'b', connectionId: actionHash(action, nonce, vaultAddress, expiresAfter) };
  return splitSignature(await signer.signTypedData(L1_DOMAIN, AGENT_TYPES, phantomAgent));
}

/** The ApproveAgent fields that are actually signed (EIP-712 message). */
export interface ApproveAgentMessage {
  hyperliquidChain: 'Mainnet' | 'Testnet';
  agentAddress: string;
  agentName: string;
  nonce: number;
}

export const APPROVE_AGENT_TYPES = {
  'HyperliquidTransaction:ApproveAgent': [
    { name: 'hyperliquidChain', type: 'string' },
    { name: 'agentAddress', type: 'address' },
    { name: 'agentName', type: 'string' },
    { name: 'nonce', type: 'uint64' },
  ],
};

export function userSignedDomain(signatureChainId: number) {
  return { name: 'HyperliquidSignTransaction', version: '1', chainId: signatureChainId, verifyingContract: ZERO_ADDRESS };
}

/** Full eth_signTypedData_v4 payload for a browser wallet. */
export function approveAgentTypedData(msg: ApproveAgentMessage, signatureChainId: number) {
  return {
    domain: userSignedDomain(signatureChainId),
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' },
      ],
      ...APPROVE_AGENT_TYPES,
    },
    primaryType: 'HyperliquidTransaction:ApproveAgent' as const,
    message: msg,
  };
}

/** Recover who signed an ApproveAgent message; used to confirm the wallet signed with the expected account. */
export function recoverApproveAgentSigner(msg: ApproveAgentMessage, signatureChainId: number, sig: HLSignature): string {
  const digest = TypedDataEncoder.hash(userSignedDomain(signatureChainId), APPROVE_AGENT_TYPES, msg);
  return recoverAddress(digest, Signature.from(sig));
}
