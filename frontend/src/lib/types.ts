export type User = {
  id: number; username: string; name: string; is_superuser: boolean;
  /** false for team members, who work in someone else's workspace */
  is_owner: boolean;
  role: 'owner' | TeamRole;
  /** the owner's name, for team members */
  workspace: string | null;
};

export type TeamRole = 'employee' | 'support';

export type TeamMember = { id: number; username: string; name: string; role: TeamRole; last_login: string | null; created_at: string };

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
  connected_at: string | null;
  created_at: string;
  qr: string | null;
};

export type AccountsResponse = { provider: string; provider_online: boolean; results: Account[] };

export type Media = {
  id: number; original_name: string; mime_type: string; size: number; kind: 'image' | 'video' | 'audio' | 'document';
  url: string; public_url: string | null; source_url: string; created_at: string;
};

export type Template = { id: number; title: string; body: string; created_at: string; updated_at: string };

/** How a campaign shares its recipients between the sender accounts. */
export type Rotation = 'turns' | 'random' | 'balanced';

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
  sender_account_ids: number[];
  rotation_mode: Rotation;
  rotate_every: number;
  failover: boolean;
};

export type CampaignTarget = {
  id: number;
  contact_id: number | null;
  account_id: number | null;
  account_label: string;
  phone: string;
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
  rotation_mode: Rotation;
  rotate_every: number;
  failover: boolean;
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
  checked_at: string | null;
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
  validation: Validation;
  columns: { name_column: string | null; phone_column: string | null } | null;
  garbled_names: number;
};

/** How many numbers are on WhatsApp, not on it, or still waiting to be checked. */
export type Validation = { total: number; valid: number; invalid: number; pending: number; opted_out: number };
