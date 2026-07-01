'use client'
import EstimateForm from '../_components/EstimateForm'

export default function NewEstimatePage() {
  return (
    <div>
      <h1 className="text-xl font-bold mb-4">新規見積り作成</h1>
      <EstimateForm mode="new" />
    </div>
  )
}
