export interface Env {
  DB: D1Database;
  ADMIN_TOKEN: string;
  TOKEN_PEPPER: string;
  BOOTSTRAP_USERNAME?: string;
  BOOTSTRAP_PASSWORD?: string;
  ALLOW_REGISTRATION?: string;
  ALLOW_INSECURE_LOCALHOST?: string;
  MAX_BODY_BYTES?: string;
  MAX_NODES?: string;
}
export interface Principal { userId: string; credentialId: string; kind: 'session' | 'device' }
export interface NodeRecord {
  id: number; parent: number | null; type: 'folder' | 'bookmark'; title: string; url: string | null; position: number;
}
export interface Snapshot { nodes: NodeRecord[]; highestId: number }
export interface State { user_id: string; version: number; body: string | null; etag: string | null; highest_id: number; updated_at: number }
export interface Lease { user_id: string; credential_id: string; generation: string; base_version: number; expires_at: number; updated_at: number }
