import { PageHeader, SectionLabel } from "@/components/admin/kit";
import { InfraDeployControls, type DeployRow } from "@/components/admin/infra-deploy-controls";
import { InfraAuthSettings } from "@/components/admin/infra-auth-settings";
import { InfraEnvEditor, type EnvRow } from "@/components/admin/infra-env-editor";
import { requireSuperAdmin } from "@/lib/admin/access";
import {
  infraConfigured,
  getSupabaseProject,
  getMigrations,
  getAdvisors,
  getAuthConfig,
  getBuckets,
  getDeployments,
  getEnvVars,
  getDomains,
  type SbLint,
} from "@/lib/admin/infra";

function levelTone(level: string) {
  return level === "ERROR" ? "text-error" : level === "WARN" ? "text-warning" : "text-fg-muted";
}

async function settled<T>(p: Promise<T>): Promise<{ ok: true; v: T } | { ok: false; e: string }> {
  try {
    return { ok: true, v: await p };
  } catch (e) {
    return { ok: false, e: (e as Error).message };
  }
}

function Err({ msg }: { msg: string }) {
  return <p className="mt-2 font-mono text-xs text-error">{msg}</p>;
}

export default async function InfraPage() {
  await requireSuperAdmin();

  if (!infraConfigured) {
    return (
      <>
        <PageHeader title="Infrastructure" sub="Supabase + Vercel control." />
        <p className="rounded-[4px] border border-warning/30 bg-warning/5 px-4 py-3 text-sm text-warning">
          Not configured — set <span className="font-mono">SUPABASE_ACCESS_TOKEN</span> and{" "}
          <span className="font-mono">VERCEL_API_TOKEN</span> in the project environment, then redeploy.
        </p>
      </>
    );
  }

  const [proj, migs, sec, perf, auth, buckets, deps, envs, domains] = await Promise.all([
    settled(getSupabaseProject()),
    settled(getMigrations()),
    settled(getAdvisors("security")),
    settled(getAdvisors("performance")),
    settled(getAuthConfig()),
    settled(getBuckets()),
    settled(getDeployments(10)),
    settled(getEnvVars()),
    settled(getDomains()),
  ]);

  const lintCounts = (lints: SbLint[]) => {
    const c: Record<string, number> = { ERROR: 0, WARN: 0, INFO: 0 };
    lints.forEach((l) => (c[l.level] = (c[l.level] ?? 0) + 1));
    return c;
  };

  const deployRows: DeployRow[] = deps.ok
    ? deps.v.map((d, i) => ({
        uid: d.uid,
        readyState: d.readyState,
        created: new Date(d.created).toISOString().slice(0, 16).replace("T", " ") + " UTC",
        sha: d.meta?.githubCommitSha?.slice(0, 7) ?? d.uid.slice(0, 7),
        message: (d.meta?.githubCommitMessage ?? "").split("\n")[0] || "—",
        isLatest: i === 0,
      }))
    : [];

  const envRows: EnvRow[] = envs.ok
    ? envs.v.map((e) => ({
        id: e.id,
        key: e.key,
        targets: Array.isArray(e.target) ? e.target : [String(e.target)],
      }))
    : [];

  return (
    <>
      <PageHeader title="Infrastructure" sub="Supabase + Vercel — server-side, super_admin only." />

      {/* ---- Supabase ---- */}
      <section>
        <SectionLabel>Supabase project</SectionLabel>
        {proj.ok ? (
          <div className="mt-2 rounded-[4px] border border-glass-border p-3 text-sm">
            <p className="font-medium text-fg">{proj.v.name}</p>
            <p className="mt-1 font-mono text-[11px] text-fg-muted">
              {proj.v.region} · status {proj.v.status}
              {proj.v.database?.version ? ` · pg ${proj.v.database.version}` : ""}
              {migs.ok ? ` · ${migs.v.length} migrations` : ""}
            </p>
          </div>
        ) : (
          <Err msg={proj.e} />
        )}
      </section>

      <section className="mt-6">
        <SectionLabel>Auth settings</SectionLabel>
        <div className="mt-2">
          {auth.ok ? (
            <InfraAuthSettings
              siteUrl={auth.v.site_url}
              jwtExp={auth.v.jwt_exp}
              autoconfirm={auth.v.mailer_autoconfirm}
              disableSignup={auth.v.disable_signup}
            />
          ) : (
            <Err msg={auth.e} />
          )}
        </div>
      </section>

      {(["security", "performance"] as const).map((kind, idx) => {
        const res = idx === 0 ? sec : perf;
        return (
          <section key={kind} className="mt-6">
            <SectionLabel>
              {kind} advisors{res.ok ? ` · ${res.v.length}` : ""}
            </SectionLabel>
            {res.ok ? (
              res.v.length === 0 ? (
                <p className="mt-2 rounded-[4px] border border-glass-border px-4 py-3 text-sm text-fg-muted">
                  No {kind} lints. ✓
                </p>
              ) : (
                <>
                  <p className="mt-1 font-mono text-[11px] text-fg-muted">
                    {Object.entries(lintCounts(res.v))
                      .filter(([, n]) => n > 0)
                      .map(([lvl, n]) => `${n} ${lvl.toLowerCase()}`)
                      .join(" · ")}
                  </p>
                  <div className="mt-2 divide-y divide-glass-border overflow-hidden rounded-[4px] border border-glass-border">
                    {res.v.slice(0, 12).map((l, i) => (
                      <div key={i} className="px-3 py-2">
                        <p className="flex items-center gap-2 text-sm">
                          <span className={`font-mono text-[10px] uppercase ${levelTone(l.level)}`}>{l.level}</span>
                          <span className="text-fg">{l.title}</span>
                        </p>
                        <p className="mt-0.5 line-clamp-1 text-xs text-fg-muted">{l.detail}</p>
                      </div>
                    ))}
                  </div>
                </>
              )
            ) : (
              <Err msg={res.e} />
            )}
          </section>
        );
      })}

      <section className="mt-6">
        <SectionLabel>Storage buckets{buckets.ok ? ` · ${buckets.v.length}` : ""}</SectionLabel>
        {buckets.ok ? (
          <div className="mt-2 divide-y divide-glass-border overflow-hidden rounded-[4px] border border-glass-border">
            {buckets.v.map((b) => (
              <div key={b.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="font-mono text-xs text-fg">{b.name}</p>
                  <p className="font-mono text-[10px] text-fg-disabled">
                    {b.file_size_limit ? `${Math.round(b.file_size_limit / 1048576)} MB limit` : "no size limit"}
                    {b.allowed_mime_types?.length ? ` · ${b.allowed_mime_types.length} mime types` : ""}
                  </p>
                </div>
                <span className={`font-mono text-[10px] uppercase ${b.public ? "text-warning" : "text-fg-muted"}`}>
                  {b.public ? "public" : "private"}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <Err msg={buckets.e} />
        )}
      </section>

      {/* ---- Vercel ---- */}
      <section className="mt-8">
        <SectionLabel>Vercel deployments · redeploy / rollback</SectionLabel>
        <div className="mt-2">
          {deps.ok ? <InfraDeployControls deployments={deployRows} /> : <Err msg={deps.e} />}
        </div>
      </section>

      <section className="mt-6">
        <SectionLabel>Domains{domains.ok ? ` · ${domains.v.length}` : ""}</SectionLabel>
        {domains.ok ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {domains.v.map((d) => (
              <span
                key={d.name}
                className="rounded-[3px] border border-glass-border px-2 py-1 font-mono text-[11px] text-fg-muted"
              >
                {d.name}
              </span>
            ))}
          </div>
        ) : (
          <Err msg={domains.e} />
        )}
      </section>

      <section className="mt-6">
        <SectionLabel>Environment variables{envs.ok ? ` · ${envRows.length}` : ""}</SectionLabel>
        <div className="mt-2">
          {envs.ok ? <InfraEnvEditor envs={envRows} /> : <Err msg={envs.e} />}
        </div>
        <p className="mt-2 font-mono text-[10px] text-fg-disabled">
          values are encrypted by Vercel and never read back · changes need a redeploy
        </p>
      </section>
    </>
  );
}
