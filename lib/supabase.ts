import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export type DisposalSite = {
  id: number
  name: string
}

export type WasteType = {
  id: number
  disposal_site_id: number
  name: string
  unit: string
  unit_price: number
  entry_type: 'cost' | 'revenue'
  disposal_sites?: DisposalSite
}

export type Project = {
  id: number
  name: string
  location: string
  start_date: string
  end_date: string | null
  status: 'active' | 'completed'
  notes: string | null
  aerial_photo_url: string | null
  created_at: string
}

export type WasteEntry = {
  id: number
  project_id: number
  waste_type_id: number
  date: string
  quantity: number
  amount: number
  waste_types?: WasteType & { disposal_sites?: DisposalSite }
}

export type OtherEntry = {
  id: number
  project_id: number
  entry_type: 'labor' | 'fuel' | 'lease'
  date: string
  quantity: number
  unit_price: number
  amount: number
  note: string | null
}

export type MeetingNote = {
  id: number
  project_id: number
  date: string
  danger_points: string | null
  cautions: string | null
  notices: string | null
  created_at: string
}

export type KyPhoto = {
  id: number
  project_id: number
  date: string
  photo_url: string
  created_at: string
}
