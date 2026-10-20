/**
 * Model Picker — Host half.
 *
 * The Client half (`client.js`) shadows the composer model seat and draws a
 * two-pane picker. It reads its model list from the shipped `modelDirectories`
 * Client service, but that catalog carries only id/name/description/reasoning
 * efforts, so capacities and input modalities are resolved here.
 *
 * Three read-mostly JSON routes back the picker:
 *   GET  /api/model-picker/meta     catalog enrichment + favorites + recents
 *   POST /api/model-picker/prefs    toggle a favorite / record a recent pick
 *   POST /api/model-picker/default   write the deployment default model
 *
 * Every field shown for a model comes from the provider that owns it, through
 * `llm.listModels` and `llm.resolveModelInfo`, and from nowhere else. In
 * particular this half reads no bundled reference catalog: Harness's own
 * `llm-pi-ai` states that "the harness never reads pi-ai's cost metadata", and
 * a price or capacity published by some other vendor for a model of the same
 * name describes that vendor's offer, not this route. Since no provider surface
 * reports a price at all, `cost` is always `null` and the Client shows an
 * unknown state rather than an amount, and it never reads as "free".
 *
 * Every route is fenced to same-machine callers: the browser only ever talks to
 * this process over loopback, and a cross-site page must not be able to read the
 * user's model list or move the default model.
 *
 * @module index.js
 */

import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export const name = 'dsh-model-picker'

/** Route prefix owned by this plugin; the Client resolves it against `document.baseURI`. */
const ROUTE_PREFIX = '/api/model-picker'

/** Catalog enrichment is stable between settings changes; keep it briefly. */
const META_TTL_MS = 20_000

/** Loopback hostnames a same-machine caller can legitimately present. */
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost', '[::1]'])

/**
 * Which directory holds this plugin's durable state.
 * @returns {string} absolute directory path.
 */
function stateDir() {
  const home = process.env.DSH_HOME
  const base = typeof home === 'string' && home.trim().length > 0 ? home.trim() : path.join(os.homedir(), '.dsh')
  return path.join(base, 'model-picker')
}

/** @returns {string} the prefs file this plugin owns. */
function prefsFile() {
  return path.join(stateDir(), 'model-picker-prefs.json')
}

/** Stable key for one provider/model pair, mirrored by the Client. */
function modelKey(provider, model) {
  return `${provider}\u0000${model}`
}

// ── durable preferences ──────────────────────────────────────────────────────

/** @returns {Promise<{favorites: string[], recents: string[]}>} empty lists on any read failure. */
async function readPrefs() {
  try {
    const raw = await fsp.readFile(prefsFile(), 'utf8')
    const parsed = JSON.parse(raw)
    return {
      favorites: Array.isArray(parsed?.favorites) ? parsed.favorites.filter(entry => typeof entry === 'string') : [],
      recents: Array.isArray(parsed?.recents) ? parsed.recents.filter(entry => typeof entry === 'string') : [],
    }
  } catch {
    return { favorites: [], recents: [] }
  }
}

/**
 * Serialize preference writes so two clicks cannot interleave into one file.
 * @param {(current: {favorites: string[], recents: string[]}) => {favorites: string[], recents: string[]}} mutate
 * @returns {Promise<{favorites: string[], recents: string[]}>} the stored value.
 */
let prefsQueue = Promise.resolve()
function writePrefs(mutate) {
  const next = prefsQueue.then(async () => {
    const current = await readPrefs()
    const updated = mutate(current)
    const file = prefsFile()
    await fsp.mkdir(path.dirname(file), { recursive: true })
    const scratch = `${file}.tmp`
    await fsp.writeFile(scratch, `${JSON.stringify(updated, null, 2)}\n`, 'utf8')
    await fsp.rename(scratch, file)
    return updated
  })
  prefsQueue = next.catch(() => {})
  return next
}

// ── enrichment ───────────────────────────────────────────────────────────────

/**
 * Describe every model of every registered provider for the picker.
 * @param {object} ctx - Host context.
 * @returns {Promise<{providers: Array<{id: string, name: string}>, models: object}>}
 */
async function describeCatalog(ctx) {
  const llm = ctx.get('llm')
  if (llm === undefined) return { providers: [], models: {} }
  let providers = []
  try {
    providers = llm.listProviders()
  } catch {
    providers = []
  }
  const models = {}
  const pairs = []
  for (const provider of providers) {
    let listed = []
    try {
      listed = await llm.listModels(provider.id)
    } catch {
      listed = []
    }
    for (const model of listed) pairs.push([provider.id, model])
  }
  await Promise.allSettled(pairs.map(([provider, model]) => describeModel(llm, provider, model, models)))
  return { providers: providers.map(provider => ({ id: provider.id, name: provider.name })), models }
}

