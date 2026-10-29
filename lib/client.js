// armazi-hud — presentation-only Runtime HUD status strip for the DSH web GUI.
// One entry in the existing `conversation.input.dock` list slot (id `armazi-hud`, order 5).
// Reads EXISTING session state only: useChat selector hook + standard projections
// (sessionStats, tokenUsage, contextPressure, todos, subagentCatalog).
// Zero model-side changes: no tools, no prompt text, no LLM calls; CSS-only animation.
window.__ModuleLoader__.load({
	id: "armazi-hud",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let jsxRuntime = require("react/jsx-runtime");
		const { useState, useEffect } = react;
		const jsx = jsxRuntime.jsx;
		const jsxs = jsxRuntime.jsxs;

		const NS = "runtimeHud";
		const DASH = "—";
		const MAX_PREVIEW = 1200;
		// how long the final mm:ss stays on the minimized compaction chip after
		// the run ends ("×1 + 05:14" → "×1"); user spec 2026-10-26
		const CP_HOLD_MS = 3000;

		// --------------------------------------------- user view state (persisted)
		// The collapsed (compact) strip is the DEFAULT display; the user's
		// open/close preference persists per browser via localStorage.
		// Every access is guarded: blocked/missing storage must never break the HUD.
		const HKEY = "dsh.runtimeHud.open";
		function storageBox() {
			try {
				const g = (typeof window !== "undefined" && window) || (typeof globalThis !== "undefined" ? globalThis : null);
				const ls = g && g.localStorage;
				if (ls && typeof ls.getItem === "function" && typeof ls.setItem === "function") return ls;
			} catch { /* guarded */ }
			return null;
		}
		function readOpen() {
			const ls = storageBox();
			if (!ls) return false;
			try {
				const v = ls.getItem(HKEY);
				if (v === "1") return true;
				if (v === "0") return false;
			} catch { /* guarded */ }
			return false;
		}
		function writeOpen(open) {
			const ls = storageBox();
			if (ls) { try { ls.setItem(HKEY, open ? "1" : "0"); } catch { /* guarded */ } }
		}

		// ------------------------------------------------------------- en dict
		const EN = {
			"thinking": "Thinking",
			"todo.complete": "complete",
			"todo.current": "current",
			"todo.pending": "pending",
			"tools.none": "no tool activity yet",
			"activity.streaming": "streaming",
			"compaction": "compaction",
			"compaction.running": "compacting…",
			"hud.open": "details",
			"hud.close": "hide details"
		};

		// ------------------------------------------------------------ helpers
		function num(x) {
			return typeof x === "number" && Number.isFinite(x) ? x : null;
		}
		function compactMs(ms) {
			const v = num(ms);
			if (v == null || v <= 0) return DASH;
			const s = v / 1000;
			if (s < 60) return (Math.round(s * 10) / 10) + "s";
			const m = Math.floor(s / 60);
			return m + "m" + Math.round(s % 60) + "s";
		}
		function mmss(ms) {
			const s = Math.max(0, Math.round(((num(ms) ?? 0)) / 1000));
			return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
		}
		// Live compaction signal WITH a start timestamp.
		// Sources (first match, newest start wins):
		//  1. runningCalls[] entry named *compact* — its `time` is the start
		//     (ms epoch, already confirmed present on the DSH client).
		//  2. turnTimings entry whose purpose text says compaction: the
		//     Chat/Trajectory "Compaction · Turn N" request, shown as
		//     Pending with a Started timestamp and no Duration while running.
		//     Only PENDING turns count (finished ones carry an end time).
		// Returns { startedAt: ms } or null. Every access guarded.
		function detectCompactionStartTime(running, timings) {
			const now = Date.now();
			let live = false;
			let best = null;
			const consider = (st) => {
				const v = num(st);
				if (v == null || v <= 0 || v > now) return;
				if (best == null || v > best) best = v;
			};
			for (const c of running || []) {
				if (!c || typeof c !== "object") continue;
				if (typeof c.name === "string" && /compact/i.test(c.name)) {
					live = true;
					consider(num(c.time) ?? num(c.startTime) ?? num(c.startedAt) ?? num(c.start));
				}
			}
			if (timings && typeof timings.forEach === "function") {
				try {
					timings.forEach((v) => {
						if (!v || typeof v !== "object") return;
						const marker = [v.purpose, v.kind, v.type, v.name, v.label, v.title, v.role, v.reason]
							.filter((x) => typeof x === "string").join(" ");
						if (!marker || !/compact/i.test(marker)) return;
						const ended = num(v.endTime) ?? num(v.endedAt) ?? num(v.end);
						if (ended != null) return; // that request finished → not the live one
						live = true;
						consider(num(v.startTime) ?? num(v.startedAt) ?? num(v.start) ?? num(v.time));
					});
				} catch { /* guarded */ }
			}
			return live ? { startedAt: best != null ? best : now } : null;
		}
		// Live compaction signal from the Trajectory (PRIMARY source, 2026-10-26
		// work order): the most recent compaction request still running (status
		// 'running' ⇔ completedAt === null per the harness lifetime contract).
		// Returns { startedAt: ms, startSeq: number|null } or null. Every field
		// access guarded; malformed entries are skipped, never thrown.
		function detectCompactionFromRequests(requests) {
			if (!requests || typeof requests.length !== "number") return null;
			let best = null;
			try {
				for (let i = 0; i < requests.length; i++) {
					const r = requests[i];
					if (!r || typeof r !== "object") continue;
					if (r.purpose !== "compaction" || r.status !== "running") continue;
					const st = num(r.startedAt);
					if (st == null || st <= 0) continue;
					const seq = num(r.startSeq);
					if (best == null) {
						best = { startedAt: st, startSeq: seq };
					} else if (seq != null && (best.startSeq == null || seq > best.startSeq)) {
						best = { startedAt: st, startSeq: seq };
					}
				}
			} catch {
				return null;
			}
			return best;
		}
		// Exact end of a just-ended compaction, when it is still visible in the
		// current trajectory requests (matched by startedAt, falling back to
		// startSeq): the harness-recorded completedAt lets the hold window
		// freeze the EXACT duration instead of wall-clock at detection time.
		// Returns finite ms or null. Never throws.
		function compactionEndFromTrajectory(traj, startedAt, startSeq) {
			try {
				if (!traj || typeof traj !== "object") return null;
				const reqs = traj.requests;
				if (!reqs || typeof reqs.length !== "number") return null;
				const sa = num(startedAt);
				const sq = num(startSeq);
				if (sa == null && sq == null) return null;
				for (let i = 0; i < reqs.length; i++) {
					const r = reqs[i];
					if (!r || typeof r !== "object") continue;
					if (r.purpose !== "compaction") continue;
					let hit = (sa != null && num(r.startedAt) === sa);
					if (!hit && sq != null) hit = (num(r.startSeq) === sq);
					if (!hit) continue;
					const en = num(r.completedAt);
					if (en != null) return en;
				}
			} catch { /* never throw */ }
			return null;
		}
		function tokText(n) {
			const v = num(n);
			if (v == null) return DASH;
			if (v >= 1e6) return (v / 1e6).toFixed(1) + "M";
			if (v >= 1e3) return (v / 1e4 >= 1 ? (v / 1e3).toFixed(0) : (v / 1e3).toFixed(1)) + "k";
			return String(Math.round(v));
		}

		// Tool categories (fixed list per spec; first regex match wins).
		const CATEGORIES = [
			{ key: "read", icon: "📄", label: "read", re: /^(read|read_file|open_file|show_file|view)$/ },
			{ key: "search", icon: "🔎", label: "search", re: /^(grep|rg|glob|search|find|ls|list|list_files)$/ },
			{ key: "web", icon: "🌐", label: "web", re: /^(web_search|web_fetch|http_get|browse|fetch)$/ },
			{ key: "bash", icon: "⚙", label: "bash", re: /^(bash|sh|shell|run|exec|execute|command|terminal)$/ },
			{ key: "edit", icon: "✏", label: "write/edit", re: /^(write|write_file|create_file|edit|edit_file|patch|replace|update_file)$/ },
			{ key: "subagent", icon: "🤖", label: "subagent", re: /^(subagent|spawn|delegate|fork)$/ },
			{ key: "approval", icon: "🛡", label: "approval", re: /^(approve|ask_user|request_approval|confirm|permission)$/ },
			{ key: "compaction", icon: "🗜", label: "compaction", re: /^(compact|compaction|condense)$/ },
			{ key: "verify", icon: "✅", label: "verification", re: /^(test|verify|check|lint|validate)$/ }
		];
		function categoryOf(name) {
			if (typeof name !== "string") return null;
			for (const c of CATEGORIES) if (c.re.test(name)) return c;
			return null;
		}

		// PartialArguments readers — every call guarded; the API is total-shaped
		// (keys/has/complete/text/textPrefix/stringLength) and returns undefined
		// when a key is absent, so no throws are expected.
		function argText(args, key) {
			if (args && typeof args.text === "function") {
				try { const v = args.text(key); return typeof v === "string" ? v : ""; } catch { return ""; }
			}
			return "";
		}
		function argLen(args, key) {
			if (args && typeof args.stringLength === "function") {
				try { return num(args.stringLength(key)); } catch { return null; }
			}
			return null;
		}
		function argPrefix(args, key, max) {
			if (args && typeof args.textPrefix === "function") {
				try { const v = args.textPrefix(key, max); return typeof v === "string" ? v : ""; } catch { return ""; }
			}
			return "";
		}
		function argHas(args, key) {
			if (args && typeof args.has === "function") {
				try { return args.has(key) === true; } catch { return false; }
			}
			return false;
		}
		function fileTarget(args) {
			return argText(args, "file_path") || argText(args, "path") || argText(args, "target_file") || "";
		}
		function previewKeyOf(args) {
			if (!args) return "";
			if (argHas(args, "content")) return "content";
			if (argHas(args, "new_string")) return "new_string";
			if (argHas(args, "patch")) return "patch";
			return "";
		}
		function rowSize(args) {
			if (!args) return null;
			const c = argLen(args, "content");
			if (c != null) return c;
			const a = argLen(args, "new_string");
			const o = argLen(args, "old_string");
			if (a == null && o == null) return null;
			return (a ?? 0) + (o ?? 0);
		}
		function rowPreview(args) {
			const k = previewKeyOf(args);
			return k ? argPrefix(args, k, MAX_PREVIEW) : "";
		}
		function editCounts(args) {
			const alen = argLen(args, "old_string");
			const nlen = argLen(args, "new_string");
			if (alen == null && nlen == null) return null;
			return { del: alen ?? 0, add: nlen ?? 0 };
		}

		// -------------------------------------------------------- derivations
		function lastAssistant(nodes) {
			for (let i = nodes.length - 1; i >= 0; i--) {
				const n = nodes[i];
				if (n && n.kind === "assistant") return n;
			}
			return null;
		}
		function lastReasoningText(partial, nodes) {
			const blocks = partial && Array.isArray(partial.blocks) ? partial.blocks : null;
			if (blocks) {
				for (let i = blocks.length - 1; i >= 0; i--) {
					const b = blocks[i];
					if (b && b.kind === "reasoning" && typeof b.text === "string" && b.text.trim()) return b.text;
				}
			}
			const la = lastAssistant(nodes);
			if (la && Array.isArray(la.blocks)) {
				for (let i = la.blocks.length - 1; i >= 0; i--) {
					const b = la.blocks[i];
					if (b && b.kind === "reasoning" && typeof b.text === "string" && b.text.trim()) return b.text;
				}
			}
			return "";
		}
		function metaOf(nodes) {
			const la = lastAssistant(nodes) || {};
			let model = "";
			try { model = la.providerMetadata && String(la.providerMetadata.model || ""); } catch { model = ""; }
			if (!model) { try { model = la.requestConfig ? String(la.requestConfig.model || "") : ""; } catch { model = ""; } }
			let reasoning = "";
			try {
				const rc = la.requestConfig || {};
				reasoning = rc.reasoningEffort ? String(rc.reasoningEffort) : "";
				if (!reasoning && rc.thinking != null) reasoning = String(rc.thinking);
			} catch { reasoning = ""; }
			return { model: model || DASH, reasoning: reasoning || DASH };
		}
		function lastTurnDuration(timings) {
			if (!timings || typeof timings.forEach !== "function") return DASH;
			let bestTurn = null;
			let bestMs = null;
			try {
				timings.forEach((v, turn) => {
					const st = num(v && v.startTime);
					const en = num(v && v.endTime);
					const t = num(turn);
					if (st != null && en != null && en > st && (bestTurn == null || (t != null && t > bestTurn))) {
						bestTurn = t == null ? bestTurn : t;
						bestMs = en - st;
					}
				});
			} catch { return DASH; }
			return bestMs != null ? compactMs(bestMs) : DASH;
		}
		function buildToolRows(nodes, running) {
			const rows = [];
			const byKey = new Map();
			for (let i = nodes.length - 1; i >= 0; i--) {
				const n = nodes[i];
				if (!n || n.kind !== "tool-result") continue;
				const name = n.name || "tool";
				const cat = categoryOf(name);
				const key = cat ? cat.key : ("other:" + name);
				if (byKey.has(key)) {
					const r = byKey.get(key);
					r.count += 1;
					continue;
				}
				const row = {
					key,
					count: 1,
					active: false,
					name,
					icon: cat ? cat.icon : "•",
					label: cat ? cat.label : name,
					isError: !!n.isError,
					durationMs: (num(n.callTime) != null && num(n.time) != null) ? Math.max(0, num(n.time) - num(n.callTime)) : null,
					path: fileTarget(n.args),
					size: rowSize(n.args),
					preview: rowPreview(n.args),
					edit: editCounts(n.args)
				};
				byKey.set(key, row);
				rows.push(row);
			}
			for (const c of running) {
				if (!c || typeof c.name !== "string") continue;
				const cat = categoryOf(c.name);
				if (!cat) continue;
				const info = {
					name: c.name,
					path: fileTarget(c.args),
					size: rowSize(c.args),
					preview: rowPreview(c.args),
					edit: editCounts(c.args)
				};
				const ex = byKey.get(cat.key);
				if (ex) {
					ex.active = true;
					if (info.path) ex.path = info.path;
					if (info.size != null) ex.size = info.size;
					if (info.preview) ex.preview = info.preview;
					if (info.edit) ex.edit = info.edit;
				} else {
					const row = {
						key: cat.key, count: 1, active: true,
						name: c.name, icon: cat.icon, label: cat.label,
						isError: false, durationMs: null,
						...info
					};
					byKey.set(cat.key, row);
					rows.push(row);
				}
			}
			return rows;
		}
		function todoBuckets(todos) {
			const b = { done: 0, cur: 0, pend: 0 };
			for (const t of todos || []) {
				if (!t || typeof t.status !== "string") continue;
				if (t.status === "completed") b.done += 1;
				else if (t.status === "in_progress") b.cur += 1;
				else if (t.status === "pending") b.pend += 1;
			}
			return b;
		}
		function currentTodo(todos) {
			for (const t of todos || []) {
				if (t && t.status === "in_progress" && typeof t.content === "string" && t.content.trim()) {
					const s = t.content.replace(/\s+/g, " ").trim();
					return s.length > 56 ? s.slice(0, 56) + "…" : s;
				}
			}
			return "";
		}

		// ------------------------------------------------------------ styles
		// Subtle CSS-only animation (pulsing dot) + CSS transitions for expansion.
		const CSS =
			".rhud{display:flex;flex-direction:column;width:100%;max-width:100%;min-width:0;min-height:36px;box-sizing:border-box;overflow:hidden;gap:7px;padding:8px 10px;border:1px solid rgba(127,127,127,.3);border-radius:10px;background:rgba(127,127,127,.07);margin:8px 8px 2px;font-size:13px;line-height:1.45;color:inherit}" +
			".rhud-top,.rhud-metrics,.rhud-line,.rhud-todos{display:flex;align-items:center;gap:4px 12px;flex-wrap:wrap;min-width:0}" +
			".rhud-btn{display:inline-flex;align-items:center;gap:8px;background:none;border:0;padding:0;font:inherit;color:inherit;cursor:pointer;max-width:100%;text-align:left}" +
			".rhud-btn:hover .rhud-ellipsis,.rhud-line:hover .rhud-nm{opacity:1}" +
			".rhud-dot{width:7px;height:7px;border-radius:50%;background:currentColor;opacity:.45;flex:none}" +
			".rhud-dot-live{animation:rhud-pulse 1.4s ease-in-out infinite}" +
			"@keyframes rhud-pulse{0%,100%{opacity:.3;transform:scale(.85)}50%{opacity:1;transform:scale(1.15)}}" +
			".rhud-ellipsis{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:46vw;min-width:0;opacity:.85}" +
			".rhud-chev{opacity:.6;flex:none}" +
			".rhud-clamp{overflow:hidden;max-height:0;opacity:0;transition:max-height .28s ease,opacity .18s ease;min-width:0;flex:1 1 100%}" +
			".rhud-clamp.open{max-height:260px;opacity:1;overflow:auto}" +
			".rhud-clamp-in{padding:2px 0 2px 18px;white-space:pre-wrap;word-break:break-word;font-size:.96em;opacity:.92}" +
			".rhud-m{display:inline-flex;gap:4px;align-items:baseline;white-space:nowrap}" +
			".rhud-m .k{opacity:.55;font-size:.92em}" +
			".rhud-m .v{opacity:.95}" +
			".rhud-todos{gap:10px}" +
			".rhud-tools{display:flex;flex-direction:column;gap:2px;min-width:0}" +
			".rhud-item{min-width:0}" +
			".rhud-line{cursor:default}" +
			".rhud-item button.rhud-line{width:100%;cursor:pointer;background:none;border:0;padding:0;font:inherit;color:inherit;text-align:left}" +
			".rhud-nm{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:52vw;opacity:.95}" +
			".rhud-count,.rhud-t,.rhud-prev{opacity:.62;white-space:nowrap;font-size:.92em}" +
			".rhud-prev{overflow:hidden;text-overflow:ellipsis;max-width:44vw;display:inline-block;vertical-align:baseline}" +
			".rhud-item.err .rhud-nm{color:#b3403a;opacity:1}" +
			".rhud-item.err .rhud-count{color:#b3403a;opacity:.8}" +
			".rhud-empty{opacity:.55;padding:2px 0}" +
			".rhud-live{opacity:.75}" +
			".rhud-collapsed{padding:4px 9px;gap:4px}" +
			"/* 2026-10-29: the expanded view needs its OWN floor: the base 36px .rhud floor is sized for the collapsed strip, so in the hero phase the expanded view is squashed to that floor (overflow:hidden implies min-main-size 0) and its 2nd/3rd lines including the close toggle clip. 96px = combined expanded content, worst cascade (18.85 + 18.85 + (18.85+4) + 2*7 gaps + 16 padding + 2 border = 92.55, padded for line rounding). */" +
			".rhud:not(.rhud-collapsed){min-height:96px}" +
			".rhud-tog{display:inline-flex;align-items:center;gap:4px;opacity:.8;border:1px solid rgba(127,127,127,.35);border-radius:6px;padding:1px 8px;background:none;font:inherit;color:inherit;white-space:nowrap;cursor:pointer;flex:none}" +
			".rhud-tog:hover{opacity:1;background:rgba(127,127,127,.08)}" +
			".rhud-chip{display:inline-flex;flex:0 1 auto;align-items:center;gap:6px;min-width:0;max-width:100%;overflow:hidden;padding:1px 9px;border-radius:999px;background:rgba(127,127,127,.09);white-space:nowrap}" +
			".rhud-chip .n{opacity:.9;font-variant-numeric:tabular-nums}" +
			".rhud-chip .rhud-dot{opacity:.9}" +
			".rhud-cc-thinking{color:#ff8fab}" +
			".rhud-cc-read{color:#58a6ff}" +
			".rhud-cc-search{color:#39c5cf}" +
			".rhud-cc-web{color:#a371f7}" +
			".rhud-cc-bash{color:#ffa657}" +
			".rhud-cc-edit{color:#56d364}" +
			".rhud-cc-subagent{color:#f778ba}" +
			".rhud-cc-approval{color:#e3b341}" +
			".rhud-cc-verify{color:#7ee787}" +
			".rhud-cc-other{color:#8b949e}" +
			".rhud-cc-cp{color:#e3b341}" +
			".rhud-bar{display:inline-block;width:16px;height:9px;border-radius:3px;background:repeating-linear-gradient(45deg,#e3b341 0 4px,rgba(227,179,65,.4) 4px 8px);box-shadow:0 0 6px rgba(227,179,65,.5);animation:rhud-pulse 1.2s ease-in-out infinite;flex:none;margin-right:4px}" +
			".rhud-chip.rhud-live{background:rgba(127,127,127,.16)}" +
			".rhud-has-active .rhud-chip:not(.rhud-live){filter:grayscale(1);opacity:.55}" +
			".rhud-chip.rhud-sleep{opacity:.35;filter:grayscale(1)}" +
			".rhud-has-active .rhud-chip.rhud-sleep{opacity:.35;filter:grayscale(1)}" +
			".rhud-chip.rhud-sleep .rhud-dot-live{animation:none}" +
			".rhud-compacting .rhud-chip.rhud-cc-thinking{opacity:1;filter:none}" +
			".rhud-ic-live{display:inline-block;animation:rhud-pulse 1.4s ease-in-out infinite}" +
			".rhud-wb{height:3px;width:46px;border-radius:2px;background:rgba(127,127,127,.18);overflow:hidden;flex:none}" +
			".rhud-wb i{display:block;height:100%;background:currentColor;border-radius:2px;transition:width .3s ease}" +
			".rhud-line .rhud-nm{color:#f0f6fc;font-weight:500}" +
			".rhud-line .rhud-t{opacity:.9;color:#c9d1d9}" +
			".rhud-line .rhud-prev{opacity:.95;color:#c9d1d9}" +
			".rhud-liveflag{color:#ff8fab}" +
			"@media (max-width:640px){.rhud{font-size:12px;gap:6px}.rhud-ellipsis,.rhud-nm,.rhud-prev{max-width:36vw}.rhud-collapsed{padding:3px 7px}}" +
			"/* fit + auto-size: the strip fills (never exceeds) its dock, chips wrap/truncate, and at narrow dock widths it compacts itself */" +
			".rhud{container-type:inline-size}" +
			"@container (max-width:720px){.rhud{font-size:12px;padding:6px 8px;gap:5px}.rhud-top,.rhud-metrics{gap:3px 8px}.rhud-chip{padding:0 6px;gap:4px}.rhud-top,.rhud-metrics{flex-wrap:wrap;min-width:0}}" +
			"@container (max-width:480px){.rhud{font-size:11px;padding:5px 7px}.rhud-chip{gap:3px;padding:0 5px}.rhud-tog{padding:0 6px}}";

		function ensureCss() {
			if (typeof document === "undefined") return;
			try {
				if (document.querySelector('style[data-plugin-css="armazi-hud"]') !== null) return;
				const tag = document.createElement("style");
				tag.dataset.plugin = "armazi-hud";
				tag.dataset.pluginCss = "armazi-hud";
				tag.textContent = CSS;
				document.head.appendChild(tag);
			} catch { /* non-fatal: HUD still renders, unstyled */ }
		}

		// ------------------------------------------------------------ component
		function RuntimeHud(props) {
			const useChat = props && props.useChat;
			const useProjection = props && props.useProjection;
			const useTrajectory = props && props.useTrajectory;
			const t = props && props.t;
			if (typeof useChat !== "function" || typeof useProjection !== "function") return null;

			const label = (key) => {
				const v = typeof t === "function" ? t(key) : null;
				if (typeof v === "string" && v && v !== key) return v;
				return EN[key] || key;
			};

			const snapshot = useChat((s) => s);
			// useTrajectory — session-standard props extension on
			// conversation.input.dock (same standardProps list that carries
			// useChat/useProjection). Its requests are the authoritative
			// live-compaction signal (2026-10-26 work order); the timer reads
			// from them first and keeps the legacy detector as fallback.
			// Prop presence is stable for the slot lifetime, and the call is
			// degraded so an absent or throwing implementation can never
			// unmount the strip.
			let traj = null;
			if (typeof useTrajectory === "function") {
				try { traj = useTrajectory((s) => s) || null; } catch { traj = null; }
			}
			const legacy = (snapshot && snapshot.legacy) || {};
			const nodes = Array.isArray(legacy.nodes) ? legacy.nodes : [];
			const partial = legacy.partial || null;
			const running = Array.isArray(legacy.runningCalls) ? legacy.runningCalls : [];
			const turnTimings = legacy.turnTimings || null;

			const stats = useProjection("sessionStats") || null;
			const pressure = useProjection("contextPressure") || null;
			const todos = useProjection("todos") ?? [];
			const catalog = useProjection("subagentCatalog") ?? [];

			const [thinkingOpen, setThinkingOpen] = useState(false);
			const [openRow, setOpenRow] = useState(null);
			const [open, setOpen] = useState(readOpen);
			const [tick, setTick] = useState(0); // re-render token for the 1s live mm:ss
			void tick;

			// thinking
			const thinkingText = lastReasoningText(partial, nodes);
			const thinkingLive = !!(partial && Array.isArray(partial.blocks) &&
				partial.blocks.some((b) => b && b.kind === "reasoning"));
			const thinkingInline = thinkingText ? (() => {
				const s = thinkingText.replace(/\s+/g, " ").trim();
				return s.length > 90 ? s.slice(0, 90) + "…" : s;
			})() : "";

			// metrics
			const meta = metaOf(nodes);
			const tokps = stats && num(stats.decodeMs) > 0 && num(stats.decodeTokens) != null
				? (num(stats.decodeTokens) / (num(stats.decodeMs) / 1000)).toFixed(1)
				: DASH;
			let ctxText = DASH;
			try {
				const pt = num(pressure && pressure.pressureTokens);
				const cw = num(pressure && pressure.contextWindow);
				if (pt != null && cw != null && cw > 0) {
					ctxText = tokText(pt) + "/" + tokText(cw) + " · " + Math.min(999, Math.round((pt / cw) * 100)) + "%";
				} else if (pt != null) ctxText = tokText(pt);
			} catch { ctxText = DASH; }
			const turnText = lastTurnDuration(turnTimings);
			const subsText = Array.isArray(catalog) && catalog.length > 0
				? catalog.length + " · " + catalog.slice(0, 3).map((s) => (s && (s.label ? String(s.label) : (s.mode ? String(s.mode) : "child")))).join(", ")
				: DASH;

			// tools
			const rows = buildToolRows(nodes, running);
			const activeRow = rows.find((r) => r.active) || null;
			let activity;
			if (activeRow) activity = activeRow.name + (activeRow.path ? " · " + activeRow.path : "");
			else if (partial) activity = label("activity.streaming");
			else if (running.length > 0) activity = String(running.length) + " running";
			else activity = DASH;
			// compaction — user spec (2026-10-26): while a compaction runs the
			// minimized chip shows a yellow dot + "×N + mm:ss" (mm:ss ticks
			// from the actual start timestamp); when it ends the FINAL mm:ss
			// stays frozen for CP_HOLD_MS, then the timer disappears leaving
			// the bumped count ("×1 + 05:14" → "×1").
			const compactCount = nodes.reduce((acc, n) => (n && n.kind === "compaction") ? acc + 1 : acc, 0);
			// PRIMARY: the trajectory compaction request (exact startedAt; live
			// while status 'running'). FALLBACK: the legacy
			// runningCalls/turnTimings detector — structurally dead against the
			// current harness contract, kept unchanged as a pure guard for
			// degraded builds where useTrajectory is absent.
			const trCp = detectCompactionFromRequests(traj && traj.requests);
			const cpLive = trCp || detectCompactionStartTime(running, turnTimings);
			const compactive = cpLive != null;
			const cpt = (() => {
				// Per-session bookkeeping (2026-10-27 fix): this state machine
				// used to live on one module-scope singleton (RuntimeHud.__cp).
				// The browser reuses the same bundle for every session, so a
				// fresh session inherited the previous one's `completed`
				// counter (Math.max below then showed ×N on a brand-new chat).
				// Now keyed by the slot's standard `sessionId` prop when
				// present; the stable default key preserves the legacy
				// behavior on degraded builds that omit the prop.
				const rawSid = props && props.sessionId;
				const sid = (typeof rawSid === "string" && rawSid !== "") ? rawSid
					: (typeof rawSid === "number" && Number.isFinite(rawSid)) ? String(rawSid) : null;
				const key = sid != null ? "sid:" + sid : "default";
				const box = RuntimeHud.__cpBox;
				if (box && typeof box === "object" && box.key === key && box.state && typeof box.state === "object") return box.state;
				const nt = { active: false, startedAt: null, startSeq: null, baseAtStart: 0, completed: 0, endedAt: null, finalElapsedMs: null };
				RuntimeHud.__cpBox = { key, state: nt };
				return nt;
			})();
			if (compactive) {
				if (!cpt.active) {
					cpt.active = true;
					cpt.baseAtStart = compactCount;
					cpt.startedAt = cpLive.startedAt;
					cpt.startSeq = (trCp && num(trCp.startSeq) != null) ? trCp.startSeq : null;
					cpt.finalElapsedMs = null;
					cpt.endedAt = null;
				}
			} else if (cpt.active) {
				const endedNow = Date.now();
				// Exact freeze (2026-10-26): when the just-ended request is still
				// visible in the trajectory, freeze at the harness-recorded
				// exact duration (completedAt − startedAt); otherwise fall back
				// to wall-clock at end-detection (legacy detection path).
				const exactEnd = compactionEndFromTrajectory(traj, cpt.startedAt, cpt.startSeq);
				cpt.finalElapsedMs = exactEnd != null
					? Math.max(0, exactEnd - cpt.startedAt)
					: Math.max(0, endedNow - cpt.startedAt);
				cpt.active = false;
				cpt.startedAt = null;
				cpt.startSeq = null;
				cpt.endedAt = endedNow;
				cpt.completed = Math.max(cpt.completed, cpt.baseAtStart + 1);
			}
			const holdActive = cpt.endedAt != null && cpt.finalElapsedMs != null
				&& (Date.now() - cpt.endedAt) < CP_HOLD_MS;
			const compactDisplayCount = compactive ? compactCount : Math.max(compactCount, cpt.completed);
			const compactElapsed = cpt.active && cpt.startedAt != null ? Math.max(0, Date.now() - cpt.startedAt) : null;
			// the mm:ss shown in the minimized chip: live now, or frozen final
			// during the hold window, or null (plain ×N)
			const cpTimer = compactive ? compactElapsed : (holdActive ? cpt.finalElapsedMs : null);
			const timerVisible = compactive || holdActive;

			// live ticking: 1s re-render while the run is live or in the hold
			// window; the interval is cleared as soon as neither is true, so
			// the HUD is fully idle when there is nothing to show.
			useEffect(() => {
				if (!timerVisible) return;
				const g = (typeof globalThis !== "undefined") ? globalThis
					: (typeof window !== "undefined" ? window : null);
				let h = null;
				try {
					if (g && typeof g.setInterval === "function") {
						h = g.setInterval(() => {
							try { setTick((v) => ((v % 100000) + 1)); } catch { /* ignore */ }
						}, 1000);
					}
				} catch { h = null; }
				if (h == null || !g) return;
				return () => { try { if (typeof g.clearInterval === "function") g.clearInterval(h); } catch { /* ignore */ } };
			}, [timerVisible]);

			// todos
			const tb = todoBuckets(todos);
			const todoCurrent = currentTodo(todos);

			// ------------------------------------------------ close / open toggle
			const toggleBtn = jsx("button", {
				key: "tog",
				type: "button",
				className: "rhud-tog",
				"data-rhud": "toggle",
				"aria-label": open ? label("hud.close") : label("hud.open"),
				onClick: () => { const next = !open; setOpen(next); writeOpen(next); },
				children: (open ? "▾ " : "▸ ") + label(open ? "hud.close" : "hud.open")
			});
			// ------------------------------------------------- dot-minimized strip
			// One color-coded dot per type + a count; the dot blinks (CSS pulse)
			// while that type is active. No verbose data in minimized mode.
			function dotChip(key, cls, title, count, live) {
				return jsxs("span", {
					key: "chip-" + key,
					className: "rhud-chip " + cls + (live ? " rhud-live" : ""),
					"data-rhud": "chip-" + key,
					"title": title,
					children: [
						jsx("span", { className: "rhud-dot" + (live ? " rhud-dot-live" : "") }),
						count != null ? jsx("span", { className: "n", children: "×" + count }) : null
					]
				});
			}
			const catCls = (k) => "rhud-cc-" + ((k && k.indexOf("other:") !== 0) ? k : "other");
			// thinking = a state: its dot blinks while thinking is live
			const thinkingChip = dotChip("thinking", "rhud-cc-thinking", label("thinking"), null, thinkingLive);
			// minimized chip (user spec 2026-10-26): yellow dot + ×N always;
			// the live mm:ss timer sits right next to the count while the
			// compaction runs ("×0 + 00:01"); after it ends the FINAL mm:ss
			// stays frozen for CP_HOLD_MS ("×1 + 05:14"), then the timer
			// disappears leaving only the bumped count ("×1").
			const compactionChipMin = jsxs("span", {
				key: "chip-compact",
				className: "rhud-chip rhud-cc-cp" + (cpTimer != null ? " rhud-live" : ""),
				"data-rhud": cpTimer != null ? "compacting" : "compaction",
				"title": label("compaction") + " ×" + compactDisplayCount + (cpTimer != null ? " + " + mmss(cpTimer) : ""),
				children: [
					jsx("span", { className: "rhud-dot" + (compactive ? " rhud-dot-live" : "") }),
					jsx("span", { className: "n", children: "×" + compactDisplayCount + (cpTimer != null ? " + " + mmss(cpTimer) : "") })
				]
			});
			// expanded view keeps the previous yellow bar chip while the run is live
			const compactionEl = compactive
				? jsx("span", {
					key: "chip-compact",
					className: "rhud-chip rhud-cc-cp rhud-live",
					"data-rhud": "compacting",
					children: [
						jsx("span", { className: "rhud-bar" }),
						" " + label("compaction.running") + " ×" + compactDisplayCount + " + " + mmss(compactElapsed)
					]
				})
				: dotChip("compaction", "rhud-cc-cp", label("compaction"), compactDisplayCount, false);
			const rowChips = rows.map((r) => dotChip(r.key, catCls(r.key) + (compactive && r.key !== "compaction" ? " rhud-sleep" : ""), r.label || r.name || "tool", r.count, r.active || false));
			// while anything is live, inactive chips desaturate to grayscale so
			// the active one(s) keep the color and stand out
			const anyLive = thinkingLive || compactive || rows.some((r) => r.active);

			function metric(key, icon, value) {
				return jsx("span", {
					key: "m" + key,
					className: "rhud-m",
					"data-rhud": key,
					children: [
						jsx("span", { className: "k", children: icon + " " }),
						jsx("span", { className: "v", children: value })
					]
				});
			}

			const maxCount = rows.reduce((m, r) => Math.max(m, r.count), 1);
			function toolItem(row, i) {
				const expandable = typeof row.preview === "string" && row.preview.length > 0;
				const open = openRow === row.key;
				const inline = expandable
					? (row.preview.length > 130 ? row.preview.slice(0, 130) + "…" : row.preview)
					: "";
				// same icon + color language as the minimized chips; the bar is a
				// static CSS width (no JS animation), readable text alongside
				const bits = [];
				bits.push(jsx("span", { key: "icon", className: "ic" + (row.active ? " rhud-ic-live" : ""), children: row.icon }));
				bits.push(jsx("span", { key: "nm", className: "rhud-nm", children: row.name }));
				bits.push(jsx("span", { key: "ct", className: "rhud-count", children: "×" + row.count }));
				bits.push(jsx("span", { key: "wb", className: "rhud-wb", children: [ jsx("i", { style: { width: Math.round((100 * row.count) / maxCount) + "%" } }) ] }));
				if (row.active) bits.push(jsx("span", { key: "lv", className: "rhud-liveflag", children: "●" }));
				if (row.durationMs != null) bits.push(jsx("span", { key: "du", className: "rhud-t", children: compactMs(row.durationMs) }));
				if (row.size != null) bits.push(jsx("span", { key: "sz", className: "rhud-t", children: tokText(row.size) + "ch" }));
				if (row.edit) bits.push(jsx("span", { key: "ed", className: "rhud-t", children: "+" + row.edit.add + " −" + row.edit.del }));
				if (row.path) bits.push(jsx("span", { key: "pa", className: "rhud-prev", children: row.path }));
				if (inline) bits.push(jsx("span", { key: "pv", className: "rhud-prev", children: "“" + inline + "”" }));

				const lineEl = expandable
					? jsx("button", {
						key: "btn",
						type: "button",
						className: "rhud-line",
						"aria-expanded": open,
						onClick: () => setOpenRow(open ? null : row.key),
						children: bits
					})
					: jsx("div", { key: "div", className: "rhud-line", children: bits });

				return jsxs("div", {
					key: "item" + i,
					className: "rhud-item " + catCls(row.key) + (row.isError ? " err" : "") + (row.active ? " live" : ""),
					children: [
						lineEl,
						expandable
							? jsx("div", {
								className: "rhud-clamp" + (open ? " open" : ""),
								children: jsx("div", { className: "rhud-clamp-in", children: row.preview.slice(0, MAX_PREVIEW) })
							})
							: null
					]
				});
			}

			// ------------------------------------------------ collapsed (default view)
			if (!open) {
				return jsx("div", {
					className: "rhud rhud-collapsed",
					role: "status",
					"aria-label": "Runtime HUD",
					"aria-expanded": false,
					children: [
						jsxs("div", {
							key: "chips",
							className: "rhud-metrics" + (anyLive ? " rhud-has-active" : "") + (compactive ? " rhud-compacting" : ""),
							children: [thinkingChip, compactionChipMin, ...rowChips, toggleBtn]
						})
					]
				});
			}

			// ------------------------------------------------------ expanded view
			return jsxs("div", {
				className: "rhud",
				role: "status",
				"aria-label": "Runtime HUD",
				"aria-expanded": true,
				children: [
					// line 1 — thinking (collapsed by default; expands to the existing live detail)
					jsxs("div", {
						key: "top",
						className: "rhud-top",
						children: [
							jsxs("button", {
								key: "thb",
								type: "button",
								className: "rhud-btn",
								"aria-expanded": thinkingOpen,
								onClick: () => setThinkingOpen((v) => !v),
								children: [
									jsx("span", { key: "dot", className: "rhud-dot" + (thinkingLive ? " rhud-dot-live" : "") }),
									jsx("span", { key: "lab", children: "🧠 " + label("thinking") }),
									jsx("span", { key: "prev", className: "rhud-ellipsis", children: thinkingInline || DASH }),
									jsx("span", { key: "chev", className: "rhud-chev", children: thinkingOpen ? "▾" : "▸" })
								]
							}),
							jsxs("div", {
								key: "thd",
								className: "rhud-clamp" + (thinkingOpen ? " open" : ""),
								children: jsx("div", { className: "rhud-clamp-in", children: thinkingText || DASH })
							}),
							(tb.done + tb.cur + tb.pend) > 0
								? jsxs("span", {
									key: "tds",
									className: "rhud-todos",
									"aria-label": "Task progress",
									children: [
										jsx("span", { key: "dn", title: label("todo.complete"), children: "✓ " + tb.done }),
										jsx("span", { key: "cu", title: label("todo.current"), children: "● " + tb.cur }),
										jsx("span", { key: "pd", title: label("todo.pending"), children: "○ " + tb.pend }),
										todoCurrent ? jsx("span", { key: "cta", className: "rhud-ellipsis", children: "▸ " + todoCurrent }) : null
									]
								})
								: null
						]
					}),
					// line 2 — runtime metrics (— when unavailable)
					jsxs("div", {
						key: "metrics",
						className: "rhud-metrics",
						children: [
							metric("model", "🧠", meta.model),
							metric("reasoning", "💭", meta.reasoning),
							metric("tokps", "⚡", tokps),
							metric("context", "📈", ctxText),
							metric("turn", "🔄", turnText),
							metric("subs", "🤖", subsText),
							metric("activity", "▸", activity),
							compactive
								? compactionEl
								: metric("compaction", "🗜", compactDisplayCount > 0 ? compactDisplayCount + "×" : DASH),
							toggleBtn
						]
					}),
					// line 3 — tool rows (one per category, existing events only)
					jsxs("div", {
						key: "tools",
						className: "rhud-tools",
						children: rows.length === 0
							? jsx("div", { key: "none", className: "rhud-empty", children: label("tools.none") })
							: rows.map((r, i) => toolItem(r, i))
					})
				]
			});
		}

		// ------------------------------------------------------------ mounting
		function registerUi(ctx) {
			ensureCss();
			ctx.effect(() => ctx.locale.register(NS, { en: EN }), "armazi-hud: locale");
			ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({
				name: "conversation.input.dock",
				id: "armazi-hud",
				order: 5,
				locale: NS
			}, RuntimeHud));
		}

		const SERVICES = ["slots", "locale"];
		async function apply(ctx) {
			const ui = ctx.inject(SERVICES, (child) => registerUi(child));
			try {
				await ui;
			} catch (error) {
				try { await ui.dispose(); } catch { /* already disposed */ }
				throw error;
			}
			return async () => {
				await ui.dispose();
			};
		}

		exports.apply = apply;
		exports.inject = SERVICES;
		exports._component = RuntimeHud; // smoke-test hook, not part of the DSH contract
		return module.exports;
	}
});


//# sourceMappingURL=client.js.map
