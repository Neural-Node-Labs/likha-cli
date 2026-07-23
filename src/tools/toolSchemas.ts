import { ToolSchema } from "../core/types.js";

export const TOOL_SCHEMAS: ToolSchema[] = [
    {
      type: "function",
      function:     {
      type: "function",
      function: {
        name: "clarification_tool",
        description:
          "Ask the user for clarification when the task requirements are ambiguous, incomplete, or contradictory. " +
          "Use this ONLY when you genuinely cannot proceed without more information — do not use it as a default behavior. " +
          "Examples of when to use: ambiguous requirements ("build a login system" without specifying auth method), " +
          "missing technology choices ("implement caching" without specifying Redis/Memcached/in-memory), " +
          "unclear constraints ("make it fast" without performance targets), " +
          "contradictory instructions ("use SQL but also be schema-less"), " +
          "or missing context ("fix the bug" without specifying which bug or where). " +
          "When you call this tool, execution pauses and the user's answer is injected back into your context so you can continue.",
        parameters: {
          type: "object",
          properties: {
            question: {
              type: "string",
              description: "The specific question you need answered to proceed. Be precise and actionable."
            },
            context: {
              type: "string",
              description: "Brief context explaining why you're asking and what you've already determined. Helps the user give a better answer."
            },
            options: {
              type: "array",
              items: { type: "string" },
              description: "Optional list of predefined options the user can choose from. Use when the decision is between known alternatives."
            },
          },
          required: ["question", "context"],
        },
      },
    },
{
        name: "conversation_tool",
        description: "Use this tool for casual conversation, greetings (hello, hi), or clarifying questions that do not require any file modifications or terminal command operations.",
        parameters: {
          type: "object",
          properties: {
            reply: {
              type: "string",
              description: "Your friendly greeting or conversational response directed to the user."
            },
          },
          required: ["reply"],
        },
      },
    },
  {
    type: "function",
    function: {
      name: "glob_tool",
      description: "Find files in the workspace matching a glob pattern, respecting .agentignore/.gitignore/.dockerignore.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Glob pattern, e.g. 'src/**/*.ts'" },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "grep_tool",
      description: "Search file contents by regex across the workspace, respecting ignore rules.",
      parameters: {
        type: "object",
        properties: {
          regex: { type: "string", description: "Regular expression to search for" },
          globPattern: { type: "string", description: "Glob to restrict the search to, defaults to '**/*'" },
        },
        required: ["regex"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_tool",
      description: "Read the full contents of a single file.",
      parameters: {
        type: "object",
        properties: {
          filePath: { type: "string", description: "Path to the file, relative to the workspace root" },
        },
        required: ["filePath"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_edit_tool",
      description:
        "Write a new file (mode='write') or perform a unique exact-match string replace on an existing file (mode='edit').",
      parameters: {
        type: "object",
        properties: {
          mode: { type: "string", description: "'write' or 'edit'" },
          filePath: { type: "string", description: "Path to the file, relative to the workspace root" },
          content: { type: "string", description: "Full file content, required when mode='write'" },
          oldStr: { type: "string", description: "Exact string to replace, required when mode='edit'" },
          newStr: { type: "string", description: "Replacement string, required when mode='edit'" },
        },
        required: ["mode", "filePath"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_command_tool",
      description:
        "Execute a shell command in the workspace (tests, linter, type-checker, kubectl, docker build, repro steps). Returns exit code, stdout, stderr.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Shell command to run" },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ssh_tool",
      description:
        "Run a command on a remote host over SSH, or upload/download a file via scp. " +
        "For fleet operations across multiple hosts, prefer ssh_copy_tool and ssh_run_command " +
        "which use shared env-var credentials (XCODER_SSH_TARGETS/XCODER_SSH_USER/XCODER_SSH_PASSWORD). " +
        "Credentials can be provided inline OR via environment variable names: set userEnvVar to the " +
        "name of an env var containing the SSH username, and passwordEnvVar to the name of an env var " +
        "containing the password. This avoids leaking secrets into logs/context.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", description: "'exec', 'upload', or 'download'" },
          host: { type: "string" },
          user: { type: "string", description: "SSH username; optional if userEnvVar is set" },
          port: { type: "number", description: "defaults to 22" },
          keyPath: { type: "string", description: "path to private key; omit to use ssh-agent/default keys" },
          userEnvVar: { type: "string", description: "Name of env var containing the SSH username (safer than inline user)" },
          passwordEnvVar: { type: "string", description: "Name of env var containing the SSH password (safer than inline)" },
          command: { type: "string", description: "required when action='exec'" },
          localPath: { type: "string", description: "required for upload/download" },
          remotePath: { type: "string", description: "required for upload/download" },
          recursive: { type: "boolean", description: "for upload/download of a directory" },
        },
        required: ["action", "host"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "schedule_task_tool",
      description:
        "Schedule a shell command to run later: recurring via OS cron ('add' with cronExpr), one-off after a delay ('once'), or list/remove existing xcoder-managed cron jobs.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", description: "'add', 'once', 'list', or 'remove'" },
          id: { type: "string", description: "job id, required for 'add' and 'remove'" },
          cronExpr: { type: "string", description: "standard 5-field cron expression, required for 'add'" },
          delaySeconds: { type: "number", description: "required for 'once'" },
          command: { type: "string", description: "shell command to run, required for 'add' and 'once'" },
        },
        required: ["action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "playwright_run_tool",
      description: "Run a Playwright test file (or the whole suite) via `npx playwright test` and return pass/fail results.",
      parameters: {
        type: "object",
        properties: {
          scriptPath: { type: "string", description: "path to a specific spec file, relative to cwd; omit to run the whole suite" },
          cwd: { type: "string", description: "workspace containing the Playwright project; defaults to current workspace" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "crawl_and_generate_playwright_test_tool",
      description:
        "Fetch a URL, extract its links/buttons/forms, and write a Playwright test skeleton (@playwright/test) covering those elements to outputPath.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL to crawl" },
          outputPath: { type: "string", description: "where to write the generated .spec.ts file, relative to cwd" },
        },
        required: ["url", "outputPath"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "github_tool",
      description: "Clone, fetch, pull, check status, commit, or push a git/GitHub repository. Uses GITHUB_TOKEN env var if set for HTTPS auth.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", description: "'clone', 'fetch', 'pull', 'status', 'commit', or 'push'" },
          repoUrl: { type: "string", description: "required for 'clone'" },
          repoDir: { type: "string", description: "local path to the repo, required for fetch/pull/status/commit/push" },
          branch: { type: "string" },
          remote: { type: "string", description: "defaults to 'origin'" },
          message: { type: "string", description: "commit message, required for 'commit'" },
          files: { type: "array", items: { type: "string" }, description: "files to stage for 'commit', defaults to ['.']" },
        },
        required: ["action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "docker_compose_deploy_tool",
      description:
        "Run `docker compose up -d --build` locally in the specified project directory. Use this to deploy the xcoder stack (or any docker-compose project) on the local machine. Returns build logs and container status.",
      parameters: {
        type: "object",
        properties: {
          projectDir: {
            type: "string",
            description: "Path to the directory containing docker-compose.yml. Defaults to the current working directory.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "docker_deploy_ssh_tool",
      description:
        "Package the current workspace, ship it to a remote host over SSH/scp, and run a Docker command there " +
        "(default: docker compose up -d --build). Supports pre-deploy validation, rollback, health verification, " +
        "compose file selection, registry pull mode, and env file shipping. " +
        "Credentials can be provided inline OR via environment variable names: set userEnvVar to the name of an " +
        "env var containing the SSH username, and passwordEnvVar to the name of an env var containing the SSH " +
        "password. This avoids leaking secrets into logs/context. " +
        "For fleet operations across multiple hosts, prefer ssh_copy_tool and ssh_run_command which use shared " +
        "env-var credentials (XCODER_SSH_TARGETS/XCODER_SSH_USER/XCODER_SSH_PASSWORD).",
      parameters: {
        type: "object",
        properties: {
          host: { type: "string", description: "Remote host address" },
          user: { type: "string", description: "SSH username; optional if userEnvVar is set" },
          port: { type: "number", description: "SSH port, defaults to 22" },
          keyPath: { type: "string", description: "Path to SSH private key; omit to use ssh-agent/default keys" },
          userEnvVar: { type: "string", description: "Name of env var containing the SSH username (safer than inline user)" },
          passwordEnvVar: { type: "string", description: "Name of env var containing the SSH password (safer than inline)" },
          remotePath: { type: "string", description: "Target directory on the remote host" },
          dockerCommand: { type: "string", description: "Docker command to run remotely. Defaults to 'docker compose up -d --build'. Use 'docker compose up -d --pull always' to pull from registry instead of building." },
          composeFile: { type: "string", description: "Specific compose file to use (e.g. 'docker-compose.prod.yml'). If omitted, uses the default docker-compose.yml." },
          envFile: { type: "string", description: "Path to a local .env file to ship alongside the workspace (e.g. '.env.production')." },
          pullFromRegistry: { type: "boolean", description: "If true, replaces --build with --pull always to pull images from registry instead of building from source." },
          skipValidation: { type: "boolean", description: "If true, skip pre-deploy validation checks (docker version, disk space)." },
          skipHealthCheck: { type: "boolean", description: "If true, skip health verification after deploy." },
          skipRollback: { type: "boolean", description: "If true, skip creating a rollback snapshot before deploy." },
          healthCheckTimeoutMs: { type: "number", description: "Timeout in ms for health check polling. Defaults to 120000 (2 minutes)." },
          dockerCommandTimeoutMs: { type: "number", description: "Timeout in ms for the docker command itself. Defaults to 300000 (5 minutes)." },
        },
        required: ["host", "remotePath"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "subagent_tool",
      description:
        "Delegate a focused research/exploration/analysis task to a fresh sub-agent with its own isolated context. Only the sub-agent's final summary comes back — its intermediate tool calls and reasoning never enter your context window. Use this for parallel investigation, large searches, or any sub-task whose detail you don't need to carry forward.",
      parameters: {
        type: "object",
        properties: {
          task: { type: "string", description: "A focused, self-contained task description for the sub-agent" },
        },
        required: ["task"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "indexing_tool",
      description:
        "Rebuild the workspace index (.agent/index/index.json + chunked dump files) by scanning all files while respecting .agentignore/.gitignore/.dockerignore. Use this to get a fresh, authoritative view of the workspace after any file changes, or when you need to navigate files efficiently via the index. Returns the count of indexed files and the generation timestamp.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            description: "'rebuild' to re-index the entire workspace, or 'read' to read a specific file's content from the existing index",
          },
          filepath: {
            type: "string",
            description: "Required when action='read'. Relative path of the file to read from the index (e.g. 'src/main.ts')",
          },
        },
        required: ["action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "workspace_info_tool",
      description:
        "Get a structured snapshot of the CURRENT workspace: file tree (capped), detected languages/package-managers/frameworks, containerization/CI status, git branch/remote/dirty-state, and package.json name/version/scripts/dependencies. This is lighter-weight than indexing_tool — a structural/metadata overview, not a full-content dump — and is automatically refreshed once at the start of every top-level task, so its summary is already in your system context. Call this tool explicitly only when you need the snapshot AGAIN mid-task: pass refresh=true after you've installed a dependency, created/deleted files, or switched branches, since none of those are picked up automatically until you ask for a refresh. Pass refresh=false (or omit it) to just re-read the current cached snapshot without rebuilding.",
      parameters: {
        type: "object",
        properties: {
          refresh: {
            type: "boolean",
            description: "true to rebuild the snapshot from scratch (e.g. after dependency/file/branch changes); false or omitted to read the existing cached snapshot.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "task_history_tool",
      description:
        "Query the persistent history of previously completed top-level tasks in this workspace. This is NOT automatically included in your context — you must call this explicitly whenever you need it, e.g. the user says 'continue', asks 'what was the last task', references earlier work without repeating what it was, or you need to check whether something was already done in a prior session.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", description: "'recent' to get the most recent tasks, or 'search' to keyword-search past task descriptions/summaries" },
          limit: { type: "number", description: "Max number of tasks to return, defaults to 5" },
          query: { type: "string", description: "Keyword to search for; required when action='search'" },
        },
        required: ["action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_plan_tool",
      description:
        "Save a plan to PostgreSQL. The plan is stored with its task description, plan content, and individual tasks. Use this when the UI is active and plans should be persisted in the database for the LLM to manage task status.",
      parameters: {
        type: "object",
        properties: {
          taskDescription: { type: "string", description: "The original task description that generated this plan" },
          planContent: { type: "string", description: "The full plan content/markdown" },
          tasks: { type: "array", items: { type: "string" }, description: "Array of individual task descriptions extracted from the plan" },
        },
        required: ["taskDescription", "planContent", "tasks"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_task_status_tool",
      description:
        "Update the status of a task within a plan. The LLM can use this to track progress as tasks are completed, in progress, failed, or skipped.",
      parameters: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "The ID of the task to update" },
          status: { type: "string", description: "New status: 'pending', 'in_progress', 'completed', 'failed', or 'skipped'" },
        },
        required: ["taskId", "status"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_plan_task_tool",
      description:
        "Add a new task to an existing plan. Use this when the LLM determines additional work is needed that wasn't in the original plan.",
      parameters: {
        type: "object",
        properties: {
          planId: { type: "string", description: "The ID of the plan to add the task to" },
          description: { type: "string", description: "Description of the new task" },
        },
        required: ["planId", "description"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_plan_task_tool",
      description:
        "Delete a task from a plan. Use this when a task is no longer relevant or was added by mistake.",
      parameters: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "The ID of the task to delete" },
        },
        required: ["taskId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "summarize_url_tool",
      description:
        "Fetch a URL, extract its readable content (title, headings, paragraphs), and return a structured summary. Use this to quickly understand what a web page is about without reading the entire page.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "The URL to fetch and summarize" },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ssh_copy_tool",
      description:
        "Upload a local file or folder from this workspace to one or all configured remote fleet targets over SFTP " +
        "(configured via XCODER_SSH_TARGETS/XCODER_SSH_USER/XCODER_SSH_PASSWORD - no host/user/key needed per call, " +
        "unlike ssh_tool). Omit 'target' to upload to ALL configured targets; set 'target' to one host or host:port " +
        "to upload to just that one. Use this to get build context, compose files, or configs onto the fleet before " +
        "running commands against them with ssh_run_command.",
      parameters: {
        type: "object",
        properties: {
          localPath: { type: "string", description: "Path in the workspace to upload, relative to cwd; file or directory" },
          remotePath: { type: "string", description: "Destination path on the remote target(s)" },
          target: { type: "string", description: "Optional: one configured target ('host' or 'host:port'); omit for all" },
        },
        required: ["localPath", "remotePath"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ssh_run_command",
      description:
        "Execute a shell command (or multi-line bash script) over SSH on one or all configured remote fleet targets " +
        "(configured via XCODER_SSH_TARGETS/XCODER_SSH_USER/XCODER_SSH_PASSWORD). Omit 'target' to run on ALL " +
        "configured targets in parallel; set 'target' to run on just one. Use this as the remote equivalent of " +
        "run_command_tool - and as your remote VALIDATION step: always verify a remote change actually worked " +
        "(check process/container status, curl a health endpoint, check exit codes) rather than assuming success.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Shell command or multi-line bash script to run" },
          target: { type: "string", description: "Optional: one configured target ('host' or 'host:port'); omit for all" },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "crawl_site_mapper_tool",
      description:
        "Crawl a URL and build a site map of all discoverable internal pages. Uses BFS to traverse same-domain links, records page titles, HTTP status codes, and the link graph. Returns a structured SiteMap with a tree hierarchy.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "Starting URL to crawl" },
          maxPages: { type: "number", description: "Maximum number of pages to crawl (default: 50)" },
          maxDepth: { type: "number", description: "Maximum crawl depth (default: 5)" },
          sameDomain: { type: "boolean", description: "Only crawl same-domain links (default: true)" },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "api_test_tool",
      description:
        "Make an HTTP request to test an API endpoint. Supports GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS with custom headers, JSON/Form/Text bodies, query parameters, and optional response assertions (expectStatus, expectBodyContains). Returns structured results including status code, response headers, parsed body, and timing. Use this to probe, debug, or verify any REST/HTTP API during development or testing.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "The full URL of the API endpoint to test" },
          method: {
            type: "string",
            enum: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
            description: "HTTP method to use",
          },
          queryParams: {
            type: "object",
            description: "Optional query parameters to append to the URL as key-value pairs",
            additionalProperties: { type: "string" },
          },
          headers: {
            type: "object",
            description: "Optional request headers as key-value pairs (e.g. {\"Authorization\": \"Bearer xxx\"})",
            additionalProperties: { type: "string" },
          },
          body: {
            type: "string",
            description: "Request body as a string. For JSON, pass a JSON string. For form data, pass URL-encoded string. Omit for GET/HEAD/DELETE requests with no body.",
          },
          bodyType: {
            type: "string",
            enum: ["json", "text", "form"],
            description: "How to encode the body. 'json' sets Content-Type: application/json, 'form' sets application/x-www-form-urlencoded, 'text' sets text/plain. Defaults to 'json' if body looks like JSON, otherwise 'text'.",
          },
          maxBodyLength: {
            type: "number",
            description: "Max response body characters before truncation (default: 10000)",
          },
          timeout: {
            type: "number",
            description: "Request timeout in milliseconds (default: 30000)",
          },
          expectStatus: {
            type: "number",
            description: "Assert the response status matches this value. If it doesn't match, the tool returns an error with the actual status and body for debugging.",
          },
          expectBodyContains: {
            type: "string",
            description: "Assert the response body (as string) contains this substring. If it doesn't, the tool returns an error with the actual body for debugging.",
          },
        },
        required: ["url", "method"],
      },
    },
  },
];

