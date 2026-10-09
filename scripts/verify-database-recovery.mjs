import { spawn } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { PrismaClient, Prisma } from "@prisma/client";
import * as Y from "yjs";
import { collaborationRoom } from "../lib/collaboration-protocol.mjs";
import { requireDrillUri, digest, assertRecoveryInventory, assertArchiveDigest } from "./recovery-policy.mjs";

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const reportPath = path.resolve("reports/recovery-drill.json");
const nonce = randomBytes(8).toString("hex");
const replicaSet = `liveide-recovery-${nonce}`;
const mongod = process.env.RECOVERY_MONGOD || (process.platform === "win32" ? "C:/Program Files/MongoDB/Server/8.2/bin/mongod.exe" : "mongod");
const tool = name => process.env.RECOVERY_TOOLS_DIR ? path.join(process.env.RECOVERY_TOOLS_DIR, name + (process.platform === "win32" ? ".exe" : "")) : name;
const client = uri => new PrismaClient({ datasourceUrl: uri });
const alive = child => child && child.exitCode === null && child.signalCode === null;
const tree = text => ({ folderName: "Root", items: [{ filename: "App", fileExtension: "tsx", content: text }, { folderName: "empty", items: [] }] });
const checkpoint = text => {
  const doc = new Y.Doc(); doc.getText("content").insert(0, text);
  const encoded = Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64"); doc.destroy(); return encoded;
};

async function command(executable, args, options = {}) {
  const child = spawn(executable, args, { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], ...options });
  let stdout = "", stderr = "";
  child.stdout.on("data", chunk => { stdout = (stdout + chunk).slice(-1000000); });
  child.stderr.on("data", chunk => { stderr = (stderr + chunk).slice(-1000000); });
  const timer = setTimeout(() => child.kill("SIGKILL"), 120_000);
  try {
    const [code] = await once(child, "exit");
    if (code !== 0) {
      // Commands in this harness receive only anonymous loopback fixture URIs.
      await writeFile(path.resolve("reports/recovery-drill-error.log"), `${path.basename(executable)}\n${stdout}\n${stderr}`).catch(() => {});
      throw new Error(`Recovery command failed: ${path.basename(executable)} (exit ${code}); see reports/recovery-drill-error.log`);
    }
    return { stdout, stderr };
  } finally { clearTimeout(timer); }
}

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function inventory(database) {
  const models = [...Prisma.dmmf.datamodel.models].sort((a, b) => a.name.localeCompare(b.name));
  const collections = await database.$runCommandRaw({ listCollections: 1, nameOnly: true });
  const actualNames = collections.cursor.firstBatch.map(item => item.name).sort();
  if (digest(actualNames) !== digest(models.map(model => model.dbName || model.name).sort())) throw new Error("Database collection coverage differs from the Prisma schema");
  const result = {};
  for (const model of models) {
    const collection = model.dbName || model.name;
    const records = await database[model.name[0].toLowerCase() + model.name.slice(1)].findMany({ orderBy: { id: "asc" } });
    const raw = await database.$runCommandRaw({ find: collection, filter: {}, sort: { _id: 1 }, batchSize: 1000 });
    if (raw.cursor.firstBatch.length !== records.length) throw new Error("Inventory exceeds the bounded fixture batch");
    const indexes = await database.$runCommandRaw({ listIndexes: collection });
    const indexSpecs = indexes.cursor.firstBatch.map(({ name, key, v, unique = false, sparse = false, partialFilterExpression, expireAfterSeconds, collation }) => ({
      name, key: Object.entries(key), v, unique, sparse, ...(partialFilterExpression ? { partialFilterExpression } : {}),
      ...(expireAfterSeconds !== undefined ? { expireAfterSeconds } : {}), ...(collation ? { collation } : {}),
    })).sort((a, b) => a.name.localeCompare(b.name));
    result[collection] = { documents: records.length, rawBsonJsonHash: digest(raw.cursor.firstBatch), prismaReadHash: digest(records), indexes: indexSpecs.length, indexHash: digest(indexSpecs) };
  }
  return result;
}

