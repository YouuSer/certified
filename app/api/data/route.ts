import { db } from '@/lib/firebase'
import {
  cloneEstablishment,
  computeChangelogEntries,
  createDedupKey,
  mergeEstablishment,
  normalizeAchahada,
  normalizeAvs,
  normalizeEstablishmentShape,
  shouldMergeEstablishments,
} from '@/lib/establishments/utils'
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  setDoc,
  writeBatch,
} from 'firebase/firestore'
import { NextResponse } from 'next/server'

const CACHE_DURATION = 1000 * 60 * 60 * 24 // 24h
let lastRefresh = 0

function toArrayLike(value: unknown): any[] {
  if (Array.isArray(value)) return value
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>)
  }
  return []
}

function extractEntryIds(value: unknown): string[] {
  return toArrayLike(value)
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null
      const candidate = (entry as { id?: unknown }).id
      if (typeof candidate !== 'string') return null
      const trimmed = candidate.trim()
      return trimmed.length > 0 ? trimmed : null
    })
    .filter((id): id is string => Boolean(id))
}

async function getCurrentlyRemovedIds() {
  const snapshot = await getDocs(query(collection(db, 'changelog'), orderBy('date', 'asc')))
  const removedIds = new Set<string>()

  for (const docSnap of snapshot.docs) {
    const data = docSnap.data() as Record<string, unknown>
    const status = typeof data?.status === 'string' ? data.status : 'completed'
    if (status !== 'completed') continue

    for (const id of extractEntryIds(data?.added)) {
      removedIds.delete(id)
    }

    for (const id of extractEntryIds(data?.removed)) {
      removedIds.add(id)
    }
  }

  return removedIds
}

export async function GET(request: Request) {
  const now = Date.now()
  const url = new URL(request.url)
  const forceRefresh = url.searchParams.get('force') === 'true'
  
  try {
    // 🔍 Vérifie la dernière mise à jour Firestore
    const metaSnap = await getDoc(doc(db, 'meta', 'lastRefresh'))
    const metaData = metaSnap.exists() ? metaSnap.data() : null

    if (forceRefresh) {
      console.log('🔁 Force refresh demandé, bypass du cache 24h.')
      await refreshCache()
      const freshSnapshot = await getDocs(collection(db, 'establishments'))
      const freshData = freshSnapshot.docs.map((d) => d.data())
      console.log(`✅ Envoi de ${freshData.length} établissements (force refresh)`)
      return NextResponse.json(freshData)
    }
    
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
  const syncTimestamp = new Date().toISOString()
  
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
  data.map((e: any) => normalizeAchahada(e, filters[filterId], filterId, syncTimestamp))
)

const avsNormalized = [
  ...avsB.map((e: any) => normalizeAvs(e, 'Boucherie', 1, syncTimestamp)),
  ...avsR.map((e: any) => normalizeAvs(e, 'Restaurant', 2, syncTimestamp)),
  ...avsF.map((e: any) => normalizeAvs(e, 'Fournisseur', 3, syncTimestamp)),
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
const { added, removed, modified } = computeChangelogEntries({
  current: deduped,
  previous: oldData,
  syncTimestamp,
})

const currentRemovedIds = await getCurrentlyRemovedIds()
const seenRemovedIds = new Set<string>()
const freshRemoved = removed.filter((entry) => {
  const id = typeof entry?.id === 'string' ? entry.id.trim() : null
  if (!id) return true
  if (currentRemovedIds.has(id) || seenRemovedIds.has(id)) {
    return false
  }
  seenRemovedIds.add(id)
  return true
})
const skippedRemovedCount = removed.length - freshRemoved.length
if (skippedRemovedCount > 0) {
  console.log(`ℹ️ ${skippedRemovedCount} suppression(s) ignorée(s) car déjà historisée(s).`)
}

console.log(
  `🆕 ${added.length} ajout(s), ❌ ${freshRemoved.length} nouvelle(s) suppression(s), ✏️ ${modified.length} modification(s).`,
)

// === CHANGELOG Firestore ===
const changelogCol = collection(db, 'changelog')
const changelogDoc = await addDoc(changelogCol, {
  date: syncTimestamp,
  status: 'pending',
  added,
  removed: freshRemoved,
  modified,
  stats: {
    added: added.length,
    removed: freshRemoved.length,
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

// 2️⃣ Supprimer définitivement les établissements déjà marqués comme supprimés
const removedWithIds = removed.filter(
  (entry) => typeof entry?.id === 'string' && entry.id.trim().length > 0,
)
if (removedWithIds.length > 0) {
  console.log(`🧹 Suppression de ${removedWithIds.length} établissement(s) retiré(s) de Firestore.`)
  for (let i = 0; i < removedWithIds.length; i += 500) {
    const batch = writeBatch(db)
    const chunk = removedWithIds.slice(i, i + 500)
    for (const entry of chunk) {
      batch.delete(doc(estRef, entry.id))
    }
    await batch.commit()
  }
}

// 3️⃣ Sauvegarder un résumé des doublons
const snapshotRef = doc(dupRef, 'latest')
await setDoc(snapshotRef, {
  date: syncTimestamp,
  count: duplicates.length,
  duplicates: duplicates,
})

// 4️⃣ Mettre à jour la meta
await setDoc(doc(db, 'meta', 'lastRefresh'), {
  date: syncTimestamp,
  count: deduped.length,
  added: added.length,
  removed: freshRemoved.length,
  modified: modified.length,
})
// ✅ Mise à jour du statut après succès
await setDoc(changelogDoc, { status: 'completed' }, { merge: true })

lastRefresh = Date.now()
console.log('💾 Données synchronisées dans Firestore.')
return deduped
}
