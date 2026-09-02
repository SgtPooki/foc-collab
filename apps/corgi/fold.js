/**
 * Pure fold for the FOC corgi. No I/O, no mutation of inputs, synchronous.
 *
 * The corgi is a Filecoin Pay payer account. Its life is that account's
 * funding runway; its food is every `DepositRecorded` event addressed to it.
 * Everything on screen derives from two chain reads taken BEFORE this fold
 * runs (see chain.js): the account summary and the ordered deposit log.
 *
 * Inputs (all epochs are block heights as Numbers, amounts are bigint wei):
 *   account: { epoch, ratePerEpoch, unreserved, funds }
 *     epoch        current block height
 *     ratePerEpoch account lockupRate (wei/epoch); 0 when nothing is stored
 *     unreserved   funds the rails have not reserved yet, i.e.
 *                  runwayInEpochs * ratePerEpoch. Runway in the SDK's terms:
 *                  synapse-core/src/pay/resolve-account-state.ts
 *     funds        total funds in the account (grossCoverage = funds / rate)
 *   deposits: [{ from, amount, epoch, txHash }] in chain order
 *
 * Runway history is reconstructed backwards from `unreserved`: between two
 * deposits it declines by exactly ratePerEpoch per epoch, a deposit adds its
 * amount, and nothing else moves it (settlement only shifts funds into the
 * reserve). That holds as long as the spend rate is constant, which is true
 * for a dedicated payer wallet with one data set; withdrawals and rate
 * changes are not modelled in v1 and are documented in README.md.
 */

export const EPOCHS_PER_DAY = 2880 // synapse-core/src/utils/constants.ts:18
export const LOCKUP_PERIOD_EPOCHS = 30 * EPOCHS_PER_DAY // PriceListUSDFC.sol DEFAULT_LOCKUP_PERIOD

export const DEFAULT_CONFIG = Object.freeze({
  // life thresholds in days of runway (deficit point), evaluated top-down
  thrivingDays: 90,
  sickDays: 30,
  criticalDays: 14,
  // death is declared while runway remains so the memorial is viewable
  deathDays: 7,
  // distinct feeders inside this many days drive mood
  moodWindowDays: 7,
  // one deposit at or above this spawns a corgi for the sender (wei)
  adoptionThreshold: 5n * 10n ** 18n,
})

export const LIFE = Object.freeze(['thriving', 'fine', 'sick', 'critical', 'dead', 'unfunded'])
export const MOODS = Object.freeze(['lonely', 'content', 'happy', 'ecstatic'])

function toBig(n) {
  return typeof n === 'bigint' ? n : BigInt(Math.trunc(n))
}

/** Runway in epochs for a given unreserved balance. Infinity when nothing is spent. */
export function runwayEpochs(unreserved, ratePerEpoch) {
  if (ratePerEpoch <= 0n) return Infinity
  if (unreserved <= 0n) return 0
  return Number(unreserved / ratePerEpoch)
}

export function lifeOf(runwayInEpochs, config = DEFAULT_CONFIG) {
  if (runwayInEpochs === Infinity) return 'unfunded'
  const days = runwayInEpochs / EPOCHS_PER_DAY
  if (days < config.deathDays) return 'dead'
  if (days < config.criticalDays) return 'critical'
  if (days < config.sickDays) return 'sick'
  if (days < config.thrivingDays) return 'fine'
  return 'thriving'
}

export function moodOf(distinctFeeders) {
  if (distinctFeeders <= 0) return 'lonely'
  if (distinctFeeders === 1) return 'content'
  if (distinctFeeders <= 3) return 'happy'
  return 'ecstatic'
}

function validDeposit(d) {
  return d != null && typeof d === 'object'
    && typeof d.from === 'string' && /^0x[0-9a-fA-F]{40}$/.test(d.from)
    && typeof d.amount === 'bigint' && d.amount > 0n
    && Number.isFinite(d.epoch)
}

/**
 * Walks the deposit log backwards to find the unreserved balance just
 * before and just after every deposit. Returns one row per deposit plus the
 * balance trajectory, all in chain order.
 */
function trajectory(account, deposits) {
  const rate = toBig(account.ratePerEpoch)
  const rows = new Array(deposits.length)
  let after = toBig(account.unreserved) + rate * toBig(account.epoch)
  // `after` is balance + rate*epoch, which is constant between deposits, so
  // we can walk backwards without tracking elapsed time per segment.
  for (let i = deposits.length - 1; i >= 0; i--) {
    const d = deposits[i]
    const afterAt = after - rate * toBig(d.epoch)
    const beforeAt = afterAt - d.amount
    rows[i] = { ...d, before: beforeAt, after: afterAt }
    after -= d.amount
  }
  return rows
}