/**
 * Merge catalog metadata with the reference price entry for one route.
 * @param {object} llm - the llm service.
 * @param {string} provider - provider route id.
 * @param {object} model - one `listModels` entry.
 * @param {object} out - accumulator keyed by {@link modelKey}.
 */
async function describeModel(llm, provider, model, out) {
  const record = {
    name: typeof model.name === 'string' ? model.name : model.id,
    description: typeof model.description === 'string' ? model.description : undefined,
    inputModalities: Array.isArray(model.inputModalities) ? [...model.inputModalities] : undefined,
    contextWindow: undefined,
    maxTokens: undefined,
    reasoning: undefined,
    cost: null,
  }
  // Everything below comes from the provider that owns this model and from
  // nothing else. No bundled reference catalog is consulted: a list price
  // another vendor publishes for a model of the same name is not this route's
  // price, and a capacity another vendor declares is not this route's spec.
  // `resolveModelInfo` omits `context` when the route and the model entry both
  // say nothing, so an absent value stays absent instead of becoming a default.
  try {
    const info = await llm.resolveModelInfo(provider, model.id)
    if (info?.context !== undefined) record.contextWindow = info.context.contextWindow
    if (Number.isInteger(info?.defaultMaxTokens)) record.maxTokens = info.defaultMaxTokens
    if (info?.reasoning !== undefined) record.reasoning = info.reasoning
    if (Array.isArray(info?.inputModalities) && info.inputModalities.length > 0) record.inputModalities = [...info.inputModalities]
    if (typeof info?.description === 'string') record.description = info.description
  } catch {
    // A route whose catalog is unreadable still renders; it simply explains less.
  }
  out[modelKey(provider, model.id)] = record
}

/**
 * Cached catalog enrichment. Only this part is cached: preferences and the
 * default selection change on writes, so they are read fresh every request.
 */
let metaCache = { at: 0, value: undefined }

/** In-flight enrichment, so concurrent opens resolve the catalog once. */
let metaPending

/**
 * @param {object} ctx - Host context.
 * @returns {Promise<{providers: object[], models: object}>} enrichment, cached for {@link META_TTL_MS}.
 */
function enrichment(ctx) {
  if (metaCache.value !== undefined && Date.now() - metaCache.at < META_TTL_MS) return Promise.resolve(metaCache.value)
  if (metaPending !== undefined) return metaPending
  metaPending = describeCatalog(ctx)
    .then(value => {
      metaCache = { at: Date.now(), value }
      return value
    })
    .finally(() => {
      metaPending = undefined
    })
  return metaPending
}

/**
 * @param {object} ctx - Host context.
 * @returns {Promise<object>} the `/meta` payload.
 */
async function metaPayload(ctx) {
  const [catalog, prefs] = await Promise.all([enrichment(ctx), readPrefs()])
  let fallback = null
  try {
    fallback = ctx.get('agentDefaultModel')?.currentSelection() ?? null
  } catch {
    fallback = null
  }
  return {
    ok: true,
    providers: catalog.providers,
    models: catalog.models,
    default: fallback,
    favorites: prefs.favorites,
    recents: prefs.recents,
  }
}

// ── request handling ─────────────────────────────────────────────────────────

/**
 * The composition's own admission decision, when it publishes one.
 *
 * These routes sit under `/api/model-picker`, longer than the kernel's `/api`
 * prefix, so longest-prefix dispatch runs them before the connection service's
 * own check. Asking that service first keeps this plugin exactly as strict as
 * the app instead of re-deriving the rule.
 *
 * @param {object} ctx - Host context.
 * @param {import('node:http').IncomingMessage} req - the request under assessment.
 * @returns {{rejection: number}|undefined} an admission answer, or undefined to decide structurally.
 */
function admissionOf(ctx, req) {
  let connection
  try {
    connection = ctx.get('connection')
  } catch {
    return undefined
  }
  if (connection === undefined) return undefined
  try {
    // `admit` returns `{ rejection }`; older hosts publish the bare status under
    // `requestRejection`. A failure here must never read as "allowed".
    if (typeof connection.admit === 'function') {
      const admission = connection.admit(req)
      if (admission === undefined || admission === null) return undefined
      return typeof admission === 'object' ? admission : { rejection: admission }
    }
    if (typeof connection.requestRejection === 'function') {
      const status = connection.requestRejection(req)
      return status === undefined ? undefined : { rejection: status }
    }
    return undefined
  } catch {
    return { rejection: 503 }
  }
}

/**
 * Is this request from a page this process itself served?
 * @param {import('node:http').IncomingMessage} req - the request under assessment.
 * @returns {number|undefined} a status to reject with, or undefined to allow.
 */
