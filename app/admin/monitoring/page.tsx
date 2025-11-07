'use client'

import { collection, doc, getDoc, getDocs, orderBy, query } from 'firebase/firestore'
import Link from 'next/link'
import { Fragment, useEffect, useMemo, useState } from 'react'

import { db } from '@/lib/firebase'

type Establishment = {
  id?: string
  name?: string
  city?: string
  address?: string
  source?: string
  categories?: string[]
  filter?: number[]
  createdAt?: string
  updatedAt?: string
  removedAt?: string
}

type DuplicateSnapshot = {
  count?: number
  examples?: Array<{ original?: Establishment; duplicate?: Establishment }>
  date?: string
}

type ModificationField =
  | 'name'
  | 'address'
  | 'city'
  | 'source'
  | 'lat'
  | 'lng'
  | 'categories'
  | 'filter'

type ModificationChange = {
  field: ModificationField
  before: unknown
  after: unknown
}

type ModificationEntry = {
  id?: string
  before?: Establishment | null
  after?: Establishment | null
  changes: ModificationChange[]
  date?: string
}

type RecentChange = {
  changeId: string
  kind: 'added' | 'removed' | 'modified'
  date?: string
  establishment?: Establishment
  modification?: ModificationEntry
}

type DiagnosticsSnapshot = {
  establishmentsCount: number
  duplicatesCount: number
  duplicatesExamples: DuplicateSnapshot['examples']
  lastRefresh?: string
  metaCounts: {
    added: number
    removed: number
    modified: number
  }
  added: Establishment[]
  removed: Establishment[]
  modified: ModificationEntry[]
  recentChanges: RecentChange[]
}

type FirestoreChangelogEntry = DiagnosticsSnapshot['metaCounts'] & {
  id?: string
  date?: string
  added?: unknown
  removed?: unknown
  modified?: unknown
  status?: string
}

const formatDate = (value?: string) => {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

const getCategories = (establishment?: Establishment) => {
  if (!establishment) return []
  if (Array.isArray(establishment.categories) && establishment.categories.length > 0) {
    return establishment.categories
  }
  return []
}

const MODIFICATION_FIELDS: ModificationField[] = [
  'name',
  'address',
  'city',
  'source',
  'lat',
  'lng',
  'categories',
  'filter',
]

const MODIFICATION_FIELD_LABELS: Record<ModificationField, string> = {
  name: 'Nom',
  address: 'Adresse',
  city: 'Ville',
  source: 'Source',
  lat: 'Latitude',
  lng: 'Longitude',
  categories: 'Catégories',
  filter: 'Filtres',
}

const isModificationField = (value: unknown): value is ModificationField =>
  typeof value === 'string' && MODIFICATION_FIELDS.includes(value as ModificationField)

const toArrayLike = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>)
  }
  return []
}

const extractEstablishment = (value: unknown): Establishment | null => {
  if (!value || typeof value !== 'object') return null
  return value as Establishment
}

const normalizeEstablishmentList = (value: unknown): Establishment[] =>
  toArrayLike(value).filter(
    (item): item is Establishment => Boolean(item) && typeof item === 'object',
  ) as Establishment[]

const ensureChangeValue = (value: unknown) => (value === undefined ? null : value)

const normalizeStringList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []
  return Array.from(
    new Set(
      value
        .map((item) => `${item ?? ''}`.trim())
        .filter((item) => item.length > 0),
    ),
  ).sort((a, b) => a.localeCompare(b))
}

const normalizeNumberList = (value: unknown): number[] => {
  if (Array.isArray(value)) {
    return Array.from(
      new Set(
        value
          .map((item) => Number(item))
          .filter((item) => Number.isFinite(item)),
      ),
    ).sort((a, b) => a - b)
  }
  if (typeof value === 'number' && Number.isFinite(value)) return [value]
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? [parsed] : []
  }
  return []
}

