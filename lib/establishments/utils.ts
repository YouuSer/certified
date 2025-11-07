const HTML_ENTITY_PATTERN = /&(#(?:x[0-9a-fA-F]+|\d+)|[a-zA-Z][\w-]*);/g
const HTML_ENTITY_MAP: Record<string, string> = {
  amp: '&',
  apos: "'",
  quot: '"',
  lt: '<',
  gt: '>',
  nbsp: ' ',
  rsquo: "'",
  lsquo: "'",
  ldquo: '"',
  rdquo: '"',
  hellip: '...',
  ndash: '-',
  mdash: '—',
  deg: '°',
  euro: '€',
  copy: '©',
  reg: '®',
  trade: '™',
  laquo: '«',
  raquo: '»',
  agrave: 'à',
  aacute: 'á',
  acirc: 'â',
  auml: 'ä',
  aring: 'å',
  aelig: 'æ',
  ccedil: 'ç',
  egrave: 'è',
  eacute: 'é',
  ecirc: 'ê',
  euml: 'ë',
  igrave: 'ì',
  iacute: 'í',
  icirc: 'î',
  iuml: 'ï',
  ograve: 'ò',
  oacute: 'ó',
  ocirc: 'ô',
  otilde: 'õ',
  ouml: 'ö',
  oslash: 'ø',
  ugrave: 'ù',
  uacute: 'ú',
  ucirc: 'û',
  uuml: 'ü',
  yacute: 'ý',
  yuml: 'ÿ',
  oelig: 'œ',
}

export type ModificationChange = {
  field: string
  before: unknown
  after: unknown
}

export type ModificationEntry = {
  id?: string
  before: any
  after: any
  changes: ModificationChange[]
}

export type ChangelogComputationResult = {
  added: any[]
  removed: any[]
  modified: ModificationEntry[]
}

export function decodeHtmlEntities(value: string): string {
  return value.replace(HTML_ENTITY_PATTERN, (match, entity: string) => {
    if (!entity) return match
    if (entity[0] === '#') {
      const isHex = entity[1]?.toLowerCase() === 'x'
      const codePoint = Number.parseInt(entity.slice(isHex ? 2 : 1), isHex ? 16 : 10)
      if (Number.isFinite(codePoint) && codePoint >= 0) {
        try {
          return String.fromCodePoint(codePoint)
        } catch {
          return match
        }
      }
      return match
    }
    const replacement = HTML_ENTITY_MAP[entity.toLowerCase()]
    return replacement ?? match
  })
}

export function sanitizeText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const decoded = decodeHtmlEntities(value)
    const trimmed = decoded.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value.toString() : undefined
  }
  return undefined
}

export function toNumberArray(value: unknown): number[] {
  if (Array.isArray(value)) {
    return Array.from(
      new Set(
        value
          .map((v) => Number(v))
          .filter((v) => Number.isFinite(v)),
      ),
    )
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? [value] : []
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? [parsed] : []
  }
  return []
}

export function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return Array.from(
      new Set(
        value
          .map((v) => `${v}`.trim())
          .filter((v) => v.length > 0),
      ),
    )
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? [trimmed] : []
  }
  return []
}

function uniqueNumbers(values: number[]): number[] {
  return Array.from(new Set(values)).sort((a, b) => a - b)
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((v) => v && v.length > 0)))
}

function normalizeComparableString(value: unknown): string {
  const sanitized = sanitizeText(value)
  if (sanitized) {
    return sanitized.toLowerCase()
  }
  return ''
}

export function areNumbersClose(a: unknown, b: unknown, tolerance = 0.0001): boolean {
  const aNum = typeof a === 'number' ? a : Number(a)
  const bNum = typeof b === 'number' ? b : Number(b)
  const aFinite = Number.isFinite(aNum)
  const bFinite = Number.isFinite(bNum)

  if (!aFinite && !bFinite) return true
  if (!aFinite || !bFinite) return false
  return Math.abs(aNum - bNum) <= tolerance
}

export function createDedupKey(est: any): string {
  const latKey = Number.isFinite(est?.lat) ? est.lat.toFixed(4) : 'undefined'
  const lngKey = Number.isFinite(est?.lng) ? est.lng.toFixed(4) : 'undefined'
  return `${normalizeComparableString(est?.name)}|${normalizeComparableString(est?.city)}|${latKey}|${lngKey}`
}

