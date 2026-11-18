// Smoke test for armazi-hud lib/client.js
// - stubs window.__ModuleLoader__.load and a faithful fake DSH client ctx
//   (slots.inject(name, factory) + ctx.slots.register, locale.register, effect,
//    inject(services, cb) => thenable with .dispose — the template contract)
// - renders the registered component with (a) full fake data and (b) empty data
// - uses the real react / react-dom from the dsh checkout.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

// react is bundled by the DSH web host (not resolvable on this box), so the
// smoke test supplies a minimal, behavior-faithful stand-in for the subset
// the HUD uses: useState/useEffect + jsx/jsxs elements + static markup
// rendering. (The HUD is presentation-only: no context, no portals; its one
// effect is the 1s compaction-timer tick, whose interval is stubbed below.)
let hookStates = [];
let hookIndex = 0;
function useState(init) {
	const i = hookIndex++;
	if (hookStates[i] === undefined) {
		hookStates[i] = typeof init === "function" ? init() : init;
	}
	return [hookStates[i], () => {}];
}
function useEffect(cb) {
	try { if (typeof cb === "function") cb(); } catch { /* effect failures can never fail the smoke */ }
}
const react = { useState, useEffect };
const createElement = (type, props) => ({ type, props: props || {} });
const jsxRt = { jsx: createElement, jsxs: createElement };
const escape = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function renderNode(node) {
	if (node == null || node === false || node === true) return "";
	if (typeof node === "string" || typeof node === "number") return escape(node);
	if (Array.isArray(node)) return node.map(renderNode).join("");
	const type = node.type, props = node.props || {};
	if (typeof type === "function") return renderNode(type(props));
	const attrs = [];
	for (const [k, v] of Object.entries(props)) {
		if (k === "children" || v == null || typeof v === "boolean") continue;
		attrs.push(k + '="' + escape(v) + '"');
	}
	return "<" + type + (attrs.length ? " " + attrs.join(" ") : "") + ">" + renderNode(props.children) + "</" + type + ">";
}
function renderToStaticMarkup(root) {
	hookStates = [];
	hookIndex = 0;
	return renderNode(root);
}

const registry = [];
globalThis.window = { __ModuleLoader__: { load: (m) => { registry.push(m); } } };

// ---------------- localStorage stub (open/close persistence) ----------------
const lsStore = new Map();
globalThis.window.localStorage = {
	getItem: (k) => (lsStore.has(k) ? lsStore.get(k) : null),
	setItem: (k, v) => { lsStore.set(k, String(v)); },
	removeItem: (k) => { lsStore.delete(k); }
};

// While a compaction is live (or in its 3s hold) the HUD runs a 1s setInterval
// from a useEffect. Node's real timers would keep this process alive after the
// smoke ends → stub both as no-ops (the effect body only stores the "id").
globalThis.setInterval = () => 99;
globalThis.clearInterval = () => {};

const clientSrc = readFileSync(path.join(here, "lib/client.js"), "utf8");
(0, eval)(clientSrc); // top-level window.__ModuleLoader__.load(...) runs here
if (registry.length !== 1) throw new Error("expected exactly 1 registered client module, got " + registry.length);
const exports = registry[0].factory((name) => {
	if (name === "react") return react;
	if (name === "react/jsx-runtime") return jsxRt;
	throw new Error("unexpected require: " + name);
});
if (typeof exports.apply !== "function") throw new Error("exports.apply missing");
if (!Array.isArray(exports.inject)) throw new Error("exports.inject missing");

// 2026-10-29: CSS-only floor must stay on the collapsed/expanded strip roots so a
// fresh (empty) chat can never squash it below the combined height of its
// elements. Static-markup render omits <style>, so assert on the source CSS.
if (!/\.rhud\{[^}]*min-height:36px/.test(clientSrc)) throw new Error(".rhud min-height floor missing");
// 2026-10-29: the expanded view must carry its OWN higher floor so a fresh chat
// can't squash it to the collapsed 36px and clip lines 2/3 (incl. the close
// toggle). Assert the source CSS keeps it.
if (!/\.rhud:not\(\.rhud-collapsed\)\{[^}]*min-height:96px/.test(clientSrc)) throw new Error(".rhud expanded min-height floor missing");

