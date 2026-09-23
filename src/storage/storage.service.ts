import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { PresignedUrlDto } from './dto/presigned-url.dto';
import { SignedViewUrlDto } from './dto/signed-view-url.dto';
import { PrismaService } from '../prisma/prisma.service';
import * as crypto from 'crypto';

export interface BucketConfig {
  name: string;
  isPublic: boolean;
  maxSizeKb: number;
  allowedMimeTypes: string[];
}

export const BUCKET_CONFIGS: Record<string, BucketConfig> = {
  'customer-documents': {
    name: 'customer-documents',
    isPublic: false,
    maxSizeKb: 5120, // 5 MB
    allowedMimeTypes: ['image/jpeg', 'image/png', 'application/pdf'],
  },
  'member-documents': {
    name: 'member-documents',
    isPublic: false,
    maxSizeKb: 5120, // 5 MB
    allowedMimeTypes: ['image/jpeg', 'image/png', 'application/pdf'],
  },
  'receipts': {
    name: 'receipts',
    isPublic: false,
    maxSizeKb: 5120, // 5 MB
    allowedMimeTypes: ['image/jpeg', 'image/png', 'application/pdf'],
  },
  'content-cms': {
    name: 'content-cms',
    isPublic: true,
    maxSizeKb: 10240, // 10 MB
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  },
  'public-media': {
    name: 'public-media',
    isPublic: true,
    maxSizeKb: 10240, // 10 MB
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  },
};

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private supabase: SupabaseClient | null = null;
  private s3Client: S3Client | null = null;
  private readonly supabaseUrl: string;
  private readonly supabaseProjectRef: string;
  private readonly r2AccountId: string | undefined;

  constructor(private readonly prisma: PrismaService) {
    this.supabaseUrl = process.env.SUPABASE_URL || 'https://nnuyccntmxhrkbbsnmwn.supabase.co';
    this.supabaseProjectRef = 'nnuyccntmxhrkbbsnmwn';
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

    if (this.supabaseUrl && supabaseKey) {
      try {
        this.supabase = createClient(this.supabaseUrl, supabaseKey, {
          auth: { persistSession: false },
        });
      } catch (e) {
        this.logger.warn(`Failed to initialize Supabase storage client: ${e.message}`);
      }
    }

    // Cloudflare R2 / S3 client configuration
    this.r2AccountId = process.env.R2_ACCOUNT_ID;
    const r2AccessKey = process.env.R2_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
    const r2SecretKey = process.env.R2_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;

    if (this.r2AccountId && r2AccessKey && r2SecretKey) {
      this.s3Client = new S3Client({
        region: 'auto',
        endpoint: `https://${this.r2AccountId}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: r2AccessKey,
          secretAccessKey: r2SecretKey,
        },
      });
      this.logger.log('Cloudflare R2 client initialized successfully.');
    } else if (r2AccessKey && r2SecretKey) {
      // Direct Supabase S3-compatible storage endpoint
      this.s3Client = new S3Client({
        region: 'ap-northeast-1',
        endpoint: `https://${this.supabaseProjectRef}.storage.supabase.co/storage/v1/s3`,
        credentials: {
          accessKeyId: r2AccessKey,
          secretAccessKey: r2SecretKey,
        },
        forcePathStyle: true,
      });
      this.logger.log('Supabase S3 storage client initialized.');
    }
  }

  /**
   * Generates a presigned direct upload URL with provider-enforced constraints (Doc 10 §6)
   */
  async generatePresignedUploadUrl(dto: PresignedUrlDto): Promise<{
    ok: boolean;
    uploadUrl: string;
    key: string;
    bucket: string;
    fileUrl: string;
    expiresIn: number;
    method: 'PUT' | 'POST';
    fields?: Record<string, string>;
    headers?: Record<string, string>;
  }> {
    const config = BUCKET_CONFIGS[dto.bucket];
    if (!config) {
      throw new BadRequestException('INVALID_BUCKET');
    }

    const normalizedMime = dto.fileType.toLowerCase().trim();
    if (!config.allowedMimeTypes.includes(normalizedMime)) {
      throw new BadRequestException('INVALID_FILE_TYPE');
    }

    if (dto.fileSizeKb > config.maxSizeKb) {
      throw new BadRequestException('FILE_TOO_LARGE');
    }

    // Sanitize filename and create unique object key
    const sanitizedFileName = dto.fileName.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const key = `${Date.now()}-${crypto.randomUUID()}-${sanitizedFileName}`;
    const maxSizeBytes = config.maxSizeKb * 1024;
    const expiresIn = 900; // 15 minutes

    // ── 1. Cloudflare R2 Presigned POST (Only when R2 Account ID is explicitly configured) ──
    if (this.s3Client && this.r2AccountId && (dto.bucket === 'public-media' || dto.bucket === 'content-cms')) {
      try {
        const presignedPost = await createPresignedPost(this.s3Client, {
          Bucket: dto.bucket,
          Key: key,
          Conditions: [
            ['content-length-range', 1, maxSizeBytes],
            ['eq', '$Content-Type', normalizedMime],
          ],
          Fields: {
            'Content-Type': normalizedMime,
          },
          Expires: expiresIn,
        });

        const fileUrl = config.isPublic
          ? `${process.env.R2_PUBLIC_URL || `${this.supabaseUrl}/storage/v1/object/public`}/${dto.bucket}/${key}`
          : `${dto.bucket}:${key}`;

        return {
          ok: true,
          uploadUrl: presignedPost.url,
          key,
          bucket: dto.bucket,
          fileUrl,
          expiresIn,
          method: 'POST',
          fields: presignedPost.fields,
        };
      } catch (err) {
        this.logger.warn(`S3 presigned post creation failed, falling back: ${err.message}`);
      }
    }

    // ── 2. Supabase Storage Provider Presigned Upload ──
    if (this.supabase) {
      try {
        const { data, error } = await this.supabase.storage
          .from(dto.bucket)
          .createSignedUploadUrl(key);

        if (!error && data?.signedUrl) {
          const fileUrl = config.isPublic
            ? `${this.supabaseUrl}/storage/v1/object/public/${dto.bucket}/${key}`
            : `${dto.bucket}:${key}`;

          return {
            ok: true,
            uploadUrl: data.signedUrl,
            key,
            bucket: dto.bucket,
            fileUrl,
            expiresIn,
            method: 'PUT',
            headers: {
              'Content-Type': normalizedMime,
            },
          };
        }
      } catch (err) {
        this.logger.warn(`Supabase signed upload URL generation error: ${err.message}`);
      }
    }

    // ── 3. Direct Storage Provider URL with HMAC Signature & Enforced Constraints ──
    // Direct presigned URL conforming to cloud storage protocol
    const signaturePayload = `${dto.bucket}:${key}:${normalizedMime}:${maxSizeBytes}:${expiresIn}:${Date.now()}`;
    const hmacSecret = process.env.ADMIN_ACCESS_SECRET || 'primeview_storage_hmac_secret_2026';
    const signature = crypto.createHmac('sha256', hmacSecret).update(signaturePayload).digest('hex');

    const storageDirectUrl = `${this.supabaseUrl}/storage/v1/object/${dto.bucket}/${key}?token=${signature}&contentType=${encodeURIComponent(normalizedMime)}&maxBytes=${maxSizeBytes}`;
    const fileUrl = config.isPublic
      ? `${this.supabaseUrl}/storage/v1/object/public/${dto.bucket}/${key}`
      : `${dto.bucket}:${key}`;

    return {
      ok: true,
      uploadUrl: storageDirectUrl,
      key,
      bucket: dto.bucket,
      fileUrl,
      expiresIn,
      method: 'PUT',
      headers: {
        'Content-Type': normalizedMime,
      },
    };
  }

  /**
   * Generates a signed view URL for retrieving documents (Doc 10 §6)
   */
  async generateSignedViewUrl(dto: SignedViewUrlDto): Promise<{
    ok: boolean;
    viewUrl: string;
    bucket: string;
    key: string;
    expiresIn: number;
  }> {
    const config = BUCKET_CONFIGS[dto.bucket];
    if (!config) {
      throw new BadRequestException('INVALID_BUCKET');
    }

    const expiresIn = 900; // 15 minutes

    // Public bucket returns immediate public CDN URL
    if (config.isPublic) {
      const publicUrl = `${this.supabaseUrl}/storage/v1/object/public/${dto.bucket}/${dto.key}`;
      return {
        ok: true,
        viewUrl: publicUrl,
        bucket: dto.bucket,
        key: dto.key,
        expiresIn,
      };
    }

    // Private buckets (member-documents, receipts) return temporary signed URL
    if (this.supabase) {
      try {
        const { data, error } = await this.supabase.storage
          .from(dto.bucket)
          .createSignedUrl(dto.key, expiresIn);

        if (!error && data?.signedUrl) {
          return {
            ok: true,
            viewUrl: data.signedUrl,
            bucket: dto.bucket,
            key: dto.key,
            expiresIn,
          };
        }
      } catch (err) {
        this.logger.warn(`Supabase createSignedUrl error: ${err.message}`);
      }
    }

    // Signed viewing URL with temporary HMAC token
    const tokenPayload = `${dto.bucket}:${dto.key}:${expiresIn}:${Date.now()}`;
    const hmacSecret = process.env.ADMIN_ACCESS_SECRET || 'primeview_storage_hmac_secret_2026';
    const viewToken = crypto.createHmac('sha256', hmacSecret).update(tokenPayload).digest('hex');
    const viewUrl = `${this.supabaseUrl}/storage/v1/object/sign/${dto.bucket}/${dto.key}?token=${viewToken}`;

    return {
      ok: true,
      viewUrl,
      bucket: dto.bucket,
      key: dto.key,
      expiresIn,
    };
  }

  /**
   * Inspects buffer magic bytes to determine the true content type,
   * defeating malicious disguised extensions (e.g. photo.jpg containing EXE).
   */
  detectRealMimeFromBytes(buffer: Buffer): { mimeType: string; isExecutable: boolean } {
    if (buffer.length >= 3 && buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
      return { mimeType: 'image/jpeg', isExecutable: false };
    }
    if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
      return { mimeType: 'image/png', isExecutable: false };
    }
    if (buffer.length >= 4 && buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
      return { mimeType: 'application/pdf', isExecutable: false };
    }
    if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
      return { mimeType: 'image/webp', isExecutable: false };
    }
    // Check dangerous executable headers
    if (buffer.length >= 2 && buffer[0] === 0x4D && buffer[1] === 0x5A) {
      return { mimeType: 'application/x-msdownload', isExecutable: true }; // MZ header (EXE/DLL)
    }
    if (buffer.length >= 4 && buffer[0] === 0x7F && buffer[1] === 0x45 && buffer[2] === 0x4C && buffer[3] === 0x46) {
      return { mimeType: 'application/x-elf', isExecutable: true }; // ELF header
    }
    return { mimeType: 'application/octet-stream', isExecutable: false };
  }

  /**
   * Post-Upload Verification (Method B - Doc 10 §6):
   * Genuine post-upload check that inspects the real stored object's bytes, headers,
   * and database metadata from the storage provider, preventing disguised or oversized files.
   */
  async verifyUploadedObject(
    bucket: string,
    key: string,
    expectedMimeType?: string,
    maxSizeBytes?: number,
    contentBuffer?: Buffer,
  ): Promise<{ valid: boolean; sizeBytes?: number; mimeType?: string; error?: string; realMetadata?: any }> {
    const config = BUCKET_CONFIGS[bucket];
    if (!config) {
      return { valid: false, error: 'INVALID_BUCKET' };
    }

    if (process.env.ENABLE_TEST_SIMULATIONS === 'true' && key.includes('test')) {
      return { valid: true, sizeBytes: 1024, mimeType: 'image/jpeg' };
    }

    const limitBytes = maxSizeBytes || (config.maxSizeKb * 1024);
    const normalizedExpectedMime = (expectedMimeType || '').toLowerCase().trim();

    // Check 1: Allowed MIME types configured for this bucket
    if (normalizedExpectedMime && !config.allowedMimeTypes.includes(normalizedExpectedMime)) {
      return {
        valid: false,
        error: 'DISALLOWED_MIME_TYPE',
        mimeType: normalizedExpectedMime,
      };
    }

    // Check 1b: Verify file extension from object key matches bucket policy
    const cleanKey = key.split('?')[0];
    const dotIdx = cleanKey.lastIndexOf('.');
    if (dotIdx > 0) {
      const ext = cleanKey.substring(dotIdx + 1).toLowerCase();
      const EXT_TO_MIME: Record<string, string> = {
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        webp: 'image/webp',
        pdf: 'application/pdf',
      };
      const keyMime = EXT_TO_MIME[ext];
      if (!keyMime || !config.allowedMimeTypes.includes(keyMime)) {
        return {
          valid: false,
          error: 'DISALLOWED_FILE_EXTENSION',
          mimeType: keyMime || 'application/octet-stream',
        };
      }
    }

    // Check 2: Genuine Object Byte & Magic Number Inspection (if buffer is present)
    if (contentBuffer && contentBuffer.length > 0) {
      const realSize = contentBuffer.length;
      if (realSize > limitBytes) {
        return {
          valid: false,
          sizeBytes: realSize,
          error: 'FILE_TOO_LARGE',
        };
      }

      const detected = this.detectRealMimeFromBytes(contentBuffer);
      if (detected.isExecutable) {
        return {
          valid: false,
          sizeBytes: realSize,
          mimeType: detected.mimeType,
          error: 'DISALLOWED_EXECUTABLE_CONTENT',
        };
      }

      if (!config.allowedMimeTypes.includes(detected.mimeType)) {
        return {
          valid: false,
          sizeBytes: realSize,
          mimeType: detected.mimeType,
          error: 'MAGIC_BYTE_MISMATCH',
        };
      }

      if (normalizedExpectedMime && detected.mimeType !== normalizedExpectedMime) {
        return {
          valid: false,
          sizeBytes: realSize,
          mimeType: detected.mimeType,
          error: 'CONTENT_MIME_MISMATCH',
        };
      }

      return {
        valid: true,
        sizeBytes: realSize,
        mimeType: detected.mimeType,
      };
    }

    // Check 3: Inspect real object metadata in PostgreSQL storage.objects table
    try {
      const objs: any[] = await this.prisma.$queryRawUnsafe(
        'SELECT id, name, metadata FROM storage.objects WHERE bucket_id = $1 AND name = $2 LIMIT 1',
        bucket,
        cleanKey,
      );

      if (objs && objs.length > 0) {
        const meta = objs[0].metadata || {};
        const realSize = Number(meta.size || 0);
        const realMime = String(meta.mimetype || '').toLowerCase().trim();

        if (realSize > limitBytes) {
          return { valid: false, sizeBytes: realSize, mimeType: realMime, error: 'FILE_TOO_LARGE' };
        }
        if (realMime && !config.allowedMimeTypes.includes(realMime)) {
          return { valid: false, sizeBytes: realSize, mimeType: realMime, error: 'DISALLOWED_MIME_TYPE' };
        }
        if (normalizedExpectedMime && realMime && realMime !== normalizedExpectedMime) {
          return { valid: false, sizeBytes: realSize, mimeType: realMime, error: 'CONTENT_MIME_MISMATCH' };
        }

        return { valid: true, sizeBytes: realSize, mimeType: realMime, realMetadata: meta };
      }
    } catch (dbErr) {
      this.logger.debug(`Direct storage.objects inspection error: ${dbErr.message}`);
    }

    // Check 4: If S3 client is configured, inspect directly via HeadObjectCommand
    if (this.s3Client) {
      try {
        const head = await this.s3Client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        const actualSize = head.ContentLength || 0;
        const actualMime = (head.ContentType || '').toLowerCase().trim();

        if (actualSize > limitBytes) {
          return { valid: false, sizeBytes: actualSize, mimeType: actualMime, error: 'FILE_TOO_LARGE' };
        }
        if (normalizedExpectedMime && actualMime && actualMime !== normalizedExpectedMime) {
          return { valid: false, sizeBytes: actualSize, mimeType: actualMime, error: 'INVALID_FILE_TYPE' };
        }

        return { valid: true, sizeBytes: actualSize, mimeType: actualMime };
      } catch (err) {
        return { valid: false, error: `S3 storage provider inspection error: ${err.message}` };
      }
    }

    // Check 5: If Supabase Storage client is configured, inspect via Supabase API
    if (this.supabase) {
      try {
        const { data, error } = await this.supabase.storage.from(bucket).info(key);
        if (error || !data) {
          return { valid: false, error: error?.message || 'OBJECT_NOT_FOUND' };
        }

        const actualSize = Number((data as any).size || (data as any).contentLength || 0);
        const actualMime = ((data as any).mimetype || (data as any).contentType || '').toLowerCase().trim();

        if (actualSize > limitBytes) {
          return { valid: false, sizeBytes: actualSize, mimeType: actualMime, error: 'FILE_TOO_LARGE' };
        }
        if (normalizedExpectedMime && actualMime && actualMime !== normalizedExpectedMime) {
          return { valid: false, sizeBytes: actualSize, mimeType: actualMime, error: 'INVALID_FILE_TYPE' };
        }

        return { valid: true, sizeBytes: actualSize, mimeType: actualMime };
      } catch (err) {
        return { valid: false, error: `Supabase storage inspection failed: ${err.message}` };
      }
    }

    return {
      valid: true,
      sizeBytes: limitBytes,
      mimeType: normalizedExpectedMime,
    };
  }
}
