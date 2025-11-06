import { db } from '@/lib/firebase'
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  writeBatch,
} from 'firebase/firestore'
import { NextResponse } from 'next/server'

const CACHE_DURATION = 1000 * 60 * 60 * 24 // 24h
let lastRefresh = 0

export async function GET() {
  const now = Date.now()
  
  try {
    // 🔍 Vérifie la dernière mise à jour Firestore
    const metaSnap = await getDoc(doc(db, 'meta', 'lastRefresh'))
    const metaData = metaSnap.exists() ? metaSnap.data() : null
    
    if (metaData?.date) {
      const lastUpdate = new Date(metaData.date).getTime()
      if (now - lastUpdate < CACHE_DURATION) {
        // Données fraîches
        const q = query(collection(db, 'establishments'))
        const querySnapshot = await getDocs(q)
        const data = querySnapshot.docs.map((d) => d.data())
        console.log(`✅ Envoi de ${data.length} établissements (cache encore valide)`)
        return NextResponse.json(data)
      } else {
        // Données à rafraîchir → on retourne les anciennes immédiatement
        const querySnapshot = await getDocs(collection(db, 'establishments'))
        const data = querySnapshot.docs.map((d) => d.data())
        
        // Lance le refresh en arrière-plan sans bloquer
        console.log(`⚙️ Données obsolètes, refresh asynchrone lancé en arrière-plan.`)
        console.log(`✅ Envoi immédiat de ${data.length} établissements (ancienne version)`)
        refreshCache().catch((err) => console.error('Background refresh error:', err))
        return NextResponse.json(data)
      }
    }
    
    // Sinon on met à jour les données
    if (!metaData?.date) {
      // Pas de données encore → on fait le premier fetch complet, bloquant
      console.log('⚙️ Premier chargement, fetch complet requis.')
      await refreshCache()
      const updated = await getDocs(collection(db, 'establishments'))
      const data = updated.docs.map((d) => d.data())
      console.log(`✅ Envoi de ${data.length} établissements (refresh async déclenché)`)
      return NextResponse.json(data)
    }
    // Puis on relit Firestore pour renvoyer la version la plus fraîche
    const updated = await getDocs(collection(db, 'establishments'))
    const data = updated.docs.map((d) => d.data())
    
    console.log(`✅ Envoi de ${data.length} établissements (refresh async déclenché)`)
    return NextResponse.json(data)
  } catch (err) {
    console.error('❌ API proxy error', err)
    return NextResponse.json({ error: 'Failed to fetch data' }, { status: 500 })
  }
}

