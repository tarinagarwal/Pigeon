"use client";

import { useState, useRef, useEffect } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Send,
  Minimize2,
  Maximize2,
  X,
  Sparkles,
  RotateCcw,
  ChevronDown,
  Bot,
  MessageCircle,
  Square,
} from "lucide-react";

/* ─── Types ─────────────────────────────────────────────── */
type Message = {
  id: string;
  role: "user" | "bot";
  text: string;
  timestamp?: Date;
  status?: "sending" | "sent" | "failed";
};

/* ─── Constants ─────────────────────────────────────────── */
const SUGGESTED_PROMPTS = [
  "Set up my first campaign",
  "Inbox warmup",
  "Talk to a human",
];

/* ─── Inline styles & keyframes ─────────────────────────── */
const globalCSS = `
  @import url('https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600&family=Geist+Mono:wght@400;500&display=swap');

  .sr-chat * { box-sizing: border-box; font-family: 'Geist', system-ui, sans-serif; }

  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(10px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes fadeIn {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
  @keyframes scaleIn {
    from { opacity: 0; transform: scale(0.92) translateY(12px); }
    to   { opacity: 1; transform: scale(1) translateY(0); }
  }
  @keyframes pulse-dot {
    0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
    40% { transform: scale(1); opacity: 1; }
  }
  @keyframes shimmer {
    0% { background-position: -200% center; }
    100% { background-position: 200% center; }
  }
  @keyframes glow-ring {
    0%, 100% { box-shadow: 0 0 0 0 rgba(99,179,237,0.0); }
    50% { box-shadow: 0 0 0 4px rgba(99,179,237,0.15); }
  }
  @keyframes fab-pulse {
    0%   { transform: scale(1); box-shadow: 0 0 0 0 rgba(59,130,246,0.55), 0 8px 32px rgba(37,99,235,0.55); }
    60%  { transform: scale(1); box-shadow: 0 0 0 10px rgba(59,130,246,0), 0 8px 32px rgba(37,99,235,0.55); }
    100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(59,130,246,0), 0 8px 32px rgba(37,99,235,0.55); }
  }
  @keyframes fab-label-in {
    from { opacity: 0; transform: translateX(8px); }
    to   { opacity: 1; transform: translateX(0); }
  }

  .msg-enter { animation: fadeUp 0.28s cubic-bezier(0.22,1,0.36,1) both; }
  .widget-enter { animation: scaleIn 0.32s cubic-bezier(0.22,1,0.36,1) both; }

  .dot-1 { animation: pulse-dot 1.4s infinite ease-in-out 0s; }
  .dot-2 { animation: pulse-dot 1.4s infinite ease-in-out 0.2s; }
  .dot-3 { animation: pulse-dot 1.4s infinite ease-in-out 0.4s; }

  .send-btn:not(:disabled):hover { transform: scale(1.06) translateY(-1px); }
  .send-btn:not(:disabled):active { transform: scale(0.96); }
  .send-btn { transition: transform 0.15s ease, background 0.15s ease; }

  .fab-wrap:hover .fab-label { opacity: 1; transform: translateX(0); }
  .fab-label { opacity: 0; transform: translateX(6px); transition: opacity 0.18s ease, transform 0.18s ease; pointer-events: none; }

  .fab:hover { transform: scale(1.1); animation: none; box-shadow: 0 0 0 0 rgba(59,130,246,0), 0 12px 40px rgba(37,99,235,0.7) !important; }
  .fab:active { transform: scale(0.93); }
  .fab { animation: fab-pulse 2.6s ease-out infinite; transition: transform 0.2s cubic-bezier(0.34,1.56,0.64,1); }

  .prompt-chip:hover { background: rgba(99,179,237,0.1); border-color: rgba(99,179,237,0.4); transform: translateY(-1px); }
  .prompt-chip { transition: all 0.15s ease; }

  .ghost-btn:hover { background: rgba(255,255,255,0.06); color: #e2e8f0; }
  .ghost-btn { transition: all 0.12s ease; }

  .scroll-area::-webkit-scrollbar { width: 4px; }
  .scroll-area::-webkit-scrollbar-track { background: transparent; }
  .scroll-area::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 4px; }

  .textarea-input:focus { border-color: rgba(99,179,237,0.5); box-shadow: 0 0 0 3px rgba(99,179,237,0.08); }
  .textarea-input { transition: border-color 0.15s, box-shadow 0.15s; }

  .online-dot { animation: glow-ring 2.4s ease-in-out infinite; }
`;

