/**
 * Bundle entry: the exact synapse-sdk/viem surface the FOC transports and
 * the in-page wallet flow need, resolved from the pinned node_modules
 * versions and bundled by scripts/build-page.mjs into vendor-foc.js. The
 * published page ships this bundle instead of loading a CDN at runtime,
 * so the demo cannot be taken down by a CDN outage or a floating version.
 * In node (proof scripts, tests) the same module resolves straight from
 * node_modules. The FEE envelope library (vendor/foc-encryption, see
 * seal.js) and X25519 ride in the same bundle.
 */
export { calibration } from '@filoz/synapse-core/chains'
export { getActivePiecesByCursor } from '@filoz/synapse-core/pdp-verifier'
export { AddPiecesPermission, fromSecp256k1, getExpirations, loginSync } from '@filoz/synapse-core/session-key'
export { getPDPProvider } from '@filoz/synapse-core/sp-registry'
export { getDataSet } from '@filoz/synapse-core/warm-storage'
export { Synapse } from '@filoz/synapse-sdk'
export { accounts, deposit } from '@filoz/synapse-core/pay'
export { approve, balance } from '@filoz/synapse-core/erc20'
export { createPublicClient, createWalletClient, custom, formatUnits, http, parseAbiItem, parseEventLogs, parseUnits, publicActions, verifyMessage } from 'viem'
export { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
export { decrypt as feeDecrypt, encrypt as feeEncrypt, parseEnvelope as feeParse } from '../../vendor/foc-encryption/index.js'
export { x25519 } from '@noble/curves/ed25519'
export { secp256k1 } from '@noble/curves/secp256k1'
