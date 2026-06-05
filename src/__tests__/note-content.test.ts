import { describe, expect, it } from "vitest";
import { mergeCanvasBody, splitNoteForCanvas } from "../note-content";

describe("splitNoteForCanvas", () => {
  it("returns the full content as editable body when no frontmatter exists", () => {
    const content = "Line one\nLine two\n";

    expect(splitNoteForCanvas(content)).toEqual({
      protectedPrefix: "",
      editableBody: content,
    });
  });

  it("preserves frontmatter and following blank separator lines", () => {
    const content = "---\ntags:\n  - pencil\naliases: [Sketch]\n---\n\nBody line\n";

    expect(splitNoteForCanvas(content)).toEqual({
      protectedPrefix: "---\ntags:\n  - pencil\naliases: [Sketch]\n---\n\n",
      editableBody: "Body line\n",
    });
  });

  it("preserves frontmatter without inventing a blank separator", () => {
    const content = "---\ntags: [pencil]\n---\nBody line\n";

    expect(splitNoteForCanvas(content)).toEqual({
      protectedPrefix: "---\ntags: [pencil]\n---\n",
      editableBody: "Body line\n",
    });
  });

  it("returns an empty editable body for frontmatter-only notes", () => {
    const content = "---\ntags: [pencil]\n---\n";

    expect(splitNoteForCanvas(content)).toEqual({
      protectedPrefix: content,
      editableBody: "",
    });
  });
});

describe("mergeCanvasBody", () => {
  it("adds a trailing newline when writing a note without frontmatter", () => {
    expect(
      mergeCanvasBody({ protectedPrefix: "", editableBody: "" }, "Updated body")
    ).toBe("Updated body\n");
  });

  it("preserves the protected prefix exactly when replacing the body", () => {
    const protectedPrefix = "---\ntags:\n  - pencil\naliases: [Sketch]\n---\n\n";
    const merged = mergeCanvasBody(
      { protectedPrefix, editableBody: "Old body\n" },
      "New body"
    );

    expect(merged).toBe(`${protectedPrefix}New body\n`);
    expect(merged.slice(0, protectedPrefix.length)).toBe(protectedPrefix);
  });

  it("keeps only the protected prefix when the edited body is erased", () => {
    const protectedPrefix = "---\ntags: [pencil]\n---\n\n";

    expect(
      mergeCanvasBody({ protectedPrefix, editableBody: "Old body\n" }, "")
    ).toBe(protectedPrefix);
  });
});
