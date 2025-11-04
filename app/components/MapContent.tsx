'use client'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useMemo, useState } from 'react'
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet'

const achahadaIcon = new L.DivIcon({
  html: `
    <div style="
      width: 40px;
      height: 40px;
      border-radius: 25%;
      overflow: hidden;
      box-shadow: 0 0 4px rgba(0,0,0,0.3);
      background-color: oklch(98.5% 0 0);
      display: flex; align-items: center; justify-content: center;
    ">
      <img
        src="/icons/achahada.png"
        style="width: 100%; height: 100%; object-fit: scale-down;"
      />
    </div>
  `,
  className: '',
  iconSize: [40, 40],
  iconAnchor: [20, 40],
  popupAnchor: [0, -40],
})

const avsIcon = new L.DivIcon({
  html: `
    <div style="
      width: 40px;
      height: 40px;
      border-radius: 25%;
      overflow: hidden;
      box-shadow: 0 0 4px rgba(0,0,0,0.3);
    ">
      <img
        src="/icons/avs.png"
        style="width: 100%; height: 100%; object-fit: cover;"
      />
    </div>
  `,
  className: '',
  iconSize: [40, 40],
  iconAnchor: [20, 40],
  popupAnchor: [0, -40],
})

type ClusterIconKind = 'achahada' | 'avs' | 'mixed' | 'default'

const clusterIconCache = new Map<string, L.DivIcon>()

const buildClusterIconHtml = (kind: ClusterIconKind, size: number) => {
  if (kind === 'achahada') {
    return `
      <div style="
        width: ${size}px;
        height: ${size}px;
        border-radius: 25%;
        overflow: hidden;
        box-shadow: 0 0 4px rgba(0,0,0,0.35);
        background: oklch(98.5% 0 0);
        display: flex;
        align-items: center;
        justify-content: center;
      ">
        <img src="/icons/achahada.png" style="width: 100%; height: 100%; object-fit: cover;" />
      </div>
    `
  }
  if (kind === 'avs') {
    return `
      <div style="
        width: ${size}px;
        height: ${size}px;
        border-radius: 25%;
        overflow: hidden;
        box-shadow: 0 0 4px rgba(0,0,0,0.35);
        display: flex;
        align-items: center;
        justify-content: center;
      ">
        <img src="/icons/avs.png" style="width: 100%; height: 100%; object-fit: cover;" />
      </div>
    `
  }
  if (kind === 'mixed') {
    return `
      <div style="
        width: ${size}px;
        height: ${size}px;
        border-radius: 50%;
        overflow: hidden;
        box-shadow: 0 0 4px rgba(0,0,0,0.35);
        display: flex;
      ">
        <div style="
          flex: 1;
          background: oklch(98.5% 0 0);
          display: flex;
          align-items: center;
          justify-content: center;
        ">
          <img src="/icons/achahada.png" style="width: 70%; height: 70%; object-fit: contain;" />
        </div>
        <div style="
          flex: 1;
          background: #f4e6f0;
          display: flex;
          align-items: center;
          justify-content: center;
        ">
          <img src="/icons/avs.png" style="width: 70%; height: 70%; object-fit: contain;" />
        </div>
      </div>
    `
  }
  return `
    <div style="
      width: ${size}px;
      height: ${size}px;
      border-radius: 50%;
      overflow: hidden;
      box-shadow: 0 0 4px rgba(0,0,0,0.35);
      background: linear-gradient(135deg, #1f2937, #4b5563);
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      font-weight: 700;
    ">
      ?
    </div>
  `
}

