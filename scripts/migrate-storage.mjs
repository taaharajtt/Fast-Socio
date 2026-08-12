/**
 * Copy every object from Supabase Storage (Tokyo) to Contabo Object Storage.
 *
 *   node scripts/migrate-storage.mjs             # dry run — reads only
 *   node scripts/migrate-storage.mjs --apply     # perform the copy
 *   node scripts/migrate-storage.mjs --apply --prefix avatars
 *
 * Safety properties, in order of importance:
 *
 *  - READ-ONLY AGAINST SUPABASE. Nothing is ever deleted or modified on the
 *    source. The old stack has to stay intact and serving until the new one is
 *    proven, so this only ever GETs from Supabase.
 *  - IDEMPOTENT / RESUMABLE. An object already present on Contabo with a
 *    matching size is skipped, so an interrupted run is re-runnable and the
 *    final delta-sync at cutover is cheap.
 *  - VERIFIED. Every uploaded object is read back with HEAD and its size
 *    compared. A copy that "succeeded" but landed truncated is a silent data
 *    loss bug, and byte counts are the cheapest way to catch it.
 *  - DRY RUN BY DEFAULT. `--apply` is required to write anything.
 *
 * The authoritative file list comes from `storage.objects` in the database
 * rather than from the Storage list API — it is the same source the app's own
 * rows point at, and it carries size and mimetype without an extra round trip.
 */
import { loadEnv, makeS3 } from "./lib/s3.mjs";

const env = loadEnv();
const APPLY = process.argv.includes("--apply");
const ONLY_PREFIX = process.argv.includes("--prefix")
  ? process.argv[process.argv.indexOf("--prefix") + 1]
  : null;
const CONCURRENCY = 6;

const TOKYO_REF = "skgphoupbwdexfevgcnn";
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "");
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const MGMT_TOKEN = env.SUPABASE_ACCESS_TOKEN;

const s3 = makeS3(env);

async function query(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${TOKYO_REF}/database/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${MGMT_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) throw new Error(`query failed: ${res.status} ${await res.text()}`);
  return res.json();
}

/**
 * chat-media objects whose folder matches no conversation and no community are
 * unreachable by the app — the new authorization model denies them, so copying
 * them would move dead bytes and nothing more. They are reported, not copied.
 */
async function listObjects() {
  const rows = await query(`
    select o.bucket_id, o.name,
           (o.metadata->>'size')::bigint as size,
           o.metadata->>'mimetype' as mimetype,
           case when o.bucket_id <> 'chat-media' then false
                when exists (select 1 from conversations c where c.id::text = split_part(o.name,'/',1)) then false
                when exists (select 1 from communities k where k.id::text = split_part(o.name,'/',1)) then false
                else true end as orphan
    from storage.objects o
    order by o.bucket_id, o.name
  `);
  return rows.filter((r) => !ONLY_PREFIX || r.bucket_id === ONLY_PREFIX);
}

async function copyOne(row) {
  const key = `${row.bucket_id}/${row.name}`;

  const existing = await s3.head(key);
  if (existing && existing.size === Number(row.size)) {
    return { key, status: "skipped" };
  }

  if (!APPLY) return { key, status: "would-copy", size: Number(row.size) };

  // Service-role read works for public and private buckets alike.
  const srcUrl = `${SUPABASE_URL}/storage/v1/object/${row.bucket_id}/${encodeURI(row.name)}`;
  const res = await fetch(srcUrl, {
    headers: { authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY },
  });
  if (!res.ok) return { key, status: "source-error", detail: `GET ${res.status}` };

  const body = Buffer.from(await res.arrayBuffer());
  if (body.length !== Number(row.size)) {
    // The DB's recorded size and the bytes actually served disagree; copying
    // would bake in whichever is wrong. Surface it rather than guessing.
    return { key, status: "size-mismatch-source", detail: `db=${row.size} got=${body.length}` };
  }

  await s3.put(key, body, row.mimetype ?? res.headers.get("content-type"));

  const check = await s3.head(key);
  if (!check || check.size !== body.length) {
    return { key, status: "verify-failed", detail: `expected=${body.length} got=${check?.size ?? "none"}` };
  }
  return { key, status: "copied", size: body.length };
}

async function main() {
  const rows = await listObjects();
  const orphans = rows.filter((r) => r.orphan);
  const work = rows.filter((r) => !r.orphan);

  console.log(`${APPLY ? "APPLY" : "DRY RUN"}${ONLY_PREFIX ? ` (prefix=${ONLY_PREFIX})` : ""}`);
  console.log(`source objects : ${rows.length}`);
  console.log(`skipping orphans: ${orphans.length}`);
  for (const o of orphans) console.log(`   orphan  ${o.bucket_id}/${o.name}`);
  console.log(`to process     : ${work.length}\n`);

  const results = [];
  for (let i = 0; i < work.length; i += CONCURRENCY) {
    const batch = work.slice(i, i + CONCURRENCY);
    results.push(...(await Promise.all(batch.map(copyOne))));
    process.stdout.write(`\r  processed ${Math.min(i + CONCURRENCY, work.length)}/${work.length}`);
  }
  console.log("\n");

  const byStatus = results.reduce((acc, r) => {
    (acc[r.status] ??= []).push(r);
    return acc;
  }, {});
  for (const [status, items] of Object.entries(byStatus)) {
    const bytes = items.reduce((n, r) => n + (r.size ?? 0), 0);
    console.log(`${status.padEnd(20)} ${String(items.length).padStart(4)}${bytes ? `  (${(bytes / 1024 / 1024).toFixed(1)} MB)` : ""}`);
  }

  const failures = results.filter((r) =>
    ["source-error", "size-mismatch-source", "verify-failed"].includes(r.status)
  );
  if (failures.length) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(`  ${f.status.padEnd(22)} ${f.key}  ${f.detail ?? ""}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
