export interface SpeechPreparationOptions {
  language?: 'auto' | 'en' | 'hi' | 'hinglish';
}

export function prepareSpeechText(
  displayText: string,
  options?: SpeechPreparationOptions
): string;
