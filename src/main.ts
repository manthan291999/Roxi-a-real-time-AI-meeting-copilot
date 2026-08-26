import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// --- DOM Elements ---
const btnStart = document.getElementById("btn-start") as HTMLButtonElement;
const btnStop = document.getElementById("btn-stop") as HTMLButtonElement;
const indicatorDot = document.querySelector(".indicator .dot") as HTMLDivElement;
const indicatorText = document.querySelector(".indicator span") as HTMLSpanElement;
const micPulse = document.getElementById("mic-pulse") as HTMLDivElement;
const transcriptHistory = document.getElementById("transcript-history") as HTMLDivElement;
const transcriptPartial = document.getElementById("transcript-partial") as HTMLDivElement;
const contextContent = document.getElementById("context-content") as HTMLDivElement;
const responseContent = document.getElementById("response-content") as HTMLDivElement;
const sigBadge = document.getElementById("sig-badge") as HTMLDivElement;

// Hide placeholders when content arrives
function hidePlaceholders() {
  const placeholders = document.querySelectorAll('.placeholder');
  placeholders.forEach(p => (p as HTMLElement).style.display = 'none');
}

// --- State ---
let lastSpeaker: string | null = null;
let lastTimestamp: number = 0;
let currentTextSpan: HTMLSpanElement | null = null;
const NEW_PARAGRAPH_THRESHOLD = 2000;

function getSpeakerClass(speaker: string): string {
  if (!speaker) return "speaker-a";
  const match = speaker.match(/([A-Ea-e]|\d+)/);
  if (match) {
    const val = match[1].toUpperCase();
    if (val >= 'A' && val <= 'E') {
      return `speaker-${val.toLowerCase()}`;
    }
    const num = parseInt(val, 10);
    if (num >= 1 && num <= 5) {
      return `speaker-${String.fromCharCode(96 + num)}`;
    }
  }
  return "speaker-a";
}

// --- Event Listeners (UI) ---

btnStart.addEventListener("click", async () => {
  try {
    // Clear UI for new session
    transcriptHistory.innerHTML = "";
    transcriptPartial.innerHTML = "";
    currentTextSpan = null;
    lastSpeaker = null;
    lastTimestamp = 0;
    
    // Keep placeholder div but remove other children
    Array.from(contextContent.children).forEach(child => {
      if (!child.classList.contains('placeholder') && child.id !== 'sig-badge') {
        child.remove();
      }
    });
    const techContent = document.getElementById("technical-content");
    if (techContent) {
      Array.from(techContent.children).forEach(child => {
        if (!child.classList.contains('placeholder')) child.remove();
      });
    }
    Array.from(responseContent.children).forEach(child => {
      if (!child.classList.contains('placeholder')) child.remove();
    });
    
    // Show placeholders again
    const placeholders = document.querySelectorAll('.placeholder');
    placeholders.forEach(p => (p as HTMLElement).style.display = 'block');

    // Tell Rust to start the capture sidecar
    await invoke("start_capture");
    
    btnStart.disabled = true;
    btnStop.disabled = false;
    
    indicatorDot.className = "dot green";
    indicatorText.textContent = "Live";
    micPulse.classList.remove("hidden");
    
  } catch (err) {
    console.error("Failed to start capture:", err);
    alert(`Failed to start capture: ${err}`);
  }
});

btnStop.addEventListener("click", async () => {
  try {
    await invoke("stop_capture");
    
    btnStart.disabled = false;
    btnStop.disabled = true;
    
    indicatorDot.className = "dot gray";
    indicatorText.textContent = "Ready";
    micPulse.classList.add("hidden");
    transcriptPartial.textContent = "";
  } catch (err) {
    console.error("Failed to stop capture:", err);
  }
});

// --- Event Listeners (Tauri Backend) ---

// Listen for Partial Transcripts
listen<{text: string, speaker: string}>("transcript_partial", (event) => {
  hidePlaceholders();
  const colorClass = getSpeakerClass(event.payload.speaker);
  transcriptPartial.innerHTML = `<span class="speaker-label ${colorClass}">${event.payload.speaker}</span> <span class="transcript-text">${event.payload.text}</span>`;
  autoScroll();
});