// ---------------- fake DSH client context (template-faithful) ----------------
function makeCtx() {
	const calls = { effects: [], slotInjected: null, registeredEntry: null, registeredComponent: null };
	const ctx = {
		_slots: calls,
		slots: {
			inject(slotName, factory) {
				calls.slotInjected = slotName;
				if (typeof factory !== "function") throw new Error("slots.inject factory missing");
				factory(); // template pattern: factory calls ctx.slots.register(...)
			},
			register(entry, component) {
				calls.registeredEntry = entry;
				calls.registeredComponent = component;
			}
		},
		locale: {
			register(ns, defs) {
				calls.localeNs = ns;
				calls.localeDefs = defs;
			}
		},
		effect(factory, label) {
			calls.effects.push({ label: String(label ?? ""), result: factory() });
		},
		inject(names, callback) {
			if (typeof callback !== "function") throw new Error("ctx.inject callback missing");
			let disposed = false;
			const handle = { dispose() { disposed = true; } };
			const promise = Promise.resolve().then(() => {
				callback(ctx);
				return handle;
			});
			promise.dispose = () => { handle.dispose(); return undefined; };
			promise.disposed = () => disposed;
			return promise;
		}
	};
	return { ctx, calls };
}

// ---------------- PartialArguments stub ----------------
function makeArgs(obj) {
	const values = { ...(obj || {}) };
	return {
		keys: () => Object.keys(values),
		has: (k) => Object.prototype.hasOwnProperty.call(values, k),
		complete: (k) => typeof values[k] === "string",
		stringLength: (k) => (typeof values[k] === "string" ? values[k].length : undefined),
		text: (k) => (typeof values[k] === "string" ? values[k] : undefined),
		textPrefix: (k, max) => (typeof values[k] === "string" ? values[k].slice(0, max) : undefined),
		value: (k) => values[k]
	};
}

// ---------------- fake session data ----------------
const nodes = [
	{ seq: 1, kind: "compaction", data: { summary: "earlier span" } },
	{
		seq: 2, kind: "assistant", turn: 1, step: 1,
		providerMetadata: { model: "qwen3.8:27b" },
		requestConfig: { model: "qwen3.8:27b", reasoningEffort: "high" },
		blocks: [
			{ kind: "reasoning", text: "I need to check the spec before writing code." },
			{ kind: "text", text: "Let me look." },
			{ kind: "tool-call", callId: "c1", name: "read", argsRaw: "{}" }
		]
	},
	{
		seq: 3, kind: "tool-result", time: 1012, callId: "c1", name: "read",
		args: makeArgs({ file_path: "tasks/ui/hud.md" }),
		call: { name: "read", argsRaw: "{}" }, callTime: 1000, content: [], isError: false
	},
	{
		seq: 4, kind: "assistant", turn: 2, step: 1,
		providerMetadata: { model: "qwen3.8:27b" },
		requestConfig: { model: "qwen3.8:27b", reasoningEffort: "high" },
		blocks: [
			{ kind: "reasoning", text: "Now I will write the plugin file." },
			{ kind: "text", text: "Now writing." },
			{ kind: "tool-call", callId: "c2", name: "write", argsRaw: "" }
		]
	},
	{
		seq: 5, kind: "tool-result", time: 2088, callId: "c2", name: "write",
		args: makeArgs({
			file_path: "work/client.js",
			old_string: "old", new_string: "new"
		}),
		call: { name: "edit", argsRaw: "" }, callTime: 2000, content: [], isError: true
	}
];
const legacySnapshot = {
	legacy: {
		nodes,
		partial: null,
		runningCalls: [
			{
				callId: "c3", parentCallId: null, name: "bash", turn: 3, step: 1,
				time: 3000, subCalls: 0,
				args: makeArgs({ description: "build", command: "pnpm build" })
			}
		]
	}
};

