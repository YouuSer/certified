'use client'

import 'leaflet/dist/leaflet.css'
import dynamic from 'next/dynamic'

const DynamicMap = dynamic(() => import('./MapContent'), {
  ssr: false,
})

export default function MapView() {
  return <DynamicMap />
}