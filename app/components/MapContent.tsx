// MapContent.tsx
'use client'
import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useMemo, useState } from 'react'
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet'

import { db } from '@/lib/firebase'

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

export type MapContentProps = {
  onVisibleCertifiedChange?: (value: any[]) => void
  onDecertifiedChange?: (value: any[]) => void
}

export default function MapContent({
  onVisibleCertifiedChange,
  onDecertifiedChange,
}: MapContentProps) {
  const [points, setPoints] = useState<any[]>([])
  const [darkMode, setDarkMode] = useState(false)

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

  useEffect(() => {
    if (!onDecertifiedChange) return

    let isCancelled = false

    const loadDecertified = async () => {
      try {
        const changelogSnapshot = await getDocs(
          query(collection(db, 'changelog'), orderBy('date', 'desc'), limit(1)),
        )
        const latest = changelogSnapshot.docs[0]?.data() as
          | {
              removed?: any[]
              date?: string
            }
          | undefined

        const exitDate = latest?.date ?? null
        const removed = latest && Array.isArray(latest.removed) ? latest.removed : []
        const normalized = removed.map((entry) => ({
          ...entry,
          exitDate,
        }))

        if (!isCancelled) {
          onDecertifiedChange(normalized)
        }
      } catch (error) {
        console.error('Erreur lors du chargement des établissements non certifiés:', error)
        if (!isCancelled) {
          onDecertifiedChange([])
        }
      }
    }

    void loadDecertified()

    return () => {
      isCancelled = true
    }
  }, [onDecertifiedChange])

  // --- Choisir la tuile selon le mode ---
  const tileUrl = darkMode
    ? 'https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png'
    : 'https://tiles.stadiamaps.com/tiles/osm_bright/{z}/{x}/{y}{r}.png'

  return (
    <div style={{ width: '100%' }}>
      <MapContainer
        center={[48.8566, 2.3522]}
        zoom={11}
        style={{
          height: '600px',
          width: '100%',
          borderRadius: '16px',
          overflow: 'hidden',
          boxShadow: '0 8px 20px rgba(15, 23, 42, 0.12)',
        }}
      >
        <TileLayer url={tileUrl} />
        <ClusteredMarkers points={points} onVisibleCertifiedChange={onVisibleCertifiedChange} />
      </MapContainer>
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