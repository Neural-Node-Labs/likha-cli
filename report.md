# Issue Report: Build Failures in `af-shared-contracts`

**Date:** 2026-07-25  
**Source:** `qqq.log`  
**Project:** `agent-factory/af-shared-contracts` (external to xcoder workspace)  
**Status:** ✅ Both errors resolved

---

## 1. Error Description

The log file `qqq.log` captured two sequential failures during a build attempt in the `af-shared-contracts` project. Both errors were recorded on 2026-07-25 within 22 seconds of each other.

### Error 1 — PowerShell Syntax Error (16:20:14.960Z)

**Command:**
```powershell
cd "C:\Users\sjnue\Documents\SJMN_WORKSPACE\Neural-Node-Labs\_sjmn_project\agent-factory\af-shared-contracts" && npm install 2>&1
```

**Output:**
```
At line:1 char:111
+ ... Node-Labs\_sjmn_project\agent-factory\af-shared-contracts" && npm ins ...
+                                                                ~~
The token '&&' is not a valid statement separator in this version.
    + CategoryInfo          : ParserError: (:) [], ParentContainsErrorRecordException
    + FullyQualifiedErrorId : InvalidEndOfLine
```

**Exit code:** 1

### Error 2 — TypeScript Compilation Error (16:20:36.736Z)

**Command:**
```powershell
cd "C:\Users\sjnue\Documents\SJMN_WORKSPACE\Neural-Node-Labs\_sjmn_project\agent-factory\af-shared-contracts"; npx tsc --noEmit 2>&1
```

**Output:**
```
src/engine/reasoning-engine.ts(2,34): error TS2307: Cannot find module './subtask-node' or its corresponding type declarations.
src/engine/reasoning-engine.ts(3,31): error TS2307: Cannot find module './dag-patch' or its corresponding type declarations.
```

**Exit code:** 1

---

## 2. Root Cause Analysis

### Error 1: PowerShell `&&` Chaining

| Attribute | Detail |
|-----------|--------|
| **Type** | Shell/runtime error |
| **Severity** | Blocker — prevents `npm install` from running |
| **Root cause** | The command used bash-style `&&` for statement chaining in Windows PowerShell 5.x. PowerShell 5.x only supports `;` as a statement separator. The `&&` operator is only available in PowerShell 7+. |
| **Impact** | `node_modules` was never installed, so no subsequent build or type-check could succeed. |

### Error 2: Incorrect TypeScript Import Paths

| Attribute | Detail |
|-----------|--------|
| **Type** | Build error (TS2307) |
| **Severity** | Blocker — TypeScript compilation fails |
| **File** | `src/engine/reasoning-engine.ts` (lines 2–3) |
| **Root cause** | The import statements referenced `./subtask-node` and `./dag-patch` as sibling modules within `src/engine/`, but the actual files reside in `src/plan/`. The correct relative paths are `../plan/subtask-node` and `../plan/dag-patch`. |
| **Impact** | `npx tsc --noEmit` fails with two TS2307 errors, blocking the build pipeline. |

### Cascading Relationship

The two errors were linked: Error 1 blocked `npm install`, so `node_modules` was absent. Once the shell syntax was corrected and dependencies installed, Error 2 surfaced during type-checking. Both needed to be fixed for a clean build.

---

## 3. Affected Files

| File | Role | Change Required |
|------|------|-----------------|
| `src/engine/reasoning-engine.ts` | Contains incorrect import paths | Fix lines 2–3 to use `../plan/subtask-node` and `../plan/dag-patch` |
| `src/plan/subtask-node.ts` | Target module (exists, no changes needed) | None — file is present and correct |
| `src/plan/dag-patch.ts` | Target module (exists, no changes needed) | None — file is present and correct |

No files in the xcoder workspace were affected. All changes are confined to the external `af-shared-contracts` project.

---

## 4. Proposed Fix Strategy

### Fix 1: Correct the Shell Command Syntax

**Change:** Replace `&&` with `;` in any PowerShell command that chains `cd` with another command.

**Before:**
```powershell
cd "C:\...\af-shared-contracts" && npm install 2>&1
```

**After:**
```powershell
cd "C:\...\af-shared-contracts"; npm install 2>&1
```

**Rationale:** `;` is the universal statement separator in all PowerShell versions (5.x and 7+). Using `;` ensures compatibility regardless of the host's PowerShell version.

### Fix 2: Correct the Import Paths in `reasoning-engine.ts`

**Change:** Update lines 2–3 of `src/engine/reasoning-engine.ts`.

**Before:**
```typescript
import type { SubtaskNode } from "./subtask-node";
import type { DagPatch } from "./dag-patch";
```

**After:**
```typescript
import type { SubtaskNode } from "../plan/subtask-node";
import type { DagPatch } from "../plan/dag-patch";
```

**Rationale:** The modules `subtask-node.ts` and `dag-patch.ts` live in `src/plan/`, not `src/engine/`. The relative import from `src/engine/reasoning-engine.ts` must traverse up one directory (`..`) and into `plan/`.

---

## 5. Verification

After applying both fixes, the following verification steps should pass:

1. **Dependency installation:**
   ```powershell
   cd "C:\...\af-shared-contracts"; npm install
   ```
   Expected: exit code 0, `node_modules` populated.

2. **TypeScript type-check:**
   ```powershell
   cd "C:\...\af-shared-contracts"; npx tsc --noEmit
   ```
   Expected: exit code 0, zero errors.

### Current Verification Results (Post-Fix)

All checks were re-executed on 2026-07-25 to confirm the fixes are in place.

| Check | Result | Evidence |
|-------|--------|----------|
| `node_modules` exists | ✅ Confirmed | `Test-Path` returns `True` |
| `src/plan/subtask-node.ts` exists | ✅ Confirmed | `Test-Path` returns `True` |
| `src/plan/dag-patch.ts` exists | ✅ Confirmed | `Test-Path` returns `True` |
| `reasoning-engine.ts` imports correct | ✅ Confirmed | Lines 2–3 read `"../plan/subtask-node"` and `"../plan/dag-patch"` |
| `npx tsc --noEmit` | ✅ Exit 0, zero errors | Command completed with exit code 0 and empty stderr/stdout (no errors) |

**Verification command output (2026-07-25):**

```
PS> Test-Path "...\af-shared-contracts\node_modules"
True

PS> Test-Path "...\af-shared-contracts\src\plan\subtask-node.ts"
True

PS> Test-Path "...\af-shared-contracts\src\plan\dag-patch.ts"
True

PS> Get-Content "...\src\engine\reasoning-engine.ts" -Head 3
import type { TaskSpec } from "../task/task-spec";
import type { SubtaskNode } from "../plan/subtask-node";
import type { DagPatch } from "../plan/dag-patch";

PS> cd "...\af-shared-contracts"; npx tsc --noEmit 2>&1
(exit code 0, no output — zero TypeScript errors)
```

---

## 6. Prevention Recommendations

1. **Use `;` for PowerShell command chaining** — Avoid `&&` in any script or tool command that may run on PowerShell 5.x hosts. Prefer `;` for universal compatibility.

2. **Run `tsc --noEmit` as a pre-commit hook** — This would catch missing module imports before they reach the build pipeline.

3. **Add an `npm run build` or `npm run check` script** — A single command that runs both install and type-check would make the build process more robust and less dependent on correct shell syntax from the caller.

---

*Report generated from analysis of `qqq.log` (Phase 1) and root cause investigation (Phase 2).*