const projections = {
	sessionStats: { turns: 2, steps: 2, llmMs: 900, toolMs: 188, ttftMs: 240, ttftSteps: 2, decodeMs: 600, decodeTokens: 96 },
	tokenUsage: { uncachedInputTokens: 1200, outputTokens: 300, cacheReadTokens: 6400, cacheWriteTokens: 200 },
	contextPressure: { pressureTokens: 42000, projectedTokens: 43000, contextWindow: 131072 },
	todos: [
		{ content: "Read spec", status: "completed" },
		{ content: "Build plugin client", status: "in_progress" },
		{ content: "Smoke test", status: "pending" }
	],
	subagentCatalog: [
		{ id: "sub-1", createdAt: 100, mode: "one-shot", label: "researcher" },
		{ id: "sub-2", createdAt: 200, mode: "continuable" }
	]
};

// ---------------- render via the real apply() lifecycle ----------------
async function directRender(snapshotArg, proj, extraProps) {
	const { ctx, calls } = makeCtx();
	const unmount = await exports.apply(ctx);
	try {
		if (!calls.slotInjected) throw new Error("slots.inject never called");
		if (calls.slotInjected !== "conversation.input.dock") {
			throw new Error("slot name unexpected: " + calls.slotInjected);
		}
		if (typeof calls.registeredComponent !== "function") throw new Error("slot component not registered");
		const entry = calls.registeredEntry;
		if (!entry || entry.id !== "armazi-hud" || entry.name !== "conversation.input.dock" || entry.order !== 5 || entry.locale !== calls.localeNs) {
			throw new Error("bad entry: " + JSON.stringify(entry));
		}
		if (!calls.localeDefs || typeof calls.localeDefs.en !== "object") throw new Error("locale en dict missing");
		const EN = calls.localeDefs.en;
		const t = (k) => (k in EN ? EN[k] : k);
		const props = {
			useChat: (fn) => (typeof fn === "function" ? fn(snapshotArg) : undefined),
			useProjection: (name) => proj[name],
			t,
			...(extraProps || {})
		};
		const html = renderToStaticMarkup(jsxRt.jsx(calls.registeredComponent, props));
		return { html, entry, NS: calls.localeNs, EN };
	} finally {
		await unmount();
	}
}

// ---------------- case runner (minimized dots | expanded icon+bar rows) ----------------
const failures = [];
let checkedCount = 0;
function check(name, html, mustHave, mustNot) {
	checkedCount += 1;
	const missing = mustHave.filter((n) => !html.includes(n));
	const banned = (mustNot || []).filter((n) => html.includes(n));
	const file = "smoke-" + name + ".html";
	writeFileSync(path.join(here, file), html);
	if (missing.length || banned.length) failures.push({ name, missing, banned });
	console.log((missing.length || banned.length ? "FAIL " : "ok   ") + name + " -> " + file);
}

// The compaction live/ended bookkeeping lives on the component itself
// (RuntimeHud.__cpBox, keyed by session id) so it survives unmount/remount
// within one session. Reset it between cases — but NOT between case A's
// live render and its ended render, which share it on purpose to prove
// the ×1 → ×2 bump when the run ends.
function resetHudState() {
	const c = exports._component;
	if (c && c.__cp) c.__cp = null;
	if (c && c.__cpBox) c.__cpBox = null;
}

// ---------------- case A: minimized (default) + full data + live compaction ----------------
resetHudState();
const minLiveSnapshot = {
	legacy: {
		nodes: legacySnapshot.legacy.nodes,
		partial: null,
		runningCalls: legacySnapshot.legacy.runningCalls.concat([
			{ callId: "cA", parentCallId: null, name: "compaction", turn: 5, step: 1, time: Date.now() - 12000, subCalls: 0, args: makeArgs({ summary: "span" }) }
		])
	}
};
const full = await directRender(minLiveSnapshot, projections);
console.log("NS =", full.NS, "| EN keys =", Object.keys(full.EN).length, "| entry =", JSON.stringify(full.entry));
check("min", full.html,
	[
		"rhud-collapsed", "rhud-chip", "rhud-dot", "×1",
		"details", 'data-rhud="toggle"',
		"rhud-cc-thinking", "rhud-cc-read", "rhud-cc-edit", "rhud-cc-bash", "rhud-cc-cp",
		"rhud-has-active", // compaction running → inactive chips are grayed
		"rhud-dot-live",
		// live compaction: yellow dot chip with ×N + live mm:ss, other chips sleeping
		"compacting", 'data-rhud="compacting"', "rhud-sleep", "×1 + 00:12", "rhud-compacting"
	],
	[
		// expanded-only metrics
		"🧠", "💭", "⚡", "📈", "🔄", "🤖", "🧊",
		// expanded-only detail
		"qwen3.8:27b", "160.0", "82%", "42k/131k · 32%", "2 · researcher",
		"hud.md", "work/client.js", "+3 −3",
		"Now I will write the plugin file.", "no tool activity yet", "hide details",
		// minimized is dots + counts, no tool icons (the live dot chip is the exception)
		"📄", "✏", "⚙", "🗜", "rhud-wb",
		// minimized never shows the striped bar chip (expanded view only)
		"rhud-bar"
	]);
