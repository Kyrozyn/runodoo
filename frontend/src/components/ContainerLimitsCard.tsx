import React, { useEffect, useState } from 'react'
import { AlertTriangle, Cpu, Gauge, HardDrive, Loader2, Play, RotateCw, Save } from 'lucide-react'
import { api } from '../api/client'
import type { ContainerLimits, DiskBenchmark, OdooInstance, SystemInfo } from '../types'

const EMPTY_LIMITS: ContainerLimits = {
  cpuCores: 0,
  memoryMb: 0,
  diskReadIops: 0,
  diskWriteIops: 0,
  diskReadMbps: 0,
  diskWriteMbps: 0,
}

const PCT_PRESETS = [10, 25, 50, 75, 100] as const

function MetricInputWithPresets({
  label,
  value,
  maxTotal,
  unit,
  step = '1',
  isFloat = false,
  disabled,
  needsBenchmark,
  onChange,
}: {
  label: string
  value: number
  maxTotal: number
  unit: string
  step?: string
  isFloat?: boolean
  disabled?: boolean
  needsBenchmark?: boolean
  onChange: (next: number) => void
}) {
  const applyPct = (pct: number) => {
    if (maxTotal <= 0) return
    if (isFloat) {
      const v = Math.max(0.1, Math.round((maxTotal * pct) / 100 * 100) / 100)
      onChange(v)
    } else {
      const v = Math.max(1, Math.round((maxTotal * pct) / 100))
      onChange(v)
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <label className="text-[11px] font-medium text-slate-700">{label}</label>
        {maxTotal > 0 && (
          <span className="text-[10px] font-mono text-slate-400">
            Max: {maxTotal} {unit}
          </span>
        )}
      </div>
      <input
        type="number"
        step={step}
        min={0}
        disabled={disabled}
        value={value}
        onChange={(e) => {
          const parsed = isFloat ? parseFloat(e.target.value) : parseInt(e.target.value, 10)
          onChange(Number.isFinite(parsed) && parsed >= 0 ? parsed : 0)
        }}
        className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-mono disabled:bg-slate-100"
      />
      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(0)}
          className={`rounded px-1.5 py-0.5 text-[10px] font-medium border cursor-pointer disabled:opacity-40 ${
            value === 0
              ? 'border-[#714B67] bg-purple-50 text-[#714B67]'
              : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
          }`}
        >
          Unlim
        </button>
        {PCT_PRESETS.map((pct) => {
          const targetVal =
            maxTotal > 0
              ? isFloat
                ? Math.max(0.1, Math.round((maxTotal * pct) / 100 * 100) / 100)
                : Math.max(1, Math.round((maxTotal * pct) / 100))
              : 0
          const active = maxTotal > 0 && value === targetVal
          return (
            <button
              key={pct}
              type="button"
              disabled={disabled || maxTotal <= 0}
              title={needsBenchmark && maxTotal <= 0 ? 'Run Disk Benchmark first' : `${pct}% of ${maxTotal} ${unit}`}
              onClick={() => applyPct(pct)}
              className={`rounded px-1.5 py-0.5 text-[10px] font-medium border cursor-pointer disabled:opacity-40 ${
                active
                  ? 'border-[#714B67] bg-purple-50 text-[#714B67]'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
              }`}
            >
              {pct}%
            </button>
          )
        })}
      </div>
    </div>
  )
}