// Listen for Final Transcripts
listen<{text: string, speaker: string, start?: number, end?: number}>("transcript_final", (event) => {
  hidePlaceholders();
  
  const now = Date.now();
  const timeSinceLast = now - lastTimestamp;
  const isSameSpeaker = event.payload.speaker === lastSpeaker;
  const isWithinThreshold = timeSinceLast < NEW_PARAGRAPH_THRESHOLD;

  if (isSameSpeaker && isWithinThreshold && currentTextSpan) {
    // Append to existing paragraph
    currentTextSpan.textContent += " " + event.payload.text;
  } else {
    // Create new final text block
    const block = document.createElement("div");
    block.className = "transcript-block";
    if (event.payload.start !== undefined) {
      block.dataset.start = event.payload.start.toString();
    }
    
    const colorClass = getSpeakerClass(event.payload.speaker);
    
    const labelSpan = document.createElement("span");
    labelSpan.className = `speaker-label ${colorClass}`;
    labelSpan.textContent = event.payload.speaker;

    const textSpan = document.createElement("span");
    textSpan.className = "transcript-text";
    textSpan.textContent = event.payload.text;

    block.appendChild(labelSpan);
    block.appendChild(document.createTextNode(" "));
    block.appendChild(textSpan);
    
    // Append
    transcriptHistory.appendChild(block);
    
    // Update state
    currentTextSpan = textSpan;
    lastSpeaker = event.payload.speaker;
  }

  // Common updates
  lastTimestamp = now;
  transcriptPartial.textContent = "";
  
  autoScroll();
});

// Listen for Speaker Revisions
listen<any>("speaker_revision", (event) => {
  console.log("Speaker revision received:", event.payload);
  // Optional: We could walk the transcriptHistory DOM elements and update labels if they match start/end times.
  // For now, it's captured in the backend logs and history.
  
  const el = document.createElement("div");
  el.className = "p-2 text-xs text-center text-outline-variant italic mt-2 mb-2 bg-surface-container-lowest rounded";
  el.textContent = "AI refined speaker labels for the previous segment.";
  transcriptHistory.appendChild(el);
  autoScroll();
});

// Listen for backend errors
listen<string>("capture_error", (event) => {
  console.error("Backend error:", event.payload);
  
  // Reset UI
  btnStart.disabled = false;
  btnStop.disabled = true;
  indicatorDot.className = "dot gray";
  indicatorText.textContent = "Error";
  micPulse.classList.add("hidden");
  
  alert(`Capture error: ${event.payload}`);
});

// Listen for STT provider status (AssemblyAI primary / Speechmatics fallback)
listen<{provider: string | null, state: string}>("provider_status", (event) => {
  const { provider, state } = event.payload;
  const isBackup = provider === "speechmatics";

  switch (state) {
    case "connecting":
      indicatorDot.className = "dot amber";
      indicatorText.textContent = "Connecting…";
      break;
    case "switching":
      indicatorDot.className = "dot amber";
      indicatorText.textContent = isBackup ? "Switching to backup…" : "Reconnecting…";
      break;
    case "active":
      indicatorDot.className = "dot green";
      indicatorText.textContent = isBackup ? "Live · Backup STT" : "Live";
      break;
    case "failed":
      indicatorDot.className = "dot red";
      indicatorText.textContent = "Transcription unavailable";
      break;
  }
});

// Listen for Context Explanations (LangGraph)
listen<{text: string, speaker: string}>("context_explanation", (event) => {
  // We append it to the pane
  const el = document.createElement("div");
  el.className = "explanation-card";
  
  const colorClass = getSpeakerClass(event.payload.speaker);
  const tag = document.createElement("div");
  tag.className = `context-speaker-tag ${colorClass}`;
  tag.textContent = event.payload.speaker;

  const textEl = document.createElement("div");
  textEl.textContent = event.payload.text;

  el.appendChild(tag);
  el.appendChild(textEl);
  
  // Add a divider if there are already cards
  if (contextContent.children.length > 0 && contextContent.firstElementChild?.classList.contains('placeholder') === false) {
    const divider = document.createElement("hr");
    contextContent.appendChild(divider);
  }
  
  contextContent.appendChild(el);
  
  // auto scroll the context pane
  contextContent.scrollTop = contextContent.scrollHeight;
});

const technicalContent = document.getElementById("technical-content") as HTMLDivElement;

