'use client'

import 'leaflet/dist/leaflet.css'
import dynamic from 'next/dynamic'
import type { MapContentProps } from './MapContent'

const DynamicMap = dynamic<MapContentProps>(() => import('./MapContent'), {
  ssr: false,
})

export default function MapView(props: MapContentProps) {
  return <DynamicMap {...props} />
}