const areFieldValuesEqual = (field: ModificationField, before: unknown, after: unknown): boolean => {
  if (field === 'categories') {
    const left = normalizeStringList(before)
    const right = normalizeStringList(after)
    if (left.length !== right.length) return false
    return left.every((value, index) => value === right[index])
  }
  if (field === 'filter') {
    const left = normalizeNumberList(before)
    const right = normalizeNumberList(after)
    if (left.length !== right.length) return false
    return left.every((value, index) => value === right[index])
  }
  if (field === 'lat' || field === 'lng') {
    const left = typeof before === 'number' ? before : Number(before)
    const right = typeof after === 'number' ? after : Number(after)
    if (!Number.isFinite(left) || !Number.isFinite(right)) {
      return (before ?? null) === (after ?? null)
    }
    return Math.abs(left - right) <= 1e-6
  }
  return (before ?? null) === (after ?? null)
}

const normalizeChangeEntry = (change: unknown): ModificationChange | null => {
  if (!change || typeof change !== 'object') return null
  const candidate = change as Record<string, unknown>
  const fieldValue = candidate.field
  if (!isModificationField(fieldValue)) return null
  return {
    field: fieldValue,
    before: ensureChangeValue(candidate.before),
    after: ensureChangeValue(candidate.after),
  }
}

const normalizeModificationEntries = (
  entries: unknown,
  changelogDate?: string,
): ModificationEntry[] => {
  const source = toArrayLike(entries)

  return source
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null
      const candidate = entry as Record<string, unknown>

      const beforeRaw = extractEstablishment(candidate.before)
      const afterRaw = extractEstablishment(candidate.after)
      const fallbackId =
        typeof candidate.id === 'string'
          ? (candidate.id as string)
          : afterRaw?.id ?? beforeRaw?.id ?? undefined

      const normalizedChanges = toArrayLike(candidate.changes)
        .map((change) => normalizeChangeEntry(change))
        .filter(Boolean) as ModificationChange[]

      const seenFields = new Set<ModificationField>(
        normalizedChanges.map((change) => change.field),
      )

      const before = beforeRaw ?? null
      let after = afterRaw ?? null

      if (!before && !after && !('before' in candidate) && !('after' in candidate)) {
        after = extractEstablishment(candidate) ?? null
      }

      if (before && after) {
        for (const field of MODIFICATION_FIELDS) {
          if (seenFields.has(field)) continue
          const previousValue = (before as Record<string, unknown>)[field]
          const nextValue = (after as Record<string, unknown>)[field]
          if (!areFieldValuesEqual(field, previousValue, nextValue)) {
            normalizedChanges.push({
              field,
              before: ensureChangeValue(previousValue),
              after: ensureChangeValue(nextValue),
            })
          }
        }
      }

      return {
        id: fallbackId,
        before,
        after,
        changes: normalizedChanges,
        date: changelogDate,
      }
    })
    .filter((item): item is ModificationEntry => Boolean(item))
}

const formatArrayValue = (value: unknown) => {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => `${item ?? ''}`.trim())
    .filter((item) => item.length > 0)
}

const formatChangeValue = (field: ModificationField, value: unknown): string => {
  if (value === null || value === undefined) return '—'
  if (field === 'filter') {
    return formatFilters(value)
  }
  if (field === 'categories') {
    const entries = formatArrayValue(value)
    return entries.length > 0 ? entries.join(', ') : '—'
  }
  if ((field === 'lat' || field === 'lng') && typeof value === 'number') {
    return Number.isFinite(value) ? value.toFixed(5) : '—'
  }
  if (Array.isArray(value)) {
    const entries = formatArrayValue(value)
    return entries.length > 0 ? entries.join(', ') : '—'
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? `${value}` : '—'
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : '—'
  }
  try {
    return JSON.stringify(value)
  } catch {
    return '—'
  }
}

const CHANGE_BADGE_LABELS: Record<RecentChange['kind'], string> = {
  added: 'Ajout',
  removed: 'Suppression',
  modified: 'Modification',
}

const CHANGE_BADGE_STYLES: Record<RecentChange['kind'], string> = {
  added: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  removed: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  modified: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
}

