import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

export interface StoredProject {
  id: string;
  name: string;
  path: string;
  active: boolean;
  includeInLlm: boolean;
  createdAt: string;
}

const STORE_PATH = path.join(os.homedir(), ".xcoder", "projects.json");

/**
 * Every project workspace lives under this single, guaranteed-writable root instead of
 * wherever the user happened to type. Letting people type an arbitrary path (an absolute
 * Windows path copied from their own machine, a host path that doesn't exist inside the
 * container, a directory the process's user doesn't own, etc.) is exactly what produced
 * "unauthorized to create directory" errors. Now a project only ever needs a name — the
 * folder is always created at PROJECTS_ROOT/<slug>.
 *
 * Override with XCODER_PROJECTS_ROOT if projects should live somewhere else (e.g. a mounted
 * volume in production). Defaults to ./workspace relative to the server's cwd.
 */
export const PROJECTS_ROOT = path.resolve(
  process.env.XCODER_PROJECTS_ROOT || path.join(process.cwd(), "workspace")
);

function ensureProjectsRoot(): void {
  fs.mkdirSync(PROJECTS_ROOT, { recursive: true });
}

/** Turns a project name into a filesystem-safe folder name: lowercase, anything that isn't
 *  a-z/0-9 collapsed to a single hyphen, leading/trailing hyphens trimmed. Falls back to
 *  "project" if nothing usable survives (e.g. a name that's all emoji/punctuation). */
function slugify(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "project";
}

/** Appends -2, -3, ... until the folder name doesn't collide with another stored project's
 *  folder or a directory already sitting on disk from a previous run. */
function uniqueSlug(base: string, taken: Set<string>): string {
  const isFree = (candidate: string) => !taken.has(candidate) && !fs.existsSync(path.join(PROJECTS_ROOT, candidate));
  if (isFree(base)) return base;
  let n = 2;
  while (!isFree(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

function load(): StoredProject[] {
  if (!fs.existsSync(STORE_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, "utf-8"));
  } catch {
    return []; // corrupt store shouldn't take the whole API down
  }
}

function save(projects: StoredProject[]): void {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(projects, null, 2), "utf-8");
}

export function listProjects(): StoredProject[] {
  return load();
}

export function getProject(id: string): StoredProject | undefined {
  return load().find((p) => p.id === id);
}

export interface AddProjectResult {
  project?: StoredProject;
  error?: string;
  /** True when the directory didn't exist yet and was created as part of this call, so callers
   *  can tell the user rather than silently creating folders on their filesystem. In practice
   *  this is now always true for a brand-new project, since the folder is freshly minted under
   *  PROJECTS_ROOT every time. */
  created?: boolean;
}

/** Creates a new project. The workspace folder is always PROJECTS_ROOT/<slug-of-name> — never
 *  a path the caller supplies — which is what makes this safe to call without any filesystem
 *  permissions surprises. */
export function addProject(name: string): AddProjectResult {
  const trimmedName = name.trim();
  if (!trimmedName) return { error: "Project name is required" };

  const projects = load();
  if (projects.some((p) => p.name.toLowerCase() === trimmedName.toLowerCase())) {
    return { error: `A project named "${trimmedName}" already exists` };
  }

  try {
    ensureProjectsRoot();
  } catch (err) {
    return { error: `Could not create projects root at ${PROJECTS_ROOT}: ${err instanceof Error ? err.message : String(err)}` };
  }

  const takenSlugs = new Set(projects.map((p) => path.basename(p.path)));
  const slug = uniqueSlug(slugify(trimmedName), takenSlugs);
  const projectPath = path.join(PROJECTS_ROOT, slug);

  try {
    fs.mkdirSync(projectPath, { recursive: true });
  } catch (err) {
    return { error: `Could not create workspace directory: ${err instanceof Error ? err.message : String(err)}` };
  }

  const project: StoredProject = {
    id: crypto.randomUUID(),
    name: trimmedName,
    path: projectPath,
    active: projects.length === 0, // first project added becomes active by default
    includeInLlm: false,
    createdAt: new Date().toISOString(),
  };
  projects.push(project);
  save(projects);
  return { project, created: true };
}

export interface UpdateProjectInput {
  name?: string;
  includeInLlm?: boolean;
}

/** Renaming a project only changes its display name — the workspace folder on disk keeps its
 *  original slug. (Renaming the folder too would mean rewriting `path` mid-run for anything
 *  that might currently be operating against it; safer to leave it put.) */
export function updateProject(id: string, updates: UpdateProjectInput): AddProjectResult {
  const projects = load();
  const project = projects.find((p) => p.id === id);
  if (!project) return { error: "Project not found" };

  if (updates.name !== undefined) {
    const trimmedName = updates.name.trim();
    if (!trimmedName) return { error: "Project name is required" };
    if (projects.some((p) => p.id !== id && p.name.toLowerCase() === trimmedName.toLowerCase())) {
      return { error: `A project named "${trimmedName}" already exists` };
    }
    project.name = trimmedName;
  }
  if (updates.includeInLlm !== undefined) project.includeInLlm = updates.includeInLlm;

  save(projects);
  return { project };
}

export function setActiveProject(id: string): AddProjectResult {
  const projects = load();
  const target = projects.find((p) => p.id === id);
  if (!target) return { error: "Project not found" };
  for (const p of projects) p.active = p.id === id;
  save(projects);
  return { project: target };
}

export function deleteProject(id: string): { deleted: boolean; error?: string } {
  const projects = load();
  const index = projects.findIndex((p) => p.id === id);
  if (index === -1) return { deleted: false, error: "Project not found" };
  const [removed] = projects.splice(index, 1);
  // If the active project was removed, promote another one so there's always an active
  // project when at least one exists (matches the single-active-project UI expectation).
  if (removed.active && projects.length > 0) projects[0].active = true;
  save(projects);
  return { deleted: true };
}

