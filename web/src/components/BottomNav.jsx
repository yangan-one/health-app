import { NavLink } from 'react-router-dom';

const TABS = [
  {
    to: '/',
    label: '概览',
    icon: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="2" />
        <rect x="14" y="3" width="7" height="7" rx="2" />
        <rect x="3" y="14" width="7" height="7" rx="2" />
        <rect x="14" y="14" width="7" height="7" rx="2" />
      </>
    ),
  },
  {
    to: '/body',
    label: '身体',
    icon: (
      <>
        <path d="M4 4h11l5 5v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" />
        <path d="M15 4v5h5" />
        <path d="M8 13h8M8 17h5" />
      </>
    ),
  },
  {
    to: '/diet',
    label: '饮食',
    icon: (
      <>
        <path d="M4 11a8 8 0 0 1 16 0" />
        <path d="M3 11h18" />
        <path d="M6 15.5h12a2 2 0 0 1 0 4H6a2 2 0 0 1 0-4Z" />
      </>
    ),
  },
  {
    to: '/exercise',
    label: '运动',
    icon: (
      <>
        <path d="M3 12h3l2.5-6 4 12 2.5-6H21" />
      </>
    ),
  },
  {
    to: '/chat',
    label: 'AI',
    icon: (
      <>
        <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H9l-4 3.5v-3.5h-.5A1.5 1.5 0 0 1 3 14.5Z" />
        <path d="M8 9h8M8 12h5" />
      </>
    ),
  },
  {
    to: '/me',
    label: '我的',
    icon: (
      <>
        <circle cx="12" cy="8" r="3.6" />
        <path d="M4.5 20c.9-3.6 3.9-5.6 7.5-5.6s6.6 2 7.5 5.6" />
      </>
    ),
  },
];

export default function BottomNav() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200/80 bg-white/90 backdrop-blur">
      <div className="mx-auto flex w-full max-w-md items-stretch justify-around px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1.5">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.to === '/'}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center gap-0.5 rounded-xl py-1.5 text-[11px] transition ${
                isActive ? 'text-emerald-600' : 'text-slate-400'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <svg
                  viewBox="0 0 24 24"
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={isActive ? 2 : 1.6}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {tab.icon}
                </svg>
                <span className={isActive ? 'font-medium' : ''}>{tab.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
