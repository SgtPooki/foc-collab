/**
 * What every page on the site does before it is a game or a room: connect
 * the transport, load this browser's signing identity, warn about an
 * expiring write key, and offer wallet onboarding to a page that has no
 * player descriptor yet. play-byow.js and room-byow.js both start here.
 *
 * Markup ids used: transport-label, banner, wallet-row, connect,
 * wallet-status.
 */
import { loadIdentity } from './identity.js'
import { createTransport } from './transport.js'
import { hasWallet, provisionPlayer } from './wallet-byow.js'

/**
 * @param {object} opts
 * @param {string} opts.storagePrefix  sessionStorage prefix for the per-tab identity scope (local demo)
 * @param {string} [opts.spectatorNote] what a page without a wallet can still do, for the no-wallet message
 */
export async function bootByowPage({ storagePrefix, spectatorNote = 'you can still watch' }) {
  const $ = (id) => document.getElementById(id)
  const labelEl = $('transport-label')
  labelEl.textContent = 'connecting to shared storage…'
  let transport
  try {
    transport = await createTransport()
  } catch (err) {
    console.error(err)
    labelEl.textContent = `could not connect (${err?.message?.slice(0, 120) ?? err}) — reload to retry`
    throw err
  }

  // Seat identity is a keypair generated in this browser: every appended
  // piece is signed, so log readers cannot alter a player's pieces. The
  // private key is a non-extractable CryptoKey in IndexedDB. On shared
  // storage one identity serves the whole browser; the local demo scopes
  // identities by a per-tab id so two tabs in one browser can face each
  // other (and keep their seats across reloads).
  function tabScope() {
    const key = `${storagePrefix}-tab-id`
    let id = sessionStorage.getItem(key)
    if (id == null) {
      id = crypto.randomUUID()
      sessionStorage.setItem(key, id)
    }
    return id
  }
  const identity = await loadIdentity(transport.perTab ? tabScope() : 'shared')
  labelEl.textContent = transport.label

  const byow = typeof transport.addDataSet === 'function'

  if (transport.writeExpiry) {
    const banner = $('banner')
    if (transport.writeExpiry < Date.now()) {
      banner.textContent = byow
        ? 'your session key has expired — reconnect your wallet to play'
        : 'the demo write key has expired — games are read-only until the publisher re-arms it'
      banner.hidden = false
    } else if (transport.writeExpiry < Date.now() + 3 * 3600000) {
      banner.textContent = `heads up: your write key expires ${new Date(transport.writeExpiry).toLocaleString()}`
      banner.hidden = false
    }
  }

  // BYOW onboarding: with no descriptor (or an expired one) the page offers
  // to make one from the connected wallet. Every stage is shown; every
  // failure names its step. Success reloads into play mode.
  const needsWallet = byow && (transport.me == null || (transport.writeExpiry && transport.writeExpiry < Date.now()))
  if (needsWallet) {
    $('wallet-row').hidden = false
    const walletStatus = $('wallet-status')
    const connect = $('connect')
    if (!hasWallet()) {
      connect.disabled = true
      walletStatus.textContent = `no browser wallet found — install MetaMask (or any EIP-1193 wallet) on Filecoin calibration; ${spectatorNote}`
    }
    connect.onclick = async () => {
      connect.disabled = true
      walletStatus.classList.remove('error')
      try {
        // Never clear what is saved first: provisionPlayer resumes from it and
        // only pays for the steps the chain does not already show done.
        const me = await provisionPlayer({ onProgress: (stage) => { walletStatus.textContent = `${stage}…` } })
        walletStatus.textContent = `ready: your data set #${me.ds}, reloading`
        location.reload()
      } catch (err) {
        console.error(err)
        walletStatus.textContent = `could not set up (${err?.message ?? err}) — fix and try again`
        walletStatus.classList.add('error')
        connect.disabled = false
      }
    }
  }

  return { $, labelEl, transport, identity, token: identity.token, byow, needsWallet }
}
