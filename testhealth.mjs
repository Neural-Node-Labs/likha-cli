import { startServerAndCheckHealth } from "./dist/core/serverHealthCheck.js";

console.log("--- Case A: genuinely working server ---");
const good = await startServerAndCheckHealth("/tmp/health-test-good", "node server.js", 4001, "/health", { timeoutMs: 4000 });
console.log(JSON.stringify(good));
if (!good.responded || good.statusCode !== 200) throw new Error("FAIL: should detect a genuinely working server");

console.log("--- Case B: server that crashes on startup ---");
const broken = await startServerAndCheckHealth("/tmp/health-test-broken", "node server.js", 4002, "/health", { timeoutMs: 3000 });
console.log(JSON.stringify(broken));
if (broken.responded) throw new Error("FAIL: should NOT report success for a crashing server");

console.log("--- Case C: process runs but never actually listens ---");
const hang = await startServerAndCheckHealth("/tmp/health-test-hang", "node server.js", 4003, "/health", { timeoutMs: 2000 });
console.log(JSON.stringify(hang));
if (hang.responded) throw new Error("FAIL: should NOT report success for a process that never actually serves");

console.log("PASS: health-check helper correctly distinguishes a genuinely working server from a crash and from a hollow non-serving process");