function LimitsFields({
  title,
  subtitle,
  value,
  sysInfo,
  benchmark,
  disabled,
  onChange,
}: {
  title: string
  subtitle: string
  value: ContainerLimits
  sysInfo: SystemInfo | null
  benchmark: DiskBenchmark | null
  disabled?: boolean
  onChange: (next: ContainerLimits) => void
}) {
  return (
    <div className={`rounded-xl border border-slate-200 p-5 space-y-4 ${disabled ? 'bg-slate-50 opacity-70' : 'bg-white'}`}>
      <div>
        <div className="text-sm font-bold text-slate-900">{title}</div>
        <div className="text-xs text-slate-500">{subtitle}</div>
      </div>

      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        <MetricInputWithPresets
          label="CPU Cores (0 = unlimited)"
          value={value.cpuCores}
          maxTotal={sysInfo?.cpuCores || 0}
          unit="cores"
          step="0.01"
          isFloat
          disabled={disabled}
          onChange={(v) => onChange({ ...value, cpuCores: v })}
        />
        <MetricInputWithPresets
          label="RAM Limit MB (0 = unlimited)"
          value={value.memoryMb}
          maxTotal={sysInfo?.totalRamMb || 0}
          unit="MB"
          step="1"
          disabled={disabled}
          onChange={(v) => onChange({ ...value, memoryMb: v })}
        />
        <MetricInputWithPresets
          label="Disk Read IOPS"
          value={value.diskReadIops}
          maxTotal={benchmark?.readIops || 0}
          unit="IOPS"
          disabled={disabled}
          needsBenchmark
          onChange={(v) => onChange({ ...value, diskReadIops: v })}
        />
        <MetricInputWithPresets
          label="Disk Write IOPS"
          value={value.diskWriteIops}
          maxTotal={benchmark?.writeIops || 0}
          unit="IOPS"
          disabled={disabled}
          needsBenchmark
          onChange={(v) => onChange({ ...value, diskWriteIops: v })}
        />
        <MetricInputWithPresets
          label="Disk Read MB/s"
          value={value.diskReadMbps}
          maxTotal={benchmark?.readMbps || 0}
          unit="MB/s"
          disabled={disabled}
          needsBenchmark
          onChange={(v) => onChange({ ...value, diskReadMbps: v })}
        />
        <MetricInputWithPresets
          label="Disk Write MB/s"
          value={value.diskWriteMbps}
          maxTotal={benchmark?.writeMbps || 0}
          unit="MB/s"
          disabled={disabled}
          needsBenchmark
          onChange={(v) => onChange({ ...value, diskWriteMbps: v })}
        />
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
  const [benchmark, setBenchmark] = useState<DiskBenchmark | null>(null)
  const [benchBusy, setBenchBusy] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setOdooLimits({ ...EMPTY_LIMITS, ...instance.resources?.odooLimits })
    setDbLimits({ ...EMPTY_LIMITS, ...instance.resources?.dbLimits })
    setDiskDevice(instance.resources?.diskDevice || '')
  }, [instance])

  useEffect(() => {
    api.systemInfo().then(setSysInfo).catch(() => {})
    api.getBenchmark().then((r) => setBenchmark(r.benchmark)).catch(() => {})
  }, [])

  const handleBenchmark = async () => {
    setBenchBusy(true)
    try {
      const res = await api.runBenchmark()
      setBenchmark(res.benchmark)
      notify('Host disk benchmark completed!')
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Disk benchmark failed', 'error')
    } finally {
      setBenchBusy(false)
    }
  }

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

  const detectedDevice = benchmark?.blockDevice || sysInfo?.blockDevice || ''

  return (
    <div className="space-y-4">
      {/* Host Capacity & Benchmark Card */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Gauge className="h-4 w-4 text-[#714B67]" />
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Host Capacity &amp; Disk Benchmark</h3>
              <p className="text-xs text-slate-500">
                Jalankan benchmark disk terlebih dahulu untuk mengukur kapasitas IOPS &amp; MB/s host sehingga template persentase (10%–100%) bisa dihitung akurat.
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={benchBusy}
            onClick={handleBenchmark}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#714B67] bg-purple-50 px-3.5 py-2 text-xs font-semibold text-[#714B67] hover:bg-purple-100 disabled:opacity-60 cursor-pointer"
          >
            {benchBusy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : benchmark ? (
              <RotateCw className="h-3.5 w-3.5" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            {benchBusy ? 'Benchmarking (~3s)...' : benchmark ? 'Re-run Disk Benchmark' : 'Run Disk Benchmark'}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 text-xs">
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
            <div className="text-slate-500">Host CPU</div>
            <div className="mt-1 text-base font-bold text-slate-900">{sysInfo ? `${sysInfo.cpuCores} Cores` : '—'}</div>
          </div>
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
            <div className="text-slate-500">Host RAM</div>
            <div className="mt-1 text-base font-bold text-slate-900">{sysInfo ? `${sysInfo.totalRamMb} MB` : '—'}</div>
          </div>
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
            <div className="text-slate-500">Disk Read IOPS</div>
            <div className="mt-1 text-base font-bold text-slate-900">{benchmark ? benchmark.readIops : 'Not tested'}</div>
          </div>
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
            <div className="text-slate-500">Disk Write IOPS</div>
            <div className="mt-1 text-base font-bold text-slate-900">{benchmark ? benchmark.writeIops : 'Not tested'}</div>
          </div>
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
            <div className="text-slate-500">Disk Read MB/s</div>
            <div className="mt-1 text-base font-bold text-slate-900">{benchmark ? `${benchmark.readMbps} MB/s` : 'Not tested'}</div>
          </div>
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
            <div className="text-slate-500">Disk Write MB/s</div>
            <div className="mt-1 text-base font-bold text-slate-900">{benchmark ? `${benchmark.writeMbps} MB/s` : 'Not tested'}</div>
          </div>
        </div>

        {!benchmark && (
          <div className="rounded-lg border border-sky-200 bg-sky-50 px-3.5 py-2.5 text-xs text-sky-800">
            Klik <strong>Run Disk Benchmark</strong> di atas untuk mengukur IOPS &amp; MB/s disk server Anda dan mengaktifkan tombol persentase (10%–100%) pada Disk Read/Write.
          </div>
        )}

        {sysInfo?.limitNotes && (
          <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" />
            <div>
              <strong>Host Capability Check:</strong> {sysInfo.limitNotes}
            </div>
          </div>
        )}
      </div>

      {/* Resource Limits Form */}
      <form onSubmit={handleSave} className="space-y-4">
        {errorMsg && (
          <div className="flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-xs text-rose-700">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-rose-600" />
            <div>
              <strong>Gagal menerapkan limit:</strong> {errorMsg}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <LimitsFields
            title={`Odoo Container (${instance.containerName})`}
            subtitle="Pilih persentase per metrik (bisa campur) atau isi manual (0 = unlimited)"
            value={odooLimits}
            sysInfo={sysInfo}
            benchmark={benchmark}
            onChange={setOdooLimits}
          />
          <LimitsFields
            title={`PostgreSQL Container (${instance.dbContainerName})`}
            subtitle={
              instance.dbMode === 'dedicated'
                ? 'Pilih persentase per metrik untuk PostgreSQL dedicated'
                : 'Mode Shared: PostgreSQL dipakai bersama, limit DB per-instance hanya berlaku untuk mode Dedicated'
            }
            value={dbLimits}
            sysInfo={sysInfo}
            benchmark={benchmark}
            disabled={instance.dbMode !== 'dedicated'}
            onChange={setDbLimits}
          />
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs text-slate-600">
              <HardDrive className="h-3.5 w-3.5 text-slate-400" />
              <span>Host Block Device:</span>
            </div>
            <input
              type="text"
              value={diskDevice}
              onChange={(e) => setDiskDevice(e.target.value)}
              placeholder={detectedDevice ? `Auto (${detectedDevice})` : 'e.g. /dev/vda'}
              className="w-48 rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono text-xs"
            />
            {detectedDevice && (
              <span className="text-[11px] text-slate-400">
                Terdeteksi: <code className="font-mono">{detectedDevice}</code>
              </span>
            )}
          </div>

          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#714B67] px-5 py-2 text-sm font-semibold text-white hover:bg-[#5c3c54] disabled:opacity-60 cursor-pointer"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? 'Applying Limits...' : 'Save & Apply Limits'}
          </button>
        </div>
      </form>
    </div>
  )
}
