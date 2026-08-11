import FilesRepository from './files.repository';

export default class FilesService {
  static async createFile(payload: {
    fileKey: string;
    fileName: string;
    mimeType: string;
    size: number;
    storageProvider?: string;
    bucket?: string;
    uploadedById?: string;
  }) {
    return FilesRepository.create({
      filename: payload.fileKey.split('/').pop() || 'untitled',
      originalName: payload.fileName,
      mimeType: payload.mimeType,
      size: payload.size,
      storageProvider: payload.storageProvider || 'S3',
      bucket: payload.bucket || undefined,
      path: payload.fileKey,
      ...(payload.uploadedById ? { uploadedById: payload.uploadedById } : {}),
    });
  }
}
