import { describe, expect, it, vi, beforeEach } from "vitest";
import { Notice, WorkspaceLeaf } from "obsidian";
import { PencilCanvasView } from "../canvas-view";
import { DEFAULT_SETTINGS } from "../types";

function makeAppWithNote(initialContent: string) {
  let content = initialContent;

  const app: any = {
    vault: {
    read: vi.fn(async () => content),
    process: vi.fn(async (_file, updater) => {
      content = updater(content);
      return content;
    }),
    },
    workspace: {
      getLeavesOfType: vi.fn(() => []),
      setActiveLeaf: vi.fn(),
      openLinkText: vi.fn(),
      on: vi.fn(() => () => {}),
    },
    secretStorage: {
      getSecret: vi.fn(() => null),
    },
  };

  return {
    app,
    getContent: () => content,
  };
}

function makeView(initialContent: string) {
  const { app, getContent } = makeAppWithNote(initialContent);
  const leaf = new (WorkspaceLeaf as any)(app);
  const noteFile = { path: "Notes/Test.md", basename: "Test" } as any;
  const ocrEngine = {
    recognize: vi.fn(),
    setProvider: vi.fn(),
    destroy: vi.fn(),
  };
  const draftStore = {
    load: vi.fn(async () => null),
    save: vi.fn(),
    delete: vi.fn(async () => {}),
  };

  const view = new PencilCanvasView(
    leaf as any,
    noteFile,
    DEFAULT_SETTINGS,
    ocrEngine as any,
    draftStore as any
  );

  const convertBtn = document.createElement("button");
  convertBtn.className = "pencil-convert-btn";
  const toolbar = document.createElement("div");
  toolbar.appendChild(convertBtn);

  const engine = {
    renderExistingText: vi.fn(),
    appendStrokes: vi.fn(),
    hasStrokes: vi.fn(() => true),
    getReconstructedText: vi.fn(() => ""),
    getInkOnlyImageDataUrl: vi.fn(() => ""),
    clearStrokes: vi.fn(),
  };

  (view as any).engine = engine;
  (view as any).canvas = document.createElement("canvas");
  (view as any).toolbar = toolbar;

  return {
    app,
    draftStore,
    engine,
    getContent,
    noteFile,
    ocrEngine,
    view,
  };
}

describe("PencilCanvasView metadata handling", () => {
  beforeEach(() => {
    (Notice as any).messages = [];
  });

  it("preserves frontmatter when saving edited note content", async () => {
    const initialContent = "---\ntags:\n  - pencil\naliases: [Sketch]\n---\n\nOriginal body\n";
    const { app, draftStore, engine, getContent, noteFile, view } = makeView(initialContent);

    engine.getReconstructedText.mockReturnValue("Updated body");

    await (view as any).loadExistingContent();
    await (view as any).convertToText();

    expect(engine.renderExistingText).toHaveBeenCalledWith("Original body\n", false);
    expect(app.vault.process).toHaveBeenCalledOnce();
    expect(getContent()).toBe("---\ntags:\n  - pencil\naliases: [Sketch]\n---\n\nUpdated body\n");
    expect(draftStore.delete).toHaveBeenCalledWith(noteFile);
    expect(engine.clearStrokes).toHaveBeenCalledOnce();
  });

  it("keeps frontmatter and appends recognized ink for frontmatter-only notes", async () => {
    const initialContent = "---\ntags: [pencil]\n---\n";
    const { app, engine, getContent, ocrEngine, view } = makeView(initialContent);

    engine.getInkOnlyImageDataUrl.mockReturnValue("data:image/png;base64,abc");
    ocrEngine.recognize.mockResolvedValue("Handwritten body");

    await (view as any).loadExistingContent();
    await (view as any).convertToText();

    expect(engine.renderExistingText).toHaveBeenCalledWith("", false);
    expect(ocrEngine.recognize).toHaveBeenCalledOnce();
    expect(app.vault.process).toHaveBeenCalledOnce();
    expect(getContent()).toBe("---\ntags: [pencil]\n---\nHandwritten body\n");
  });

  it("shows and resyncs the active OCR provider before conversion", async () => {
    const { engine, ocrEngine, view } = makeView("Body\n");
    const statusEl = document.createElement("div");

    (view as any).ocrStatusEl = statusEl;
    (view as any).updateOCRStatus();
    expect(statusEl.textContent).toBe("OCR: On-device Tesseract");

    (view as any).settings.ocrProvider = "claude";
    engine.getInkOnlyImageDataUrl.mockReturnValue("data:image/png;base64,abc");
    ocrEngine.recognize.mockResolvedValue("Ink");

    await (view as any).loadExistingContent();
    await (view as any).convertToText();

    expect(ocrEngine.setProvider).toHaveBeenCalledWith("claude");
    expect(statusEl.textContent).toBe("OCR: Claude");
  });
});
