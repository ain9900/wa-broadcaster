export type User = { id: number; username: string; name: string; is_superuser: boolean };

export type AccountStatus = 'starting' | 'qr' | 'connected' | 'reconnecting' | 'disconnected' | 'logged_out' | 'error';

export type Account = {
  id: number;
  label: string;
  session_id: string;
  provider: string;
  status: AccountStatus;
  phone: string;
  display_name: string;
  last_error: string;
  daily_limit: number | null;
  effective_daily_limit: number;
  sent_today: number;
  group_count: number;
  groups_synced_at: string | null;
  connected_at: string | null;
  created_at: string;
  qr: string | null;
};

export type AccountsResponse = { provider: string; provider_online: boolean; results: Account[] };

export type Group = { id: number; jid: string; name: string; size: number; admins_only: boolean; is_admin: boolean | null; can_post: boolean };

export type AccountGroups = { account_id: number; label: string; phone: string; groups_synced_at: string | null; groups: Group[] };

export type Media = { id: number; original_name: string; mime_type: string; size: number; kind: 'image' | 'video' | 'audio' | 'document'; url: string; created_at: string };

export type Template = { id: number; title: string; body: string; created_at: string; updated_at: string };

export type TargetRef = { account_id: number; group_jid: string };

export type GroupSet = { id: number; name: string; targets: TargetRef[]; created_at: string; updated_at: string };

export type CampaignStatus = 'scheduled' | 'running' | 'paused' | 'completed' | 'cancelled';
export type TargetStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'skipped';

export type Campaign = {
  id: number;
  name: string;
  message: string;
  media: Media | null;
  status: CampaignStatus;
  delay_min_seconds: number;
  delay_max_seconds: number;
  batch_size: number;
  batch_pause_minutes: number;
  typing_indicator: boolean;
  scheduled_at: string;
  started_at: string | null;
  finished_at: string | null;
  next_action_at: string | null;
  note: string;
  created_by: string | null;
  created_at: string;
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  pending: number;
};

export type CampaignTarget = {
  id: number;
  kind: 'group' | 'contact';
  contact_id: number | null;
  account_id: number | null;
  account_label: string;
  recipient_jid: string;
  recipient_name: string;
  status: TargetStatus;
  error: string;
  attempts: number;
  sent_at: string | null;
  finished_at: string | null;
};

export type CampaignDetail = Campaign & { targets: CampaignTarget[] };

export type Page<T> = { count: number; next: string | null; previous: string | null; results: T[] };

export type Settings = {
  daily_limit: number;
  delay_min_seconds: number;
  delay_max_seconds: number;
  batch_size: number;
  batch_pause_minutes: number;
  typing_indicator: boolean;
  default_country_code: string;
  updated_at: string;
};

export type Dashboard = {
  accounts: { total: number; connected: number };
  sent_today: number;
  failed_today: number;
  sent_total: number;
  campaigns_active: number;
  last_7_days: { date: string; sent: number }[];
};

export type Contact = {
  id: number;
  phone: string;
  name: string;
  lists: number[];
  opted_out: boolean;
  on_whatsapp: boolean | null;
  created_at: string;
  updated_at: string;
};

export type ContactList = { id: number; name: string; contact_count: number; created_at: string };

export type ImportResult = {
  total: number;
  created: number;
  updated: number;
  invalid: { line: number; text: string }[];
  invalid_count: number;
  list: ContactList | null;
};
