# Agents Panel

**English** · [Português (Brasil)](README.pt-BR.md)

A Claude Code side pane (in the terminal) that shows every agent of the session: the main one and each subagent, with model, effort, stopwatch, tokens and the tool it's using right now. It also shows the shells running in the background (Bash and PowerShell), until they finish.

Each subagent frame, **SHELLS** and **CONCLUÍDOS** (Finished) has a ✕ that closes the frame. A closed subagent comes back when it works again; a new shell or a newly finished subagent brings its frame back with only the new item. The **Principal** frame has no ✕.

The pane opens by itself when the terminal window is 144 columns wide or more; at any width, `/painel-agentes` opens it. It was built and tested with `"tui": "fullscreen"` in `~/.claude/settings.json`.

The pane's labels and its command are in Brazilian Portuguese: the pane is titled **Agentes** (Agents), the main agent shows as **Principal** (Main) and each subagent as **Subagente** (Subagent).

## Plans

For a task of more than a few steps, Claude writes a plan (stages of steps) and moves it as it works. The plan shows inside the frame of the agent that made it: the main conversation's plan in the **Principal** frame, a subagent's plan in that subagent's frame.

- The first line has the plan's title and a badge with its state and time: green while it runs, amber while it waits for your answer, red on an error, teal once done.
- A bar runs the width of the frame, with the current stage, the step and the percent in its pill.
- A stage already finished folds into one line with its total time; the current stage lists each step.
- Plans the main conversation already finished stay below the current one, one line each.
- When a subagent ends, its finished plan goes with it to **CONCLUÍDOS**; a plan it left open moves to the **Principal** frame.

An approved plan-mode plan becomes the plan `plan` in the **Principal** frame. The main conversation's plans are saved per session and come back when you reopen it.

**Uninstall plan-progress** if you have it: this pane now does what it did. With both installed, Claude would have two plan tools and report every step twice.

```
claude plugin uninstall plan-progress
```

## Install on a new computer

Agents Panel installs by its id, `agents-panel`, from [WPC Mods for Claude](https://github.com/carreirodev/wpc-mods-claude), the marketplace with all my mods. There are two ways, and they do the same thing: pick one.

**Inside Claude Code**, in a session, type:

```
/plugin install agents-panel --marketplace carreirodev/wpc-mods-claude
```

Answer `y` to add the marketplace, then press Enter to pick the user scope (the first in the list). `Installed agents-panel` confirms it.

**From a terminal**, outside Claude Code, run one command and then the other:

```
claude plugin marketplace add carreirodev/wpc-mods-claude
```

```
claude plugin install agents-panel@wpc-mods-claude
```

Here the user scope is already the default, so there's nothing to pick.

Either way, the pane works from then on, in every new session; in a session that was already open, run `/reload-plugins`.

To get a new version later: `/plugin marketplace update wpc-mods-claude` in a session.

Installed it earlier from this repository's own marketplace (`agents-panel@agents-panel`)? That copy keeps updating as before. To switch, follow [these steps](https://github.com/carreirodev/wpc-mods-claude#if-you-already-installed-a-mod-from-its-own-repository); don't keep both, since only one would run.

## Developing

To work on the mod, use a cloned folder instead of the install above (one or the other, not both):

1. Clone the repository into that folder:

   ```
   git clone https://github.com/carreirodev/mod-painel-agents.git C:\Users\YOUR_USER\mods\agents-panel
   ```

2. In `~/.claude/settings.json`, inside the `env` block, point to that folder:

   ```json
   "env": {
     "CLAUDE_CODE_PLUGIN_DIRS": "C:\\Users\\YOUR_USER\\mods\\agents-panel"
   }
   ```

3. Open a new session. From then on, every change saved in the folder reloads the mod at the end of Claude's reply.

Before pushing a change, run in the mod's folder:

```
claude plugin validate .
claude plugin test .
```

Then bump `version` in `.claude-plugin/plugin.json`: computers that installed from the marketplace only get the change when the version changes.