const getClusterIcon = (kind: ClusterIconKind, count: number) => {
  const size = 40
  const displayCount = count > 99 ? '99+' : `${count}`
  const cacheKey = `${kind}-${displayCount}`
  const cached = clusterIconCache.get(cacheKey)
  if (cached) return cached

  const icon = new L.DivIcon({
    html: `
      <div style="position: relative; width: ${size}px; height: ${size}px;">
        ${buildClusterIconHtml(kind, size)}
        <div style="
          position: absolute;
          top: -6px;
          right: -6px;
          width: 22px;
          height: 22px;
          border-radius: 50%;
          background: oklch(37.1% 0 0);
          color: #ffffff;
          font-size: 0.75rem;
          font-weight: 700;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 0 4px rgba(0,0,0,0.35);
        ">
          ${displayCount}
        </div>
      </div>
    `,
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
    popupAnchor: [0, -size],
  })
  clusterIconCache.set(cacheKey, icon)
  return icon
}

const getClusterRadius = (zoom: number) => {
  if (zoom >= 16) return 26
  if (zoom >= 14) return 34
  if (zoom >= 12) return 42
  if (zoom >= 10) return 52
  return 64
}

type ClusterAccumulator = {
  points: any[]
  layerPoint: L.Point
  sumLat: number
  sumLng: number
  lat: number
  lng: number
}

type ClusterResult = {
  points: any[]
  lat: number
  lng: number
  isCluster: boolean
}

const clusterPoints = (points: any[], map: L.Map): ClusterResult[] => {
  const zoom = map.getZoom()
  const radius = getClusterRadius(zoom)

  const clusters: ClusterAccumulator[] = []
  for (const point of points) {
    if (
      !point ||
      typeof point.lat !== 'number' ||
      typeof point.lng !== 'number' ||
      Number.isNaN(point.lat) ||
      Number.isNaN(point.lng)
    ) {
      continue
    }

    const layerPoint = map.latLngToLayerPoint([point.lat, point.lng])
    let target: ClusterAccumulator | undefined
    for (const existing of clusters) {
      if (layerPoint.distanceTo(existing.layerPoint) <= radius) {
        target = existing
        break
      }
    }

    if (!target) {
      clusters.push({
        points: [point],
        layerPoint,
        sumLat: point.lat,
        sumLng: point.lng,
        lat: point.lat,
        lng: point.lng,
      })
    } else {
      target.points.push(point)
      target.sumLat += point.lat
      target.sumLng += point.lng
      const length = target.points.length
      target.lat = target.sumLat / length
      target.lng = target.sumLng / length
      target.layerPoint = map.latLngToLayerPoint([target.lat, target.lng])
    }
  }

  return clusters.map((cluster) => ({
    points: cluster.points,
    lat: cluster.lat,
    lng: cluster.lng,
    isCluster: cluster.points.length > 1,
  }))
}

const normalizeSource = (source?: string) => {
  if (!source) return ''
  const lower = source.toLowerCase()
  if (lower.includes('achahada')) return 'achahada'
  if (lower.includes('avs')) return 'avs'
  return lower
}