export function normalizeEstablishmentShape(est: any) {
  const filters = toNumberArray(est?.filter)
  const categories = toStringArray(est?.categories ?? [])
  const latCandidate =
    typeof est?.lat === 'number' ? est.lat : Number.parseFloat(`${est?.lat ?? ''}`)
  const lngCandidate =
    typeof est?.lng === 'number' ? est.lng : Number.parseFloat(`${est?.lng ?? ''}`)
  const lat = Number.isFinite(latCandidate) ? latCandidate : undefined
  const lng = Number.isFinite(lngCandidate) ? lngCandidate : undefined
  const sanitizedName = sanitizeText(est?.name)
  const sanitizedAddress = sanitizeText(est?.address)
  const sanitizedCity = sanitizeText(est?.city)
  const sanitizedSource = sanitizeText(est?.source)

  return {
    ...est,
    name: sanitizedName ?? (typeof est?.name === 'number' ? String(est.name) : est?.name),
    address: sanitizedAddress ?? est?.address,
    city: sanitizedCity ?? est?.city,
    source: sanitizedSource ?? est?.source,
    lat,
    lng,
    filter: filters,
    categories,
  }
}

export function shouldMergeEstablishments(existing: any, incoming: any): boolean {
  const sameSource =
    normalizeComparableString(existing?.source) === normalizeComparableString(incoming?.source)
  if (!sameSource) return false

  const sameName =
    normalizeComparableString(existing?.name) === normalizeComparableString(incoming?.name)
  if (!sameName) return false

  const sameCity =
    normalizeComparableString(existing?.city) === normalizeComparableString(incoming?.city)
  const cityEquivalent = sameCity || !existing?.city || !incoming?.city

  const sameAddress =
    normalizeComparableString(existing?.address) === normalizeComparableString(incoming?.address)
  const addressEquivalent = sameAddress || !existing?.address || !incoming?.address

  const latClose = areNumbersClose(existing?.lat, incoming?.lat)
  const lngClose = areNumbersClose(existing?.lng, incoming?.lng)

  return cityEquivalent && addressEquivalent && latClose && lngClose
}

export function mergeEstablishment(existing: any, incoming: any) {
  const incomingNormalized = normalizeEstablishmentShape(incoming)

  const mergedFilters = uniqueNumbers([
    ...toNumberArray(existing?.filter),
    ...incomingNormalized.filter,
  ])

  const mergedCategories = uniqueStrings([
    ...toStringArray(existing?.categories),
    ...incomingNormalized.categories,
  ])

  existing.filter = mergedFilters
  existing.categories = mergedCategories
  if (incomingNormalized.name) {
    existing.name = incomingNormalized.name
  }

  if (!existing.address && incomingNormalized.address) {
    existing.address = incomingNormalized.address
  }
  if (!existing.city && incomingNormalized.city) {
    existing.city = incomingNormalized.city
  }
  if (!existing.source && incomingNormalized.source) {
    existing.source = incomingNormalized.source
  }

  if (!Number.isFinite(existing?.lat) && Number.isFinite(incomingNormalized?.lat)) {
    existing.lat = incomingNormalized.lat
  }
  if (!Number.isFinite(existing?.lng) && Number.isFinite(incomingNormalized?.lng)) {
    existing.lng = incomingNormalized.lng
  }

  if (
    incomingNormalized.updatedAt &&
    (!existing.updatedAt || incomingNormalized.updatedAt > existing.updatedAt)
  ) {
    existing.updatedAt = incomingNormalized.updatedAt
  }
}

export function cloneEstablishment(est: any) {
  return est ? JSON.parse(JSON.stringify(est)) : est
}

export function areStringArraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const sortedA = [...a].sort()
  const sortedB = [...b].sort()
  return sortedA.every((value, index) => value === sortedB[index])
}

export function areNumberArraysEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false
  const sortedA = [...a].sort((x, y) => x - y)
  const sortedB = [...b].sort((x, y) => x - y)
  return sortedA.every((value, index) => value === sortedB[index])
}

