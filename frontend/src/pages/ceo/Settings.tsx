import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../utils/api';
import Modal from '../../components/Modal';
import { useAuth } from '../../contexts/AuthContext';

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  active: number;
  rfid_tag?: string | null;
  employee_id?: string | null;
}

const ROLES = ['management', 'sales', 'production', 'installation'];
const ROLE_LABELS: Record<string, string> = { management: 'Management', sales: 'Sales', production: 'Production', installation: 'Installation' };
const ROLE_COLORS: Record<string, string> = {
  management:   'badge-purple',
  sales:        'badge-blue',
  production:   'badge-orange',
  installation: 'badge-green',
};

function RoleBadge({ role }: { role: string }) {
  return (
    <span className={`badge ${ROLE_COLORS[role] ?? 'badge-gray'}`}>
      {ROLE_LABELS[role] ?? role}
    </span>
  );
}

/* ──────────────── Add User Modal ──────────────── */
function AddUserModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ name: '', username: '', role: 'sales', password: '' });
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/auth/users', { ...form, email: form.username });
      toast.success('User created');
      onSaved();
      onClose();
    } catch (err: any) {
      toast.error(err.response?.data?.error ?? 'Failed to create user');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open title="Add New User" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
          <input className="form-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required placeholder="e.g. Arjun Sharma" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Username <span className="text-gray-400 font-normal">(used to log in)</span></label>
          <input className="form-input" value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} required placeholder="e.g. arjun or arjun.sharma" autoComplete="off" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
          <select className="form-input" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
            {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Initial Password</label>
          <input className="form-input" type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} required minLength={4} placeholder="Min 4 characters" />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Creating…' : 'Create User'}</button>
        </div>
      </form>
    </Modal>
  );
}

