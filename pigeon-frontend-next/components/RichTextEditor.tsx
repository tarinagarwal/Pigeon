"use client";

import { useEffect, useImperativeHandle, forwardRef } from "react";
import { useEditor, EditorContent, Editor, Extension } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Underline from "@tiptap/extension-underline";
import Placeholder from "@tiptap/extension-placeholder";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import FontFamily from "@tiptap/extension-font-family";
import Highlight from "@tiptap/extension-highlight";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Link as LinkIcon,
  List,
  ListOrdered,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  Unlink,
  Baseline,
  Highlighter,
  Eraser,
  Undo2,
  Redo2,
  Quote,
  Minus,
} from "lucide-react";
import { cn } from "@/lib/utils";

/** Scoped light UI so the editor stays readable when the app is in dark mode (inherits light text on white surfaces). */
const RTE_ROOT = cn(
  "[color-scheme:light] text-neutral-900 bg-white",
  "border border-neutral-200 overflow-hidden rounded-md shadow-sm"
);

// ─── Custom FontSize extension ────────────────────────────────────────────────
const FontSize = Extension.create({
  name: "fontSize",
  addOptions() {
    return { types: ["textStyle"] };
  },
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (el) => el.style.fontSize || null,
            renderHTML: (attrs) =>
              attrs.fontSize ? { style: `font-size: ${attrs.fontSize}` } : {},
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setFontSize:
        (size: string) =>
        ({ chain }: { chain: () => ReturnType<Editor["chain"]> }) =>
          chain().setMark("textStyle", { fontSize: size }).run(),
      unsetFontSize:
        () =>
        ({ chain }: { chain: () => ReturnType<Editor["chain"]> }) =>
          chain().setMark("textStyle", { fontSize: null }).run(),
    } as never;
  },
});

// ─── Constants ────────────────────────────────────────────────────────────────
const FONT_FAMILIES = [
  { label: "Default", value: "" },
  { label: "Arial", value: "Arial, sans-serif" },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Verdana", value: "Verdana, sans-serif" },
  { label: "Times New Roman", value: "'Times New Roman', serif" },
  { label: "Courier New", value: "'Courier New', monospace" },
  { label: "Tahoma", value: "Tahoma, sans-serif" },
  { label: "Trebuchet MS", value: "'Trebuchet MS', sans-serif" },
];

const FONT_SIZES = ["10px", "12px", "14px", "16px", "18px", "20px", "24px", "28px", "32px", "36px", "48px"];

const TEXT_COLORS = [
  "#000000", "#374151", "#6B7280", "#9CA3AF",
  "#DC2626", "#EA580C", "#D97706", "#16A34A",
  "#9a3412", "#9a3412", "#DB2777", "#0891B2",
];

const HIGHLIGHT_COLORS = [
  "#FEF08A", "#FDE68A", "#BBF7D0", "#BAE6FD",
  "#DDD6FE", "#FBCFE8", "#FED7AA", "#E5E7EB",
];

// ─── Types ────────────────────────────────────────────────────────────────────
export type RichTextEditorRef = { editor: Editor | null };

type Props = {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
};

