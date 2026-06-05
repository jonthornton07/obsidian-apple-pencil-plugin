import { getFrontMatterInfo } from "obsidian";

export interface NoteCanvasParts {
  protectedPrefix: string;
  editableBody: string;
}

export function splitNoteForCanvas(content: string): NoteCanvasParts {
  const info = getFrontMatterInfo(content);
  if (!info.exists) {
    return {
      protectedPrefix: "",
      editableBody: content,
    };
  }

  let protectedEnd = info.contentStart;
  while (protectedEnd < content.length) {
    const char = content[protectedEnd];
    if (char === "\n" || char === "\r") {
      protectedEnd++;
      continue;
    }
    break;
  }

  return {
    protectedPrefix: content.slice(0, protectedEnd),
    editableBody: content.slice(protectedEnd),
  };
}

export function mergeCanvasBody(parts: NoteCanvasParts, nextBody: string): string {
  if (!parts.protectedPrefix) {
    return nextBody ? `${nextBody}\n` : "";
  }

  if (!nextBody) {
    return parts.protectedPrefix;
  }

  return `${parts.protectedPrefix}${nextBody}\n`;
}
