import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import EChart from '../components/EChart.jsx';
import Card, { CardTitle } from '../components/Card.jsx';
import { useFetch } from '../hooks/useFetch.js';
import { api } from '../api/client.js';
import { fmt, longDate, todayISO } from '../lib/format.js';

const MACROS = [
  { key: 'protein', label: '蛋白质', kcalPerG: 4, color: '#10b981' },
  { key: 'fat', label: '脂肪', kcalPerG: 9, color: '#f59e0b' },
  { key: 'carbs', label: '碳水', kcalPerG: 4, color: '#3b82f6' },
];

function StatTile({ label, value, unit, tone = 'slate' }) {
  const toneMap = {
    slate: 'text-slate-900',
    emerald: 'text-emerald-600',
    amber: 'text-amber-600',
  };
  return (
    <div className="flex-1 rounded-xl bg-slate-50 px-3 py-2.5">
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className={`mt-0.5 text-lg font-semibold tabular ${toneMap[tone]}`}>
        {value}
        <span className="ml-0.5 text-[11px] font-normal text-slate-400">{unit}</span>
      </p>
    </div>
  );
}

export default function Dashboard() {
  const date = todayISO();
  const { data, loading, error, reload } = useFetch(() => api.dashboard(date), [date]);

  const intake = data?.intake ?? { calories: 0, protein: 0, fat: 0, carbs: 0 };
  const goal = data?.goal ?? { calories: 1800, protein_g: 108, fat_g: 50, carbs_g: 252 };
  const burn = data?.burn ?? { calories: 0, count: 0, duration_min: 0 };
  const body = data?.body ?? {};

  // 今日可摄入预算 = 目标 + 运动消耗（运动掉的热量可以吃回来）
  const budget = goal.calories + burn.calories;
  const remaining = budget - intake.calories;
  const over = remaining < 0;
  const intakePct = budget > 0 ? Math.max(0, Math.min(100, Math.round((intake.calories / budget) * 100))) : 0;

  const macroItems = MACROS.map((m) => ({
    ...m,
    grams: Number(intake[m.key] || 0),
    kcal: Number(intake[m.key] || 0) * m.kcalPerG,
  }));
  const macroTotal = macroItems.reduce((s, i) => s + i.kcal, 0);

  const macroOption = useMemo(
    () => ({
      tooltip: { trigger: 'item', formatter: '{b}<br/>{c} kcal ({d}%)' },
      series: [
        {
          type: 'pie',
          radius: ['62%', '86%'],
          center: ['50%', '50%'],
          avoidLabelOverlap: true,
          label: { show: false },
          labelLine: { show: false },
          itemStyle: { borderColor: '#fff', borderWidth: 2 },
          data: macroItems.map((i) => ({
            value: Math.round(i.kcal * 10) / 10,
            name: i.label,
            itemStyle: { color: i.color },
          })),
        },
      ],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intake.protein, intake.fat, intake.carbs]
  );

  if (loading && !data) {
    return (
      <div className="animate-pulse space-y-3">
        <div className="h-8 w-40 rounded-lg bg-slate-200" />
        <div className="h-36 rounded-2xl bg-slate-200" />
        <div className="h-56 rounded-2xl bg-slate-200" />
      </div>
    );
  }

  return (
    <div className="space-y-3.5">
      <header className="flex items-start justify-between">
        <div>
          <p className="text-xs text-slate-500">{longDate(date)}</p>
          <h1 className="mt-0.5 flex items-center gap-1.5 text-xl font-semibold tracking-tight">
            你好，{data?.profile?.nickname || '我'}
            {data?.profile?.goal_label ? (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-normal text-slate-500">
                {data.profile.goal_label}
              </span>
            ) : null}
          </h1>
        </div>
        <button
          type="button"
          onClick={() => {
            reload();
          }}
          className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-500 active:bg-slate-100"
        >
          刷新
        </button>
      </header>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-600">
          {error}
        </div>
      ) : null}

      {/* 今日可摄入 */}
      <Card className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-slate-500">
              {over ? '今日已超出' : '今日还可摄入'}
            </p>
            <p
              className={`mt-1 text-4xl font-semibold tracking-tight tabular ${
                over ? 'text-amber-600' : ''
              }`}
            >
              {fmt(Math.abs(remaining))}
              <span className="ml-1 text-sm font-normal text-slate-400">kcal</span>
            </p>
            <p className="mt-1 text-xs text-slate-500">
              预算 {fmt(budget)} = 目标 {fmt(goal.calories)} + 运动 {fmt(burn.calories)}
            </p>
          </div>
          <span
            className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] ${
              over ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'
            }`}
          >
            {over ? '超出预算' : `已摄入 ${fmt(intake.calories)}`}
          </span>
        </div>

        <div className="mt-4">
          <div className="mb-1 flex justify-between text-[11px] text-slate-400">
            <span>
              已摄入 {fmt(intake.calories)} / 预算 {fmt(budget)} kcal
            </span>
            <span className="tabular">{intakePct}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                over ? 'bg-amber-500' : 'bg-emerald-500'
              }`}
              style={{ width: `${intakePct}%` }}
            />
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          <StatTile label="摄入" value={fmt(intake.calories)} unit="kcal" />
          <StatTile label="消耗" value={fmt(burn.calories)} unit="kcal" tone="emerald" />
          <StatTile label="运动" value={fmt(burn.duration_min)} unit="min" tone="amber" />
        </div>
      </Card>

      {/* 三大营养素 */}
      <Card className="p-4">
        <CardTitle extra={`合计 ${fmt(macroTotal)} kcal`}>三大营养素</CardTitle>
        {macroTotal > 0 ? (
          <div className="flex items-center gap-2">
            <div className="relative h-[150px] w-[150px] shrink-0">
              <EChart option={macroOption} height={150} />
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-[11px] text-slate-400">今日摄入</span>
                <span className="text-lg font-semibold tabular">{fmt(intake.calories)}</span>
                <span className="text-[10px] text-slate-400">kcal</span>
              </div>
            </div>
            <ul className="flex-1 space-y-2.5">
              {macroItems.map((m) => {
                const pct = macroTotal ? Math.round((m.kcal / macroTotal) * 100) : 0;
                return (
                  <li key={m.key} className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: m.color }}
                    />
                    <span className="flex-1 text-xs text-slate-600">{m.label}</span>
                    <span className="text-xs text-slate-400 tabular">{pct}%</span>
                    <span className="w-12 text-right text-xs font-medium text-slate-700 tabular">
                      {fmt(m.grams, 0)}g
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 px-4 py-7 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-50">
              <svg
                viewBox="0 0 24 24"
                className="h-6 w-6 text-slate-300"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3.5 11.5h17a8.5 8.5 0 0 1-17 0Z" />
                <path d="M8.5 7.5c0-1.6 1.2-2 1.2-3.5M12.5 7.5c0-1.6 1.2-2 1.2-3.5M16.5 7.5c0-1.6 1.2-2 1.2-3.5" />
              </svg>
            </div>
            <p className="mt-2.5 text-xs text-slate-400">还没有今日饮食记录</p>
            <Link
              to="/diet"
              className="mt-3 rounded-full bg-emerald-600 px-4 py-1.5 text-xs font-medium text-white active:bg-emerald-700"
            >
              去拍照记录
            </Link>
            <p className="mt-2 text-[11px] text-slate-400">拍一张餐盘照片，AI 会认出食物并估算热量</p>
          </div>
        )}
      </Card>

    </div>
  );
}
