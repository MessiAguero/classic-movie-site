import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const SWIFT_SCRIPT = path.join(ROOT, 'tools', 'ocr-posters.swift');
const SWIFT_BIN = process.env.SWIFT_BIN || '/usr/bin/swift';
const EXT = { jpeg: 'jpg', png: 'png', webp: 'webp', gif: 'gif' };

/**
 * OCR a batch with macOS Vision. Bytes never need to be public: each image is
 * written to a private temporary directory and the whole batch is one process.
 */
export function recognizePosterBytes(items, { timeoutMs = 180000 } = {}) {
  const usable = items
    .map((item, index) => ({ ...item, index }))
    .filter((item) => item?.bytes?.length && item?.meta?.type);
  if (!usable.length) return { available: true, byIndex: new Map(), error: null };
  if (!fs.existsSync(SWIFT_BIN) || !fs.existsSync(SWIFT_SCRIPT)) {
    return {
      available: false,
      byIndex: new Map(),
      error: `Vision OCR 不可用（${SWIFT_BIN} / ${SWIFT_SCRIPT}）`,
    };
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'classicmovie-ocr-'));
  const cleanup = () => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* Temporary files are safe to leave for the OS if cleanup is interrupted. */
    }
  };

  try {
    const tempPaths = usable.map((item) => {
      const ext = EXT[item.meta.type] || 'img';
      const safeId = String(item.id || item.index).replace(/[^A-Za-z0-9_-]/g, '_');
      const file = path.join(tempDir, `${item.index}-${safeId}.${ext}`);
      fs.writeFileSync(file, item.bytes);
      return file;
    });

    const stdout = execFileSync(SWIFT_BIN, [SWIFT_SCRIPT, ...tempPaths], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeoutMs,
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, LANG: 'en_US.UTF-8' },
    });
    const parsed = JSON.parse(stdout);
    const byIndex = new Map();
    for (let i = 0; i < usable.length; i++) {
      const item = usable[i];
      const ocr = parsed[i];
      byIndex.set(item.index, {
        ok: !ocr?.error,
        text: String(ocr?.text || ''),
        lines: Array.isArray(ocr?.lines) ? ocr.lines : [],
        error: ocr?.error || null,
      });
    }
    return { available: true, byIndex, error: null };
  } catch (error) {
    return {
      available: false,
      byIndex: new Map(),
      error: error?.stderr?.toString?.() || error?.message || String(error),
    };
  } finally {
    cleanup();
  }
}