async function seed(database) {
  await database.$transaction(async tx => {
    for (const [id, name] of [["owner", "Owner"], ["editor", "Editor"], ["viewer", "Viewer"]]) await tx.user.create({ data: { id: `recovery-${id}`, name, email: `${id}@recovery.invalid` } });
    await tx.account.create({ data: { id: "recovery-account", userId: "recovery-owner", type: "oauth", provider: "github", providerAccountId: "fixture-only", accessToken: "synthetic-token-only" } });
    await tx.gitHubConnection.create({ data: { id: "recovery-connection", userId: "recovery-owner", version: "fixture-version", encryptedToken: "synthetic-encrypted-envelope", login: "fixture-owner", writeEnabled: false } });
    for (const [id, template, version, content] of [
      ["native", "REACT", 3, tree("saved v3 😀\n")], ["legacy", "NEXTJS", 8, JSON.stringify(tree("legacy saved v8"))],
    ]) {
      await tx.playground.create({ data: { id: `recovery-${id}`, title: `Recovery ${id}`, template, userId: "recovery-owner", collaborationRevision: id === "native" ? 3 : 1 } });
      await tx.templateFile.create({ data: { id: `recovery-tree-${id}`, playgroundId: `recovery-${id}`, version, content } });
    }
    for (const [id, kind, version] of [["original", "MANUAL", 1], ["safety", "RESTORE_POINT", 2]]) await tx.playgroundSnapshot.create({ data: {
      id: `recovery-snapshot-${id}`, playgroundId: "recovery-native", name: id, kind, templateVersion: version, content: tree(`saved v${version}`), createdById: "recovery-owner", createdByName: "Owner",
    } });
    await tx.playgroundHistoryEvent.create({ data: { id: "recovery-created", playgroundId: "recovery-native", type: "SNAPSHOT_CREATED", actorId: "recovery-owner", actorName: "Owner", snapshotId: "recovery-snapshot-original", snapshotName: "original", snapshotVersion: 1 } });
    await tx.playgroundHistoryEvent.create({ data: { id: "recovery-restored", playgroundId: "recovery-native", type: "SNAPSHOT_RESTORED", actorId: "recovery-owner", actorName: "Owner", snapshotId: "recovery-snapshot-original", snapshotName: "original", snapshotVersion: 1, previousVersion: 2, resultingVersion: 3, restorePointId: "recovery-snapshot-safety", restorePointName: "safety", collaborationRevision: 3 } });
    // Audit references to explicitly deleted snapshots must survive recovery too.
    await tx.playgroundHistoryEvent.create({ data: { id: "recovery-deleted", playgroundId: "recovery-native", type: "SNAPSHOT_DELETED", actorId: "recovery-owner", actorName: "Owner", snapshotId: "deleted-before-backup", snapshotName: "Earlier removed copy", snapshotVersion: 1 } });
    for (const [filePath, revision, text] of [["App.tsx", 3, "saved v3 😀\n + checkpoint edits"], [".liveide/notes", 1, "# Recovered team notes"]]) await tx.collaborationDocument.create({ data: { playgroundId: "recovery-native", filePath, room: collaborationRoom("recovery-native", filePath, revision), state: checkpoint(text) } });
    for (const [id, role] of [["editor", "EDITOR"], ["viewer", "VIEWER"]]) await tx.playgroundMember.create({ data: { id: `recovery-member-${id}`, playgroundId: "recovery-native", userId: `recovery-${id}`, role } });
    await tx.playgroundInvitation.create({ data: { id: "recovery-invitation", playgroundId: "recovery-native", role: "VIEWER", tokenHash: digest("synthetic-invitation"), createdById: "recovery-owner", expiresAt: new Date(Date.now() + 86400000) } });
    await tx.starMark.create({ data: { id: "recovery-star", playgroundId: "recovery-native", userId: "recovery-owner", isMarked: true } });
    await tx.chatMessage.create({ data: { id: "recovery-chat", playgroundId: "recovery-native", userId: "recovery-owner", role: "user", content: "Synthetic recovery chat" } });
    await tx.gitHubCommitOperation.create({ data: { id: "recovery-operation", playgroundId: "recovery-native", userId: "recovery-owner", connectionVersion: "fixture-version", status: "PREPARED", payload: { fixtureOnly: true } } });
    await tx.playground.update({ where: { id: "recovery-native" }, data: { githubCommitLock: "recovery-operation", githubSource: { owner: "fixture-owner", repository: "fixture-repository", branch: "main" } } });
  });
}

