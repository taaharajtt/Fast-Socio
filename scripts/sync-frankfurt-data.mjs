/**
 * Make Frankfurt's data an exact copy of Tokyo's.
 *
 *   node scripts/sync-frankfurt-data.mjs            # dry run — reports drift only
 *   node scripts/sync-frankfurt-data.mjs --apply    # perform the reload
 *
 * WHY FULL REPLACE RATHER THAN A DELTA
 *
 * A delta sync can only find rows that were INSERTED. If a post was edited, an
 * avatar changed, or a counter incremented on a row that already existed, a
 * row-count comparison shows no difference at all and the stale value survives.
 * "Exactly the current state of production" therefore means replacing each
 * table's contents, not topping them up.
 *
 * HOW IT AVOIDS NEEDING DATABASE PASSWORDS
 *
 * Both sides go through the Management API's SQL endpoint, so this needs only
 * SUPABASE_ACCESS_TOKEN. Rows move as JSON and are rebuilt with
 * json_populate_recordset(null::<table>, …), which casts every column using the
 * table's own row type — no hand-written per-column type handling to get wrong.
 *
 * SAFETY
 *
 *  - TOKYO IS READ-ONLY HERE. Only SELECTs are ever sent to it, and the target
 *    ref is asserted before any write. Tokyo is live production.
 *  - Triggers and FK checks are disabled for the load
 *    (session_replication_role = replica). Without this, re-inserting rows
 *    would fire notify triggers and manufacture notifications that never
 *    happened, and FK ordering would dictate a load order. It must be re-set in
 *    every request because each API call is its own session.
 *  - Every table is truncated in a SINGLE statement, because Postgres refuses
 *    to truncate a table referenced by a foreign key unless its dependents go
 *    with it.
 *  - rate_limit_events.id is an identity column: it is inserted with OVERRIDING
 *    SYSTEM VALUE and its sequence is re-set afterwards, or the first insert
 *    after cutover collides on a duplicate key.
 */

const TOKYO = "skgphoupbwdexfevgcnn";
const FRANKFURT = "xnbzenixmgghxsjpektp";
const APPLY = process.argv.includes("--apply");
const CHUNK = 400;

const token = (await import("node:fs")).readFileSync("D:/FastSocio/.env.local", "utf8")
  .split(/\r?\n/).find((l) => l.startsWith("SUPABASE_ACCESS_TOKEN="))
  .split("=").slice(1).join("=").replace(/^"|"$/g, "").trim();

async function sql(ref, query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`[${ref}] ${res.status}: ${text.slice(0, 400)}\n  SQL: ${query.slice(0, 200)}`);
  return JSON.parse(text);
}

/** Guard: nothing but SELECT may ever reach Tokyo. */
async function readTokyo(query) {
  if (!/^\s*select/i.test(query)) throw new Error("Refusing non-SELECT against Tokyo.");
  return sql(TOKYO, query);
}
async function writeFrankfurt(query) {
  return sql(FRANKFURT, query);
}

const REPLICA = "set session_replication_role = replica;";

/**
 * auth tables worth carrying across.
 *
 * users/identities are obvious — without them the newest signups exist in
 * `profiles` but cannot log in at all.
 *
 * sessions and refresh_tokens are included deliberately: leaving them behind
 * signs every user out at the moment of cutover. Tokyo-issued ACCESS tokens
 * will not verify against Frankfurt (different JWT secret), but a copied
 * refresh token still lets the client mint a fresh one, so live sessions
 * survive the move.
 */
const AUTH_TABLES = [
  "users", "identities", "sessions", "refresh_tokens",
  "mfa_factors", "one_time_tokens",
];

/**
 * The set of tables to replace, expanded to a transitive foreign-key closure.
 *
 * Hand-listing this is a trap: TRUNCATE refuses to run unless every table that
 * references one being truncated is included in the same statement, and the
 * auth schema has references that are easy to forget (mfa_challenges ->
 * mfa_factors is the one that caught me). Asking the catalog which tables point
 * at the set, and repeating until nothing new appears, cannot go stale.
 *
 * Everything pulled into the closure is also RELOADED, never just emptied —
 * truncating a table without refilling it would silently discard data.
 */
