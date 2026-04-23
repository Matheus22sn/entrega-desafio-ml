export type ToastTone = 'success' | 'error' | 'info';

export interface Ad {
  _id: string;
  ml_id: string;
  seller_user_id?: string;
  site_id?: string;
  category_id?: string;
  listing_type_id?: string;
  currency_id?: string;
  title: string;
  price: number;
  available_quantity: number;
  sold_quantity?: number;
  condition?: string;
  thumbnail?: string;
  permalink?: string;
  status: string;
  sync_state?: string;
  last_error?: string;
  sync_note?: string;
  last_sync?: string;
  last_remote_change_at?: string;
  updatedAt?: string;
  createdAt?: string;
}

export interface AdsSummary {
  total: number;
  active: number;
  paused: number;
  lowStock: number;
  unsynced: number;
  conflicts: number;
  remoteChanged: number;
  inventoryValue: number;
}

export interface AdsResponse {
  items: Ad[];
  summary: AdsSummary;
  warnings?: string[];
  syncedAt?: string;
}

export interface ListingType {
  id: string;
  name: string;
}

export interface CategoryPrediction {
  category_id: string;
  category_name: string;
  domain_id: string;
  domain_name: string;
}

export interface CategoryAttributeOption {
  id: string;
  name: string;
}

export interface CategoryAttribute {
  id: string;
  name: string;
  value_type: string;
  value_max_length?: number | null;
  tooltip?: string;
  attribute_group_id?: string;
  attribute_group_name?: string;
  required: boolean;
  hidden: boolean;
  fixed: boolean;
  values: CategoryAttributeOption[];
  allowed_units: CategoryAttributeOption[];
  default_unit?: string;
}

export interface CategoryContextResponse {
  category: {
    id: string;
    name: string;
    path_from_root: CategoryAttributeOption[];
    max_title_length?: number;
  };
  listingTypes: ListingType[];
  attributes: CategoryAttribute[];
}

export interface CategoryAttributeDraft {
  value: string;
  unit: string;
}

export interface ValidationIssue {
  cause_id?: number | string;
  code?: string;
  type?: string;
  message?: string;
  references?: string[];
}

export interface ValidationResponse {
  valid: boolean;
  issues: ValidationIssue[];
  error?: string;
}

export interface SyncJobResponse {
  status: 'idle' | 'running' | 'completed' | 'failed';
  startedAt?: string;
  finishedAt?: string;
  syncedAt?: string;
  totalItems: number;
  totalBatches: number;
  processedBatches: number;
  warnings: string[];
  error?: string;
  summary?: AdsSummary;
}

export interface SellerProfile {
  id: number;
  nickname: string;
  email: string;
  user_type: string;
  points: number;
}

export interface AuthStatus {
  authenticated: boolean;
  session_id?: string;
  expires_at?: string;
  seller?: SellerProfile;
}

export interface ToastMessage {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
}

export interface FiltersState {
  search: string;
  status: string;
  syncState: string;
  stock: string;
  sort: string;
}

export interface CreateAdFormState {
  title: string;
  category_id: string;
  listing_type_id: string;
  price: string;
  available_quantity: string;
  condition: string;
  currency_id: string;
  buying_mode: string;
  pictures: string;
}

export interface EditAdFormState {
  title: string;
  price: string;
  available_quantity: string;
}