let root, server, admin, source, restored;
let phase = "prerequisites";
const began = performance.now();
const report = { formatVersion: 1, status: "running", startedAt: new Date().toISOString(), method: "Quiesced single-database BSON archive; isolated loopback replica set; no oplog replay or production credentials", checks: {} };
async function startServer(port, dbpath) {
  const child = spawn(mongod, ["--bind_ip", "127.0.0.1", "--port", String(port), "--replSet", replicaSet, "--dbpath", dbpath, "--logpath", path.join(root, "mongod.log"), "--logappend", "--wiredTigerCacheSizeGB", "0.25"], { windowsHide: true, shell: false, stdio: "ignore" });
  let startError;
  child.on("error", error => { startError = error; });
  server = child;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (startError || !alive(child)) throw new Error("Disposable MongoDB server failed to start");
    try { await admin.$runCommandRaw({ ping: 1 }); return; } catch { await delay(100); }
  }
  throw new Error("Disposable MongoDB server readiness timed out");
}
async function stopServer() {
  if (!alive(server)) return;
  const child = server, ended = once(child, "exit");
  const timeout = setTimeout(() => child.kill("SIGKILL"), 10_000);
  try {
    // Graceful shutdown is confined to the exact child replica set we created.
    try { await admin.$runCommandRaw({ shutdown: 1, force: true }); } catch { /* MongoDB closes the command connection during shutdown. */ }
    await ended;
  } finally { clearTimeout(timeout); }
}

