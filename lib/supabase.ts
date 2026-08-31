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
  deleted_at: string | null
  notes: string | null
  aerial_photo_url: string | null
  budget_waste_cost: number | null
  budget_labor: number | null
  budget_fuel: number | null
  budget_lease: number | null
  budget_scrap_revenue: number | null
  budget_expense: number | null
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
  entry_type: 'labor' | 'fuel' | 'lease' | 'expense'
  date: string
  quantity: number
  unit_price: number
  amount: number
  note: string | null
  fuel_type: string | null
  vehicle_id: number | null
  vehicles?: Vehicle
}

export type Vehicle = {
  id: number
  name: string
  category: 'rental' | 'owned'
  default_price: number | null
  // 重機の回送費。空欄=登録なし（毎回手入力）、0=回送費なし
  default_mobilization_fee?: number | null
  unit: string
  note: string | null
  created_at: string
}

export type FuelPrice = {
  id: number
  fuel_type: '軽油' | 'レギュラー'
  unit_price: number
  updated_at: string
}

export type Tool = {
  id: number
  name: string
  total_quantity: number
  broken_quantity: number
  unit: string
  note: string | null
  created_at: string
}

export type ToolUsage = {
  id: number
  project_id: number
  tool_id: number
  quantity: number
  checked_out_at: string
  returned_at: string | null
  note: string | null
  created_at: string
  tools?: Tool
  projects?: Project
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
  photo_url: string | null
  created_at: string
}

export type MeetingNotePhoto = {
  id: number
  meeting_note_id: number
  photo_url: string
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
  category_notes: Record<string, string[]>
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

export type ScaffoldPlan = {
  id: number
  project_id: number
  input_mode: 'directions' | 'rect' | 'perimeter' | 'trace'
  span_interval_m: number
  level_height_m: number
  image_url: string | null
  scale_m_per_px: number | null
  created_at: string
  updated_at: string
}

export type ScaffoldSegment = {
  id: number
  plan_id: number
  order_index: number
  label: string | null
  length_m: number
  height_m: number
  vertex_x_px: number | null
  vertex_y_px: number | null
}

export type ScaffoldMaterialPrice = {
  id: number
  category: 'pipe' | 'usage'
  label: string
  unit_price: number | null
  sort_order: number
  created_at: string
}

export type CalendarEventType = 'construction_start' | 'night_shift' | 'estimate' | 'other'

export type CalendarEvent = {
  id: number
  title: string
  event_type: CalendarEventType
  event_date: string
  note: string | null
  notify_all: boolean
  created_at: string
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

// 応援先（他社への人貸し先）
export type SupportCompany = {
  id: number
  name: string
  sort_order: number
  active: boolean
  created_at: string
}

// 翌日の段取り（1日1件）
export type DispatchPlan = {
  id: number
  date: string
  notified_at: string | null
  created_at: string
  updated_at: string
}

// 段取りの行き先。自社現場なら project_id、応援なら support_company_id が入る
export type DispatchGroup = {
  id: number
  plan_id: number
  project_id: number | null
  support_company_id: number | null
  meet_time: string | null
  meet_place: string | null
  note: string | null
  created_at: string
}

export type DispatchAssignment = {
  id: number
  plan_id: number
  group_id: number
  worker_id: number
  created_at: string
}

// やること（タスク管理）
export type Task = {
  id: number
  title: string
  note: string | null
  project_id: number | null
  assignee_id: number | null
  due_date: string | null
  done_at: string | null
  done_by: number | null
  created_at: string
  updated_at: string
}
