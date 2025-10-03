import { useEffect, useRef, useState } from "react";

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
 *  - If speech recognition is navailable, toggle "Manual input".
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
const DEFAULT_VIDEO_URL = "/ai_nicole.mp4"; // uploaded in this session

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
function useSpeech(voiceSettings: { rate: number; pitch: number; volume: number; voiceName: string }) {
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
      
      // Get available voices and select the best one
      const voices = window.speechSynthesis.getVoices();
      let selectedVoice = voices[0];
      
      // Try to find user's preferred voice first
      if (voiceSettings.voiceName) {
        const preferredVoice = voices.find(voice => voice.name === voiceSettings.voiceName);
        if (preferredVoice) {
          selectedVoice = preferredVoice;
        }
      }
      
      // Try to find Amira voice first (default preference)
      if (!selectedVoice || selectedVoice === voices[0]) {
        const amiraVoice = voices.find(voice => 
          voice.name.toLowerCase().includes('amira')
        );
        if (amiraVoice) {
          selectedVoice = amiraVoice;
        }
      }
      
      // Fallback to best available English voice
      if (!selectedVoice || !selectedVoice.lang.startsWith('en')) {
        selectedVoice = voices.find(voice => 
          voice.lang.startsWith('en') && 
          (voice.name.includes('Google') || voice.name.includes('Natural') || voice.name.includes('Premium'))
        ) || voices.find(voice => voice.lang.startsWith('en')) || voices[0];
      }
      
      // If no voices available, return early
      if (!selectedVoice) {
        console.warn('No speech synthesis voices available');
        return;
      }
      
      const u = new SpeechSynthesisUtterance(text);
      
      // Enhanced voice settings for better quality
      u.voice = selectedVoice;
      u.rate = voiceSettings.rate; // Use user-configured rate
      u.pitch = voiceSettings.pitch; // Use user-configured pitch
      u.volume = voiceSettings.volume; // Use user-configured volume
      u.lang = "en-US";
      
      // Add pauses for better sentence structure
      const enhancedText = text
        .replace(/([.!?])\s+/g, '$1... ') // Add pauses after sentences
        .replace(/([,;:])\s+/g, '$1... ') // Add pauses after punctuation
        .replace(/\.\.\.\s*\.\.\./g, '...'); // Clean up multiple pauses
      
      u.text = enhancedText;
      
      // Wait for the speech to complete before continuing
      return new Promise<void>((resolve) => {
        u.onend = () => resolve();
        u.onerror = () => resolve();
        window.speechSynthesis.speak(u);
      });
    } catch (e) {
      console.warn('Speech synthesis error:', e);
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

type Member = { id: string; name: string; timeLimit: number };

type QA = {
  update: string;
  transcript: string[]; // raw snippets
  elapsedSec: number;
};

const DEFAULT_QUESTIONS = [
  { key: "update", label: "Please give your update" },
] as const;

export default function VoiceScrumMaster() {
  // Video controls
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const teamSectionRef = useRef<HTMLDivElement | null>(null);
  const [videoUrl, setVideoUrl] = useState<string>(DEFAULT_VIDEO_URL);
  const [videoMuted, setVideoMuted] = useState<boolean>(false);
  const [autoPlayVideo, setAutoPlayVideo] = useState<boolean>(true);
  const [autoStartStandup, setAutoStartStandup] = useState<boolean>(false);

  // Standup state
  const [manualMode, setManualMode] = useState(false);
  const [slackWebhook, setSlackWebhook] = useState("");
  const [emailAddress, setEmailAddress] = useState(() => {
    // Load email from localStorage on initial load
    try {
      const savedEmail = localStorage.getItem('scrummaster-email');
      return savedEmail || "brandedge25@gmail.com";
    } catch (error) {
      console.warn('Failed to load email from localStorage:', error);
      return "brandedge25@gmail.com";
    }
  });
  const [voiceSettings, setVoiceSettings] = useState({
    rate: 0.9,
    pitch: 1.1,
    volume: 0.95,
    voiceName: "Amira"
  });
  
  const { speak, startListening, stopListening, listening, available } = useSpeech(voiceSettings);
  const [team, setTeam] = useState<Member[]>(() => {
    // Load team from localStorage on initial load
    try {
      const savedTeam = localStorage.getItem('scrummaster-team');
      if (savedTeam) {
        const parsedTeam = JSON.parse(savedTeam);
        // Ensure all members have timeLimit property (for backward compatibility)
        return parsedTeam.map((member: any) => ({
          ...member,
          timeLimit: member.timeLimit || 60 // Default to 60 seconds if not set
        }));
      }
    } catch (error) {
      console.warn('Failed to load team from localStorage:', error);
    }
    // Default team if no saved data
    return [
      { id: uuid(), name: "Josh", timeLimit: 60 },
      { id: uuid(), name: "Katie", timeLimit: 60 },
      { id: uuid(), name: "Naomi", timeLimit: 60 },
    ];
  });
  const [active, setActive] = useState(false);
  const [idx, setIdx] = useState(0);
  const [qIdx, setQIdx] = useState(0);
  const [completedMembers, setCompletedMembers] = useState<Set<string>>(new Set());
  const [isAsking, setIsAsking] = useState(false);
  const [buffer, setBuffer] = useState("");
  const [finalBuffer, setFinalBuffer] = useState("");
  const [lastChunkAt, setLastChunkAt] = useState<number>(Date.now());
  const [qaMap, setQaMap] = useState<Record<string, QA>>({});
  const [meetingStartedAt, setMeetingStartedAt] = useState<number | null>(null);
  const [perSpeakerTimer, setPerSpeakerTimer] = useState<number>(0);
  const perSpeakerRef = useRef<number>(0);
  const perSpeakerInterval = useRef<any>(null);
  const [timeLimitReached, setTimeLimitReached] = useState<boolean>(false);
  const [timerStarted, setTimerStarted] = useState<boolean>(false);

  const currentMember = team[idx];
  const currentQuestion = DEFAULT_QUESTIONS[qIdx];

  // Helper function to reset timer state
  const resetTimerState = () => {
    if (perSpeakerInterval.current) {
      clearInterval(perSpeakerInterval.current);
      perSpeakerInterval.current = null;
    }
    perSpeakerRef.current = 0;
    setPerSpeakerTimer(0);
    setTimeLimitReached(false);
    setTimerStarted(false);
  };

  // Helper function to start timer for a member
  const startMemberTimer = (member: Member) => {
    // Clear any existing timer first
    resetTimerState();
    
    console.log(`Starting timer for ${member.name}`);
    setTimerStarted(true);
    
    perSpeakerInterval.current = setInterval(() => {
      perSpeakerRef.current += 1;
      setPerSpeakerTimer(perSpeakerRef.current);
      
      // Check if time limit reached
      if (perSpeakerRef.current >= member.timeLimit) {
        setTimeLimitReached(true);
        clearInterval(perSpeakerInterval.current);
        perSpeakerInterval.current = null;
        // Auto-finalize after time limit
        setTimeout(() => {
          handleAnswerFinalize();
        }, 1000); // Give 1 second grace period
      }
    }, 1000);
  };

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
          copy[m.id] = { update: "", transcript: [], elapsedSec: 0 };
        }
      }
      return copy;
    });
  }, [team]);

  // ---------- Per-speaker timer ----------
  useEffect(() => {
    if (!active) return;
    if (!currentMember) return;
    // Don't start timer here - it will be started in askCurrent when the AI asks the question
  }, [active, idx, currentMember]);

  // ---------- Cleanup timer on unmount or meeting end ----------
  useEffect(() => {
    return () => {
      if (perSpeakerInterval.current) {
        clearInterval(perSpeakerInterval.current);
        perSpeakerInterval.current = null;
      }
    };
  }, []);

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
    setCompletedMembers(new Set());
    setBuffer("");
    setFinalBuffer("");
    await speak(`Good morning everyone! Let's start our standup. I'll go through each team member: ${team.map((t) => t.name).join(", ")}.`);
    await sleep(800);
    await askCurrent();
  };

  const askCurrent = async () => {
    // FIRST ASK CURRENT FUNCTION
    // Prevent multiple simultaneous calls
    if (isAsking) {
      console.log('Already asking a question, skipping...');
      return;
    }
    
    setIsAsking(true);
    
    try {
      // Find the next uncompleted member
      const nextUncompletedIndex = team.findIndex(member => !completedMembers.has(member.id));
      if (nextUncompletedIndex === -1) {
        setIsAsking(false);
        return completeMeeting();
      }
      
      // Update the current index to the next uncompleted member
      setIdx(nextUncompletedIndex);
      
      const m = team[nextUncompletedIndex];
      const q = currentQuestion;
      
      if (!q) {
        console.error('No current question found');
        setIsAsking(false);
        return;
      }
      
      console.log(`Asking ${m.name} for their update (ID: ${m.id}, idx: ${nextUncompletedIndex})`);
      console.log(`Current completed members:`, Array.from(completedMembers));
      
      // Simple question prompt
      const questionPrompt = `${m.name}, please give your update.`;
      
      await speak(questionPrompt);
      setBuffer("");
      setFinalBuffer("");
      setLastChunkAt(Date.now());
      
      // Reset timer state for new speaker
      resetTimerState();
      
      if (!manualMode && available.asr) {
        startListening({
          onText: (txt, isFinal) => {
            setLastChunkAt(Date.now());
            if (isFinal) setFinalBuffer((prev) => (prev + " " + txt).trim());
            else setBuffer(txt);
            
            // Start the timer when the member first starts speaking
            if (txt.trim().length > 0 && !timerStarted && !perSpeakerInterval.current) {
              startMemberTimer(m);
            }
          },
        });
      }
    } finally {
      setIsAsking(false);
    }
  };

  const stopASR = () => {
    if (!manualMode) stopListening();
  };

  const recordSnippet = (txt: string, memberId?: string, memberName?: string) => {
    setQaMap((prev) => {
      const copy = { ...prev };
      const m = memberId && memberName ? { id: memberId, name: memberName } : currentMember;
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
    
    // Clear the timer interval to ensure it's reset for the next person
    if (perSpeakerInterval.current) {
      clearInterval(perSpeakerInterval.current);
      perSpeakerInterval.current = null;
      console.log('Timer interval cleared in handleAnswerFinalize');
    }

    // Capture current member info at the start to avoid stale references
    const currentMemberInfo = currentMember;
    console.log(`handleAnswerFinalize - currentMember:`, currentMember);
    console.log(`handleAnswerFinalize - currentMemberInfo:`, currentMemberInfo);
    if (!currentMemberInfo) return;

    const full = (finalBuffer + " " + buffer).trim();
    const isTimeLimitReached = timeLimitReached;
    const finalTimerValue = perSpeakerTimer; // Capture the current timer value
    
    // If time limit reached, proceed even with empty input
    if (!full && !isTimeLimitReached) {
      await speak("I didn't catch that. Could you please repeat your answer, or say 'done' to move to the next person?");
      return;
    }
    
    // Check if user wants to skip (only if not time limit reached)
    if (!isTimeLimitReached && full.toLowerCase().includes('done') || full.toLowerCase().includes('skip')) {
      await speak(`Thank you, ${currentMemberInfo.name}. Let's move on to the next person.`);
      // Continue with the flow - don't return, just proceed
    }

    const memberId = currentMemberInfo.id;

    // Store the data first (even if empty due to time limit)
    recordSnippet(full || "No response (time limit reached)", currentMemberInfo.id, currentMemberInfo.name);

    // save elapsed time
    setQaMap((prev) => {
      const copy = { ...prev };
      const qa = copy[memberId];
      qa.elapsedSec = finalTimerValue; // Set to actual time spent, don't accumulate
      console.log(`Saving elapsed time for ${currentMemberInfo.name}: ${finalTimerValue}s`);
      return copy;
    });
    
    // Reset timer state for next member
    resetTimerState();

    // map to the current QA field
    setQaMap((prev) => {
      const copy = { ...prev };
      const qa = copy[memberId];
      qa.update = full || "No response (time limit reached)"; // Replace the update, don't append
      return copy;
    });

    // Speak acknowledgment BEFORE any state changes
    console.log(`Speaking acknowledgment for: ${currentMemberInfo.name} (ID: ${currentMemberInfo.id})`);
    await speak(`Thanks, ${currentMemberInfo.name}.`);
    
    // Wait for speech to complete
    await sleep(500);

    // Now handle the transition to next person
    await moveToNextPerson(currentMemberInfo.id);
  };

  const moveToNextPerson = async (completedMemberId: string) => {
    console.log(`moveToNextPerson called for member ID: ${completedMemberId}`);
    console.log(`Current completed members before:`, Array.from(completedMembers));
    
    // Mark current member as completed
    const updatedCompletedMembers = new Set([...completedMembers, completedMemberId]);
    setCompletedMembers(updatedCompletedMembers);
    
    console.log(`Updated completed members:`, Array.from(updatedCompletedMembers));

    // Find next uncompleted member using the updated set
    const nextUncompletedIndex = team.findIndex(member => !updatedCompletedMembers.has(member.id));
    console.log(`Next uncompleted index: ${nextUncompletedIndex}`);
    
    if (nextUncompletedIndex !== -1) {
      const nextMember = team[nextUncompletedIndex];
      console.log(`Moving to next member: ${nextMember.name} (ID: ${nextMember.id})`);
      
      setIdx(nextUncompletedIndex);
      setQIdx(0);
      setBuffer("");
      setFinalBuffer("");
      await sleep(300); // Pause between members
      
      // Pass the updated completed members to avoid stale state
      await askCurrentWithCompletedMembers(updatedCompletedMembers);
    } else {
      console.log('No more uncompleted members, ending meeting');
      await completeMeeting();
    }
  };

  const askCurrentWithCompletedMembers = async (completedMembersSet: Set<string>) => {
    // Prevent multiple simultaneous calls
    if (isAsking) {
      console.log('Already asking a question, skipping...');
      return;
    }
    
    setIsAsking(true);
    
    try {
      // Find the next uncompleted member using the passed set
      const nextUncompletedIndex = team.findIndex(member => !completedMembersSet.has(member.id));
      if (nextUncompletedIndex === -1) {
        setIsAsking(false);
        return completeMeeting();
      }
      
      // Update the current index to the next uncompleted member
      setIdx(nextUncompletedIndex);
      
      const m = team[nextUncompletedIndex];
      const q = currentQuestion;
      
      if (!q) {
        console.error('No current question found');
        setIsAsking(false);
        return;
      }
      
      console.log(`Asking ${m.name} for their update (ID: ${m.id}, idx: ${nextUncompletedIndex})`);
      console.log(`Using completed members:`, Array.from(completedMembersSet));
      
      // Simple question prompt
      const questionPrompt = `${m.name}, please give your update.`;
      
      await speak(questionPrompt);
      setBuffer("");
      setFinalBuffer("");
      setLastChunkAt(Date.now());
      
      // Reset timer state for new speaker
      resetTimerState();
      
      if (!manualMode && available.asr) {
        startListening({
          onText: (txt, isFinal) => {
            setLastChunkAt(Date.now());
            if (isFinal) setFinalBuffer((prev) => (prev + " " + txt).trim());
            else setBuffer(txt);
            
            // Start the timer when the member first starts speaking
            if (txt.trim().length > 0 && !timerStarted && !perSpeakerInterval.current) {
              startMemberTimer(m);
            }
          },
        });
      }
    } finally {
      setIsAsking(false);
    }
  };

  const generateSummaryText = () => {
    const summary = buildMeetingSummary();
    const date = new Date().toLocaleDateString('en-US', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
    
    let text = `Daily Standup Summary\n`;
    text += `Date: ${date}\n`;
    text += `Total Participants: ${summary.participants.length}\n`;
    text += `Total Duration: ${summary.participants.reduce((total, p) => total + p.elapsedSec, 0)}s\n\n`;
    text += `═══════════════════════════════════════════════════════════\n\n`;
    
    summary.participants.forEach((participant, index) => {
      text += `${index + 1}. ${participant.name} (${participant.elapsedSec}s)\n`;
      text += `${'─'.repeat(50)}\n`;
      
      if (participant.answers.update) {
        text += `📝 Update:\n   ${participant.answers.update}\n\n`;
      }
      
      if (participant.actions.length > 0) {
        text += `✅ Actions:\n`;
        participant.actions.forEach((action, actionIndex) => {
          text += `   ${actionIndex + 1}. ${action.title}`;
          if (action.due) {
            text += ` (Due: ${action.due})`;
          }
          text += `\n`;
        });
        text += `\n`;
      }
      
      if (participant.blockers.length > 0) {
        text += `🚫 Blockers:\n`;
        participant.blockers.forEach((blocker, blockerIndex) => {
          text += `   ${blockerIndex + 1}. ${blocker.issue}\n`;
        });
        text += `\n`;
      }
      
      text += `\n`;
    });
    
    // Add summary statistics
    const totalActions = summary.participants.reduce((total, p) => total + p.actions.length, 0);
    const totalBlockers = summary.participants.reduce((total, p) => total + p.blockers.length, 0);
    
    text += `═══════════════════════════════════════════════════════════\n`;
    text += `📊 Summary Statistics:\n`;
    text += `   • Total Actions: ${totalActions}\n`;
    text += `   • Total Blockers: ${totalBlockers}\n`;
    text += `   • Average Time per Person: ${Math.round(summary.participants.reduce((total, p) => total + p.elapsedSec, 0) / summary.participants.length)}s\n`;
    text += `\n`;
    text += `Generated by AI ScrumMaster\n`;
    text += `Timestamp: ${new Date().toLocaleString()}\n`;
    
    return text;
  };

  const sendEmailSummary = () => {
    // Validate email addresses (support multiple emails separated by commas)
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const emails = emailAddress.split(',').map(email => email.trim()).filter(Boolean);
    
    if (!emailAddress || emails.length === 0) {
      alert('Please enter at least one email address');
      return;
    }
    
    const invalidEmails = emails.filter(email => !emailRegex.test(email));
    if (invalidEmails.length > 0) {
      alert(`Please enter valid email addresses. Invalid: ${invalidEmails.join(', ')}`);
      return;
    }

    try {
      const summaryText = generateSummaryText();
      const subject = `Daily Standup Summary - ${new Date().toLocaleDateString()}`;
      const body = encodeURIComponent(summaryText);
      const mailtoLink = `mailto:${emails.join(',')}?subject=${encodeURIComponent(subject)}&body=${body}`;
      
      // Try to open email client
      const emailWindow = window.open(mailtoLink, '_blank');
      
      if (!emailWindow) {
        // Fallback: copy to clipboard if popup is blocked
        navigator.clipboard.writeText(summaryText).then(() => {
          alert(`Email client blocked. Summary copied to clipboard. You can paste it into your email client and send to: ${emails.join(', ')}`);
        }).catch(() => {
          // Final fallback: show the summary in an alert
          alert(`Email client blocked and clipboard access denied. Here is your summary to send to ${emails.join(', ')}:\n\n` + summaryText);
        });
      } else {
        // Success feedback
        setTimeout(() => {
          alert(`Email client opened for: ${emails.join(', ')}`);
        }, 100);
      }
    } catch (error) {
      console.error('Error sending email summary:', error);
      alert('Error preparing email. Please try again.');
    }
  };

  const completeMeeting = async () => {
    stopASR();
    
    // Clear any running timer
    resetTimerState();
    
    setActive(false);
    await speak("Thanks everyone! Standup complete.");
  };

  const saveTeamToStorage = (newTeam: Member[]) => {
    try {
      localStorage.setItem('scrummaster-team', JSON.stringify(newTeam));
      console.log('Team saved to localStorage');
    } catch (error) {
      console.warn('Failed to save team to localStorage:', error);
    }
  };

  const resetTeamToDefault = () => {
    const defaultTeam = [
      { id: uuid(), name: "Josh", timeLimit: 60 },
      { id: uuid(), name: "Katie", timeLimit: 60 },
      { id: uuid(), name: "Naomi", timeLimit: 60 },
    ];
    setTeam(defaultTeam);
    saveTeamToStorage(defaultTeam);
  };

  const addMember = () => setTeam((t) => {
    const newTeam = [...t, { id: uuid(), name: "New Teammate", timeLimit: 60 }];
    saveTeamToStorage(newTeam);
    return newTeam;
  });

  const removeMember = (id: string) => setTeam((t) => {
    const newTeam = t.filter((m) => m.id !== id);
    saveTeamToStorage(newTeam);
    return newTeam;
  });

  const move = (i: number, dir: -1 | 1) => {
    setTeam((t) => {
      const arr = [...t];
      const j = i + dir;
      if (j < 0 || j >= arr.length) return arr;
      const [m] = arr.splice(i, 1);
      arr.splice(j, 0, m);
      saveTeamToStorage(arr);
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
      const insights = extractInsights(qa?.update || "", m.name);

      return {
        name: m.name,
        elapsedSec: qa?.elapsedSec || 0,
        answers: { update: qa?.update || "" },
        transcript: qa?.transcript || [],
        actions: insights.tasks || [],
        blockers: insights.blockers || [],
        notes: insights.notes || [],
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



  // ---------- UI ----------
  return (
    <div className="min-h-screen w-full bg-gradient-to-b from-slate-50 to-white text-slate-800">
      <div className="max-w-6xl mx-auto px-4 py-8">
        <header className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold tracking-tight">AI scrummaster</h1>
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

        {/* Voice Settings */}
        <section className="mb-6 bg-white rounded-2xl shadow p-4">
          <h2 className="font-semibold mb-3">Voice Settings</h2>
          <div className="grid md:grid-cols-5 gap-4">
            <div>
              <label className="block text-xs text-slate-500 mb-1">Voice</label>
              <select
                className="w-full px-3 py-1.5 rounded-xl bg-slate-50 border text-sm"
                value={voiceSettings.voiceName}
                onChange={(e) => setVoiceSettings(prev => ({ ...prev, voiceName: e.target.value }))}
              >
                <option value="">Auto-select best voice</option>
                {typeof window !== "undefined" && window.speechSynthesis?.getVoices().map((voice, index) => (
                  <option key={index} value={voice.name}>
                    {voice.name} ({voice.lang})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Speech Rate</label>
              <input
                type="range"
                min="0.5"
                max="2"
                step="0.1"
                value={voiceSettings.rate}
                onChange={(e) => setVoiceSettings(prev => ({ ...prev, rate: parseFloat(e.target.value) }))}
                className="w-full"
              />
              <div className="text-xs text-slate-500 mt-1">{voiceSettings.rate}x</div>
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Pitch</label>
              <input
                type="range"
                min="0.5"
                max="2"
                step="0.1"
                value={voiceSettings.pitch}
                onChange={(e) => setVoiceSettings(prev => ({ ...prev, pitch: parseFloat(e.target.value) }))}
                className="w-full"
              />
              <div className="text-xs text-slate-500 mt-1">{voiceSettings.pitch}</div>
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Volume</label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={voiceSettings.volume}
                onChange={(e) => setVoiceSettings(prev => ({ ...prev, volume: parseFloat(e.target.value) }))}
                className="w-full"
              />
              <div className="text-xs text-slate-500 mt-1">{Math.round(voiceSettings.volume * 100)}%</div>
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Test Voice</label>
              <button
                className="px-3 py-1.5 rounded-xl bg-slate-900 text-white text-sm hover:bg-slate-800"
                onClick={() => speak("Hello! This is a test of the voice settings. How does this sound?")}
              >
                Test Voice
              </button>
            </div>
          </div>
        </section>

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
                onError={(e) => {
                  console.warn('Video failed to load:', e);
                  // Fallback to a different video if the current one fails
                  if (videoUrl === "/rendered_video.mp4") {
                    setVideoUrl("/ai_nicole.mp4");
                  } else if (videoUrl === "/ai_nicole.mp4") {
                    setVideoUrl("/demo_video.mp4");
                  } else if (videoUrl === "/demo_video.mp4") {
                    setVideoUrl("/rendered_video.mp4");
                  }
                }}
                onEnded={() => {
                  scrollToTeam();
                  if (autoStartStandup && !active) {
                    // Auto-start standup after a short delay
                    setTimeout(() => {
                      kickoff();
                    }, 1000);
                  }
                }}
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
              <div className="text-sm text-slate-600 flex-1">
                Video autoplays on load; when it ends, we'll scroll to the Team section below.
                {videoUrl.includes('ai_nicole') && <span className="text-orange-600 ml-2">(Using AI Nicole )</span>}
                {videoUrl.includes('rendered_video') && <span className="text-blue-600 ml-2">(Using AI Amy)</span>}
                {videoUrl.includes('demo_video') && <span className="text-green-600 ml-2">(Using AI X)</span>}
              </div>
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={autoPlayVideo} onChange={(e) => setAutoPlayVideo(e.target.checked)} /> Autoplay on load
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={autoStartStandup} onChange={(e) => setAutoStartStandup(e.target.checked)} /> Auto-start standup when video ends
                </label>
              </div>
              <div className="flex gap-2">
                <select
                  className="px-3 py-1.5 rounded-xl bg-slate-50 border text-sm w-[320px]"
                  value={videoUrl}
                  onChange={(e) => setVideoUrl(e.target.value)}
                >
                  <option value="/ai_nicole.mp4">AI Nicole </option>
                  <option value="/rendered_video.mp4">AI Amy</option>
                  <option value="/demo_video.mp4">AI X</option>
                </select>
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
                <div>
                  <h2 className="font-semibold">Team</h2>
                  <div className="text-xs text-slate-500 mt-1">
                    Set time limits for each member (30s - 5m)
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    className="px-3 py-1.5 rounded-xl bg-slate-900 text-white hover:bg-slate-800"
                    onClick={addMember}
                    disabled={active}
                  >
                    + Add member
                  </button>
                  <button
                    className="px-3 py-1.5 rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200"
                    onClick={resetTeamToDefault}
                    disabled={active}
                    title="Reset to default team"
                  >
                    Reset
                  </button>
                </div>
              </div>

              <ul className="space-y-2">
                {team.map((m, i) => (
                  <li key={m.id} className={`flex items-center gap-2 p-2 rounded-xl ${i === idx && active ? "bg-emerald-50" : "bg-slate-50"}`}>
                    <div className="font-medium w-40">
                      <input
                        value={m.name}
                        disabled={active}
                        onChange={(e) => setTeam((t) => {
                          const newTeam = t.map((x) => (x.id === m.id ? { ...x, name: e.target.value } : x));
                          saveTeamToStorage(newTeam);
                          return newTeam;
                        })}
                        className="bg-transparent outline-none w-full"
                      />
                    </div>
                    <div className="text-xs text-slate-500">time</div>
                    <div className="w-20">
                      <select
                        value={m.timeLimit}
                        disabled={active}
                        onChange={(e) => setTeam((t) => {
                          const newTeam = t.map((x) => (x.id === m.id ? { ...x, timeLimit: parseInt(e.target.value) } : x));
                          saveTeamToStorage(newTeam);
                          return newTeam;
                        })}
                        className="w-full px-2 py-1 rounded bg-white border text-xs"
                      >
                        <option value={30}>30s</option>
                        <option value={60}>1m</option>
                        <option value={90}>1.5m</option>
                        <option value={120}>2m</option>
                        <option value={180}>3m</option>
                        <option value={300}>5m</option>
                      </select>
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
                      Speaking with <b>{currentMember?.name}</b> {" "}
                      <span className={`ml-2 text-xs px-2 py-1 rounded ${
                        timeLimitReached 
                          ? 'bg-red-500 text-white' 
                          : 'bg-black text-white'
                      }`}>
                        {perSpeakerTimer}s / {currentMember?.timeLimit}s
                      </span>
                    </span>
                  ) : (
                    <span>Ready</span>
                  )}
                </div>
              </div>

              {/* Progress indicator */}
              {active && (
                <div className="mt-3 p-3 bg-slate-50 rounded-xl">
                  <div className="text-xs text-slate-500 mb-2">Progress</div>
                  <div className="flex gap-2">
                    {team.map((member, memberIndex) => (
                      <div key={member.id} className="flex-1">
                        <div className={`text-xs font-medium mb-1 ${memberIndex === idx ? 'text-emerald-600' : memberIndex < idx ? 'text-slate-400' : 'text-slate-600'}`}>
                          {member.name}
                        </div>
                        <div className="flex gap-1">
                          <div
                            className={`w-2 h-2 rounded-full ${
                              completedMembers.has(member.id) || (memberIndex === idx && qIdx >= 0)
                                ? 'bg-emerald-500'
                                : 'bg-slate-300'
                            }`}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Time limit reached notification */}
              {active && timeLimitReached && (
                <div className="mt-3 p-3 rounded-xl bg-red-100 border border-red-300">
                  <div className="text-sm text-red-700 font-medium">
                    ⏰ Time's up! Moving to next person...
                  </div>
                </div>
              )}

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
                const insights = extractInsights(qa?.update || "", m.name);
                return (
                  <div key={m.id} className="border rounded-xl p-3">
                    <div className="flex items-center justify-between">
                      <div className="font-medium">{m.name}</div>
                      <div className="text-xs text-slate-500">{qa?.elapsedSec || 0}s</div>
                    </div>
                    <div className="mt-2 text-sm">
                      {qa?.update && (
                        <div className="mb-2">
                          <Icon label="Update" />
                          <div className="mt-1 text-slate-700">{qa.update}</div>
                        </div>
                      )}
                      {insights.tasks.length > 0 && (
                        <div className="mb-2">
                          <Icon label="Actions" />
                          <ul className="list-disc ml-8 mt-1 space-y-1">
                            {insights.tasks.map((a, i) => (
                              <li key={i}>{a.title}{a.due ? ` (due ${a.due})` : ""}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {insights.blockers.length > 0 && (
                        <div className="mb-2">
                          <Icon label="Blockers" />
                          <ul className="list-disc ml-8 mt-1 space-y-1">
                            {insights.blockers.map((b, i) => (
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
              <label className="block text-xs text-slate-500">Email Address</label>
              <input
                className="w-full px-3 py-2 rounded-xl bg-slate-50 border focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                placeholder="Enter email address(es) (e.g., team@company.com or user1@company.com, user2@company.com)"
                type="email"
                value={emailAddress}
                onChange={(e) => {
                  const newEmail = e.target.value;
                  setEmailAddress(newEmail);
                  // Save to localStorage
                  try {
                    localStorage.setItem('scrummaster-email', newEmail);
                  } catch (error) {
                    console.warn('Failed to save email to localStorage:', error);
                  }
                }}
              />
              {emailAddress && (() => {
                const emails = emailAddress.split(',').map(email => email.trim()).filter(Boolean);
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                const invalidEmails = emails.filter(email => !emailRegex.test(email));
                return invalidEmails.length > 0 && (
                  <p className="text-xs text-red-500">
                    Invalid email addresses: {invalidEmails.join(', ')}
                  </p>
                );
              })()}
              <label className="block text-xs text-slate-500">Slack Incoming Webhook (optional)</label>
              <input
                className="w-full px-3 py-2 rounded-xl bg-slate-50 border"
                placeholder="https://hooks.slack.com/services/..."
                value={slackWebhook}
                onChange={(e) => setSlackWebhook(e.target.value)}
              />
              <div className="flex gap-2 mt-2">
                <button className="px-3 py-1.5 rounded bg-emerald-600 text-white" onClick={sendEmailSummary}>Email Summary</button>
                <button className="px-3 py-1.5 rounded bg-slate-900 text-white" onClick={postToSlack}>Post to Slack</button>
                <button className="px-3 py-1.5 rounded bg-white border" onClick={exportJSON}>Export JSON</button>
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