// Listen for Technical Explanations
listen<{text: string, speaker: string}>("technical_explanation", (event) => {
  const el = document.createElement("div");
  el.className = "explanation-card";
  el.style.backgroundColor = "#EEF2F6"; // Slightly different tint for tech
  el.style.borderLeft = "4px solid #334155";
  
  const colorClass = getSpeakerClass(event.payload.speaker);
  const tag = document.createElement("div");
  tag.className = `context-speaker-tag ${colorClass}`;
  tag.textContent = event.payload.speaker;

  const textEl = document.createElement("div");
  textEl.textContent = event.payload.text;
  textEl.style.fontFamily = "'JetBrains Mono', monospace";
  textEl.style.fontSize = "0.85rem";

  el.appendChild(tag);
  el.appendChild(textEl);
  
  if (technicalContent.children.length > 0 && technicalContent.firstElementChild?.classList.contains('placeholder') === false) {
    const divider = document.createElement("hr");
    technicalContent.appendChild(divider);
  }
  
  technicalContent.appendChild(el);
  technicalContent.scrollTop = technicalContent.scrollHeight;
});

// Listen for Significance badge updates (LangGraph)
listen<string>("chunk_significance", (event) => {
  const level = event.payload.toLowerCase(); // "none", "low", "medium", "high"
  
  // Emojis for importance indicator
  let emoji = "⚪";
  if (level === "low") emoji = "🟢";
  if (level === "medium") emoji = "🟡";
  if (level === "high") emoji = "🔴";
  
  // Update badge UI
  sigBadge.textContent = `${emoji} ${level.charAt(0).toUpperCase() + level.slice(1)}`;
  sigBadge.className = "significance-badge " + level;
  
  // Flash effect
  sigBadge.style.transform = "scale(1.1)";
  setTimeout(() => { sigBadge.style.transform = "scale(1)"; }, 200);
});

// Listen for Circuit Breaker
listen("circuit_breaker", () => {
  indicatorDot.className = "dot red";
  indicatorText.textContent = "Cost Limit Reached";
  console.warn("Circuit Breaker triggered: API call limit exceeded for this meeting.");
  alert("Meeting limit reached. Further AI processing is paused to control costs.");
});

// Listen for Decisions (LangGraph Meeting Analyst)
listen<any[]>("meeting_decisions", (event) => {
  const decisions = event.payload;
  decisions.forEach(d => {
    const el = document.createElement("div");
    el.className = "explanation-card";
    el.innerHTML = `<strong>Decision:</strong> ${d.text}`;
    responseContent.appendChild(el);
  });
  responseContent.scrollTop = responseContent.scrollHeight;
});

// Listen for Action Items (LangGraph Meeting Analyst)
listen<any[]>("meeting_action_items", (event) => {
  const items = event.payload;
  items.forEach(item => {
    const el = document.createElement("div");
    el.className = "explanation-card";
    el.innerHTML = `<strong>Action Item:</strong> ${item.text} <br><em>Assignee:</em> ${item.assignee || 'Unassigned'}`;
    responseContent.appendChild(el);
  });
  responseContent.scrollTop = responseContent.scrollHeight;
});

// Listen for Suggested Responses (LangGraph Response Agent)
listen<{text: string, speaker: string}>("suggested_response", (event) => {
  const text = event.payload.text;
  const speaker = event.payload.speaker;
  const colorClass = getSpeakerClass(speaker);
  
  const el = document.createElement("div");
  el.className = "suggested-response-card";
  
  // Icon and text wrapper
  el.innerHTML = `
    <div style="display: flex; align-items: start; gap: 0.75rem;">
      <div style="color: var(--primary-color);">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
        </svg>
      </div>
      <div>
        <div class="context-speaker-tag ${colorClass}">${speaker}</div>
        <div style="font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 0.25rem;">Suggested Reply</div>
        <div style="color: var(--text-primary); font-size: 0.95rem; line-height: 1.5;">${text}</div>
      </div>
    </div>
  `;
  
  // Add a divider if there are already cards
  if (responseContent.children.length > 0 && responseContent.firstElementChild?.classList.contains('placeholder') === false) {
    const divider = document.createElement("hr");
    responseContent.appendChild(divider);
  }
  
  responseContent.appendChild(el);
  responseContent.scrollTop = responseContent.scrollHeight;
});

// --- Utility ---
function autoScroll() {
  const container = document.getElementById("transcript-content");
  if (container) {
    container.scrollTop = container.scrollHeight;
  }
}

