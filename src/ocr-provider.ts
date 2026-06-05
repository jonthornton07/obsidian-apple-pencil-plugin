import { OCRProvider } from "./types";

export function getOCRProviderLabel(provider: OCRProvider): string {
  switch (provider) {
    case "openai":
      return "OpenAI GPT-4o";
    case "google":
      return "Google Vision";
    case "claude":
      return "Claude";
    case "gemini":
      return "Gemini";
    case "tesseract":
    default:
      return "On-device Tesseract";
  }
}
