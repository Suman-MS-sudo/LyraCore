import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Users, Building2, Package, Factory,
  ClipboardList, Settings, LogOut, X, Wrench, Hand, CalendarDays, Mail, BarChart3, Boxes
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

interface NavItem { label: string; path: string; icon: React.ReactNode; }
interface SidebarProps { isOpen: boolean; onClose: () => void; }

const SALES_NAV: NavItem[] = [
  { label: 'Dashboard',  path: '/sales',          icon: <LayoutDashboard size={16} /> },
  { label: 'Leads',      path: '/sales/leads',     icon: <Users size={16} /> },
  { label: 'Customers',  path: '/sales/customers', icon: <Building2 size={16} /> },
  { label: 'Products',   path: '/sales/products',  icon: <Package size={16} /> },
  { label: 'Say Hi',     path: '/sales/sayhi',     icon: <Hand size={16} /> },
  { label: 'Campaigns',  path: '/sales/email',     icon: <Mail size={16} /> },
  { label: 'Reports',    path: '/sales/reports',   icon: <BarChart3 size={16} /> },
  { label: 'Inventory',  path: '/inventory',       icon: <Boxes size={16} /> },
];

const PRODUCTION_NAV: NavItem[] = [
  { label: 'Dashboard',    path: '/production',               icon: <LayoutDashboard size={16} /> },
  { label: 'Orders',       path: '/production/orders',        icon: <Factory size={16} /> },
  { label: 'Installation', path: '/production/installation',  icon: <Wrench size={16} /> },
  { label: 'Inventory',    path: '/inventory',                icon: <Boxes size={16} /> },
];

const MANAGEMENT_NAV: NavItem[] = [
  { label: 'Dashboard',    path: '/management',                 icon: <LayoutDashboard size={16} /> },
  { label: 'Leads',        path: '/management/leads',           icon: <Users size={16} /> },
  { label: 'Customers',    path: '/management/customers',       icon: <Building2 size={16} /> },
  { label: 'Products',     path: '/management/products',        icon: <Package size={16} /> },
  { label: 'Say Hi',       path: '/management/sayhi',           icon: <Hand size={16} /> },
  { label: 'Orders',       path: '/management/orders',          icon: <Factory size={16} /> },
  { label: 'Installation', path: '/management/installation',    icon: <Wrench size={16} /> },
  { label: 'Campaigns',    path: '/management/email',            icon: <Mail size={16} /> },
  { label: 'Reports',      path: '/management/reports',          icon: <BarChart3 size={16} /> },
  { label: 'Attendance',        path: '/management/attendance',        icon: <CalendarDays size={16} /> },
  { label: 'Audit Logs',        path: '/management/audit',             icon: <ClipboardList size={16} /> },
  { label: 'Settings',          path: '/management/settings',          icon: <Settings size={16} /> },
  { label: 'Inv. Manager',      path: '/management/inventory-manager', icon: <Boxes size={16} /> },
  { label: 'Inv. Update',       path: '/inventory',                    icon: <Package size={16} /> },
];

const INSTALLATION_NAV: NavItem[] = [
  { label: 'Installations', path: '/installation', icon: <Wrench size={16} /> },
  { label: 'Inventory',     path: '/inventory',    icon: <Boxes size={16} /> },
];

export default function Sidebar({ isOpen, onClose }: SidebarProps) {
  const { user, logout } = useAuth();
  const navItems = user?.role === 'management' ? MANAGEMENT_NAV
    : user?.role === 'production' ? PRODUCTION_NAV
    : user?.role === 'installation' ? INSTALLATION_NAV
    : SALES_NAV;

  return (
    <aside className={`
      fixed lg:relative inset-y-0 left-0 z-30
      w-64 lg:w-56 bg-gray-950 text-white flex flex-col shrink-0
      transition-transform duration-250 ease-in-out
      ${ isOpen ? 'translate-x-0 animate-slide-in-left' : '-translate-x-full lg:translate-x-0' }
    `}>
      {/* Logo */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
        <div>
          <div className="text-lg font-bold tracking-tight">
            <span className="text-blue-400">Lyra</span><span className="text-white">Core</span>
          </div>
          <div className="text-[10px] text-gray-500 uppercase tracking-widest mt-0.5">Operations</div>
        </div>
        <button onClick={onClose} className="lg:hidden text-gray-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors">
          <X size={18} />
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/sales' || item.path === '/production' || item.path === '/management' || item.path === '/installation' || item.path === '/inventory'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                isActive
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/40'
                  : 'text-gray-400 hover:bg-white/8 hover:text-white'
              }`
            }
          >
            {item.icon}
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      {/* User info */}
      <div className="px-3 py-3 border-t border-white/10">
        <div className="flex items-center gap-3 px-2 py-2">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-xs font-bold shadow-lg flex-shrink-0">
            {user?.name.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold truncate text-white">{user?.name}</div>
            <div className="text-[10px] text-gray-500 capitalize tracking-wide">{user?.role}</div>
          </div>
          <button onClick={logout} title="Logout" className="text-gray-500 hover:text-red-400 transition-colors p-1 rounded-lg hover:bg-white/10">
            <LogOut size={15} />
          </button>
        </div>
      </div>
    </aside>
  );
}