// "details" must flow right after the last chip (normal layout order, no pinning)
{
	const togPos = full.html.indexOf('data-rhud="toggle"');
	const lastChipPos = Math.max(full.html.lastIndexOf('data-rhud="chip-'), full.html.lastIndexOf('data-rhud="compacting"'));
	if (!(togPos > lastChipPos)) failures.push({ name: "min", missing: ["details-after-last-chip"], banned: [] });
	else console.log("ok    min  details toggle flows right after the last chip");
}
// A-2: the live run ends (render pair shares __cp on purpose) → count ×1 → ×2
// and the FINAL elapsed time stays frozen on the chip for the 3s hold window
// (this render happens inside that window, so it shows "×2 + 00:12").
const endedSnapshot = { legacy: { nodes: legacySnapshot.legacy.nodes, partial: null, runningCalls: legacySnapshot.legacy.runningCalls } };
const ended = await directRender(endedSnapshot, projections);
check("min-hold", ended.html,
	["rhud-collapsed", "×2 + 00:12", "details", 'data-rhud="toggle"', "rhud-cc-cp", 'data-rhud="compacting"'],
	["rhud-bar", "compacting…", "rhud-sleep", "×1 +", "hide details"]);
// A-3: more than CP_HOLD_MS have passed (backdate the session's endedAt) →
// the timer is gone and only the bumped count remains ("×2").
if (exports._component && exports._component.__cpBox && exports._component.__cpBox.state) exports._component.__cpBox.state.endedAt = Date.now() - 5000;
const expired = await directRender(endedSnapshot, projections);
check("min-expired", expired.html,
	["rhud-collapsed", "rhud-chip", "×2", "details", 'data-rhud="toggle"', "rhud-cc-cp", 'data-rhud="compaction"'],
	["00:12", "rhud-bar", "compacting…", "rhud-sleep", "hide details", 'data-rhud="compacting"']);

// ---------------- case B: minimized + empty (fallbacks, no crash) ----------------
resetHudState();
const emptySnapshot = { legacy: { nodes: [], partial: null, runningCalls: [] } };
const empty = await directRender(emptySnapshot, {});
check("min-empty", empty.html,
	["rhud-collapsed", "rhud-dot", "×0", "details", 'data-rhud="toggle"', "rhud-cc-thinking", "rhud-cc-cp", 'data-rhud="compaction"'],
	["rhud-has-active", "rhud-dot-live", "rhud-bar", "×1", "rhud-sleep", "rhud-compacting", "compacting", "×0 +", "00:00", "no tool activity yet", "hide details", "hud.md"]);
{
	const togPos = empty.html.indexOf('data-rhud="toggle"');
	const lastChipPos = Math.max(empty.html.lastIndexOf('data-rhud="chip-'), empty.html.lastIndexOf('data-rhud="compacting"'));
	if (!(togPos > lastChipPos)) failures.push({ name: "min-empty", missing: ["details-after-last-chip"], banned: [] });
	else console.log("ok    min-empty  details toggle flows right after the last chip");
}