/**
 * Death and revival transitions under constant spend. Between deposits the
 * balance falls linearly, so a crossing below the death line is at a
 * computable epoch. A deposit that lifts the balance back to the line or
 * above revives, opening a new generation.
 */
function generationsOf(account, rows, config) {
  const rate = toBig(account.ratePerEpoch)
  const deathLine = rate * toBig(config.deathDays * EPOCHS_PER_DAY)
  const generations = []
  let alive = false
  let born = null
  const crossingEpoch = (fromEpoch, balance) => {
    // balance(e) = balance - rate*(e - fromEpoch); solve balance(e) = deathLine
    if (rate <= 0n) return Infinity
    return fromEpoch + Number((balance - deathLine) / rate) + 1
  }
  for (const row of rows) {
    if (!alive) {
      if (rate > 0n && row.after >= deathLine) {
        alive = true
        born = { epoch: row.epoch, txHash: row.txHash, by: row.from }
      }
      continue
    }
    if (rate > 0n && row.before < deathLine) {
      generations.push({ born, died: { epoch: crossingEpoch(row.epoch, row.before), atDeposit: false } })
      alive = row.after >= deathLine
      born = alive ? { epoch: row.epoch, txHash: row.txHash, by: row.from } : null
    }
  }
  const now = account.epoch
  if (alive) {
    const last = rows[rows.length - 1]
    const nowBalance = toBig(account.unreserved)
    if (rate > 0n && nowBalance < deathLine) {
      generations.push({ born, died: { epoch: crossingEpoch(last.epoch, last.after), atDeposit: false } })
      alive = false
      born = null
    }
  }
  return { generations, alive, born, deathLine, now }
}

function distinctFeedersSince(rows, sinceEpoch) {
  const set = new Set()
  for (const r of rows) if (r.epoch >= sinceEpoch) set.add(r.from.toLowerCase())
  return set
}

function parkOf(rows, config, payer) {
  const owners = new Map()
  for (const r of rows) {
    const owner = r.from.toLowerCase()
    if (owner === payer) continue
    if (r.amount < config.adoptionThreshold || owners.has(owner)) continue
    owners.set(owner, { owner: r.from, epoch: r.epoch, txHash: r.txHash, amount: r.amount })
  }
  return [...owners.values()]
}

/** Folds account state + deposit log into everything the page renders. */
export function fold(input, config = DEFAULT_CONFIG) {
  const account = {
    epoch: Number(input.account.epoch),
    ratePerEpoch: toBig(input.account.ratePerEpoch),
    unreserved: toBig(input.account.unreserved),
    funds: toBig(input.account.funds),
  }
  const payer = String(input.payer ?? '').toLowerCase()
  const deposits = (input.deposits ?? []).filter(validDeposit)
  const rows = trajectory(account, deposits)
  const runway = runwayEpochs(account.unreserved, account.ratePerEpoch)
  const gross = runwayEpochs(account.funds, account.ratePerEpoch)
  const { generations, alive, born, deathLine } = generationsOf(account, rows, config)

  const window = config.moodWindowDays * EPOCHS_PER_DAY
  const feeders = distinctFeedersSince(rows, account.epoch - window)
  const park = parkOf(rows, config, payer)

  let life = lifeOf(runway, config)
  if (life !== 'unfunded' && !alive) life = 'dead'

  const memorial = life === 'dead'
    ? {
        diedEpoch: generations.length > 0 ? generations[generations.length - 1].died.epoch : account.epoch,
        // The memorial exists until the protocol's lockup tail ends. Gross
        // coverage (funds / rate) is the epochs the remaining funds pay for.
        endsInEpochs: gross === Infinity ? Infinity : gross,
        reviveNeeds: deathLine > account.unreserved ? deathLine - account.unreserved : 0n,
      }
    : null

  return {
    payer,
    epoch: account.epoch,
    ratePerEpoch: account.ratePerEpoch,
    funds: account.funds,
    unreserved: account.unreserved,
    runwayEpochs: runway,
    grossCoverageEpochs: gross,
    life,
    mood: moodOf(feeders.size),
    distinctFeeders: feeders.size,
    generation: generations.length + (alive ? 1 : 0),
    born,
    generations,
    memorial,
    park,
    feed: rows.slice().reverse(),
    totalFed: rows.reduce((sum, r) => sum + r.amount, 0n),
    ignored: (input.deposits ?? []).length - deposits.length,
  }
}
