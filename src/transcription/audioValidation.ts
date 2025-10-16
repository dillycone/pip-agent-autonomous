import { safeSpawn } from "../utils/shell-safe.js";
import type { AudioProbeData } from "../types/index.js";
import { isAudioProbeData } from "../types/index.js";

export interface CommandResult {
  stdout: string;
  stderr: string;
}

export async function runCommand(command: string, args: string[]): Promise<CommandResult> {
  const result = await safeSpawn(command, args, {
    timeout: 300000,
    validatePaths: true
  });

  return {
    stdout: result.stdout,
    stderr: result.stderr
  };
}

export interface AudioValidationDetails {
  codec?: string;
  bitrate?: string;
  duration?: number;
}

export interface AudioValidationResult {
  isValid: boolean;
  error?: string;
  hint?: string;
  details?: AudioValidationDetails;
}

export async function validateAudioFile(filePath: string): Promise<AudioValidationResult> {
  try {
    const { stdout } = await runCommand("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "stream=codec_name,codec_type,bit_rate,duration",
      "-show_entries",
      "format=duration,bit_rate",
      "-of",
      "json",
      filePath
    ]);

    let probeData: AudioProbeData;
    try {
      const parsed: unknown = JSON.parse(stdout.trim());
      if (!isAudioProbeData(parsed)) {
        return {
          isValid: false,
          error: "Unable to read audio file metadata",
          hint: "The file may be corrupt, encrypted, or an unsupported format. Try re-exporting as MP3 or WAV."
        };
      }
      probeData = parsed;
    } catch {
      return {
        isValid: false,
        error: "Unable to read audio file metadata",
        hint: "The file may be corrupt, encrypted, or an unsupported format. Try re-exporting as MP3 or WAV."
      };
    }

    const streams = probeData.streams || [];
    const format = probeData.format || {};

    const audioStream = streams.find(s => s.codec_type === "audio");

    if (!audioStream) {
      if (streams.length === 0) {
        return {
          isValid: false,
          error: "No streams found in file",
          hint: "The file appears to be corrupt or empty. Try downloading/exporting it again."
        };
      }

      const hasVideo = streams.some(s => s.codec_type === "video");
      if (hasVideo) {
        return {
          isValid: false,
          error: "No audio stream found in file",
          hint: "This file appears to be video-only or has no audio track. Please provide a valid audio file."
        };
      }

      return {
        isValid: false,
        error: "No audio stream found in file",
        hint: "Audio file appears to be corrupt. Please provide a valid audio file (MP3, WAV, FLAC, etc.)."
      };
    }

    const codec = audioStream.codec_name || "unknown";
    const supportedCodecs = [
      "mp3", "aac", "opus", "vorbis", "wav", "flac", "pcm_s16le", "pcm_s24le",
      "pcm_s32le", "pcm_f32le", "pcm_f64le", "pcm_u8", "alac", "wmav2", "wmav1"
    ];

    const isKnownCodec = supportedCodecs.some(supported => codec.toLowerCase().includes(supported));

    if (!isKnownCodec) {
      return {
        isValid: false,
        error: `Audio codec '${codec}' may not be supported`,
        hint: "Try converting your audio to MP3, WAV, or FLAC format for better compatibility."
      };
    }

    let duration = parseFloat(audioStream.duration || "") || parseFloat(format.duration || "") || 0;

    if (!Number.isFinite(duration) || duration <= 0) {
      return {
        isValid: false,
        error: "Audio file has zero or invalid duration",
        hint: "The file may be corrupt, empty, or incomplete. Try re-exporting or downloading it again."
      };
    }

    const bitrate = audioStream.bit_rate || format.bit_rate;
    const bitrateFormatted = bitrate ? `${Math.round(parseInt(bitrate) / 1000)}k` : "unknown";

    return {
      isValid: true,
      details: {
        codec,
        bitrate: bitrateFormatted,
        duration
      }
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);

    if (message.includes("Invalid data found")) {
      return {
        isValid: false,
        error: "File appears to be truncated or corrupted",
        hint: "The audio file is incomplete or damaged. Try downloading/exporting it again."
      };
    }

    if (message.includes("moov atom not found")) {
      return {
        isValid: false,
        error: "File is incomplete or improperly encoded",
        hint: "This MP4/M4A file is missing required metadata. Try re-exporting with a different tool."
      };
    }

    return {
      isValid: false,
      error: "Unable to read audio file",
      hint: "The file may be corrupt, encrypted, or an unsupported format. Try re-exporting as MP3 or WAV."
    };
  }
}

export async function probeDuration(filePath: string): Promise<number | null> {
  try {
    const { stdout } = await runCommand("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath
    ]);
    const value = parseFloat(stdout.trim());
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}