// ---------------- case C: expanded + full data + compaction running ----------------
const compactSnapshot = {
	legacy: {
		nodes: legacySnapshot.legacy.nodes,
		partial: null,
		runningCalls: legacySnapshot.legacy.runningCalls.concat([
			{ callId: "c9", parentCallId: null, name: "compaction", turn: 4, step: 1, time: Date.now() - 12000, subCalls: 0, args: makeArgs({ summary: "span" }) }
		])
	}
};
resetHudState();
lsStore.set("dsh.runtimeHud.open", "1");
const wide = await directRender(compactSnapshot, projections);
lsStore.delete("dsh.runtimeHud.open");
check("wide", wide.html,
	[
		// metrics line
		"🧠", "💭", "⚡", "📈", "🔄", "🤖", "▸",
		"qwen3.8:27b", "high",
		"160.0", // tok/s = 96 tokens / 0.6s
		"42k/131k · 32%", // context pressure
		"2 · researcher", // subagent catalog
		"✓ 1", "● 1", "○ 1", "Build plugin client", // todos
		// thinking detail
		"Now I will write the plugin file.",
		// tool rows: icons + name + count + weight bar
		"📄", "✏", "⚙", "hud.md", "work/client.js", "+3 −3",
		"rhud-wb", "rhud-cc-bash", "rhud-cc-read", "rhud-cc-edit", "rhud-cc-compaction",
		// compaction live: yellow bar + ×N + mm:ss
		"rhud-bar", "compacting", "×1 + 00:12",
		"hide details", "rhud-ic-live"
	],
	[
		"rhud-collapsed", "🧊", "82%",
		// 🗜 + 0.1s are legit: running compaction renders as a live tool row (icon + duration)
		"no tool activity yet", "→"
	]);

// ---------------- case D: expanded + empty (dashes, no crash) ----------------
resetHudState();
lsStore.set("dsh.runtimeHud.open", "1");
const wideEmpty = await directRender(emptySnapshot, {});
lsStore.delete("dsh.runtimeHud.open");
check("wide-empty", wideEmpty.html,
	["—", "💭", "🗜", "no tool activity yet", "hide details"],
	["rhud-collapsed", "hud.md", "160.0", "rhud-bar", "×1", "rhud-sleep", "rhud-compacting", "compacting", "×0 +", "00:00", "qwen3.8:27b"]);

// ---------------- case E: live compaction visible ONLY via turnTimings ----------------
// (Trajectory-view ground truth: a pending entry whose purpose matches
// /compact/i with a startTime and no endTime, i.e. runningCalls empty of it)
resetHudState();
const ttMap = new Map();
ttMap.set("8", { startTime: Date.now() - 5000, purpose: "Compaction", endTime: null });
const ttSnapshot = {
	legacy: {
		nodes: legacySnapshot.legacy.nodes,
		partial: null,
		runningCalls: legacySnapshot.legacy.runningCalls,
		turnTimings: ttMap
	}
};
const ttLive = await directRender(ttSnapshot, projections);
check("min-turnTimings-live", ttLive.html,
	["rhud-collapsed", "rhud-chip", "rhud-dot-live", "×1 + 00:05", "rhud-cc-cp", "rhud-compacting", 'data-rhud="compacting"', "rhud-sleep"],
	["rhud-bar", "compacting…", "🗜", "hide details", "×0 + 00:05"]);

// ---------------- case F: live compaction sourced from useTrajectory (PRIMARY) ----------------
// 2026-10-26 work order: the authoritative live-compaction signal is the
// trajectory compaction RequestView delivered via the useTrajectory standard
// prop (purpose 'compaction', status 'running' ⇔ completedAt === null,
// startedAt = ms epoch). The legacy snapshot below carries NO live legacy
// signal (running call 'bash', no turnTimings), so only the trajectory
// request can drive the live chip — asserting the primary path directly.
resetHudState();
const cpReqStart = Date.now() - 5000;
const trajLive = {
	requests: [{ purpose: "compaction", startedAt: cpReqStart, completedAt: null, status: "running", turn: 1, step: 0, startSeq: 7 }]
};
const cpreqLive = await directRender(legacySnapshot, projections, { useTrajectory: (fn) => fn(trajLive) });
check("min-cpreq-live", cpreqLive.html,
	["rhud-collapsed", "rhud-chip", "rhud-dot-live", "×1 + 00:05", "rhud-cc-cp", "rhud-compacting", 'data-rhud="compacting"', "rhud-sleep"],
	["rhud-bar", "compacting…", "🗜", "hide details", "×0 + 00:05"]);

