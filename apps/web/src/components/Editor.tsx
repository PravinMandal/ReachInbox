import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import Link from "@tiptap/extension-link";
import { cn } from "../lib/cn.js";

function ToolBtn({
  title,
  active,
  onClick,
  children,
}: {
  title: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={cn(
        "grid h-8 w-8 place-items-center rounded-lg text-base text-neutral-500 transition-colors hover:bg-neutral-200/70 dark:text-neutral-400 dark:hover:bg-neutral-700",
        active && "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
      )}
    >
      {children}
    </button>
  );
}

/**
 * Working rich-text editor (TipTap). Every toolbar button actually edits —
 * bold/italic/underline, headings, alignment, lists, quote, code, links,
 * undo/redo. Output is HTML, sanitized server-side before send.
 */
export function RichEditor({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (html: string) => void;
  error?: string;
}) {
  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({ heading: { levels: [2, 3] } }),
        Underline,
        TextAlign.configure({ types: ["heading", "paragraph"] }),
        Link.configure({ openOnClick: false, autolink: true }),
      ],
      content: value || "<p></p>",
      editorProps: {
        attributes: {
          class: "tiptap min-h-[180px] w-full text-sm outline-none",
          "aria-label": "Email body",
        },
      },
      onUpdate: ({ editor }) => onChange(editor.getHTML()),
    },
    [],
  );

  const setLink = () => {
    if (!editor) return;
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", prev ?? "https://");
    if (url === null) return;
    if (url === "") editor.chain().focus().unsetLink().run();
    else editor.chain().focus().setLink({ href: url }).run();
  };

  return (
    <div>
      {!editor ? (
        <div className="min-h-[180px] animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-800" />
      ) : (
        <>
          <EditorContent editor={editor} />
          <div className="mt-2 flex flex-wrap items-center gap-0.5 rounded-full bg-white px-3 py-1.5 dark:bg-neutral-800">
            <ToolBtn title="Undo" onClick={() => editor.chain().focus().undo().run()}>↩</ToolBtn>
            <ToolBtn title="Redo" onClick={() => editor.chain().focus().redo().run()}>↪</ToolBtn>
            <span className="mx-1 h-5 w-px bg-neutral-200 dark:bg-neutral-700" />
            <ToolBtn
              title="Heading"
              active={editor.isActive("heading")}
              onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            >
              <span className="text-sm font-semibold">Tt</span>
            </ToolBtn>
            <ToolBtn title="Bold" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
              <b>B</b>
            </ToolBtn>
            <ToolBtn title="Italic" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
              <i>I</i>
            </ToolBtn>
            <ToolBtn title="Underline" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}>
              <u>U</u>
            </ToolBtn>
            <ToolBtn title="Strikethrough" active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}>
              <s>S</s>
            </ToolBtn>
            <span className="mx-1 h-5 w-px bg-neutral-200 dark:bg-neutral-700" />
            <ToolBtn title="Align left" active={editor.isActive({ textAlign: "left" })} onClick={() => editor.chain().focus().setTextAlign("left").run()}>☰</ToolBtn>
            <ToolBtn title="Align center" active={editor.isActive({ textAlign: "center" })} onClick={() => editor.chain().focus().setTextAlign("center").run()}>☷</ToolBtn>
            <ToolBtn title="Align right" active={editor.isActive({ textAlign: "right" })} onClick={() => editor.chain().focus().setTextAlign("right").run()}>☵</ToolBtn>
            <span className="mx-1 h-5 w-px bg-neutral-200 dark:bg-neutral-700" />
            <ToolBtn title="Bullet list" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>•☰</ToolBtn>
            <ToolBtn title="Numbered list" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>1.</ToolBtn>
            <ToolBtn title="Quote" active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}>❝</ToolBtn>
            <ToolBtn title="Code" active={editor.isActive("codeBlock")} onClick={() => editor.chain().focus().toggleCodeBlock().run()}>⌨</ToolBtn>
            <ToolBtn title="Link" active={editor.isActive("link")} onClick={setLink}>🔗</ToolBtn>
          </div>
        </>
      )}
      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}

export type { Editor };
