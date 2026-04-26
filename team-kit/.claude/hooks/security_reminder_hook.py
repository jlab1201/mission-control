#!/usr/bin/env python3
"""
Security Reminder Hook for Claude Code (Mission Control / team-kit edition).

Adapted from anthropics/claude-code/plugins/security-guidance (Apache 2.0).
Detection rules are unchanged; only state-file paths are redirected so each
project's warnings live under <project>/.claude/agent-memory/security-engineer/
where Mission Control's transcript watcher and the security-engineer agent
can both see them.

NOTE: every dangerous trigger substring is assembled from concatenated
fragments at module load. The source file therefore contains no literal
trigger substring, so this script can be re-edited via Edit/Write without
self-triggering the very rules it implements.
"""

import json
import os
import random
import sys
from datetime import datetime
from pathlib import Path


# ---------- Trigger substrings (assembled to avoid self-trigger) ----------
_EXEC_OPEN          = "ex" + "ec("
_EXECSYNC_OPEN      = "ex" + "ecSync("
_CHILD_EXEC         = "child_proc" + "ess.exec"
_NEW_FN             = "new" + " Function"
_EVAL_OPEN          = "ev" + "al("
_DANGER_HTML        = "dangerouslySet" + "InnerHTML"
_DOC_WRITE          = "document" + ".write"
_INNER_HTML_SP      = ".inn" + "erHTML ="
_INNER_HTML_NS      = ".inn" + "erHTML="
_PKL                = "pic" + "kle"
_OS_SYSTEM          = "os" + ".system"
_OS_IMPORT_SYSTEM   = "from os " + "import system"


# ---------- Path helpers ----------
def _project_root():
    env = os.environ.get("CLAUDE_PROJECT_DIR")
    return Path(env) if env else Path.cwd()


def _state_dir():
    d = _project_root() / ".claude" / "agent-memory" / "security-engineer"
    d.mkdir(parents=True, exist_ok=True)
    return d


DEBUG_LOG_FILE = str(_state_dir() / "security-hook-debug.log")
AUDIT_LOG_FILE = str(_state_dir() / "security-warnings.log")


def debug_log(message):
    try:
        ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
        with open(DEBUG_LOG_FILE, "a") as f:
            f.write(f"[{ts}] {message}\n")
    except Exception:
        pass


def audit_log(session_id, file_path, rule_name):
    """One-line audit record so the security-engineer agent has a real
    artifact to read instead of re-deriving what's been flagged."""
    try:
        ts = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
        with open(AUDIT_LOG_FILE, "a") as f:
            f.write(f"{ts}\t{session_id}\t{rule_name}\t{file_path}\n")
    except Exception:
        pass


# ---------- Reminder strings (built from constants so the source itself
#           never contains the dangerous substrings) ----------

_R_GH_ACTIONS = (
    "You are editing a GitHub Actions workflow file. Be aware of these security risks:\n\n"
    "1. Command Injection: never use untrusted input (issue titles, PR descriptions, "
    "commit messages) directly in run: commands without proper escaping.\n"
    "2. Use environment variables: instead of inlining ${{ github.event.issue.title }}, "
    "assign it to env: with proper quoting.\n"
    "3. Reference: https://github.blog/security/vulnerability-research/"
    "how-to-catch-github-actions-workflow-injections-before-attackers-do/\n\n"
    "UNSAFE: run: echo \"${{ github.event.issue.title }}\"\n"
    "SAFE:   env: { TITLE: ${{ github.event.issue.title }} }; run: echo \"$TITLE\""
)

_R_CHILD_EXEC = (
    "Security warning: " + _CHILD_EXEC + "() can lead to command injection. "
    "Prefer execFile or spawn with an explicit argv array - they don't invoke a shell, "
    "so user-controlled input can't break out via shell metacharacters. "
    "Only use the unsafe form if you genuinely need shell features and the input is trusted."
)

_R_NEW_FN = (
    "Security warning: " + _NEW_FN + "() with dynamic strings is code injection. "
    "Use a non-evaluating design instead."
)

_R_EVAL = (
    "Security warning: " + _EVAL_OPEN[:-1] + "() executes arbitrary code. "
    "Use JSON.parse() for data; redesign to avoid running arbitrary input as code."
)

_R_DANGER_HTML = (
    "Security warning: React's " + _DANGER_HTML + " can yield XSS if the content is untrusted. "
    "Sanitize with DOMPurify or use safe alternatives."
)

_R_DOC_WRITE = (
    "Security warning: " + _DOC_WRITE + "() can be exploited for XSS and has performance "
    "issues. Use createElement / appendChild instead."
)

_R_INNER_HTML = (
    "Security warning: assigning to .inn" + "erHTML with untrusted content yields XSS. "
    "Prefer textContent for plain text or sanitize HTML via DOMPurify."
)

_R_PKL = (
    "Security warning: " + _PKL + " with untrusted bytes can run arbitrary code. "
    "Use JSON or another safe serialization unless you specifically need this format."
)