const ChangeTypeBadge = ({ kind }: { kind: RecentChange['kind'] }) => (
  <span
    className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${
      CHANGE_BADGE_STYLES[kind]
    }`}
  >
    {CHANGE_BADGE_LABELS[kind]}
  </span>
)

const CHANGE_FILTERS: Array<{ label: string; value: RecentChange['kind'] | 'all' }> = [
  { label: 'Tous', value: 'all' },
  { label: 'Ajouts', value: 'added' },
  { label: 'Modifications', value: 'modified' },
  { label: 'Suppressions', value: 'removed' },
]

const CERTIFICATION_ICON_MAP: Record<string, { src: string; alt: string }> = {
  achahada: { src: '/icons/achahada.png', alt: 'Certification Achahada' },
  avs: { src: '/icons/avs.png', alt: 'Certification AVS' },
}

const CertificationIcon = ({ source }: { source?: string }) => {
  if (!source) {
    return <span className="text-xs text-zinc-400">—</span>
  }

  const normalized = source.trim().toLowerCase()
  const icon = CERTIFICATION_ICON_MAP[normalized]

  if (!icon) {
    return (
      <span className="text-xs font-medium capitalize text-zinc-600 dark:text-zinc-300">
        {source}
      </span>
    )
  }

  return (
    <span className="inline-flex items-center">
      <span className="flex size-8 items-center justify-center rounded-full border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
        <img src={icon.src} alt={icon.alt} className="rounded-full object-contain" />
      </span>
    </span>
  )
}

const formatFilters = (filters: unknown): string => {
  if (Array.isArray(filters)) {
    const cleaned = filters
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value)) as number[]
    return cleaned.length ? cleaned.join(', ') : '—'
  }
  if (typeof filters === 'number') {
    return Number.isFinite(filters) ? `${filters}` : '—'
  }
  if (typeof filters === 'string' && filters.trim().length > 0) {
    const parsed = Number(filters)
    return Number.isFinite(parsed) ? `${parsed}` : filters
  }
  return '—'
}

const formatEstablishmentDetails = (establishment?: Establishment) => {
  if (!establishment) return '—'
  const categories = getCategories(establishment)
  const details = [establishment.city, categories.join(', ') || undefined]
    .filter(Boolean)
    .join(' • ')
  return details.length > 0 ? details : '—'
}

export default function FirebaseDiagnosticsPage() {
  const [stats, setStats] = useState<DiagnosticsSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({})
  const [pageSize, setPageSize] = useState(10)
  const [currentPage, setCurrentPage] = useState(1)
  const [filterKind, setFilterKind] = useState<RecentChange['kind'] | 'all'>('all')

  useEffect(() => {
    const loadStats = async () => {
      try {
        const [estSnapshot, metaSnapshot, dupSnapshot, changelogSnapshot] = await Promise.all([
          getDocs(collection(db, 'establishments')),
          getDoc(doc(db, 'meta', 'lastRefresh')),
          getDoc(doc(db, 'duplicates', 'latest')),
          getDocs(query(collection(db, 'changelog'), orderBy('date', 'desc'))),
        ])

        const establishments = estSnapshot.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Establishment),
        }))

        const meta = metaSnapshot.exists()
          ? (metaSnapshot.data() as Partial<DiagnosticsSnapshot['metaCounts']> & {
              date?: string
            })
          : undefined

        const latestDuplicates = dupSnapshot.exists()
          ? (dupSnapshot.data() as DuplicateSnapshot)
          : undefined
        const changelogEntries = changelogSnapshot.docs.map((doc) => ({
          id: doc.id,
          ...(doc.data() as FirestoreChangelogEntry),
        }))

        const metaDateMs = meta?.date ? new Date(meta.date).getTime() : undefined

        const relevantChangelogs = changelogEntries.filter((entry) => {
          if (
            !entry.date ||
            metaDateMs === undefined ||
            Number.isNaN(metaDateMs)
          )
            return true
          const entryTime = new Date(entry.date).getTime()
          if (Number.isNaN(entryTime)) return true
          return entryTime <= metaDateMs
        })

        const aggregatedAdded: Establishment[] = []
        const aggregatedRemoved: Establishment[] = []
        const aggregatedModified: ModificationEntry[] = []
        const aggregatedChanges: RecentChange[] = []

        for (const entry of relevantChangelogs) {
          const addedItems = normalizeEstablishmentList(entry.added)
          const removedItems = normalizeEstablishmentList(entry.removed)
          const normalizedModifications = normalizeModificationEntries(entry.modified, entry.date)

          addedItems.forEach((establishment, index) => {
            aggregatedChanges.push({
              changeId: `${entry.id ?? 'changelog'}-added-${index}-${establishment.id ?? establishment.name ?? 'unknown'}`,
              kind: 'added',
              date: entry.date,
              establishment,
            })
          })

          removedItems.forEach((establishment, index) => {
            aggregatedChanges.push({
              changeId: `${entry.id ?? 'changelog'}-removed-${index}-${establishment.id ?? establishment.name ?? 'unknown'}`,
              kind: 'removed',
              date: entry.date,
              establishment,
            })
          })

          normalizedModifications.forEach((modification, index) => {
            aggregatedChanges.push({
              changeId: `${entry.id ?? 'changelog'}-modified-${index}-${modification.id ?? modification.after?.id ?? modification.before?.id ?? 'unknown'}`,
              kind: 'modified',
              date: modification.date ?? entry.date,
              establishment: modification.after ?? modification.before ?? undefined,
              modification,
            })
          })

          aggregatedAdded.push(...addedItems)
          aggregatedRemoved.push(...removedItems)
          aggregatedModified.push(...normalizedModifications)
        }

        aggregatedChanges.sort((a, b) => {
          const dateA = a.date ? new Date(a.date).getTime() : 0
          const dateB = b.date ? new Date(b.date).getTime() : 0
          return dateB - dateA
        })

        setStats({
          establishmentsCount: establishments.length,
          duplicatesCount: latestDuplicates?.count ?? 0,
          duplicatesExamples: latestDuplicates?.examples ?? [],
          lastRefresh: meta?.date,
          metaCounts: {
            added: meta?.added ?? aggregatedAdded.length,
            removed: meta?.removed ?? aggregatedRemoved.length,
            modified: meta?.modified ?? aggregatedModified.length,
          },
          added: aggregatedAdded,
          removed: aggregatedRemoved,
          modified: aggregatedModified,
          recentChanges: aggregatedChanges,
        })
      } catch (err) {
        console.error(err)
        setError("Impossible de récupérer l'état Firestore.")
      } finally {
        setLoading(false)
      }
    }

    void loadStats()
  }, [])

  const recentChanges = stats?.recentChanges ?? []

  useEffect(() => {
    setCurrentPage(1)
    setExpandedRows({})
  }, [stats])

  const filteredChanges = useMemo(() => {
    if (filterKind === 'all') return recentChanges
    return recentChanges.filter((change) => change.kind === filterKind)
  }, [recentChanges, filterKind])

  const changesCountByKind = useMemo(() => {
    const counts: Record<string, number> = {
      all: recentChanges.length,
      added: 0,
      modified: 0,
      removed: 0,
    }
    for (const change of recentChanges) {
      counts[change.kind] = (counts[change.kind] ?? 0) + 1
    }
    return counts
  }, [recentChanges])

  const totalPages = useMemo(() => {
    if (filteredChanges.length === 0) return 1
    return Math.max(1, Math.ceil(filteredChanges.length / pageSize))
  }, [filteredChanges.length, pageSize])

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages)
    }
  }, [currentPage, totalPages])

  useEffect(() => {
    setCurrentPage(1)
    setExpandedRows({})
  }, [filterKind, pageSize])

  const paginatedChanges = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize
    const endIndex = startIndex + pageSize
    return filteredChanges.slice(startIndex, endIndex)
  }, [filteredChanges, currentPage, pageSize])

  const noChangesMessage =
    recentChanges.length === 0 ? 'Aucun changement enregistré.' : 'Aucun changement pour ce filtre.'

  const toggleRow = (changeId: string) => {
    setExpandedRows((previous) => ({
      ...previous,
      [changeId]: !previous?.[changeId],
    }))
  }

  return (
    <div className="min-h-screen bg-zinc-100 p-8 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-10">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold">Diagnostics Firestore</h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Suivi des synchronisations Achahada / AVS sauvegardées dans Firestore.
            </p>
          </div>
          <Link
            href="/"
            aria-label="Revenir à la page principale"
            title="Accueil"
            className="group inline-flex size-12 items-center justify-center rounded-full border border-zinc-300 bg-white/90 text-zinc-800 shadow-lg transition hover:-translate-y-0.5 hover:text-blue-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:border-zinc-700 dark:bg-zinc-900/80 dark:text-white dark:hover:text-blue-300"
          >
            <span className="sr-only">Revenir à la page principale</span>
            <svg
              viewBox="0 0 24 24"
              role="img"
              aria-hidden="true"
              className="size-6 stroke-current text-zinc-600 transition group-hover:text-blue-600 dark:text-zinc-200 dark:group-hover:text-blue-300"
              fill="none"
              strokeWidth={1.8}
            >
              <path d="m15 6-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M19 12H9" strokeLinecap="round" />
            </svg>
          </Link>
        </header>

        {loading && <p className="text-sm text-zinc-500">Chargement des statistiques...</p>}
        {error && <p className="text-sm text-red-500">{error}</p>}

        {!loading && !error && stats && (
          <>
            <section className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
              <StatCard
                label="Établissements"
                value={stats.establishmentsCount.toLocaleString('fr-FR')}
              />
              <StatCard
                label="Doublons détectés"
                value={stats.duplicatesCount.toLocaleString('fr-FR')}
                secondary={
                  stats.duplicatesExamples?.length
                    ? stats.duplicatesExamples
                        .slice(0, 3)
                        .map((d) => d.original?.name ?? d.duplicate?.name)
                        .filter(Boolean)
                        .join(', ')
                    : undefined
                }
              />
              <StatCard label="Dernière synchronisation" value={formatDate(stats.lastRefresh)} />
            </section>

            <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-medium">Derniers changements</h2>
                <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  {filteredChanges.length.toLocaleString('fr-FR')} changement(s)
                </span>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {CHANGE_FILTERS.map((option) => {
                  const isActive = filterKind === option.value
                  const count =
                    option.value === 'all'
                      ? changesCountByKind.all
                      : changesCountByKind[option.value] ?? 0

                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setFilterKind(option.value)}
                      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold transition ${
                        isActive
                          ? 'border-zinc-900 bg-zinc-900 text-white shadow-sm dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                          : 'border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800'
                      }`}
                    >
                      <span>{option.label}</span>
                      <span
                        className={`inline-flex min-w-[1.75rem] items-center justify-center rounded-full border px-2 py-0.5 text-[11px] ${
                          isActive
                            ? 'border-white/30 bg-white/20 text-white dark:border-zinc-900/40 dark:bg-zinc-900/30 dark:text-zinc-900'
                            : 'border-zinc-200 bg-zinc-100 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
                        }`}
                      >
                        {count.toLocaleString('fr-FR')}
                      </span>
                    </button>
                  )
                })}
              </div>
              {filteredChanges.length === 0 ? (
                <p className="mt-6 text-sm text-zinc-500 dark:text-zinc-400">{noChangesMessage}</p>
              ) : (
                <div className="mt-4 overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
                  <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
                    <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                      <tr>
                        <th className="px-4 py-3 text-left font-semibold">Établissement</th>
                        <th className="px-4 py-3 text-left font-semibold"></th>
                        <th className="px-4 py-3 text-left font-semibold">Nature</th>
                        <th className="px-4 py-3 text-left font-semibold">Date</th>
                        <th className="px-4 py-3 text-right font-semibold">Détails</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                      {paginatedChanges.map((change) => {
                        const establishment =
                          change.establishment ??
                          change.modification?.after ??
                          change.modification?.before ??
                          undefined
                        const displayName =
                          establishment?.name ??
                          change.modification?.id ??
                          establishment?.id ??
                          'Sans nom'
                        const details = formatEstablishmentDetails(establishment)
                        const certificationSource =
                          establishment?.source ??
                          change.modification?.after?.source ??
                          change.modification?.before?.source ??
                          null
                        const isExpandable = change.kind === 'modified' && change.modification
                        const isExpanded = Boolean(expandedRows[change.changeId])
                        const categories = getCategories(establishment)
                        const formattedDate = formatDate(change.date)

                        return (
                          <Fragment key={change.changeId}>
                            <tr
                              className={isExpandable ? 'cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50' : undefined}
                              onClick={
                                isExpandable
                                  ? () => toggleRow(change.changeId)
                                  : undefined
                              }
                              aria-expanded={isExpandable ? isExpanded : undefined}
                            >
                              <td className="px-4 py-3 align-top">
                                <div className="font-medium text-zinc-900 dark:text-zinc-100">
                                  {displayName}
                                </div>
                                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                                  {details}
                                </div>
                                <CategoryBadges categories={categories} />
                              </td>
                              <td className="px-4 py-3 align-center">
                                <CertificationIcon source={certificationSource ?? undefined} />
                              </td>
                              <td className="px-4 py-3 align-center">
                                <ChangeTypeBadge kind={change.kind} />
                              </td>
                              <td className="px-4 py-3 align-center text-xs text-zinc-500 dark:text-zinc-400">
                                {formattedDate}
                              </td>
                              <td className="px-4 py-3 text-right align-center">
                                {isExpandable && (
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      toggleRow(change.changeId)
                                    }}
                                    className="text-xs font-semibold text-amber-600 hover:underline dark:text-amber-300"
                                  >
                                    {isExpanded ? 'Masquer' : 'Voir détails'}
                                  </button>
                                )}
                              </td>
                            </tr>
                            {isExpandable && isExpanded && change.modification && (
                              <tr
                                className="bg-zinc-50 dark:bg-zinc-900/60"
                              >
                                <td colSpan={5} className="px-6 py-4 text-xs text-zinc-600 dark:text-zinc-300">
                                  {change.modification.changes.length > 0 ? (
                                    <dl className="grid gap-3 md:grid-cols-2">
                                      {change.modification.changes.map((changeItem, index) => {
                                        const label =
                                          MODIFICATION_FIELD_LABELS[changeItem.field] ??
                                          changeItem.field
                                        return (
                                          <div key={`${change.changeId}-${changeItem.field}-${index}`}>
                                            <dt className="font-semibold text-zinc-700 dark:text-zinc-200">
                                              {label}
                                            </dt>
                                            <dd className="mt-1 flex flex-col gap-1">
                                              <span>
                                                Avant: {formatChangeValue(changeItem.field, changeItem.before)}
                                              </span>
                                              <span>
                                                Après: {formatChangeValue(changeItem.field, changeItem.after)}
                                              </span>
                                            </dd>
                                          </div>
                                        )
                                      })}
                                    </dl>
                                  ) : (
                                    <p>Détails indisponibles pour cette modification.</p>
                                  )}
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {filteredChanges.length > 0 && (
                <div className="mt-4 flex flex-col gap-4 text-xs text-zinc-600 dark:text-zinc-300 md:flex-row md:items-center md:justify-between">
                  <div className="flex items-center gap-2">
                    <label htmlFor="page-size" className="font-semibold">
                      Lignes par page
                    </label>
                    <select
                      id="page-size"
                      value={pageSize}
                      onChange={(event) => {
                        const nextSize = Number(event.target.value)
                        if (!Number.isFinite(nextSize)) return
                        setPageSize(nextSize)
                        setCurrentPage(1)
                      }}
                      className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs font-medium text-zinc-700 shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:focus:border-zinc-500 dark:focus:ring-zinc-600"
                    >
                      {[10, 25, 50, 100].map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center justify-between gap-3 md:justify-end">
                    <button
                      type="button"
                      onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                      className="rounded-md border border-zinc-300 px-3 py-1 font-medium text-zinc-600 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                      disabled={currentPage <= 1}
                    >
                      Précédent
                    </button>
                    <span className="font-semibold">
                      Page {currentPage} sur {totalPages}
                    </span>
                    <button
                      type="button"
                      onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                      className="rounded-md border border-zinc-300 px-3 py-1 font-medium text-zinc-600 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                      disabled={currentPage >= totalPages}
                    >
                      Suivant
                    </button>
                  </div>
                </div>
              )}
            </section>

            <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-medium">Doublons détectés</h2>
                <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  {stats.duplicatesCount.toLocaleString('fr-FR')}
                </span>
              </div>
              {stats.duplicatesExamples?.length ? (
                <div className="mt-4 overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
                  <div className="max-h-96 overflow-y-auto">
                    <table className="min-w-full divide-y divide-zinc-200 dark:divide-zinc-800">
                      <thead className="sticky top-0 bg-white dark:bg-zinc-900">
                        <tr className="text-left text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                          <th className="w-16 px-4 py-2 font-semibold">#</th>
                          <th className="px-4 py-2 font-semibold">Original</th>
                          <th className="px-4 py-2 font-semibold">Doublon</th>
                          <th className="px-4 py-2 font-semibold">Sources</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
                        {stats.duplicatesExamples.map((dup, index) => {
                          const originalFiltersLabel = formatFilters(dup.original?.filter)
                          const duplicateFiltersLabel = formatFilters(dup.duplicate?.filter)

                          return (
                            <tr key={`${dup.original?.id ?? index}-${dup.duplicate?.id ?? 'dup'}`}>
                              <td className="px-4 py-3 text-xs text-zinc-500 dark:text-zinc-400">
                                {index + 1}
                              </td>
                              <td className="px-4 py-3">
                                <div className="font-medium">{dup.original?.name ?? 'Sans nom'}</div>
                                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                                  {formatEstablishmentDetails(dup.original)}
                                </div>
                                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                                  {dup.original?.address ?? '—'}
                                </div>
                                <CategoryBadges categories={getCategories(dup.original)} />
                                {originalFiltersLabel !== '—' && (
                                  <div className="text-xs text-zinc-500 dark:text-zinc-400">
                                    Filtres: {originalFiltersLabel}
                                  </div>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                <div className="font-medium">{dup.duplicate?.name ?? 'Sans nom'}</div>
                                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                                  {formatEstablishmentDetails(dup.duplicate)}
                                </div>
                                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                                  {dup.duplicate?.address ?? '—'}
                                </div>
                                <CategoryBadges categories={getCategories(dup.duplicate)} />
                                {duplicateFiltersLabel !== '—' && (
                                  <div className="text-xs text-zinc-500 dark:text-zinc-400">
                                    Filtres: {duplicateFiltersLabel}
                                  </div>
                                )}
                              </td>
                              <td className="px-4 py-3 text-xs text-zinc-500 dark:text-zinc-400">
                                <div>{dup.original?.source ?? '—'}</div>
                                <div>{dup.duplicate?.source ?? '—'}</div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">
                  Aucun doublon recensé sur la dernière synchronisation.
                </p>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  )
}

type StatCardProps = {
  label: string
  value: string
  secondary?: string
}

function StatCard({ label, value, secondary }: StatCardProps) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {label}
      </p>
      <p className="mt-3 text-2xl font-bold text-zinc-900 dark:text-zinc-100">{value}</p>
      {secondary && (
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400" title={secondary}>
          {secondary}
        </p>
      )}
    </div>
  )
}

type CategoryBadgesProps = {
  categories: string[]
}

function CategoryBadges({ categories }: CategoryBadgesProps) {
  if (!categories || categories.length === 0) return null
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {categories.map((category) => (
        <span
          key={category}
          className="inline-flex items-center rounded-full bg-zinc-200 px-2 py-1 text-[11px] font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
        >
          {category}
        </span>
      ))}
    </div>
  )
}