/* ─── Palette ────────────────────────────────────────────── */
// Deep navy-charcoal glass aesthetic
const C = {
  bg: "rgba(10,12,20,0.97)",
  surface: "rgba(16,19,32,0.98)",
  surfaceAlt: "rgba(22,26,42,0.95)",
  border: "rgba(255,255,255,0.07)",
  borderHover: "rgba(99,179,237,0.3)",
  userBubble: "linear-gradient(135deg, #c2410c 0%, #9a3412 100%)",
  botBubble: "rgba(30,34,54,0.9)",
  accent: "#63b3ed",
  accentDim: "rgba(99,179,237,0.15)",
  text: "#e2e8f0",
  textMuted: "#64748b",
  textDim: "#475569",
  success: "#34d399",
  header: "rgba(13,16,28,0.98)",
};

/* ─── Avatar ─────────────────────────────────────────────── */
function BotAvatar({ size = 32 }: { size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.35,
        background: "linear-gradient(135deg, #1e3a5f 0%, #1a2a4a 100%)",
        border: "1px solid rgba(99,179,237,0.2)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
      }}
    >
      <Bot size={size * 0.45} color={C.accent} strokeWidth={2.5} />
    </div>
  );
}

/* ─── Typing dots ─────────────────────────────────────────── */
function TypingDots() {
  return (
    <div className="msg-enter" style={{ display: "flex", gap: 10, padding: "4px 0" }}>
      <BotAvatar />
      <div
        style={{
          background: C.botBubble,
          border: `1px solid ${C.border}`,
          borderRadius: "18px 18px 18px 4px",
          padding: "12px 16px",
          display: "flex",
          gap: 5,
          alignItems: "center",
        }}
      >
        {[1, 2, 3].map((i) => (
          <span
            key={i}
            className={`dot-${i}`}
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: C.accent,
              display: "inline-block",
            }}
          />
        ))}
      </div>
    </div>
  );
}

