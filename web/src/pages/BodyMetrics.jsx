import { useEffect, useMemo, useRef, useState } from 'react';
import EChart from '../components/EChart.jsx';
import Card, { CardTitle } from '../components/Card.jsx';
import { NumberField } from '../components/Field.jsx';
import { useFetch } from '../hooks/useFetch.js';
import { api } from '../api/client.js';
import { fmt, shortDate, todayISO } from '../lib/format.js';

const BASIC_FIELDS = [
  { field: 'weight_kg', label: '体重', unit: 'kg' },
  { field: 'body_fat_pct', label: '体脂率', unit: '%' },
];

const GIRTH_FIELDS = [
  { field: 'neck_cm', label: '颈围', unit: 'cm' },
  { field: 'shoulder_cm', label: '肩围', unit: 'cm' },
  { field: 'chest_cm', label: '胸围', unit: 'cm' },
  { field: 'arm_cm', label: '臂围', unit: 'cm' },
  { field: 'waist_cm', label: '腰围', unit: 'cm' },
  { field: 'hip_cm', label: '臀围', unit: 'cm' },
  { field: 'thigh_cm', label: '大腿围', unit: 'cm' },
  { field: 'calf_cm', label: '小腿围', unit: 'cm' },
];

const ALL_FIELDS = [...BASIC_FIELDS, ...GIRTH_FIELDS];

const CHART_METRICS = [
  { key: 'weight_kg', label: '体重', unit: 'kg', color: '#10b981' },
  { key: 'body_fat_pct', label: '体脂率', unit: '%', color: '#8b5cf6' },
  { key: 'waist_cm', label: '腰围', unit: 'cm', color: '#f59e0b' },
  { key: 'chest_cm', label: '胸围', unit: 'cm', color: '#3b82f6' },
  { key: 'hip_cm', label: '臀围', unit: 'cm', color: '#ec4899' },
  { key: 'arm_cm', label: '臂围', unit: 'cm', color: '#14b8a6' },
  { key: 'thigh_cm', label: '大腿围', unit: 'cm', color: '#a855f7' },
];

const DAY_OPTIONS = [7, 30, 90];

