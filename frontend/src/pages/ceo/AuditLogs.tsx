import { useEffect, useState } from 'react';
import api from '../../utils/api';
import { AuditLog } from '../../types';
import { formatDateTime } from '../../utils/helpers';

const ENTITY_TYPES = ['lead','followup','quotation','production_order','fabrication','assembly','testing','dispatch','installation'];

export default function AuditLogs() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [entityType, setEntityType] = useState('');
  const [page, setPage] = useState(0);
  const limit = 50;

  useEffect(() => {
    setLoading(true);
    const params: any = { limit, offset: page * limit };
    if (entityType) params.entity_type = entityType;
    api.get('/audit', { params })
      .then(r => { setLogs(r.data.logs); setTotal(r.data.total); })
      .finally(() => setLoading(false));
  }, [entityType, page]);

  const ACTION_COLOR: Record<string, string> = {
    'CREATE': 'badge-green', 'UPDATE': 'badge-blue', 'DELETE': 'badge-red',
    'STATUS_CHANGE': 'badge-yellow', 'PAYMENT_CONFIRMED': 'badge-green',
    'DISPATCHED': 'badge-purple', 'COMPLETE': 'badge-green',
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Audit Logs</h1>
        <div className="text-sm text-gray-500">{total.toLocaleString()} records</div>
      </div>

      <div className="flex gap-3">
        <select className="form-select w-48" value={entityType} onChange={e => { setEntityType(e.target.value); setPage(0); }}>
          <option value="">All Entities</option>
          {ENTITY_TYPES.map(t => <option key={t} value={t} className="capitalize">{t.replace('_', ' ')}</option>)}
        </select>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-th">Time</th>
                <th className="table-th">User</th>
                <th className="table-th">Action</th>
                <th className="table-th">Entity</th>
                <th className="table-th">Entity ID</th>
                <th className="table-th">Changes</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="table-td text-center text-gray-400 py-8">Loading...</td></tr>
              ) : logs.length === 0 ? (
                <tr><td colSpan={6} className="table-td text-center text-gray-400 py-8">No logs found</td></tr>
              ) : logs.map((log) => {
                let changes = '';
                if (log.new_values) {
                  try {
                    const nv = JSON.parse(log.new_values);
                    changes = Object.entries(nv).map(([k, v]) => `${k}: ${v}`).join(', ');
                  } catch {}
                }
                return (
                  <tr key={log.id} className="table-tr text-xs">
                    <td className="table-td text-gray-400 whitespace-nowrap">{formatDateTime(log.created_at)}</td>
                    <td className="table-td">{log.user_name || '—'}</td>
                    <td className="table-td"><span className={ACTION_COLOR[log.action] || 'badge-gray'}>{log.action}</span></td>
                    <td className="table-td capitalize">{log.entity_type.replace('_', ' ')}</td>
                    <td className="table-td font-mono text-gray-400">{log.entity_id.slice(0, 8)}…</td>
                    <td className="table-td text-gray-500 max-w-xs truncate">{changes}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {/* Pagination */}
        <div className="px-4 py-2 border-t border-gray-100 flex items-center justify-between">
          <div className="text-xs text-gray-500">Showing {page * limit + 1}–{Math.min((page + 1) * limit, total)} of {total}</div>
          <div className="flex gap-2">
            <button disabled={page === 0} onClick={() => setPage(p => p - 1)} className="btn-secondary btn-sm">← Prev</button>
            <button disabled={(page + 1) * limit >= total} onClick={() => setPage(p => p + 1)} className="btn-secondary btn-sm">Next →</button>
          </div>
        </div>
      </div>
    </div>
  );
}
