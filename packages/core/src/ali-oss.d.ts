declare module "ali-oss" {
  export type PutOptions = {
    headers?: Record<string, string>;
  };

  export type ListOptions = {
    prefix?: string;
    marker?: string;
    "max-keys"?: number;
  };

  export type OssObject = {
    name?: string;
    lastModified?: string | Date;
  };

  export type ListResult = {
    objects?: OssObject[];
    nextMarker?: string;
  };

  export default class OSS {
    constructor(options: {
      region: string;
      endpoint: string;
      bucket: string;
      accessKeyId?: string;
      accessKeySecret?: string;
      secure?: boolean;
    });

    put(name: string, file: Buffer, options?: PutOptions): Promise<unknown>;
    delete(name: string): Promise<unknown>;
    list(options: ListOptions): Promise<ListResult>;
    deleteMulti(names: string[], options?: { quiet?: boolean }): Promise<unknown>;
  }
}