function rejectionFor(req) {
  const address = req.socket?.remoteAddress ?? ''
  const normalised = address.startsWith('::ffff:') ? address.slice('::ffff:'.length) : address
  if (address !== '' && !LOOPBACK.has(address) && !LOOPBACK.has(normalised)) return 403
  const site = req.headers['sec-fetch-site']
  if (typeof site === 'string' && site !== 'same-origin' && site !== 'none') return 403
  const origin = req.headers.origin ?? req.headers.referer
  if (typeof origin === 'string' && origin.length > 0 && !origin.startsWith('dsh-app://')) {
    let host = null
    try {
      host = new URL(origin).host
    } catch {
      return 403
    }
    if (host !== req.headers.host) return 403
  }
  return undefined
}

/**
 * @param {import('node:http').ServerResponse} res - the response to answer on.
 * @param {number} status - HTTP status.
 * @param {object} body - JSON payload.
 */
function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(text)
}

/**
 * Read one JSON request body.
 * @param {import('node:http').IncomingMessage} req - request to drain.
 * @param {number} limit - largest accepted body in bytes.
 * @returns {Promise<unknown>} the parsed body.
 */
async function readJson(req, limit = 64 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('body too large')
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  return text.length === 0 ? {} : JSON.parse(text)
}

/**
 * @param {object} ctx - Host context.
 * @param {(req: object, res: object) => Promise<void>} handler - route body.
 * @returns {(req: object, res: object) => Promise<void>} a fenced, failure-safe handler.
 */
function guarded(ctx, handler) {
  return async (req, res) => {
    try {
      const admission = admissionOf(ctx, req)
      if (admission !== undefined) {
        if (admission.rejection !== undefined) sendJson(res, admission.rejection, { ok: false, error: 'forbidden' })
        else await handler(req, res)
        return
      }
      const rejection = rejectionFor(req)
      if (rejection !== undefined) {
        sendJson(res, rejection, { ok: false, error: 'forbidden' })
        return
      }
      await handler(req, res)
    } catch (error) {
      ctx.logger?.warn?.(`model-picker: ${error instanceof Error ? error.message : String(error)}`)
      if (!res.headersSent) sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
      else res.end()
    }
  }
}

/**
 * Mount the picker's data routes.
 * @param {object} ctx - Host context.
 */
export function apply(ctx) {
  ctx.inject(['webServer'], scoped => {
    const route = (suffix, handler) => scoped.effect(
      () => scoped.webServer.register({
        kind: 'exact',
        path: `${ROUTE_PREFIX}${suffix}`,
        handler: guarded(ctx, handler),
      }),
      `model-picker: ${suffix} route`,
    )

    route('/meta', async (req, res) => {
      sendJson(res, 200, await metaPayload(ctx))
    })

    route('/prefs', async (req, res) => {
      const body = await readJson(req)
      const key = typeof body?.key === 'string' ? body.key : undefined
      const action = typeof body?.action === 'string' ? body.action : undefined
      if (key === undefined || (action !== 'favorite' && action !== 'favorite-off' && action !== 'recent')) {
        sendJson(res, 400, { ok: false, error: 'expected { key, action: favorite | favorite-off | recent }' })
        return
      }
      const stored = await writePrefs(current => {
        const favorites = new Set(current.favorites)
        if (action === 'favorite') favorites.add(key)
        else if (action === 'favorite-off') favorites.delete(key)
        const recents = action === 'recent'
          ? [key, ...current.recents.filter(entry => entry !== key)].slice(0, 12)
          : current.recents
        return { favorites: [...favorites], recents }
      })
      sendJson(res, 200, { ok: true, ...stored })
    })

    // Crash reports from the browser half. A shadowing entry that throws is
    // retired by the Slot ledger and the shipped seat takes the cell back, so
    // the failure is otherwise invisible in the UI; land it on disk instead.
    route('/report', async (req, res) => {
      const body = await readJson(req)
      const file = path.join(path.dirname(prefsFile()), 'client-errors.log')
      const line = `${JSON.stringify({ at: new Date().toISOString(), ...body })}\n`
      await fsp.mkdir(path.dirname(file), { recursive: true })
      await fsp.appendFile(file, line, 'utf8')
      sendJson(res, 200, { ok: true })
    })

    route('/default', async (req, res) => {
      const body = await readJson(req)
      const provider = typeof body?.provider === 'string' ? body.provider : undefined
      const model = typeof body?.model === 'string' ? body.model : undefined
      if (provider === undefined || model === undefined) {
        sendJson(res, 400, { ok: false, error: 'expected { provider, model, reasoningEffort? }' })
        return
      }
      const service = ctx.get('agentDefaultModel')
      if (service === undefined) {
        sendJson(res, 501, { ok: false, error: 'this composition has no default-model owner' })
        return
      }
      const selection = { provider, model }
      if (typeof body?.reasoningEffort === 'string' && body.reasoningEffort.length > 0) selection.reasoningEffort = body.reasoningEffort
      await service.saveSelection(selection)
      sendJson(res, 200, { ok: true, default: selection })
    })
  })
}