// --- History Modal Logic ---
const btnHistory = document.getElementById("btn-history") as HTMLButtonElement;
const historyModal = document.getElementById("history-modal") as HTMLDivElement;
const btnCloseHistory = document.getElementById("btn-close-history") as HTMLButtonElement;
const historyList = document.getElementById("history-list") as HTMLDivElement;
const historyDetailEmpty = document.getElementById("history-detail-empty") as HTMLDivElement;
const historyDetailContent = document.getElementById("history-detail-content") as HTMLDivElement;
const historyDetailDate = document.getElementById("history-detail-date") as HTMLHeadingElement;
const historyDetailSummary = document.getElementById("history-detail-summary") as HTMLParagraphElement;
const historyDetailTranscript = document.getElementById("history-detail-transcript") as HTMLDivElement;
const historyDetailDecisions = document.getElementById("history-detail-decisions") as HTMLUListElement;
const historyDetailActions = document.getElementById("history-detail-actions") as HTMLUListElement;

btnHistory?.addEventListener("click", async () => {
  historyModal.classList.remove("hidden");
  await loadMeetingsList();
});

btnCloseHistory?.addEventListener("click", () => {
  historyModal.classList.add("hidden");
});

async function loadMeetingsList() {
  try {
    const meetings: any[] = await invoke("get_meetings");
    historyList.innerHTML = "";
    
    if (meetings.length === 0) {
      historyList.innerHTML = `<div class="p-4 text-outline text-sm text-center">No past meetings found.</div>`;
      return;
    }
    
    meetings.forEach(m => {
      const el = document.createElement("div");
      el.className = "p-4 border-b border-outline-variant cursor-pointer hover:bg-surface-container-low transition-colors";
      
      const date = new Date(m.start_time + "Z").toLocaleString();
      const summary = m.summary ? m.summary.substring(0, 60) + "..." : "No summary available";
      
      el.innerHTML = `
        <div class="font-bold text-on-surface text-sm">${date}</div>
        <div class="text-xs text-on-surface-variant mt-1">${summary}</div>
      `;
      
      el.addEventListener("click", () => loadMeetingDetails(m.id, date));
      historyList.appendChild(el);
    });
  } catch (err) {
    console.error("Failed to load meetings:", err);
    historyList.innerHTML = `<div class="p-4 text-red-500 text-sm">Failed to load meetings.</div>`;
  }
}

async function loadMeetingDetails(id: number, formattedDate: string) {
  try {
    const details: any = await invoke("get_meeting_details", { id });
    
    historyDetailEmpty.classList.add("hidden");
    historyDetailContent.classList.remove("hidden");
    
    historyDetailDate.textContent = `Meeting on ${formattedDate}`;
    historyDetailSummary.textContent = details.meeting.summary || "No summary was generated for this meeting.";
    
    // Transcripts
    historyDetailTranscript.innerHTML = `<h4 class="font-bold text-primary mb-4 text-sm uppercase tracking-wider">Full Transcript</h4>`;
    if (details.transcripts.length === 0) {
      historyDetailTranscript.innerHTML += `<div class="text-outline text-sm italic">No transcript recorded.</div>`;
    } else {
      details.transcripts.forEach((t: any) => {
        const colorClass = getSpeakerClass(t.speaker);
        const el = document.createElement("div");
        el.className = "mb-4";
        el.innerHTML = `
          <div class="context-speaker-tag ${colorClass}">${t.speaker}</div>
          <div class="text-on-surface mt-1">${t.text}</div>
        `;
        historyDetailTranscript.appendChild(el);
      });
    }
    
    // Decisions
    historyDetailDecisions.innerHTML = "";
    if (details.decisions.length === 0) {
      historyDetailDecisions.innerHTML = `<li class="text-outline text-sm italic list-none -ml-5">No decisions recorded.</li>`;
    } else {
      details.decisions.forEach((d: any) => {
        const li = document.createElement("li");
        li.textContent = d.description;
        historyDetailDecisions.appendChild(li);
      });
    }
    
    // Action Items
    historyDetailActions.innerHTML = "";
    if (details.action_items.length === 0) {
      historyDetailActions.innerHTML = `<li class="text-outline text-sm italic list-none -ml-5">No action items recorded.</li>`;
    } else {
      details.action_items.forEach((a: any) => {
        const li = document.createElement("li");
        li.innerHTML = `<strong>${a.assignee}:</strong> ${a.description}`;
        historyDetailActions.appendChild(li);
      });
    }
    
  } catch (err) {
    console.error("Failed to load details:", err);
    alert("Failed to load meeting details.");
  }
}

