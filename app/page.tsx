'use client'

import { useCallback, useMemo, useState } from 'react'
import MapView from './components/MapView'

type Establishment = {
  id?: string
  name?: string
  address?: string
  city?: string
  source?: string
  categories?: string[]
  lat?: number
  lng?: number
  entryDate?: unknown
  certifiedAt?: unknown
  startDate?: unknown
  createdAt?: unknown
  updatedAt?: unknown
}

type DecertifiedEstablishment = Establishment & {
  exitDate?: unknown
}

const getEntryDateValue = (establishment: Establishment) =>
  establishment?.entryDate ??
  establishment?.certifiedAt ??
  establishment?.startDate ??
  establishment?.createdAt ??
  establishment?.updatedAt ??
  null

const getExitDateValue = (establishment: DecertifiedEstablishment) =>
  establishment?.exitDate ?? establishment?.updatedAt ?? null

const getDateMeta = (
  value: unknown,
  formatter: Intl.DateTimeFormat,
  fallbackLabel = 'Date inconnue',
) => {
  if (!value) {
    return { formatted: fallbackLabel, sortValue: Number.NEGATIVE_INFINITY }
  }
  if (value instanceof Date) {
    const time = value.getTime()
    if (Number.isNaN(time)) return { formatted: fallbackLabel, sortValue: Number.NEGATIVE_INFINITY }
    return { formatted: formatter.format(value), sortValue: time }
  }
  if (typeof value === 'number') {
    const date = new Date(value)
    const time = date.getTime()
    if (Number.isNaN(time)) return { formatted: fallbackLabel, sortValue: Number.NEGATIVE_INFINITY }
    return { formatted: formatter.format(date), sortValue: time }
  }
  if (typeof value === 'string') {
    const date = new Date(value)
    const time = date.getTime()
    if (Number.isNaN(time)) {
      return { formatted: value, sortValue: Number.NEGATIVE_INFINITY }
    }
    return { formatted: formatter.format(date), sortValue: time }
  }
  return { formatted: fallbackLabel, sortValue: Number.NEGATIVE_INFINITY }
}

