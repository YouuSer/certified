'use client'

import { useEffect, useMemo, useState } from 'react'
import { collection, doc, getDoc, getDocs, limit, orderBy, query } from 'firebase/firestore'

import { db } from '@/lib/firebase'

type Establishment = {
  id?: string
  name?: string
  city?: string
  address?: string
  source?: string
  categories?: string[]
  filter?: number[]
}

type DuplicateSnapshot = {
  count?: number
  examples?: Array<{ original?: Establishment; duplicate?: Establishment }>
  date?: string
}

type DiagnosticsSnapshot = {
  pointsCount: number
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
  modified: Establishment[]
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

  useEffect(() => {
    const loadStats = async () => {
      try {
        const [estSnapshot, metaSnapshot, dupSnapshot, changelogSnapshot] = await Promise.all([
          getDocs(collection(db, 'establishments')),
          getDoc(doc(db, 'meta', 'lastRefresh')),
          getDoc(doc(db, 'duplicates', 'latest')),
          getDocs(query(collection(db, 'changelog'), orderBy('date', 'desc'), limit(1))),
        ])

        const establishments = estSnapshot.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Establishment),
        }))

        const uniqueNames = new Set(
          establishments
            .map((e) => e.name?.trim().toLowerCase())
            .filter((e): e is string => Boolean(e)),
        )

        const meta = metaSnapshot.exists()
          ? (metaSnapshot.data() as Partial<DiagnosticsSnapshot['metaCounts']> & {
              date?: string
            })
          : undefined

        const latestDuplicates = dupSnapshot.exists()
          ? (dupSnapshot.data() as DuplicateSnapshot)
          : undefined
        const latestChangelog = changelogSnapshot.docs[0]?.data() as
          | (DiagnosticsSnapshot['metaCounts'] & {
              date?: string
              added?: Establishment[]
              removed?: Establishment[]
              modified?: Establishment[]
            })
          | undefined

        setStats({
          pointsCount: establishments.length,
          establishmentsCount: uniqueNames.size,
          duplicatesCount: latestDuplicates?.count ?? 0,
          duplicatesExamples: latestDuplicates?.examples ?? [],
          lastRefresh: meta?.date,
          metaCounts: {
            added: meta?.added ?? latestChangelog?.added?.length ?? 0,
            removed: meta?.removed ?? latestChangelog?.removed?.length ?? 0,
            modified: meta?.modified ?? latestChangelog?.modified?.length ?? 0,
          },
          added: latestChangelog?.added ?? [],
          removed: latestChangelog?.removed ?? [],
          modified: latestChangelog?.modified ?? [],
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

  const lastChanges = useMemo(
    () =>
      stats
        ? [
            { label: 'Ajouts', items: stats.added },
            { label: 'Suppressions', items: stats.removed },
            { label: 'Modifications', items: stats.modified },
          ]
        : [],
    [stats],
  )

  return (
    <div className="min-h-screen bg-zinc-100 p-8 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-10">
        <header className="space-y-2">
          <h1 className="text-3xl font-semibold">Diagnostics Firestore</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Suivi des synchronisations Achahada / AVS sauvegardées dans Firestore.
          </p>
        </header>

        {loading && <p className="text-sm text-zinc-500">Chargement des statistiques...</p>}
        {error && <p className="text-sm text-red-500">{error}</p>}

        {!loading && !error && stats && (
          <>
            <section className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
              <StatCard label="Points" value={stats.pointsCount.toLocaleString('fr-FR')} />
              <StatCard
                label="Établissements uniques"
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
              <h2 className="text-lg font-medium">Derniers changements</h2>
              <div className="mt-4 grid gap-6 md:grid-cols-3">
                {lastChanges.map(({ label, items }) => (
                  <div key={label} className="space-y-3">
                    <div className="flex items-baseline justify-between">
                      <span className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                        {label}
                      </span>
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">
                        {items.length.toLocaleString('fr-FR')}
                      </span>
                    </div>
                    {items.length === 0 ? (
                      <p className="text-sm text-zinc-500 dark:text-zinc-400">Rien à signaler.</p>
                    ) : (
                      <ul className="space-y-2 text-sm">
                        {items.slice(0, 5).map((item) => {
                          const categories = getCategories(item)
                          return (
                            <li
                              key={item.id ?? `${item.name}-${item.city}-${label}`}
                              className="rounded-md bg-zinc-100 p-3 dark:bg-zinc-800"
                            >
                              <p className="font-medium">{item.name ?? 'Sans nom'}</p>
                              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                {formatEstablishmentDetails(item)}
                              </p>
                              <CategoryBadges categories={categories} />
                            </li>
                          )
                        })}
                        {items.length > 5 && (
                          <li className="text-xs text-zinc-500 dark:text-zinc-400">
                            + {items.length - 5} élément(s) supplémentaire(s)
                          </li>
                        )}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
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
