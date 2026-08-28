/**
 * Multi-process launcher for the Next.js standalone server.
 *
 * Why this exists: `node server.js` is ONE process, and Node runs JavaScript on
 * one thread. On a 4 vCPU box that meant every server render — and, because
 * every <Link> prefetched by default, most requests were renders — queued behind
 * a single core. Measured on production: the app container sat at ~112% CPU with
 * p95 route latency of 2-3s and a tail past 13s, while three cores idled.
 *
 * Node's cluster module solves exactly this: the primary creates the listening
 * socket and hands connections to workers, so all of them share PORT with no
 * proxy changes and no per-worker ports.
 *
 * Deliberately NOT `os.availableParallelism()`: inside a container that reports
 * the HOST's core count and ignores the cgroup CPU limit, so it would happily
 * fork 4 workers into a 3-core quota and make things worse. WEB_CONCURRENCY is
 * set explicitly in docker-compose.yml next to the cpu limit it has to match.
 *
 * Each worker is a full Next runtime (~450 MB RSS), so worker count is bounded
 * by the container memory limit as much as by CPU.
 */
const cluster = require("node:cluster");

const workers = Math.max(1, Number(process.env.WEB_CONCURRENCY) || 1);

// One worker: skip the primary entirely rather than paying an idle supervisor
// process and an extra ~50 MB. This keeps single-core environments (and local
// `docker run` debugging) behaving exactly as they did before.
if (!cluster.isPrimary || workers === 1) {
  require("./server.js");
} else {
  let shuttingDown = false;

  for (let i = 0; i < workers; i++) cluster.fork();

  // A worker that dies while we are serving traffic is replaced. Without this,
  // one OOM or uncaught exception would permanently reduce capacity and the
  // container would stay "healthy" — the remaining workers still answer the
  // healthcheck — so the degradation would be invisible.
  cluster.on("exit", (worker, code, signal) => {
    if (shuttingDown) return;
    console.error(
      `[cluster] worker ${worker.process.pid} exited (code=${code} signal=${signal}); restarting`
    );
    cluster.fork();
  });

  // Docker sends SIGTERM to PID 1 only. Without forwarding it the workers keep
  // running until the 10s kill timeout, turning every deploy into a hard kill
  // of in-flight requests instead of a graceful drain.
  for (const sig of ["SIGTERM", "SIGINT"]) {
    process.on(sig, () => {
      shuttingDown = true;
      for (const worker of Object.values(cluster.workers ?? {})) {
        worker.process.kill(sig);
      }
    });
  }
}