export default function BodyMetrics() {
  const [date, setDate] = useState(todayISO());
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [chartMetric, setChartMetric] = useState('weight_kg');
  const [days, setDays] = useState(30);

  const latest = useFetch(() => api.latestMetric());
  const profile = useFetch(() => api.profile());
  const trend = useFetch(() => api.trend(days), [days]);

  // 首次拿到「最近一次记录」时预填表单，方便只改其中几项
  const prefilled = useRef(false);
  useEffect(() => {
    if (!latest.data || prefilled.current) return;
    const next = {};
    for (const f of ALL_FIELDS) {
      const v = latest.data[f.field];
      next[f.field] = v === null || v === undefined ? '' : String(v);
    }
    setForm(next);
    prefilled.current = true;
  }, [latest.data]);

  function update(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const payload = { record_date: date };
    let count = 0;
    for (const f of ALL_FIELDS) {
      const raw = form[f.field];
      if (raw !== undefined && String(raw).trim() !== '') {
        payload[f.field] = Number(raw);
        count += 1;
      }
    }
    if (count === 0) {
      setMsg({ type: 'error', text: '请至少填写一项数据' });
      return;
    }

    setSaving(true);
    setMsg(null);
    try {
      await api.saveMetric(payload);
      setMsg({ type: 'ok', text: `已保存 ${date} 的数据` });
      latest.reload();
      trend.reload();
    } catch (err) {
      setMsg({ type: 'error', text: err.message });
    } finally {
      setSaving(false);
    }
  }

  const points = trend.data?.points ?? [];
  const metric = CHART_METRICS.find((m) => m.key === chartMetric) ?? CHART_METRICS[0];
  const series = points.filter((p) => p[metric.key] !== null && p[metric.key] !== undefined);

  const chartOption = useMemo(
    () => ({
      grid: { left: 4, right: 12, top: 16, bottom: 4, containLabel: true },
      tooltip: {
        trigger: 'axis',
        valueFormatter: (v) => (v === null || v === undefined ? '--' : `${v} ${metric.unit}`),
      },
      xAxis: {
        type: 'category',
        data: series.map((p) => shortDate(p.date)),
        axisLine: { lineStyle: { color: '#e2e8f0' } },
        axisTick: { show: false },
        axisLabel: { color: '#94a3b8', fontSize: 10 },
      },
      yAxis: {
        type: 'value',
        scale: true,
        splitLine: { lineStyle: { color: '#f1f5f9' } },
        axisLabel: { color: '#94a3b8', fontSize: 10 },
      },
      series: [
        {
          type: 'line',
          smooth: true,
          symbolSize: 5,
          showSymbol: series.length <= 20,
          data: series.map((p) => p[metric.key]),
          lineStyle: { width: 2.5, color: metric.color },
          itemStyle: { color: metric.color },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: `${metric.color}33` },
                { offset: 1, color: `${metric.color}05` },
              ],
            },
          },
        },
      ],
    }),
    [chartMetric, series.length]
  );

  // 用当前输入实时计算，边填边变，不必等保存
  const heightCm = Number(profile.data?.height_cm) || 0;
  const liveBmi = useMemo(() => {
    const w = Number(form.weight_kg);
    if (!w || !heightCm) return null;
    const h = heightCm / 100;
    return Math.round((w / (h * h)) * 10) / 10;
  }, [form.weight_kg, heightCm]);
  const liveWhr = useMemo(() => {
    const waist = Number(form.waist_cm);
    const hip = Number(form.hip_cm);
    if (!waist || !hip) return null;
    return Math.round((waist / hip) * 100) / 100;
  }, [form.waist_cm, form.hip_cm]);

  // 输入不全时退回「最近一次已保存」的值，避免显示成空
  const bmi = liveBmi ?? latest.data?.bmi ?? null;
  const whr = liveWhr ?? latest.data?.waist_hip_ratio ?? null;

  return (
    <div className="space-y-3.5">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">身体数据</h1>
        <p className="mt-0.5 text-xs text-slate-500">
          同一天重复保存会覆盖当天数据，未填写的项保持原值
        </p>
      </header>

      <Card className="p-4">
        <CardTitle
          extra={
            latest.data?.record_date ? `上次记录 ${shortDate(latest.data.record_date)}` : '还没有记录'
          }
        >
          新增 / 更新记录
        </CardTitle>

        <form onSubmit={handleSubmit} className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs text-slate-500">记录日期</span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2.5 text-[15px] text-slate-900 tabular outline-none transition focus:border-emerald-400 focus:bg-white focus:ring-2 focus:ring-emerald-100"
            />
          </label>

          <div className="grid grid-cols-2 gap-2.5">
            {BASIC_FIELDS.map((f) => (
              <NumberField
                key={f.field}
                label={f.label}
                unit={f.unit}
                placeholder={`请输入 ${f.unit}`}
                value={form[f.field] ?? ''}
                onChange={(v) => update(f.field, v)}
              />
            ))}
          </div>

          {/* 随输入实时变化的派生指标 */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] text-slate-500">
              BMI{' '}
              <span className="font-semibold text-slate-700 tabular">
                {bmi === null ? '--' : fmt(bmi, 1)}
              </span>
            </span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] text-slate-500">
              腰臀比{' '}
              <span className="font-semibold text-slate-700 tabular">
                {whr === null ? '--' : fmt(whr, 2)}
              </span>
            </span>
            {liveBmi === null || liveWhr === null ? (
              <span className="text-[11px] text-slate-400">填完体重 / 腰围臀围自动计算</span>
            ) : null}
          </div>

          <div>
            <p className="mb-1.5 mt-1 text-xs font-medium text-slate-600">身体围度（选填）</p>
            <div className="grid grid-cols-2 gap-2.5">
              {GIRTH_FIELDS.map((f) => (
                <NumberField
                  key={f.field}
                  label={f.label}
                  unit={f.unit}
                  placeholder="请输入 cm"
                  value={form[f.field] ?? ''}
                  onChange={(v) => update(f.field, v)}
                />
              ))}
            </div>
          </div>

          {msg ? (
            <p
              className={`rounded-xl px-3 py-2 text-xs ${
                msg.type === 'ok'
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-rose-50 text-rose-600'
              }`}
            >
              {msg.text}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-medium text-white transition active:bg-emerald-700 disabled:opacity-60"
          >
            {saving ? '保存中…' : '保存记录'}
          </button>
        </form>
      </Card>

      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-800">变化趋势</h2>
          <div className="flex gap-1 rounded-lg bg-slate-100 p-0.5">
            {DAY_OPTIONS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDays(d)}
                className={`rounded-md px-2 py-0.5 text-[11px] transition ${
                  days === d ? 'bg-white font-medium text-slate-800 shadow-sm' : 'text-slate-500'
                }`}
              >
                {d}天
              </button>
            ))}
          </div>
        </div>

        <div className="no-scrollbar -mx-1 mb-2 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {CHART_METRICS.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setChartMetric(m.key)}
              className={`shrink-0 rounded-full border px-3 py-1 text-xs transition ${
                chartMetric === m.key
                  ? 'border-emerald-500 bg-emerald-50 font-medium text-emerald-700'
                  : 'border-slate-200 text-slate-500'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {series.length >= 2 ? (
          <EChart option={chartOption} height={200} />
        ) : (
          <div className="flex h-[150px] flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 text-center">
            <p className="text-xs text-slate-400">
              {series.length === 1 ? '再记录一次就能看到趋势' : `${metric.label}还没有数据`}
            </p>
          </div>
        )}

        {series.length >= 2 ? (
          <div className="mt-1 flex justify-between text-xs text-slate-500">
            <span>
              区间变化{' '}
              <span className="font-medium text-slate-700 tabular">
                {fmt(series[series.length - 1][metric.key] - series[0][metric.key], 1)} {metric.unit}
              </span>
            </span>
            <span>
              最新{' '}
              <span className="font-medium text-slate-700 tabular">
                {fmt(series[series.length - 1][metric.key], 1)} {metric.unit}
              </span>
            </span>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