// ---------------- case G: trajectory compaction request already COMPLETED ----------------
// Same request finished (completedAt = startedAt + 5321, status 'complete'):
// the COMPACTION chip must render the plain expired form (×N, plain dot, no
// timer, no sleep) with a fresh state machine. Note: rhud-dot-live is NOT
// banned here because the fixture's live bash running call legitimately
// carries one on its own chip.
resetHudState();
const trajDone = {
	requests: [{ purpose: "compaction", startedAt: cpReqStart, completedAt: cpReqStart + 5321, status: "complete", turn: 1, step: 0, startSeq: 7 }]
};
const cpreqDone = await directRender(legacySnapshot, projections, { useTrajectory: (fn) => fn(trajDone) });
check("min-cpreq-done", cpreqDone.html,
	["rhud-collapsed", "rhud-chip", "rhud-cc-cp", 'data-rhud="compaction"', "×1", "details", 'data-rhud="toggle"', 'data-rhud="chip-bash"'],
	["rhud-compacting", 'data-rhud="compacting"', "rhud-sleep", "rhud-bar", "hide details", "×1 +", "00:05"]);

// ---------------- case H: cross-session bookkeeping isolation (2026-10-27 regression) ----------------
// User report: a brand-new session showed the previous session's compaction
// count (×9 instead of ×0). Root cause: the live/ended state machine was a
// module-scope singleton (RuntimeHud.__cp) that outlived the whole tab, so
// session A's completed count was inherited by session B through
// compactDisplayCount = max(compactCount, cpt.completed). The fix keys the
// state on the slot's `sessionId` standard prop — these three renders prove
// it without touching the state manually:
//   H1. Session A (legacy snapshot, one compaction node) + live trajectory
//       request → yellow live chip "×1 + 00:09".
//   H2. Same request COMPLETED in session A (exact 5 s duration, inside the
//       3 s hold window) → frozen "×2 + 00:05" and the box records
//       completed = 1.
//   H3. A FRESH session B (same browser "tab", no trajectory, empty chat)
//       must start clean: plain "×0" with none of A's count, timer or sleep
//       marks — the old singleton would have leaked "×2" here.
resetHudState();
const cpA_start = Date.now() - 9000;
const trajA = { requests: [{ purpose: "compaction", startedAt: cpA_start, completedAt: null, status: "running", turn: 1, step: 0, startSeq: 41 }] };
const h1 = await directRender(legacySnapshot, projections, { useTrajectory: (fn) => fn(trajA), sessionId: "sess-A" });
check("min-sessA-live", h1.html,
	["rhud-collapsed", "rhud-dot-live", "×1 + 00:09", 'data-rhud="compacting"', "rhud-compacting"],
	["rhud-bar", "compacting…", "×0 +", "hide details"]);
const trajADone = { requests: [{ purpose: "compaction", startedAt: cpA_start, completedAt: cpA_start + 5000, status: "complete", turn: 1, step: 0, startSeq: 41 }] };
const h2 = await directRender(legacySnapshot, projections, { useTrajectory: (fn) => fn(trajADone), sessionId: "sess-A" });
// hold/done form: chip stays flagged live (frozen timer) with EXACT final
// duration; the container's rhud-compacting is gone (run not active)
check("min-sessA-done", h2.html,
	["rhud-collapsed", "×2 + 00:05", 'data-rhud="compacting"', "rhud-chip rhud-cc-cp rhud-live"],
	["rhud-bar", "compacting…", "×1 +", 'data-rhud="compaction"', "hide details"]);
const h3 = await directRender(emptySnapshot, {}, { sessionId: "sess-B" });
check("min-sessB-fresh", h3.html,
	["rhud-collapsed", "rhud-chip", "rhud-cc-cp", 'data-rhud="compaction"', "×0", "details", 'data-rhud="toggle"'],
	["×1", "×2", "00:05", "rhud-sleep", "compacting", "hide details"]);

// ---------------- verdict ----------------
if (failures.length) {
	for (const f of failures) {
		console.error("FAIL:", f.name, "missing=", JSON.stringify(f.missing), "banned=", JSON.stringify(f.banned));
	}
	console.error("SMOKE FAILED (" + checkedCount + " cases run, " + failures.length + " failed)");
	process.exitCode = 1;
} else {
	console.log("SMOKE OK (" + checkedCount + " cases)");
}
