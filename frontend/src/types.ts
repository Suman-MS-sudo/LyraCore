export type Role = 'sales' | 'production' | 'management' | 'installation';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export type LeadStatus = 'NEW' | 'CONTACTED' | 'QUOTATION_SENT' | 'FOLLOW_UP' | 'NEGOTIATION' | 'PARTIAL_PAYMENT' | 'PAYMENT_CONFIRMED' | 'CLOSED' | 'LOST';
export type LeadSource = 'referral' | 'website' | 'cold_call' | 'exhibition' | 'social_media' | 'other';

export interface Lead {
  id: string;
  lead_number: string;
  customer_name: string;
  customer_phone: string;
  customer_email?: string;
  company?: string;
  product_interest: string;
  product_type?: string;
  source: LeadSource;
  status: LeadStatus;
  assigned_to: string;
  assigned_name?: string;
  created_by: string;
  created_name?: string;
  notes?: string;
  estimated_value?: number;
  // SOP requirement fields
  location?: string;
  quantity?: string;
  purchase_timeline?: string;
  budget_range?: string;
  customization_notes?: string;
  requirement_type?: 'standard' | 'custom';
  requirement_confirmed?: number;
  // SOP closure fields
  billing_name?: string;
  gst_number?: string;
  delivery_address?: string;
  address?: string;
  // SOP tracking
  first_contacted_at?: string;
  lost_reason?: string;
  created_at: string;
  updated_at: string;
}

export interface Followup {
  id: string;
  lead_id: string;
  user_id: string;
  user_name?: string;
  type: 'call' | 'whatsapp' | 'email' | 'meeting' | 'other';
  notes: string;
  scheduled_at?: string;
  completed_at?: string;
  outcome?: string;
  created_at: string;
}

export interface Quotation {
  id: string;
  lead_id: string;
  pi_number: string;
  file_path?: string;
  amount: number;
  discount?: number;
  freight_charges?: number;
  installation_charges?: number;
  validity_date?: string;
  payment_terms?: string;
  payment_confirmed: number;
  payment_confirmed_at?: string;
  payment_type?: 'full' | 'partial' | null;
  amount_paid?: number;
  uploaded_by: string;
  notes?: string;
  email_sent?: number;
  email_sent_at?: string;
  created_at: string;
}

export type OrderStatus = 'PENDING' | 'FABRICATION' | 'ASSEMBLY' | 'TESTING' | 'PACKAGING' | 'DISPATCHED' | 'INSTALLATION' | 'COMPLETED';

export interface ProductionOrder {
  id: string;
  order_number: string;
  lead_id: string;
  quotation_id: string;
  status: OrderStatus;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  expected_delivery_date?: string;
  customer_name?: string;
  company?: string;
  customer_phone?: string;
  customer_email?: string;
  delivery_address?: string;
  address?: string;
  billing_name?: string;
  gst_number?: string;
  lead_number?: string;
  product_interest?: string;
  amount?: number;
  pi_number?: string;
  created_by: string;
  created_by_name?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
  fabrication?: FabricationRecord;
  assembly?: AssemblyRecord;
  testing?: TestingRecord;
  packing?: PackingRecord;
  dispatch?: DispatchRecord;
  installation?: InstallationRecord;
}

export interface FabricationRecord {
  id: string;
  fabricator_name: string;
  sent_date: string;
  expected_return_date: string;
  received_date?: string;
  status: 'SENT' | 'RECEIVED' | 'REWORK' | 'DELAYED';
  rework_reason?: string;
  notes?: string;
  defect_count?: number;
}

export interface AssemblyRecord {
  id: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
  technician?: string;
  started_at?: string;
  completed_at?: string;
  notes?: string;
  updated_at?: string;
  updated_by?: string;
}

export interface TestingRecord {
  id: string;
  status: 'PENDING' | 'PASSED' | 'FAILED';
  checklist_completed: number;
  checklist_data?: string; // JSON: Record<string, 'PASS' | 'FAIL'>
  failure_reason?: string;
  tested_by?: string;
  tested_at?: string;
  notes?: string;
  updated_at?: string;
  qcPhotos?: { id: string; file_path: string; caption?: string }[];
}

export interface PackingRecord {
  id: string;
  status: 'PENDING' | 'COMPLETED';
  checklist_data?: string; // JSON: Record<string, boolean>
  packed_by?: string;
  packed_at?: string;
  notes?: string;
}

export interface DispatchRecord {
  id: string;
  transporter: string;
  lr_number?: string;
  dispatch_date: string;
  expected_delivery_date?: string;
  delivery_address?: string;
  status: 'DISPATCHED' | 'IN_TRANSIT' | 'DELIVERED';
  notes?: string;
}

export interface InstallationRecord {
  id: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
  engineer_name?: string;
  installation_date?: string;
  support_notes?: string;
  feedback?: string;
  rating?: number;
  completed_at?: string;
}

export interface AuditLog {
  id: string;
  user_name?: string;
  action: string;
  entity_type: string;
  entity_id: string;
  old_values?: string;
  new_values?: string;
  created_at: string;
}