// ─── Component ────────────────────────────────────────────────────────────────
export const RichTextEditor = forwardRef<RichTextEditorRef, Props>(
  ({ value, onChange, placeholder = "Write your email here...", className }, ref) => {
    const editor = useEditor({
      immediatelyRender: false,
      extensions: [
        StarterKit,
        Underline,
        TextStyle,
        Color,
        FontFamily,
        FontSize,
        Highlight.configure({ multicolor: true }),
        Link.configure({ openOnClick: false, autolink: true }),
        Placeholder.configure({ placeholder }),
        TextAlign.configure({ types: ["heading", "paragraph"] }),
      ],
      content: value || "",
      onUpdate({ editor }) {
        onChange(editor.getHTML());
      },
    });

    useImperativeHandle(ref, () => ({ editor: editor ?? null }));

    useEffect(() => {
      if (!editor) return;
      if (value !== editor.getHTML()) {
        editor.commands.setContent(value || "", { emitUpdate: false });
      }
    }, [value, editor]);

    if (!editor) return null;

    const activeColor = editor.getAttributes("textStyle").color as string | undefined;
    const activeHighlight = editor.getAttributes("highlight").color as string | undefined;
    const activeFont = editor.getAttributes("textStyle").fontFamily as string | undefined;
    const activeFontSize = editor.getAttributes("textStyle").fontSize as string | undefined;

    const currentHeading = editor.isActive("heading", { level: 1 })
      ? "h1"
      : editor.isActive("heading", { level: 2 })
      ? "h2"
      : editor.isActive("heading", { level: 3 })
      ? "h3"
      : "p";

    const setLink = () => {
      const prev = editor.getAttributes("link").href as string | undefined;
      const url = window.prompt("Enter URL", prev ?? "https://");
      if (url === null) return;
      if (url === "") {
        editor.chain().focus().extendMarkRange("link").unsetLink().run();
      } else {
        editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
      }
    };

    const clearFormatting = () => {
      editor.chain().focus().clearNodes().unsetAllMarks().run();
    };

    return (
      <div className={cn(RTE_ROOT, className)}>
        {/* ── Toolbar ── */}
        <div className="flex flex-wrap items-center gap-0.5 border-b border-neutral-200 bg-neutral-100 px-2 py-1.5">

          {/* Undo / Redo */}
          <Btn title="Undo" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()}>
            <Undo2 className="w-3.5 h-3.5" />
          </Btn>
          <Btn title="Redo" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()}>
            <Redo2 className="w-3.5 h-3.5" />
          </Btn>

          <Divider />

          {/* Heading type */}
          <select
            value={currentHeading}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "p") editor.chain().focus().setParagraph().run();
              else editor.chain().focus().setHeading({ level: Number(v.slice(1)) as 1 | 2 | 3 }).run();
            }}
            className="h-7 cursor-pointer rounded border border-neutral-300 bg-white px-1.5 text-xs text-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-400"
            title="Text style"
          >
            <option value="p">Normal</option>
            <option value="h1">Heading 1</option>
            <option value="h2">Heading 2</option>
            <option value="h3">Heading 3</option>
          </select>

          {/* Font family */}
          <select
            value={activeFont ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) editor.chain().focus().unsetFontFamily().run();
              else editor.chain().focus().setFontFamily(v).run();
            }}
            className="h-7 max-w-[110px] cursor-pointer rounded border border-neutral-300 bg-white px-1.5 text-xs text-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-400"
            title="Font family"
          >
            {FONT_FAMILIES.map((f) => (
              <option key={f.value} value={f.value} style={{ fontFamily: f.value || undefined }}>
                {f.label}
              </option>
            ))}
          </select>

          {/* Font size */}
          <select
            value={activeFontSize ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) (editor.chain().focus() as ReturnType<Editor["chain"]> & { unsetFontSize: () => ReturnType<Editor["chain"]> }).unsetFontSize().run();
              else (editor.chain().focus() as ReturnType<Editor["chain"]> & { setFontSize: (s: string) => ReturnType<Editor["chain"]> }).setFontSize(v).run();
            }}
            className="h-7 w-[68px] cursor-pointer rounded border border-neutral-300 bg-white px-1.5 text-xs text-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-400"
            title="Font size"
          >
            <option value="">Size</option>
            {FONT_SIZES.map((s) => (
              <option key={s} value={s}>{s.replace("px", "")}</option>
            ))}
          </select>

          <Divider />

          {/* Bold / Italic / Underline / Strike */}
          <Btn active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} title="Bold">
            <Bold className="w-3.5 h-3.5" />
          </Btn>
          <Btn active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic">
            <Italic className="w-3.5 h-3.5" />
          </Btn>
          <Btn active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()} title="Underline">
            <UnderlineIcon className="w-3.5 h-3.5" />
          </Btn>
          <Btn active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()} title="Strikethrough">
            <Strikethrough className="w-3.5 h-3.5" />
          </Btn>

          <Divider />

          {/* Text color */}
          <ColorPicker
            icon={<Baseline className="h-3.5 w-3.5" />}
            activeColor={activeColor}
            presets={TEXT_COLORS}
            onSelect={(c) => editor.chain().focus().setColor(c).run()}
            onReset={() => editor.chain().focus().unsetColor().run()}
            title="Text color"
            barStyle={{ backgroundColor: activeColor ?? "#000000" }}
          />

          {/* Highlight color */}
          <ColorPicker
            icon={<Highlighter className="h-3.5 w-3.5" />}
            activeColor={activeHighlight}
            presets={HIGHLIGHT_COLORS}
            onSelect={(c) => editor.chain().focus().setHighlight({ color: c }).run()}
            onReset={() => editor.chain().focus().unsetHighlight().run()}
            title="Highlight color"
            barStyle={{ backgroundColor: activeHighlight ?? "#FEF08A" }}
          />

          {/* Clear formatting */}
          <Btn onClick={clearFormatting} title="Clear formatting">
            <Eraser className="w-3.5 h-3.5" />
          </Btn>

          <Divider />

          {/* Link */}
          <Btn active={editor.isActive("link")} onClick={setLink} title="Insert link">
            <LinkIcon className="w-3.5 h-3.5" />
          </Btn>
          {editor.isActive("link") && (
            <Btn onClick={() => editor.chain().focus().unsetLink().run()} title="Remove link">
              <Unlink className="w-3.5 h-3.5" />
            </Btn>
          )}

          <Divider />

          {/* Lists */}
          <Btn active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Bullet list">
            <List className="w-3.5 h-3.5" />
          </Btn>
          <Btn active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Ordered list">
            <ListOrdered className="w-3.5 h-3.5" />
          </Btn>

          {/* Blockquote */}
          <Btn active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()} title="Blockquote">
            <Quote className="w-3.5 h-3.5" />
          </Btn>

          {/* Horizontal rule */}
          <Btn onClick={() => editor.chain().focus().setHorizontalRule().run()} title="Horizontal rule">
            <Minus className="w-3.5 h-3.5" />
          </Btn>

          <Divider />

          {/* Alignment */}
          <Btn active={editor.isActive({ textAlign: "left" })} onClick={() => editor.chain().focus().setTextAlign("left").run()} title="Align left">
            <AlignLeft className="w-3.5 h-3.5" />
          </Btn>
          <Btn active={editor.isActive({ textAlign: "center" })} onClick={() => editor.chain().focus().setTextAlign("center").run()} title="Align center">
            <AlignCenter className="w-3.5 h-3.5" />
          </Btn>
          <Btn active={editor.isActive({ textAlign: "right" })} onClick={() => editor.chain().focus().setTextAlign("right").run()} title="Align right">
            <AlignRight className="w-3.5 h-3.5" />
          </Btn>
          <Btn active={editor.isActive({ textAlign: "justify" })} onClick={() => editor.chain().focus().setTextAlign("justify").run()} title="Justify">
            <AlignJustify className="w-3.5 h-3.5" />
          </Btn>
        </div>

        {/* ── Editor area ── */}
        <EditorContent
          editor={editor}
          className="min-h-[300px] bg-white px-3 py-2 text-sm text-neutral-900 [&_.tiptap]:min-h-[280px] [&_.tiptap]:text-neutral-900 [&_.tiptap]:outline-none [&_.tiptap_p.is-editor-empty:first-child::before]:float-left [&_.tiptap_p.is-editor-empty:first-child::before]:pointer-events-none [&_.tiptap_p.is-editor-empty:first-child::before]:text-neutral-400 [&_.tiptap_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)] [&_.tiptap_a]:text-primary [&_.tiptap_a]:underline [&_.tiptap_ul]:list-disc [&_.tiptap_ul]:pl-5 [&_.tiptap_ol]:list-decimal [&_.tiptap_ol]:pl-5 [&_.tiptap_p]:my-1 [&_.tiptap_h1]:my-2 [&_.tiptap_h1]:text-2xl [&_.tiptap_h1]:font-bold [&_.tiptap_h2]:my-2 [&_.tiptap_h2]:text-xl [&_.tiptap_h2]:font-bold [&_.tiptap_h3]:my-1 [&_.tiptap_h3]:text-lg [&_.tiptap_h3]:font-semibold [&_.tiptap_blockquote]:my-2 [&_.tiptap_blockquote]:border-l-4 [&_.tiptap_blockquote]:border-neutral-300 [&_.tiptap_blockquote]:pl-3 [&_.tiptap_blockquote]:text-neutral-600 [&_.tiptap_hr]:my-3 [&_.tiptap_hr]:border-neutral-200"
        />
      </div>
    );
  }
);

