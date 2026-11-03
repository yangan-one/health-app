import { useEffect, useRef, useState } from 'react';
import Card, { CardTitle } from '../components/Card.jsx';
import { NumberField } from '../components/Field.jsx';
import Toast from '../components/Toast.jsx';
import { useFetch } from '../hooks/useFetch.js';
import { api } from '../api/client.js';
import { fmt } from '../lib/format.js';

const GENDERS = [
  { value: 'male', label: '男' },
  { value: 'female', label: '女' },
  { value: 'other', label: '保密' },
];

const GOALS = [
  { value: 'lose_fat', label: '减脂', desc: 'TDEE −400 kcal' },
  { value: 'maintain', label: '保持健康', desc: '与消耗持平' },
  { value: 'gain_muscle', label: '增肌', desc: 'TDEE +300 kcal' },
];

function ageOf(birth) {
  if (!birth) return null;
  const b = new Date(`${birth}T00:00:00`);
  if (Number.isNaN(b.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

export default function Profile() {
  const profile = useFetch(() => api.profile());
  const settings = useFetch(() => api.settings());
  const summary = useFetch(() => api.exportSummary());
  const authInfo = useFetch(() => api.authStatus());

  /** 档案表单 */
  const [basic, setBasic] = useState({ nickname: '', gender: 'male', birth_date: '', height_cm: '' });
  /** 目标表单 */
  const [goalType, setGoalType] = useState('maintain');
  const [goalCalories, setGoalCalories] = useState('');
  /** AI 状态（只读：Key 全部在 server/.env 里配，不在界面上填） */
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  /** 从备份导入：先选文件、解析出摘要，再等用户确认 */
  const [pending, setPending] = useState(null);
  const fileRef = useRef(null);

  const p = profile.data;
  const ai = settings.data?.ai;

  const filled = useRef(false);
  useEffect(() => {
    if (!p || filled.current) return;
    setBasic({
      nickname: p.nickname ?? '',
      gender: p.gender ?? 'male',
      birth_date: p.birth_date ?? '',
      height_cm: p.height_cm == null ? '' : String(p.height_cm),
    });
    setGoalType(p.goal_type ?? 'maintain');
    setGoalCalories(p.daily_calorie_goal == null ? '' : String(p.daily_calorie_goal));
    filled.current = true;
  }, [p]);

  useEffect(() => {
    if (!msg) return undefined;
    const timer = setTimeout(() => setMsg(null), msg.type === 'ok' ? 2200 : 3600);
    return () => clearTimeout(timer);
  }, [msg]);

  // 本地实时算 BMR，让用户改身高/生日立刻看到变化
  const age = ageOf(basic.birth_date);
  const weightKg = p?.latest_weight_kg ?? null;
  const heightCm = Number(basic.height_cm) || 0;
  const liveBmr =
    weightKg > 0 && heightCm > 0 && age != null
      ? Math.round(
          (basic.gender === 'female'
            ? 10 * weightKg + 6.25 * heightCm - 5 * age - 161
            : 10 * weightKg + 6.25 * heightCm - 5 * age + 5)
        )
      : null;
  const bmr = liveBmr ?? p?.bmr ?? null;
  const ACTIVITY_FACTOR = {
    sedentary: 1.2,
    light: 1.375,
    moderate: 1.55,
    active: 1.725,
    very_active: 1.9,
  };
  const tdee = bmr
    ? Math.round(bmr * (ACTIVITY_FACTOR[p?.activity_level] ?? 1.375))
    : null;

  async function onPickBackup(event) {
    const file = event.target.files?.[0];
    event.target.value = ''; // 允许连续选同一个文件
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      if (payload?.app && payload.app !== 'health-app') {
        throw new Error('这不是本应用导出的文件');
      }
      setPending({
        name: file.name,
        payload,
        body: (payload.body_metrics || []).length,
        exercise: (payload.exercise_records || []).length,
        diet: (payload.diet_records || []).length,
      });
    } catch (e) {
      setMsg({ type: 'error', text: `读取失败：${e.message}` });
    }
  }

  async function doImport() {
    if (!pending || busy) return;
    setBusy(true);
    try {
      const res = await api.importData(pending.payload, false);
      const d = res.data || {};
      setMsg({
        type: 'ok',
        text: `已导入：身体 ${d.body} 条、运动 ${d.exercise} 条` +
          (d.exercise_skipped ? `（跳过重复 ${d.exercise_skipped} 条）` : '') +
          `、饮食 ${d.diet} 餐`,
      });
      setPending(null);
      summary.reload();
      profile.reload();
    } catch (e) {
      setMsg({ type: 'error', text: e.message });
    } finally {
      setBusy(false);
    }
  }

  async function saveBasic(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await api.saveProfile({
        nickname: basic.nickname || null,
        gender: basic.gender,
        birth_date: basic.birth_date || null,
        height_cm: basic.height_cm === '' ? undefined : Number(basic.height_cm),
      });
      profile.reload();
      setMsg({ type: 'ok', text: '基础档案已保存' });
    } catch (e) {
      setMsg({ type: 'error', text: e.message });
    } finally {
      setBusy(false);
    }
  }

  async function saveGoal(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await api.saveProfile({
        goal_type: goalType,
        daily_calorie_goal: goalCalories === '' ? undefined : Number(goalCalories),
      });
      profile.reload();
      setMsg({ type: 'ok', text: '目标已保存，概览页立即生效' });
    } catch (e) {
      setMsg({ type: 'error', text: e.message });
    } finally {
      setBusy(false);
    }
  }

  async function testAi() {
    setTesting(true);
    setTestResult(null);
    try {
      // 不再传 Key：后端读服务器自己的 .env，前端只负责看结果
      const res = await api.testAi();
      setTestResult(res.data);
    } catch (e) {
      setTestResult({ ok: false, message: e.message });
    } finally {
      setTesting(false);
    }
  }

  if (profile.loading && !p) {
    return (
      <div className="animate-pulse space-y-3">
        <div className="h-8 w-28 rounded-lg bg-slate-200" />
        <div className="h-64 rounded-2xl bg-slate-200" />
        <div className="h-40 rounded-2xl bg-slate-200" />
      </div>
    );
  }

  return (
    <div className="space-y-3.5">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">我的</h1>
        <p className="mt-0.5 text-xs text-slate-500">
          基础档案决定 BMR 与建议热量，目标热量会覆盖概览页的每日预算
        </p>
      </header>

      {profile.error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-600">
          {profile.error}
        </div>
      ) : null}

      {/* 1. 个人基础档案 */}
      <Card className="p-4">
        <CardTitle
          extra={
            p?.bmi ? <span className="text-slate-400">BMI {fmt(p.bmi, 1)}</span> : null
          }
        >
          个人基础档案
        </CardTitle>

        <form onSubmit={saveBasic} className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs text-slate-500">昵称</span>
            <input
              type="text"
              value={basic.nickname}
              onChange={(e) => setBasic({ ...basic, nickname: e.target.value })}
              placeholder="怎么称呼你"
              className="w-full rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2.5 text-[15px] text-slate-900 outline-none transition placeholder:text-slate-300 focus:border-emerald-400 focus:bg-white focus:ring-2 focus:ring-emerald-100"
            />
          </label>

          <div>
            <span className="mb-1 block text-xs text-slate-500">性别</span>
            <div className="grid grid-cols-3 gap-1.5">
              {GENDERS.map((g) => (
                <button
                  key={g.value}
                  type="button"
                  onClick={() => setBasic({ ...basic, gender: g.value })}
                  className={`rounded-xl border py-2 text-xs transition ${
                    basic.gender === g.value
                      ? 'border-emerald-500 bg-emerald-50 font-medium text-emerald-700'
                      : 'border-slate-200 text-slate-600'
                  }`}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <label className="block">
              <span className="mb-1 block text-xs text-slate-500">
                出生日期
                {age != null ? <span className="ml-1 text-slate-400">（{age} 岁）</span> : null}
              </span>
              <input
                type="date"
                value={basic.birth_date}
                onChange={(e) => setBasic({ ...basic, birth_date: e.target.value })}
                className="w-full rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2.5 text-[15px] text-slate-900 tabular outline-none transition focus:border-emerald-400 focus:bg-white focus:ring-2 focus:ring-emerald-100"
              />
            </label>
            <NumberField
              label="身高"
              unit="cm"
              placeholder="请输入 cm"
              value={basic.height_cm}
              onChange={(v) => setBasic({ ...basic, height_cm: v })}
              min={50}
              step="0.5"
            />
          </div>

          {/* BMR：自动计算 */}
          <div className="rounded-xl bg-slate-50 px-3 py-3">
            <div className="flex items-end justify-between">
              <div>
                <p className="text-[11px] text-slate-500">基础代谢率 BMR</p>
                <p className="mt-0.5 text-2xl font-semibold tabular">
                  {bmr ? fmt(bmr, 0) : '--'}
                  <span className="ml-1 text-xs font-normal text-slate-400">kcal / 天</span>
                </p>
              </div>
              {tdee ? (
                <div className="text-right">
                  <p className="text-[11px] text-slate-500">日常总消耗 TDEE</p>
                  <p className="text-sm font-medium text-slate-700 tabular">{fmt(tdee, 0)} kcal</p>
                </div>
              ) : null}
            </div>
            <p className="mt-2 border-t border-slate-200/70 pt-2 text-[10px] text-slate-400">
              {bmr
                ? `${p?.bmr_formula ?? 'Mifflin-St Jeor'}；体重取最近体测 ${fmt(weightKg, 1)} kg`
                : '填写出生日期与身高后自动计算（体重取最近一次体测）'}
            </p>
          </div>

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl bg-emerald-600 py-2.5 text-sm font-medium text-white transition active:bg-emerald-700 disabled:opacity-60"
          >
            保存档案
          </button>
        </form>
      </Card>

      {/* 2. 目标与偏好 */}
      <Card className="p-4">
        <CardTitle
          extra={
            p?.suggested_calorie_goal ? (
              <span className="text-slate-400">建议 {fmt(p.suggested_calorie_goal, 0)}</span>
            ) : null
          }
        >
          目标与偏好
        </CardTitle>

        <form onSubmit={saveGoal} className="space-y-3">
          <div>
            <span className="mb-1 block text-xs text-slate-500">我的目标</span>
            <div className="grid grid-cols-3 gap-1.5">
              {GOALS.map((g) => (
                <button
                  key={g.value}
                  type="button"
                  onClick={() => setGoalType(g.value)}
                  className={`rounded-xl border px-1 py-2 transition ${
                    goalType === g.value
                      ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                      : 'border-slate-200 text-slate-600'
                  }`}
                >
                  <span className="block text-xs font-medium">{g.label}</span>
                  <span
                    className={`mt-0.5 block text-[10px] ${
                      goalType === g.value ? 'text-emerald-600' : 'text-slate-400'
                    }`}
                  >
                    {g.desc}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <NumberField
              label="每日热量目标"
              unit="kcal"
              placeholder="请输入 kcal"
              value={goalCalories}
              onChange={setGoalCalories}
              min={800}
              step="10"
            />
            <div className="mt-1.5 flex items-center justify-between">
              <p className="text-[11px] text-slate-400">
                概览页的每日预算 = 这个值 + 当日运动消耗
              </p>
              {p?.suggested_calorie_goal ? (
                <button
                  type="button"
                  onClick={() => setGoalCalories(String(p.suggested_calorie_goal))}
                  className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] text-slate-600 active:bg-slate-200"
                >
                  采用建议 {fmt(p.suggested_calorie_goal, 0)}
                </button>
              ) : null}
            </div>
          </div>

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl bg-emerald-600 py-2.5 text-sm font-medium text-white transition active:bg-emerald-700 disabled:opacity-60"
          >
            保存目标
          </button>
        </form>
      </Card>

      {/* 3. 数据导出 */}
      <Card className="p-4">
        <CardTitle extra={summary.data ? `共 ${summary.data.body_metrics + summary.data.exercise_records + summary.data.diet_records} 条记录` : null}>
          数据导出
        </CardTitle>

        <p className="mb-2.5 text-[11px] text-slate-400">
          导出的文件会直接下载到本地，JSON 含全部明细，CSV 可直接用 Excel 打开
        </p>

        <a
          href={api.exportUrl('json')}
          className="block w-full rounded-xl bg-slate-900 py-2.5 text-center text-sm font-medium text-white active:bg-slate-800"
        >
          导出全部数据（JSON）
        </a>

        <div className="mt-2 grid grid-cols-3 gap-1.5">
          {[
            { table: 'body', label: '身体数据' },
            { table: 'exercise', label: '运动记录' },
            { table: 'diet', label: '饮食记录' },
          ].map((t) => (
            <a
              key={t.table}
              href={api.exportUrl('csv', t.table)}
              className="rounded-xl border border-slate-200 py-2 text-center text-xs text-slate-600 active:bg-slate-50"
            >
              {t.label} CSV
            </a>
          ))}
        </div>

        {summary.data ? (
          <div className="mt-2.5 flex flex-wrap gap-1.5 text-[11px] text-slate-500">
            <span className="rounded-lg bg-slate-50 px-2 py-1">
              身体 {summary.data.body_metrics} 条
            </span>
            <span className="rounded-lg bg-slate-50 px-2 py-1">
              运动 {summary.data.exercise_records} 条
            </span>
            <span className="rounded-lg bg-slate-50 px-2 py-1">
              饮食 {summary.data.diet_records} 条
            </span>
          </div>
        ) : null}

        <div className="mt-3 border-t border-slate-100 pt-3">
          <p className="mb-2 text-[11px] text-slate-400">
            换手机或部署到云端后，用导出的 JSON 把历史数据搬过去：同一天的体测会按日期覆盖，完全相同的运动和饮食记录会跳过
          </p>
          {pending ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-2.5">
              <p className="text-[11px] text-emerald-800">
                {pending.name} · 身体 {pending.body} 条 · 运动 {pending.exercise} 条 · 饮食 {pending.diet} 餐
              </p>
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={doImport}
                  disabled={busy}
                  className="rounded-lg bg-emerald-600 py-2 text-xs font-medium text-white active:bg-emerald-700 disabled:opacity-60"
                >
                  {busy ? '导入中…' : '确认导入'}
                </button>
                <button
                  type="button"
                  onClick={() => setPending(null)}
                  disabled={busy}
                  className="rounded-lg border border-slate-200 bg-white py-2 text-xs text-slate-600 active:bg-slate-50"
                >
                  取消
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="w-full rounded-xl border border-slate-200 py-2.5 text-sm text-slate-600 active:bg-slate-50"
            >
              从备份导入（JSON）
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            onChange={onPickBackup}
            className="hidden"
          />
        </div>
      </Card>

      {/* 4. AI 服务状态（只读：Key 一律在 server/.env 里配） */}
      <Card className="p-4">
        <CardTitle
          extra={
            ai?.vision?.fake ? (
              <span className="text-amber-600">演示模式</span>
            ) : ai?.configured ? (
              <span className="text-emerald-600">已配置</span>
            ) : (
              <span className="text-slate-400">未配置</span>
            )
          }
        >
          AI 服务状态
        </CardTitle>

        <div className="space-y-1.5 text-xs">
          {[
            ['文本模型', ai?.model || '—'],
            ['视觉模型', ai?.vision?.model || '未配置'],
            ['接口地址', ai?.vision?.base_url || ai?.base_url || '—'],
            ['拍照识别', ai?.vision?.fake ? '演示模式（不调用模型）' : ai?.vision?.configured ? '可用' : '不可用'],
            ['允许的接口', (ai?.allowed_hosts ?? []).join('、') || '—'],
            ['每日 AI 上限', `${ai?.daily_ai_limit ?? '—'} 次（全站合计）`],
          ].map(([label, value]) => (
            <div key={label} className="flex items-baseline justify-between gap-3">
              <span className="shrink-0 text-slate-400">{label}</span>
              <span className="min-w-0 truncate text-right font-medium text-slate-700">{value}</span>
            </div>
          ))}
          <div className="flex items-baseline justify-between gap-3">
            <span className="shrink-0 text-slate-400">Key 来源</span>
            <span className="text-right font-medium text-slate-700">
              {
                {
                  env: '环境变量 AI_API_KEY',
                  'env:vision': '环境变量 AI_VISION_API_KEY',
                  vision: '复用视觉 Key（环境变量）',
                  db: '本地数据库',
                  'db:vision': '本地数据库（视觉）',
                }[ai?.vision?.key_source ?? ai?.key_source] ?? '未配置'
              }
            </span>
          </div>
        </div>

        {ai?.vision?.env_key_invalid || ai?.env_key_invalid ? (
          <p className="mt-2 rounded-xl bg-amber-50 p-2.5 text-[10px] leading-relaxed text-amber-700">
            ⚠ 环境变量里的 Key 不可用（但这行不影响使用，只要数据库里存了有效 Key）：
            {ai?.vision?.env_key_invalid ?? ai?.env_key_invalid}
          </p>
        ) : null}

        <p className="mt-2.5 rounded-xl bg-slate-50 p-2.5 text-[10px] leading-relaxed text-slate-500">
          Key 在服务器的 <code className="rounded bg-white px-1">.env</code> 或云平台的「环境变量」里配：
          拍照识别填 <code className="rounded bg-white px-1">AI_VISION_MODEL</code> 与{' '}
          <code className="rounded bg-white px-1">AI_VISION_API_KEY</code>
          （只允许英文字母、数字和符号，不要粘中文说明）。改完要重启后端 / 重启云上应用才生效，
          前端不用填任何东西。
        </p>

        <button
          type="button"
          onClick={testAi}
          disabled={testing}
          className="mt-2 w-full rounded-xl border border-slate-200 py-2.5 text-sm text-slate-700 transition active:bg-slate-50 disabled:opacity-60"
        >
          {testing ? '检测中…' : '检测连接'}
        </button>

        {testResult ? (
          <div className="mt-2 space-y-1.5">
            {[
              ['文本模型', testResult.text],
              ['视觉模型', testResult.vision],
            ]
              .filter(([, r]) => r)
              .map(([label, r]) => (
                <div
                  key={label}
                  className={`rounded-xl px-3 py-2 text-[11px] ${
                    r.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600'
                  }`}
                >
                  <p className="font-medium">
                    {label} · {r.ok ? '可用' : '不可用'}
                    {r.latency_ms != null ? <span className="ml-1 opacity-70">{r.latency_ms} ms</span> : null}
                  </p>
                  <p className="mt-0.5 break-words opacity-90">{r.message}</p>
                </div>
              ))}
            {testResult.ok ? null : (
              <p className="px-1 text-[10px] leading-relaxed text-slate-400">
                拍照识别只用视觉模型，文本模型（AI_API_KEY）留给第五步的 AI 问答，暂时没配也不影响拍照。
              </p>
            )}
          </div>
        ) : null}
      </Card>


      <p className="pb-1 text-center text-[11px] text-slate-400">
        单用户本地版 · 数据存在服务器的 server/data/health.db
      </p>
      {authInfo.data?.required ? (
        <div className="pb-2 text-center">
          <button
            type="button"
            onClick={async () => {
              try {
                await api.logout();
              } catch {
                /* 忽略：直接刷新也会回到登录页 */
              }
              window.location.reload();
            }}
            className="rounded-full px-3 py-1.5 text-[11px] text-slate-400 underline decoration-slate-300 underline-offset-2"
          >
            退出登录
          </button>
        </div>
      ) : (
        <div className="pb-2" />
      )}

      <Toast toast={msg ? { tone: msg.type === 'ok' ? 'ok' : 'error', text: msg.text } : null} />
    </div>
  );
}