_R_OS_SYSTEM = (
    "Security warning: " + _OS_SYSTEM + " should only be called with static arguments, "
    "never with values that could be user-controlled."
)


# ---------- Pattern table ----------
SECURITY_PATTERNS = [
    {
        "ruleName": "github_actions_workflow",
        "path_check": (lambda p: ".github/workflows/" in p
                       and (p.endswith(".yml") or p.endswith(".yaml"))),
        "reminder": _R_GH_ACTIONS,
    },
    {
        "ruleName": "child_proc_exec_injection",
        "substrings": [_CHILD_EXEC, _EXEC_OPEN, _EXECSYNC_OPEN],
        "reminder": _R_CHILD_EXEC,
    },
    {
        "ruleName": "new_function_injection",
        "substrings": [_NEW_FN],
        "reminder": _R_NEW_FN,
    },
    {
        "ruleName": "eval_open_injection",
        "substrings": [_EVAL_OPEN],
        "reminder": _R_EVAL,
    },
    {
        "ruleName": "react_dangerously_set_html",
        "substrings": [_DANGER_HTML],
        "reminder": _R_DANGER_HTML,
    },
    {
        "ruleName": "document_write_xss",
        "substrings": [_DOC_WRITE],
        "reminder": _R_DOC_WRITE,
    },
    {
        "ruleName": "inner_html_xss",
        "substrings": [_INNER_HTML_SP, _INNER_HTML_NS],
        "reminder": _R_INNER_HTML,
    },
    {
        "ruleName": "unsafe_deserialization",
        "substrings": [_PKL],
        "reminder": _R_PKL,
    },
    {
        "ruleName": "os_system_injection",
        "substrings": [_OS_SYSTEM, _OS_IMPORT_SYSTEM],
        "reminder": _R_OS_SYSTEM,
    },
]


# ---------- State management ----------
def get_state_file(session_id):
    return str(_state_dir() / f"warnings_state_{session_id}.json")


def cleanup_old_state_files():
    """Remove warnings-state files older than 30 days."""
    try:
        d = _state_dir()
        cutoff = datetime.now().timestamp() - 30 * 24 * 60 * 60
        for entry in d.iterdir():
            if entry.name.startswith("warnings_state_") and entry.name.endswith(".json"):
                try:
                    if entry.stat().st_mtime < cutoff:
                        entry.unlink()
                except (OSError, IOError):
                    pass
    except Exception:
        pass


def load_state(session_id):
    sf = get_state_file(session_id)
    if os.path.exists(sf):
        try:
            with open(sf, "r") as f:
                return set(json.load(f))
        except (json.JSONDecodeError, IOError):
            return set()
    return set()


def save_state(session_id, shown):
    try:
        with open(get_state_file(session_id), "w") as f:
            json.dump(list(shown), f)
    except IOError as e:
        debug_log(f"Failed to save state file: {e}")


# ---------- Pattern matching ----------
def check_patterns(file_path, content):
    norm = file_path.lstrip("/")
    for pattern in SECURITY_PATTERNS:
        if "path_check" in pattern and pattern["path_check"](norm):
            return pattern["ruleName"], pattern["reminder"]
        if "substrings" in pattern and content:
            for s in pattern["substrings"]:
                if s in content:
                    return pattern["ruleName"], pattern["reminder"]
    return None, None


def extract_content_from_input(tool_name, tool_input):
    if tool_name == "Write":
        return tool_input.get("content", "")
    if tool_name == "Edit":
        return tool_input.get("new_string", "")
    if tool_name == "MultiEdit":
        edits = tool_input.get("edits", [])
        if edits:
            return " ".join(e.get("new_string", "") for e in edits)
    return ""


def main():
    if os.environ.get("ENABLE_SECURITY_REMINDER", "1") == "0":
        sys.exit(0)

    if random.random() < 0.1:
        cleanup_old_state_files()

    try:
        data = json.loads(sys.stdin.read())
    except json.JSONDecodeError as e:
        debug_log(f"JSON decode error: {e}")
        sys.exit(0)

    session_id = data.get("session_id", "default")
    tool_name = data.get("tool_name", "")
    tool_input = data.get("tool_input", {})

    if tool_name not in ("Edit", "Write", "MultiEdit"):
        sys.exit(0)
    file_path = tool_input.get("file_path", "")
    if not file_path:
        sys.exit(0)

    content = extract_content_from_input(tool_name, tool_input)
    rule, reminder = check_patterns(file_path, content)
    if not (rule and reminder):
        sys.exit(0)

    key = f"{file_path}-{rule}"
    shown = load_state(session_id)
    if key in shown:
        sys.exit(0)
    shown.add(key)
    save_state(session_id, shown)
    audit_log(session_id, file_path, rule)
    print(reminder, file=sys.stderr)
    sys.exit(2)  # PreToolUse exit 2 -> blocks the tool, surfaces stderr to the model


if __name__ == "__main__":
    main()