/* ─── Main Component ─────────────────────────────────────── */
export function SupportBot() {
  const pathname = usePathname();

  // Hide support bot on workflow edit pages
  if (pathname?.includes("/workflows") && pathname.includes("/edit")) {
    return null;
  }

  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { id: "welcome", role: "bot", text: "Hey there 👋 How can I help you today?", timestamp: new Date() },
  ]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const typingIntervalRef = useRef<number | null>(null);
  const typingMessageIdRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const HUMAN_TRIGGER = "talk to a human";

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  // Clear any active typing interval when the component unmounts
  useEffect(() => {
    return () => {
      if (typingIntervalRef.current) {
        window.clearInterval(typingIntervalRef.current);
      }
      typingMessageIdRef.current = null;
    };
  }, []);

  const startTypingAnimation = (fullText: string) => {
    if (!fullText) {
      setIsTyping(false);
      setIsSending(false);
      return;
    }

    // Clear any existing interval before starting a new one
    if (typingIntervalRef.current) {
      window.clearInterval(typingIntervalRef.current);
    }

    const botId = `b-${Date.now()}`;
    typingMessageIdRef.current = botId;

    setMessages((prev) => [
      ...prev,
      {
        id: botId,
        role: "bot",
        text: "",
        timestamp: new Date(),
        status: "sending",
      },
    ]);

    let index = 0;
    const interval = window.setInterval(() => {
      index += 2; // type 2 characters per frame for smoother speed
      const currentText = fullText.slice(0, index);

      setMessages((prev) =>
        prev.map((m) => (m.id === botId ? { ...m, text: currentText } : m))
      );

      if (index >= fullText.length) {
        window.clearInterval(interval);
        typingIntervalRef.current = null;
        typingMessageIdRef.current = null;
        setIsTyping(false);
        setIsSending(false);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === botId ? { ...m, text: fullText, status: "sent" } : m
          )
        );
      }
    }, 20);

    typingIntervalRef.current = interval;
  };

  const handleSend = async () => {
    // Use ref value at send time to avoid stale closure (chip click, rapid sends)
    const questionToSend = (inputRef.current?.value ?? input).trim();
    if (!questionToSend) return;
    const id = `u-${Date.now()}`;
    setMessages((p) => [...p, { id, role: "user", text: questionToSend, timestamp: new Date(), status: "sent" }]);
    setInput("");
    setIsTyping(true);
    setIsSending(true);

    // Cancel any in-flight request before starting a new one
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const normalized = questionToSend.toLowerCase();

    // Special handling: "Talk to a human" should not hit backend
    if (normalized.includes(HUMAN_TRIGGER)) {
      const answerText =
        "Got it — you’d like to talk to a human.\n\nYou can **create a support ticket** using the button above or by visiting [/tickets](/tickets). Our team will review it and get back to you as soon as possible.";
      startTypingAnimation(answerText);
      return;
    }

    try {
      const history = messages.map((m) => ({
        role: m.role === "bot" ? "assistant" : "user",
        content: m.text,
      }));
      const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "";
      const res = await fetch(`${API_BASE_URL}/support-bot/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: questionToSend, history }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error("Failed to get reply");
      }
      const data = await res.json();
      const answerText = data?.answer ?? "Sorry, I couldn't generate a reply right now.";
      startTypingAnimation(answerText);
    } catch (e: any) {
      // If the user pressed Stop, abort the request silently.
      if (e?.name === "AbortError") {
        setIsTyping(false);
        setIsSending(false);
        abortControllerRef.current = null;
        return;
      }
      setMessages((p) => [
        ...p,
        {
          id: `b-${Date.now()}`,
          role: "bot",
          text: "Sorry, something went wrong while fetching an answer. Please try again in a moment.",
          timestamp: new Date(),
          status: "failed",
        },
      ]);
      setIsTyping(false);
      setIsSending(false);
      abortControllerRef.current = null;
    }
  };

  const handleStop = () => {
    // Stop typing animation
    const activeId = typingMessageIdRef.current;
    if (typingIntervalRef.current) {
      window.clearInterval(typingIntervalRef.current);
      typingIntervalRef.current = null;
    }
    typingMessageIdRef.current = null;

    if (activeId) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === activeId ? { ...m, status: "sent" } : m
        )
      );
    }

    // Abort any in-flight network request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    setIsTyping(false);
    setIsSending(false);
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const fmt = (d: Date) => d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const hasUser = messages.some((m) => m.role === "user");
  const showWelcome = !hasUser && !isTyping;

  /* ── Widget dimensions ── */
  const W = expanded ? 480 : 380;
  const H = expanded ? "min(680px, 85vh)" : "min(520px, 75vh)";

  return (
    <div className="sr-chat">
      <style>{globalCSS}</style>

      {/* FAB */}
      {!open && (
        <div
          className="fab-wrap"
          style={{
            position: "fixed", bottom: 24, right: 24, zIndex: 9999,
            display: "flex", alignItems: "center", gap: 10,
          }}
        >
          {/* Hover label */}
          <div
            className="fab-label"
            style={{
              background: "rgba(10,12,20,0.92)",
              border: "1px solid rgba(99,179,237,0.2)",
              backdropFilter: "blur(12px)",
              borderRadius: 10,
              padding: "7px 13px",
              whiteSpace: "nowrap",
              fontSize: 13,
              fontWeight: 500,
              color: "#e2e8f0",
              boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
              letterSpacing: "-0.01em",
            }}
          >
            AI Support
          </div>

          <button
            className="fab"
            onClick={() => setOpen(true)}
            aria-label="Open AI support chat"
            style={{
              width: 58, height: 58, borderRadius: 20,
              background: "linear-gradient(135deg, #c2410c 0%, #9a3412 50%, #1d4ed8 100%)",
              border: "1.5px solid rgba(147,197,253,0.35)",
              color: "#fff", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <MessageCircle size={24} strokeWidth={2} fill="rgba(255,255,255,0.15)" />
          </button>
        </div>
      )}

      {/* Chat widget */}
      {open && (
        <div
          className="widget-enter"
          role="dialog"
          aria-label="Pigeon Support Chat"
          style={{
            position: "fixed", bottom: 24, right: 24, zIndex: 9999,
            width: W, height: H,
            maxWidth: "calc(100vw - 3rem)",
            display: "flex", flexDirection: "column",
            borderRadius: 24,
            background: C.bg,
            border: `1px solid ${C.border}`,
            boxShadow: "0 32px 80px rgba(0,0,0,0.6), 0 8px 24px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04)",
            overflow: "hidden",
            backdropFilter: "blur(24px)",
            transition: "width 0.3s cubic-bezier(0.22,1,0.36,1), height 0.3s cubic-bezier(0.22,1,0.36,1)",
          }}
        >
          {/* Header */}
          <div style={{
            flexShrink: 0,
            display: "flex", alignItems: "center", gap: 12,
            padding: "14px 16px",
            background: C.header,
            borderBottom: `1px solid ${C.border}`,
          }}>
            <div style={{ position: "relative" }}>
              <BotAvatar size={38} />
              <span
                className="online-dot"
                style={{
                  position: "absolute", bottom: -1, right: -1,
                  width: 10, height: 10, borderRadius: "50%",
                  background: C.success,
                  border: "2px solid #0a0c14",
                }}
              />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: C.text, letterSpacing: "-0.01em" }}>
                Pigeon Support
              </p>
              <p style={{ margin: 0, fontSize: 11.5, color: C.success, fontWeight: 500 }}>
                ● Online now
              </p>
            </div>
            <div style={{ display: "flex", gap: 2 }}>
              <button
                className="ghost-btn"
                onClick={() => setExpanded((v) => !v)}
                aria-label={expanded ? "Shrink" : "Expand"}
                style={{
                  width: 34, height: 34, borderRadius: 10, border: "none",
                  background: "transparent", cursor: "pointer",
                  color: C.textMuted, display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >
                {expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
              </button>
              <button
                className="ghost-btn"
                onClick={() => setOpen(false)}
                aria-label="Close chat"
                style={{
                  width: 34, height: 34, borderRadius: 10, border: "none",
                  background: "transparent", cursor: "pointer",
                  color: C.textMuted, display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >
                <X size={15} />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div
            className="scroll-area"
            role="log"
            aria-live="polite"
            style={{
              flex: 1, overflowY: "auto", padding: "20px 16px",
              display: "flex", flexDirection: "column", gap: 14,
              minHeight: 0,
            }}
          >
            {messages.map((msg, i) => (
              <div
                key={msg.id}
                className="msg-enter"
                style={{
                  display: "flex", flexDirection: "column",
                  alignItems: msg.role === "user" ? "flex-end" : "flex-start",
                  gap: 4,
                  animationDelay: `${i * 0.04}s`,
                }}
              >
                {msg.role === "bot" && (
                  <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
                    <BotAvatar />
                    <div
                      style={{
                        maxWidth: "82%",
                        background: C.botBubble,
                        border: `1px solid ${C.border}`,
                        borderRadius: "18px 18px 18px 4px",
                        padding: "14px 18px 13px",
                        fontSize: 14.5,
                        lineHeight: 1.7,
                        color: C.text,
                        boxShadow: "0 2px 12px rgba(0,0,0,0.2)",
                      }}
                    >
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          h1: ({ children }) => (
                            <h1
                              style={{
                                margin: "0 0 10px",
                                fontSize: 17,
                                fontWeight: 600,
                                color: C.text,
                              }}
                            >
                              {children}
                            </h1>
                          ),
                          h2: ({ children }) => (
                            <h2
                              style={{
                                margin: "12px 0 8px",
                                fontSize: 16,
                                fontWeight: 600,
                                color: C.text,
                              }}
                            >
                              {children}
                            </h2>
                          ),
                          h3: ({ children }) => (
                            <h3
                              style={{
                                margin: "10px 0 6px",
                                fontSize: 15,
                                fontWeight: 600,
                                color: C.text,
                              }}
                            >
                              {children}
                            </h3>
                          ),
                          p: ({ children }) => (
                            <p
                              style={{
                                margin: "0 0 8px",
                                color: C.text,
                                whiteSpace: "pre-wrap",
                              }}
                            >
                              {children}
                            </p>
                          ),
                          ul: ({ children }) => (
                            <ul
                              style={{
                                margin: "0 0 8px 1.2em",
                                paddingLeft: "0.6em",
                                listStyle: "disc",
                              }}
                            >
                              {children}
                            </ul>
                          ),
                          ol: ({ children }) => (
                            <ol
                              style={{
                                margin: "0 0 8px 1.2em",
                                paddingLeft: "0.6em",
                                listStyle: "decimal",
                              }}
                            >
                              {children}
                            </ol>
                          ),
                          li: ({ children }) => (
                            <li
                              style={{
                                marginBottom: 4,
                                paddingLeft: 2,
                              }}
                            >
                              {children}
                            </li>
                          ),
                          strong: ({ children }) => (
                            <strong
                              style={{
                                fontWeight: 600,
                                color: "#e5f0ff",
                              }}
                            >
                              {children}
                            </strong>
                        ),
                        a: ({ href, children }) =>
                          href && href.startsWith("/") ? (
                            <Link
                              href={href}
                              style={{ color: C.accent, textDecoration: "underline" }}
                            >
                              {children}
                            </Link>
                          ) : (
                            <a
                              href={href}
                              target="_blank"
                              rel="noreferrer"
                              style={{ color: C.accent, textDecoration: "underline" }}
                            >
                              {children}
                            </a>
                          ),
                          br: () => <br />,
                        }}
                      >
                        {msg.text}
                      </ReactMarkdown>
                    </div>
                  </div>
                )}
                {msg.role === "user" && (
                  <div style={{
                    maxWidth: "82%",
                    background: C.userBubble,
                    borderRadius: "18px 18px 4px 18px",
                    padding: "11px 15px",
                    fontSize: 13.5,
                    lineHeight: 1.55,
                    color: "#fff",
                    boxShadow: "0 4px 16px rgba(37,99,235,0.3)",
                  }}>
                    {msg.text}
                  </div>
                )}
                {msg.timestamp && (
                  <span style={{ fontSize: 10.5, color: C.textDim, paddingInline: 4 }}>
                    {fmt(msg.timestamp)}
                    {msg.role === "user" && msg.status === "sent" && " · Sent"}
                  </span>
                )}
                {msg.status === "failed" && (
                  <button style={{
                    display: "flex", alignItems: "center", gap: 4,
                    fontSize: 11, color: "#f87171", background: "none", border: "none",
                    cursor: "pointer", paddingInline: 4,
                  }}>
                    <RotateCcw size={10} /> Retry
                  </button>
                )}
              </div>
            ))}

            {isTyping && !typingMessageIdRef.current && <TypingDots />}

            {/* Welcome state */}
            {showWelcome && (
              <div className="msg-enter" style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 4 }}>
                <div style={{
                  background: C.accentDim,
                  border: `1px solid ${C.borderHover}`,
                  borderRadius: 14,
                  padding: "14px 16px",
                  fontSize: 13,
                  color: C.text,
                  lineHeight: 1.6,
                }}>
                  <p style={{ margin: "0 0 4px", fontWeight: 600, fontSize: 13.5 }}>Quick start ✦</p>
                  <p style={{ margin: 0, color: C.textMuted, fontSize: 12.5 }}>
                    Pick a topic below or type anything to get started.
                  </p>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                  {SUGGESTED_PROMPTS.map((p) =>
                    p === "Talk to a human" ? (
                      <div key={p} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <button
                          className="prompt-chip"
                          onClick={() => {
                            setInput(p);
                            inputRef.current?.focus();
                          }}
                          style={{
                            padding: "7px 13px",
                            borderRadius: 20,
                            border: `1px solid rgba(255,255,255,0.1)`,
                            background: "rgba(255,255,255,0.04)",
                            fontSize: 12.5,
                            color: C.text,
                            cursor: "pointer",
                            fontFamily: "inherit",
                            letterSpacing: "-0.01em",
                          }}
                        >
                          {p}
                        </button>
                        <button
                          style={{
                            padding: "7px 13px",
                            borderRadius: 20,
                            border: `1px solid ${C.borderHover}`,
                            background: "rgba(99,179,237,0.18)",
                            fontSize: 12.5,
                            color: C.text,
                            cursor: "pointer",
                            fontFamily: "inherit",
                            letterSpacing: "-0.01em",
                            whiteSpace: "nowrap",
                          }}
                        >
                          <Link
                            href="/tickets"
                            style={{
                              textDecoration: "none",
                              color: "inherit",
                              display: "inline-block",
                              width: "100%",
                            }}
                          >
                            Create ticket
                          </Link>
                        </button>
                      </div>
                    ) : (
                      <button
                        key={p}
                        className="prompt-chip"
                        onClick={() => {
                          setInput(p);
                          inputRef.current?.focus();
                        }}
                        style={{
                          padding: "7px 13px",
                          borderRadius: 20,
                          border: `1px solid rgba(255,255,255,0.1)`,
                          background: "rgba(255,255,255,0.04)",
                          fontSize: 12.5,
                          color: C.text,
                          cursor: "pointer",
                          fontFamily: "inherit",
                          letterSpacing: "-0.01em",
                        }}
                      >
                        {p}
                      </button>
                    )
                  )}
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Footer badge */}
          <div style={{
            flexShrink: 0,
            display: "flex", justifyContent: "center",
            padding: "4px 0 0",
          }}>
            <span style={{
              fontSize: 10.5, color: C.textDim,
              display: "flex", alignItems: "center", gap: 5,
            }}>
              <Sparkles size={9} color={C.accent} />
              Powered by Pigeon AI
            </span>
          </div>

          {/* Input area */}
          <div style={{
            flexShrink: 0,
            padding: "12px 14px 14px",
            borderTop: `1px solid ${C.border}`,
            background: C.surfaceAlt,
          }}>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKey}
                placeholder="Message Pigeon Support..."
                rows={1}
                className="textarea-input"
                aria-label="Message input"
                style={{
                  flex: 1,
                  minHeight: 44, maxHeight: 112,
                  resize: "none",
                  borderRadius: 14,
                  border: `1px solid rgba(255,255,255,0.09)`,
                  background: "rgba(255,255,255,0.04)",
                  color: C.text,
                  fontSize: 13.5,
                  padding: "12px 14px",
                  outline: "none",
                  fontFamily: "inherit",
                  lineHeight: 1.5,
                  caretColor: C.accent,
                }}
              />
              <button
                className="send-btn"
                onClick={isSending || isTyping ? handleStop : handleSend}
                disabled={!(isSending || isTyping) && !input.trim()}
                aria-label={isSending || isTyping ? "Stop response" : "Send message"}
                style={{
                  width: 44, height: 44, flexShrink: 0,
                  borderRadius: 13,
                  border: isSending || isTyping
                    ? "1px solid rgba(248,250,252,0.18)"
                    : "none",
                  background: isSending || isTyping
                    ? "rgba(15,23,42,0.9)"
                    : input.trim()
                      ? "linear-gradient(135deg, #9a3412, #1d4ed8)"
                      : "rgba(255,255,255,0.06)",
                  color: isSending || isTyping
                    ? C.textDim
                    : input.trim()
                      ? "#fff"
                      : C.textDim,
                  cursor: isSending || isTyping
                    ? "pointer"
                    : input.trim()
                      ? "pointer"
                      : "default",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  boxShadow:
                    !isSending && !isTyping && input.trim()
                      ? "0 4px 14px rgba(37,99,235,0.4)"
                      : "none",
                }}
              >
                {isSending || isTyping ? <Square size={16} /> : <Send size={16} />}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}