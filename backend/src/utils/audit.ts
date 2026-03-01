import { v4 as uuidv4 } from 'uuid';
import db from '../db/database';
import { nowIST } from './date';

export function auditLog(
  userId: string | undefined,
  userName: string | undefined,
  action: string,
  entityType: string,
  entityId: string,
  oldValues: object | null = null,
  newValues: object | null = null,
  ipAddress?: string
) {
  db.prepare(`
    INSERT INTO audit_logs (id, user_id, user_name, action, entity_type, entity_id, old_values, new_values, ip_address, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    uuidv4(),
    userId || null,
    userName || null,
    action,
    entityType,
    entityId,
    oldValues ? JSON.stringify(oldValues) : null,
    newValues ? JSON.stringify(newValues) : null,
    ipAddress || null,
    nowIST()
  );
}
