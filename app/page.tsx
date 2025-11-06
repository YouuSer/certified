'use client'

import { matchesCategoryFilter, type CategoryFilter } from '@/lib/categoryFilter'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

type Coordinates = {
  lat: number
  lng: number
}

const CERTIFICATION_ICON_MAP: Record<string, { src: string; alt: string }> = {
  avs: { src: '/icons/avs.png', alt: 'Certification AVS' },
  achahada: { src: '/icons/achahada.png', alt: 'Certification Achahada' },
  achada: { src: '/icons/achahada.png', alt: 'Certification Achada' },
  ach: { src: '/icons/ach.png', alt: 'Certification ACH' },
}

const CATEGORY_FILTER_OPTIONS: Array<{ value: CategoryFilter; label: string }> = [
  { value: 'all', label: 'Tous' },
  { value: 'restaurants', label: 'Restaurants' },
  { value: 'boucheries', label: 'Boucheries' },
  { value: 'others', label: 'Autres' },
]

const getCertificationIcon = (source?: string) => {
  if (!source) return null
  const normalized = source.trim().toLowerCase()
  return CERTIFICATION_ICON_MAP[normalized] ?? null
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

const DEG_TO_RAD = Math.PI / 180
const EARTH_RADIUS_KM = 6371

const computeDistanceMetadata = (
  reference: Coordinates,
  establishment: Establishment,
): { distanceKm: number } | null => {
  const lat =
    typeof establishment?.lat === 'number' && !Number.isNaN(establishment.lat)
      ? establishment.lat
      : null
  const lng =
    typeof establishment?.lng === 'number' && !Number.isNaN(establishment.lng)
      ? establishment.lng
      : null

  if (
    lat === null ||
    lng === null ||
    Number.isNaN(reference.lat) ||
    Number.isNaN(reference.lng)
  ) {
    return null
  }

  const originLat = reference.lat * DEG_TO_RAD
  const targetLat = lat * DEG_TO_RAD
  const deltaLat = (lat - reference.lat) * DEG_TO_RAD
  const deltaLng = (lng - reference.lng) * DEG_TO_RAD

  const sinLat = Math.sin(deltaLat * 0.5)
  const sinLng = Math.sin(deltaLng * 0.5)
  const a = sinLat * sinLat + Math.cos(originLat) * Math.cos(targetLat) * sinLng * sinLng
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)))
  const distanceKm = EARTH_RADIUS_KM * c

  if (!Number.isFinite(distanceKm)) {
    return null
  }

  return { distanceKm }
}

