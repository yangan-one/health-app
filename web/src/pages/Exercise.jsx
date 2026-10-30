import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Card, { CardTitle } from '../components/Card.jsx';
import { NumberField } from '../components/Field.jsx';
import Toast from '../components/Toast.jsx';
import { useFetch } from '../hooks/useFetch.js';
import { api } from '../api/client.js';
import { fmt, todayISO } from '../lib/format.js';

const QUICK_DURATIONS = [15, 30, 45, 60];

export default function Exercise() {
  const date = todayISO();

  const [typeCode, setTypeCode] = useState('');
  const [duration, setDuration] = useState('30');
  const [distance, setDistance] = useState('');
  const [weight, setWeight] = useState('');
  const [calc, setCalc] = useState(null);
  const [calcError, setCalcError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [records, setRecords] = useState([]);
  const [summary, setSummary] = useState(null);
  const [listLoading, setListLoading] = useState(true);
  const [confirmId, setConfirmId] = useState(null);

  const types = useFetch(() => api.exerciseTypes());
  const latest = useFetch(() => api.latestMetric());

  const typeList = types.data ?? [];
  const selected = typeList.find((t) => t.code === typeCode) ?? typeList[0] ?? null;
  const hasDistance = selected ? Boolean(Number(selected.has_distance)) : false;
  const latestWeight = latest.data?.weight_kg ?? null;

  useEffect(() => {
    if (!typeCode && typeList.length) setTypeCode(typeList[0].code);
  }, [typeCode, typeList]);

  // 切到不需要距离的类型时清空距离，避免脏数据跟着提交
  useEffect(() => {
    if (!hasDistance) setDistance('');
  }, [hasDistance]);

  // 提示条自动消失
  useEffect(() => {
    if (!msg) return undefined;
    const timer = setTimeout(() => setMsg(null), msg.type === 'ok' ? 2200 : 3200);
    return () => clearTimeout(timer);
  }, [msg]);

  const loadRecords = useCallback(async () => {
    setListLoading(true);
    try {
      const res = await api.todayExercises(date);
      setRecords(res.data ?? []);
      setSummary(res.summary ?? null);
    } catch (e) {
      setMsg({ type: 'error', text: e.message });
    } finally {
      setListLoading(false);
    }
  }, [date]);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  // 填表时实时试算（防抖 350ms），让用户立刻看到「这次大概消耗多少」
  useEffect(() => {
    const mins = Number(duration);
    if (!selected || !Number.isFinite(mins) || mins <= 0) {
      setCalc(null);
      setCalcError(null);
      return undefined;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await api.calcExercise({
          type_code: selected.code,
          duration_min: mins,
          distance_km: distance === '' ? undefined : Number(distance),
          weight_kg: weight === '' ? undefined : Number(weight),
        });
        setCalc(res.data);
        setCalcError(null);
      } catch (e) {
        setCalc(null);
        setCalcError(e.message);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [selected?.code, duration, distance, weight]);

  async function handleSave() {
    if (!selected) return;
    setSaving(true);
    setMsg(null);
    try {
      await api.addExercise({
        type_code: selected.code,
        duration_min: Number(duration),
        distance_km: distance === '' ? undefined : Number(distance),
        weight_kg: weight === '' ? undefined : Number(weight),
        record_date: date,
      });
      setMsg({
        type: 'ok',
        text: `已记录 ${selected.name} ${fmt(Number(duration))} 分钟 · ${fmt(calc?.calories_burned ?? 0)} kcal`,
      });
      setDistance('');
      await loadRecords();
    } catch (e) {
      setMsg({ type: 'error', text: e.message });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    try {
      await api.deleteExercise(id);
      setConfirmId(null);
      setMsg({ type: 'ok', text: '已删除该条记录' });
      await loadRecords();
    } catch (e) {
      setMsg({ type: 'error', text: e.message });
    }
  }

  return (
    <div className="space-y-3.5">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">运动记录</h1>
        <p className="mt-0.5 text-xs text-slate-500">
          按 METs 代谢当量估算消耗，体重默认取最近一次体测
        </p>
      </header>

      <Card className="p-4">
        <CardTitle extra={hasDistance ? '需填写距离' : '无需距离'}>记录一次运动</CardTitle>

        <div className="grid grid-cols-3 gap-2">
          {typeList.map((t) => {
            const active = selected?.code === t.code;
            return (
              <button
                key={t.code}
                type="button"
                onClick={() => setTypeCode(t.code)}
                className={`rounded-xl border px-1 py-2 text-center transition ${
                  active
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                    : 'border-slate-200 bg-white text-slate-600 active:bg-slate-50'
                }`}
              >
                <span className="block text-xs font-medium leading-tight">{t.name}</span>
                <span
                  className={`mt-0.5 block text-[10px] tabular ${active ? 'text-emerald-600' : 'text-slate-400'}`}
                >
                  MET {t.met}
                </span>
              </button>
            );
          })}
          {types.loading ? <p className="col-span-3 text-xs text-slate-400">加载运动类型…</p> : null}
        </div>

        <div className="mt-3 space-y-2.5">
          <div>
            <NumberField
              label="时长"
              unit="分钟"
              value={duration}
              onChange={setDuration}
              min={1}
              step="1"
            />
            <div className="mt-2 flex gap-1.5">
              {QUICK_DURATIONS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setDuration(String(m))}
                  className={`flex-1 rounded-lg border py-1 text-[11px] transition ${
                    Number(duration) === m
                      ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                      : 'border-slate-200 text-slate-500'
                  }`}
                >
                  {m} 分钟
                </button>
              ))}
            </div>
          </div>

          {hasDistance ? (
            <NumberField
              label="距离"
              unit="km"
              value={distance}
              onChange={setDistance}
              placeholder="请输入 km"
              min={0}
              step="0.1"
              highlight
              hint="需填写"
            />
          ) : (
            <p className="text-[11px] text-slate-400">
              {selected?.name ?? '该运动'} 按时间估算消耗，无需填写距离
            </p>
          )}

          <NumberField
            label="体重（默认用最近体测）"
            unit="kg"
            value={weight}
            onChange={setWeight}
            placeholder={latestWeight ? `${fmt(latestWeight, 1)}` : '请先记录体重'}
            min={10}
          />
        </div>

        {calcError ? (
          <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-600">
            {calcError}
            {/体重/.test(calcError) ? (
              <Link to="/body" className="ml-1 font-medium underline">
                去记录体重
              </Link>
            ) : null}
          </p>
        ) : null}

        {calc ? (
          <div className="mt-3 rounded-xl bg-emerald-50/70 px-3 py-3">
            <div className="flex items-end justify-between">
              <div>
                <p className="text-[11px] text-emerald-700/80">预计消耗</p>
                <p className="text-2xl font-semibold text-emerald-700 tabular">
                  {fmt(calc.calories_burned)}
                  <span className="ml-1 text-xs font-normal text-emerald-600/80">kcal</span>
                </p>
              </div>
              <div className="text-right text-[11px] text-emerald-700/70">
                <p>
                  体重 {fmt(calc.weight_kg, 1)} kg
                  {calc.weight_source === 'latest_body_metric' ? '（最近体测）' : ''}
                </p>
                <p>
                  MET {calc.met} · {fmt(calc.duration_min)} min
                  {calc.speed_kmh ? ` · ${fmt(calc.speed_kmh, 1)} km/h` : ''}
                </p>
              </div>
            </div>
            <p className="mt-2 border-t border-emerald-200/60 pt-2 text-[10px] text-emerald-700/60">
              {calc.formula}
            </p>
          </div>
        ) : null}

        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !selected || !calc}
          className="mt-3 w-full rounded-xl bg-emerald-600 py-3 text-sm font-medium text-white transition active:bg-emerald-700 disabled:opacity-50"
        >
          {saving ? '保存中…' : '保存记录'}
        </button>
      </Card>
      <Toast toast={msg ? { tone: msg.type === 'ok' ? 'ok' : 'error', text: msg.text } : null} />

      <Card className="p-4">
        <CardTitle extra={summary ? `合计 ${fmt(summary.total_calories)} kcal` : null}>
          今日运动
        </CardTitle>

        {summary && summary.count > 0 ? (
          <div className="mb-2 flex gap-2 text-[11px] text-slate-500">
            <span className="rounded-lg bg-slate-50 px-2 py-1">{summary.count} 次</span>
            <span className="rounded-lg bg-slate-50 px-2 py-1">
              {fmt(summary.total_duration_min)} 分钟
            </span>
            {summary.total_distance_km > 0 ? (
              <span className="rounded-lg bg-slate-50 px-2 py-1">
                {fmt(summary.total_distance_km, 1)} km
              </span>
            ) : null}
          </div>
        ) : null}

        {listLoading ? (
          <p className="py-6 text-center text-xs text-slate-400">加载中…</p>
        ) : records.length ? (
          <ul className="divide-y divide-slate-100">
            {records.map((r) => (
              <li key={r.id} className="flex items-center gap-2 py-2.5 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-slate-700">{r.exercise_type_name}</p>
                  <p className="text-[11px] text-slate-400">
                    {fmt(r.duration_min)} 分钟
                    {r.distance_km ? ` · ${fmt(r.distance_km, 2)} km` : ''} · MET {r.met}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-medium text-emerald-600 tabular">
                  {fmt(r.calories_burned)}
                </span>
                {confirmId === r.id ? (
                  <button
                    type="button"
                    onClick={() => handleDelete(r.id)}
                    className="shrink-0 rounded-lg bg-rose-500 px-2 py-1 text-[11px] text-white"
                  >
                    确认删除
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmId(r.id)}
                    className="shrink-0 rounded-lg px-2 py-1 text-[11px] text-slate-400 active:bg-slate-100"
                  >
                    删除
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-6 text-center text-xs text-slate-400">今天还没有运动记录</p>
        )}
      </Card>
    </div>
  );
}
