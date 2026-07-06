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
  budget_waste_cost: number | null
  budget_labor: number | null
  budget_fuel: number | null
  budget_lease: number | null
  budget_scrap_revenue: number | null
  process_notes: string | null
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

export type ScrapRecord = {
  id: number
  project_id: number
  date: string
  items: string | null
  amount: number
  note: string | null
  site_photo_url: string | null
  slip_photo_url: string | null
  created_at: string
}

export type WorkProcess = {
  id: number
  project_id: number
  name: string
  start_date: string
  end_date: string
  notes: string | null
  created_at: string
}

export type LaborTarget = {
  id: number
  project_id: number
  date: string
  target_count: number
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

export type EstimateStatus = 'draft' | 'sent' | 'accepted' | 'rejected'

export type EstimateLayoutType = 'simple' | 'detailed'

export type Estimate = {
  id: number
  customer_name: string
  customer_honorific: string
  customer_address: string | null
  customer_contact: string | null
  estimate_no: string | null
  project_name: string | null
  site_address: string | null
  construction_period: string | null
  payment_due_date: string | null
  payment_terms: string | null
  assignee: string | null
  tax_rate: number
  status: EstimateStatus
  issue_date: string
  valid_until: string | null
  notes: string | null
  layout_type: EstimateLayoutType
  category_notes: Record<string, string>
  created_at: string
}

export type EstimateItem = {
  id: number
  estimate_id: number
  name: string
  quantity: number
  unit: string
  unit_price: number
  sort_order: number
  category: string | null
}

export type CompanySettings = {
  id: number
  name: string
  postal_code: string | null
  address: string | null
  office_name: string | null
  tel: string | null
  fax: string | null
  email: string | null
  license_no: string | null
  representative: string | null
  stamp_url: string | null
}
