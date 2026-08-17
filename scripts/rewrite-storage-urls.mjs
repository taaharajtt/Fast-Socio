/**
 * Rewrite stored Supabase Storage URLs to their Contabo equivalents.
 *
 *   node scripts/rewrite-storage-urls.mjs           # dry run — counts + samples
 *   node scripts/rewrite-storage-urls.mjs --apply   # perform the UPDATEs
 *
 * Runs against FRANKFURT ONLY. Tokyo is live production and is never written
 * to by this script — there is a hard guard below, because pointing production
 * at a bucket the public cannot read yet would break every image on the site.
 *
 * Scope is narrow by design. A prior audit established, and a direct query
 * confirmed, that:
 *   - only 6 columns hold full storage URLs (162 rows at audit time),
 *   - every one shares a single host prefix, and
 *   - NOT ONE contains `/render/image/`,
 * so this is a mechanical prefix swap rather than a URL parse. `messages.
 * attachment_url` is deliberately untouched: it stores bare paths, not URLs.
 */
import { loadEnv } from "./lib/s3.mjs";

const env = loadEnv();
const APPLY = process.argv.includes("--apply");

const FRANKFURT_REF = "xnbzenixmgghxsjpektp";
const TOKYO_REF = "skgphoupbwdexfevgcnn";
const TARGET = process.env.TARGET_REF ?? FRANKFURT_REF;

if (TARGET === TOKYO_REF) {
  console.error("Refusing to run against Tokyo: it is live production.");
  process.exit(1);
}

/**
 * BOTH Supabase hosts have to be rewritten, not just one.
 *
 * The Frankfurt clone rewrote every stored URL to its own host, so rows already
 * there carry the Frankfurt prefix. But rows that arrive later via the cutover
 * delta-sync come straight from Tokyo and still carry the Tokyo prefix. A
 * rewrite that handled only one host would leave the other silently pointing at
 * Supabase — images would keep working right up until the old stack is retired,
 * which is the worst possible time to discover it.
 */
const OLD_PREFIXES = [
  `https://${TOKYO_REF}.supabase.co/storage/v1/object/public/`,
  `https://${FRANKFURT_REF}.supabase.co/storage/v1/object/public/`,
];
const NEW_PREFIX = `${env.NEXT_PUBLIC_CONTABO_PUBLIC_BASE_URL.replace(/\/$/, "")}/`;

// column -> table. Derived from the live schema scan, not guessed.
const TARGETS = [
  ["profiles", "avatar_url"],
  ["profiles", "cover_url"],
  ["communities", "avatar_url"],
  ["communities", "cover_url"],
  ["posts", "image_url"],
  ["events", "cover_url"],
];

async function query(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${TARGET}/database/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) throw new Error(`query failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function main() {
  console.log(`${APPLY ? "APPLY" : "DRY RUN"}  target=${TARGET}`);
  for (const p of OLD_PREFIXES) console.log(`  ${p}`);
  console.log(`->${NEW_PREFIX}\n`);

  let total = 0;
  for (const [table, column] of TARGETS) {
    const counts = [];
    for (const oldPrefix of OLD_PREFIXES) {
      const [{ n }] = await query(
        `select count(*)::int as n from ${table} where ${column} like '${oldPrefix}%'`
      );
      counts.push(n);
      total += n;

      if (APPLY && n > 0) {
        await query(
          `update ${table} set ${column} = replace(${column}, '${oldPrefix}', '${NEW_PREFIX}') where ${column} like '${oldPrefix}%'`
        );
      }
    }

    // A row that already carries the new prefix means a previous run got this
    // far; report it so a partial run is legible rather than looking like a
    // shortfall.
    const [{ done }] = await query(
      `select count(*)::int as done from ${table} where ${column} like '${NEW_PREFIX}%'`
    );

    console.log(
      `${`${table}.${column}`.padEnd(28)} tokyo ${String(counts[0]).padStart(4)}   frankfurt ${String(counts[1]).padStart(4)}   already-contabo ${String(done).padStart(4)}`
    );
  }

  console.log(`\ntotal rows ${APPLY ? "rewritten" : "to rewrite"}: ${total}`);

  if (!APPLY) {
    for (const oldPrefix of OLD_PREFIXES) {
      const [sample] = await query(
        `select avatar_url from profiles where avatar_url like '${oldPrefix}%' limit 1`
      );
      if (sample?.avatar_url) {
        console.log(`\nsample before: ${sample.avatar_url}`);
        console.log(`sample after : ${sample.avatar_url.replace(oldPrefix, NEW_PREFIX)}`);
      }
    }
    console.log("\nRe-run with --apply to perform the rewrite.");
  }

  // Leftovers on any Supabase host mean the column list is incomplete.
  const [{ stragglers }] = await query(
    `select (${TARGETS.map(([t, c]) => `(select count(*) from ${t} where ${c} like '%supabase.co/storage/%')`).join(" + ")})::int as stragglers`
  );
  console.log(`rows still pointing at Supabase after this run: ${stragglers}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
