import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

@Injectable()
export class S3PresignService {
  private readonly logger = new Logger(S3PresignService.name);

  isConfigured(): boolean {
    return !!(
      process.env.S3_BUCKET?.trim() &&
      process.env.AWS_REGION?.trim() &&
      process.env.AWS_ACCESS_KEY_ID?.trim() &&
      process.env.AWS_SECRET_ACCESS_KEY?.trim()
    );
  }

  private client(): S3Client {
    const region = process.env.AWS_REGION?.trim();
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID?.trim();
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY?.trim();
    if (!region || !accessKeyId || !secretAccessKey) {
      throw new ServiceUnavailableException('AWS credentials / region are not configured');
    }
    return new S3Client({
      region,
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  private bucket(): string {
    const bucket = process.env.S3_BUCKET?.trim();
    if (!bucket) throw new ServiceUnavailableException('S3_BUCKET is not configured');
    return bucket;
  }

  objectKey(roomSlug: string, stamp: string): string {
    const prefix = (process.env.S3_PREFIX?.trim() || 'recordings').replace(/\/$/, '');
    return `${prefix}/${roomSlug}-${stamp}.webm`;
  }

  async createUploadUrls(s3Key: string): Promise<{ putUrl: string; downloadUrl: string }> {
    const client = this.client();
    const bucket = this.bucket();
    const putUrl = await getSignedUrl(
      client,
      new PutObjectCommand({
        Bucket: bucket,
        Key: s3Key,
        ContentType: 'video/webm',
      }),
      { expiresIn: 60 * 15 },
    );
    const downloadUrl = await getSignedUrl(
      client,
      new GetObjectCommand({
        Bucket: bucket,
        Key: s3Key,
      }),
      { expiresIn: 60 * 60 },
    );
    this.logger.log(`presigned s3 key=${s3Key}`);
    return { putUrl, downloadUrl };
  }
}
