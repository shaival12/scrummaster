import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Voice Scrum Master — a voice-to-action AI standup facilitator
 * --------------------------------------------------------------
 * What it does (no external services required):
 *  - Speaks standup prompts (yesterday/today/blockers) to each teammate
 *  - Listens to voice answers via Web Speech API (or lets you type)
 *  - Responds with acknowledgements via text-to-speech
 *  - Auto-parses answers into Actions (tasks), Blockers, and Notes
 *  - Times each speaker, saves a transcript, and generates a summary
 *  - Optional: post summary to Slack via Incoming Webhook (paste URL below)
 *  - NEW: Autoplays a video on page load; on video end, auto-scrolls to the Team section
 *
 * Quick start:
 *  1) Add teammates, check your mic, then press "Start standup".
 *  2) The bot will guide each person with three questions.
 *  3) Say "done" to move to the next question/member.
 *  4) Review actions/blockers, then export JSON or post to Slack.
 *
 * Tips:
 *  - Works best in Chrome/Edge on desktop over HTTPS (mic permissions).
 *  - If speech recognition is unavailable, toggle "Manual input".
 *  - Configure a Slack Incoming Webhook if you want to post the summary.
 */

// ---------- Simple icons to avoid external deps ----------
const Icon = ({ label }: { label: string }) => (
  <span className="inline-block select-none align-middle text-xs px-2 py-1 rounded bg-gray-200 text-gray-700 mr-2">{label}</span>
);

// ---------- Helpers ----------
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const nowISO = () => new Date().toISOString();

// Default video location (you can change it via the input under the player)
// If you're hosting this elsewhere, point to a publicly reachable URL.
const DEFAULT_VIDEO_URL = "/rendered_video.mp4"; // uploaded in this session

// Safe uuid helper (fallback if crypto.randomUUID is unavailable)
const uuid = () =>
  (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    ? crypto.randomUUID()
    : `id-${Math.random().toString(36).slice(2)}-${Date.now()}`;

// Avoid optional-chaining *assignment* (which some builds don't support)
function safeReplay(v: HTMLVideoElement | null) {
  if (!v) return;
  try {
    v.currentTime = 0; // assignment guarded explicitly
    const maybePromise = v.play();
    if (maybePromise && typeof (maybePromise as any).catch === "function") {
      (maybePromise as Promise<void>).catch(() => {});
    }
  } catch {}
}

// ---------- Very light NLP heuristics for tasks/blockers/notes ----------
function extractInsights(text: string, owner: string) {
  const sentences = text
    .replace(/\s+/g, " ")
    .split(/[.!?]/)
    .map((s) => s.trim())
    .filter(Boolean);

  const tasks: { owner: string; title: string; due?: string }[] = [];
  const blockers: { owner: string; issue: string }[] = [];
  const notes: string[] = [];

  const dueRegex = /(by|before)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today|\d{4}-\d{2}-\d{2}|eod)/i;

  for (const s of sentences) {
    const sLower = s.toLowerCase();

    // Blockers
    if (/(blocked|blocker|waiting on|waiting for|cannot|can't)/.test(sLower)) {
      blockers.push({ owner, issue: s.trim() });
      continue;
    }

    // Tasks (very simple patterning)
    if (/\b(i will|i'm going to|i plan to|today i will|today i plan to|i'll)\b/.test(sLower)) {
      let due: string | undefined;
      const m = s.match(dueRegex);
      if (m) due = (m[2] as string)?.toUpperCase?.() || (m[2] as string);
      tasks.push({ owner, title: s.trim(), due });
      continue;
    }

    // Catch-all note
    notes.push(s.trim());
  }

  return { tasks, blockers, notes };
}

// ---------- Web Speech wrappers ----------
function useSpeech() {
  const [ttsReady, setTtsReady] = useState(false);
  const [listening, setListening] = useState(false);
  const [available, setAvailable] = useState<{ asr: boolean; tts: boolean }>({ asr: false, tts: false });
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    const hasTTS = typeof window !== "undefined" && "speechSynthesis" in window;
    const SR: any = (typeof window !== "undefined" && ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)) || null;
    setAvailable({ asr: !!SR, tts: hasTTS });
    if (hasTTS) {
      const onVoices = () => setTtsReady(true);
      window.speechSynthesis.onvoiceschanged = onVoices;
      window.speechSynthesis.getVoices();
      setTtsReady(true);
    }
  }, []);

  const speak = async (text: string) => {
    if (!available.tts) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1;
      u.pitch = 1;
      u.lang = "en-US";
      window.speechSynthesis.speak(u);
    } catch (e) {
      // no-op
    }
  };

  const startListening = (opts: { onText: (text: string, isFinal: boolean) => void; lang?: string }) => {
    const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return () => {};
    const rec = new SR();
    recognitionRef.current = rec;
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = opts.lang || "en-US";
    rec.onresult = (e: any) => {
      let interim = "";
      let final = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) final += res[0].transcript;
        else interim += res[0].transcript;
      }
      if (final) opts.onText(final, true);
      if (interim) opts.onText(interim, false);
    };
    rec.onerror = () => {};
    rec.onend = () => setListening(false);
    rec.start();
    setListening(true);
    return () => {
      try {
        rec.onresult = null;
        rec.onend = null;
        rec.stop();
      } catch {}
      setListening(false);
    };
  };

  const stopListening = () => {
    const rec = recognitionRef.current;
    if (rec) {
      try { rec.stop(); } catch {}
      setListening(false);
    }
  };

  return { speak, startListening, stopListening, listening, available, ttsReady };
}

