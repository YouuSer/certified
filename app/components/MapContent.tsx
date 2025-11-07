// app/components/MapContent.tsx
'use client'
import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet'

import { matchesCategoryFilter, type CategoryFilter } from '@/lib/categoryFilter'
import { db } from '@/lib/firebase'

type ClusterIconKind = 'achahada' | 'avs' | 'mixed' | 'default'

const clusterIconCache = new Map<string, L.DivIcon>()
const markerIconCache = new Map<string, L.DivIcon>()

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

const getPointIdentifier = (point: any) => {
  if (!point) return undefined
  if (typeof point.id === 'string' && point.id.trim().length > 0) return point.id
  if (
    typeof point.lat === 'number' &&
    !Number.isNaN(point.lat) &&
    typeof point.lng === 'number' &&
    !Number.isNaN(point.lng)
  ) {
    return `${point.lat}-${point.lng}-${point.name ?? 'establishment'}`
  }
  return undefined
}

const matchesFocusedPoint = (
  point: any,
  target?: { id?: string; lat?: number; lng?: number } | null,
) => {
  if (!point || !target) return false
  const pointId = getPointIdentifier(point)
  if (pointId && typeof target.id === 'string' && target.id === pointId) {
    return true
  }
  if (
    typeof point.lat === 'number' &&
    !Number.isNaN(point.lat) &&
    typeof point.lng === 'number' &&
    !Number.isNaN(point.lng) &&
    typeof target.lat === 'number' &&
    !Number.isNaN(target.lat) &&
    typeof target.lng === 'number' &&
    !Number.isNaN(target.lng)
  ) {
    return Math.abs(point.lat - target.lat) < 1e-6 && Math.abs(point.lng - target.lng) < 1e-6
  }
  return false
}

const getSafeMaxZoom = (map: L.Map) => {
  const maxZoom = map.getMaxZoom()
  if (typeof maxZoom === 'number' && Number.isFinite(maxZoom) && maxZoom > 0) {
    return maxZoom
  }
  return 18
}

const normalizeSource = (source?: string) => {
  if (!source) return ''
  const lower = source.toLowerCase()
  if (lower.includes('achahada')) return 'achahada'
  if (lower.includes('avs')) return 'avs'
  return lower
}

const getMarkerCacheKey = (sourceKey: string, focused: boolean) =>
  `${sourceKey || 'default'}-${focused ? 'focused' : 'regular'}`

const getMarkerIcon = (source?: string, focused = false) => {
  const normalized = normalizeSource(source) || 'default'
  const cacheKey = getMarkerCacheKey(normalized, focused)
  const cached = markerIconCache.get(cacheKey)
  if (cached) return cached
  
  const baseSize = focused ? 52 : 40
  const borderRadius = normalized === 'default' ? '50%' : '25%'
  const focusRing = focused
  ? 'box-shadow: 0 0 0 6px rgba(59,113,202,0.3), 0 12px 24px rgba(37, 99, 235, 0.25); transform: translateY(-1px);'
  : 'box-shadow: 0 0 4px rgba(0,0,0,0.3);'
  
  const getImageHtml = () => {
    if (normalized === 'achahada') {
      return `<img src="/icons/achahada.png" style="width: 100%; height: 100%; object-fit: contain;" />`
    }
    if (normalized === 'avs') {
      return `<img src="/icons/avs.png" style="width: 100%; height: 100%; object-fit: cover;" />`
    }
    return `<div style="width: 50%; height: 50%; border-radius: 50%; background: #1f2937;"></div>`
  }
  
  const icon = new L.DivIcon({
    html: `
      <div style="
        width: ${baseSize}px;
        height: ${baseSize}px;
        border-radius: ${borderRadius};
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
        background: ${normalized === 'achahada' ? 'oklch(98.5% 0 0)' : '#ffffff'};
        ${focusRing}
        transition: all 0.2s ease-out;
      ">
        ${getImageHtml()}
      </div>
    `,
    className: '',
    iconSize: [baseSize, baseSize],
    iconAnchor: [baseSize / 2, baseSize],
    popupAnchor: [0, -baseSize],
  })
  
  markerIconCache.set(cacheKey, icon)
  return icon
}

