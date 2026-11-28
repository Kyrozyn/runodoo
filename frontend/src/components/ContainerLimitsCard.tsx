import React, { useEffect, useState } from 'react'
import { AlertTriangle, Cpu, HardDrive, Loader2, Save } from 'lucide-react'
import { api } from '../api/client'
import type { ContainerLimits, OdooInstance, SystemInfo } from '../types'

const EMPTY_LIMITS: ContainerLimits = {
  cpuCores: 0,
  memoryMb: 0,
  diskReadIops: 0,
  diskWriteIops: 0,
  diskReadMbps: 0,
  diskWriteMbps: 0,
}

function LimitsFields({
  title,
  subtitle,
  value,
  disabled,
  onChange,
}: {
  title: string
  subtitle: string
  value: ContainerLimits
  disabled?: boolean
  onChange: (next: ContainerLimits) => void
}) {
  const num = (field: keyof ContainerLimits, raw: string, float = false) => {
    const parsed = float ? parseFloat(raw) : parseInt(raw, 10)
    onChange({ ...value, [field]: Number.isFinite(parsed) && parsed >= 0 ? parsed : 0 })
  }

  return (
    <div className={`rounded-lg border border-slate-200 p-4 space-y-3 ${disabled ? 'bg-slate-50 opacity-70' : 'bg-slate-50/50'}`}>
      <div>
        <div className="text-xs font-bold text-slate-900">{title}</div>
        <div className="text-[11px] text-slate-500">{subtitle}</div>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <div>
          <label className="mb-1 block text-[11px] font-medium text-slate-600">CPU Cores (0 = unlimited)</label>
          <input
            type="number"
            step="0.25"
            min={0}
            disabled={disabled}
            value={value.cpuCores}
            onChange={(e) => num('cpuCores', e.target.value, true)}
            className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-mono disabled:bg-slate-100"
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-slate-600">RAM Limit MB (0 = unlimited)</label>
          <input
            type="number"
            step="128"
            min={0}
            disabled={disabled}
            value={value.memoryMb}
            onChange={(e) => num('memoryMb', e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-mono disabled:bg-slate-100"
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-slate-600">Disk Read IOPS</label>
          <input
            type="number"
            min={0}
            disabled={disabled}
            value={value.diskReadIops}
            onChange={(e) => num('diskReadIops', e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-mono disabled:bg-slate-100"
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-slate-600">Disk Write IOPS</label>
          <input
            type="number"
            min={0}
            disabled={disabled}
            value={value.diskWriteIops}
            onChange={(e) => num('diskWriteIops', e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-mono disabled:bg-slate-100"
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-slate-600">Disk Read MB/s</label>
          <input
            type="number"
            min={0}
            disabled={disabled}
            value={value.diskReadMbps}
            onChange={(e) => num('diskReadMbps', e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-mono disabled:bg-slate-100"
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-slate-600">Disk Write MB/s</label>
          <input
            type="number"
            min={0}
            disabled={disabled}
            value={value.diskWriteMbps}
            onChange={(e) => num('diskWriteMbps', e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-mono disabled:bg-slate-100"
          />
        </div>
      </div>
    </div>
  )
}

export function ContainerLimitsCard({
  instance,
  onUpdated,
  notify,
}: {
  instance: OdooInstance
  onUpdated: () => void
  notify: (msg: string, type?: 'success' | 'error') => void
}) {
  const [odooLimits, setOdooLimits] = useState<ContainerLimits>({ ...EMPTY_LIMITS, ...instance.resources?.odooLimits })
  const [dbLimits, setDbLimits] = useState<ContainerLimits>({ ...EMPTY_LIMITS, ...instance.resources?.dbLimits })
  const [diskDevice, setDiskDevice] = useState(instance.resources?.diskDevice || '')
  const [sysInfo, setSysInfo] = useState<SystemInfo | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setOdooLimits({ ...EMPTY_LIMITS, ...instance.resources?.odooLimits })
    setDbLimits({ ...EMPTY_LIMITS, ...instance.resources?.dbLimits })
    setDiskDevice(instance.resources?.diskDevice || '')
  }, [instance])

  useEffect(() => {
    api
      .systemInfo()
      .then((s) => setSysInfo(s))
      .catch(() => {})
  }, [])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)
    setSaving(true)
    try {
      await api.updateInstanceLimits(instance.id, {
        odooLimits,
        dbLimits,
        diskDevice: diskDevice.trim(),
      })
      notify('Container resource limits saved & applied!')
      onUpdated()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed applying resource limits'
      setErrorMsg(msg)
      notify(msg, 'error')
    } finally {
      setSaving(false)
    }
  }

  const detectedDevice = sysInfo?.blockDevice || ''

  return (
    <form onSubmit={handleSave} className="lg:col-span-2 rounded-xl border border-slate-200 bg-white p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Cpu className="h-4 w-4 text-[#714B67]" />
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Container Resource Limits (CPU, RAM &amp; Disk IOPS)</h3>
            <p className="text-xs text-slate-500">
              CPU &amp; RAM diterapkan secara live. Mengubah Disk IOPS/MB/s akan me-recreate container terkait (data tetap aman).
            </p>
          </div>
        </div>
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#714B67] px-4 py-2 text-xs font-semibold text-white hover:bg-[#5c3c54] disabled:opacity-60 cursor-pointer"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          {saving ? 'Applying Limits...' : 'Save & Apply Limits'}
        </button>
      </div>

      {sysInfo?.limitNotes && (
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" />
          <div>
            <strong>Host Capability Check:</strong> {sysInfo.limitNotes}
          </div>
        </div>
      )}

      {errorMsg && (
        <div className="flex items-start gap-2.5 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-rose-600" />
          <div>
            <strong>Gagal menerapkan limit:</strong> {errorMsg}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <LimitsFields
          title={`Odoo Container (${instance.containerName})`}
          subtitle="Limit CPU, RAM & Disk I/O untuk aplikasi Odoo"
          value={odooLimits}
          onChange={setOdooLimits}
        />
        <LimitsFields
          title={`PostgreSQL Container (${instance.dbContainerName})`}
          subtitle={
            instance.dbMode === 'dedicated'
              ? 'Limit CPU, RAM & Disk I/O untuk PostgreSQL dedicated'
              : 'Mode Shared: PostgreSQL dipakai bersama, limit DB per-instance hanya berlaku untuk mode Dedicated'
          }
          value={dbLimits}
          disabled={instance.dbMode !== 'dedicated'}
          onChange={setDbLimits}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3 pt-1">
        <div className="flex items-center gap-1.5 text-xs text-slate-600">
          <HardDrive className="h-3.5 w-3.5 text-slate-400" />
          <span>Host Block Device (untuk Disk IOPS/MB/s):</span>
        </div>
        <input
          type="text"
          value={diskDevice}
          onChange={(e) => setDiskDevice(e.target.value)}
          placeholder={detectedDevice ? `Auto (${detectedDevice})` : 'e.g. /dev/vda'}
          className="w-52 rounded-lg border border-slate-300 px-2.5 py-1 font-mono text-xs"
        />
        {detectedDevice && (
          <span className="text-[11px] text-slate-400">
            Terdeteksi: <code className="font-mono">{detectedDevice}</code>
          </span>
        )}
      </div>
    </form>
  )
}