/* ──────────────── Edit User Modal ──────────────── */
function EditUserModal({ user, onClose, onSaved }: { user: User; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ name: user.name, username: user.email, role: user.role });
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.patch(`/auth/users/${user.id}`, { ...form, email: form.username });
      toast.success('User updated');
      onSaved();
      onClose();
    } catch (err: any) {
      toast.error(err.response?.data?.error ?? 'Failed to update user');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open title={`Edit — ${user.name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
          <input className="form-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Username <span className="text-gray-400 font-normal">(used to log in)</span></label>
          <input className="form-input" value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} required autoComplete="off" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
          <select className="form-input" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
            {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</button>
        </div>
      </form>
    </Modal>
  );
}

/* ──────────────── Reset Password Modal ──────────────── */
function ResetPasswordModal({ user, onClose }: { user: User; onClose: () => void }) {
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [show, setShow] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== confirm) { toast.error('Passwords do not match'); return; }
    if (newPassword.length < 4) { toast.error('Password must be at least 4 characters'); return; }
    setSaving(true);
    try {
      await api.patch(`/auth/users/${user.id}/reset-password`, { newPassword });
      toast.success(`Password reset for ${user.name}`);
      onClose();
    } catch (err: any) {
      toast.error(err.response?.data?.error ?? 'Failed to reset password');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open title={`Reset Password — ${user.name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-gray-500">
          Set a new password for <strong>{user.name}</strong>. They can log in immediately with this new password.
        </p>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
          <div className="relative">
            <input
              className="form-input pr-10"
              type={show ? 'text' : 'password'}
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              required
              minLength={4}
              placeholder="Min 4 characters"
            />
            <button type="button" onClick={() => setShow(s => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 text-xs">
              {show ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Confirm Password</label>
          <input
            className="form-input"
            type={show ? 'text' : 'password'}
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            required
            placeholder="Re-enter password"
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-warning" disabled={saving}>{saving ? 'Resetting…' : 'Reset Password'}</button>
        </div>
      </form>
    </Modal>
  );
}

/* ──────────────── Change Own Password Modal ──────────────── */
function ChangeOwnPasswordModal({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [saving, setSaving] = useState(false);
  const [show, setShow] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (form.newPassword !== form.confirm) { toast.error('Passwords do not match'); return; }
    setSaving(true);
    try {
      await api.patch('/auth/me/password', { currentPassword: form.currentPassword, newPassword: form.newPassword });
      toast.success('Your password has been changed');
      onClose();
    } catch (err: any) {
      toast.error(err.response?.data?.error ?? 'Failed to change password');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open title="Change Your Password" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Current Password</label>
          <input className="form-input" type={show ? 'text' : 'password'} value={form.currentPassword} onChange={e => setForm(f => ({ ...f, currentPassword: e.target.value }))} required />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
          <div className="relative">
            <input className="form-input pr-10" type={show ? 'text' : 'password'} value={form.newPassword} onChange={e => setForm(f => ({ ...f, newPassword: e.target.value }))} required minLength={4} />
            <button type="button" onClick={() => setShow(s => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 text-xs">
              {show ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Confirm New Password</label>
          <input className="form-input" type={show ? 'text' : 'password'} value={form.confirm} onChange={e => setForm(f => ({ ...f, confirm: e.target.value }))} required />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Change Password'}</button>
        </div>
      </form>
    </Modal>
  );
}

/* ──────────────── RFID Modal ──────────────── */
function RfidModal({ user, onClose, onSaved }: { user: User; onClose: () => void; onSaved: () => void }) {
  const [tag, setTag] = useState(user.rfid_tag ?? '');
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.patch(`/auth/users/${user.id}/rfid`, { rfid_tag: tag.trim().toUpperCase() || null });
      toast.success(tag.trim() ? 'RFID tag updated' : 'RFID tag cleared');
      onSaved();
      onClose();
    } catch (err: any) {
      toast.error(err.response?.data?.error ?? 'Failed to save RFID tag');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open title={`RFID Card — ${user.name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-gray-500">
          Scan or type the RFID card UID that belongs to this user. Leave blank to remove the assignment.
        </p>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">RFID Card UID</label>
          <input
            className="form-input font-mono tracking-widest uppercase"
            value={tag}
            onChange={e => setTag(e.target.value.toUpperCase())}
            placeholder="e.g. A1B2C3D4"
            maxLength={32}
            autoFocus
          />
          {user.rfid_tag && (
            <p className="mt-1 text-xs text-gray-400">Current: <span className="font-mono text-blue-600">{user.rfid_tag}</span></p>
          )}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          {user.rfid_tag && (
            <button
              type="button"
              className="btn btn-danger"
              disabled={saving}
              onClick={async () => {
                setSaving(true);
                try {
                  await api.patch(`/auth/users/${user.id}/rfid`, { rfid_tag: null });
                  toast.success('RFID tag cleared');
                  onSaved();
                  onClose();
                } catch (err: any) {
                  toast.error(err.response?.data?.error ?? 'Failed');
                } finally { setSaving(false); }
              }}
            >Clear</button>
          )}
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}

/* ──────────────── Main Settings Page ──────────────── */
export default function Settings() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInactive, setShowInactive] = useState(false);
  const [addModal, setAddModal] = useState(false);
  const [editTarget, setEditTarget] = useState<User | null>(null);
  const [resetTarget, setResetTarget] = useState<User | null>(null);
  const [changeOwnPw, setChangeOwnPw] = useState(false);
  const [confirming, setConfirming] = useState<{ id: string; action: 'deactivate' | 'reactivate'; name: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [rfidTarget, setRfidTarget] = useState<User | null>(null);

  function fetchUsers() {
    setLoading(true);
    api.get('/auth/users').then(r => setUsers(r.data)).finally(() => setLoading(false));
  }

  useEffect(() => { fetchUsers(); }, []);

  async function toggleActive(u: User) {
    const action = u.active ? 'deactivate' : 'reactivate';
    try {
      await api.patch(`/auth/users/${u.id}/${action}`);
      toast.success(`${u.name} ${action}d`);
      fetchUsers();
    } catch (err: any) {
      toast.error(err.response?.data?.error ?? 'Action failed');
    }
  }

  const filtered = showInactive ? users : users.filter(u => u.active !== 0);
  const activeCount = users.filter(u => u.active === 1).length;
  const inactiveCount = users.filter(u => u.active === 0).length;

  return (
    <div className="max-w-3xl mx-auto space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Settings</h1>
          <p className="text-sm text-gray-400 mt-0.5">Manage users and account settings</p>
        </div>
        <button className="btn btn-secondary btn-sm md:btn" onClick={() => setChangeOwnPw(true)}>
          🔑 <span className="hidden sm:inline">Change My Password</span><span className="sm:hidden">Password</span>
        </button>
      </div>

      {/* Your Profile Card */}
      <div className="card p-4 sm:p-5">
        <h2 className="text-sm font-bold text-gray-500 uppercase tracking-widest mb-4">Your Profile</h2>
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white text-xl font-bold shrink-0">
            {me?.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <div className="text-base font-semibold text-gray-900">{me?.name}</div>
            <div className="text-sm text-gray-500">{me?.email}</div>
            <div className="mt-1"><RoleBadge role={me?.role ?? ''} /></div>
          </div>
        </div>
      </div>

      {/* Users Section */}
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-gray-50">
          <div>
            <h2 className="text-sm font-bold text-gray-500 uppercase tracking-widest">User Accounts</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {activeCount} active{inactiveCount > 0 ? ` · ${inactiveCount} deactivated` : ''}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {inactiveCount > 0 && (
              <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none">
                <input type="checkbox" className="rounded" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
                <span className="hidden sm:inline">Show deactivated</span>
              </label>
            )}
            <button className="btn btn-primary btn-sm" onClick={() => setAddModal(true)}>
              + Add User
            </button>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-10 text-gray-400">Loading…</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="table-th">Name</th>
                  <th className="table-th hidden sm:table-cell">Username</th>
                  <th className="table-th">Role</th>
                  <th className="table-th hidden md:table-cell">Status</th>
                  <th className="table-th text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(u => (
                  <tr key={u.id} className={`table-tr ${u.active === 0 ? 'opacity-50' : ''}`}>
                    <td className="table-td font-medium">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-xl bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-600 shrink-0">
                          {u.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate">{u.name}
                            {u.id === me?.id && <span className="ml-1 text-xs text-blue-500 font-normal">(you)</span>}
                          </div>
                          <div className="text-xs text-gray-400 truncate sm:hidden">{u.email}</div>
                          <div className="md:hidden mt-0.5">
                            {u.active === 1
                              ? <span className="badge badge-green">Active</span>
                              : <span className="badge badge-gray">Deactivated</span>}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="table-td text-gray-500 hidden sm:table-cell font-mono text-xs">{u.email}</td>
                    <td className="table-td"><RoleBadge role={u.role} /></td>
                    <td className="table-td hidden md:table-cell">
                      {u.active === 1
                        ? <span className="badge badge-green">Active</span>
                        : <span className="badge badge-gray">Deactivated</span>}
                    </td>
                    <td className="table-td">
                      <div className="flex items-center justify-end gap-1.5 flex-wrap">
                        {u.id !== me?.id && (
                          <>
                            <button
                              className={`btn btn-sm ${u.rfid_tag ? 'btn-secondary text-blue-600' : 'btn-ghost text-gray-500'}`}
                              title={u.rfid_tag ? `RFID: ${u.rfid_tag}` : 'Assign RFID card'}
                              onClick={() => setRfidTarget(u)}
                            >
                              {u.rfid_tag
                                ? <span className="font-mono text-xs">🏷 {u.rfid_tag}</span>
                                : <span className="text-xs">+ RFID</span>}
                            </button>
                            <button className="btn-ghost btn btn-sm text-blue-600" onClick={() => setEditTarget(u)}>Edit</button>
                            <button className="btn-ghost btn btn-sm text-amber-600" onClick={() => setResetTarget(u)}>Reset PW</button>
                            <button
                              className={`btn-ghost btn btn-sm ${u.active ? 'text-orange-500' : 'text-green-600'}`}
                              onClick={() => setConfirming({ id: u.id, action: u.active ? 'deactivate' : 'reactivate', name: u.name })}
                            >{u.active ? 'Deactivate' : 'Reactivate'}</button>
                            <button className="btn btn-danger btn-sm" onClick={() => setDeleteTarget(u)}>Delete</button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modals */}
      {addModal    && <AddUserModal       onClose={() => setAddModal(false)}    onSaved={fetchUsers} />}
      {editTarget  && <EditUserModal      user={editTarget}  onClose={() => setEditTarget(null)}   onSaved={fetchUsers} />}
      {resetTarget && <ResetPasswordModal user={resetTarget} onClose={() => setResetTarget(null)} />}
      {changeOwnPw && <ChangeOwnPasswordModal onClose={() => setChangeOwnPw(false)} />}
      {rfidTarget  && <RfidModal user={rfidTarget} onClose={() => setRfidTarget(null)} onSaved={fetchUsers} />}

      {/* Confirm delete */}
      {deleteTarget && (
        <Modal open title="Delete User" onClose={() => setDeleteTarget(null)}>
          <div className="space-y-3">
            <div className="flex items-center gap-3 p-3 bg-red-50 rounded-lg border border-red-100">
              <div className="w-9 h-9 rounded-full bg-red-100 flex items-center justify-center text-red-600 font-bold text-sm shrink-0">
                {deleteTarget.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <div className="font-medium text-gray-900">{deleteTarget.name}</div>
                <div className="text-xs text-gray-500">{deleteTarget.email} · {ROLE_LABELS[deleteTarget.role]}</div>
              </div>
            </div>
            <p className="text-sm text-gray-600">
              This will <strong className="text-red-600">permanently delete</strong> this user. They will not be able to log in and cannot be recovered.
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <button className="btn btn-secondary" onClick={() => setDeleteTarget(null)}>Cancel</button>
              <button
                className="btn btn-danger"
                onClick={async () => {
                  try {
                    await api.delete(`/auth/users/${deleteTarget.id}`);
                    toast.success(`${deleteTarget.name} deleted`);
                    fetchUsers();
                  } catch (err: any) {
                    toast.error(err.response?.data?.error ?? 'Delete failed');
                  }
                  setDeleteTarget(null);
                }}
              >Delete Permanently</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Confirm deactivate/reactivate */}      {confirming && (
        <Modal open title={confirming.action === 'deactivate' ? 'Deactivate User' : 'Reactivate User'} onClose={() => setConfirming(null)}>
          <p className="text-sm text-gray-600 mb-4">
            {confirming.action === 'deactivate'
              ? <>Are you sure you want to deactivate <strong>{confirming.name}</strong>? They will no longer be able to log in.</>
              : <>Reactivate <strong>{confirming.name}</strong>? They will regain full access.</>}
          </p>
          <div className="flex justify-end gap-2">
            <button className="btn btn-secondary" onClick={() => setConfirming(null)}>Cancel</button>
            <button
              className={`btn ${confirming.action === 'deactivate' ? 'btn-danger' : 'btn-success'}`}
              onClick={async () => {
                const u = users.find(x => x.id === confirming.id);
                if (u) await toggleActive(u);
                setConfirming(null);
              }}
            >{confirming.action === 'deactivate' ? 'Deactivate' : 'Reactivate'}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