export default function MapContent() {
  const [points, setPoints] = useState<any[]>([])
  const [darkMode, setDarkMode] = useState(false)
  const [visibleCertified, setVisibleCertified] = useState<any[]>([])
  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat('fr-FR', {
        dateStyle: 'medium',
      }),
    [],
  )

  const getEntryDateValue = (establishment: any) =>
    establishment?.entryDate ??
    establishment?.certifiedAt ??
    establishment?.startDate ??
    establishment?.createdAt ??
    establishment?.updatedAt ??
    null

  const formatEntryDate = (value: unknown) => {
    if (!value) return 'Date inconnue'
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? 'Date inconnue' : dateFormatter.format(value)
    }
    if (typeof value === 'number') {
      const date = new Date(value)
      return Number.isNaN(date.getTime()) ? 'Date inconnue' : dateFormatter.format(date)
    }
    if (typeof value === 'string') {
      const date = new Date(value)
      return Number.isNaN(date.getTime()) ? value : dateFormatter.format(date)
    }
    return 'Date inconnue'
  }

  const visibleCertifiedSorted = useMemo(() => {
    const entries = visibleCertified.map((establishment) => ({
      establishment,
      rawDate: getEntryDateValue(establishment),
    }))

    entries.sort((a, b) => {
      const timeA = Date.parse(`${a.rawDate ?? ''}`)
      const timeB = Date.parse(`${b.rawDate ?? ''}`)
      if (Number.isNaN(timeA) && Number.isNaN(timeB)) return 0
      if (Number.isNaN(timeA)) return 1
      if (Number.isNaN(timeB)) return -1
      return timeB - timeA
    })

    return entries
  }, [visibleCertified])

  // --- Détecter le thème système ---
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    setDarkMode(mq.matches)
    const listener = (e: MediaQueryListEvent) => setDarkMode(e.matches)
    mq.addEventListener('change', listener)
    return () => mq.removeEventListener('change', listener)
  }, [])

  // --- Charger les points ---
  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch('/api/data')
        const data = await res.json()
        setPoints(data)
      } catch (err) {
        console.error('Erreur:', err)
      }
    }
    fetchData()
  }, [])

  // --- Choisir la tuile selon le mode ---
  const tileUrl = darkMode
    ? 'https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png'
    : 'https://tiles.stadiamaps.com/tiles/osm_bright/{z}/{x}/{y}{r}.png'

  return (
    <div
      style={{
        display: 'flex',
        gap: '24px',
        alignItems: 'flex-start',
        width: '100%',
        maxWidth: '960px',
        margin: '0 auto',
      }}
    >
      <MapContainer
        center={[48.8566, 2.3522]}
        zoom={11}
        style={{
          height: '600px',
          width: '100%',
          flex: '2 1 0%',
          borderRadius: '16px',
          overflow: 'hidden',
          boxShadow: '0 8px 20px rgba(15, 23, 42, 0.12)',
        }}
      >
        <TileLayer url={tileUrl} />
        <ClusteredMarkers points={points} onVisibleCertifiedChange={setVisibleCertified} />
      </MapContainer>
      <aside
        style={{
          flex: '1 1 0%',
          maxHeight: '600px',
          overflowY: 'auto',
          padding: '16px',
          borderRadius: '16px',
          background: darkMode ? '#18181b' : '#f8fafc',
          color: darkMode ? '#f4f4f5' : '#111827',
          boxShadow: darkMode
            ? '0 0 0 1px rgba(255,255,255,0.08) inset'
            : '0 0 0 1px rgba(15,23,42,0.06) inset',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
        }}
      >
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h3 style={{ fontSize: '1.125rem', fontWeight: 600, margin: 0 }}>Établissements visibles</h3>
          <span style={{ fontSize: '0.85rem', opacity: 0.8 }}>
            {visibleCertifiedSorted.length}{' '}
            {visibleCertifiedSorted.length > 1 ? 'résultats' : 'résultat'}
          </span>
        </header>
        {visibleCertifiedSorted.length === 0 ? (
          <p style={{ margin: 0, fontSize: '0.9rem', opacity: 0.7 }}>
            Déplacez la carte pour découvrir des établissements certifiés.
          </p>
        ) : (
          visibleCertifiedSorted.map(({ establishment, rawDate }) => {
            const categories = Array.isArray(establishment?.categories)
              ? establishment.categories.filter(Boolean)
              : []
            return (
              <div
                key={establishment?.id ?? `${establishment?.lat}-${establishment?.lng}-${establishment?.name}`}
                style={{
                  borderRadius: '12px',
                  padding: '12px',
                  background: darkMode ? 'rgba(39,39,42,0.65)' : '#ffffff',
                  boxShadow: darkMode
                    ? '0 0 0 1px rgba(82,82,91,0.5)'
                    : '0 10px 24px rgba(15, 23, 42, 0.08)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                }}
              >
                <div style={{ fontWeight: 600, fontSize: '1rem' }}>
                  {establishment?.name ?? 'Nom inconnu'}
                </div>
                <div style={{ fontSize: '0.85rem', opacity: 0.8 }}>
                  {establishment?.address ?? establishment?.city ?? 'Adresse inconnue'}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      fontSize: '0.8rem',
                      padding: '4px 8px',
                      borderRadius: '9999px',
                      background: darkMode ? 'rgba(250,250,250,0.1)' : '#e0f2f1',
                      color: darkMode ? '#cbd5f5' : '#0f766e',
                      fontWeight: 500,
                    }}
                  >
                    Entrée&nbsp;: {formatEntryDate(rawDate)}
                  </span>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      fontSize: '0.8rem',
                      padding: '4px 8px',
                      borderRadius: '9999px',
                      background: darkMode ? 'rgba(39,39,42,0.65)' : '#eef2ff',
                      color: darkMode ? '#c7d2fe' : '#3730a3',
                      fontWeight: 500,
                    }}
                  >
                    {establishment?.source ?? 'Source inconnue'}
                  </span>
                  {categories.map((category: string) => (
                    <span
                      key={`${establishment?.id ?? establishment?.name}-category-${category}`}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        fontSize: '0.8rem',
                        padding: '4px 8px',
                        borderRadius: '9999px',
                        background: darkMode ? 'rgba(55, 65, 81, 0.75)' : '#f1f5f9',
                        color: darkMode ? '#e2e8f0' : '#1f2937',
                        fontWeight: 500,
                      }}
                    >
                      {category}
                    </span>
                  ))}
                </div>
              </div>
            )
          })
        )}
      </aside>
    </div>
  )
}

