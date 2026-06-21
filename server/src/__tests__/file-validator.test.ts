import { describe, it, expect } from 'vitest';
import { validateFileContent, getFileSignature } from '../lib/file-validator';

describe('File Content Validation', () => {
  describe('getFileSignature', () => {
    it('should detect PNG files', () => {
      const pngBuffer = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
      expect(getFileSignature(pngBuffer)).toBe('png');
    });

    it('should detect JPEG files', () => {
      const jpegBuffer = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]);
      expect(getFileSignature(jpegBuffer)).toBe('jpeg');
    });

    it('should detect GIF files', () => {
      const gifBuffer = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
      expect(getFileSignature(gifBuffer)).toBe('gif');
    });

    it('should return null for unknown files', () => {
      const unknownBuffer = Buffer.from([0x00, 0x01, 0x02, 0x03]);
      expect(getFileSignature(unknownBuffer)).toBeNull();
    });

    it('should handle empty buffers', () => {
      const emptyBuffer = Buffer.alloc(0);
      expect(getFileSignature(emptyBuffer)).toBeNull();
    });
  });

  describe('validateFileContent', () => {
    it('should validate PNG file content', async () => {
      const pngBuffer = Buffer.from([
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
      ]);
      const result = await validateFileContent(pngBuffer, 'image/png');
      expect(result.valid).toBe(true);
      expect(result.detectedType).toBe('png');
    });

    it('should validate JPEG file content', async () => {
      const jpegBuffer = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]);
      const result = await validateFileContent(jpegBuffer, 'image/jpeg');
      expect(result.valid).toBe(true);
      expect(result.detectedType).toBe('jpeg');
    });

    it('reject HTML file with image extension', async () => {
      const htmlBuffer = Buffer.from('<html><script>alert("xss")</script></html>');
      const result = await validateFileContent(htmlBuffer, 'image/png');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('invalid file');
    });

    it('reject executable file with image extension', async () => {
      const exeBuffer = Buffer.from([0x4D, 0x5A, 0x90, 0x00]);
      const result = await validateFileContent(exeBuffer, 'image/png');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('content does not match');
    });

    it('should handle null/undefined buffers', async () => {
      const result = await validateFileContent(null as any, 'image/png');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('invalid file');
    });
  });
});