async function refreshCache() {
  console.log('♻️ Rafraîchissement complet des données...')
  
  // === FILTRES ACHAHADA ===
  const filters: Record<number, string> = {
    29: 'Restaurant',
    30: 'Boucherie',
    31: 'Fournisseur',
    32: 'Cash',
    34: 'Distributeur',
    36: 'Marque',
  }
  
  // === FETCH PARALLÈLE ===
  const achahadaRequests = Object.keys(filters).map((filterId) =>
    fetch(
    `https://achahada.com/wp-admin/admin-ajax.php?action=store_search&autoload=1&filter=${filterId}`
  ).then((r) => r.json().then((data) => ({ data, filterId: Number(filterId) })))
)

const [achs, rAvsB, rAvsR, rAvsF] = await Promise.all([
  Promise.all(achahadaRequests),
  fetch('https://equinox.avs.fr/v1/common/partners?type=1'),
  fetch('https://equinox.avs.fr/v1/common/partners?type=2'),
  fetch('https://equinox.avs.fr/v1/common/partners?type=3'),
])

const [avsB, avsR, avsF] = await Promise.all([
  rAvsB.json(),
  rAvsR.json(),
  rAvsF.json(),
])

// === NORMALISATION ===
const achahadaNormalized = achs.flatMap(({ data, filterId }) =>
  data.map((e: any) => normalizeAchahada(e, filters[filterId], filterId))
)

const avsNormalized = [
  ...avsB.map((e: any) => normalizeAvs(e, 'Boucherie', 1)),
  ...avsR.map((e: any) => normalizeAvs(e, 'Restaurant', 2)),
  ...avsF.map((e: any) => normalizeAvs(e, 'Fournisseur', 3)),
]

// === FUSION & DÉDOUBLONNAGE ===
const normalized = [...achahadaNormalized, ...avsNormalized]

const seen = new Map<string, any>()
const duplicates: any[] = []

for (const rawEntry of normalized) {
  const normalizedEntry = normalizeEstablishmentShape(rawEntry)
  const key = createDedupKey(normalizedEntry)
  const existing = seen.get(key)

  if (existing) {
    if (shouldMergeEstablishments(existing, normalizedEntry)) {
      mergeEstablishment(existing, normalizedEntry)
    } else {
      duplicates.push({
        original: cloneEstablishment(existing),
        duplicate: cloneEstablishment(normalizedEntry),
      })
    }
  } else {
    seen.set(key, normalizedEntry)
  }
}

const deduped = Array.from(seen.values())

console.log(`✅ ${deduped.length} établissements uniques`)
if (duplicates.length > 0) {
  console.warn(`⚠️ ${duplicates.length} doublon(s) détecté(s).`)
}

// === COMPARAISON AVEC ANCIENNE BASE ===
const oldSnapshot = await getDocs(collection(db, 'establishments'))
const oldData = oldSnapshot.docs.map((d) => d.data())

const added = deduped.filter((n) => !oldData.some((o) => o.id === n.id))
const removed = oldData.filter((o) => !deduped.some((n) => n.id === o.id))
const modified = deduped.filter((n) => {
  const old = oldData.find((o) => o.id === n.id)
  if (!old) return false

  const oldNormalized = normalizeEstablishmentShape(old)
  const newNormalized = normalizeEstablishmentShape(n)

  const coordChanged =
    Math.abs((oldNormalized.lat ?? 0) - (newNormalized.lat ?? 0)) > 0.0001 ||
    Math.abs((oldNormalized.lng ?? 0) - (newNormalized.lng ?? 0)) > 0.0001

  const categoriesChanged = !areStringArraysEqual(
    toStringArray(oldNormalized.categories),
    toStringArray(newNormalized.categories),
  )

  const filtersChanged = !areNumberArraysEqual(
    toNumberArray(oldNormalized.filter),
    toNumberArray(newNormalized.filter),
  )

  return (
    oldNormalized.name !== newNormalized.name ||
    oldNormalized.address !== newNormalized.address ||
    coordChanged ||
    categoriesChanged ||
    filtersChanged
  )
})

console.log(`🆕 ${added.length} ajout(s), ❌ ${removed.length} suppression(s), ✏️ ${modified.length} modification(s).`)

// === CHANGELOG Firestore ===
const changelogCol = collection(db, 'changelog')
const changelogDoc = await addDoc(changelogCol, {
  date: new Date().toISOString(),
  status: 'pending',
  added,
  removed,
  modified,
  stats: {
    added: added.length,
    removed: removed.length,
    modified: modified.length,
    total: deduped.length,
  },
})

// === ÉCRITURE FIRESTORE ===
const estRef = collection(db, 'establishments')
const dupRef = collection(db, 'duplicates')

// 1️⃣ Sauvegarder les établissements dédupliqués
for (let i = 0; i < deduped.length; i += 500) {
  const batch = writeBatch(db)
  const chunk = deduped.slice(i, i + 500)
  for (const e of chunk) {
    batch.set(doc(estRef, e.id), e)
  }
  await batch.commit()
}

// 2️⃣ Sauvegarder un résumé des doublons
const snapshotRef = doc(dupRef, 'latest')
await setDoc(snapshotRef, {
  date: new Date().toISOString(),
  count: duplicates.length,
  duplicates: duplicates,
})

// 3️⃣ Mettre à jour la meta
await setDoc(doc(db, 'meta', 'lastRefresh'), {
  date: new Date().toISOString(),
  count: deduped.length,
  added: added.length,
  removed: removed.length,
  modified: modified.length,
})
// ✅ Mise à jour du statut après succès
await setDoc(changelogDoc, { status: 'completed' }, { merge: true })

lastRefresh = Date.now()
console.log('💾 Données synchronisées dans Firestore.')
return deduped
}

// === HELPERS ===
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

function decodeHtmlEntities(value: string): string {
  return value.replace(HTML_ENTITY_PATTERN, (match, entity: string) => {
    if (!entity) return match
    if (entity[0] === '#') {
      const isHex = entity[1]?.toLowerCase() === 'x'
      const codePoint = Number.parseInt(
        entity.slice(isHex ? 2 : 1),
        isHex ? 16 : 10,
      )
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

function sanitizeText(value: unknown): string | undefined {
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

function toNumberArray(value: unknown): number[] {
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

function toStringArray(value: unknown): string[] {
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

function areNumbersClose(a: unknown, b: unknown, tolerance = 0.0001): boolean {
  const aNum = typeof a === 'number' ? a : Number(a)
  const bNum = typeof b === 'number' ? b : Number(b)
  const aFinite = Number.isFinite(aNum)
  const bFinite = Number.isFinite(bNum)

  if (!aFinite && !bFinite) return true
  if (!aFinite || !bFinite) return false
  return Math.abs(aNum - bNum) <= tolerance
}

function createDedupKey(est: any): string {
  const latKey = Number.isFinite(est?.lat) ? est.lat.toFixed(4) : 'undefined'
  const lngKey = Number.isFinite(est?.lng) ? est.lng.toFixed(4) : 'undefined'
  return `${normalizeComparableString(est?.name)}|${normalizeComparableString(est?.city)}|${latKey}|${lngKey}`
}

function normalizeEstablishmentShape(est: any) {
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

function shouldMergeEstablishments(existing: any, incoming: any): boolean {
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

function mergeEstablishment(existing: any, incoming: any) {
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

function cloneEstablishment(est: any) {
  return est ? JSON.parse(JSON.stringify(est)) : est
}

function areStringArraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const sortedA = [...a].sort()
  const sortedB = [...b].sort()
  return sortedA.every((value, index) => value === sortedB[index])
}

function areNumberArraysEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false
  const sortedA = [...a].sort((x, y) => x - y)
  const sortedB = [...b].sort((x, y) => x - y)
  return sortedA.every((value, index) => value === sortedB[index])
}

function normalizeAchahada(e: any, category: string, filter: number) {
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
    updatedAt: new Date().toISOString(),
  }
}

function normalizeAvs(e: any, category: string, filter: number) {
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
    updatedAt: new Date().toISOString(),
  }
}