async function tableList() {
  const base = await readTokyo(`
    select n.nspname as s, c.relname as t
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'r'
      and (n.nspname = 'public'
           or (n.nspname = 'auth' and c.relname = any(array[${AUTH_TABLES.map((t) => `'${t}'`).join(",")}]))
           or (n.nspname = 'storage' and c.relname = 'objects'))
  `);
  const edges = await readTokyo(`
    select cn.nspname||'.'||cc.relname as child, pn.nspname||'.'||pc.relname as parent
    from pg_constraint k
    join pg_class cc on cc.oid = k.conrelid
    join pg_namespace cn on cn.oid = cc.relnamespace
    join pg_class pc on pc.oid = k.confrelid
    join pg_namespace pn on pn.oid = pc.relnamespace
    where k.contype = 'f'
      and cn.nspname in ('public','auth','storage')
      and pn.nspname in ('public','auth','storage')
  `);

  const set = new Set(base.map((r) => `${r.s}.${r.t}`));
  for (let changed = true; changed; ) {
    changed = false;
    for (const e of edges) {
      if (set.has(e.parent) && !set.has(e.child)) {
        set.add(e.child);
        changed = true;
      }
    }
  }

  const added = [...set].filter((k) => !base.some((r) => `${r.s}.${r.t}` === k));
  if (added.length) console.log(`FK closure pulled in ${added.length} extra table(s): ${added.join(", ")}`);

  return [...set]
    .map((key) => {
      const [schema, ...rest] = key.split(".");
      const name = rest.join(".");
      return { schema, name, q: `${schema}."${name}"`, key };
    })
    .sort((a, b) => {
      const rank = (s) => (s === "auth" ? 0 : s === "public" ? 1 : 2);
      return rank(a.schema) - rank(b.schema) || a.name.localeCompare(b.name);
    });
}

/**
 * Insertable columns per table, i.e. everything except GENERATED ALWAYS.
 *
 * `insert into t select * from json_populate_recordset(null::t, …)` is elegant
 * until a table has a generated column — Postgres rejects the whole statement
 * rather than ignoring the value. Three exist here (auth.users.confirmed_at,
 * auth.identities.email, storage.objects.path_tokens) and all three are OUTSIDE
 * the public schema, which is exactly why a public-only check for this hazard
 * came back clean. Naming the columns explicitly sidesteps it everywhere.
 */
async function insertableColumns(ref) {
  const rows = await sql(ref, `
    select table_schema||'.'||table_name as key,
           string_agg(quote_ident(column_name), ', ' order by ordinal_position) as cols
    from information_schema.columns
    where table_schema in ('public','auth','storage')
      and is_generated <> 'ALWAYS'
    group by 1
  `);
  return Object.fromEntries(rows.map((r) => [r.key, r.cols]));
}

/** Columns Postgres generates itself must be inserted with OVERRIDING SYSTEM VALUE. */
async function identityTables(ref, tables) {
  const rows = await sql(ref, `
    select table_schema||'.'||table_name as key
    from information_schema.columns
    where is_identity = 'YES'
      and table_schema in ('public','auth','storage')
    group by 1
  `);
  const set = new Set(rows.map((r) => r.key));
  return new Set(tables.filter((t) => set.has(t.key)).map((t) => t.key));
}

async function counts(ref, tables) {
  const parts = tables.map((t) => `select '${t.key}' as t, count(*)::int as n from ${t.q}`).join(" union all ");
  const rows = await sql(ref, parts);
  return Object.fromEntries(rows.map((r) => [r.t, r.n]));
}

async function copyTable(table, expected, hasIdentity, cols) {
  let offset = 0;
  let written = 0;
  while (offset < expected) {
    const rows = await readTokyo(
      `select coalesce(json_agg(x), '[]'::json)::text as j from (select * from ${table.q} order by ctid limit ${CHUNK} offset ${offset}) x`
    );
    const json = rows[0].j;
    if (json === "[]") break;

    // OVERRIDING SYSTEM VALUE is only valid where an identity column exists.
    const overriding = hasIdentity ? "overriding system value" : "";
    await writeFrankfurt(
      `${REPLICA} insert into ${table.q} (${cols}) ${overriding} ` +
      `select ${cols} from json_populate_recordset(null::${table.q}, $sync$${json}$sync$::json);`
    );

    const n = JSON.parse(json).length;
    written += n;
    offset += CHUNK;
    if (n < CHUNK) break;
  }
  return written;
}