export default function Home() {
  const [visibleEstablishments, setVisibleEstablishments] = useState<Establishment[]>([])
  const [decertifiedEstablishments, setDecertifiedEstablishments] = useState<DecertifiedEstablishment[]>([])
  
  const handleVisibleChange = useCallback((items: any[]) => {
    setVisibleEstablishments(items as Establishment[])
  }, [])
  
  const handleDecertifiedChange = useCallback((items: any[]) => {
    if (Array.isArray(items)) {
      setDecertifiedEstablishments(items as DecertifiedEstablishment[])
    } else {
      setDecertifiedEstablishments([])
    }
  }, [])

  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat('fr-FR', {
        dateStyle: 'medium',
      }),
    [],
  )

  const visibleWithMeta = useMemo(() => {
    return visibleEstablishments
      .map((establishment) => {
        const rawDate = getEntryDateValue(establishment)
        const { formatted, sortValue } = getDateMeta(rawDate, dateFormatter)
        return {
          establishment,
          formattedDate: formatted,
          sortValue,
          rawDate,
        }
      })
      .sort((a, b) => b.sortValue - a.sortValue)
  }, [dateFormatter, visibleEstablishments])

  const decertifiedWithMeta = useMemo(() => {
    return decertifiedEstablishments
      .map((establishment) => {
        const rawDate = getExitDateValue(establishment)
        const { formatted, sortValue } = getDateMeta(rawDate, dateFormatter, 'Date de sortie inconnue')
        return {
          establishment,
          formattedDate: formatted,
          sortValue,
        }
      })
      .sort((a, b) => b.sortValue - a.sortValue)
  }, [dateFormatter, decertifiedEstablishments])

  return (
    <div className="min-h-screen bg-white dark:bg-black">
      {/* Hero Section */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-blue-50/50 via-transparent to-transparent dark:from-blue-950/20" />
        
        <div className="relative max-w-7xl mx-auto px-6 sm:px-8 lg:px-12 pt-20 pb-16 sm:pt-32 sm:pb-24">
          <div className="text-center max-w-4xl mx-auto mb-16">
            <h1 className="text-6xl sm:text-7xl lg:text-8xl font-bold tracking-tight mb-6 bg-gradient-to-br from-zinc-900 via-zinc-800 to-zinc-600 dark:from-white dark:via-zinc-100 dark:to-zinc-400 bg-clip-text text-transparent">
              Certified.
            </h1>
            <p className="text-xl sm:text-2xl font-medium text-zinc-900 dark:text-white mb-4">
              Boucheries, Restaurants, Fournisseurs...
            </p>
            <p className="text-lg sm:text-xl text-zinc-600 dark:text-zinc-400 max-w-2xl mx-auto leading-relaxed">
              Découvrez des établissements et fournisseurs de confiance, rigoureusement vérifiés pour garantir la qualité et la sécurité de vos achats.
            </p>
          </div>

          <div className="rounded-3xl overflow-hidden shadow-2xl border border-black/5 dark:border-white/10">
            <MapView
              onVisibleCertifiedChange={handleVisibleChange}
              onDecertifiedChange={handleDecertifiedChange}
            />
          </div>
        </div>
      </div>

      {/* Content Sections */}
      <div className="max-w-7xl mx-auto px-6 sm:px-8 lg:px-12 py-16 space-y-20">
        {/* Établissements visibles */}
        <section>
          <div className="flex items-center justify-between mb-8">
            <div>
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-zinc-900 dark:text-white">
                Établissements certifiés
              </h2>
              <p className="text-base text-zinc-600 dark:text-zinc-400 mt-2">
                {visibleWithMeta.length} {visibleWithMeta.length > 1 ? 'établissements trouvés' : 'établissement trouvé'}
              </p>
            </div>
          </div>

          {visibleWithMeta.length === 0 ? (
            <div className="text-center py-20 px-6 rounded-3xl bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center">
                <svg className="w-8 h-8 text-zinc-400 dark:text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <p className="text-zinc-600 dark:text-zinc-400">
                Déplacez la carte pour découvrir des établissements certifiés
              </p>
            </div>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {visibleWithMeta.map(({ establishment, formattedDate }) => {
                const categories = Array.isArray(establishment?.categories)
                  ? establishment.categories.filter(Boolean)
                  : []

                return (
                  <div
                    key={establishment?.id ?? `${establishment?.lat}-${establishment?.lng}-${establishment?.name}`}
                    className="group relative rounded-3xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 overflow-hidden transition-all duration-300 hover:scale-[1.02] hover:shadow-2xl hover:shadow-blue-500/10"
                  >
                    <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-indigo-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                    
                    <div className="relative p-6 space-y-4">
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="text-lg font-semibold text-zinc-900 dark:text-white leading-tight flex-1">
                          {establishment?.name ?? 'Nom inconnu'}
                        </h3>
                        <div className="flex-shrink-0 w-10 h-10 rounded-full bg-green-500/10 flex items-center justify-center">
                          <svg className="w-5 h-5 text-green-600 dark:text-green-500" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                          </svg>
                        </div>
                      </div>

                      <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
                        {establishment?.address ?? establishment?.city ?? 'Adresse inconnue'}
                      </p>

                      <div className="flex flex-wrap gap-2 pt-2">
                        <span className="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400">
                          {formattedDate}
                        </span>
                        <span className="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400">
                          {establishment?.source ?? 'Source inconnue'}
                        </span>
                        {categories.map((category: string) => (
                          <span
                            key={`${establishment?.id ?? establishment?.name}-category-${category}`}
                            className="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                          >
                            {category}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {/* Établissements décertifiés */}
        <section>
          <div className="flex items-center justify-between mb-8">
            <div>
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-zinc-900 dark:text-white">
                Anciens établissements
              </h2>
              <p className="text-base text-zinc-600 dark:text-zinc-400 mt-2">
                {decertifiedWithMeta.length} {decertifiedWithMeta.length > 1 ? 'établissements sortis' : 'établissement sorti'}
              </p>
            </div>
          </div>

          {decertifiedWithMeta.length === 0 ? (
            <div className="text-center py-20 px-6 rounded-3xl bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center">
                <svg className="w-8 h-8 text-zinc-400 dark:text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="text-zinc-600 dark:text-zinc-400">
                Aucun établissement sorti récemment
              </p>
            </div>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {decertifiedWithMeta.map(({ establishment, formattedDate }) => {
                const categories = Array.isArray(establishment?.categories)
                  ? establishment.categories.filter(Boolean)
                  : []

                return (
                  <div
                    key={establishment?.id ?? `${establishment?.lat}-${establishment?.lng}-${establishment?.name}-removed`}
                    className="group relative rounded-3xl bg-white dark:bg-zinc-900 border border-red-200 dark:border-red-900/50 overflow-hidden transition-all duration-300 hover:scale-[1.02] hover:shadow-2xl hover:shadow-red-500/10"
                  >
                    <div className="absolute inset-0 bg-gradient-to-br from-red-500/5 to-orange-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                    
                    <div className="relative p-6 space-y-4">
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="text-lg font-semibold text-zinc-900 dark:text-white leading-tight flex-1">
                          {establishment?.name ?? 'Nom inconnu'}
                        </h3>
                        <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center">
                          <svg className="w-5 h-5 text-red-600 dark:text-red-500" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                          </svg>
                        </div>
                      </div>

                      <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
                        {establishment?.address ?? establishment?.city ?? 'Adresse inconnue'}
                      </p>

                      <div className="flex flex-wrap gap-2 pt-2">
                        <span className="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400">
                          Sorti : {formattedDate}
                        </span>
                        <span className="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400">
                          {establishment?.source ?? 'Source inconnue'}
                        </span>
                        {categories.map((category: string) => (
                          <span
                            key={`${establishment?.id ?? establishment?.name}-removed-category-${category}`}
                            className="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                          >
                            {category}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </div>

      {/* Footer */}
      <footer className="border-t border-zinc-200 dark:border-zinc-800 mt-32">
        <div className="max-w-7xl mx-auto px-6 sm:px-8 lg:px-12 py-12">
          <p className="text-center text-sm text-zinc-600 dark:text-zinc-400">
            © 2025 Certified. Tous droits réservés.
          </p>
        </div>
      </footer>
    </div>
  )
}