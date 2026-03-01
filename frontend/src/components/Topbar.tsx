import { useState, useRef, useEffect } from 'react';
import { Menu, KeyRound, LogOut } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import api from '../utils/api';
import toast from 'react-hot-toast';
import Modal from './Modal';

interface TopbarProps { onMenuToggle: () => void; }

function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [saving, setSaving] = useState(false);
  const [show, setShow] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (form.newPassword !== form.confirm) { toast.error('Passwords do not match'); return; }
    if (form.newPassword.length < 4) { toast.error('Password must be at least 4 characters'); return; }
    setSaving(true);
    try {
      await api.patch('/auth/me/password', { currentPassword: form.currentPassword, newPassword: form.newPassword });
      toast.success('Password changed successfully');
      onClose();
    } catch (err: any) {
      toast.error(err.response?.data?.error ?? 'Failed to change password');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open title="Change Password" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Current Password</label>
          <input className="form-input" type={show ? 'text' : 'password'} value={form.currentPassword}
            onChange={e => setForm(f => ({ ...f, currentPassword: e.target.value }))} required />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
          <div className="relative">
            <input className="form-input pr-16" type={show ? 'text' : 'password'} value={form.newPassword}
              onChange={e => setForm(f => ({ ...f, newPassword: e.target.value }))} required minLength={4} />
            <button type="button" onClick={() => setShow(s => !s)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-700">
              {show ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Confirm New Password</label>
          <input className="form-input" type={show ? 'text' : 'password'} value={form.confirm}
            onChange={e => setForm(f => ({ ...f, confirm: e.target.value }))} required />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Change Password'}</button>
        </div>
      </form>
    </Modal>
  );
}

export default function Topbar({ onMenuToggle }: TopbarProps) {
  const { user, logout } = useAuth();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [showChangePw, setShowChangePw] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node))
        setDropdownOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const roleBg: Record<string, string> = {
    management:   'bg-purple-100 text-purple-700',
    sales:        'bg-blue-100 text-blue-700',
    production:   'bg-emerald-100 text-emerald-700',
    installation: 'bg-amber-100 text-amber-700',
  };

  return (
    <>
    <header className="h-14 bg-white/80 backdrop-blur border-b border-gray-100 flex items-center justify-between px-4 shrink-0">
      {/* Hamburger — mobile only */}
      <button
        onClick={onMenuToggle}
        className="lg:hidden p-2 -ml-1 rounded-xl text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors active:scale-95"
        aria-label="Open menu"
      >
        <Menu size={20} />
      </button>

      {/* Date — hidden on small mobile */}
      <div className="hidden sm:block text-xs font-medium text-gray-400">
        {new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })}
      </div>

      {/* Spacer on mobile */}
      <div className="flex-1 lg:hidden" />

      {/* Right side */}
      <div className="flex items-center gap-2">
        <span className={`text-[11px] font-semibold capitalize px-2.5 py-1 rounded-full ${ roleBg[user?.role || ''] || 'bg-gray-100 text-gray-600' }`}>
          {user?.role}
        </span>
        {/* User avatar + dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setDropdownOpen(v => !v)}
            className="hidden sm:flex items-center gap-2 pl-2 border-l border-gray-100 hover:opacity-80 transition-opacity"
          >
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-[11px] font-bold text-white">
              {user?.name.charAt(0).toUpperCase()}
            </div>
            <span className="text-sm font-medium text-gray-700 hidden md:block">{user?.name}</span>
          </button>
          {dropdownOpen && (
            <div className="absolute right-0 top-full mt-2 w-48 bg-white border border-gray-200 rounded-xl shadow-lg z-50 py-1 overflow-hidden">
              <div className="px-3 py-2 border-b border-gray-100">
                <div className="text-sm font-semibold text-gray-800 truncate">{user?.name}</div>
                <div className="text-xs text-gray-400 capitalize">{user?.role}</div>
              </div>
              <button
                onClick={() => { setDropdownOpen(false); setShowChangePw(true); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors">
                <KeyRound size={14} className="text-gray-400" /> Change Password
              </button>
              <button
                onClick={() => { setDropdownOpen(false); logout(); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors">
                <LogOut size={14} /> Sign Out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
    {showChangePw && <ChangePasswordModal onClose={() => setShowChangePw(false)} />}
    </>
  );
}