async function main() {
  const tables = await tableList();
  const [tok, fra] = await Promise.all([counts(TOKYO, tables), counts(FRANKFURT, tables)]);

  const drift = tables
    .map((t) => ({ t: t.key, tokyo: tok[t.key] ?? 0, fra: fra[t.key] ?? 0 }))
    .filter((r) => r.tokyo !== r.fra);
  const totalRows = tables.reduce((n, t) => n + (tok[t.key] ?? 0), 0);

  console.log(`${APPLY ? "APPLY" : "DRY RUN"}  tables=${tables.length}  rows in Tokyo=${totalRows}`);
  console.log(`tables differing by row count: ${drift.length}`);
  for (const d of drift) console.log(`  ${d.t.padEnd(30)} tokyo ${String(d.tokyo).padStart(6)}   frankfurt ${String(d.fra).padStart(6)}`);
  console.log("\nNote: row counts cannot see edits to existing rows — every table is replaced regardless.\n");

  if (!APPLY) {
    console.log("Re-run with --apply to replace Frankfurt's data with Tokyo's.");
    return;
  }

  const identities = await identityTables(FRANKFURT, tables);
  const columns = await insertableColumns(FRANKFURT);

  // One statement: Postgres will not truncate a table referenced by an FK
  // unless its dependents are truncated in the same command. auth.users has
  // dependents in both auth and public, so they all have to go together.
  console.log(`truncating ${tables.length} tables across public/auth/storage…`);
  const list = tables.map((t) => t.q).join(", ");
  await writeFrankfurt(`${REPLICA} truncate table ${list};`);

  console.log("loading…");
  let done = 0;
  for (const t of tables) {
    const n = await copyTable(t, tok[t.key] ?? 0, identities.has(t.key), columns[t.key]);
    done++;
    process.stdout.write(`\r  ${done}/${tables.length}  ${t.key.padEnd(34)} ${n} rows        `);
  }
  console.log("\n");

  // EVERY sequence-backed column must be advanced past the loaded data, or the
  // next insert collides on a duplicate key.
  //
  // Do not narrow this to identity columns. auth.refresh_tokens.id is a plain
  // serial, and after a load its sequence sat at 44 against a max id of 1883 —
  // which would have made every token refresh fail, i.e. broken login for
  // everyone, at cutover. Ask pg_get_serial_sequence rather than reasoning
  // about which columns "should" be UUIDs.
  const seqCols = await writeFrankfurt(`
    select c.table_schema as s, c.table_name as t, c.column_name as col,
           pg_get_serial_sequence(c.table_schema||'.'||c.table_name, c.column_name) as seq
    from information_schema.columns c
    where c.table_schema in ('public','auth','storage')
      and pg_get_serial_sequence(c.table_schema||'.'||c.table_name, c.column_name) is not null
  `);
  for (const s of seqCols) {
    const [{ last_value, max_id }] = await writeFrankfurt(
      `select (select last_value from ${s.seq}) as last_value, (select max("${s.col}") from ${s.s}."${s.t}") as max_id`
    );
    await writeFrankfurt(
      `select setval('${s.seq}', coalesce((select max("${s.col}") from ${s.s}."${s.t}"), 1));`
    );
    console.log(`  sequence ${s.seq}: ${last_value} -> ${max_id ?? 1}`);
  }

  const after = await counts(FRANKFURT, tables);
  const bad = tables.map((t) => t.key).filter((k) => (after[k] ?? 0) !== (tok[k] ?? 0));
  console.log(bad.length === 0
    ? "VERIFIED: every table matches Tokyo's row count."
    : `MISMATCH after load in ${bad.length} table(s):`);
  for (const t of bad) console.log(`  ${t.padEnd(30)} tokyo ${tok[t]}  frankfurt ${after[t]}`);
  if (bad.length) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