let userLocationIconCache: L.DivIcon | null = null

const getUserLocationIcon = () => {
  if (userLocationIconCache) return userLocationIconCache
  
  const html = `
    <div style="position: relative; width: 46px; height: 46px;">
      <span style="
        position: absolute;
        top: 50%;
        left: 50%;
        width: 46px;
        height: 46px;
        margin-top: -23px;
        margin-left: -23px;
        border-radius: 50%;
        background: rgba(37, 99, 235, 0.15);
        animation: certified-user-pulse 2.4s ease-out infinite;
      "></span>
      <span style="
        position: absolute;
        top: 50%;
        left: 50%;
        width: 16px;
        height: 16px;
        margin-top: -8px;
        margin-left: -8px;
        border-radius: 50%;
        background: #2563eb;
        border: 3px solid #ffffff;
        box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.25);
      "></span>
    </div>
    <style>
      @keyframes certified-user-pulse {
        0% { transform: scale(0.5); opacity: 0.65; }
        60% { transform: scale(1); opacity: 0; }
        100% { transform: scale(1.1); opacity: 0; }
      }
    </style>
  `
  
  userLocationIconCache = new L.DivIcon({
    html,
    className: '',
    iconSize: [46, 46],
    iconAnchor: [23, 23],
  })
  
  return userLocationIconCache
}

export type MapContentProps = {
  onVisibleCertifiedChange?: (value: any[]) => void
  onDecertifiedChange?: (value: any[]) => void
  categoryFilter?: CategoryFilter
  focusedEstablishment?: {
    id?: string
    lat?: number
    lng?: number
    timestamp?: number
  } | null
  onClearFocus?: () => void
  onFocusEstablishment?: (value: { id?: string; name?: string; lat: number; lng: number }) => void
  userLocation?: { lat?: number; lng?: number } | null
  onRequestUserLocation?: () => void
  isDarkMode?: boolean
}