const formatDistanceLabel = (distanceKm: number) => {
  if (!Number.isFinite(distanceKm)) return null
  if (distanceKm >= 100) {
    return `${Math.round(distanceKm)} km`
  }
  if (distanceKm >= 1) {
    return `${Number.parseFloat(distanceKm.toFixed(1))} km`
  }
  const meters = Math.round(distanceKm * 1000)
  if (meters <= 0) return '<1 m'
  return `${meters} m`
}

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
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all')
  const [focusedEstablishment, setFocusedEstablishment] = useState<{
    id?: string
    lat: number
    lng: number
    timestamp: number
  } | null>(null)
  const [userPosition, setUserPosition] = useState<Coordinates | null>(null)
  const isUnmountedRef = useRef(false)

  const requestUserLocation = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setUserPosition(null)
      return
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (isUnmountedRef.current) return
        const { latitude, longitude } = position.coords
        if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
          setUserPosition({ lat: latitude, lng: longitude })
          return
        }
        setUserPosition(null)
      },
      () => {
        if (isUnmountedRef.current) return
        setUserPosition(null)
      },
      { enableHighAccuracy: true, maximumAge: 300_000, timeout: 5_000 },
    )
  }, [])

  useEffect(() => {
    isUnmountedRef.current = false
    requestUserLocation()
    return () => {
      isUnmountedRef.current = true
    }
  }, [requestUserLocation])
  
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

  const focusOnEstablishment = useCallback((establishment?: Establishment) => {
    if (!establishment) return
    const { lat, lng, id, name } = establishment
    if (
      typeof lat !== 'number' ||
      Number.isNaN(lat) ||
      typeof lng !== 'number' ||
      Number.isNaN(lng)
    ) {
      return
    }

    const identifier = id ?? `${lat}-${lng}-${name ?? 'establishment'}`
    setFocusedEstablishment({
      id: identifier,
      lat,
      lng,
      timestamp: Date.now(),
    })
  }, [])

  const clearFocus = useCallback(() => {
    setFocusedEstablishment(null)
  }, [])

  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat('fr-FR', {
        dateStyle: 'medium',
      }),
    [],
  )

  const categoryCounts = useMemo<Record<CategoryFilter, number>>(() => {
    const source = [...visibleEstablishments, ...decertifiedEstablishments]
    return {
      all: source.length,
      restaurants: source.filter((establishment) => matchesCategoryFilter(establishment, 'restaurants'))
        .length,
      boucheries: source.filter((establishment) => matchesCategoryFilter(establishment, 'boucheries'))
        .length,
      others: source.filter((establishment) => matchesCategoryFilter(establishment, 'others')).length,
    }
  }, [decertifiedEstablishments, visibleEstablishments])

  const filteredVisibleEstablishments = useMemo(
    () =>
      visibleEstablishments.filter((establishment) =>
        matchesCategoryFilter(establishment, categoryFilter),
      ),
    [categoryFilter, visibleEstablishments],
  )

  const filteredDecertifiedEstablishments = useMemo(
    () =>
      decertifiedEstablishments.filter((establishment) =>
        matchesCategoryFilter(establishment, categoryFilter),
      ),
    [categoryFilter, decertifiedEstablishments],
  )

  const certificationSummaries = useMemo(() => {
    const counts = new Map<
      string,
      {
        count: number
        icon: { src: string; alt: string }
      }
    >()

    filteredVisibleEstablishments.forEach((establishment) => {
      const source = typeof establishment?.source === 'string' ? establishment.source : null
      if (!source) return

      const normalized = source.trim().toLowerCase()
      if (!normalized) return

      const icon = getCertificationIcon(source)
      if (!icon) return

      const snapshot = counts.get(normalized)
      if (snapshot) {
        snapshot.count += 1
      } else {
        counts.set(normalized, { count: 1, icon })
      }
    })

    return Array.from(counts.entries())
      .map(([key, value]) => ({ key, ...value }))
      .sort((a, b) => b.count - a.count)
  }, [filteredVisibleEstablishments])

  const visibleWithMeta = useMemo(() => {
    return filteredVisibleEstablishments
      .map((establishment) => {
        const rawDate = getEntryDateValue(establishment)
        const { formatted, sortValue } = getDateMeta(rawDate, dateFormatter)
        const distanceMeta = userPosition ? computeDistanceMetadata(userPosition, establishment) : null
        const distanceKm = distanceMeta?.distanceKm ?? null
        const distanceLabel = distanceKm !== null ? formatDistanceLabel(distanceKm) : null
        return {
          establishment,
          formattedDate: formatted,
          sortValue,
          rawDate,
          distanceKm,
          distanceLabel,
        }
      })
      .sort((a, b) => {
        if (userPosition) {
          const left = typeof a.distanceKm === 'number' ? a.distanceKm : Number.POSITIVE_INFINITY
          const right = typeof b.distanceKm === 'number' ? b.distanceKm : Number.POSITIVE_INFINITY
          if (left !== right) {
            return left - right
          }
        }
        return b.sortValue - a.sortValue
      })
  }, [dateFormatter, filteredVisibleEstablishments, userPosition])

  const decertifiedWithMeta = useMemo(() => {
    return filteredDecertifiedEstablishments
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
  }, [dateFormatter, filteredDecertifiedEstablishments])

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

          <div className="flex flex-wrap items-center justify-center gap-3 mb-10 sm:mb-12">
            {CATEGORY_FILTER_OPTIONS.map(({ value, label }) => {
              const isActive = value === categoryFilter
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setCategoryFilter(value)}
                  aria-pressed={isActive}
                  className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium backdrop-blur transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${
                    isActive
                      ? 'border-blue-500/80 bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-[0_8px_16px_rgba(37,99,235,0.25)] dark:border-blue-400/70'
                      : 'border-white/50 bg-white/70 text-zinc-700 shadow-[0_4px_12px_rgba(15,23,42,0.08)] hover:bg-white/90 dark:border-white/10 dark:bg-zinc-900/60 dark:text-zinc-200 dark:hover:bg-zinc-900/80 dark:shadow-[0_4px_12px_rgba(15,23,42,0.45)]'
                  }`}
                >
                  <span className="font-semibold">{label}</span>
                  <span
                    className={`inline-flex h-6 min-w-[1.75rem] items-center justify-center rounded-full border px-2 text-xs font-semibold ${
                      isActive
                        ? 'border-white/50 bg-white/20 text-white'
                        : 'border-white/60 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100'
                    }`}
                  >
                    {categoryCounts[value]}
                  </span>
                </button>
              )
            })}
          </div>

          <div className="rounded-3xl overflow-hidden shadow-2xl border border-black/5 dark:border-white/10">
            <MapView
              onVisibleCertifiedChange={handleVisibleChange}
              onDecertifiedChange={handleDecertifiedChange}
              categoryFilter={categoryFilter}
              focusedEstablishment={focusedEstablishment}
              onClearFocus={clearFocus}
              onFocusEstablishment={focusOnEstablishment}
              userLocation={userPosition}
              onRequestUserLocation={requestUserLocation}
            />
          </div>
        </div>
      </div>

      {/* Content Sections */}
      <div className="max-w-7xl mx-auto px-6 sm:px-8 lg:px-12 py-16 space-y-20">
        {/* Établissements visibles */}
        <section>
          <div className="mb-8 flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-zinc-900 dark:text-white">
                Établissements certifiés
              </h2>
              <p className="text-base text-zinc-600 dark:text-zinc-400 mt-2">
                {visibleWithMeta.length} {visibleWithMeta.length > 1 ? 'établissements trouvés' : 'établissement trouvé'}
              </p>
            </div>
            {certificationSummaries.length > 0 && (
              <div className="flex flex-wrap justify-end gap-4">
                {certificationSummaries.map(({ key, count, icon }) => (
                  <div
                    key={key}
                    className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white px-4 py-3 shadow-sm transition hover:-translate-y-1 hover:shadow-lg dark:border-zinc-800 dark:bg-zinc-900"
                  >
                    <span className="flex size-11 items-center justify-center rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-950">
                      <img src={icon.src} alt={icon.alt} className="h-7 w-7 rounded-full object-contain" />
                    </span>
                    <div className="leading-tight">
                      <p className="text-sm font-semibold text-zinc-900 dark:text-white">{icon.alt}</p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        {count} {count > 1 ? 'établissements visibles' : 'établissement visible'}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
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
              {visibleWithMeta.map(({ establishment, formattedDate, distanceLabel }) => {
                const categories = Array.isArray(establishment?.categories)
                  ? establishment.categories.filter(Boolean)
                  : []
                const certificationSource =
                  typeof establishment?.source === 'string' && establishment.source.trim().length > 0
                    ? establishment.source
                    : undefined
                const certificationIcon = getCertificationIcon(certificationSource)

                return (
                  <div
                    key={establishment?.id ?? `${establishment?.lat}-${establishment?.lng}-${establishment?.name}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => focusOnEstablishment(establishment)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
                        event.preventDefault()
                        focusOnEstablishment(establishment)
                      }
                    }}
                    className="group relative rounded-3xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 overflow-hidden transition-all duration-300 hover:scale-[1.02] hover:shadow-2xl hover:shadow-blue-500/10 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
                  >
                    <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-indigo-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                    
                    <div className="relative p-6 space-y-4">
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="text-lg font-semibold text-zinc-900 dark:text-white leading-tight flex-1">
                          {establishment?.name ?? 'Nom inconnu'}
                        </h3>
                        <div className="flex-shrink-0">
                          {certificationIcon ? (
                            <span className="flex size-11 items-center justify-center rounded-full border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
                              <img
                                src={certificationIcon.src}
                                alt={certificationIcon.alt}
                                className="rounded-full object-contain"
                              />
                            </span>
                          ) : (
                            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-green-500/10">
                              <svg className="h-5 w-5 text-green-600 dark:text-green-500" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                              </svg>
                            </span>
                          )}
                        </div>
                      </div>

                      <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
                        {establishment?.address ?? establishment?.city ?? 'Adresse inconnue'}
                      </p>

                      <div className="flex flex-wrap items-center gap-2 pt-2">
                        <span className="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400">
                          {formattedDate}
                        </span>
                        {categories.map((category: string) => (
                          <span
                            key={`${establishment?.id ?? establishment?.name}-category-${category}`}
                            className="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                          >
                            {category}
                          </span>
                        ))}
                        {distanceLabel ? (
                          <span className="ml-auto inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                            {distanceLabel}
                          </span>
                        ) : null}
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
                const certificationSource =
                  typeof establishment?.source === 'string' && establishment.source.trim().length > 0
                    ? establishment.source
                    : undefined
                const certificationIcon = getCertificationIcon(certificationSource)

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
                        <div className="flex-shrink-0">
                          {certificationIcon ? (
                            <span className="flex size-11 items-center justify-center rounded-full border border-red-200 bg-white shadow-sm dark:border-red-900 dark:bg-zinc-900">
                              <img
                                src={certificationIcon.src}
                                alt={certificationIcon.alt}
                                className="rounded-full object-contain"
                              />
                            </span>
                          ) : (
                            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-red-500/10">
                              <svg className="w-5 h-5 text-red-600 dark:text-red-500" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                              </svg>
                            </span>
                          )}
                        </div>
                      </div>

                      <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
                        {establishment?.address ?? establishment?.city ?? 'Adresse inconnue'}
                      </p>

                      <div className="flex flex-wrap gap-2 pt-2">
                        <span className="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400">
                          Sorti : {formattedDate}
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
