import { env } from "cloudflare:workers";

type FileMetadata = { contentType?: string; size?: number };
type FileBinding = R2Bucket | KVNamespace;

export type KnowledgeFile = {
  body: ReadableStream<Uint8Array>;
  size: number;
  contentType: string;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
};

function binding(): FileBinding | undefined {
  return (env as unknown as { KNOWLEDGE_FILES?: FileBinding }).KNOWLEDGE_FILES;
}

function isKv(value: FileBinding): value is KVNamespace {
  return "getWithMetadata" in value;
}

export function hasKnowledgeFileStorage() {
  return Boolean(binding());
}

export async function putKnowledgeFile(
  key: string,
  value: ReadableStream | ArrayBuffer | ArrayBufferView | string,
  metadata: FileMetadata = {},
) {
  const storage = binding();
  if (!storage) throw new Error("STORAGE_UNAVAILABLE");
  if (isKv(storage)) {
    await storage.put(key, value as ReadableStream | ArrayBuffer | ArrayBufferView | string, {
      metadata: { contentType: metadata.contentType || "application/octet-stream", size: metadata.size || 0 },
    });
    return { size: metadata.size || 0 };
  }
  const stored = await storage.put(key, value, { httpMetadata: { contentType: metadata.contentType } });
  return { size: stored.size };
}

export async function getKnowledgeFile(key: string): Promise<KnowledgeFile | null> {
  const storage = binding();
  if (!storage) return null;
  if (isKv(storage)) {
    const result = await storage.getWithMetadata<FileMetadata>(key, "arrayBuffer");
    if (!result.value) return null;
    const bytes = result.value;
    const size = Number(result.metadata?.size) || bytes.byteLength;
    const contentType = result.metadata?.contentType || "application/octet-stream";
    return {
      body: new Blob([bytes], { type: contentType }).stream(), size, contentType,
      arrayBuffer: async () => bytes,
      text: async () => new TextDecoder().decode(bytes),
    };
  }
  const object = await storage.get(key);
  if (!object) return null;
  return {
    body: object.body, size: object.size,
    contentType: object.httpMetadata?.contentType || "application/octet-stream",
    arrayBuffer: () => object.arrayBuffer(), text: () => object.text(),
  };
}

export async function deleteKnowledgeFile(key: string) {
  await binding()?.delete(key);
}
