import "server-only";

/**
 * Server-only infra API layer (M11). Talks to the Supabase Management API and
 * the Vercel API using tokens that live only in server env — they must never be
 * imported into a client component. Every caller is gated by requireSuperAdmin.
 */

const SB_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const V_TOKEN = process.env.VERCEL_API_TOKEN;

// Non-secret identifiers.
const SB_REF = "skgphoupbwdexfevgcnn";
const V_PROJECT = "prj_0iHAyTMxqXZd0K3kb9W0lEaLf7JP";
const V_TEAM = "team_IRzhRqI38SxMWs6Kvep10bbG";

export const infraConfigured = Boolean(SB_TOKEN && V_TOKEN);

async function sb<T>(path: string): Promise<T> {
  if (!SB_TOKEN) throw new Error("SUPABASE_ACCESS_TOKEN not set");
  const r = await fetch(`https://api.supabase.com/v1/projects/${SB_REF}${path}`, {
    headers: { Authorization: `Bearer ${SB_TOKEN}` },
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`Supabase API ${path} → ${r.status}`);
  return r.json() as Promise<T>;
}

async function vercel<T>(path: string, init?: RequestInit): Promise<T> {
  if (!V_TOKEN) throw new Error("VERCEL_API_TOKEN not set");
  const sep = path.includes("?") ? "&" : "?";
  const r = await fetch(`https://api.vercel.com${path}${sep}teamId=${V_TEAM}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${V_TOKEN}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) {
    const msg = (j?.error as { message?: string } | undefined)?.message;
    throw new Error(msg ?? `Vercel API ${path} → ${r.status}`);
  }
  return j as T;
}

/* ---- Supabase (read) --------------------------------------------------- */

export type SbProject = {
  name: string;
  region: string;
  status: string;
  created_at: string;
  database?: { version?: string; host?: string };
};
export type SbMigration = { version: string; name: string };
export type SbLint = {
  name: string;
  title: string;
  level: "INFO" | "WARN" | "ERROR" | string;
  categories: string[];
  description: string;
  detail: string;
};

export const getSupabaseProject = () => sb<SbProject>("");
export const getMigrations = () => sb<SbMigration[]>("/database/migrations");
export async function getAdvisors(kind: "security" | "performance"): Promise<SbLint[]> {
  const r = await sb<{ lints: SbLint[] }>(`/advisors/${kind}`);
  return r.lints ?? [];
}

export type SbAuthConfig = {
  site_url: string;
  disable_signup: boolean;
  /** true = users are auto-confirmed (i.e. email verification is OFF). */
  mailer_autoconfirm: boolean;
  external_email_enabled: boolean;
  jwt_exp: number;
};
export const getAuthConfig = () => sb<SbAuthConfig>("/config/auth");

/** Patch auth settings (e.g. { mailer_autoconfirm: false } to require email confirmation). */
export async function updateAuthConfig(patch: Partial<SbAuthConfig>): Promise<SbAuthConfig> {
  if (!SB_TOKEN) throw new Error("SUPABASE_ACCESS_TOKEN not set");
  const r = await fetch(`https://api.supabase.com/v1/projects/${SB_REF}/config/auth`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${SB_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(patch),
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`Supabase auth config → ${r.status} ${await r.text().catch(() => "")}`);
  return r.json();
}

export type SbBucket = {
  id: string;
  name: string;
  public: boolean;
  file_size_limit: number | null;
  allowed_mime_types: string[] | null;
};
export const getBuckets = () => sb<SbBucket[]>("/storage/buckets");

/* ---- Vercel ------------------------------------------------------------ */

export type VDeployment = {
  uid: string;
  url: string;
  readyState: string;
  created: number;
  target: string | null;
  meta?: { githubCommitMessage?: string; githubCommitSha?: string };
};
export type VEnv = { id: string; key: string; target: string[] | string; type: string };
export type VDomain = { name: string; verified?: boolean };

export async function getDeployments(limit = 10): Promise<VDeployment[]> {
  const r = await vercel<{ deployments: VDeployment[] }>(
    `/v6/deployments?projectId=${V_PROJECT}&limit=${limit}`,
  );
  return r.deployments ?? [];
}

/** Env var metadata only — values are encrypted and deliberately never returned. */
export async function getEnvVars(): Promise<VEnv[]> {
  const r = await vercel<{ envs: VEnv[] }>(`/v9/projects/${V_PROJECT}/env`);
  return (r.envs ?? []).map((e) => ({ id: e.id, key: e.key, target: e.target, type: e.type }));
}

/** Create or overwrite an encrypted env var (write-only: the value never comes back). */
export async function upsertEnvVar(key: string, value: string, targets: string[]): Promise<void> {
  await vercel(`/v10/projects/${V_PROJECT}/env?upsert=true`, {
    method: "POST",
    body: JSON.stringify({ key, value, type: "encrypted", target: targets }),
  });
}

export async function deleteEnvVar(envId: string): Promise<void> {
  await vercel(`/v9/projects/${V_PROJECT}/env/${envId}`, { method: "DELETE" });
}

export async function getDomains(): Promise<VDomain[]> {
  const r = await vercel<{ domains: VDomain[] }>(`/v9/projects/${V_PROJECT}/domains`);
  return r.domains ?? [];
}

/**
 * Redeploy an existing build to production. Passing the newest deployment id
 * is a plain redeploy; passing an older READY one is an instant rollback.
 */
export async function redeploy(deploymentId: string): Promise<{ url?: string }> {
  return vercel<{ url?: string }>(`/v13/deployments`, {
    method: "POST",
    body: JSON.stringify({ name: "fast-socio", deploymentId, target: "production" }),
  });
}
