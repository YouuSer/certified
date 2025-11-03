'use client'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useState } from 'react'
import { MapContainer, Marker, Popup, TileLayer } from 'react-leaflet'

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

export default function MapContent() {
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

  // --- Choisir la tuile selon le mode ---
  const tileUrl = darkMode
    ? 'https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png'
    : 'https://tiles.stadiamaps.com/tiles/osm_bright/{z}/{x}/{y}{r}.png'

  return (
    <MapContainer center={[48.8566, 2.3522]} zoom={11} style={{ height: '500px', width: '100%' }}>
      <TileLayer url={tileUrl} />
      {points.map((p) => {
        const categories = Array.isArray(p.categories) ? p.categories.filter(Boolean) : []

        return (
          <Marker
            key={p.id}
            position={[p.lat, p.lng]}
            icon={p.source === 'Achahada' ? achahadaIcon : avsIcon}
          >
            <Popup>
              <div style={{ fontSize: '0.9rem', lineHeight: 1.3 }}>
                <strong>{p.name}</strong>
                <br />
                <br />
                📍 {p.address}
                <br />
                🗺️ <b>Lat:</b> {p.lat.toFixed(5)} | <b>Lng:</b> {p.lng.toFixed(5)}
                <br />
                <div style={{ marginTop: '6px', display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                  <span
                    style={{
                      display: 'inline-block',
                      padding: '2px 6px',
                      background: p.source === 'Achahada' ? '#27AA85' : '#732f4f',
                      color: 'white',
                      borderRadius: '4px',
                      fontSize: '0.75rem',
                      fontWeight: 'bold',
                    }}
                  >
                    {p.source}
                  </span>
                  {categories.map((category: string) => (
                    <span
                      key={`${p.id ?? p.name}-category-${category}`}
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
      })}
    </MapContainer>
  )
}

// TODO maj quotidienne des données (via un cron une fois deployé)
// TODO gérer l'affichage des etablissements differents mais sur le meme point (ex: meme adresse mais plusieurs etablissements)
// TODO afficher la liste des établissements certifiés et la liste des établissements qui ne le sont plus avec la date d’entrée ou de sortie 
// TODO filtre par catégorie
// TODO clustering des points pour les zones denses
// TODO custom icons par catégorie
// TODO infowindow custom avec plus d'infos
// TODO loader pendant le fetch
// TODO gestion des erreurs de fetch
// TODO contrôle du zoom et de la position initiale
