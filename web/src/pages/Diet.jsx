import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { fileToDataUrl } from '../lib/image.js';
import { todayISO, longDate, fmt } from '../lib/format.js';
import { useFetch } from '../hooks/useFetch.js';
import { COOKING_PROFILES, cookingExtraPer100 } from '../lib/cooking.js';
import Card, { CardTitle } from '../components/Card.jsx';
import Toast from '../components/Toast.jsx';

const MEAL_LABEL = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐', snack: '加餐' };

const num = (v) => {
  const n = Number(String(v ?? '').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

/** 一行可编辑的食物明细。p100 = 每 100g 营养（已含烹饪用油修正），改克重时按它线性缩放 */
const emptyRow = (weight = '') => ({
  food_name: '',
  estimated_weight_g: weight,
  p100: null, // { calories, protein, fat, carbs } per 100g
  manualKcal: '', // 营养库对不上时，允许自己填热量
  cooking: null, // 烹饪方式（水煮 / 炒 / 炸 …）
  cookingNote: null, // 为什么这么算
  confidence: null,
  source: null,
});

const round1 = (n) => Math.round(n * 10) / 10;

/** 服务端返回的营养素是按「该行实际克重」算好的，反推出每 100g */
const per100 = (value, weightG) =>
  weightG > 0 ? Math.round((Number(value) / weightG) * 1000) / 10 : null;

const p100FromItem = (item) => {
  const w = Number(item.estimated_weight_g);
  // 服务端会直接返回「不含烹饪用油」的每 100g 基准值，优先用它
  if (item.per_100g) {
    return {
      calories: Number(item.per_100g.calories) || 0,
      protein: Number(item.per_100g.protein) || 0,
      fat: Number(item.per_100g.fat) || 0,
      carbs: Number(item.per_100g.carbs) || 0,
    };
  }
  if (!(w > 0)) return null;
  return {
    calories: per100(item.calories, w) ?? 0,
    protein: per100(item.protein, w) ?? 0,
    fat: per100(item.fat, w) ?? 0,
    carbs: per100(item.carbs, w) ?? 0,
  };
};

/** 计算某一行在当前克重下的营养。改克重 → 这里实时重算，不用请求后端 */
const rowMacros = (row) => {
  const w = num(row.estimated_weight_g);
  if (!(w > 0)) return { calories: 0, protein: 0, fat: 0, carbs: 0 };
  if (row.p100) {
    // p100 是「不含烹饪用油」的基准；营养库命中的行才需要按做法补油
    // （AI 兜底行的数值来自模型，已经含油，再加一次就重复了）
    // 取整顺序与服务端保持一致（先按克重缩放再取整），避免界面和库里差 1 kcal
    const k = w / 100;
    const adj = row.source === 'food_db' ? cookingExtraPer100(row.cooking, row.food_name) : null;
    return {
      calories: Math.round(row.p100.calories * k) + Math.round(adj ? adj.extra_calories * k : 0),
      protein: round1(row.p100.protein * k),
      fat: round1(row.p100.fat * k + (adj ? adj.oil_g * k : 0)),
      carbs: round1(row.p100.carbs * k + (adj ? adj.sugar_g * k : 0)),
    };
  }
  const kcal = num(row.manualKcal);
  if (kcal > 0) return { calories: Math.round(kcal), protein: 0, fat: 0, carbs: 0 };
  return { calories: 0, protein: 0, fat: 0, carbs: 0 };
};

const COOKING_LABEL = (m) => (m && m !== '未知' ? m : null);

export default function Diet() {
  const today = todayISO();

  const [mealType, setMealType] = useState('lunch');
  const [image, setImage] = useState(null); // { dataUrl, kb }
  const [analysis, setAnalysis] = useState(null); // 服务端 analyze 的返回
  const [rows, setRows] = useState([]); // 可编辑明细
  const [busy, setBusy] = useState(false); // 识别中
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [manualMode, setManualMode] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const cameraRef = useRef(null);
  const albumRef = useRef(null);

  const settings = useFetch(() => api.settings());
  const mealTypes = useFetch(() => api.mealTypes());
  const todayRecords = useFetch(() => api.dietRecords(today), [today]);

  const visionReady = settings.data?.ai?.vision?.configured === true;
  const fakeMode = settings.data?.ai?.vision?.fake === true;
  const visionModel = settings.data?.ai?.vision?.model || '';

  // 首次拿到餐次建议后自动选中（按服务器当前时间猜早/午/晚/加餐）
  useEffect(() => {
    if (mealTypes.data?.suggested) setMealType(mealTypes.data.suggested);
  }, [mealTypes.data?.suggested]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.tone === 'error' ? 4200 : 2200);
    return () => clearTimeout(t);
  }, [toast]);

  const showToast = (tone, text) => setToast({ tone, text, id: Date.now() });

  const analyze = useCallback(
    async (dataUrl, meal) => {
      setBusy(true);
      setAnalysis(null);
      try {
        const res = await api.analyzeDiet({ image: dataUrl, meal_type: meal, record_date: today });
        const d = res.data;
        setAnalysis(d);
        setRows(
          d.items.map((it) => ({
            food_name: it.food_name,
            estimated_weight_g: String(it.estimated_weight_g),
            p100: p100FromItem(it),
            manualKcal: '',
            cooking: it.cooking_method ?? null,
            cookingNote: it.cooking_note ?? null,
            confidence: it.confidence,
            source: it.source,
          }))
        );
        if (d.meal_type) setMealType(d.meal_type);
        showToast('ok', `识别到 ${d.items.length} 项食物，可改克重`);
      } catch (err) {
        showToast('error', err.message);
      } finally {
        setBusy(false);
      }
    },
    [today]
  );

  const handlePick = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = ''; // 允许重复选同一张
    if (!file) return;
    try {
      const { dataUrl, kb } = await fileToDataUrl(file);
      setImage({ dataUrl, kb });
      await analyze(dataUrl, mealType);
    } catch (err) {
      showToast('error', err.message);
    }
  };

  const updateRow = (index, patch) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  /**
   * 菜名改完去营养库查一次：
   * 命中就用 per-100g 重算（并按当前做法加油糖），对不上就保留用户手填的热量。
   */
  const lookupRow = async (index) => {
    const name = rows[index]?.food_name?.trim();
    if (!name) return;
    try {
      const res = await api.foods(name);
      const d = res.data;
      const food = d.matched ? d.foods.find((f) => f.id === d.matched.id) ?? d.foods[0] : d.foods?.[0];
      if (!food) return;
      const base = {
        calories: Number(food.calories_per_100g) ?? 0,
        protein: Number(food.protein_per_100g) ?? 0,
        fat: Number(food.fat_per_100g) ?? 0,
        carbs: Number(food.carbs_per_100g) ?? 0,
      };
      // 存的是「不含油」的基准值，做法修正交给 rowMacros 统一加，避免重复加油
      const adj = cookingExtraPer100(rows[index]?.cooking, name);
      updateRow(index, {
        p100: base,
        cookingNote: adj.applied
          ? `${name}：营养库 ${food.name} ${food.calories_per_100g} kcal/100g，按「${rows[index]?.cooking}」再补 ${adj.oil_g}g 油/100g`
          : `营养库命中：${food.name} ${food.calories_per_100g} kcal/100g`,
        source: 'food_db',
      });
    } catch {
      /* 查不到就算了，保存时服务端还会再算一遍 */
    }
  };

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, r) => {
        const m = rowMacros(r);
        acc.calories += m.calories;
        acc.protein += m.protein;
        acc.fat += m.fat;
        acc.carbs += m.carbs;
        return acc;
      },
      { calories: 0, protein: 0, fat: 0, carbs: 0 }
    );
  }, [rows]);

  const save = async () => {
    const items = rows
      .filter((r) => r.food_name.trim())
      .map((r) => {
        const m = rowMacros(r);
        return {
          food_name: r.food_name.trim(),
          // 做法一起传给服务端，它会用同一张油糖表重算，保证和界面数字一致
          cooking_method: r.cooking ?? undefined,
          estimated_weight_g: num(r.estimated_weight_g),
          calories: m.calories,
          protein: m.protein,
          fat: m.fat,
          carbs: m.carbs,
          confidence: r.confidence ?? undefined,
        };
      });
    if (!items.length) return showToast('error', '先添加至少一项食物');
    if (items.some((it) => !(it.estimated_weight_g > 0))) {
      return showToast('error', '每项食物都要填大于 0 的克重');
    }

    setSaving(true);
    try {
      const res = await api.saveDiet({
        record_date: today,
        meal_type: mealType,
        source: analysis ? 'ai_image' : 'manual',
        image_path: analysis?.image_path,
        note: analysis?.note,
        ai_raw_response: analysis
          ? { meta: analysis.meta, reasoning: analysis.reasoning, items: analysis.items }
          : undefined,
        items,
      });
      const rec = res.data.record;
      showToast('ok', `已记入${MEAL_LABEL[mealType]}：${fmt(rec.total_calories)} kcal`);
      setImage(null);
      setAnalysis(null);
      setRows([]);
      setManualMode(false);
      todayRecords.reload();
    } catch (err) {
      showToast('error', err.message);
    } finally {
      setSaving(false);
    }
  };

  const removeRecord = async (id) => {
    if (deletingId !== id) {
      setDeletingId(id);
      showToast('ok', '再点一次「确认删除」');
      return;
    }
    try {
      await api.deleteDiet(id);
      setDeletingId(null);
      showToast('ok', '已删除该餐记录');
      todayRecords.reload();
    } catch (err) {
      showToast('error', err.message);
    }
  };

  const records = todayRecords.data?.records ?? [];
  const summary = todayRecords.data?.summary ?? { calories: 0, protein: 0, fat: 0, carbs: 0, count: 0 };

  return (
    <div className="space-y-4">
      <header className="flex items-end justify-between">
        <div>
          <p className="text-xs text-slate-400">{longDate(today)}</p>
          <h1 className="mt-0.5 text-xl font-semibold tracking-tight">饮食记录</h1>
        </div>
        <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
          今日 {fmt(summary.calories)} kcal
        </span>
      </header>

      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <CardTitle
            extra={
              fakeMode ? (
                <span className="text-amber-600">演示模式</span>
              ) : visionReady ? (
                visionModel
              ) : null
            }
          >
            拍照识别
          </CardTitle>
        </div>

        {!visionReady && !fakeMode ? (
          <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-700">
            这台服务器的 AI 还没配置好（需要管理员填 <code className="rounded bg-white/70 px-1">AI_VISION_MODEL</code> 与{' '}
            <code className="rounded bg-white/70 px-1">AI_VISION_API_KEY</code>，先试{' '}
            <code className="rounded bg-white/70 px-1">glm-4v-flash</code>）。配好后所有账号都能拍照识别。
          </p>
        ) : null}

        <div className="flex gap-2">
          {(mealTypes.data?.meal_types ?? Object.keys(MEAL_LABEL).map((v) => ({ value: v, label: MEAL_LABEL[v] }))).map(
            (m) => (
              <button
                key={m.value}
                type="button"
                onClick={() => setMealType(m.value)}
                className={`flex-1 rounded-xl py-1.5 text-xs font-medium transition ${
                  mealType === m.value
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                }`}
              >
                {m.label}
              </button>
            )
          )}
        </div>

        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handlePick}
        />
        <input ref={albumRef} type="file" accept="image/*" className="hidden" onChange={handlePick} />

        {image ? (
          <div className="relative mt-3 overflow-hidden rounded-2xl">
            <img src={image.dataUrl} alt="刚拍的餐食" className="h-44 w-full object-cover" />
            {busy ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white/75 backdrop-blur-sm">
                <span className="h-6 w-6 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
                <span className="text-xs font-medium text-slate-600">AI 正在看你的餐盘…</span>
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => {
                setImage(null);
                setAnalysis(null);
                setRows([]);
              }}
              className="absolute right-2 top-2 rounded-full bg-black/50 px-2.5 py-1 text-[11px] text-white"
            >
              重拍
            </button>
          </div>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => cameraRef.current?.click()}
              disabled={busy}
              className="flex flex-col items-center gap-1 rounded-2xl border border-dashed border-slate-300 py-5 text-slate-500 transition hover:border-emerald-400 hover:text-emerald-600"
            >
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />
                <circle cx="12" cy="13" r="3.2" />
              </svg>
              <span className="text-xs font-medium">拍一张</span>
            </button>
            <button
              type="button"
              onClick={() => albumRef.current?.click()}
              disabled={busy}
              className="flex flex-col items-center gap-1 rounded-2xl border border-dashed border-slate-300 py-5 text-slate-500 transition hover:border-emerald-400 hover:text-emerald-600"
            >
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <circle cx="9" cy="10" r="1.6" />
                <path d="m5 17 4.5-4.5L13 16l2.5-2.5L21 19" />
              </svg>
              <span className="text-xs font-medium">从相册选</span>
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={() => {
            setManualMode(true);
            setImage(null);
            setAnalysis(null);
            setRows([emptyRow(100)]);
          }}
          className="mt-2 w-full rounded-xl border border-slate-200 py-2 text-xs font-medium text-slate-500"
        >
          不拍照，手动添加一餐
        </button>
      </Card>

      {rows.length ? (
        <Card className="p-4">
          <CardTitle extra={analysis?.meta?.mode === 'fake' ? '演示数据' : analysis ? 'AI 估算' : '手动录入'}>
            {analysis ? '识别结果（克重可改）' : '这一餐吃了什么'}
          </CardTitle>

          <div className="space-y-2">
            {rows.map((row, i) => {
              const m = rowMacros(row);
              const method = COOKING_LABEL(row.cooking);
              return (
                <div key={i} className="rounded-xl border border-slate-100 bg-slate-50/60 p-2.5">
                  <div className="flex items-center gap-2">
                    <input
                      value={row.food_name}
                      onChange={(e) => updateRow(i, { food_name: e.target.value, p100: null, source: null })}
                      onBlur={() => lookupRow(i)}
                      placeholder="食物名称，如 米饭"
                      className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-emerald-400"
                    />
                    <div className="flex items-center gap-1">
                      <input
                        value={row.estimated_weight_g}
                        onChange={(e) => updateRow(i, { estimated_weight_g: e.target.value })}
                        inputMode="decimal"
                        placeholder="0"
                        className="tabular w-14 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-right text-sm outline-none focus:border-emerald-400"
                      />
                      <span className="text-[11px] text-slate-400">g</span>
                    </div>
                    <span className="tabular w-14 text-right text-sm font-medium text-slate-700">
                      {fmt(m.calories)}
                    </span>
                    <button
                      type="button"
                      onClick={() => setRows((prev) => prev.filter((_, idx) => idx !== i))}
                      className="rounded-lg px-1 text-slate-300 transition hover:text-rose-500"
                      aria-label="删除这一项"
                    >
                      ✕
                    </button>
                  </div>

                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
                    {method ? (
                      <span
                        className={
                          COOKING_PROFILES[row.cooking]?.oil_g
                            ? 'rounded-md bg-amber-50 px-1.5 py-0.5 font-medium text-amber-700'
                            : 'rounded-md bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-700'
                        }
                        title={row.cookingNote ?? ''}
                      >
                        {row.cooking}
                        {COOKING_PROFILES[row.cooking]?.oil_g
                          ? ` +${COOKING_PROFILES[row.cooking].oil_g}g油/100g`
                          : ''}
                      </span>
                    ) : null}
                    <span className="tabular text-slate-500">
                      蛋 {m.protein.toFixed(1)} · 脂 {m.fat.toFixed(1)} · 碳 {m.carbs.toFixed(1)}
                    </span>
                    {row.confidence != null ? (
                      <span className="ml-auto">把握 {Math.round(row.confidence * 100)}%</span>
                    ) : null}
                  </div>

                  {row.p100 ? (
                    <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                      {row.source === 'ai'
                        ? '营养库未命中，按 AI 给的值换到你填的克重'
                        : row.cookingNote || `营养库：${row.p100.calories} kcal/100g`}
                    </p>
                  ) : (
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-400">
                      <span>营养库没有这道菜，直接填热量：</span>
                      <input
                        value={row.manualKcal}
                        onChange={(e) => updateRow(i, { manualKcal: e.target.value })}
                        inputMode="decimal"
                        placeholder="kcal"
                        className="tabular w-16 rounded-lg border border-slate-200 bg-white px-2 py-1 text-right text-[11px] outline-none focus:border-emerald-400"
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => setRows((prev) => [...prev, emptyRow(100)])}
            className="mt-2 w-full rounded-xl border border-dashed border-slate-300 py-2 text-xs font-medium text-slate-500"
          >
            + 再加一项
          </button>

          {analysis?.reasoning?.length ? (
            <details className="mt-2 rounded-xl bg-slate-50 p-2.5">
              <summary className="cursor-pointer text-[11px] font-medium text-slate-600">
                AI 的判断依据（识别 → 估重 → 烹饪修正）
              </summary>
              <ol className="mt-1.5 space-y-1 text-[11px] leading-relaxed text-slate-500">
                {analysis.reasoning.map((line, idx) => (
                  <li key={idx}>{line}</li>
                ))}
              </ol>
            </details>
          ) : null}

          {analysis?.note ? (
            <p className="mt-2 rounded-xl bg-slate-50 p-2.5 text-[11px] leading-relaxed text-slate-500">
              {analysis.note}
            </p>
          ) : null}

          <div className="mt-3 flex items-center justify-between rounded-xl bg-slate-900 px-3 py-2.5 text-white">
            <div>
              <p className="text-[11px] text-slate-300">合计</p>
              <p className="text-lg font-semibold leading-tight">{fmt(totals.calories)} kcal</p>
            </div>
            <div className="text-right text-[11px] leading-relaxed text-slate-300">
              <p>蛋白 {totals.protein.toFixed(1)} g</p>
              <p>脂肪 {totals.fat.toFixed(1)} g</p>
              <p>碳水 {totals.carbs.toFixed(1)} g</p>
            </div>
          </div>

          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="mt-2 w-full rounded-xl bg-emerald-600 py-3 text-sm font-medium text-white transition active:scale-[0.99] disabled:opacity-60"
          >
            {saving ? '保存中…' : `保存到${MEAL_LABEL[mealType]}`}
          </button>
          {manualMode ? (
            <button
              type="button"
              onClick={() => {
                setRows([]);
                setManualMode(false);
              }}
              className="mt-1.5 w-full py-1 text-[11px] text-slate-400"
            >
              取消
            </button>
          ) : null}
        </Card>
      ) : null}

      <Card className="p-4">
        <CardTitle
          extra={
            summary.count
              ? `蛋白 ${summary.protein} · 脂肪 ${summary.fat} · 碳水 ${summary.carbs}`
              : null
          }
        >
          今日已记录
        </CardTitle>

        {todayRecords.loading && !records.length ? (
          <p className="py-6 text-center text-xs text-slate-400">加载中…</p>
        ) : records.length ? (
          <ul className="space-y-2">
            {records.map((rec) => (
              <li key={rec.id} className="flex gap-2.5 rounded-xl border border-slate-100 p-2">
                {rec.image_path ? (
                  <img
                    src={rec.image_path}
                    alt=""
                    className="h-14 w-14 shrink-0 rounded-lg object-cover"
                  />
                ) : (
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-[10px] text-slate-400">
                    手动
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-xs font-medium text-slate-700">
                      {MEAL_LABEL[rec.meal_type] || rec.meal_type}
                      <span className="ml-1 font-normal text-slate-400">
                        {rec.items.length} 项
                      </span>
                    </p>
                    <p className="tabular text-sm font-semibold text-slate-800">
                      {fmt(rec.total_calories)}
                      <span className="ml-0.5 text-[10px] font-normal text-slate-400">kcal</span>
                    </p>
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-slate-400">
                    {rec.items.map((it) => `${it.food_name} ${it.estimated_weight_g}g`).join('、')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => removeRecord(rec.id)}
                  className={`self-center rounded-lg px-1.5 text-[11px] ${
                    deletingId === rec.id ? 'text-rose-600' : 'text-slate-300 hover:text-rose-500'
                  }`}
                >
                  {deletingId === rec.id ? '确认删除' : '删除'}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex flex-col items-center gap-1 py-6 text-center">
            <svg viewBox="0 0 24 24" className="h-9 w-9 text-slate-200" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 11a8 8 0 0 1 16 0" />
              <path d="M3 11h18" />
              <path d="M6 15.5h12a2 2 0 0 1 0 4H6a2 2 0 0 1 0-4Z" />
            </svg>
            <p className="text-xs text-slate-400">今天还没有饮食记录</p>
          </div>
        )}
      </Card>

      <Toast toast={toast} />
    </div>
  );
}