export default function MapContent({
  onVisibleCertifiedChange,
  onDecertifiedChange,
  categoryFilter = 'all',
  focusedEstablishment,
  onClearFocus,
  onFocusEstablishment,
  userLocation,
  onRequestUserLocation,
  isDarkMode = false,
}: MapContentProps) {
  const [points, setPoints] = useState<any[]>([])
  const mapRef = useRef<L.Map | null>(null)
  
  useEffect(() => {
    return () => {
      mapRef.current = null
    }
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
  
  const filteredPoints = useMemo(() => {
    if (categoryFilter === 'all') return points
    return points.filter((point) => matchesCategoryFilter(point, categoryFilter))
  }, [points, categoryFilter])
  
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
          exitDate: entry?.removedAt ?? exitDate,
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
  const tileUrl = isDarkMode
    ? 'https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png'
    : 'https://tiles.stadiamaps.com/tiles/osm_bright/{z}/{x}/{y}{r}.png'
  const tileLayerKey = isDarkMode ? 'dark' : 'light'
  
  return (
    <div style={{ width: '100%', position: 'relative' }}>
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
    <MapRefSetter mapRef={mapRef} />
    <TileLayer key={tileLayerKey} url={tileUrl} />
    <MapFocusController target={focusedEstablishment} />
    <UserLocationFocusController location={userLocation} />
    <ClusteredMarkers
    displayPoints={filteredPoints}
    allPoints={points}
    onVisibleCertifiedChange={onVisibleCertifiedChange}
    focusedTarget={focusedEstablishment}
    onClearFocus={onClearFocus}
    onFocusEstablishment={onFocusEstablishment}
    />
    {userLocation ? <UserLocationMarker location={userLocation} /> : null}
    </MapContainer>
    <UserLocationButton
    mapRef={mapRef}
    location={userLocation}
    onRequestUserLocation={onRequestUserLocation}
    />
    </div>
  )
}

function MapRefSetter({ mapRef }: { mapRef: MutableRefObject<L.Map | null> }) {
  const map = useMap()
  
  useEffect(() => {
    mapRef.current = map
    return () => {
      mapRef.current = null
    }
  }, [map, mapRef])
  
  return null
}

function ClusteredMarkers({
  displayPoints,
  allPoints,
  onVisibleCertifiedChange,
  focusedTarget,
  onClearFocus,
  onFocusEstablishment,
}: {
  displayPoints: any[]
  allPoints: any[]
  onVisibleCertifiedChange?: (value: any[]) => void
  focusedTarget?: { id?: string; lat?: number; lng?: number; timestamp?: number } | null
  onClearFocus?: () => void
  onFocusEstablishment?: (value: { id?: string; name?: string; lat: number; lng: number }) => void
}) {
  const map = useMap()
  const [refreshKey, setRefreshKey] = useState(0)
  const lastFocusTimestampRef = useRef<number | null>(null)
  
  useEffect(() => {
    const handleChange = () => setRefreshKey((value) => value + 1)
    const handleInteraction = () => {
      if (!focusedTarget) return
      const lastFocus = lastFocusTimestampRef.current
      if (lastFocus && Date.now() - lastFocus < 250) {
        return
      }
      lastFocusTimestampRef.current = null
      if (onClearFocus) onClearFocus()
      }
    map.on('moveend', handleChange)
    map.on('zoomstart', handleInteraction)
    map.on('click', handleInteraction)
    map.on('zoomend', handleChange)
    return () => {
      map.off('moveend', handleChange)
      map.off('zoomstart', handleInteraction)
      map.off('click', handleInteraction)
      map.off('zoomend', handleChange)
    }
  }, [map, onClearFocus, focusedTarget])
  
  useEffect(() => {
    if (focusedTarget?.timestamp) {
      lastFocusTimestampRef.current = focusedTarget.timestamp
      return
    }
    lastFocusTimestampRef.current = null
  }, [focusedTarget])
  
  const clustered = useMemo(() => {
    if (!map) return []
    return clusterPoints(displayPoints, map)
  }, [map, displayPoints, refreshKey])
  
  const visibleCertified = useMemo(() => {
    if (!map) return []
    const bounds = map.getBounds()
    return allPoints.filter((point) => {
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
  }, [map, allPoints, refreshKey])
  
  useEffect(() => {
    if (onVisibleCertifiedChange) {
      onVisibleCertifiedChange(visibleCertified)
    }
  }, [onVisibleCertifiedChange, visibleCertified])
  
  useEffect(() => {
    if (!map || !focusedTarget) return
    const entry = clustered.find((item) =>
      item.points.some((point) => matchesFocusedPoint(point, focusedTarget)),
  )
  if (!entry || !entry.isCluster) {
    return
  }
  const safeMaxZoom = getSafeMaxZoom(map)
  const currentZoom = map.getZoom()
  if (typeof currentZoom !== 'number' || Number.isNaN(currentZoom) || currentZoom >= safeMaxZoom) {
    return
  }
  lastFocusTimestampRef.current = Date.now()
  const nextZoom = Math.min(currentZoom + 1, safeMaxZoom)
  const targetLat =
  typeof focusedTarget.lat === 'number' && !Number.isNaN(focusedTarget.lat)
  ? focusedTarget.lat
  : entry.lat
  const targetLng =
  typeof focusedTarget.lng === 'number' && !Number.isNaN(focusedTarget.lng)
  ? focusedTarget.lng
  : entry.lng
  map.setView([targetLat, targetLng], nextZoom, { animate: true })
}, [clustered, focusedTarget, map])

return (
  <>
  {clustered.map((entry) => {
    if (!entry.isCluster) {
      const point = entry.points[0]
      if (!point) return null
      const markerId = getPointIdentifier(point)
      const isFocused = matchesFocusedPoint(point, focusedTarget)
      const icon = getMarkerIcon(point.source, isFocused)
      return (
        <EstablishmentMarker
        key={markerId ?? `${point.lat}-${point.lng}`}
        point={point}
        icon={icon}
        isFocused={isFocused}
        onClearFocus={onClearFocus}
        onFocusEstablishment={onFocusEstablishment}
        />
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
          if (onClearFocus) onClearFocus()
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

function EstablishmentMarker({
  point,
  icon,
  isFocused,
  onClearFocus,
  onFocusEstablishment,
}: {
  point: any
  icon: L.DivIcon
  isFocused: boolean
  onClearFocus?: () => void
  onFocusEstablishment?: (value: { id?: string; name?: string; lat: number; lng: number }) => void
}) {
  const markerRef = useRef<L.Marker | null>(null)
  
  useEffect(() => {
    const marker = markerRef.current
    if (!marker) return
    marker.setZIndexOffset(isFocused ? 1000 : 0)
    if (isFocused) {
      marker.openPopup()
    }
  }, [isFocused])
  
  if (
    !point ||
    typeof point.lat !== 'number' ||
    Number.isNaN(point.lat) ||
    typeof point.lng !== 'number' ||
    Number.isNaN(point.lng)
  ) {
    return null
  }
  
  const categories = Array.isArray(point.categories) ? point.categories.filter(Boolean) : []
  const markerId = getPointIdentifier(point)
  
  return (
    <Marker
    ref={markerRef}
    position={[point.lat, point.lng]}
    icon={icon}
    eventHandlers={{
      click: () => {
        if (
          typeof point.lat === 'number' &&
          typeof point.lng === 'number' &&
          onFocusEstablishment
        ) {
          onFocusEstablishment({
            ...point,
            id: markerId ?? point.id,
            lat: point.lat,
            lng: point.lng,
          })
          return
        }
        if (onClearFocus) onClearFocus()
        },
    }}
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

function MapFocusController({
  target,
}: {
  target?: { lat?: number; lng?: number; timestamp?: number } | null
}) {
  const map = useMap()
  const lat = target?.lat
  const lng = target?.lng
  const timestamp = target?.timestamp
  
  useEffect(() => {
    if (
      typeof lat !== 'number' ||
      Number.isNaN(lat) ||
      typeof lng !== 'number' ||
      Number.isNaN(lng)
    ) {
      return
    }
    const safeMaxZoom = getSafeMaxZoom(map)
    const currentZoom = map.getZoom()
    const baseZoom = typeof currentZoom === 'number' && currentZoom > 0 ? currentZoom : 11
    const desiredZoom = Math.min(safeMaxZoom, Math.max(baseZoom, 13))
    map.flyTo([lat, lng], desiredZoom, { animate: true })
  }, [map, lat, lng, timestamp])
  
  return null
}

function UserLocationFocusController({
  location,
}: {
  location?: { lat?: number; lng?: number } | null
}) {
  const map = useMap()
  const hasInitializedRef = useRef(false)
  
  useEffect(() => {
    if (
      !location ||
      typeof location.lat !== 'number' ||
      Number.isNaN(location.lat) ||
      typeof location.lng !== 'number' ||
      Number.isNaN(location.lng)
    ) {
      return
    }
    
    // Centrer la carte sur la position utilisateur seulement au premier chargement
    if (!hasInitializedRef.current) {
      hasInitializedRef.current = true
      const safeMaxZoom = getSafeMaxZoom(map)
      const desiredZoom = Math.min(safeMaxZoom, 13) 
      map.setView([location.lat, location.lng], desiredZoom, { animate: true })
    }
  }, [map, location])
  
  return null
}

function UserLocationMarker({ location }: { location?: { lat?: number; lng?: number } | null }) {
  const icon = useMemo(() => getUserLocationIcon(), [])
  
  if (
    !location ||
    typeof location.lat !== 'number' ||
    Number.isNaN(location.lat) ||
    typeof location.lng !== 'number' ||
    Number.isNaN(location.lng)
  ) {
    return null
  }
  
  return <Marker position={[location.lat, location.lng]} icon={icon} interactive={false} keyboard={false} />
}


function UserLocationButton({
  mapRef,
  location,
  onRequestUserLocation,
}: {
  mapRef: MutableRefObject<L.Map | null>
  location?: { lat?: number; lng?: number } | null
  onRequestUserLocation?: () => void
}) {
  const hasLocation =
  Boolean(location) &&
  typeof location?.lat === 'number' &&
  !Number.isNaN(location.lat) &&
  typeof location?.lng === 'number' &&
  !Number.isNaN(location.lng)
  const [isUserLocationHighlighted, setIsUserLocationHighlighted] = useState(false)
  const updateHighlightState = useCallback(() => {
    const map = mapRef.current
    if (!map || !hasLocation || !location) {
      setIsUserLocationHighlighted(false)
      return
    }
    const center = map.getCenter()
    const threshold = 0.001
    const isCentered =
      Math.abs(center.lat - location.lat) <= threshold &&
      Math.abs(center.lng - location.lng) <= threshold
    setIsUserLocationHighlighted(isCentered)
  }, [hasLocation, location, mapRef])
  const mapInstance = mapRef.current
  useEffect(() => {
    if (!mapInstance) return
    mapInstance.on('moveend', updateHighlightState)
    mapInstance.on('zoomend', updateHighlightState)
    updateHighlightState()
    return () => {
      mapInstance.off('moveend', updateHighlightState)
      mapInstance.off('zoomend', updateHighlightState)
    }
  }, [mapInstance, updateHighlightState])
  useEffect(() => {
    updateHighlightState()
  }, [updateHighlightState])
  useEffect(() => {
    if (!hasLocation) {
      setIsUserLocationHighlighted(false)
    }
  }, [hasLocation])
  
  const handleClick = useCallback(() => {
    const map = mapRef.current
    if (!map) return
    
    map.closePopup()
    
    if (hasLocation && location) {
      const safeMaxZoom = getSafeMaxZoom(map)
      const desiredZoom = Math.min(safeMaxZoom, 13) 
      map.flyTo([location.lat!, location.lng!], desiredZoom, { 
        animate: true,
        duration: 1 
      })
      setIsUserLocationHighlighted(true)
      return
    }
    
    console.log('Requesting user location')
    if (onRequestUserLocation) {
      onRequestUserLocation()
    }
    setIsUserLocationHighlighted(false)
  }, [hasLocation, location, mapRef, onRequestUserLocation])
  
  const buttonClasses = [
    'absolute bottom-8 right-8 z-[1000]',
    'inline-flex size-10 items-center justify-center rounded-full',
    'bg-white shadow-lg ring-1 ring-black/10 transition',
    'hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500',
    'dark:bg-zinc-900 dark:ring-white/10 dark:hover:bg-zinc-800',
    isUserLocationHighlighted
      ? 'text-blue-600 dark:text-blue-400'
      : 'text-gray-900 dark:text-zinc-300',
  ].join(' ')
  
  const iconOpacity = isUserLocationHighlighted ? 1 : 0.8
  
  return (
    <button
    type="button"
    onClick={handleClick}
    aria-label="Afficher ma position"
    title="Centrer sur ma position"
    className={buttonClasses}
    >
    <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ opacity: iconOpacity }}
    className="size-7"
    >
    <circle cx={12} cy={12} r={6.75} />
    <circle cx={12} cy={12} r={2.5} fill="currentColor" />
    <path d="M12 3v2.5" />
    <path d="M12 18.5V21" />
    <path d="M21 12h-2.5" />
    <path d="M5.5 12H3" />
    </svg>
    </button>
  )
}