try {
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  const versions = await Promise.all([command(mongod, ["--version"]), command(tool("mongodump"), ["--version"]), command(tool("mongorestore"), ["--version"])]);
  report.versions = { node: process.version, platform: process.platform, mongodb: versions[0].stdout.split("\n")[0].trim(), dump: versions[1].stdout.split("\n")[0].trim(), restore: versions[2].stdout.split("\n")[0].trim() };
  root = await mkdtemp(path.join(os.tmpdir(), "liveide-recovery-"));
  const dbpath = path.join(root, "data"); await mkdir(dbpath);
  const port = await availablePort();
  const uri = kind => `mongodb://127.0.0.1:${port}/liveide_recovery_${nonce}_${kind}?directConnection=true&replicaSet=${replicaSet}&serverSelectionTimeoutMS=2000`;
  const sourceUri = uri("source"), restoredUri = uri("restored");
  const sourceName = requireDrillUri(sourceUri, "source").database;
  const restoredName = requireDrillUri(restoredUri, "restored").database;
  admin = client(`mongodb://127.0.0.1:${port}/admin?directConnection=true&serverSelectionTimeoutMS=1000`);
  phase = "replica-set-start"; console.log("Starting a disposable MongoDB replica set.");
  await startServer(port, dbpath);
  await admin.$runCommandRaw({ replSetInitiate: { _id: replicaSet, members: [{ _id: 0, host: `127.0.0.1:${port}` }] } });
  const deadline = Date.now() + 30_000;
  while (!(await admin.$runCommandRaw({ hello: 1 })).isWritablePrimary) { if (Date.now() > deadline) throw new Error("Replica set election timed out"); await delay(100); }
  source = client(sourceUri); restored = client(restoredUri);
  phase = "schema-and-fixtures";
  await command(process.execPath, ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"], { env: { ...process.env, DATABASE_URL: sourceUri } });
  await seed(source);
  const baseline = await inventory(source);
  report.collections = baseline;
  report.totalDocuments = Object.values(baseline).reduce((sum, item) => sum + item.documents, 0);
  const backupPoint = new Date();
  const archive = path.join(root, "fixture.archive.gz");
  phase = "backup"; console.log("Backing up all fixture collections and indexes with writes paused.");
  const backupStarted = performance.now();
  await command(tool("mongodump"), ["--uri", sourceUri, "--archive=" + archive, "--gzip", "--quiet"]);
  report.backupMs = Math.round(performance.now() - backupStarted);
  const archiveHash = createHash("sha256").update(await readFile(archive)).digest("hex");
  report.archive = { bytes: (await stat(archive)).size, sha256: archiveHash };
  report.backupPointAt = backupPoint.toISOString();
  phase = "post-backup-loss";
  await source.$transaction(async tx => {
    await tx.templateFile.update({ where: { playgroundId: "recovery-native" }, data: { content: tree("post-backup change"), version: { increment: 1 } } });
    await tx.collaborationDocument.update({ where: { room: collaborationRoom("recovery-native", "App.tsx", 3) }, data: { state: checkpoint("post-backup checkpoint") } });
  });
  const incident = new Date();
  report.incidentAt = incident.toISOString();
  report.observedBackupAgeAtIncidentMs = incident.getTime() - backupPoint.getTime();
  report.intentionalPostBackupChanges = 2;
  // This is the database on our own spawned server, never DATABASE_URL.
  requireDrillUri(sourceUri, "source");
  await source.$runCommandRaw({ dropDatabase: 1 });
  phase = "restore"; console.log("Restoring into a separate empty disposable database.");
  const recoveryStarted = performance.now();
  const existing = await restored.$runCommandRaw({ listCollections: 1, nameOnly: true });
  if (existing.cursor.firstBatch.length) throw new Error("Recovery target must be empty");
  assertArchiveDigest(archiveHash, createHash("sha256").update(await readFile(archive)).digest("hex"));
  const restoreStarted = performance.now();
  await command(tool("mongorestore"), ["--uri", restoredUri, "--archive=" + archive, "--gzip", "--nsInclude=" + sourceName + ".*", "--nsFrom=" + sourceName + ".*", "--nsTo=" + restoredName + ".*", "--stopOnError", "--quiet"]);
  report.restoreMs = Math.round(performance.now() - restoreStarted);
  assertRecoveryInventory(baseline, await inventory(restored));
  report.checks.documentsAndIndexesMatch = true;
  // Verify durability through a graceful server restart before application mutations.
  phase = "restart-durability";
  await Promise.all([source.$disconnect(), restored.$disconnect()]);
  await stopServer(); await admin.$disconnect();
  admin = client(`mongodb://127.0.0.1:${port}/admin?directConnection=true&serverSelectionTimeoutMS=1000`);
  await startServer(port, dbpath);
  const restartDeadline = Date.now() + 30_000;
  while (!(await admin.$runCommandRaw({ hello: 1 })).isWritablePrimary) { if (Date.now() > restartDeadline) throw new Error("Restart election timed out"); await delay(100); }
  restored = client(restoredUri);
  assertRecoveryInventory(baseline, await inventory(restored));
  report.checks.survivesServerRestart = true;
  phase = "application-verification"; console.log("Verifying recovered access, Yjs hydration, and atomic snapshot restoration through application code.");
  const applicationReportPath = path.join(root, "application-results.json");
  await command(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "tests/recovery-mongodb.test.ts", "--maxWorkers=1", "--reporter=json", "--outputFile=" + applicationReportPath], { env: { ...process.env, RECOVERY_DRILL_URI: restoredUri, RECOVERY_DRILL_RUN: nonce, ENABLE_MOCK_DB: "false" } });
  const applicationReport = JSON.parse(await readFile(applicationReportPath, "utf8"));
  if (applicationReport.numPassedTests !== 5 || applicationReport.numFailedTests !== 0 || applicationReport.numPendingTests !== 0) throw new Error("All five real MongoDB application checks must pass");
  report.checks.applicationChecksPassed = 5;
  report.recoveryAndVerificationMs = Math.round(performance.now() - recoveryStarted);
  report.checks.postBackupChangesAbsent = true; // Exact baseline match proves exclusion of both later writes.
  report.status = "passed";
  report.completedAt = new Date().toISOString();
  report.totalDrillMs = Math.round(performance.now() - began);
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  console.log(`Recovery drill passed: ${report.totalDocuments} documents across ${Object.keys(baseline).length} collections; restore ${report.restoreMs}ms; recovery plus verification ${report.recoveryAndVerificationMs}ms.`);
  console.log("Content-free report: reports/recovery-drill.json");
} catch (error) {
  report.status = "failed"; report.failedPhase = phase; report.error = error instanceof Error ? error.message : "Recovery drill failed";
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n").catch(() => {});
  console.error(`Recovery drill failed during ${phase}. See reports/recovery-drill.json.`);
  process.exitCode = 1;
} finally {
  try {
    await Promise.allSettled([source?.$disconnect(), restored?.$disconnect()]);
    await stopServer();
    await admin?.$disconnect();
    report.checks.disposableServerStopped = !alive(server);
    // mkdtemp creates this exact owned directory; no caller-supplied path is deleted.
    if (root) {
      if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith("liveide-recovery-")) throw new Error("Recovery temporary path ownership check failed");
      await rm(root, { recursive: true, force: true });
    }
    report.checks.temporaryDataRemoved = true;
  } catch {
    if (alive(server)) server.kill("SIGKILL");
    report.status = "failed"; report.failedPhase = "cleanup";
    report.error = "Disposable recovery resources could not be cleaned up";
    process.exitCode = 1;
  }
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n").catch(() => {});
}