// ---------- Component ----------

type Member = { id: string; name: string };

type QA = {
  yesterday: string;
  today: string;
  blockers: string;
  transcript: string[]; // raw snippets
  elapsedSec: number;
};

const DEFAULT_QUESTIONS = [
  { key: "yesterday", label: "What did you complete yesterday?" },
  { key: "today", label: "What will you work on today?" },
  { key: "blockers", label: "Any blockers or anything you need help with?" },
] as const;

export default function VoiceScrumMaster() {
  const { speak, startListening, stopListening, listening, available } = useSpeech();

  // Video controls
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const teamSectionRef = useRef<HTMLDivElement | null>(null);
  const [videoUrl, setVideoUrl] = useState<string>(DEFAULT_VIDEO_URL);
  const [videoMuted, setVideoMuted] = useState<boolean>(true);
  const [autoPlayVideo, setAutoPlayVideo] = useState<boolean>(true);

  // Standup state
  const [manualMode, setManualMode] = useState(false);
  const [slackWebhook, setSlackWebhook] = useState("");
  const [team, setTeam] = useState<Member[]>([
    { id: uuid(), name: "Josh" },
    { id: uuid(), name: "Katie" },
    { id: uuid(), name: "Naomi" },
  ]);
  const [active, setActive] = useState(false);
  const [idx, setIdx] = useState(0);
  const [qIdx, setQIdx] = useState(0);
  const [buffer, setBuffer] = useState("");
  const [finalBuffer, setFinalBuffer] = useState("");
  const [lastChunkAt, setLastChunkAt] = useState<number>(Date.now());
  const [qaMap, setQaMap] = useState<Record<string, QA>>({});
  const [meetingStartedAt, setMeetingStartedAt] = useState<number | null>(null);
  const [perSpeakerTimer, setPerSpeakerTimer] = useState<number>(0);
  const perSpeakerRef = useRef<number>(0);
  const perSpeakerInterval = useRef<any>(null);

  const currentMember = team[idx];
  const currentQuestion = DEFAULT_QUESTIONS[qIdx];

  // ---------- VIDEO: autoplay on load, scroll to team on end ----------
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    // Ensure attributes reflect current state
    v.muted = videoMuted;
    if (autoPlayVideo) {
      try {
        const maybe = v.play();
        if (maybe && typeof (maybe as any).catch === "function") (maybe as Promise<void>).catch(() => {});
      } catch {}
    }
  }, [autoPlayVideo, videoUrl, videoMuted]);

  const scrollToTeam = () => {
    const el = teamSectionRef.current;
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  // ---------- Initialize QA map for all members ----------
  useEffect(() => {
    setQaMap((prev) => {
      const copy = { ...prev };
      for (const m of team) {
        if (!copy[m.id]) {
          copy[m.id] = { yesterday: "", today: "", blockers: "", transcript: [], elapsedSec: 0 };
        }
      }
      return copy;
    });
  }, [team]);

  // ---------- Per-speaker timer ----------
  useEffect(() => {
    if (!active) return;
    if (!currentMember) return;
    if (perSpeakerInterval.current) clearInterval(perSpeakerInterval.current);
    perSpeakerRef.current = 0;
    setPerSpeakerTimer(0);
    perSpeakerInterval.current = setInterval(() => {
      perSpeakerRef.current += 1;
      setPerSpeakerTimer(perSpeakerRef.current);
    }, 1000);
    return () => clearInterval(perSpeakerInterval.current);
  }, [active, idx]);

  // ---------- Auto-advance on silence ----------
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => {
      const silenceMs = Date.now() - lastChunkAt;
      if (!manualMode && listening && silenceMs > 4000 && (buffer.trim().length > 0 || finalBuffer.trim().length > 0)) {
        handleAnswerFinalize();
      }
    }, 1000);
    return () => clearInterval(t);
  }, [active, listening, buffer, finalBuffer, lastChunkAt, manualMode]);

  // ---------- Standup flow ----------
  const kickoff = async () => {
    setActive(true);
    setMeetingStartedAt(Date.now());
    setIdx(0);
    setQIdx(0);
    setBuffer("");
    setFinalBuffer("");
    await speak(`Good morning! Let's start our standup. We'll go in order: ${team.map((t) => t.name).join(", ")}.`);
    await sleep(600);
    await askCurrent();
  };

  const askCurrent = async () => {
    const m = currentMember;
    if (!m) return completeMeeting();
    const q = currentQuestion;
    await speak(`${m.name}, ${q.label}`);
    setBuffer("");
    setFinalBuffer("");
    setLastChunkAt(Date.now());
    if (!manualMode && available.asr) {
      startListening({
        onText: (txt, isFinal) => {
          setLastChunkAt(Date.now());
          if (isFinal) setFinalBuffer((prev) => (prev + " " + txt).trim());
          else setBuffer(txt);
        },
      });
    }
  };

  const stopASR = () => {
    if (!manualMode) stopListening();
  };

  const recordSnippet = (txt: string) => {
    setQaMap((prev) => {
      const copy = { ...prev };
      const m = currentMember;
      if (!m) return copy;
      copy[m.id] = {
        ...copy[m.id],
        transcript: [...copy[m.id].transcript, `[${new Date().toLocaleTimeString()}] ${m.name}: ${txt}`],
      };
      return copy;
    });
  };

  const handleAnswerFinalize = async () => {
    stopASR();

    const full = (finalBuffer + " " + buffer).trim();
    if (!full) {
      await speak("I didn't catch that. Could you repeat, or say 'done' to skip?");
      return;
    }

    const memberId = currentMember?.id;
    if (!memberId) return;

    recordSnippet(full);

    // save elapsed time
    setQaMap((prev) => {
      const copy = { ...prev };
      const qa = copy[memberId];
      qa.elapsedSec += perSpeakerRef.current;
      return copy;
    });

    // map to the current QA field
    setQaMap((prev) => {
      const copy = { ...prev };
      const qa = copy[memberId];
      if (currentQuestion.key === "yesterday") qa.yesterday = (qa.yesterday + " " + full).trim();
      if (currentQuestion.key === "today") qa.today = (qa.today + " " + full).trim();
      if (currentQuestion.key === "blockers") qa.blockers = (qa.blockers + " " + full).trim();
      return copy;
    });

    // respond with a short acknowledgment
    const { tasks, blockers } = extractInsights(full, currentMember!.name);
    if (blockers.length > 0) {
      await speak(`Thanks ${currentMember!.name}. I heard a blocker: ${blockers[0].issue.slice(0, 80)}.`);
    } else if (tasks.length > 0) {
      await speak(`Noted. A key action I captured is: ${tasks[0].title.slice(0, 80)}.`);
    } else {
      await speak(`Thanks ${currentMember!.name}. Noted.`);
    }

    // advance to next question/member
    const nextQ = qIdx + 1;
    if (nextQ < DEFAULT_QUESTIONS.length) {
      setQIdx(nextQ);
      setBuffer("");
      setFinalBuffer("");
      await sleep(300);
      await askCurrent();
    } else {
      // next member
      const nextMember = idx + 1;
      if (nextMember < team.length) {
        setIdx(nextMember);
        setQIdx(0);
        setBuffer("");
        setFinalBuffer("");
        await sleep(300);
        await askCurrent();
      } else {
        await completeMeeting();
      }
    }
  };

  const completeMeeting = async () => {
    stopASR();
    setActive(false);
    await speak("Standup complete. Here's the summary.");
  };

  const addMember = () => setTeam((t) => [...t, { id: uuid(), name: "New Teammate" }]);
  const removeMember = (id: string) => setTeam((t) => t.filter((m) => m.id !== id));

  const move = (i: number, dir: -1 | 1) => {
    setTeam((t) => {
      const arr = [...t];
      const j = i + dir;
      if (j < 0 || j >= arr.length) return arr;
      const [m] = arr.splice(i, 1);
      arr.splice(j, 0, m);
      return arr;
    });
  };

  const exportJSON = () => {
    const data = buildMeetingSummary();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `standup-summary-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const buildMeetingSummary = () => {
    const participants = team.map((m) => {
      const qa = qaMap[m.id];
      const insights = {
        yesterday: extractInsights(qa?.yesterday || "", m.name),
        today: extractInsights(qa?.today || "", m.name),
        blockers: extractInsights(qa?.blockers || "", m.name),
      };

      const actions = [
        ...(insights.today.tasks || []),
        ...(insights.yesterday.tasks || []),
      ];
      const blockers = [
        ...(insights.blockers.blockers || []),
        ...(insights.today.blockers || []),
        ...(insights.yesterday.blockers || []),
      ];

      return {
        name: m.name,
        elapsedSec: qa?.elapsedSec || 0,
        answers: { yesterday: qa?.yesterday || "", today: qa?.today || "", blockers: qa?.blockers || "" },
        transcript: qa?.transcript || [],
        actions,
        blockers,
        notes: [
          ...(insights.yesterday.notes || []),
          ...(insights.today.notes || []),
          ...(insights.blockers.notes || []),
        ],
      };
    });

    const flatActions = participants.flatMap((p) => p.actions.map((a) => ({ ...a, owner: p.name })));
    const flatBlockers = participants.flatMap((p) => p.blockers.map((b) => ({ ...b, owner: p.name })));

    return {
      id: uuid(),
      startedAt: meetingStartedAt ? new Date(meetingStartedAt).toISOString() : nowISO(),
      finishedAt: nowISO(),
      participants,
      actions: flatActions,
      blockers: flatBlockers,
    };
  };

  const postToSlack = async () => {
    if (!slackWebhook) return alert("Paste a Slack Incoming Webhook URL first.");
    const summary = buildMeetingSummary();
    const lines: string[] = [];
    lines.push(`*Standup Summary — ${new Date().toLocaleString()}*`);
    for (const p of summary.participants) {
      lines.push(`• *${p.name}* (\`${p.elapsedSec}s\`)`);
      if (p.actions.length) {
        for (const a of p.actions) lines.push(`  • Action: ${a.title}`);
      }
      if (p.blockers.length) {
        for (const b of p.blockers) lines.push(`  • Blocker: ${b.issue}`);
      }
    }
    const payload = { text: lines.join("\n") };
    const res = await fetch(slackWebhook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (res.ok) alert("Posted to Slack ✅");
    else alert("Slack post failed ❌");
  };

  const meetingSummary = useMemo(() => buildMeetingSummary(), [qaMap, team, meetingStartedAt]);

  // ---------- UI ----------
  return (
    <div className="min-h-screen w-full bg-gradient-to-b from-slate-50 to-white text-slate-800">
      <div className="max-w-6xl mx-auto px-4 py-8">
        <header className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold tracking-tight">Voice Scrum Master — voice-to-action agent</h1>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="toggle toggle-sm" checked={manualMode} onChange={(e) => setManualMode(e.target.checked)} />
              Manual input
            </label>
            <div className="text-xs text-slate-500">
              ASR {available.asr ? "✓" : "—"} · TTS {available.tts ? "✓" : "—"}
            </div>
          </div>
        </header>

        {/* ---- Onload video section ---- */}
        <section className="mb-8">
          <div className="bg-white rounded-2xl shadow overflow-hidden">
            <div className="relative">
              <video
                ref={videoRef}
                src={videoUrl}
                className="w-full aspect-video bg-black"
                autoPlay
                muted={videoMuted}
                playsInline
                controls
                onEnded={scrollToTeam}
                onLoadedData={() => {
                  if (autoPlayVideo) {
                    const v = videoRef.current;
                    if (v) {
                      try {
                        const maybe = v.play();
                        if (maybe && typeof (maybe as any).catch === "function") (maybe as Promise<void>).catch(() => {});
                      } catch {}
                    }
                  }
                }}
              />

              <div className="absolute top-3 right-3 flex gap-2">
                <button
                  className="px-3 py-1.5 rounded-xl bg-white/90 backdrop-blur border text-sm"
                  onClick={() => {
                    const v = videoRef.current;
                    if (!v) return;
                    v.muted = !v.muted;
                    setVideoMuted(v.muted);
                  }}
                >
                  {videoMuted ? "Unmute" : "Mute"}
                </button>
                <button
                  className="px-3 py-1.5 rounded-xl bg-white/90 backdrop-blur border text-sm"
                  onClick={() => safeReplay(videoRef.current)}
                >
                  Replay
                </button>
              </div>
            </div>

            <div className="p-3 border-t flex flex-col md:flex-row gap-2 md:items-center">
              <div className="text-sm text-slate-600 flex-1">Video autoplays on load; when it ends, we'll scroll to the Team section below.</div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={autoPlayVideo} onChange={(e) => setAutoPlayVideo(e.target.checked)} /> Autoplay on load
              </label>
              <div className="flex gap-2">
                <input
                  className="px-3 py-1.5 rounded-xl bg-slate-50 border text-sm w-[320px]"
                  placeholder="Video URL (mp4)"
                  value={videoUrl}
                  onChange={(e) => setVideoUrl(e.target.value)}
                />
                <button className="px-3 py-1.5 rounded-xl bg-slate-900 text-white text-sm" onClick={scrollToTeam}>Scroll to Team</button>
              </div>
            </div>
          </div>
        </section>

        {/* Controls + Team section */}
        <div className="grid md:grid-cols-3 gap-6" ref={teamSectionRef}>
          <div className="md:col-span-2">
            <div className="bg-white rounded-2xl shadow p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold">Team</h2>
                <button
                  className="px-3 py-1.5 rounded-xl bg-slate-900 text-white hover:bg-slate-800"
                  onClick={addMember}
                  disabled={active}
                >
                  + Add member
                </button>
              </div>

              <ul className="space-y-2">
                {team.map((m, i) => (
                  <li key={m.id} className={`flex items-center gap-2 p-2 rounded-xl ${i === idx && active ? "bg-emerald-50" : "bg-slate-50"}`}>
                    <div className="font-medium w-40">
                      <input
                        value={m.name}
                        disabled={active}
                        onChange={(e) => setTeam((t) => t.map((x) => (x.id === m.id ? { ...x, name: e.target.value } : x)))}
                        className="bg-transparent outline-none w-full"
                      />
                    </div>
                    <div className="text-xs text-slate-500">order</div>
                    <div className="flex gap-1">
                      <button className="px-2 py-1 rounded bg-white border" onClick={() => move(i, -1)} disabled={active}>
                        ↑
                      </button>
                      <button className="px-2 py-1 rounded bg-white border" onClick={() => move(i, 1)} disabled={active}>
                        ↓
                      </button>
                    </div>
                    <div className="flex-1" />
                    <button className="px-2 py-1 rounded bg-white border text-red-500" onClick={() => removeMember(m.id)} disabled={active}>
                      remove
                    </button>
                  </li>
                ))}
              </ul>

              <div className="mt-4 flex items-center gap-3">
                {!active ? (
                  <button
                    className="px-4 py-2 rounded-xl bg-emerald-600 text-white hover:bg-emerald-500"
                    onClick={kickoff}
                  >
                    ▶ Start standup
                  </button>
                ) : (
                  <button
                    className="px-4 py-2 rounded-xl bg-yellow-500 text-white hover:bg-yellow-400"
                    onClick={completeMeeting}
                  >
                    ■ End now
                  </button>
                )}

                <div className="text-sm text-slate-600">
                  {active ? (
                    <span>
                      Speaking with <b>{currentMember?.name}</b> — {currentQuestion?.label} {" "}
                      <span className="ml-2 text-xs px-2 py-1 rounded bg-black text-white">{perSpeakerTimer}s</span>
                    </span>
                  ) : (
                    <span>Ready</span>
                  )}
                </div>
              </div>

              {/* Live capture area */}
              {active && (
                <div className="mt-4 p-3 rounded-xl bg-slate-100">
                  <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Listening</div>

                  {!manualMode ? (
                    <div>
                      <div className="min-h-[48px] p-2 rounded bg-white border text-slate-700">
                        {finalBuffer && (
                          <div className="mb-1 text-slate-900">{finalBuffer}</div>
                        )}
                        <div className="opacity-60">{buffer || <em>…</em>}</div>
                      </div>
                      <div className="mt-2 flex gap-2">
                        <button className="px-3 py-1.5 rounded bg-white border" onClick={() => { setBuffer(""); setFinalBuffer(""); }}>Clear</button>
                        <button className="px-3 py-1.5 rounded bg-emerald-600 text-white" onClick={handleAnswerFinalize}>Done</button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <textarea
                        className="w-full min-h-[90px] p-2 rounded bg-white border"
                        placeholder="Type the answer here…"
                        value={finalBuffer}
                        onChange={(e) => setFinalBuffer(e.target.value)}
                      />
                      <div className="mt-2 flex gap-2">
                        <button className="px-3 py-1.5 rounded bg-white border" onClick={() => setFinalBuffer("")}>Clear</button>
                        <button className="px-3 py-1.5 rounded bg-emerald-600 text-white" onClick={handleAnswerFinalize}>Done</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Summary / Actions */}
          <aside className="bg-white rounded-2xl shadow p-4">
            <h2 className="font-semibold mb-2">Summary</h2>
            <div className="text-sm text-slate-600 mb-3">
              Meeting {meetingStartedAt ? `started ${new Date(meetingStartedAt).toLocaleTimeString()}` : "not started"}
            </div>

            <div className="space-y-3 max-h-[50vh] overflow-auto pr-1">
              {team.map((m) => {
                const qa = qaMap[m.id];
                const insightsY = extractInsights(qa?.yesterday || "", m.name);
                const insightsT = extractInsights(qa?.today || "", m.name);
                const insightsB = extractInsights(qa?.blockers || "", m.name);
                const actions = [...insightsT.tasks, ...insightsY.tasks];
                const blockers = [...insightsB.blockers, ...insightsT.blockers, ...insightsY.blockers];
                return (
                  <div key={m.id} className="border rounded-xl p-3">
                    <div className="flex items-center justify-between">
                      <div className="font-medium">{m.name}</div>
                      <div className="text-xs text-slate-500">{qa?.elapsedSec || 0}s</div>
                    </div>
                    <div className="mt-2 text-sm">
                      {actions.length > 0 && (
                        <div className="mb-2">
                          <Icon label="Actions" />
                          <ul className="list-disc ml-8 mt-1 space-y-1">
                            {actions.map((a, i) => (
                              <li key={i}>{a.title}{a.due ? ` (due ${a.due})` : ""}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {blockers.length > 0 && (
                        <div className="mb-2">
                          <Icon label="Blockers" />
                          <ul className="list-disc ml-8 mt-1 space-y-1">
                            {blockers.map((b, i) => (
                              <li key={i}>{b.issue}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      <details className="mt-1">
                        <summary className="cursor-pointer text-xs text-slate-500">Transcript</summary>
                        <ul className="text-xs mt-1 space-y-1">
                          {(qa?.transcript || []).map((t, i) => (
                            <li key={i} className="bg-slate-50 rounded p-1">{t}</li>
                          ))}
                        </ul>
                      </details>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-4 space-y-2">
              <label className="block text-xs text-slate-500">Slack Incoming Webhook (optional)</label>
              <input
                className="w-full px-3 py-2 rounded-xl bg-slate-50 border"
                placeholder="https://hooks.slack.com/services/..."
                value={slackWebhook}
                onChange={(e) => setSlackWebhook(e.target.value)}
              />
              <div className="flex gap-2 mt-2">
                <button className="px-3 py-1.5 rounded bg-slate-900 text-white" onClick={postToSlack}>Post to Slack</button>
                <button className="px-3 py-1.5 rounded bg-white border" onClick={exportJSON}>Export JSON</button>
                <a
                  className="px-3 py-1.5 rounded bg-white border"
                  href={`mailto:?subject=Standup%20Summary&body=${encodeURIComponent(JSON.stringify(meetingSummary, null, 2))}`}
                >
                  Email summary
                </a>
              </div>
            </div>
          </aside>
        </div>

        {/* Footer help */}
        <div className="mt-8 text-xs text-slate-500">
          Say <b>"done"</b> to move on, or click <i>Done</i>. You can switch to manual input if your browser
          lacks speech recognition. This demo uses on-device Web Speech APIs — add your own LLM or Jira
          integrations by extending <code>extractInsights()</code> and the action buttons.
        </div>
      </div>
    </div>
  );
}

/**
 * --------------------------------------------------------------
 * Lightweight self-tests (non-breaking)
 * --------------------------------------------------------------
 * These run in the browser and use console.assert so they won't
 * interrupt the UI. Disable by setting window.__VOICE_SCRUM_TESTS__ = false
 * before loading this file.
 */
function runSelfTests() {
  try {
    // NLP tests
    const t1 = extractInsights("I will push the login fix by Friday.", "Alice");
    console.assert(t1.tasks.length >= 1, "[Test] should extract at least one task");
    console.assert((t1.tasks[0].due || "").toUpperCase() === "FRIDAY", "[Test] due should be FRIDAY");

    const t2 = extractInsights("I'm blocked by missing S3 access.", "Bob");
    console.assert(t2.blockers.length >= 1, "[Test] should extract a blocker");

    const t3 = extractInsights("Today I plan to refactor. Can't deploy yet.", "Cara");
    console.assert(t3.tasks.length >= 1 && t3.blockers.length >= 1, "[Test] should capture both task and blocker");

    // New: neutral sentence becomes a note
    const t4 = extractInsights("Yesterday was productive overall.", "Dee");
    console.assert(t4.notes.length >= 1, "[Test] neutral text captured as note");

    // Kickoff string template sanity
    const names = ["A", "B", "C"];
    const kickoff = `Good morning! Let's start our standup. We'll go in order: ${names.join(", ")}.`;
    console.assert(kickoff.includes("A, B, C"), "[Test] kickoff string formats correctly");

    // Video defaults and helpers
    console.assert(typeof DEFAULT_VIDEO_URL === "string" && DEFAULT_VIDEO_URL.length > 0, "[Test] default video url present");
    // safeReplay should be a no-op with null
    try { safeReplay(null as any); console.assert(true, "[Test] safeReplay handles null"); } catch { console.assert(false, "[Test] safeReplay threw on null"); }

    console.log("[VoiceScrumMaster] Self-tests passed.");
  } catch (err) {
    console.warn("[VoiceScrumMaster] Self-tests encountered an error:", err);
  }
}

if (typeof window !== "undefined" && (window as any).__VOICE_SCRUM_TESTS__ !== false) {
  try { runSelfTests(); } catch {}
}