export function collectModificationChanges(previous: any, next: any) {
  const oldNormalized = normalizeEstablishmentShape(previous)
  const newNormalized = normalizeEstablishmentShape(next)

  const sanitizeChangeValue = (value: unknown) => {
    if (Array.isArray(value)) {
      return value.map((item) => (item === undefined ? null : item))
    }
    return value === undefined ? null : value
  }

  const pushChange = (
    changes: Array<{ field: string; before: unknown; after: unknown }>,
    field: string,
    before: unknown,
    after: unknown,
  ) => {
    changes.push({
      field,
      before: sanitizeChangeValue(before),
      after: sanitizeChangeValue(after),
    })
  }

  const changes: Array<{ field: string; before: unknown; after: unknown }> = []

  if (oldNormalized.name !== newNormalized.name) {
    pushChange(changes, 'name', oldNormalized.name, newNormalized.name)
  }
  if (oldNormalized.address !== newNormalized.address) {
    pushChange(changes, 'address', oldNormalized.address, newNormalized.address)
  }
  if (oldNormalized.city !== newNormalized.city) {
    pushChange(changes, 'city', oldNormalized.city, newNormalized.city)
  }
  if (oldNormalized.source !== newNormalized.source) {
    pushChange(changes, 'source', oldNormalized.source, newNormalized.source)
  }
  if (!areNumbersClose(oldNormalized.lat, newNormalized.lat)) {
    pushChange(changes, 'lat', oldNormalized.lat, newNormalized.lat)
  }
  if (!areNumbersClose(oldNormalized.lng, newNormalized.lng)) {
    pushChange(changes, 'lng', oldNormalized.lng, newNormalized.lng)
  }
  if (!areStringArraysEqual(oldNormalized.categories ?? [], newNormalized.categories ?? [])) {
    pushChange(
      changes,
      'categories',
      Array.isArray(oldNormalized.categories) ? [...oldNormalized.categories] : [],
      Array.isArray(newNormalized.categories) ? [...newNormalized.categories] : [],
    )
  }
  if (!areNumberArraysEqual(oldNormalized.filter ?? [], newNormalized.filter ?? [])) {
    pushChange(
      changes,
      'filter',
      Array.isArray(oldNormalized.filter) ? [...oldNormalized.filter] : [],
      Array.isArray(newNormalized.filter) ? [...newNormalized.filter] : [],
    )
  }

  return changes
}

export function normalizeAchahada(e: any, category: string, filter: number, updatedAt: string) {
  return {
    id: `ach-${e.id}`,
    name: e.store?.trim(),
    lat: parseFloat(e.lat),
    lng: parseFloat(e.lng),
    address: `${e.address}, ${e.zip || ''} ${e.city || ''}`.trim(),
    city: e.city,
    source: 'Achahada',
    categories: category ? [category] : [],
    filter: Number.isFinite(filter) ? [filter] : [],
    updatedAt,
  }
}

export function normalizeAvs(e: any, category: string, filter: number, updatedAt: string) {
  return {
    id: `avs-${e.id}`,
    name: e.name?.trim(),
    lat: parseFloat(e.latitude),
    lng: parseFloat(e.longitude),
    address: `${e.address}, ${e.zipCode || ''} ${e.city || ''}`.trim(),
    city: e.city,
    source: 'AVS',
    categories: category ? [category] : [],
    filter: Number.isFinite(filter) ? [filter] : [],
    updatedAt,
  }
}

export function computeChangelogEntries({
  current,
  previous,
  syncTimestamp,
}: {
  current: any[]
  previous: any[]
  syncTimestamp: string
}): ChangelogComputationResult {
  const oldById = new Map(
    previous
      .filter((entry): entry is { id: string } & Record<string, unknown> => Boolean(entry?.id))
      .map((entry) => [entry.id, entry]),
  )
  const added: any[] = []
  const removed: any[] = []
  const modified: ModificationEntry[] = []
  const seenIds = new Set<string>()

  for (const entry of current) {
    const entryId = entry?.id
    const earlier = entryId ? oldById.get(entryId) : undefined

    entry.updatedAt = syncTimestamp
    entry.removedAt = null
    if (earlier?.createdAt) {
      entry.createdAt = earlier.createdAt
    } else if (!entry.createdAt) {
      entry.createdAt = syncTimestamp
    }

    if (entryId) {
      seenIds.add(entryId)
    }

    if (!earlier) {
      added.push(cloneEstablishment(entry))
      continue
    }

    const changes = collectModificationChanges(earlier, entry)
    if (changes.length > 0) {
      modified.push({
        id: entryId,
        before: cloneEstablishment(earlier),
        after: cloneEstablishment(entry),
        changes,
      })
    }
  }

  for (const previousEntry of previous) {
    const previousId = previousEntry?.id
    if (!previousId || seenIds.has(previousId)) continue
    const removedEntry = cloneEstablishment(previousEntry) ?? {}
    removedEntry.removedAt = syncTimestamp
    removedEntry.updatedAt = syncTimestamp
    removed.push(removedEntry)
  }

  return { added, removed, modified }
}
