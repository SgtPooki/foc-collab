/**
 * Bundle entry: the exact synapse-core/viem surface the corgi page needs,
 * resolved from the pinned node_modules versions and bundled by build.mjs
 * into vendor.js. The published page ships this bundle instead of loading a
 * CDN at runtime, so it renders from IPFS with no third-party dependency.
 */
export { calibration, mainnet } from '@filoz/synapse-core/chains'
export { accounts, deposit, resolveAccountState } from '@filoz/synapse-core/pay'
export { approve, balance } from '@filoz/synapse-core/erc20'
export { createPublicClient, createWalletClient, custom, formatUnits, http, parseAbiItem, parseUnits } from 'viem'
