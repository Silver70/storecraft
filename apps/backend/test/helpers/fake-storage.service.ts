import { Injectable } from '@nestjs/common';
import type { R2StorageService } from '../../src/shared/storage/r2-storage.service';

/** What one stored object looked like when it arrived. */
export interface StoredObject {
  key: string;
  contentType: string;
  bytes: number;
}

/**
 * Stands in for Cloudflare R2, for the reason the payment provider fake stands
 * in for Stripe: it is the other collaborator that would reach a third party
 * over the network. Everything else in the suite stays the real service against
 * a real database.
 *
 * It keeps what it was handed, so a test can assert not only that an upload
 * succeeded but that a refused one never reached storage at all — which is the
 * interesting half of the tenancy case.
 */
@Injectable()
export class FakeStorageService implements Pick<
  R2StorageService,
  'upload' | 'delete' | 'getPublicUrl' | 'getPresignedUploadUrl'
> {
  readonly stored: StoredObject[] = [];
  readonly deleted: string[] = [];

  private readonly publicUrl = 'https://cdn.test.invalid';

  upload(key: string, buffer: Buffer, contentType: string): Promise<string> {
    this.stored.push({ key, contentType, bytes: buffer.byteLength });
    return Promise.resolve(this.getPublicUrl(key));
  }

  delete(key: string): Promise<void> {
    this.deleted.push(key);
    return Promise.resolve();
  }

  getPublicUrl(key: string): string {
    return `${this.publicUrl}/${key}`;
  }

  getPresignedUploadUrl(key: string): Promise<string> {
    return Promise.resolve(`${this.getPublicUrl(key)}?signed=1`);
  }
}
