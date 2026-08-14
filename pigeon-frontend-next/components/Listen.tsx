"use client";

import { useState, useEffect, useRef } from "react";
import { Headphones, Volume2, Square } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import listenContent from "@/lib/listenContent.json";

export type ListenComponentId = keyof typeof listenContent;

export interface ListenProps {
  /** Component ID or name from listenContent.json (e.g. "ReplyFlow", "CampaignInfo") */
  componentId: ListenComponentId;
  /** Optional: override aria-label */
  ariaLabel?: string;
  /** Optional: custom class for the trigger button */
  className?: string;
  /** Optional: popover side ("top" | "right" | "bottom" | "left") */
  side?: "top" | "right" | "bottom" | "left";
  /** Optional: popover alignment */
  align?: "start" | "center" | "end";
}

const CONTENT = listenContent as Record<string, { title: string; excerpt?: string; content: string }>;

/** Strip **bold** markdown for plain text (used for speech) */
function toPlainText(text: string): string {
  return text.replace(/\*\*([^*]+)\*\*/g, "$1").trim();
}

/** Get text to speak — answer/content only, no question (title/excerpt) */
function getSpeakableText(data: { title: string; excerpt?: string; content: string }): string {
  return toPlainText(data.content);
}

/** Renders text with **bold** segments as <strong> */
function renderWithBold(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i} className="text-foreground font-medium">{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

/**
 * Modular Listen component — displays contextual page/component explanations
 * driven by JSON (lib/listenContent.json). Speaks content via Web Speech API when played.
 */
/** Natural, human-like voices by priority (most engaging first) */
const VOICE_PRIORITY = [
  /Samantha|Karen|Victoria|Alex|Emily|Daniel/i,  // macOS — very natural
  /Google.*English|en-US.*Google|en-US-Neural/i,  // Chrome premium / neural
  /Microsoft.*Zira|Microsoft.*Online|en-US.*Natural|Jenny|Aria/i,
  /enhanced|premium|natural|neural/i,
];

function pickNaturalVoice(synth: SpeechSynthesis): SpeechSynthesisVoice | null {
  const voices = synth.getVoices();
  for (const pattern of VOICE_PRIORITY) {
    const found = voices.find((v) => v.lang.startsWith("en") && pattern.test(v.name));
    if (found) return found;
  }
  return voices.find((v) => v.lang.startsWith("en") && v.localService)
    ?? voices.find((v) => v.lang.startsWith("en"))
    ?? null;
}

/** Split text into sentences for natural pacing (prevents monotonous long runs) */
function splitIntoSentences(text: string): string[] {
  const parts = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : [text.trim()].filter(Boolean);
}

/** Pause between sentences (ms) for natural rhythm — not rushed, easy to follow */
const PAUSE_BETWEEN_SENTENCES_MS = 140;

export function Listen({ componentId, ariaLabel, className, side = "top", align = "start" }: ListenProps) {
  const [open, setOpen] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const cancelledRef = useRef(false);
  const data = CONTENT[componentId];
  const label = data ? (ariaLabel ?? `Listen: Learn about ${data.title}`) : "";
  const speakableText = data ? getSpeakableText(data) : "";

  const speak = () => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    if (!speakableText?.trim()) return;
    cancelledRef.current = false;
    try {
      const synth = window.speechSynthesis;
      synth.getVoices(); // Prime Chrome
      synth.cancel();
      if (synth.paused) synth.resume();
      const preferred = pickNaturalVoice(synth);
      // Speech params tuned for smooth, human-like delivery — easy to follow, not boring
      const rate = 0.88;   // Relaxed pace, easy to absorb
      const pitch = 1.0;  // Natural, neutral warmth
      const volume = 0.98;
      const sentences = splitIntoSentences(speakableText);
      const chunks = sentences.length > 0 ? sentences : [speakableText];
      let idx = 0;

      const speakNext = () => {
        if (cancelledRef.current || idx >= chunks.length) {
          setSpeaking(false);
          return;
        }
        const text = chunks[idx].trim();
        idx += 1;
        if (!text) {
          speakNext();
          return;
        }
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = rate;
        utterance.pitch = pitch;
        utterance.volume = volume;
        utterance.lang = "en-US";
        if (preferred) utterance.voice = preferred;
        utterance.onstart = () => setSpeaking(true);
        utterance.onend = utterance.onerror = () => {
          if (cancelledRef.current) return;
          setTimeout(speakNext, PAUSE_BETWEEN_SENTENCES_MS);
        };
        synth.speak(utterance);
      };

      // Safari workaround: brief empty utterance during user gesture unlocks TTS
      const empty = new SpeechSynthesisUtterance("");
      empty.volume = 0;
      empty.onend = () => { if (!cancelledRef.current) speakNext(); };
      synth.speak(empty);
    } catch (e) {
      console.warn("Listen: Speech synthesis failed", e);
    }
  };

  const stop = () => {
    cancelledRef.current = true;
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
    }
  };

  useEffect(() => {
    const synth = typeof window !== "undefined" ? window.speechSynthesis : null;
    if (!synth) return;
    synth.getVoices();
    const onVoices = () => synth.getVoices();
    synth.addEventListener("voiceschanged", onVoices);
    return () => synth.removeEventListener("voiceschanged", onVoices);
  }, []);

  useEffect(() => {
    if (!open) stop();
  }, [open]);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) stop();
  };

  if (!data) return null;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onPointerDown={() => { if (!open) speak(); }}
          className={`inline-flex shrink-0 rounded-full text-muted-foreground hover:text-foreground hover:bg-primary/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring touch-manipulation transition-colors p-1 ${className ?? ""}`}
          aria-label={label}
        >
          <Headphones className="w-3.5 h-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent side={side} align={align} className="max-w-[340px] text-left p-4">
        <p className="font-semibold text-foreground mb-1.5">{data.title}</p>
        {data.excerpt && (
          <p className="text-xs text-muted-foreground mb-2 leading-relaxed">{data.excerpt}</p>
        )}
        <div className="text-xs text-muted-foreground leading-relaxed space-y-2 mb-3">
          {data.content.split("\n").map((line, i) => {
            if (!line.trim()) return null;
            if (line.startsWith("• ")) {
              return (
                <p key={i} className="ml-2">
                  {renderWithBold(line.slice(2))}
                </p>
              );
            }
            return <p key={i}>{renderWithBold(line)}</p>;
          })}
        </div>
        <div className="flex gap-2 pt-2 border-t border-border">
          <Button
            type="button"
            variant={speaking ? "destructive" : "default"}
            size="sm"
            className="h-8 text-xs"
            onClick={speaking ? stop : speak}
          >
            {speaking ? (
              <>
                <Square className="w-3 h-3 mr-1.5" />
                Stop
              </>
            ) : (
              <>
                <Volume2 className="w-3 h-3 mr-1.5" />
                Listen
              </>
            )}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