RichTextEditor.displayName = "RichTextEditor";

// ─── Toolbar button (plain <button>: shadcn ghost uses theme foreground; breaks on white in dark mode) ──
function Btn({
  children,
  active,
  onClick,
  title,
  disabled,
}: {
  children: React.ReactNode;
  active?: boolean;
  onClick: () => void;
  title: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-neutral-700 transition-colors",
        "hover:bg-neutral-200 hover:text-neutral-900",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400/90 focus-visible:ring-offset-2 focus-visible:ring-offset-white",
        active && "bg-neutral-200 text-neutral-900",
        disabled && "pointer-events-none opacity-40"
      )}
      onClick={onClick}
      title={title}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div className="mx-1 h-5 w-px shrink-0 bg-neutral-300" />;
}

// ─── Inline color picker ──────────────────────────────────────────────────────
function ColorPicker({
  icon,
  activeColor,
  presets,
  onSelect,
  onReset,
  title,
  barStyle,
}: {
  icon: React.ReactNode;
  activeColor?: string;
  presets: string[];
  onSelect: (color: string) => void;
  onReset: () => void;
  title: string;
  barStyle?: React.CSSProperties;
}) {
  return (
    <div className="flex items-center gap-0.5">
      {/* Icon + underbar — clicking opens the native color picker */}
      <div
        className="relative flex h-7 w-7 cursor-pointer flex-col items-center justify-center rounded text-neutral-700 transition-colors hover:bg-neutral-200 hover:text-neutral-900"
        title={title}
      >
        {icon}
        <div className="mt-0.5 h-1 w-4 rounded-sm" style={barStyle} />
        <input
          type="color"
          value={activeColor ?? "#000000"}
          onChange={(e) => onSelect(e.target.value)}
          className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
          title={title}
        />
      </div>

      {/* Preset swatches */}
      {presets.map((color) => (
        <button
          key={color}
          type="button"
          title={color}
          className={cn(
            "h-4 w-4 shrink-0 rounded-sm border border-neutral-300 transition-transform hover:scale-110",
            activeColor === color && "ring-2 ring-neutral-500 ring-offset-1 ring-offset-neutral-100"
          )}
          style={{ backgroundColor: color }}
          onClick={() => onSelect(color)}
        />
      ))}

      {/* Reset */}
      <button
        type="button"
        title="Remove"
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-neutral-300 bg-white text-[9px] font-bold text-neutral-600 transition-transform hover:scale-110"
        onClick={onReset}
      >
        ✕
      </button>
    </div>
  );
}
