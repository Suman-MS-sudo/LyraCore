import { useState, useEffect, useCallback } from 'react';
import {
  Users, UserPlus, Clock, CalendarDays, ChevronDown,
  CheckCircle2, XCircle, Edit2, Trash2, Wifi, WifiOff,
  BarChart3, Download, RefreshCw, Tag, PlusCircle
} from 'lucide-react';
import api from '../../utils/api';
import Modal from '../../components/Modal';
import toast from 'react-hot-toast';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Employee {
  id: string;
  employee_code: string;
  name: string;
  department: string | null;
  designation: string | null;
  rfid_tag: string | null;
  user_id: string | null;
  active: number;
  last_scan_type: 'IN' | 'OUT' | null;
  last_scan_at: string | null;
}

interface TodayEmployee {
  employee_id: string;
  employee_code: string;
  name: string;
  department: string | null;
  status: 'IN' | 'OUT' | null;
  clock_in: string | null;
  clock_out: string | null;
}

interface AttendanceLog {
  id: string;
  employee_id: string;
  employee_name: string;
  employee_code: string;
  department: string | null;
  scan_type: 'IN' | 'OUT';
  scanned_at: string;
  date: string;
  device_id: string | null;
}

interface ReportRow {
  employee_id: string;
  employee_code: string;
  name: string;
  department: string | null;
  days_present: number;
  first_in: string | null;
  last_out: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso.replace('+05:30', 'Z').replace('Z', '+05:30').replace('+05:30Z', '+05:30'));
  // simple: just parse the time portion from the ISO string
  const t = iso.substring(11, 16);
  const [hStr, mStr] = t.split(':');
  const h = parseInt(hStr, 10);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${mStr} ${ampm}`;
}

function fmtDuration(inIso: string | null, outIso: string | null): string {
  if (!inIso || !outIso) return '—';
  const inMs  = new Date(inIso.replace(/\+05:30$/, '+05:30')).getTime();
  const outMs = new Date(outIso.replace(/\+05:30$/, '+05:30')).getTime();
  const diffMs = outMs - inMs;
  if (diffMs <= 0) return '—';
  const h = Math.floor(diffMs / 3_600_000);
  const m = Math.floor((diffMs % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}

// ── Employee Modal ─────────────────────────────────────────────────────────────

interface EmpForm { name: string; department: string; designation: string; rfid_tag: string; }

function EmployeeModal({
  isOpen, onClose, onSaved, initial
}: {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  initial?: Employee | null;
}) {
  const [form, setForm] = useState<EmpForm>({ name: '', department: '', designation: '', rfid_tag: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (initial) {
      setForm({
        name:        initial.name,
        department:  initial.department  ?? '',
        designation: initial.designation ?? '',
        rfid_tag:    initial.rfid_tag    ?? '',
      });
    } else {
      setForm({ name: '', department: '', designation: '', rfid_tag: '' });
    }
  }, [initial, isOpen]);

  const save = async () => {
    if (!form.name.trim()) { toast.error('Name is required'); return; }
    setSaving(true);
    try {
      const payload = {
        name:        form.name.trim(),
        department:  form.department.trim()  || null,
        designation: form.designation.trim() || null,
        rfid_tag:    form.rfid_tag.trim().toUpperCase() || null,
      };
      if (initial) {
        await api.put(`/attendance/employees/${initial.id}`, payload);
        toast.success('Employee updated');
      } else {
        await api.post('/attendance/employees', payload);
        toast.success('Employee added');
      }
      onSaved();
      onClose();
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={isOpen} onClose={onClose} title={initial ? 'Edit Employee' : 'Add Employee'}>
      <div className="space-y-4">
        {/* Name */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Full Name *</label>
          <input
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="e.g. Ramesh Kumar"
          />
        </div>
        {/* Department + Designation */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Department</label>
            <input
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={form.department}
              onChange={e => setForm(f => ({ ...f, department: e.target.value }))}
              placeholder="e.g. Production"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Designation</label>
            <input
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={form.designation}
              onChange={e => setForm(f => ({ ...f, designation: e.target.value }))}
              placeholder="e.g. Technician"
            />
          </div>
        </div>
        {/* RFID Tag */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            <Tag size={12} className="inline mr-1" />
            RFID Tag UID
          </label>
          <input
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase"
            value={form.rfid_tag}
            onChange={e => setForm(f => ({ ...f, rfid_tag: e.target.value.toUpperCase() }))}
            placeholder="e.g. A1B2C3D4"
          />
          <p className="text-xs text-gray-400 mt-1">Scan the RFID card once and copy the UID shown on Serial Monitor</p>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : initial ? 'Save Changes' : 'Add Employee'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Log Entry Modal ───────────────────────────────────────────────────────────

interface LogForm { employee_id: string; scan_type: 'IN' | 'OUT'; date: string; time: string; }

function LogModal({
  isOpen, onClose, onSaved, initial, historyDate
}: {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  initial?: AttendanceLog | null;
  historyDate: string;
}) {
  const [form, setForm] = useState<LogForm>({ employee_id: '', scan_type: 'IN', date: historyDate, time: '09:00' });
  const [empList, setEmpList] = useState<Employee[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    if (initial) {
      setForm({
        employee_id: initial.employee_id,
        scan_type: (initial.scan_type === 'IN' || initial.scan_type === 'OUT') ? initial.scan_type : 'IN',
        date: initial.date,
        time: initial.scanned_at.substring(11, 16),
      });
    } else {
      setForm({ employee_id: '', scan_type: 'IN', date: historyDate, time: '09:00' });
      api.get('/attendance/employees').then(r => setEmpList(r.data)).catch(() => {});
    }
  }, [isOpen, initial, historyDate]);

  const save = async () => {
    if (!initial && !form.employee_id) { toast.error('Select an employee'); return; }
    if (!form.date || !form.time) { toast.error('Date and time are required'); return; }
    setSaving(true);
    try {
      if (initial) {
        await api.put(`/attendance/logs/${initial.id}`, {
          scan_type: form.scan_type,
          date: form.date,
          time: form.time,
        });
        toast.success('Entry updated');
      } else {
        await api.post('/attendance/logs', {
          employee_id: form.employee_id,
          scan_type: form.scan_type,
          date: form.date,
          time: form.time,
        });
        toast.success('Entry added');
      }
      onSaved();
      onClose();
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={isOpen} onClose={onClose} title={initial ? 'Edit Attendance Entry' : 'Add Attendance Entry'}>
      <div className="space-y-4">
        {/* Employee */}
        {initial ? (
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Employee</label>
            <div className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-700">
              {initial.employee_name} <span className="text-gray-400">({initial.employee_code})</span>
            </div>
          </div>
        ) : (
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Employee *</label>
            <select
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={form.employee_id}
              onChange={e => setForm(f => ({ ...f, employee_id: e.target.value }))}
            >
              <option value="">Select employee…</option>
              {empList.map(emp => (
                <option key={emp.id} value={emp.id}>{emp.name} ({emp.employee_code})</option>
              ))}
            </select>
          </div>
        )}

        {/* Date + Time */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Date *</label>
            <input
              type="date"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={form.date}
              onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Time (IST) *</label>
            <input
              type="time"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={form.time}
              onChange={e => setForm(f => ({ ...f, time: e.target.value }))}
            />
          </div>
        </div>

        {/* Scan Type */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-2">Type *</label>
          <div className="flex gap-4">
            {(['IN', 'OUT'] as const).map(t => (
              <label key={t} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="scan_type_log"
                  value={t}
                  checked={form.scan_type === t}
                  onChange={() => setForm(f => ({ ...f, scan_type: t }))}
                  className="accent-blue-600"
                />
                <span className={`text-sm font-semibold ${ t === 'IN' ? 'text-green-700' : 'text-amber-600' }`}>{t}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : initial ? 'Save Changes' : 'Add Entry'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

type Tab = 'today' | 'history' | 'employees' | 'report';

export default function Attendance() {
  const [tab, setTab] = useState<Tab>('today');

  // Today
  const [todayData, setTodayData] = useState<{ date: string; employees: TodayEmployee[] } | null>(null);
  const [todayLoading, setTodayLoading] = useState(false);

  // History
  const [historyDate, setHistoryDate] = useState(new Date().toISOString().substring(0, 10));
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  // Employees
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [empLoading, setEmpLoading] = useState(false);
  const [empModal, setEmpModal] = useState(false);
  const [editEmp, setEditEmp] = useState<Employee | null>(null);

  // Log editing
  const [logModal, setLogModal] = useState(false);
  const [editLog, setEditLog] = useState<AttendanceLog | null>(null);

  // Report
  const [reportMonth, setReportMonth] = useState(new Date().toISOString().substring(0, 7));
  const [report, setReport] = useState<ReportRow[]>([]);
  const [reportLoading, setReportLoading] = useState(false);

  // ── Fetch functions ──────────────────────────────────────────────────────────

  const fetchToday = useCallback(async () => {
    setTodayLoading(true);
    try {
      const res = await api.get('/attendance/today');
      setTodayData(res.data);
    } catch { toast.error('Failed to load today\'s attendance'); }
    finally { setTodayLoading(false); }
  }, []);

  const fetchLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      const res = await api.get(`/attendance/logs?date=${historyDate}`);
      setLogs(res.data);
    } catch { toast.error('Failed to load logs'); }
    finally { setLogsLoading(false); }
  }, [historyDate]);

  const fetchEmployees = useCallback(async () => {
    setEmpLoading(true);
    try {
      const res = await api.get('/attendance/employees');
      setEmployees(res.data);
    } catch { toast.error('Failed to load employees'); }
    finally { setEmpLoading(false); }
  }, []);

  const fetchReport = useCallback(async () => {
    setReportLoading(true);
    try {
      const res = await api.get(`/attendance/report?month=${reportMonth}`);
      setReport(res.data.report);
    } catch { toast.error('Failed to load report'); }
    finally { setReportLoading(false); }
  }, [reportMonth]);

  // Load on tab change
  useEffect(() => {
    if (tab === 'today')     fetchToday();
    if (tab === 'history')   fetchLogs();
    if (tab === 'employees') fetchEmployees();
    if (tab === 'report')    fetchReport();
  }, [tab, fetchToday, fetchLogs, fetchEmployees, fetchReport]);

  useEffect(() => {
    if (tab === 'history') fetchLogs();
  }, [historyDate, fetchLogs, tab]);

  useEffect(() => {
    if (tab === 'report') fetchReport();
  }, [reportMonth, fetchReport, tab]);

  // Auto-refresh today every 30s
  useEffect(() => {
    if (tab !== 'today') return;
    const id = setInterval(fetchToday, 30_000);
    return () => clearInterval(id);
  }, [tab, fetchToday]);

  // ── Delete / edit log entries ─────────────────────────────────────────────

  const deleteLog = async (log: AttendanceLog) => {
    if (!window.confirm(`Delete ${log.scan_type} entry for ${log.employee_name} at ${fmtTime(log.scanned_at)}?`)) return;
    try {
      await api.delete(`/attendance/logs/${log.id}`);
      toast.success('Entry deleted');
      fetchLogs();
    } catch { toast.error('Failed to delete'); }
  };

  // ── Delete employee ──────────────────────────────────────────────────────────

  const deleteEmployee = async (emp: Employee) => {
    if (!window.confirm(`Deactivate ${emp.name}? They won't appear in future attendance.`)) return;
    try {
      await api.delete(`/attendance/employees/${emp.id}`);
      toast.success('Employee deactivated');
      fetchEmployees();
    } catch { toast.error('Failed to deactivate'); }
  };

  // ── Export CSV ───────────────────────────────────────────────────────────────

  const exportCSV = () => {
    if (!report.length) return;
    const yearMonth = reportMonth;
    const header = 'Code,Name,Department,Days Present\n';
    const rows = report.map(r =>
      `${r.employee_code},"${r.name}","${r.department ?? ''}",${r.days_present}`
    ).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `attendance_${yearMonth}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Today stats ──────────────────────────────────────────────────────────────

  const total       = todayData?.employees.length ?? 0;
  const present     = todayData?.employees.filter(e => e.clock_in !== null).length ?? 0;
  const currentlyIn = todayData?.employees.filter(e => e.status === 'IN').length ?? 0;
  const absent      = total - present;

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="p-4 lg:p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Attendance</h1>
          <p className="text-sm text-gray-500 mt-0.5">RFID-based employee timesheet</p>
        </div>
        <button
          onClick={() => { if (tab === 'today') fetchToday(); else if (tab === 'history') fetchLogs(); else if (tab === 'employees') fetchEmployees(); else fetchReport(); }}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 border border-gray-200 rounded-lg px-3 py-1.5"
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 mb-6 w-fit">
        {([
          { key: 'today',    label: 'Today',     icon: <Clock size={14} /> },
          { key: 'history',  label: 'History',   icon: <CalendarDays size={14} /> },
          { key: 'employees',label: 'Employees', icon: <Users size={14} /> },
          { key: 'report',   label: 'Report',    icon: <BarChart3 size={14} /> },
        ] as const).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
              tab === t.key
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {/* ── TODAY ───────────────────────────────────────────────────────────────── */}
      {tab === 'today' && (
        <div>
          {/* Stats row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
            {[
              { label: 'Total',      value: total,       color: 'bg-gray-50  border-gray-200',  textColor: 'text-gray-800' },
              { label: 'Present',    value: present,     color: 'bg-green-50 border-green-200', textColor: 'text-green-700' },
              { label: 'Currently In', value: currentlyIn, color: 'bg-blue-50  border-blue-200',  textColor: 'text-blue-700' },
              { label: 'Absent',     value: absent,      color: 'bg-red-50   border-red-200',   textColor: 'text-red-700' },
            ].map(s => (
              <div key={s.label} className={`rounded-xl border p-4 ${s.color}`}>
                <div className={`text-2xl font-bold ${s.textColor}`}>{s.value}</div>
                <div className="text-xs text-gray-500 mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>

          {todayLoading ? (
            <div className="text-center py-12 text-gray-400">Loading…</div>
          ) : (
            <>
              {todayData && (
                <p className="text-xs text-gray-400 mb-3">Date: {todayData.date}</p>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {(todayData?.employees ?? []).map(emp => (
                  <div
                    key={emp.employee_id}
                    className={`rounded-xl border p-4 flex items-start gap-3 ${
                      emp.status === 'IN'
                        ? 'border-green-200 bg-green-50'
                        : emp.status === 'OUT'
                        ? 'border-amber-200 bg-amber-50'
                        : 'border-gray-200 bg-gray-50'
                    }`}
                  >
                    {/* Status icon */}
                    <div className="mt-0.5 shrink-0">
                      {emp.status === 'IN'  && <CheckCircle2 size={20} className="text-green-600" />}
                      {emp.status === 'OUT' && <ChevronDown  size={20} className="text-amber-500" />}
                      {!emp.status          && <XCircle      size={20} className="text-gray-300"  />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm text-gray-900 truncate">{emp.name}</div>
                      <div className="text-xs text-gray-500">{emp.department ?? 'No dept'} · {emp.employee_code}</div>
                      <div className="flex gap-3 mt-2 text-xs text-gray-600">
                        <span>In: <b>{fmtTime(emp.clock_in)}</b></span>
                        <span>Out: <b>{fmtTime(emp.clock_out)}</b></span>
                        <span className="text-blue-600">{fmtDuration(emp.clock_in, emp.clock_out)}</span>
                      </div>
                    </div>
                    {/* Badge */}
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ${
                      emp.status === 'IN'  ? 'bg-green-100 text-green-700' :
                      emp.status === 'OUT' ? 'bg-amber-100 text-amber-700' :
                                            'bg-gray-100  text-gray-500'
                    }`}>
                      {emp.status ?? 'Absent'}
                    </span>
                  </div>
                ))}
                {(todayData?.employees ?? []).length === 0 && (
                  <p className="col-span-full text-center py-12 text-gray-400">
                    No employees found. Add employees first.
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── HISTORY ─────────────────────────────────────────────────────────────── */}
      {tab === 'history' && (
        <div>
          <div className="flex items-center justify-between gap-3 mb-5">
            <div className="flex items-center gap-3">
              <input
                type="date"
                value={historyDate}
                onChange={e => setHistoryDate(e.target.value)}
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-500">{logs.length} scan{logs.length !== 1 ? 's' : ''}</span>
            </div>
            <button
              onClick={() => { setEditLog(null); setLogModal(true); }}
              className="flex items-center gap-1.5 text-sm bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
            >
              <PlusCircle size={15} /> Add Entry
            </button>
          </div>

          {logsLoading ? (
            <div className="text-center py-12 text-gray-400">Loading…</div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-200">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    {['Time', 'Employee', 'Code', 'Department', 'Type', 'Device', 'Actions'].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {logs.map(log => (
                    <tr key={log.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-3 font-mono text-xs">{fmtTime(log.scanned_at)}</td>
                      <td className="px-4 py-3 font-medium text-gray-900">{log.employee_name}</td>
                      <td className="px-4 py-3 text-gray-500 font-mono text-xs">{log.employee_code}</td>
                      <td className="px-4 py-3 text-gray-500">{log.department ?? '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${
                          log.scan_type === 'IN'
                            ? 'bg-green-100 text-green-700'
                            : log.scan_type === 'OUT'
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-red-100 text-red-600'
                        }`}>
                          {log.scan_type === 'IN' ? <Wifi size={10} /> : <WifiOff size={10} />}
                          {log.scan_type}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-400 text-xs">{log.device_id ?? '—'}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => { setEditLog(log); setLogModal(true); }}
                            className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"
                            title="Edit"
                          >
                            <Edit2 size={13} />
                          </button>
                          <button
                            onClick={() => deleteLog(log)}
                            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded"
                            title="Delete"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {logs.length === 0 && (
                    <tr>
                      <td colSpan={7} className="text-center py-10 text-gray-400">
                        No scans recorded for this date
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── EMPLOYEES ───────────────────────────────────────────────────────────── */}
      {tab === 'employees' && (
        <div>
          <div className="flex items-center justify-between mb-5">
            <p className="text-sm text-gray-500">{employees.length} active employee{employees.length !== 1 ? 's' : ''}</p>
            <button
              onClick={() => { setEditEmp(null); setEmpModal(true); }}
              className="flex items-center gap-1.5 text-sm bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
            >
              <UserPlus size={15} /> Add Employee
            </button>
          </div>

          {empLoading ? (
            <div className="text-center py-12 text-gray-400">Loading…</div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-200">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    {['Code', 'Name', 'Department', 'Designation', 'RFID Tag', 'Today', 'Actions'].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {employees.map(emp => (
                    <tr key={emp.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-3 font-mono text-xs text-gray-500">{emp.employee_code}</td>
                      <td className="px-4 py-3 font-medium text-gray-900">{emp.name}</td>
                      <td className="px-4 py-3 text-gray-500">{emp.department ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-500">{emp.designation ?? '—'}</td>
                      <td className="px-4 py-3">
                        {emp.rfid_tag ? (
                          <span className="inline-flex items-center gap-1 font-mono text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-md border border-blue-100">
                            <Tag size={10} />{emp.rfid_tag}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400 italic">Not assigned</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {emp.last_scan_type ? (
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                            emp.last_scan_type === 'IN'
                              ? 'bg-green-100 text-green-700'
                              : 'bg-amber-100 text-amber-700'
                          }`}>
                            {emp.last_scan_type} {fmtTime(emp.last_scan_at)}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => { setEditEmp(emp); setEmpModal(true); }}
                            className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"
                            title="Edit"
                          >
                            <Edit2 size={14} />
                          </button>
                          <button
                            onClick={() => deleteEmployee(emp)}
                            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded"
                            title="Deactivate"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {employees.length === 0 && (
                    <tr>
                      <td colSpan={7} className="text-center py-10 text-gray-400">
                        No employees yet. Click "Add Employee" to get started.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── REPORT ──────────────────────────────────────────────────────────────── */}
      {tab === 'report' && (
        <div>
          <div className="flex items-center justify-between mb-5">
            <input
              type="month"
              value={reportMonth}
              onChange={e => setReportMonth(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={exportCSV}
              disabled={report.length === 0}
              className="flex items-center gap-1.5 text-sm bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 disabled:opacity-40"
            >
              <Download size={14} /> Export CSV
            </button>
          </div>

          {reportLoading ? (
            <div className="text-center py-12 text-gray-400">Loading…</div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-200">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    {['Code', 'Name', 'Department', 'Days Present', 'First Clock-in', 'Last Clock-out'].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.map(row => (
                    <tr key={row.employee_id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-3 font-mono text-xs text-gray-500">{row.employee_code}</td>
                      <td className="px-4 py-3 font-medium text-gray-900">{row.name}</td>
                      <td className="px-4 py-3 text-gray-500">{row.department ?? '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`font-bold text-base ${row.days_present >= 20 ? 'text-green-600' : row.days_present >= 10 ? 'text-amber-500' : 'text-red-500'}`}>
                          {row.days_present}
                        </span>
                        <span className="text-xs text-gray-400 ml-1">days</span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 font-mono text-xs">{row.first_in ? row.first_in.substring(0, 10) : '—'}</td>
                      <td className="px-4 py-3 text-gray-500 font-mono text-xs">{row.last_out ? row.last_out.substring(0, 10) : '—'}</td>
                    </tr>
                  ))}
                  {report.length === 0 && (
                    <tr>
                      <td colSpan={6} className="text-center py-10 text-gray-400">
                        No data for {reportMonth}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Employee Modal */}
      <EmployeeModal
        isOpen={empModal}
        onClose={() => setEmpModal(false)}
        onSaved={() => { fetchEmployees(); fetchToday(); }}
        initial={editEmp}
      />

      {/* Log Entry Modal */}
      <LogModal
        isOpen={logModal}
        onClose={() => setLogModal(false)}
        onSaved={fetchLogs}
        initial={editLog}
        historyDate={historyDate}
      />
    </div>
  );
}