function ClusteredMarkers({
  points,
  onVisibleCertifiedChange,
}: {
  points: any[]
  onVisibleCertifiedChange?: (value: any[]) => void
}) {
  const map = useMap()
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    const handleChange = () => setRefreshKey((value) => value + 1)
    map.on('moveend', handleChange)
    map.on('zoomend', handleChange)
    return () => {
      map.off('moveend', handleChange)
      map.off('zoomend', handleChange)
    }
  }, [map])

  const clustered = useMemo(() => {
    if (!map) return []
    return clusterPoints(points, map)
  }, [map, points, refreshKey])

  const visibleCertified = useMemo(() => {
    if (!map) return []
    const bounds = map.getBounds()
    return points.filter((point) => {
      if (
        !point ||
        typeof point.lat !== 'number' ||
        typeof point.lng !== 'number' ||
        Number.isNaN(point.lat) ||
        Number.isNaN(point.lng)
      ) {
        return false
      }
      return bounds.contains([point.lat, point.lng])
    })
  }, [map, points, refreshKey])

  useEffect(() => {
    if (onVisibleCertifiedChange) {
      onVisibleCertifiedChange(visibleCertified)
    }
  }, [onVisibleCertifiedChange, visibleCertified])

  return (
    <>
      {clustered.map((entry) => {
        if (!entry.isCluster) {
          const point = entry.points[0]
          if (!point) return null
          const categories = Array.isArray(point.categories) ? point.categories.filter(Boolean) : []
          const icon = normalizeSource(point.source) === 'achahada' ? achahadaIcon : avsIcon
          return (
            <Marker
              key={point.id ?? `${point.lat}-${point.lng}`}
              position={[point.lat, point.lng]}
              icon={icon}
            >
              <Popup>
                <div style={{ fontSize: '0.9rem', lineHeight: 1.3 }}>
                  <strong>{point.name}</strong>
                  <br />
                  <br />
                  📍 {point.address}
                  <br />
                  🗺️ <b>Lat:</b> {point.lat.toFixed(5)} | <b>Lng:</b> {point.lng.toFixed(5)}
                  <br />
                  <div style={{ marginTop: '6px', display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '2px 6px',
                        background: normalizeSource(point.source) === 'achahada' ? '#27AA85' : '#732f4f',
                        color: 'white',
                        borderRadius: '4px',
                        fontSize: '0.75rem',
                        fontWeight: 'bold',
                      }}
                    >
                      {point.source}
                    </span>
                    {categories.map((category: string) => (
                      <span
                        key={`${point.id ?? point.name}-category-${category}`}
                        style={{
                          display: 'inline-block',
                          padding: '2px 6px',
                          background: '#6b7280',
                          color: 'white',
                          borderRadius: '4px',
                          fontSize: '0.75rem',
                          fontWeight: 'bold',
                        }}
                      >
                        {category}
                      </span>
                    ))}
                  </div>
                </div>
              </Popup>
            </Marker>
          )
        }

        const total = entry.points.length
        const counts = entry.points.reduce<Record<string, number>>((acc, item) => {
          const key = normalizeSource(item.source) || 'autre'
          acc[key] = (acc[key] ?? 0) + 1
          return acc
        }, {})
        const achahadaCount = counts.achahada ?? 0
        const avsCount = counts.avs ?? 0

        let iconKind: ClusterIconKind = 'mixed'
        if (achahadaCount > avsCount) {
          iconKind = 'achahada'
        } else if (avsCount > achahadaCount) {
          iconKind = 'avs'
        } else if (achahadaCount === 0 && avsCount === 0) {
          iconKind = 'default'
        }

        const icon = getClusterIcon(iconKind, total)
        const zoomTarget = Math.min((map.getZoom() ?? 11) + 2, map.getMaxZoom() ?? 18)
        const sorted = [...entry.points].sort((a, b) => {
          const labelA = `${a.name ?? ''}`.toLowerCase()
          const labelB = `${b.name ?? ''}`.toLowerCase()
          if (labelA < labelB) return -1
          if (labelA > labelB) return 1
          return 0
        })

        return (
          <Marker
            key={`cluster-${entry.lat.toFixed(6)}-${entry.lng.toFixed(6)}-${total}`}
            position={[entry.lat, entry.lng]}
            icon={icon}
            eventHandlers={{
              click: () => {
                map.setView([entry.lat, entry.lng], zoomTarget, { animate: true })
              },
            }}
          >
            <Popup>
              <div style={{ fontSize: '0.9rem', lineHeight: 1.4 }}>
                <strong>{total} établissements</strong>
                <br />
                <span>
                  Achahada : {achahadaCount} · AVS : {avsCount}
                </span>
                <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {sorted.map((item) => {
                    const categories = Array.isArray(item.categories) ? item.categories.filter(Boolean) : []
                    return (
                      <div key={item.id ?? `${item.name}-${item.source}`}>
                        <div style={{ fontWeight: 'bold' }}>{item.name}</div>
                        <div style={{ fontSize: '0.8rem' }}>{item.address}</div>
                        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '4px' }}>
                          <span
                            style={{
                              display: 'inline-block',
                              padding: '2px 6px',
                              background: normalizeSource(item.source) === 'achahada' ? '#27AA85' : '#732f4f',
                              color: 'white',
                              borderRadius: '4px',
                              fontSize: '0.75rem',
                              fontWeight: 'bold',
                            }}
                          >
                            {item.source}
                          </span>
                          {categories.map((category: string) => (
                            <span
                              key={`${item.id ?? item.name}-category-${category}`}
                              style={{
                                display: 'inline-block',
                                padding: '2px 6px',
                                background: '#6b7280',
                                color: 'white',
                                borderRadius: '4px',
                                fontSize: '0.75rem',
                                fontWeight: 'bold',
                              }}
                            >
                              {category}
                            </span>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </Popup>
          </Marker>
        )
      })}
    </>
  )
}

// TODO maj quotidienne des données (via un cron une fois deployé)
// TODO afficher la liste des établissements qui ne sont plus certifiés avec la date de sortie
// TODO filtre par catégorie
// TODO clustering des points pour les zones denses
// TODO custom icons par catégorie
// TODO infowindow custom avec plus d'infos
// TODO loader pendant le fetch
// TODO gestion des erreurs de fetch
// TODO contrôle du zoom et de la position initiale
